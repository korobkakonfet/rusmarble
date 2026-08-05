/** @file Template overlay for the alliance Headquarters (HQ) canvas.
 *
 * The HQ canvas is not part of the MapLibre map, so the usual tile-hooking
 * pipeline (see templateManager.js) does not apply here. The HQ modal renders
 * its artwork into plain DOM canvases inside an `.artboard-frame` element that
 * already carries the pan/zoom transform, so the overlay is appended into that
 * frame and inherits the transform for free.
 *
 * Layout the wplace client produces (class hashes omitted):
 *   div[role=application].stage            <- pan/zoom viewport, fixed size
 *     div.artboard-frame                   <- transform: translate(...), width = size * scale
 *       div.hq-tile-layer                  <- one 64x64 canvas per HQ tile
 *       svg.pixel-grid  (viewBox 0 0 N N)  <- N is the HQ canvas size
 *       canvas (N x N)                     <- pending/preview pixels
 *
 * The canvas size is one of 250/500/750/1000/1500/2000 and can be expanded by
 * the alliance at any time, so everything here is derived from the DOM instead
 * of being hardcoded.
 * @since 0.87.70
 */

import { convertImageDataToWplacePalette } from './templatePaletteConversion.js';
import { consoleLog, consoleWarn, consoleError } from './utils.js';
import { getTemplateMaskPoints, getMaskDrawSize } from './templateMaskPoints.js';

const STORAGE_KEY = 'bmHqTemplates';
/** Above this many overlay sub-pixels a masked mode falls back to 1x, to keep
 * the canvas affordable. Only the visible window is ever drawn, so this is a
 * ceiling on a screenful, not on the whole template.
 */
const MAX_SHREAD_PIXELS = 6144 * 6144;
/** Draw size of the `cross` mode — same as the map overlay's `drawMult`, so the
 * 3x3 plus sits inside a 5x5 cell and neighbouring crosses keep a 1px gap.
 */
const CROSS_DRAW_SIZE = 5;
/** Template pixels of slack rendered outside the stage, so panning does not
 * re-rasterise on every frame — only when the view leaves the drawn window.
 */
const VIEWPORT_PAD = 96;
/** Alpha used when the HQ is zoomed out too far for real dots to survive downscaling. */
const DOT_FALLBACK_ALPHA = 96;
/** Display modes offered for the HQ overlay, and the mask shape each one draws. */
const HQ_MODE_SHAPES = {
  dots: 'dot',
  cross: 'cross',
  'cross-z-9': 'cross-z-9',
  full: null,
  wrong: null,
};
const HQ_MODES = Object.keys(HQ_MODE_SHAPES);
/** How often the rendered HQ zoom is sampled (transform changes are not observable). */
const FRAME_SCALE_POLL_MS = 250;
const HQ_TILE_SIZE = 64;
const PROGRESS_REFRESH_MS = 4000;
/** Templates larger than this are only diffed when the user asks for it. */
const AUTO_PROGRESS_MAX_PIXELS = 512 * 512;
const ATTACH_RETRY_MS = 400;
/** Remote template pre-filled in the import box. */
const DEFAULT_REMOTE_TEMPLATE = 'gsh';
/** One-click zoom levels (in percent) offered under the headquarters canvas. */
const ZOOM_PRESETS = [200, 500, 700, 1000];
/** How close (relative) the measured zoom must get to the requested one. */
const ZOOM_TOLERANCE = 0.02;
/** Safety net for the wheel-stepping loop. */
const ZOOM_MAX_STEPS = 24;
/** Initial guess for "log-zoom change per wheel delta unit"; refined at runtime. */
const ZOOM_RATE_GUESS = 0.0025;
const ZOOM_MAX_DELTA = 600;

const STRINGS = {
  en: {
    title: 'HQ template',
    load: 'Load image',
    replace: 'Replace image',
    remove: 'Remove',
    enabled: 'Show overlay',
    mode: 'Display',
    'mode.dots': 'Dots (3x)',
    'mode.cross': 'Cross (5x)',
    'mode.cross-z-9': 'Cross (Z, 9x9)',
    'mode.full': 'Full color',
    'mode.wrong': 'Wrong pixels only',
    opacity: 'Opacity',
    dither: 'Dither (Floyd-Steinberg)',
    remote: 'Remote template',
    remoteImport: 'Import',
    remoteImporting: 'Importing "{name}"…',
    remoteFailed: 'Failed to import "{name}".',
    remoteMissing: 'Enter a remote template name.',
    empty: 'No templates loaded for this headquarters.',
    size: 'Size: {w} x {h}',
    progress: 'Painted {done}/{total} ({percent}%) · wrong {wrong}',
    progressUnavailable: 'Progress unavailable (canvas not readable)',
    refresh: 'Refresh progress',
    zoom: 'Zoom',
    zoomFailed: 'Could not change the headquarters zoom.',
    loadFailed: 'Failed to load image.',
    tooBig: 'Image is larger than the {w} x {h} headquarters canvas.',
    pick: 'Middle click picks the template colour',
    pickLocked: 'Colour "{name}" is not unlocked.',
    pickUnknown: 'No palette colour matches this template pixel.',
    add: 'Add image',
    layers: 'Templates',
    move: 'Move mode',
    moveHint: 'Drag a template on the canvas to move it',
  },
  ru: {
    title: 'Шаблон штаба',
    load: 'Загрузить картинку',
    replace: 'Заменить картинку',
    remove: 'Удалить',
    enabled: 'Показывать оверлей',
    mode: 'Отображение',
    'mode.dots': 'Точки (3x)',
    'mode.cross': 'Крест (5x)',
    'mode.cross-z-9': 'Крест (Z, 9x9)',
    'mode.full': 'Полный цвет',
    'mode.wrong': 'Только неверные',
    opacity: 'Прозрачность',
    dither: 'Дизеринг (Floyd-Steinberg)',
    remote: 'Шаблон с сервера',
    remoteImport: 'Импорт',
    remoteImporting: 'Импорт «{name}»…',
    remoteFailed: 'Не удалось импортировать «{name}».',
    remoteMissing: 'Укажите имя шаблона с сервера.',
    empty: 'Для этого штаба шаблоны не загружены.',
    size: 'Размер: {w} x {h}',
    progress: 'Закрашено {done}/{total} ({percent}%) · неверных {wrong}',
    progressUnavailable: 'Прогресс недоступен (холст не читается)',
    refresh: 'Обновить прогресс',
    zoom: 'Масштаб',
    zoomFailed: 'Не удалось изменить масштаб штаба.',
    loadFailed: 'Не удалось загрузить картинку.',
    tooBig: 'Картинка больше холста штаба {w} x {h}.',
    pick: 'Средняя кнопка мыши берёт цвет шаблона',
    pickLocked: 'Цвет «{name}» не открыт.',
    pickUnknown: 'В палитре нет цвета этого пикселя шаблона.',
    add: 'Добавить картинку',
    layers: 'Шаблоны',
    move: 'Режим перемещения',
    moveHint: 'Перетащите шаблон мышью по холсту',
  },
};

const interpolate = (text, params) => String(text).replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? ''));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toInt = (value, fallback = 0) => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Reads the HQ canvas dimensions out of the rendered artboard.
 * Headquarters canvases are not necessarily square (banners are 384 x 128), so
 * width and height are tracked separately.
 * @param {HTMLElement} frame - The `.artboard-frame` element.
 * @returns {{width: number, height: number}|null} The canvas size in HQ pixels, or `null` when it cannot be determined.
 */
