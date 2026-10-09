/** @file "My pixel effects" window: verify the wplace account by painting one pixel, then pick
 * which effects play when someone opens a pixel you painted.
 * New ids/attributes use the `rm-` prefix on purpose (see the CSS mangler notes).
 * @since 0.87.108
 */

import { makePanelDraggable, registerFloatingPanel } from './utils.js';
import {
  DEFAULT_PIXEL_EFFECTS,
  PIXEL_EFFECT_BADGES,
  PIXEL_EFFECT_COLOR_LIMITS,
  PIXEL_EFFECT_ENUMS,
  PIXEL_EFFECT_INTS,
  PIXEL_EFFECT_MOTTO_MAX,
  PIXEL_EFFECT_EXCLUSIVE_COLORS,
  PIXEL_EFFECT_EXCLUSIVE_FLAGS,
  canUseExclusiveEffects,
  describeEffectsError,
  normalizePixelEffects,
} from './pixelEffects.js';

const VERIFY_POLL_MS = 6000;
const VERIFY_POLL_LIMIT_MS = 10 * 60 * 1000;
/** Colour pickers fire continuously while dragging; replay the preview once they settle. */
const PREVIEW_DEBOUNCE_MS = 450;

const FLAG_LABELS = {
  pulse: ['pixelEffects.flag.pulse', 'Pulse when opened'],
  wave: ['pixelEffects.flag.wave', 'Letter wave on the name'],
  confetti: ['pixelEffects.flag.confetti', 'Confetti'],
  fireworks: ['pixelEffects.flag.fireworks', 'Fireworks salute'],
  crown: ['pixelEffects.flag.crown', 'Badge on the name'],
  border: ['pixelEffects.flag.border', 'Spinning border'],
  clickExplode: ['pixelEffects.flag.clickExplode', 'Click the name to replay'],
  sparkles: ['pixelEffects.flag.sparkles', 'Sparkles around the name'],
};

const COLOR_LABELS = {
  confettiColors: ['pixelEffects.colors.confetti', 'Confetti colours'],
  fireworkColors: ['pixelEffects.colors.fireworks', 'Firework colours (one per rocket)'],
  borderColors: ['pixelEffects.colors.border', 'Border colours'],
  nameColors: ['pixelEffects.colors.name', 'Name colours'],
  sparkleColors: ['pixelEffects.colors.sparkles', 'Sparkle colours'],
  cardColors: ['pixelEffects.colors.card', 'Card tint colours (two = gradient)'],
  haloColors: ['pixelEffects.colors.halo', 'Border glow colour'],
  ambientColors: ['pixelEffects.colors.ambient', 'Particle colours'],
};

