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

const STORAGE_KEY = 'bmHqTemplates';
/** Scale factor used by the "dots" display mode (must be odd, same idea as the map overlay). */
const SHREAD_SIZE = 3;
/** Above this many overlay pixels the dots mode falls back to 1x to keep memory sane. */
const MAX_SHREAD_PIXELS = 4096 * 4096;
const HQ_TILE_SIZE = 64;
const PROGRESS_REFRESH_MS = 4000;
/** Templates larger than this are only diffed when the user asks for it. */
const AUTO_PROGRESS_MAX_PIXELS = 512 * 512;
const ATTACH_RETRY_MS = 400;
/** Remote template pre-filled in the import box. */
const DEFAULT_REMOTE_TEMPLATE = 'gsh';

const STRINGS = {
  en: {
    title: 'HQ template',
    load: 'Load image',
    replace: 'Replace image',
    remove: 'Remove',
    enabled: 'Show overlay',
    mode: 'Display',
    'mode.dots': 'Dots (3x)',
    'mode.full': 'Full color',
    'mode.wrong': 'Wrong pixels only',
    opacity: 'Opacity',
    dither: 'Dither (Floyd-Steinberg)',
    remote: 'Remote template',
    remoteImport: 'Import',
    remoteImporting: 'Importing "{name}"…',
    remoteFailed: 'Failed to import "{name}".',
    remoteMissing: 'Enter a remote template name.',
    empty: 'No template loaded for this headquarters.',
    size: 'Size: {w} x {h}',
    progress: 'Painted {done}/{total} ({percent}%) · wrong {wrong}',
    progressUnavailable: 'Progress unavailable (canvas not readable)',
    refresh: 'Refresh progress',
    loadFailed: 'Failed to load image.',
    tooBig: 'Image is larger than the {size} x {size} headquarters canvas.',
  },
  ru: {
    title: 'Шаблон штаба',
    load: 'Загрузить картинку',
    replace: 'Заменить картинку',
    remove: 'Удалить',
    enabled: 'Показывать оверлей',
    mode: 'Отображение',
    'mode.dots': 'Точки (3x)',
    'mode.full': 'Полный цвет',
    'mode.wrong': 'Только неверные',
    opacity: 'Прозрачность',
    dither: 'Дизеринг (Floyd-Steinberg)',
    remote: 'Шаблон с сервера',
    remoteImport: 'Импорт',
    remoteImporting: 'Импорт «{name}»…',
    remoteFailed: 'Не удалось импортировать «{name}».',
    remoteMissing: 'Укажите имя шаблона с сервера.',
    empty: 'Для этого штаба шаблон не загружен.',
    size: 'Размер: {w} x {h}',
    progress: 'Закрашено {done}/{total} ({percent}%) · неверных {wrong}',
    progressUnavailable: 'Прогресс недоступен (холст не читается)',
    refresh: 'Обновить прогресс',
    loadFailed: 'Не удалось загрузить картинку.',
    tooBig: 'Картинка больше холста штаба {size} x {size}.',
  },
};

const interpolate = (text, params) => String(text).replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? ''));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toInt = (value, fallback = 0) => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Reads the HQ canvas size (250…2000) out of the rendered artboard.
 * @param {HTMLElement} frame - The `.artboard-frame` element.
 * @returns {number|null} The canvas size in HQ pixels, or `null` when it cannot be determined.
 */