function readCanvasDims(frame) {
  const grid = frame.querySelector('svg.pixel-grid');
  const viewBox = grid?.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/\s+/);
    const width = toInt(parts[2], 0);
    const height = toInt(parts[3], 0);
    if (width > 0 && height > 0) return { width, height };
  }
  // Fallback: the preview canvas is a direct child sized 1:1 with the artboard.
  for (const canvas of frame.children) {
    if (canvas.tagName !== 'CANVAS') continue;
    if (canvas.classList.contains('bm-hq-overlay')) continue; // our own overlay
    const width = toInt(canvas.getAttribute('width'), 0);
    const height = toInt(canvas.getAttribute('height'), 0);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

/** Builds a stable storage key for the currently open headquarters.
 * There is no alliance id in the DOM, so the alliance name plus the map anchor
 * (which is unique per alliance) is used instead.
 * @param {HTMLElement} stage - The HQ stage element.
 * @returns {string} The storage key.
 */
function readHqKey(stage) {
  const modal = stage.closest('.modal-box') || document;
  const idFromUrl = /\/alliances?\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];
  if (idFromUrl) return `alliance:${idFromUrl}`;

  const headings = Array.from(modal.querySelectorAll('h3, h2'))
    .map((node) => node.textContent.trim())
    .filter(Boolean);
  const anchor = Array.from(modal.querySelectorAll('button'))
    .map((node) => node.textContent.trim())
    .find((text) => /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(text)) || '';
  return `hq:${headings.join('|')}|${anchor}`;
}

/** Converts an image file into palette-snapped image data.
 * @param {File} file - The image file the user picked.
 * @param {boolean} dither - Whether to apply Floyd-Steinberg dithering.
 * @returns {Promise<ImageData>} The palette-converted image data.
 */
async function fileToPaletteImageData(file, dither) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const converted = convertImageDataToWplacePalette(imageData, {
      ditherMode: dither ? 'floyd-steinberg' : 'none',
    });
    return converted.imageData;
  } finally {
    bitmap.close?.();
  }
}

/** Serialises image data to a PNG data URL for persistence.
 * @param {ImageData} imageData - The image data to encode.
 * @returns {Promise<string>} A `data:image/png;base64,…` URL.
 */
