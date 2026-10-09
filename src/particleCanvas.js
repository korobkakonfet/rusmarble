/** @file One shared canvas for the pixel-info confetti and fireworks.
 *
 * Bursts used to be one DOM element (and one compositor layer, one WAAPI animation) per
 * particle, so a single open created 200+ elements in one frame. Here every particle is a
 * pre-rendered sprite blitted onto a single canvas that only runs while particles are alive:
 * no layout, no style recalc, one layer.
 *
 * Hot-loop rules (from profiling): no per-particle rotation matrices (sprites are pre-rotated
 * into strips and blitted axis-aligned), and no browser globals inside the per-particle loop -
 * in a userscript every global (`Math`, `window`, ...) goes through the manager's sandbox
 * proxy, which showed up as ~800 ms of `get`/`has` traps in a 12 s profile.
 * @since 0.87.108
 */

// Captured once at load, so the per-particle code never touches the sandbox proxy.
const { min, max, floor, ceil, round, abs, PI } = Math;

/** Sprites are cached per look; sizes are snapped so the cache stays small. */
const PIXEL_SIZES = [4, 6, 8];
const GLYPH_SIZES = [14, 20];
/** Pre-rotated frames per sprite: squares repeat every 90°, glyphs every 360°. */
const PIXEL_ROTATIONS = 8;
const GLYPH_ROTATIONS = 16;
const MAX_PARTICLES = 900;
/** Extra room around a particle's own path (sprite size, glow, spin). */
const PATH_PAD = 40;
/** When the canvas has to grow, grow with slack so the next bursts fit without reallocating. */
const GROW_SLACK = 160;
/** Free the canvas when nothing has played for a while. */
const CANVAS_IDLE_MS = 30000;

const snap = (value, steps) => steps.reduce((best, step) => (abs(step - value) < abs(best - value) ? step : best));

/** Ease-out curves standing in for the CSS cubic-beziers the DOM version used. */
const EASINGS = {
  linear: (t) => t,
  out2: (t) => 1 - (1 - t) * (1 - t),
  out3: (t) => { const u = 1 - t; return 1 - u * u * u; },
};