/** Labels for the named choices in PIXEL_EFFECT_ENUMS. */
const ENUM_LABELS = {
  nameStyle: ['pixelEffects.nameStyle', 'Name style', {
    none: ['pixelEffects.nameStyle.none', 'Normal'],
    gradient: ['pixelEffects.nameStyle.gradient', 'Gradient'],
    glow: ['pixelEffects.nameStyle.glow', 'Glow'],
  }],
  borderSpeed: ['pixelEffects.borderSpeed', 'Border speed', {
    slow: ['pixelEffects.speed.slow', 'Slow'],
    normal: ['pixelEffects.speed.normal', 'Normal'],
    fast: ['pixelEffects.speed.fast', 'Fast'],
  }],
  badgeAnimation: ['pixelEffects.badgeAnimation', 'Badge animation', {
    wobble: ['pixelEffects.badgeAnimation.wobble', 'Wobble'],
    bounce: ['pixelEffects.badgeAnimation.bounce', 'Bounce'],
    spin: ['pixelEffects.badgeAnimation.spin', 'Spin'],
    none: ['pixelEffects.badgeAnimation.none', 'Still'],
  }],
  badgeSize: ['pixelEffects.badgeSize', 'Badge size', {
    small: ['pixelEffects.size.small', 'Small'],
    medium: ['pixelEffects.size.medium', 'Medium'],
    large: ['pixelEffects.size.large', 'Large'],
  }],
  badgePosition: ['pixelEffects.badgePosition', 'Badge position', {
    start: ['pixelEffects.badgePosition.start', 'Before the name'],
    end: ['pixelEffects.badgePosition.end', 'After the name'],
  }],
  nameFont: ['pixelEffects.nameFont', 'Name font', {
    default: ['pixelEffects.nameFont.default', 'Default'],
    bold: ['pixelEffects.nameFont.bold', 'Extra bold'],
    italic: ['pixelEffects.nameFont.italic', 'Italic'],
    mono: ['pixelEffects.nameFont.mono', 'Monospace'],
    serif: ['pixelEffects.nameFont.serif', 'Serif'],
    rounded: ['pixelEffects.nameFont.rounded', 'Handwritten'],
  }],
  cardTint: ['pixelEffects.cardTint', 'Card tint', {
    off: ['pixelEffects.cardTint.off', 'Off'],
    subtle: ['pixelEffects.cardTint.subtle', 'Subtle'],
    strong: ['pixelEffects.cardTint.strong', 'Strong'],
  }],
  nameAnimation: ['pixelEffects.nameAnimation', 'Name animation', {
    none: ['pixelEffects.anim.none', 'None'],
    float: ['pixelEffects.nameAnimation.float', 'Float'],
    heartbeat: ['pixelEffects.nameAnimation.heartbeat', 'Heartbeat'],
    jelly: ['pixelEffects.nameAnimation.jelly', 'Jelly'],
    shimmer: ['pixelEffects.nameAnimation.shimmer', 'Shimmer'],
    glitch: ['pixelEffects.nameAnimation.glitch', 'Glitch'],
  }],
  cardEntrance: ['pixelEffects.cardEntrance', 'Card entrance', {
    none: ['pixelEffects.anim.none', 'None'],
    pop: ['pixelEffects.cardEntrance.pop', 'Pop'],
    slide: ['pixelEffects.cardEntrance.slide', 'Slide up'],
    flip: ['pixelEffects.cardEntrance.flip', 'Flip'],
  }],
  ambient: ['pixelEffects.ambient', 'Particles on the card', {
    none: ['pixelEffects.anim.none', 'None'],
    snow: ['pixelEffects.ambient.snow', 'Snow'],
    hearts: ['pixelEffects.ambient.hearts', 'Hearts'],
    bubbles: ['pixelEffects.ambient.bubbles', 'Bubbles'],
    embers: ['pixelEffects.ambient.embers', 'Embers'],
    stars: ['pixelEffects.ambient.stars', 'Falling stars'],
  }],
  mottoAnimation: ['pixelEffects.mottoAnimation', 'Motto animation', {
    none: ['pixelEffects.anim.none', 'None'],
    typewriter: ['pixelEffects.mottoAnimation.typewriter', 'Typewriter'],
    fade: ['pixelEffects.mottoAnimation.fade', 'Fade in'],
  }],
};

const INT_LABELS = {
  borderWidth: ['pixelEffects.borderWidth', 'Border thickness'],
};

/** Editor layout: which controls go in which group, in order. */
const EDITOR_GROUPS = [
  ['pixelEffects.group.card', 'Card', ['text:motto', 'enum:mottoAnimation', 'enum:cardEntrance', 'enum:cardTint', 'colors:cardColors', 'enum:ambient', 'colors:ambientColors']],
  ['pixelEffects.group.name', 'Name', ['enum:nameFont', 'enum:nameStyle', 'colors:nameColors', 'enum:nameAnimation', 'flag:wave', 'flag:pulse', 'flag:clickExplode']],
  ['pixelEffects.group.badge', 'Badge', ['flag:crown', 'badge', 'enum:badgeAnimation', 'enum:badgeSize', 'enum:badgePosition', 'flag:sparkles', 'colors:sparkleColors']],
  ['pixelEffects.group.border', 'Border', ['flag:border', 'enum:borderSpeed', 'int:borderWidth', 'colors:borderColors', 'colors:haloColors']],
  ['pixelEffects.group.party', 'Celebration', ['flag:confetti', 'colors:confettiColors', 'flag:fireworks', 'colors:fireworkColors']],
];