async function imageDataToDataUrl(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Decodes a stored PNG data URL back into image data.
 * @param {string} dataUrl - The stored data URL.
 * @returns {Promise<ImageData>} The decoded image data.
 */
async function dataUrlToImageData(dataUrl) {
  const response = await fetch(dataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

/** Reads the painted HQ artwork back out of the tile canvases.
 * @param {HTMLElement} frame - The `.artboard-frame` element.
 * @param {number} canvasWidth - The HQ canvas width in pixels.
 * @param {{x: number, y: number, width: number, height: number}} region - Region of interest.
 * @returns {ImageData|null} Image data for `region`, or `null` when the canvases cannot be read.
 */
function readHqRegion(frame, canvasWidth, region) {
  const tiles = frame.querySelectorAll('.hq-tile-layer canvas');
  if (!tiles.length) return null;

  const frameWidth = frame.getBoundingClientRect().width;
  if (!(frameWidth > 0)) return null;
  const scale = frameWidth / canvasWidth; // CSS px per HQ pixel

  const output = new OffscreenCanvas(region.width, region.height);
  const outputContext = output.getContext('2d', { willReadFrequently: true });
  outputContext.imageSmoothingEnabled = false;

  let drewAny = false;
  for (const tile of tiles) {
    const left = Number.parseFloat(tile.style.left);
    const top = Number.parseFloat(tile.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
    const tileX = Math.round(left / scale);
    const tileY = Math.round(top / scale);
    const tileWidth = toInt(tile.getAttribute('width'), HQ_TILE_SIZE);
    const tileHeight = toInt(tile.getAttribute('height'), HQ_TILE_SIZE);

    if (tileX + tileWidth <= region.x || tileX >= region.x + region.width) continue;
    if (tileY + tileHeight <= region.y || tileY >= region.y + region.height) continue;

    outputContext.drawImage(tile, tileX - region.x, tileY - region.y);
    drewAny = true;
  }
  if (!drewAny) return null;

  try {
    return outputContext.getImageData(0, 0, region.width, region.height);
  } catch (error) {
    consoleWarn('[hq] headquarters canvas is not readable', error);
    return null;
  }
}

/** Creates the headquarters template overlay manager.
 * @param {Object} [params] - The parameters object.
 * @param {function(): string} [params.getLanguage] - Returns the current UI language code.
 * @param {Object} [params.remote] - Adapter over the template sync backend.
 * @param {function(): Promise<Array<{name: string, stream: string}>>} [params.remote.listEntries] - Lists remote templates for autocomplete.
 * @param {function(string, string=): Promise<File>} [params.remote.fetchFile] - Downloads a remote template image.
 * @returns {{destroy: function(): void, refresh: function(): void}} The manager handle.
 */
export function createHqTemplateManager({ getLanguage = () => 'en', remote = null } = {}) {
  const t = (key, params) => {
    const dictionary = STRINGS[String(getLanguage?.() ?? 'en')] || STRINGS.en;
    return interpolate(dictionary[key] ?? STRINGS.en[key] ?? key, params);
  };

  /** @typedef {Object} HqLayer
   * @property {string} id - Stable identifier, also used as the overlay canvas key.
   * @property {string} name - Display name (the source file or remote template name).
   * @property {string} dataUrl - Palette-converted pixels, as a PNG data URL.
   * @property {number} width - Template width in HQ pixels.
   * @property {number} height - Template height in HQ pixels.
   * @property {number} x - Template origin on the HQ canvas.
   * @property {number} y - Template origin on the HQ canvas.
   * @property {boolean} enabled - Whether the overlay is drawn.
   * @property {string} mode - Display mode, one of `HQ_MODES`.
   * @property {number} opacity - Overlay opacity, 0..1.
   * @property {boolean} dither - Whether the image was dithered on import.
   */

  /** @type {Object<string, {layers: Array<HqLayer>, activeId: string|null}>} Persisted per headquarters. */
  let records = {};
  let recordsLoaded = false;
  /** @type {Map<string, ImageData>} Decoded pixels, keyed by layer id. */
  const layerImages = new Map();
  /** @type {string|null} Key of the headquarters currently on screen. */
  let activeKey = null;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let progressTimerId = null;
  let attachTimerId = null;
  let message = '';
  /** @type {Array<{name: string, stream: string}>|null} Cached remote template list for autocomplete. */
  let remoteEntries = null;
  let remoteNamesInFlight = false;
  /** @type {{total: number, done: number, wrong: number}|null} Progress of the active layer. */
  let progress = null;
  /** @type {Uint8Array|null} 1 byte per pixel of the active layer: 0 = ok/empty, 1 = mismatch. */
  let wrongMask = null;
  /** Measured log-zoom change per wheel delta unit; refined on every zoom step. */
  let zoomRate = ZOOM_RATE_GUESS;
  let zoomInFlight = false;
  let scaleTimerId = null;
  /** @type {Map<string, {signature: string, window: {x: number, y: number, width: number, height: number}}>}
   * What is currently rasterised per layer, so unchanged layers are not redrawn.
   */
  const renderCache = new Map();
  let renderQueued = false;
  /** Last observed frame geometry, used to detect pan/zoom. */
  let lastFrameGeometry = '';
  /** Whether left-dragging the canvas moves a template instead of painting. */
  let moveMode = false;
  /** @type {{id: string, pointerId: number, clientX: number, clientY: number, originX: number, originY: number}|null} */
  let dragState = null;

  const dom = {
    stage: null,
    frame: null,
    /** @type {Map<string, HTMLCanvasElement>} Overlay canvases, keyed by layer id. */
    overlays: new Map(),
    panel: null,
    controls: null,
  };

  const newLayerId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  /** @returns {{layers: Array<HqLayer>, activeId: string|null}|null} The bundle of the open headquarters. */
  const getBundle = () => (activeKey ? records[activeKey] || null : null);

  /** @returns {Array<HqLayer>} Layers of the open headquarters, bottom-most first. */
  const getLayers = () => getBundle()?.layers ?? [];

  /** @returns {HqLayer|null} The layer the panel controls act on. */
  function getActiveLayer() {
    const bundle = getBundle();
    if (!bundle?.layers?.length) return null;
    return bundle.layers.find((layer) => layer.id === bundle.activeId) ?? bundle.layers[0];
  }

  /** @param {HqLayer} layer - The layer.
   * @returns {ImageData|null} Its decoded pixels, when loaded.
   */
  const imageOf = (layer) => (layer ? layerImages.get(layer.id) ?? null : null);

  /** Ensures a bundle exists for the open headquarters.
   * @returns {{layers: Array<HqLayer>, activeId: string|null}} The bundle.
   */
  function ensureBundle() {
    if (!records[activeKey]) records[activeKey] = { layers: [], activeId: null };
    return records[activeKey];
  }

  /** Upgrades the pre-multi-layer storage shape (one template per headquarters).
   * @param {Object} parsed - The raw parsed storage payload.
   * @returns {Object<string, {layers: Array<HqLayer>, activeId: string|null}>} Normalised records.
   */
  function migrateRecords(parsed) {
    const result = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value.layers)) {
        result[key] = { layers: value.layers, activeId: value.activeId ?? value.layers[0]?.id ?? null };
        continue;
      }
      if (!value.dataUrl) continue;
      const layer = { ...value, id: value.id ?? newLayerId(), name: value.name || 'template' };
      result[key] = { layers: [layer], activeId: layer.id };
    }
    return result;
  }

  async function loadRecords() {
    if (recordsLoaded) return;
    recordsLoaded = true;
    try {
      const raw = await GM.getValue(STORAGE_KEY, '{}');
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object') records = migrateRecords(parsed);
    } catch (error) {
      consoleWarn('[hq] failed to read stored headquarters templates', error);
      records = {};
    }
  }

  async function saveRecords() {
    try {
      await GM.setValue(STORAGE_KEY, JSON.stringify(records));
    } catch (error) {
      consoleError('[hq] failed to persist headquarters templates', error);
    }
  }

  // ---------------------------------------------------------------- rendering

  /** Recomputes how much of the active layer is already painted on the HQ canvas. */
  function computeProgress() {
    const layer = getActiveLayer();
    const image = imageOf(layer);
    if (!layer || !image || !dom.frame) {
      progress = null;
      wrongMask = null;
      return;
    }

    const { width, height } = image;
    const region = { x: layer.x, y: layer.y, width, height };
    const painted = readHqRegion(dom.frame, canvasWidth, region);
    if (!painted) {
      progress = null;
      wrongMask = null;
      return;
    }

    const template = image.data;
    const actual = painted.data;
    const mask = new Uint8Array(width * height);
    let total = 0;
    let done = 0;
    let wrong = 0;

    for (let index = 0; index < mask.length; index++) {
      const base = index * 4;
      if (template[base + 3] < 128) continue; // Transparent template pixels are "don't care"
      total++;
      const matches = actual[base + 3] >= 128
        && actual[base] === template[base]
        && actual[base + 1] === template[base + 1]
        && actual[base + 2] === template[base + 2];
      if (matches) {
        done++;
      } else {
        wrong++;
        mask[index] = 1;
      }
    }

    progress = { total, done, wrong };
    wrongMask = mask;
    // The mask contents changed, so a cached "wrong pixels" raster is stale.
    if (layer.mode === 'wrong') renderCache.delete(layer.id);
  }

  /** Returns the layer pixels currently inside the visible part of the stage.
   * Masked modes blow the overlay canvas up 5x per axis, so rendering a whole
   * layer is not affordable on a 2000 x 2000 headquarters — only the visible
   * window is drawn, and it is re-rendered when the user pans or zooms out of it.
   * @param {HqLayer} layer - The layer being drawn.
   * @param {number} width - Layer width in HQ pixels.
   * @param {number} height - Layer height in HQ pixels.
   * @param {{frameRect: DOMRect, stageRect: DOMRect, scale: number}} view - Measured stage geometry.
   * @param {number} pad - Extra pixels rendered outside the stage.
   * @returns {{x: number, y: number, width: number, height: number}|null} Region in layer-local coordinates, or `null` when off-screen.
   */
  function visibleTemplateRegion(layer, width, height, view, pad) {
    const { frameRect, stageRect, scale } = view;
    if (!stageRect || !(scale > 0)) return { x: 0, y: 0, width, height };

    const left = Math.floor((stageRect.left - frameRect.left) / scale) - layer.x - pad;
    const top = Math.floor((stageRect.top - frameRect.top) / scale) - layer.y - pad;
    const right = Math.ceil((stageRect.right - frameRect.left) / scale) - layer.x + pad;
    const bottom = Math.ceil((stageRect.bottom - frameRect.top) / scale) - layer.y + pad;

    const x = clamp(left, 0, width);
    const y = clamp(top, 0, height);
    const regionWidth = clamp(right, 0, width) - x;
    const regionHeight = clamp(bottom, 0, height) - y;
    if (regionWidth <= 0 || regionHeight <= 0) return null;
    return { x, y, width: regionWidth, height: regionHeight };
  }

  /** @returns {boolean} Whether `outer` fully contains `inner`. */
  const covers = (outer, inner) => outer
    && outer.x <= inner.x && outer.y <= inner.y
    && outer.x + outer.width >= inner.x + inner.width
    && outer.y + outer.height >= inner.y + inner.height;

  /** Redraws one layer's overlay canvas.
   * @param {HqLayer} layer - The layer to draw.
   * @param {{frameRect: DOMRect, stageRect: DOMRect, scale: number}} view - Measured stage geometry, shared by all layers.
   */
  function renderLayer(layer, view) {
    const image = imageOf(layer);
    if (!dom.frame || !image || !layer.enabled) {
      hideOverlay(layer.id);
      return;
    }

    const { width, height } = image;
    const mode = HQ_MODES.includes(layer.mode) ? layer.mode : 'dots';
    const shape = HQ_MODE_SHAPES[mode]; // null for the "solid pixel" modes

    // A scaled-up mask only reads as dots/crosses while the HQ is zoomed in far
    // enough that each sub-pixel owns at least one screen pixel. Below that the
    // browser downsamples it — with `image-rendering: pixelated` that is nearest
    // sampling, which lands on a painted sub-pixel and shows solid colour.
    const wanted = shape ? getMaskDrawSize(shape, CROSS_DRAW_SIZE) : 1;
    const needed = shape ? visibleTemplateRegion(layer, width, height, view, 0) : { x: 0, y: 0, width, height };
    if (!needed) {
      hideOverlay(layer.id);
      return;
    }

    const fits = view.scale >= wanted && needed.width * needed.height * wanted * wanted <= MAX_SHREAD_PIXELS;
    const scale = shape && fits ? wanted : 1;
    // Zoomed-out masked modes: paint every pixel, but translucent, so the
    // artwork underneath stays readable instead of being covered in solid colour.
    const alpha = shape && !fits ? DOT_FALLBACK_ALPHA : 255;

    const isActive = layer.id === getActiveLayer()?.id;
    if (mode === 'wrong' && isActive && !wrongMask) computeProgress();
    const mask = mode === 'wrong' && isActive ? wrongMask : null;

    // Everything except the window that is drawn. When only the window changed,
    // an already-rendered canvas that still covers the viewport is reused as-is,
    // which is what keeps panning and dragging cheap.
    const signature = [mode, scale, alpha, mask ? 'w' : '-'].join(':');
    const cached = renderCache.get(layer.id);
    const reusable = cached && cached.signature === signature && covers(cached.window, needed);

    const drawn = reusable ? cached.window
      : (scale > 1 ? visibleTemplateRegion(layer, width, height, view, VIEWPORT_PAD) : { x: 0, y: 0, width, height });
    if (!drawn) {
      hideOverlay(layer.id);
      return;
    }

    // A canvas recreated by `ensureOverlayCanvas` drops its cache entry, so this
    // also covers Svelte wiping the artboard from under us.
    const overlay = ensureOverlayCanvas(layer.id);
    if (!reusable) {
      renderCache.set(layer.id, { signature, window: drawn });
      rasterize(overlay, image, { mode, scale, alpha, mask, shape, drawn });
    }

    // The frame is laid out at the canvas aspect ratio, so each axis is measured
    // against its own dimension — HQ canvases are not always square.
    const percentX = (value) => `${(value / canvasWidth) * 100}%`;
    const percentY = (value) => `${(value / canvasHeight) * 100}%`;
    overlay.style.display = '';
    overlay.style.left = percentX(layer.x + drawn.x);
    overlay.style.top = percentY(layer.y + drawn.y);
    overlay.style.width = percentX(drawn.width);
    overlay.style.height = percentY(drawn.height);
    overlay.style.opacity = String(clamp(Number(layer.opacity) || 1, 0, 1));
  }

  /** Paints one window of a layer into its overlay canvas.
   * @param {HTMLCanvasElement} overlay - The layer's canvas.
   * @param {ImageData} image - The layer pixels.
   * @param {Object} options - Render options.
   * @param {string} options.mode - Display mode.
   * @param {number} options.scale - Sub-pixel enlargement factor.
   * @param {number} options.alpha - Alpha of painted sub-pixels.
   * @param {Uint8Array|null} options.mask - Wrong-pixel mask, when in `wrong` mode.
   * @param {string|null} options.shape - Mask shape name, or `null` for solid pixels.
   * @param {{x: number, y: number, width: number, height: number}} options.drawn - The window to paint.
   */
  function rasterize(overlay, image, { mode, scale, alpha, mask, shape, drawn }) {
    const targetWidth = drawn.width * scale;
    const targetHeight = drawn.height * scale;
    const context = overlay.getContext('2d');
    if (overlay.width !== targetWidth || overlay.height !== targetHeight) {
      overlay.width = targetWidth;
      overlay.height = targetHeight;
    }

    // `putImageData` replaces the pixels it covers, so no clearRect is needed —
    // a fresh (zeroed) buffer is the clear.
    const output = context.createImageData(targetWidth, targetHeight);
    const target = output.data;
    const source = image.data;
    const width = image.width;

    // Flatten the mask into byte offsets once, instead of per template pixel.
    const points = scale > 1 ? getTemplateMaskPoints(shape, scale) : [[0, 0]];
    const offsets = new Int32Array(points.length);
    for (let index = 0; index < points.length; index++) {
      offsets[index] = (points[index][1] * targetWidth + points[index][0]) * 4;
    }

    for (let y = 0; y < drawn.height; y++) {
      const sourceRow = (y + drawn.y) * width + drawn.x;
      const targetRow = y * scale * targetWidth * 4;
      for (let x = 0; x < drawn.width; x++) {
        const sourceIndex = (sourceRow + x) * 4;
        if (source[sourceIndex + 3] < 128) continue;
        if (mode === 'wrong' && mask && !mask[sourceRow + x]) continue;

        const red = source[sourceIndex];
        const green = source[sourceIndex + 1];
        const blue = source[sourceIndex + 2];
        const base = targetRow + x * scale * 4;
        for (let index = 0; index < offsets.length; index++) {
          const targetIndex = base + offsets[index];
          target[targetIndex] = red;
          target[targetIndex + 1] = green;
          target[targetIndex + 2] = blue;
          target[targetIndex + 3] = alpha;
        }
      }
    }
    context.putImageData(output, 0, 0);
  }

  /** Redraws every layer and drops canvases of layers that no longer exist. */
  function renderOverlay() {
    renderQueued = false;
    if (!dom.frame?.isConnected) return;
    const layers = getLayers();
    const alive = new Set(layers.map((layer) => layer.id));
    for (const [id, canvas] of dom.overlays) {
      if (alive.has(id)) continue;
      canvas.remove();
      dom.overlays.delete(id);
      renderCache.delete(id);
    }
    if (!layers.length) return;

    // Measured once for the whole pass: `getBoundingClientRect` forces layout,
    // and every layer resolves against the same geometry anyway.
    const frameRect = dom.frame.getBoundingClientRect();
    const view = {
      frameRect,
      stageRect: dom.stage?.getBoundingClientRect() ?? null,
      scale: frameRect.width > 0 ? frameRect.width / (canvasWidth || 1) : 0,
    };
    // Drawn in array order, so later layers sit on top of earlier ones.
    for (const layer of layers) renderLayer(layer, view);
  }

  /** Coalesces redraws into the next animation frame.
   * Pointer moves and the geometry poll can both fire several times per frame;
   * rasterising once per frame is enough and keeps dragging smooth.
   */
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      if (renderQueued) renderOverlay();
    });
  }

  function hideOverlay(id) {
    const canvas = dom.overlays.get(id);
    if (canvas) canvas.style.display = 'none';
    renderCache.delete(id);
  }

  /** Ensures a layer's overlay canvas exists inside the artboard frame (it survives Svelte re-renders).
   * @param {string} id - The layer id.
   * @returns {HTMLCanvasElement} The overlay canvas.
   */
  function ensureOverlayCanvas(id) {
    const existing = dom.overlays.get(id);
    if (existing?.isConnected && existing.parentElement === dom.frame) return existing;
    const canvas = document.createElement('canvas');
    canvas.className = 'bm-hq-overlay';
    dom.frame.appendChild(canvas);
    dom.overlays.set(id, canvas);
    renderCache.delete(id); // A fresh canvas is blank whatever we drew before.
    return canvas;
  }

  /** Removes every overlay canvas from the artboard. */
  function clearOverlays() {
    for (const canvas of dom.overlays.values()) canvas.remove();
    dom.overlays.clear();
    renderCache.clear();
  }

  // ------------------------------------------------------------ colour picker

  /** Maps a pointer event to the HQ pixel underneath it.
   * The artboard frame is transformed by wplace's pan/zoom, so its bounding rect
   * already encodes both — no need to read the transform.
   * @param {PointerEvent|MouseEvent} event - The pointer event.
   * @returns {{x: number, y: number}|null} HQ pixel coordinates, or `null` when outside the canvas.
   */
  function eventToHqPixel(event) {
    if (!dom.frame?.isConnected || !canvasWidth || !canvasHeight) return null;
    const rect = dom.frame.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const x = Math.floor((event.clientX - rect.left) / (rect.width / canvasWidth));
    const y = Math.floor((event.clientY - rect.top) / (rect.height / canvasHeight));
    if (x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return null;
    return { x, y };
  }

  /** Finds the top-most enabled layer covering an HQ pixel.
   * @param {number} x - HQ pixel x.
   * @param {number} y - HQ pixel y.
   * @param {boolean} [opaqueOnly=false] - Require the layer pixel itself to be opaque.
   * @returns {HqLayer|null} The layer, or `null` when none covers the pixel.
   */
  function layerAt(x, y, opaqueOnly = false) {
    const layers = getLayers();
    for (let index = layers.length - 1; index >= 0; index--) {
      const layer = layers[index];
      if (!layer.enabled) continue;
      const image = imageOf(layer);
      if (!image) continue;
      const localX = x - layer.x;
      const localY = y - layer.y;
      if (localX < 0 || localY < 0 || localX >= image.width || localY >= image.height) continue;
      if (opaqueOnly && image.data[(localY * image.width + localX) * 4 + 3] < 128) continue;
      return layer;
    }
    return null;
  }

  /** Reads the template colour at an HQ pixel, from the top-most layer covering it.
   * @param {number} x - HQ pixel x.
   * @param {number} y - HQ pixel y.
   * @returns {{r: number, g: number, b: number}|null} The colour, or `null` when no template covers the pixel.
   */
  function templateColorAt(x, y) {
    const layer = layerAt(x, y, true);
    const image = imageOf(layer);
    if (!image) return null;
    const base = ((y - layer.y) * image.width + (x - layer.x)) * 4;
    const data = image.data;
    return { r: data[base], g: data[base + 1], b: data[base + 2] };
  }

  /** Collects the wplace palette swatches of the open paint session.
   * They are plain buttons carrying their colour as an inline background, so the
   * selection can be driven by clicking one — no access to Svelte state needed.
   * @returns {Array<{button: HTMLElement, rgb: Array<number>, locked: boolean, label: string}>} The swatches (empty when no palette is open).
   */
  function readPalette() {
    const root = dom.stage?.closest('.modal-box') || document;
    const swatches = [];
    for (const button of root.querySelectorAll('button[aria-pressed][aria-label]')) {
      const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(button).backgroundColor);
      if (!match) continue;
      if (!button.classList.contains('aspect-square')) continue;
      swatches.push({
        button,
        rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
        // Locked colours carry a small lock badge and open the store when clicked.
        locked: Boolean(button.querySelector('span[class*="absolute"]')),
        label: button.getAttribute('aria-label') || '',
      });
    }
    return swatches;
  }

  /** Selects the palette colour of the template pixel under the pointer.
   * wplace's own picker only samples its native alliance overlay, so it always
   * misses this overlay; this reimplements it against the loaded template.
   * @param {PointerEvent|MouseEvent} event - The middle-click event.
   * @returns {boolean} `true` when the event was handled and must not reach wplace.
   */
  function pickTemplateColor(event) {
    const pixel = eventToHqPixel(event);
    if (!pixel) return false;
    const color = templateColorAt(pixel.x, pixel.y);
    if (!color) return false;

    const swatches = readPalette();
    if (!swatches.length) return false; // No paint session open — leave middle-drag panning alone.

    const swatch = swatches.find((entry) => entry.rgb[0] === color.r && entry.rgb[1] === color.g && entry.rgb[2] === color.b);
    if (!swatch) {
      setMessage(t('pickUnknown'));
      return true;
    }
    if (swatch.locked) {
      setMessage(t('pickLocked', { name: swatch.label }));
      return true;
    }
    setMessage('');
    swatch.button.click();
    return true;
  }

  const eventOverStage = (event) => Boolean(dom.stage?.isConnected) && dom.stage.contains(event.target);

  // Bound on `document` in the capture phase: wplace listens on the stage itself,
  // so an ancestor capture listener is the only way to run first and swallow the
  // event before its own (template-less) picker sees it.
  function handleDocumentPointerDown(event) {
    if (startDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.button !== 1 || !eventOverStage(event)) return;
    if (!pickTemplateColor(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  /** Suppresses the browser's middle-click autoscroll over the artboard. */
  function handleDocumentMouseDown(event) {
    // Only swallowed once a drag actually started, so clicks that miss every
    // template still reach wplace.
    if (dragState && event.button === 0) event.preventDefault();
    if (event.button === 1 && eventOverStage(event) && eventToHqPixel(event)) event.preventDefault();
  }

  // -------------------------------------------------------------------- drag

  /** Starts dragging the template under the pointer.
   * Only active while move mode is on, so a normal left click still paints.
   * @param {PointerEvent} event - The pointer event.
   * @returns {boolean} `true` when a drag started and the event must not reach wplace.
   */
  function startDrag(event) {
    if (!moveMode || event.button !== 0 || !eventOverStage(event)) return false;
    const pixel = eventToHqPixel(event);
    if (!pixel) return false;
    // Prefer the layer whose artwork is under the cursor, else any layer whose
    // bounding box is — dragging by a transparent corner still feels natural.
    const layer = layerAt(pixel.x, pixel.y, true) || layerAt(pixel.x, pixel.y);
    if (!layer) return false;

    dragState = {
      id: layer.id,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      originX: layer.x,
      originY: layer.y,
    };
    setActiveLayer(layer.id);
    return true;
  }

  /** Applies the pointer movement to the dragged layer.
   * @param {PointerEvent} event - The pointer event.
   */
  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const layer = getLayers().find((entry) => entry.id === dragState.id);
    const image = imageOf(layer);
    if (!layer || !image) return;
    const rect = dom.frame?.getBoundingClientRect();
    const scale = rect?.width ? rect.width / canvasWidth : 0;
    if (!(scale > 0)) return;

    layer.x = clamp(dragState.originX + Math.round((event.clientX - dragState.clientX) / scale), 0, Math.max(0, canvasWidth - image.width));
    layer.y = clamp(dragState.originY + Math.round((event.clientY - dragState.clientY) / scale), 0, Math.max(0, canvasHeight - image.height));
    // The mask stays valid in layer space; only the diff against the canvas is
    // stale, and that is recomputed once the drag ends.
    scheduleRender();
  }

  /** Ends the drag and persists the new position. */
  function endDrag() {
    if (!dragState) return;
    dragState = null;
    wrongMask = null;
    saveRecords();
    computeProgress();
    syncPanel();
    renderOverlay();
  }

  function handleDocumentPointerMove(event) {
    if (!dragState) return;
    event.preventDefault();
    event.stopPropagation();
    moveDrag(event);
  }

  function handleDocumentPointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    endDrag();
  }

  // -------------------------------------------------------------------- zoom

  /** Current zoom of the headquarters artboard.
   * The frame is laid out at `canvasWidth * scale` CSS pixels, so its rendered
   * width divided by the canvas width is exactly the percentage wplace shows.
   * @returns {number|null} Zoom in percent, or `null` when it cannot be measured.
   */
  function readZoomPercent() {
    if (!dom.frame?.isConnected || !canvasWidth) return null;
    const width = dom.frame.getBoundingClientRect().width;
    return width > 0 ? (width / canvasWidth) * 100 : null;
  }

  /** Feeds one wheel notch to the stage, anchored at its centre so the view keeps its focus.
   * @param {number} deltaY - Wheel delta; negative zooms in.
   */
  function sendWheel(deltaY) {
    const stage = dom.stage;
    if (!stage?.isConnected) return;
    const rect = stage.getBoundingClientRect();
    stage.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      composed: true,
      deltaY,
      deltaMode: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  /** Drives the wplace zoom to a target percentage.
   *
   * wplace owns the zoom state inside Svelte, so it cannot be assigned directly —
   * writing the transform would be reverted on the next re-render. Instead the
   * stage is fed synthetic wheel events and the resulting zoom is measured back
   * out of the DOM; the delta-to-zoom rate is calibrated from the first step, so
   * this keeps working if the client changes its zoom curve.
   * @param {number} target - Requested zoom in percent.
   */
  async function setZoomPercent(target) {
    if (zoomInFlight) return;
    zoomInFlight = true;
    try {
      let current = readZoomPercent();
      if (!current) {
        setMessage(t('zoomFailed'));
        return;
      }
      let stalled = 0;
      for (let step = 0; step < ZOOM_MAX_STEPS; step++) {
        const remaining = Math.log(target / current);
        if (Math.abs(remaining) <= ZOOM_TOLERANCE) break;
        // Wheel deltas are negative for zoom-in, hence the sign flip.
        const delta = clamp(-remaining / zoomRate, -ZOOM_MAX_DELTA, ZOOM_MAX_DELTA);
        sendWheel(delta);
        await nextFrame();
        const measured = readZoomPercent();
        if (!measured) {
          setMessage(t('zoomFailed'));
          return;
        }
        const achieved = Math.log(measured / current);
        if (Math.abs(achieved) < 1e-4) {
          if (++stalled >= 2) {
            // Either the client ignores wheel events or we are already at its limit.
            if (Math.abs(Math.log(target / measured)) > ZOOM_TOLERANCE) setMessage(t('zoomFailed'));
            return;
          }
        } else {
          stalled = 0;
          zoomRate = Math.abs(achieved / delta);
        }
        current = measured;
      }
      setMessage('');
    } finally {
      zoomInFlight = false;
      syncZoomLabel();
    }
  }

  /** Mirrors the measured zoom into the panel button row. */
  function syncZoomLabel() {
    const label = dom.controls?.zoomValue;
    if (!label) return;
    const percent = readZoomPercent();
    label.textContent = percent ? `${Math.round(percent)}%` : '';
  }

  // ---------------------------------------------------------------------- UI

  function setMessage(text) {
    message = text || '';
    if (dom.controls?.message) dom.controls.message.textContent = message;
  }

  /** Applies a partial change to the active layer, then persists and re-renders.
   * @param {Object} patch - The fields to change.
   */
  function updateLayer(patch) {
    const layer = getActiveLayer();
    if (!layer) return;
    Object.assign(layer, patch);
    saveRecords();
    syncPanel();
    renderOverlay();
  }

  /** Makes a layer the one the panel controls act on.
   * @param {string} id - The layer id.
   */
  function setActiveLayer(id) {
    const bundle = getBundle();
    if (!bundle || bundle.activeId === id) return;
    bundle.activeId = id;
    wrongMask = null;
    progress = null;
    saveRecords();
    computeProgress();
    syncPanel();
    renderOverlay();
  }

  async function handleFile(file) {
    if (!file || !activeKey) return;
    try {
      const dither = Boolean(dom.controls?.dither?.checked);
      const imageData = await fileToPaletteImageData(file, dither);
      if (imageData.width > canvasWidth || imageData.height > canvasHeight) {
        setMessage(t('tooBig', { w: canvasWidth, h: canvasHeight }));
        return;
      }
      const dataUrl = await imageDataToDataUrl(imageData);
      const previous = getActiveLayer();
      const layer = {
        id: newLayerId(),
        name: file.name || 'template',
        dataUrl,
        width: imageData.width,
        height: imageData.height,
        // New layers land on top of the previous one, which is easier to spot
        // than the origin when the headquarters is large.
        x: clamp(previous?.x ?? 0, 0, canvasWidth - imageData.width),
        y: clamp(previous?.y ?? 0, 0, canvasHeight - imageData.height),
        enabled: true,
        mode: previous?.mode ?? 'dots',
        opacity: previous?.opacity ?? 1,
        dither,
      };
      const bundle = ensureBundle();
      bundle.layers.push(layer);
      bundle.activeId = layer.id;
      layerImages.set(layer.id, imageData);
      wrongMask = null;
      progress = null;
      setMessage('');
      await saveRecords();
      computeProgress();
      syncPanel();
      renderOverlay();
      consoleLog(`[hq] added ${imageData.width}x${imageData.height} headquarters template`);
    } catch (error) {
      consoleError('[hq] failed to import headquarters template', error);
      setMessage(t('loadFailed'));
    }
  }

  /** Populates the autocomplete datalist from the sync backend (fetched once per session). */
  async function loadRemoteNames() {
    if (!remote?.listEntries || remoteEntries || remoteNamesInFlight) return;
    remoteNamesInFlight = true;
    try {
      remoteEntries = await remote.listEntries();
    } catch (error) {
      consoleWarn('[hq] failed to list remote templates', error);
      remoteEntries = [];
    } finally {
      remoteNamesInFlight = false;
      syncRemoteOptions();
    }
  }

  /** Mirrors the fetched remote names into the datalist element. */
  function syncRemoteOptions() {
    const list = dom.controls?.remoteList;
    if (!list) return;
    list.replaceChildren();
    for (const entry of remoteEntries ?? []) {
      const option = document.createElement('option');
      option.value = entry.name;
      if (entry.stream && entry.stream !== 'root') option.label = entry.stream;
      list.appendChild(option);
    }
  }

  /** Downloads a remote template by name and installs it as this headquarters' template. */
  async function importRemoteTemplate() {
    if (!remote?.fetchFile) return;
    const name = String(dom.controls?.remote?.value ?? '').trim();
    if (!name) {
      setMessage(t('remoteMissing'));
      return;
    }
    const stream = (remoteEntries ?? []).find((entry) => entry.name === name)?.stream;
    setMessage(t('remoteImporting', { name }));
    try {
      const file = await remote.fetchFile(name, stream);
      await handleFile(file);
    } catch (error) {
      consoleError('[hq] failed to import remote headquarters template', error);
      setMessage(t('remoteFailed', { name }));
    }
  }

  /** Removes a layer (the active one by default).
   * @param {string} [id] - The layer id.
   */
  function removeLayer(id) {
    const bundle = getBundle();
    const target = id ?? getActiveLayer()?.id;
    if (!bundle || !target) return;
    bundle.layers = bundle.layers.filter((layer) => layer.id !== target);
    layerImages.delete(target);
    if (bundle.activeId === target) bundle.activeId = bundle.layers.at(-1)?.id ?? null;
    if (!bundle.layers.length) delete records[activeKey];
    wrongMask = null;
    progress = null;
    saveRecords();
    computeProgress();
    syncPanel();
    renderOverlay();
  }

  /** Rebuilds the layer list. Kept simple (full rebuild) — a headquarters holds
   * a handful of templates at most.
   */
  function syncLayerList() {
    const list = dom.controls?.layerList;
    if (!list) return;
    const bundle = getBundle();
    const active = getActiveLayer();
    list.replaceChildren();

    for (const layer of bundle?.layers ?? []) {
      const row = document.createElement('div');
      row.className = 'bm-hq-inline';

      const select = document.createElement('input');
      select.type = 'radio';
      select.className = 'radio radio-xs';
      select.name = 'bm-hq-active-layer';
      select.checked = layer.id === active?.id;
      select.addEventListener('change', () => setActiveLayer(layer.id));

      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.className = 'checkbox checkbox-xs';
      enabled.checked = Boolean(layer.enabled);
      enabled.addEventListener('change', () => {
        layer.enabled = enabled.checked;
        saveRecords();
        renderOverlay();
      });

      const name = document.createElement('span');
      name.className = 'text-xs';
      name.textContent = layer.name;

      const size = document.createElement('span');
      size.className = 'text-base-content/55 text-xs';
      size.textContent = `${layer.width} x ${layer.height} @ ${layer.x},${layer.y}`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-xs btn-ghost text-error';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', t('remove'));
      remove.addEventListener('click', () => removeLayer(layer.id));

      row.append(select, enabled, name, size, remove);
      list.appendChild(row);
    }
  }

  /** Pushes the current state into the panel widgets. */
  function syncPanel() {
    const controls = dom.controls;
    if (!controls) return;
    const layer = getActiveLayer();
    const image = imageOf(layer);
    const hasTemplate = Boolean(layer && image);

    controls.body.style.display = hasTemplate ? '' : 'none';
    controls.layersLabel.style.display = hasTemplate ? '' : 'none';
    controls.empty.style.display = hasTemplate ? 'none' : '';
    controls.empty.textContent = t('empty');
    controls.message.textContent = message;
    controls.moveButton.setAttribute('aria-pressed', String(moveMode));
    controls.moveButton.classList.toggle('btn-active', moveMode);
    syncZoomLabel();
    syncLayerList();

    if (!hasTemplate) return;

    controls.size.textContent = t('size', { w: image.width, h: image.height });
    controls.enabled.checked = Boolean(layer.enabled);
    controls.mode.value = layer.mode || 'dots';
    controls.opacity.value = String(Math.round((Number(layer.opacity) || 1) * 100));

    if (progress) {
      const percent = progress.total ? Math.floor((progress.done / progress.total) * 1000) / 10 : 0;
      controls.progress.textContent = t('progress', {
        done: progress.done,
        total: progress.total,
        percent,
        wrong: progress.wrong,
      });
    } else {
      controls.progress.textContent = t('progressUnavailable');
    }
  }

  /** Builds the control panel that sits under the headquarters canvas.
   * @returns {HTMLElement} The panel element.
   */
  function buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'bm-hq-panel border-base-200 bg-base-100 mt-3 shrink-0 rounded-2xl border p-3';

    const header = document.createElement('div');
    header.className = 'bm-hq-row';
    const title = document.createElement('h4');
    title.className = 'font-semibold';
    title.textContent = t('title');
    header.appendChild(title);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'bm-hq-file';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      handleFile(file);
    });

    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.className = 'btn btn-sm btn-primary btn-soft';
    loadButton.textContent = t('add');
    loadButton.addEventListener('click', () => fileInput.click());

    // Move mode is a toggle rather than a modifier key: the HQ canvas is a paint
    // surface, so an accidental left-drag must never move a template silently.
    const moveButton = document.createElement('button');
    moveButton.type = 'button';
    moveButton.className = 'btn btn-sm btn-soft';
    moveButton.textContent = t('move');
    moveButton.setAttribute('aria-pressed', 'false');
    moveButton.title = t('moveHint');
    moveButton.addEventListener('click', () => {
      moveMode = !moveMode;
      if (dom.stage) dom.stage.style.cursor = moveMode ? 'move' : '';
      syncPanel();
    });

    const ditherLabel = document.createElement('label');
    ditherLabel.className = 'bm-hq-inline text-xs';
    const dither = document.createElement('input');
    dither.type = 'checkbox';
    dither.className = 'checkbox checkbox-xs';
    ditherLabel.append(dither, document.createTextNode(` ${t('dither')}`));

    const actions = document.createElement('div');
    actions.className = 'bm-hq-inline';
    actions.append(ditherLabel, moveButton, loadButton);
    header.appendChild(actions);

    // Remote import: a plain <datalist> gives native autocomplete inside the wplace modal.
    const remoteRow = document.createElement('div');
    remoteRow.className = 'bm-hq-inline mt-2';
    const remoteLabel = document.createElement('span');
    remoteLabel.className = 'text-sm';
    remoteLabel.textContent = `${t('remote')}:`;

    const remoteList = document.createElement('datalist');
    remoteList.id = 'bm-hq-remote-names';

    const remoteInput = document.createElement('input');
    remoteInput.type = 'text';
    remoteInput.className = 'input input-xs w-48';
    remoteInput.setAttribute('list', remoteList.id);
    remoteInput.setAttribute('autocomplete', 'off');
    remoteInput.value = DEFAULT_REMOTE_TEMPLATE;
    remoteInput.addEventListener('focus', loadRemoteNames);
    remoteInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        importRemoteTemplate();
      }
    });

    const remoteButton = document.createElement('button');
    remoteButton.type = 'button';
    remoteButton.className = 'btn btn-xs btn-soft';
    remoteButton.textContent = t('remoteImport');
    remoteButton.addEventListener('click', importRemoteTemplate);

    remoteRow.append(remoteLabel, remoteInput, remoteList, remoteButton);
    if (!remote?.fetchFile) remoteRow.style.display = 'none';

    // Zoom presets: wplace only exposes wheel/pinch zoom, which is unusable for
    // hitting a round percentage on a big canvas.
    const zoomRow = document.createElement('div');
    zoomRow.className = 'bm-hq-inline mt-2';
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'text-sm';
    zoomLabel.textContent = `${t('zoom')}:`;
    const zoomValue = document.createElement('span');
    zoomValue.className = 'text-base-content/55 text-xs';
    zoomRow.append(zoomLabel);
    for (const preset of ZOOM_PRESETS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs btn-soft';
      button.textContent = `${preset}%`;
      button.addEventListener('click', () => {
        setZoomPercent(preset).catch((error) => consoleWarn('[hq] zoom failed', error));
      });
      zoomRow.appendChild(button);
    }
    zoomRow.appendChild(zoomValue);

    const layersLabel = document.createElement('p');
    layersLabel.className = 'text-base-content/55 mt-2 text-xs';
    layersLabel.textContent = `${t('layers')}:`;

    const layerList = document.createElement('div');
    layerList.className = 'bm-hq-body';

    const empty = document.createElement('p');
    empty.className = 'text-base-content/55 mt-2 text-xs';
    empty.textContent = t('empty');

    const body = document.createElement('div');
    body.className = 'bm-hq-body mt-2';

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'bm-hq-inline text-sm';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.className = 'checkbox checkbox-sm';
    enabled.addEventListener('change', () => updateLayer({ enabled: enabled.checked }));
    enabledLabel.append(enabled, document.createTextNode(` ${t('enabled')}`));

    const modeLabel = document.createElement('label');
    modeLabel.className = 'bm-hq-inline text-sm';
    const mode = document.createElement('select');
    mode.className = 'select select-xs w-40';
    for (const value of HQ_MODES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(`mode.${value}`);
      mode.appendChild(option);
    }
    mode.addEventListener('change', () => {
      wrongMask = null;
      updateLayer({ mode: mode.value });
    });
    modeLabel.append(document.createTextNode(`${t('mode')} `), mode);

    const opacityLabel = document.createElement('label');
    opacityLabel.className = 'bm-hq-inline text-sm';
    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.min = '10';
    opacity.max = '100';
    opacity.className = 'range range-xs w-32';
    opacity.addEventListener('input', () => updateLayer({ opacity: Number(opacity.value) / 100 }));
    opacityLabel.append(document.createTextNode(`${t('opacity')} `), opacity);

    const size = document.createElement('span');
    size.className = 'text-base-content/55 text-xs';

    const progressText = document.createElement('span');
    progressText.className = 'text-base-content/70 text-xs';

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'btn btn-xs btn-ghost';
    refresh.textContent = t('refresh');
    refresh.addEventListener('click', () => {
      computeProgress();
      syncPanel();
      renderOverlay();
    });

    const statusRow = document.createElement('div');
    statusRow.className = 'bm-hq-inline';
    statusRow.append(size, progressText, refresh);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'bm-hq-inline';
    optionsRow.append(enabledLabel, modeLabel, opacityLabel);

    const pickHint = document.createElement('span');
    pickHint.className = 'text-base-content/55 text-xs';
    pickHint.textContent = t('pick');
    statusRow.appendChild(pickHint);

    body.append(optionsRow, statusRow);

    const messageNode = document.createElement('p');
    messageNode.className = 'text-error mt-2 text-xs';

    panel.append(header, remoteRow, zoomRow, empty, layersLabel, layerList, body, messageNode, fileInput);

    dom.controls = {
      loadButton,
      moveButton,
      layersLabel,
      layerList,
      body,
      empty,
      enabled,
      mode,
      opacity,
      size,
      progress: progressText,
      dither,
      remote: remoteInput,
      remoteList,
      zoomValue,
      message: messageNode,
    };
    return panel;
  }

  // ------------------------------------------------------------- attach/detach

  /** Locates the headquarters stage in the DOM.
   * @returns {HTMLElement|null} The stage element, or `null` when the HQ modal is closed.
   */
  function findStage() {
    const frame = document.querySelector('.artboard-frame');
    const stage = frame?.parentElement;
    return stage && frame ? stage : null;
  }

  async function attach(stage) {
    const frame = stage.querySelector('.artboard-frame');
    const dims = frame ? readCanvasDims(frame) : null;
    if (!frame || !dims) return;

    dom.stage = stage;
    dom.frame = frame;
    canvasWidth = dims.width;
    canvasHeight = dims.height;

    await loadRecords();
    const key = readHqKey(stage);
    if (key !== activeKey) {
      activeKey = key;
      layerImages.clear();
      clearOverlays();
      wrongMask = null;
      progress = null;
      message = '';
      for (const layer of getLayers()) {
        if (!layer.dataUrl) continue;
        try {
          layerImages.set(layer.id, await dataUrlToImageData(layer.dataUrl));
        } catch (error) {
          consoleWarn('[hq] failed to decode stored headquarters template', error);
        }
      }
    }

    // Layers saved for a smaller canvas may now hang off the edge after an expansion.
    let clamped = false;
    for (const layer of getLayers()) {
      const image = imageOf(layer);
      if (!image) continue;
      const maxX = Math.max(0, canvasWidth - image.width);
      const maxY = Math.max(0, canvasHeight - image.height);
      if (layer.x > maxX || layer.y > maxY) {
        layer.x = clamp(layer.x, 0, maxX);
        layer.y = clamp(layer.y, 0, maxY);
        clamped = true;
      }
    }
    if (clamped) saveRecords();

    if (!dom.panel?.isConnected) {
      dom.panel = buildPanel();
      stage.insertAdjacentElement('afterend', dom.panel);
    }

    if (moveMode) stage.style.cursor = 'move';
    // Zooming or panning the HQ moves the frame; both the mask scale and the
    // rendered window depend on it, so the overlays are redrawn when it changes.
    watchFrameScale();
    computeProgress();
    syncPanel();
    renderOverlay();

    if (progressTimerId === null) {
      progressTimerId = setInterval(() => {
        if (!dom.frame?.isConnected) return;
        if (!zoomInFlight) syncZoomLabel();
        const active = getActiveLayer();
        const image = imageOf(active);
        if (!image || dragState) return;
        // Big templates are only diffed on demand — a full re-read every tick is too costly.
        if (image.width * image.height > AUTO_PROGRESS_MAX_PIXELS) return;
        computeProgress();
        syncPanel();
        if (active.mode === 'wrong') renderOverlay();
      }, PROGRESS_REFRESH_MS);
    }
  }

  /** Watches the on-screen scale of the artboard frame and redraws on change.
   * wplace zooms the HQ with a CSS transform, which changes neither the layout
   * size nor any observable attribute, so `ResizeObserver` never fires — the
   * rendered scale has to be polled.
   */
  function watchFrameScale() {
    if (scaleTimerId !== null) return;
    scaleTimerId = setInterval(() => {
      if (!dom.frame?.isConnected || !canvasWidth) return;
      const rect = dom.frame.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      const geometry = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}`;
      if (geometry === lastFrameGeometry) return;
      lastFrameGeometry = geometry;
      // The render pass decides whether anything actually changed (mask scale or
      // visible window) and skips rasterising when it did not.
      scheduleRender();
    }, FRAME_SCALE_POLL_MS);
  }

  function detach() {
    if (scaleTimerId !== null) {
      clearInterval(scaleTimerId);
      scaleTimerId = null;
    }
    lastFrameGeometry = '';
    dragState = null;
    if (progressTimerId !== null) {
      clearInterval(progressTimerId);
      progressTimerId = null;
    }
    dom.panel?.remove();
    clearOverlays();
    if (dom.stage) dom.stage.style.cursor = '';
    dom.stage = null;
    dom.frame = null;
    dom.panel = null;
    dom.controls = null;
  }

  let syncQueued = false;
  let attachInFlight = false;
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      const stage = findStage();
      if (!stage) {
        if (dom.stage) detach();
        return;
      }
      if (attachInFlight) return;
      const overlaysMounted = dom.overlays.size > 0
        && [...dom.overlays.values()].every((canvas) => canvas.isConnected);
      if (stage !== dom.stage || !dom.panel?.isConnected || (!overlaysMounted && getLayers().length)) {
        if (dom.stage && stage !== dom.stage) detach();
        attachInFlight = true;
        attach(stage)
          .catch((error) => consoleError('[hq] failed to attach headquarters overlay', error))
          .finally(() => { attachInFlight = false; });
      }
    });
  }

  // Polled rather than observed: a MutationObserver over the whole body would fire
  // constantly while the map is panning, and a modal opening 400 ms "late" is invisible.
  attachTimerId = setInterval(scheduleSync, ATTACH_RETRY_MS);
  scheduleSync();

  document.addEventListener('pointerdown', handleDocumentPointerDown, true);
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
  document.addEventListener('pointermove', handleDocumentPointerMove, true);
  document.addEventListener('pointerup', handleDocumentPointerUp, true);
  document.addEventListener('pointercancel', handleDocumentPointerUp, true);

  return {
    destroy() {
      if (attachTimerId !== null) clearInterval(attachTimerId);
      attachTimerId = null;
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
      document.removeEventListener('pointermove', handleDocumentPointerMove, true);
      document.removeEventListener('pointerup', handleDocumentPointerUp, true);
      document.removeEventListener('pointercancel', handleDocumentPointerUp, true);
      detach();
    },
    refresh: scheduleSync,
  };
}