function readCanvasSize(frame) {
  const grid = frame.querySelector('svg.pixel-grid');
  const viewBox = grid?.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/\s+/);
    const size = toInt(parts[2], 0);
    if (size > 0) return size;
  }
  // Fallback: the preview canvas is a direct child sized 1:1 with the artboard.
  for (const canvas of frame.children) {
    if (canvas.tagName !== 'CANVAS') continue;
    const width = toInt(canvas.getAttribute('width'), 0);
    const height = toInt(canvas.getAttribute('height'), 0);
    if (width > 0 && width === height) return width;
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
 * @param {number} canvasSize - The HQ canvas size in pixels.
 * @param {{x: number, y: number, width: number, height: number}} region - Region of interest.
 * @returns {ImageData|null} Image data for `region`, or `null` when the canvases cannot be read.
 */
function readHqRegion(frame, canvasSize, region) {
  const tiles = frame.querySelectorAll('.hq-tile-layer canvas');
  if (!tiles.length) return null;

  const frameWidth = frame.getBoundingClientRect().width;
  if (!(frameWidth > 0)) return null;
  const scale = frameWidth / canvasSize; // CSS px per HQ pixel

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

  /** @type {Object<string, Object>} Persisted records keyed by headquarters key. */
  let records = {};
  let recordsLoaded = false;
  /** @type {ImageData|null} Decoded pixels of the active record. */
  let activeImageData = null;
  /** @type {string|null} Key of the headquarters currently on screen. */
  let activeKey = null;
  let canvasSize = 0;
  let progressTimerId = null;
  let attachTimerId = null;
  let message = '';
  /** @type {Array<{name: string, stream: string}>|null} Cached remote template list for autocomplete. */
  let remoteEntries = null;
  let remoteNamesInFlight = false;
  /** @type {{total: number, done: number, wrong: number}|null} */
  let progress = null;
  /** @type {Uint8Array|null} 1 byte per template pixel: 0 = ok/empty, 1 = mismatch. */
  let wrongMask = null;

  const dom = {
    stage: null,
    frame: null,
    overlay: null,
    panel: null,
    controls: null,
  };

  const getRecord = () => (activeKey ? records[activeKey] || null : null);

  async function loadRecords() {
    if (recordsLoaded) return;
    recordsLoaded = true;
    try {
      const raw = await GM.getValue(STORAGE_KEY, '{}');
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object') records = parsed;
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

  /** Recomputes how much of the template is already painted on the HQ canvas. */
  function computeProgress() {
    const record = getRecord();
    if (!record || !activeImageData || !dom.frame) {
      progress = null;
      wrongMask = null;
      return;
    }

    const { width, height } = activeImageData;
    const region = { x: record.x, y: record.y, width, height };
    const painted = readHqRegion(dom.frame, canvasSize, region);
    if (!painted) {
      progress = null;
      wrongMask = null;
      return;
    }

    const template = activeImageData.data;
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
  }

  /** Redraws the overlay canvas from the active template. */
  function renderOverlay() {
    const record = getRecord();
    if (!dom.frame || !record || !activeImageData || !record.enabled) {
      if (dom.overlay) dom.overlay.style.display = 'none';
      return;
    }

    const { width, height } = activeImageData;
    const mode = record.mode === 'full' || record.mode === 'wrong' ? record.mode : 'dots';
    const useDots = mode === 'dots' && width * height * SHREAD_SIZE * SHREAD_SIZE <= MAX_SHREAD_PIXELS;
    const scale = useDots ? SHREAD_SIZE : 1;
    const center = (SHREAD_SIZE - 1) / 2;

    if (mode === 'wrong' && !wrongMask) computeProgress();

    const overlay = ensureOverlayCanvas();
    if (overlay.width !== width * scale || overlay.height !== height * scale) {
      overlay.width = width * scale;
      overlay.height = height * scale;
    }
    const context = overlay.getContext('2d');
    context.clearRect(0, 0, overlay.width, overlay.height);

    const source = activeImageData.data;
    const output = context.createImageData(overlay.width, overlay.height);
    const target = output.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sourceIndex = (y * width + x) * 4;
        if (source[sourceIndex + 3] < 128) continue;
        if (mode === 'wrong' && wrongMask && !wrongMask[y * width + x]) continue;

        const red = source[sourceIndex];
        const green = source[sourceIndex + 1];
        const blue = source[sourceIndex + 2];
        if (scale === 1) {
          const targetIndex = (y * overlay.width + x) * 4;
          target[targetIndex] = red;
          target[targetIndex + 1] = green;
          target[targetIndex + 2] = blue;
          target[targetIndex + 3] = 255;
          continue;
        }
        // Dots mode: only the centre sub-pixel is painted so the artwork below stays visible.
        const targetIndex = ((y * scale + center) * overlay.width + (x * scale + center)) * 4;
        target[targetIndex] = red;
        target[targetIndex + 1] = green;
        target[targetIndex + 2] = blue;
        target[targetIndex + 3] = 255;
      }
    }
    context.putImageData(output, 0, 0);

    const percent = (value) => `${(value / canvasSize) * 100}%`;
    overlay.style.display = '';
    overlay.style.left = percent(record.x);
    overlay.style.top = percent(record.y);
    overlay.style.width = percent(width);
    overlay.style.height = percent(height);
    overlay.style.opacity = String(clamp(Number(record.opacity) || 1, 0, 1));
  }

  /** Ensures the overlay canvas exists inside the artboard frame (it survives Svelte re-renders).
   * @returns {HTMLCanvasElement} The overlay canvas.
   */
  function ensureOverlayCanvas() {
    if (dom.overlay?.isConnected && dom.overlay.parentElement === dom.frame) return dom.overlay;
    const canvas = document.createElement('canvas');
    canvas.className = 'bm-hq-overlay';
    dom.frame.appendChild(canvas);
    dom.overlay = canvas;
    return canvas;
  }

  // ---------------------------------------------------------------------- UI

  function setMessage(text) {
    message = text || '';
    if (dom.controls?.message) dom.controls.message.textContent = message;
  }

  /** Applies a partial change to the active record, then persists and re-renders.
   * @param {Object} patch - The fields to change.
   */
  function updateRecord(patch) {
    const record = getRecord();
    if (!record) return;
    Object.assign(record, patch);
    saveRecords();
    syncPanel();
    renderOverlay();
  }

  async function handleFile(file) {
    if (!file || !activeKey) return;
    try {
      const dither = Boolean(dom.controls?.dither?.checked);
      const imageData = await fileToPaletteImageData(file, dither);
      if (imageData.width > canvasSize || imageData.height > canvasSize) {
        setMessage(t('tooBig', { size: canvasSize }));
        return;
      }
      const previous = getRecord();
      const dataUrl = await imageDataToDataUrl(imageData);
      records[activeKey] = {
        name: file.name || 'template',
        dataUrl,
        width: imageData.width,
        height: imageData.height,
        x: clamp(previous?.x ?? 0, 0, canvasSize - imageData.width),
        y: clamp(previous?.y ?? 0, 0, canvasSize - imageData.height),
        enabled: previous?.enabled ?? true,
        mode: previous?.mode ?? 'dots',
        opacity: previous?.opacity ?? 1,
        dither,
      };
      activeImageData = imageData;
      wrongMask = null;
      progress = null;
      setMessage('');
      await saveRecords();
      computeProgress();
      syncPanel();
      renderOverlay();
      consoleLog(`[hq] loaded ${imageData.width}x${imageData.height} headquarters template`);
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

  function removeRecord() {
    if (!activeKey) return;
    delete records[activeKey];
    activeImageData = null;
    wrongMask = null;
    progress = null;
    saveRecords();
    if (dom.overlay) dom.overlay.style.display = 'none';
    syncPanel();
  }

  /** Pushes the current state into the panel widgets. */
  function syncPanel() {
    const controls = dom.controls;
    if (!controls) return;
    const record = getRecord();
    const hasTemplate = Boolean(record && activeImageData);

    controls.loadButton.textContent = hasTemplate ? t('replace') : t('load');
    controls.body.style.display = hasTemplate ? '' : 'none';
    controls.empty.style.display = hasTemplate ? 'none' : '';
    controls.empty.textContent = t('empty');
    controls.message.textContent = message;

    if (!hasTemplate) return;

    controls.size.textContent = t('size', { w: activeImageData.width, h: activeImageData.height });
    controls.enabled.checked = Boolean(record.enabled);
    controls.mode.value = record.mode || 'dots';
    controls.opacity.value = String(Math.round((Number(record.opacity) || 1) * 100));

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
    loadButton.textContent = t('load');
    loadButton.addEventListener('click', () => fileInput.click());

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn-sm btn-ghost text-error';
    removeButton.textContent = t('remove');
    removeButton.addEventListener('click', removeRecord);

    const ditherLabel = document.createElement('label');
    ditherLabel.className = 'bm-hq-inline text-xs';
    const dither = document.createElement('input');
    dither.type = 'checkbox';
    dither.className = 'checkbox checkbox-xs';
    ditherLabel.append(dither, document.createTextNode(` ${t('dither')}`));

    const actions = document.createElement('div');
    actions.className = 'bm-hq-inline';
    actions.append(ditherLabel, loadButton, removeButton);
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
    enabled.addEventListener('change', () => updateRecord({ enabled: enabled.checked }));
    enabledLabel.append(enabled, document.createTextNode(` ${t('enabled')}`));

    const modeLabel = document.createElement('label');
    modeLabel.className = 'bm-hq-inline text-sm';
    const mode = document.createElement('select');
    mode.className = 'select select-xs w-40';
    for (const value of ['dots', 'full', 'wrong']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(`mode.${value}`);
      mode.appendChild(option);
    }
    mode.addEventListener('change', () => {
      wrongMask = null;
      updateRecord({ mode: mode.value });
    });
    modeLabel.append(document.createTextNode(`${t('mode')} `), mode);

    const opacityLabel = document.createElement('label');
    opacityLabel.className = 'bm-hq-inline text-sm';
    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.min = '10';
    opacity.max = '100';
    opacity.className = 'range range-xs w-32';
    opacity.addEventListener('input', () => updateRecord({ opacity: Number(opacity.value) / 100 }));
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

    body.append(optionsRow, statusRow);

    const messageNode = document.createElement('p');
    messageNode.className = 'text-error mt-2 text-xs';

    panel.append(header, remoteRow, empty, body, messageNode, fileInput);

    dom.controls = {
      loadButton,
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
    const size = frame ? readCanvasSize(frame) : null;
    if (!frame || !size) return;

    dom.stage = stage;
    dom.frame = frame;
    canvasSize = size;

    await loadRecords();
    const key = readHqKey(stage);
    if (key !== activeKey) {
      activeKey = key;
      activeImageData = null;
      wrongMask = null;
      progress = null;
      message = '';
      const record = getRecord();
      if (record?.dataUrl) {
        try {
          activeImageData = await dataUrlToImageData(record.dataUrl);
        } catch (error) {
          consoleWarn('[hq] failed to decode stored headquarters template', error);
        }
      }
    }

    // A record saved for a smaller canvas may now hang off the edge after an expansion.
    const record = getRecord();
    if (record && activeImageData) {
      const maxX = Math.max(0, canvasSize - activeImageData.width);
      const maxY = Math.max(0, canvasSize - activeImageData.height);
      if (record.x > maxX || record.y > maxY) {
        record.x = clamp(record.x, 0, maxX);
        record.y = clamp(record.y, 0, maxY);
        saveRecords();
      }
    }

    if (!dom.panel?.isConnected) {
      dom.panel = buildPanel();
      stage.insertAdjacentElement('afterend', dom.panel);
    }

    ensureOverlayCanvas();
    computeProgress();
    syncPanel();
    renderOverlay();

    if (progressTimerId === null) {
      progressTimerId = setInterval(() => {
        if (!dom.frame?.isConnected || !activeImageData) return;
        // Big templates are only diffed on demand — a full re-read every tick is too costly.
        if (activeImageData.width * activeImageData.height > AUTO_PROGRESS_MAX_PIXELS) return;
        computeProgress();
        syncPanel();
        if (getRecord()?.mode === 'wrong') renderOverlay();
      }, PROGRESS_REFRESH_MS);
    }
  }

  function detach() {
    if (progressTimerId !== null) {
      clearInterval(progressTimerId);
      progressTimerId = null;
    }
    dom.panel?.remove();
    dom.overlay?.remove();
    dom.stage = null;
    dom.frame = null;
    dom.overlay = null;
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
      if (stage !== dom.stage || !dom.panel?.isConnected || !dom.overlay?.isConnected) {
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

  return {
    destroy() {
      if (attachTimerId !== null) clearInterval(attachTimerId);
      attachTimerId = null;
      detach();
    },
    refresh: scheduleSync,
  };
}