export const createParticleCanvas = () => {
  const perf = performance;
  const doc = document;
  let canvas = null;
  let ctx = null;
  let particles = [];
  let frame = 0;
  let idleTimer = 0;
  /** Area drawn last frame, cleared at the start of the next one. */
  let dirty = null;
  /** Viewport rect the canvas currently covers. Only the area around the bursts gets canvas:
   * 1 canvas pixel per CSS pixel, and when canvas isn't GPU-accelerated the browser re-uploads
   * the whole bitmap every frame (a full 4K-screen canvas meant ~33 MB per frame). */
  let region = null;
  /** Union of the paths of every particle added since the canvas last went idle. */
  let needed = null;
  /** Viewport size, cached (reading `window.innerWidth` goes through the sandbox proxy). */
  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  const onResize = () => {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
  };
  const sprites = new Map();

  /** A strip of `frames` copies of a drawing, each rotated a bit more, side by side. The draw
   * loop then picks the nearest angle and does a plain axis-aligned blit. */
  const makeStrip = (box, frames, period, draw) => {
    const strip = doc.createElement('canvas');
    strip.width = box * frames;
    strip.height = box;
    const c = strip.getContext('2d');
    for (let i = 0; i < frames; i++) {
      c.setTransform(1, 0, 0, 1, i * box + box / 2, box / 2);
      c.rotate((i * period / frames) * PI / 180);
      draw(c);
    }
    return { image: strip, box, frames, period };
  };

  /** A square pixel: outlined (confetti) or glowing (firework sparks/rockets, never rotated). */
  const pixelSprite = (color, rawSize, glow) => {
    const size = snap(rawSize, PIXEL_SIZES);
    const key = `p|${color}|${size}|${glow || ''}`;
    let sprite = sprites.get(key);
    if (!sprite) {
      const half = size / 2;
      sprite = glow
        ? makeStrip(size + 12, 1, 90, (c) => {
          c.shadowColor = glow;
          c.shadowBlur = 5;
          c.fillStyle = color;
          c.fillRect(-half, -half, size, size);
        })
        // Room for the square's diagonal while rotated, plus the 1px outline.
        : makeStrip(ceil((size + 2) * 1.42) + 2, PIXEL_ROTATIONS, 90, (c) => {
          c.fillStyle = 'rgba(255,255,255,.28)';
          c.fillRect(-half - 1, -half - 1, size + 2, size + 2);
          c.fillStyle = color;
          c.fillRect(-half, -half, size, size);
        });
      sprites.set(key, sprite);
    }
    return sprite;
  };

  const glyphSprite = (glyph, color, rawSize) => {
    const size = snap(rawSize, GLYPH_SIZES);
    // Colour emoji (👑) ignore fillStyle, so one sprite per size is enough.
    if (glyph.codePointAt(0) > 0xffff) color = '#000';
    const key = `g|${glyph}|${color}|${size}`;
    let sprite = sprites.get(key);
    if (!sprite) {
      sprite = makeStrip(ceil(size * 1.7), GLYPH_ROTATIONS, 360, (c) => {
        c.font = `${size}px sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.shadowColor = 'rgba(255,255,255,.55)';
        c.shadowBlur = 3;
        c.fillStyle = color;
        c.fillText(glyph, 0, 0);
      });
      sprites.set(key, sprite);
    }
    return sprite;
  };

  /** Records a particle's whole path (start + travel + gravity). Sizing to real paths instead
   * of a fixed reach means firework sparks (~110px of travel) don't make the canvas grow. */
  const reserve = (p) => {
    clearTimeout(idleTimer);
    const dx = p.dx || 0;
    const dy = p.dy || 0;
    const left = p.x + min(0, dx) - PATH_PAD;
    const top = p.y + min(0, dy) - PATH_PAD;
    const right = p.x + max(0, dx) + PATH_PAD;
    const bottom = p.y + max(0, dy) + max(0, p.gravity || 0) + PATH_PAD;
    if (!needed) {
      needed = { left, top, right, bottom };
    } else {
      if (left < needed.left) needed.left = left;
      if (top < needed.top) needed.top = top;
      if (right > needed.right) needed.right = right;
      if (bottom > needed.bottom) needed.bottom = bottom;
    }
  };

  /** Called once per frame before drawing: resizes the canvas at most once, and only when the
   * reserved paths don't fit (a whole 120-piece burst = one allocation, not one per particle). */
  const fitCanvas = () => {
    if (!needed) return;
    // Paths can run off-screen (confetti falling past the bottom edge); only the on-screen part
    // needs canvas. Comparing unclamped paths with the clamped canvas would never "fit" and
    // reallocate the canvas every frame.
    const viewLeft = max(0, needed.left);
    const viewTop = max(0, needed.top);
    const viewRight = min(viewW, needed.right);
    const viewBottom = min(viewH, needed.bottom);
    if (region && canvas?.isConnected
      && viewLeft >= region.left && viewTop >= region.top && viewRight <= region.right && viewBottom <= region.bottom) {
      return;
    }
    if (!canvas?.isConnected) {
      canvas = doc.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;image-rendering:pixelated;';
      ctx = canvas.getContext('2d');
      doc.body.appendChild(canvas);
      window.addEventListener('resize', onResize);
      onResize();
      region = null;
    }
    // Grow with slack so later bursts nearby fit without another allocation.
    region = {
      left: max(0, floor(min(needed.left, region?.left ?? Infinity) - GROW_SLACK)),
      top: max(0, floor(min(needed.top, region?.top ?? Infinity) - GROW_SLACK)),
      right: min(viewW, ceil(max(needed.right, region?.right ?? -Infinity) + GROW_SLACK)),
      bottom: min(viewH, ceil(max(needed.bottom, region?.bottom ?? -Infinity) + GROW_SLACK)),
    };
    const width = max(1, region.right - region.left);
    const height = max(1, region.bottom - region.top);
    canvas.width = width; // also clears it and resets the context state
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.transform = `translate(${region.left}px, ${region.top}px)`;
    // Nearest-neighbour sampling: cheaper, and right for pixel art.
    if (ctx) ctx.imageSmoothingEnabled = false;
    dirty = null;
  };

  const releaseCanvas = () => {
    needed = null;
    window.removeEventListener('resize', onResize);
    canvas?.remove();
    canvas = null;
    ctx = null;
    dirty = null;
    region = null;
  };

  /** Reused between frames so a burst doesn't create garbage every frame. */
  const finished = [];

  const tick = (time) => {
    frame = 0;
    fitCanvas();
    if (!ctx || !region) return;
    if (dirty) ctx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const offsetX = region.left;
    const offsetY = region.top;
    const regionW = region.right - region.left;
    const regionH = region.bottom - region.top;
    let alphaNow = 1;
    // Compacts `particles` in place: survivors are moved to the front, the rest is cut off.
    let kept = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const t = (time - p.start) / p.life;
      if (t >= 1) {
        if (p.onDone) finished.push(p.onDone);
        continue;
      }
      particles[kept++] = p;
      if (t < 0) continue;
      const alpha = t < p.fadeFrom ? 1 : 1 - (t - p.fadeFrom) / (1 - p.fadeFrom);
      if (alpha <= 0.01) continue;
      const eased = p.ease(t);
      const x = p.x + p.dx * eased - offsetX;
      const y = p.y + p.dy * eased + p.gravity * t * t - offsetY;
      const scale = p.scaleFrom === p.scaleTo ? p.scaleTo : p.scaleFrom + (p.scaleTo - p.scaleFrom) * min(1, t * p.scaleSpeed);
      const s = p.sprite;
      const drawn = s.box * scale;
      const half = drawn / 2;
      // Off the canvas: nothing to draw.
      if (x + half < 0 || y + half < 0 || x - half > regionW || y - half > regionH) continue;
      // Nearest pre-rotated frame instead of a rotation matrix.
      let index = 0;
      if (s.frames > 1 && p.spin !== 0) {
        index = round((p.spin * t) / s.period * s.frames) % s.frames;
        if (index < 0) index += s.frames;
      }
      if (alpha !== alphaNow) {
        ctx.globalAlpha = alpha;
        alphaNow = alpha;
      }
      ctx.drawImage(s.image, index * s.box, 0, s.box, s.box, x - half, y - half, drawn, drawn);
      if (x - half < minX) minX = x - half;
      if (y - half < minY) minY = y - half;
      if (x + half > maxX) maxX = x + half;
      if (y + half > maxY) maxY = y + half;
    }
    particles.length = kept;
    if (alphaNow !== 1) ctx.globalAlpha = 1;
    if (minX === Infinity) {
      dirty = null;
    } else {
      dirty = dirty || {};
      dirty.x = floor(minX) - 1;
      dirty.y = floor(minY) - 1;
      dirty.w = ceil(maxX - minX) + 3;
      dirty.h = ceil(maxY - minY) + 3;
    }
    while (finished.length) {
      try { finished.pop()(); } catch (_) {}
    }
    if (particles.length) {
      // `onDone` above may already have scheduled the next frame through add(); scheduling again
      // would start a second, parallel draw loop (each finished rocket used to add one more,
      // so rapid clicks stacked up loops that all redrew every particle).
      if (!frame) frame = requestAnimationFrame(tick);
    } else if (!frame) {
      if (dirty) ctx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
      dirty = null;
      // Nothing flying: the next burst starts a fresh reservation (the canvas only grows again
      // if that burst doesn't fit in the current one).
      needed = null;
      idleTimer = setTimeout(releaseCanvas, CANVAS_IDLE_MS);
    }
  };

  /**
   * Adds one particle. Positions are viewport CSS pixels.
   * @param {object} p
   * @param {object} p.sprite From `pixel()` / `glyph()`.
   * @param {number} p.x Start x. @param {number} p.y Start y.
   * @param {number} [p.dx] Total x travel. @param {number} [p.dy] Total y travel (before gravity).
   * @param {number} [p.gravity] Extra downward px reached at the end (t² curve).
   * @param {number} p.life Duration ms. @param {number} [p.delay] ms.
   * @param {number} [p.spin] Degrees over the whole life.
   * @param {number} [p.fadeFrom] 0..1, when fading out starts.
   * @param {string} [p.ease] 'linear' | 'out2' | 'out3'.
   * @param {Function} [p.onDone] Called when it finishes.
   */
  const add = (p) => {
    if (particles.length >= MAX_PARTICLES) return false;
    reserve(p);
    particles.push({
      dx: 0, dy: 0, gravity: 0, spin: 0, fadeFrom: 0.7, scaleFrom: 1, scaleTo: 1, scaleSpeed: 1, ...p,
      start: perf.now() + (p.delay || 0),
      ease: EASINGS[p.ease] || EASINGS.out2,
    });
    if (!frame) frame = requestAnimationFrame(tick);
    return true;
  };

  /** Stops everything immediately. */
  const clear = () => {
    particles = [];
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty = null;
    needed = null;
    if (canvas) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(releaseCanvas, CANVAS_IDLE_MS);
    }
  };

  /** Draws the sprites a config will need ahead of time, so the first burst doesn't pay for it. */
  const prewarm = ({ colors = [], glyphs = [], glowColors = [] }) => {
    colors.forEach((color) => {
      PIXEL_SIZES.forEach((size) => pixelSprite(color, size));
      glyphs.forEach((glyph) => GLYPH_SIZES.forEach((size) => glyphSprite(glyph, color, size)));
    });
    glowColors.forEach((color) => {
      PIXEL_SIZES.forEach((size) => pixelSprite(color, size, color));
      pixelSprite('#fff8d0', 4, color);
    });
  };

  return {
    add,
    clear,
    prewarm,
    pixel: pixelSprite,
    glyph: glyphSprite,
    get count() { return particles.length; },
  };
};