/**
 * @param {object} deps
 * @param {Function} deps.t Translator, `(key) => string`.
 * @param {ReturnType<import('./pixelEffects.js').createPixelEffectsStore>} deps.store
 * @param {() => number|null} deps.getUserId The logged-in wplace user ID.
 * @param {() => number[]|null} deps.getSelectedPixel `[tileX, tileY, x, y]` of the last opened pixel.
 * @param {() => string} deps.getUserName The logged-in wplace nickname, for the preview card.
 * @param {(card: HTMLElement, config: object) => void} deps.previewPixelEffects Plays effects on a card.
 * @param {() => void} deps.stopPixelEffectsPreview Stops the preview.
 * @param {Function} deps.applyOverlayVarsToFloatingElement Copies the overlay theme onto the panel.
 */
export const createPixelEffectsUi = ({
  t: translate,
  store,
  getUserId,
  getUserName,
  getSelectedPixel,
  previewPixelEffects,
  stopPixelEffectsPreview,
  applyOverlayVarsToFloatingElement,
}) => {
  const tt = (key, fallback) => {
    const value = typeof translate === 'function' ? translate(key) : null;
    return (value && value !== key) ? value : fallback;
  };

  let session = null;

  const el = (tag, style = '', text = '') => {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text) node.textContent = text;
    return node;
  };
  const button = (text) => {
    const node = el('button', 'padding: 4px 10px;', text);
    node.type = 'button';
    return node;
  };

  const openPixelEffectsEditor = () => {
    if (session?.panel?.isConnected) {
      session.panel.style.zIndex = '9600';
      return;
    }

    const panel = el('section', 'width: 360px; right: 20px; bottom: 20px;');
    panel.id = 'rm-pixel-effects-window';
    panel.className = 'bm-text-template-window';

    const head = el('div');
    head.className = 'bm-text-template-window-head';
    head.title = tt('dialog.common.dragToMove', 'Drag to move');
    const title = el('span', '', tt('pixelEffects.title', 'My pixel effects'));
    title.className = 'bm-text-template-window-title';
    const closeBtn = button('✖');
    closeBtn.className = 'bm-text-template-window-close';
    closeBtn.title = tt('dialog.common.close', 'Close');
    head.append(title, closeBtn);

    const body = el('div', 'overflow-y: auto; display: flex; flex-direction: column; gap: 8px;');
    body.className = 'bm-text-template-window-body';
    const content = el('div', 'display: flex; flex-direction: column; gap: 8px;');
    const status = el('div', 'min-height: 1.2em; white-space: normal;');
    status.className = 'bm-text-template-window-meta';
    body.append(content, status);
    panel.append(head, body);

    let closed = false;
    let pollTimer = 0;
    let previewTimer = 0;
    const setStatus = (message, isError = false) => {
      status.textContent = message || '';
      status.style.color = isError ? 'var(--bm-danger, #ff7b7b)' : '';
    };
    const stopPolling = () => { clearTimeout(pollTimer); pollTimer = 0; };
    const stopPreview = () => {
      clearTimeout(previewTimer);
      previewTimer = 0;
      stopPixelEffectsPreview?.();
    };

    /* ---- step 1: verify by painting a pixel ------------------------------- */

    const renderVerify = (userId) => {
      stopPolling();
      content.replaceChildren();
      const intro = el('div', 'white-space: normal; line-height: 1.4;', tt(
        'pixelEffects.verify.intro',
        'Prove this is your account by painting one pixel. Your wplace token is never used.'
      ));
      const steps = el('ol', 'margin: 0; padding-left: 1.4em; list-style: decimal; white-space: normal; line-height: 1.4;');
      [
        tt('pixelEffects.verify.step1', 'Click any pixel on the map that someone else painted (or an empty one).'),
        tt('pixelEffects.verify.step2', 'Press "Start", then paint that same pixel with the colour shown.'),
        tt('pixelEffects.verify.step3', 'Verification finishes by itself a few seconds after you paint.'),
      ].forEach((text) => steps.appendChild(el('li', '', text)));
      const who = el('div', 'opacity: .8;', `${tt('pixelEffects.account', 'Account')}: #${userId}`);
      const startBtn = button(tt('pixelEffects.verify.start', 'Start'));
      const task = el('div', 'display: none; white-space: normal; line-height: 1.5; padding: 6px 8px; border: 1px solid var(--bm-border); border-radius: 8px;');
      content.append(intro, steps, who, startBtn, task);

      startBtn.addEventListener('click', async () => {
        const pixel = getSelectedPixel?.();
        if (!Array.isArray(pixel) || pixel.length < 4 || pixel.some((n) => !Number.isInteger(n))) {
          setStatus(tt('pixelEffects.verify.noPixel', 'Click a pixel on the map first.'), true);
          return;
        }
        startBtn.disabled = true;
        setStatus(tt('pixelEffects.verify.starting', 'Checking that pixel...'));
        let response;
        try {
          response = await store.api.startChallenge(userId, pixel);
        } catch (_) {
          response = null;
        }
        startBtn.disabled = false;
        if (closed) return;
        if (response?.status !== 200 || !response.json?.challenge_id) {
          setStatus(describeEffectsError(response, tt('pixelEffects.error', 'Server error, try again.')), true);
          return;
        }
        const { challenge_id: challengeId, color, pixel: target } = response.json;
        const swatch = el('span', `display: inline-block; width: 14px; height: 14px; vertical-align: -2px; border: 1px solid #888; background: rgb(${color.rgb.map(Number).join(',')});`);
        task.style.display = '';
        task.replaceChildren(
          el('div', '', `${tt('pixelEffects.verify.paint', 'Paint pixel')} Tl ${target.tile_x}, ${target.tile_y} | Px ${target.x}, ${target.y}`),
          el('div', '', `${tt('pixelEffects.verify.with', 'with')} `),
        );
        task.lastChild.append(swatch, ` ${color.name} (#${color.id})`);
        setStatus(tt('pixelEffects.verify.waiting', 'Waiting for you to paint it...'));

        const startedAt = Date.now();
        const poll = async () => {
          if (closed) return;
          let result;
          try {
            result = await store.api.verify(challengeId);
          } catch (_) {
            result = null;
          }
          if (closed) return;
          if (result?.status === 200 && result.json?.verified && result.json.key) {
            await store.saveEditKey(result.json.user_id, result.json.key);
            setStatus(tt('pixelEffects.verify.done', 'Verified! Now pick your effects.'));
            void renderEditor(result.json.user_id, result.json.key);
            return;
          }
          if (result && result.status !== 200 && result.status !== 502) {
            setStatus(describeEffectsError(result, tt('pixelEffects.verify.failed', 'Verification failed, start again.')), true);
            return;
          }
          if (Date.now() - startedAt > VERIFY_POLL_LIMIT_MS) {
            setStatus(tt('pixelEffects.verify.timeout', 'Timed out. Press Start to try again.'), true);
            return;
          }
          if (result?.json?.painted_by_you && !result.json.color_matches) {
            setStatus(tt('pixelEffects.verify.wrongColor', 'Painted, but not with that colour yet (or wplace is still updating).'));
          }
          pollTimer = setTimeout(poll, VERIFY_POLL_MS);
        };
        stopPolling();
        pollTimer = setTimeout(poll, VERIFY_POLL_MS);
      });
    };

    /* ---- step 2: edit effects --------------------------------------------- */

    const renderColorList = (working, key, onChange) => {
      const [min, max] = PIXEL_EFFECT_COLOR_LIMITS[key];
      const wrap = el('div', 'display: flex; flex-direction: column; gap: 4px;');
      const label = el('div', '', tt(...COLOR_LABELS[key]));
      const row = el('div', 'display: flex; flex-wrap: wrap; gap: 4px; align-items: center;');
      const sync = () => {
        row.replaceChildren();
        working[key].forEach((color, index) => {
          const input = el('input', 'width: 30px; height: 24px; padding: 0; border: none; background: none; cursor: pointer;');
          input.type = 'color';
          input.value = color;
          input.addEventListener('input', () => {
            working[key][index] = input.value.toLowerCase();
            onChange();
          });
          input.addEventListener('contextmenu', (event) => {
            // Right-click removes a colour (down to the minimum).
            event.preventDefault();
            if (working[key].length <= min) return;
            working[key].splice(index, 1);
            sync();
            onChange();
          });
          input.title = tt('pixelEffects.colors.removeHint', 'Right-click to remove');
          row.appendChild(input);
        });
        if (working[key].length < max) {
          const add = button('+');
          add.title = tt('pixelEffects.colors.add', 'Add colour');
          add.addEventListener('click', () => {
            working[key].push(working[key][working[key].length - 1] || '#ffffff');
            sync();
            onChange();
          });
          row.appendChild(add);
        }
      };
      sync();
      wrap.append(label, row);
      return { wrap, sync };
    };

    /** A mock pixel-info card with the same markup hooks wplace's has, so the real animation
     * code finds the name/ID exactly like it does on the map. */
    const buildPreviewCard = (userId) => {
      // Sticky so it stays in view while scrolling the options (the spinning border follows it).
      const card = el('div', 'position: sticky; top: 0; z-index: 2; padding: 8px 10px; border-radius: 12px; border: 1px solid var(--bm-border); background: var(--bm-bg);');
      const caption = el('div', 'font-size: smaller; opacity: .65; margin-bottom: 6px;', tt('pixelEffects.preview', 'Preview — what others see when they open your pixel'));
      const row = el('div', 'display: flex; align-items: center; gap: 8px;');
      row.className = 'flex items-center gap-2';
      const avatar = el('div', 'width: 28px; height: 28px; border-radius: 50%; flex: none; background: linear-gradient(135deg, #4093e4, #6b50f6);');
      const nameWrap = el('span', 'display: inline-flex; align-items: baseline; gap: 4px;');
      nameWrap.className = 'inline-flex items-baseline';
      const name = el('span', 'font-weight: 600;', (getUserName?.() || tt('pixelEffects.you', 'You')).trim());
      const id = el('span', 'opacity: .7;', `#${userId}`);
      nameWrap.append(name, id);
      row.append(avatar, nameWrap);
      const meta = el('div', 'font-size: smaller; opacity: .6; margin-top: 6px;', tt('pixelEffects.previewMeta', 'Painted just now'));
      card.append(caption, row, meta);
      return card;
    };

    const renderEditor = async (userId, key) => {
      stopPolling();
      stopPreview();
      content.replaceChildren(el('div', 'opacity: .8;', tt('pixelEffects.loading', 'Loading...')));
      let mine;
      try {
        mine = await store.api.getMine(key);
      } catch (_) {
        mine = null;
      }
      if (closed) return;
      if (mine?.status === 401) {
        await store.clearEditKey();
        setStatus(tt('pixelEffects.keyExpired', 'Your verification expired, please verify again.'), true);
        renderVerify(userId);
        return;
      }
      if (mine?.status !== 200) {
        setStatus(describeEffectsError(mine, tt('pixelEffects.error', 'Server error, try again.')), true);
      }
      const hasSaved = !!mine?.json?.config;
      const working = normalizePixelEffects(hasSaved ? mine.json.config : DEFAULT_PIXEL_EFFECTS, userId);
      const exclusive = canUseExclusiveEffects(userId);

      content.replaceChildren();
      content.appendChild(el('div', 'opacity: .8;', `${tt('pixelEffects.account', 'Account')}: #${userId} ✔`));

      const previewCard = buildPreviewCard(userId);
      content.appendChild(previewCard);
      const playPreview = () => {
        clearTimeout(previewTimer);
        previewTimer = 0;
        if (!closed && previewCard.isConnected) previewPixelEffects?.(previewCard, normalizePixelEffects(working, userId));
      };
      const schedulePreview = () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(playPreview, PREVIEW_DEBOUNCE_MS);
      };

      const selectRow = (labelText, options, value, onPick) => {
        const row = el('label', 'display: flex; align-items: center; justify-content: space-between; gap: 6px;', labelText);
        const select = el('select', 'max-width: 55%;');
        select.className = 'bm-text-template-window-select';
        options.forEach(([optionValue, optionLabel]) => {
          const option = el('option', '', optionLabel);
          option.value = optionValue;
          option.selected = optionValue === value;
          select.appendChild(option);
        });
        select.addEventListener('change', () => {
          onPick(select.value);
          schedulePreview();
        });
        row.appendChild(select);
        return row;
      };
      const isHidden = (flagOrList) => !exclusive
        && (PIXEL_EFFECT_EXCLUSIVE_FLAGS.includes(flagOrList) || PIXEL_EFFECT_EXCLUSIVE_COLORS.includes(flagOrList));

      const buildControl = (spec) => {
        const [type, name] = spec.split(':');
        if (isHidden(name)) return null;
        if (type === 'flag') {
          const label = el('label', 'display: flex; align-items: center; gap: 6px; white-space: normal; cursor: pointer;');
          const checkbox = el('input');
          checkbox.type = 'checkbox';
          checkbox.checked = working[name];
          checkbox.addEventListener('change', () => {
            working[name] = checkbox.checked;
            schedulePreview();
          });
          label.append(checkbox, tt(...FLAG_LABELS[name]));
          return label;
        }
        if (type === 'badge') {
          return selectRow(tt('pixelEffects.badge', 'Badge'), PIXEL_EFFECT_BADGES.map((b) => [b, b]), working.badge, (v) => { working.badge = v; });
        }
        if (type === 'enum') {
          const [labelKey, labelFallback, optionLabels] = ENUM_LABELS[name];
          return selectRow(
            tt(labelKey, labelFallback),
            PIXEL_EFFECT_ENUMS[name].map((v) => [v, tt(...optionLabels[v])]),
            working[name],
            (v) => { working[name] = v; }
          );
        }
        if (type === 'int') {
          const [min, max] = PIXEL_EFFECT_INTS[name];
          const row = el('label', 'display: flex; align-items: center; justify-content: space-between; gap: 6px;', tt(...INT_LABELS[name]));
          const range = el('input', 'width: 45%;');
          range.type = 'range';
          range.min = String(min);
          range.max = String(max);
          range.value = String(working[name]);
          range.addEventListener('input', () => {
            working[name] = Number(range.value);
            schedulePreview();
          });
          row.appendChild(range);
          return row;
        }
        if (type === 'colors') return renderColorList(working, name, schedulePreview).wrap;
        if (type === 'text') {
          const wrap = el('label', 'display: flex; flex-direction: column; gap: 3px;', tt('pixelEffects.motto', 'Motto (shown under your name)'));
          const input = el('input', 'width: 100%; box-sizing: border-box; padding: 3px 8px; border: 1px solid var(--bm-border); border-radius: 8px; background: var(--bm-subtle-bg, rgba(255,255,255,.06)); color: var(--bm-fg);');
          input.type = 'text';
          input.maxLength = PIXEL_EFFECT_MOTTO_MAX;
          input.value = working[name] || '';
          input.placeholder = tt('pixelEffects.mottoPlaceholder', `Up to ${PIXEL_EFFECT_MOTTO_MAX} characters, no links`);
          input.addEventListener('input', () => {
            working[name] = input.value;
            schedulePreview();
          });
          // The map's keyboard shortcuts must not fire while typing.
          input.addEventListener('keydown', (event) => event.stopPropagation());
          wrap.appendChild(input);
          return wrap;
        }
        return null;
      };

      EDITOR_GROUPS.forEach(([titleKey, titleFallback, specs]) => {
        const controls = specs.map(buildControl).filter(Boolean);
        if (!controls.length) return;
        const group = el('fieldset', 'display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 6px 8px 8px; border: 1px solid var(--bm-border); border-radius: 8px;');
        const legend = el('legend', 'padding: 0 4px; font-weight: 600;', tt(titleKey, titleFallback));
        group.append(legend, ...controls);
        content.appendChild(group);
      });

      const hint = el('div', 'opacity: .75; white-space: normal; line-height: 1.4;', tt(
        'pixelEffects.hint',
        'Everyone with RusMarble sees these when they open a pixel you painted.'
      ));
      content.appendChild(hint);

      const actions = el('div');
      actions.className = 'bm-text-template-window-actions';
      const replayBtn = button(`▶ ${tt('pixelEffects.replay', 'Replay')}`);
      replayBtn.addEventListener('click', playPreview);
      actions.appendChild(replayBtn);
      const removeBtn = button(tt('pixelEffects.remove', 'Remove'));
      removeBtn.disabled = !hasSaved;
      const saveBtn = button(tt('pixelEffects.save', 'Save'));
      actions.append(removeBtn, saveBtn);
      content.appendChild(actions);

      // Wait a frame so the card is laid out before effects measure it.
      requestAnimationFrame(playPreview);

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        let response;
        try {
          response = await store.api.saveMine(key, working);
        } catch (_) {
          response = null;
        }
        saveBtn.disabled = false;
        if (closed) return;
        if (response?.status === 200) {
          store.setLocal(userId, response.json.config);
          removeBtn.disabled = false;
          // An older server silently drops options it doesn't know yet; say so instead of
          // pretending they were saved.
          const kept = response.json.config || {};
          const dropped = Object.keys(working).filter((field) => !(field in kept));
          if (dropped.length) {
            setStatus(`${tt('pixelEffects.savedPartly', 'Saved, but the server ignored (it needs an update):')} ${dropped.join(', ')}`, true);
            return;
          }
          setStatus(tt('pixelEffects.saved', 'Saved. Everyone sees it within a few minutes.'));
        } else {
          setStatus(describeEffectsError(response, tt('pixelEffects.saveFailed', 'Could not save.')), true);
        }
      });
      removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true;
        let response;
        try {
          response = await store.api.deleteMine(key);
        } catch (_) {
          response = null;
        }
        if (closed) return;
        if (response?.status === 200) {
          store.setLocal(userId, null);
          setStatus(tt('pixelEffects.removed', 'Removed. Your pixels are back to normal.'));
        } else {
          removeBtn.disabled = false;
          setStatus(describeEffectsError(response, tt('pixelEffects.saveFailed', 'Could not save.')), true);
        }
      });
    };

    /* ---- open ----------------------------------------------------------- */

    const close = () => {
      if (closed) return;
      closed = true;
      stopPolling();
      stopPreview();
      detachDrag?.();
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('bm-layout-theme-changed', handleThemeChanged);
      panel.remove();
      if (session?.panel === panel) session = null;
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const handleThemeChanged = () => { applyOverlayVarsToFloatingElement?.(panel); };
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
    });

    const detachDrag = makePanelDraggable(head, panel);
    document.body.appendChild(panel);
    registerFloatingPanel(panel);
    applyOverlayVarsToFloatingElement?.(panel);
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('bm-layout-theme-changed', handleThemeChanged);
    session = { panel, close };

    const userId = getUserId?.();
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      content.appendChild(el('div', 'white-space: normal;', tt('pixelEffects.notLoggedIn', 'Log in to wplace first, then open this again.')));
      return;
    }
    void store.loadEditKey().then((stored) => {
      if (closed) return;
      if (stored && stored.userId === userId) void renderEditor(userId, stored.key);
      else renderVerify(userId);
    });
  };

  return { openPixelEffectsEditor };
};
