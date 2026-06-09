/** @file The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */
import "./polyfill.js";
import { profiler, initProfiler } from './profiler.js';
import Overlay from './Overlay.js';
// import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { normalizeTemplatePaletteConversionOptions, templatePaletteConversionDefaults } from './Template.js';
import { templateWorkerManager } from './templateWorkerManager.js';
import { buildUserSettingsSection } from './userSettings.js';
import { createTemplateSync, normalizeRemoteOrder } from './templateSync.js';
import { createMapCommentManager } from './mapComments.js';
import { createTemplateCreationUi } from './templateCreationUi.js';
import { createArchiveTemplateUi } from './archiveTemplateUi.js';
import { layoutLanguageOptions, normalizeLayoutLanguage, translateLayout, getLayoutThemeLabel as getLocalizedLayoutThemeLabel, getTemplateDisplayLabel as getLocalizedTemplateDisplayLabel, getTemplateCreateModeLabel, getChatBanTypeLabel, getColorSortLabel } from './layoutI18n.js';
import { encodeChunkSampleBytes } from './templateChunkUtils.js';
import { consoleLog, consoleWarn, consoleError, isDebugLoggingEnabled, selectAllCoordinateInputs, rgbToMeta, colorpalette, getOverlayCoords, sortByOptions, getCurrentColor, cleanUpCanvas, calculateTopLeftAndSize, testCanvasSize, downloadTile, createBitmapPreservingPixels } from './utils.js';
import { getCenterGeoCoords, getPixelPerWplacePixel, forceRefreshTiles, removeLayer, themeList, setTheme, isMapTilerLoaded, teleportToTileCoords, teleportToGeoCoords, coordsTileCoordsToGeoCoords, coordsGeoCoordsToTileCoords, doAfterMapFound, panMap, setZoom, getCurrentTileSize, setForcedTileRefreshSuppressed, applyArchiveBgLayerToMap, setTemplateSortIDLayersOpacity, registerBmCanvasRestoreOnStyleChange} from './utilsMaptiler.js';
// import { getCenterGeoCoords, addTemplate } from './utilsMaptiler.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs
const CSS_BM_File = typeof __CSS_BM_FILE__ !== 'undefined' && __CSS_BM_FILE__
  ? __CSS_BM_FILE__
  : "http://localhost:8000/dist/RusMarble.user.css";
const TEMPLATE_SYNC_BASE_URL = typeof __TEMPLATE_SYNC_BASE_URL__ !== 'undefined' && __TEMPLATE_SYNC_BASE_URL__
  ? __TEMPLATE_SYNC_BASE_URL__
  : "http://localhost:8003";
const CHAT_WS_URL = typeof __CHAT_WS_URL__ !== 'undefined' && __CHAT_WS_URL__
  ? __CHAT_WS_URL__
  : `${TEMPLATE_SYNC_BASE_URL.replace(/^http(s?):\/\//, (_, secure) => (secure ? 'wss://' : 'ws://'))}/ws/chat`;
const TEMPLATE_UPDATE_POLL_MS = 30000;
const REMOTE_FLAGS_REFRESH_MS = 60000;
const NOTIFICATION_POLL_MS = 3000;
const NOTIFICATION_ROTATE_MS = 10000;
const CHAT_MAX_USER_LEN = 15;
const CHAT_MAX_TEXT_LEN = 300;
const REPORT_REQUEST_EVENT_TYPE = 'bm-report-request';
const SAFE_MODE_MESSAGE_TYPE = 'bm-safe-mode';
const INJECTED_SAFE_MODE_STORAGE_KEY = 'bmSafeModeEnabled';
const INJECTED_SAFE_MODE_ATTR = 'data-bm-safe-mode';
const REPORT_CLICK_FALLBACK_MS = 5000;
const REPORT_POST_SEND_HIDE_MS = 1000;
const MAP_WORLD_WIDTH_PX = 2048 * 1000;
const MAP_WORLD_HEIGHT_PX = 2048 * 1000;
const NEXT_TEMPLATE_PIXEL_ZOOM_LEVEL = 10;
const TEMPLATE_FOCUS_VIEWPORT_RATIO = 0.72;
const TEMPLATE_FOCUS_SCALE_PADDING = 1.5;
const TEMPLATE_FOCUS_SCALE_MIN = 0.0001;
const TEMPLATE_FOCUS_ZOOM_MIN = 0;
const TEMPLATE_FOCUS_ZOOM_MAX = 22;
let chatSocket = null;
let chatInitialized = false;
let mapCommentManager = null;
let templateManagerRef = null;
let observeBlackObserver = null;
const reportCommentsState = {
  isApplied: false,
  clickActive: false,
  requestCount: 0,
  reportModalOpen: false,
  postSendHold: false,
  clickTimer: null,
  postSendTimer: null,
  reportModalObserver: null,
  chatDisplayBeforeHide: null,
};
let reportModalStateCheckQueued = false;
const distanceMeasureState = {
  active: false,
  startPoint: null,
  hoverPoint: null,
  lastOutput: '',
  map: null,
  mapContainer: null,
  mapReadyPollId: null,
  mapEventsBound: false,
  lineCanvas: null,
  lineContext: null,
};
const layoutThemeOptions = {
  "classic": "Classic",
  "white": "White",
  "pink": "Pink",
  "blue": "Blue",
  "black": "Black",
  "mint": "Mint",
  "imperial": "Russian Imperial",
  "tricolor": "Russian Tricolor"
};
const templateDisplayOptions = {
  "cross": "Cross",
  "fill": "Fill",
  "cross-z-9": "Cross (Z, 9x9)",
  "cross-z-11": "Cross (Z, 11x11)",
  "dot": "Dot (Original)"
};
let currentLayoutLanguage = 'en';
const t = (key, params = {}) => translateLayout(currentLayoutLanguage, key, params);
const getLayoutThemeLabel = (value) => getLocalizedLayoutThemeLabel(currentLayoutLanguage, value);
const getTemplateDisplayLabel = (value) => getLocalizedTemplateDisplayLabel(currentLayoutLanguage, value);
const TEMPLATE_TEXT_MAX_CHARS = 120;
const TEMPLATE_TEXT_FONT_SIZE = 36;
const TEMPLATE_TEXT_FONT_SIZE_MIN = 8;
const TEMPLATE_TEXT_FONT_SIZE_MAX = 160;
const TEMPLATE_TEXT_PADDING = 10;
const TEMPLATE_TEXT_MAX_DIMENSION = 1000;
const TEMPLATE_TEXT_HARD_EDGE_ALPHA_THRESHOLD = 128;
const TEMPLATE_TEXT_HARD_EDGE_ALPHA_THRESHOLD_SMALL = 72;
const TEMPLATE_TEXT_HARD_EDGE_ALPHA_THRESHOLD_SMALL_PIXEL = 56;
const TEMPLATE_TEXT_HARD_EDGE_SMALL_FONT_MAX = 10;
const TEMPLATE_TEXT_SMALL_FONT_WEIGHT_MIN = 500;
const TEMPLATE_TEXT_FONT_LOAD_TIMEOUT_MS = 1200;
const TEMPLATE_TILE_SIZE = 1000;
const TEMPLATE_TEXT_WINDOW_DEFAULT_W = 440;
const TEMPLATE_TEXT_WINDOW_DEFAULT_H = 440;
const TEMPLATE_TEXT_WINDOW_MIN_W = 320;
const TEMPLATE_TEXT_WINDOW_MIN_H = 320;
const TEMPLATE_TEXT_PREVIEW_MIN_W = 240;
const TEMPLATE_TEXT_PREVIEW_MIN_H = 150;
const TEMPLATE_TEXT_PREVIEW_ZOOM_MIN = 0.0001;
const TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT = 1;
const TEMPLATE_TEXT_PREVIEW_MAX_TILE_REQUESTS = 256;
const TEMPLATE_PREVIEW_TILE_BASE_URL = 'https://backend.wplace.live/files/s0/tiles';
const TEMPLATE_TEXT_WEB_FONT_LINK_ID = 'bm-text-template-web-fonts';
const TEMPLATE_TEXT_WEB_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&family=Silkscreen:wght@400;700&display=swap';
const TEMPLATE_PALETTE_PREVIEW_MAX_DIMENSION = 240;
const TEMPLATE_PRE_SCAN_MAX_PIXELS = 200000;
const TEMPLATE_CREATE_MODE_IMAGE = 'image';
const TEMPLATE_CREATE_MODE_REMOTE_NAME = 'remote-name';
const TEMPLATE_CREATE_MODE_TEXT = 'text';
const TEMPLATE_CREATE_MODE_RUSSIAN_FLAG = 'russian-flag';
const TEMPLATE_CREATE_MODE_TIME_ARCHIVE = 'time-archive';
const TEMPLATE_ARCHIVE_BASE_URL = 'https://wplace.eralyon.net';
const TEMPLATE_ARCHIVE_PREVIEW_MAX_DIMENSION = 4000;
const TEMPLATE_ARCHIVE_PREVIEW_MAX_TILE_REQUESTS = 256;
const TEMPLATE_ARCHIVE_PREVIEW_DOWNLOAD_CONCURRENCY = 10;
const TEMPLATE_FLAG_WINDOW_DEFAULT_W = 620;
const TEMPLATE_FLAG_WINDOW_DEFAULT_H = 720;
const TEMPLATE_FLAG_WINDOW_MIN_W = 420;
const TEMPLATE_FLAG_WINDOW_MIN_H = 520;
const TEMPLATE_FLAG_DIMENSION_MIN = 3;
const TEMPLATE_FLAG_DIMENSION_MAX = 3000;
const TEMPLATE_FLAG_DEFAULT_W = 300;
const TEMPLATE_FLAG_DEFAULT_H = 200;
const TEMPLATE_FLAG_IGNORE_BACKGROUND_COLOR_COUNT = 4;
const TEMPLATE_FLAG_IGNORE_MAX_TILE_REQUESTS = 64;
const TEMPLATE_FLAG_IGNORE_MODE_ALL_EXCEPT_SELECTED = 'all-except-selected';
const TEMPLATE_FLAG_IGNORE_MODE_ONLY_SELECTED = 'only-selected';
const TEMPLATE_FLAG_ORIENTATION_HORIZONTAL = 'horizontal';
const TEMPLATE_FLAG_ORIENTATION_VERTICAL = 'vertical';
const TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_LEFT = 'first-left';
const TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT = 'first-right';

const templateTextPaletteOptions = (() => {
  const options = [];
  const seen = new Set();
  for (const color of colorpalette) {
    const colorName = String(color?.name || '').trim();
    if (!Array.isArray(color?.rgb) || color.rgb.length < 3) continue;
    if (colorName.toLowerCase() === 'transparent') continue;
    const rgb = color.rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0)));
    const key = rgb.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: Number(color?.id),
      name: colorName || `Color ${color?.id ?? '?'}`,
      rgb,
      key,
    });
  }
  if (!options.length) {
    options.push({ id: 1, name: 'Black', rgb: [0, 0, 0], key: '0,0,0' });
  }
  return options;
})();
const templateTextPaletteMap = new Map(templateTextPaletteOptions.map((entry) => [entry.key, entry]));
const detectTemplateImageOtherColors = async (sourceFile) => {
  if (!sourceFile) {
    return {
      otherPixelCount: 0,
      otherColorCount: 0,
      skipped: false,
      pixelCount: 0,
    };
  }

  const bitmap = await createBitmapPreservingPixels(sourceFile);
  const pixelCount = Math.max(0, (bitmap.width || 0) * (bitmap.height || 0));
  if (pixelCount > TEMPLATE_PRE_SCAN_MAX_PIXELS) {
    bitmap.close?.();
    return {
      otherPixelCount: 0,
      otherColorCount: 0,
      skipped: true,
      pixelCount,
    };
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close?.();
    throw new Error('Could not initialize canvas context for palette scan.');
  }
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const pixelData = new Uint8ClampedArray(
    context.getImageData(0, 0, bitmap.width, bitmap.height).data
  );
  canvas.width = 0;
  canvas.height = 0;
  const workerResult = await templateWorkerManager.runTask('countNonPalettePixels', {
    pixelData,
  }, { transferList: [pixelData.buffer] }).catch(() => null);
  return {
    otherPixelCount: Number(workerResult?.otherPixelCount) || 0,
    otherColorCount: Number(workerResult?.otherColorCount) || 0,
    skipped: false,
    pixelCount,
  };
};
const convertTemplateImageFileToPaletteBlob = async (sourceFile, options = {}) => {
  if (!sourceFile) {
    throw new Error('No source image provided for palette conversion.');
  }
  const normalizedOptions = normalizeTemplatePaletteConversionOptions(options || templatePaletteConversionDefaults);
  const bitmap = await createBitmapPreservingPixels(sourceFile);
  let canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close?.();
    cleanUpCanvas(canvas);
    canvas = null;
    throw new Error('Could not initialize canvas for conversion download.');
  }
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixelData = new Uint8ClampedArray(imageData.data);
  const workerResult = await templateWorkerManager.runTask('convertImageData', {
    pixelData,
    width: canvas.width,
    height: canvas.height,
    options: normalizedOptions,
  }, { transferList: [pixelData.buffer] }).catch(() => null);
  if (workerResult?.pixelData instanceof Uint8ClampedArray) {
    context.putImageData(new ImageData(workerResult.pixelData, canvas.width, canvas.height), 0, 0);
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  cleanUpCanvas(canvas);
  canvas = null;
  return {
    blob,
    options: conversion.options || normalizedOptions,
    stats: conversion.stats || null,
  };
};
const TEMPLATE_TEXT_FONT_DEFAULT_KEY = 'segoe-bold';
const TEMPLATE_TEXT_LINE_HEIGHT_DEFAULT = 1.2;
const templateTextFontOptions = [
  {
    key: 'segoe-bold',
    name: 'Segoe UI Bold',
    family: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    weight: 700,
    lineHeight: 1.2,
  },
  {
    key: 'arial-bold',
    name: 'Arial Bold',
    family: 'Arial, "Helvetica Neue", sans-serif',
    weight: 700,
    lineHeight: 1.2,
  },
  {
    key: 'verdana-bold',
    name: 'Verdana Bold',
    family: 'Verdana, Geneva, sans-serif',
    weight: 700,
    lineHeight: 1.2,
  },
  {
    key: 'tahoma-bold',
    name: 'Tahoma Bold',
    family: 'Tahoma, "Segoe UI", sans-serif',
    weight: 700,
    lineHeight: 1.2,
  },
  {
    key: 'trebuchet-bold',
    name: 'Trebuchet Bold',
    family: '"Trebuchet MS", Tahoma, sans-serif',
    weight: 700,
    lineHeight: 1.2,
  },
  {
    key: 'georgia-bold',
    name: 'Georgia Bold',
    family: 'Georgia, "Times New Roman", serif',
    weight: 700,
    lineHeight: 1.2,
  },
  {
    key: 'courier-bold',
    name: 'Courier New Bold',
    family: '"Courier New", Consolas, monospace',
    weight: 700,
    lineHeight: 1.2,
  },
  {
    key: 'press-start-2p',
    name: 'Press Start 2P',
    family: '"Press Start 2P", "Courier New", monospace',
    weight: 400,
    lineHeight: 1.12,
  },
  {
    key: 'pixel-operator',
    name: 'Pixel Operator',
    family: '"Pixel Operator", "PixelOperator", "VT323", "Courier New", monospace',
    weight: 400,
    lineHeight: 1.08,
  },
  {
    key: 'vt323',
    name: 'VT323',
    family: '"VT323", "Courier New", monospace',
    weight: 400,
    lineHeight: 1.08,
  },
  {
    key: 'silkscreen',
    name: 'Silkscreen',
    family: '"Silkscreen", "Press Start 2P", "Courier New", monospace',
    weight: 400,
    lineHeight: 1.1,
  },
  {
    key: 'pixel-retro',
    name: 'Pixel Retro',
    family: '"Press Start 2P", "Pixelify Sans", "VT323", "Courier New", monospace',
    weight: 400,
    lineHeight: 1.12,
  },
  {
    key: 'pixel-saver',
    name: 'Pixel Saver (Narrow)',
    family: '"Arial Narrow", "Liberation Sans Narrow", "Nimbus Sans Narrow", Arial, sans-serif',
    weight: 400,
    lineHeight: 1.08,
  },
];
const templateTextFontMap = new Map(templateTextFontOptions.map((entry) => [entry.key, entry]));
const templateTextPixelFontKeys = new Set(['press-start-2p', 'pixel-operator', 'vt323', 'silkscreen', 'pixel-retro']);
const resolveTemplateTextFont = (options = {}) => {
  const optionKey = String(options?.fontKey || '').trim();
  const fromKey = templateTextFontMap.get(optionKey);
  if (fromKey) return fromKey;
  return templateTextFontMap.get(TEMPLATE_TEXT_FONT_DEFAULT_KEY) || templateTextFontOptions[0];
};
let templateTextWebFontsLoaded = false;
const templateTextFontLoadCache = new Map();
const ensureTemplateTextWebFontsLoaded = () => {
  if (templateTextWebFontsLoaded) return;
  if (typeof document === 'undefined' || !document.head) return;
  const existing = document.getElementById(TEMPLATE_TEXT_WEB_FONT_LINK_ID);
  if (existing) {
    templateTextWebFontsLoaded = true;
    return;
  }
  const link = document.createElement('link');
  link.id = TEMPLATE_TEXT_WEB_FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = TEMPLATE_TEXT_WEB_FONT_HREF;
  document.head.appendChild(link);
  templateTextWebFontsLoaded = true;
};
const ensureTemplateTextFontReady = async (fontShorthand, sampleText = 'Hg') => {
  if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') {
    return;
  }
  if (typeof document.fonts.check === 'function' && document.fonts.check(fontShorthand, sampleText)) {
    return;
  }
  let loadPromise = templateTextFontLoadCache.get(fontShorthand);
  if (!loadPromise) {
    const timeoutPromise = new Promise((resolve) => {
      window.setTimeout(resolve, TEMPLATE_TEXT_FONT_LOAD_TIMEOUT_MS);
    });
    loadPromise = Promise.race([
      document.fonts.load(fontShorthand, sampleText),
      timeoutPromise,
    ]).catch(() => undefined);
    templateTextFontLoadCache.set(fontShorthand, loadPromise);
  }
  await loadPromise;
};

const normalizeLayoutTheme = (value) => {
  const key = String(value ?? '').toLowerCase();
  return layoutThemeOptions[key] ? key : 'classic';
};

const normalizeTemplateDisplay = (value) => {
  const key = String(value ?? '').toLowerCase();
  return templateDisplayOptions[key] ? key : 'cross';
};

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};
const rgbToKey = (rgb) => {
  if (!Array.isArray(rgb) || rgb.length < 3) return '';
  const channels = rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0)));
  return channels.join(',');
};
const rgbToCss = (rgb) => {
  const channels = Array.isArray(rgb) ? rgb : [0, 0, 0];
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
};
const getTemplatePaletteOptionByName = (name) => {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  for (const option of templateTextPaletteOptions) {
    if (String(option?.name || '').trim().toLowerCase() === target) {
      return option;
    }
  }
  return null;
};
const resolveTemplatePaletteOptionByName = (name, fallbackRgb = [0, 0, 0], fallbackName = '') => {
  const option = getTemplatePaletteOptionByName(name);
  if (option?.key && Array.isArray(option.rgb)) {
    return {
      key: option.key,
      rgb: option.rgb.slice(0, 3),
      name: option.name || name,
    };
  }
  const rgb = Array.isArray(fallbackRgb) && fallbackRgb.length >= 3
    ? fallbackRgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))))
    : [0, 0, 0];
  const key = rgbToKey(rgb);
  return {
    key,
    rgb,
    name: String(fallbackName || name || key || 'Color'),
  };
};
const resolveTemplatePaletteNameByKey = (key) => {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return '';
  const fromTextPalette = templateTextPaletteMap.get(normalizedKey);
  if (fromTextPalette?.name) return fromTextPalette.name;
  const fromMeta = rgbToMeta.get(normalizedKey);
  if (fromMeta?.name) return String(fromMeta.name);
  return normalizedKey;
};
const normalizeTemplatePaletteKey = (value) => {
  const key = String(value || '').trim();
  if (!key) return '';
  if (templateTextPaletteMap.has(key)) return key;
  const match = key.match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/);
  if (!match) return '';
  const rgb = match
    .slice(1)
    .map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel) || 0))));
  return rgbToKey(rgb);
};
const templateFlagStyleTricolor = {
  key: 'tricolor',
  name: 'Russian Tricolor',
  stripes: [
    resolveTemplatePaletteOptionByName('White', [255, 255, 255], 'White'),
    resolveTemplatePaletteOptionByName('Dark Blue', [40, 80, 158], 'Dark Blue'),
    resolveTemplatePaletteOptionByName('Red', [237, 28, 36], 'Red'),
  ],
};
const templateFlagStyleImperial = {
  key: 'imperial',
  name: 'Russian Imperial',
  stripes: [
    resolveTemplatePaletteOptionByName('Black', [0, 0, 0], 'Black'),
    resolveTemplatePaletteOptionByName('Yellow', [249, 221, 59], 'Yellow'),
    resolveTemplatePaletteOptionByName('White', [255, 255, 255], 'White'),
  ],
};
const templateRussianFlagStyles = [
  templateFlagStyleTricolor,
  templateFlagStyleImperial,
];
const templateRussianFlagStyleMap = new Map(templateRussianFlagStyles.map((entry) => [entry.key, entry]));
const TEMPLATE_RUSSIAN_FLAG_DEFAULT_PROTECTED_KEYS = (() => {
  const defaultColorNames = ['Yellow', 'Blue', 'Dark Blue'];
  const keys = [];
  const seen = new Set();
  for (const colorName of defaultColorNames) {
    const option = resolveTemplatePaletteOptionByName(colorName, [0, 0, 0], colorName);
    if (!option?.key || seen.has(option.key)) continue;
    seen.add(option.key);
    keys.push(option.key);
  }
  return keys;
})();
const normalizeRussianFlagStyleKey = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return templateRussianFlagStyleMap.has(key)
    ? key
    : templateFlagStyleTricolor.key;
};
const getRussianFlagStyle = (value) => {
  const key = normalizeRussianFlagStyleKey(value);
  return templateRussianFlagStyleMap.get(key) || templateFlagStyleTricolor;
};
const getFlagDefaultStripeColorKeys = (styleKey) => {
  const style = getRussianFlagStyle(styleKey);
  const fallbackKey = templateTextPaletteOptions[0]?.key || '0,0,0';
  return [0, 1, 2].map((index) => {
    const stripe = style?.stripes?.[index];
    const fromKey = normalizeTemplatePaletteKey(stripe?.key);
    if (fromKey && templateTextPaletteMap.has(fromKey)) return fromKey;
    const fromRgb = normalizeTemplatePaletteKey(rgbToKey(stripe?.rgb || []));
    if (fromRgb && templateTextPaletteMap.has(fromRgb)) return fromRgb;
    return fallbackKey;
  });
};
const normalizeFlagStripeColorKeys = (keys, styleKey) => {
  const defaults = getFlagDefaultStripeColorKeys(styleKey);
  return [0, 1, 2].map((index) => {
    const candidate = normalizeTemplatePaletteKey(Array.isArray(keys) ? keys[index] : '');
    if (candidate && templateTextPaletteMap.has(candidate)) return candidate;
    return defaults[index];
  });
};
const normalizeFlagStripeWeights = (weights) => [0, 1, 2].map((index) => {
  const numeric = Math.round(Number(Array.isArray(weights) ? weights[index] : 1));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
});
const computeFlagStripeSpans = (total, weights) => {
  const safeTotal = Math.max(3, Math.trunc(Number(total) || 0));
  const normalizedWeights = normalizeFlagStripeWeights(weights);
  const baseSpans = [1, 1, 1];
  const remaining = Math.max(0, safeTotal - baseSpans.length);
  if (remaining < 1) return baseSpans;
  const weightSum = normalizedWeights.reduce((sum, value) => sum + value, 0) || 3;
  const rawExtras = normalizedWeights.map((value) => (remaining * value) / weightSum);
  const extraSpans = rawExtras.map((value) => Math.floor(value));
  let leftover = remaining - extraSpans.reduce((sum, value) => sum + value, 0);
  const rankedIndexes = [0, 1, 2].sort((a, b) => {
    const diff = (rawExtras[b] - extraSpans[b]) - (rawExtras[a] - extraSpans[a]);
    return diff || (normalizedWeights[b] - normalizedWeights[a]) || (a - b);
  });
  for (let i = 0; i < leftover; i++) {
    extraSpans[rankedIndexes[i % rankedIndexes.length]] += 1;
  }
  return baseSpans.map((value, index) => value + extraSpans[index]);
};
const normalizeFlagStripeOrientation = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  return mode === TEMPLATE_FLAG_ORIENTATION_VERTICAL
    ? TEMPLATE_FLAG_ORIENTATION_VERTICAL
    : TEMPLATE_FLAG_ORIENTATION_HORIZONTAL;
};
const normalizeFlagIgnoreMode = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  return mode === TEMPLATE_FLAG_IGNORE_MODE_ONLY_SELECTED
    ? TEMPLATE_FLAG_IGNORE_MODE_ONLY_SELECTED
    : TEMPLATE_FLAG_IGNORE_MODE_ALL_EXCEPT_SELECTED;
};
const normalizeFlagVerticalOrder = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  return mode === TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_LEFT
    ? TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_LEFT
    : TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT;
};
const normalizeFlagTemplateDimension = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(
    TEMPLATE_FLAG_DIMENSION_MIN,
    Math.min(TEMPLATE_FLAG_DIMENSION_MAX, Math.round(numeric))
  );
};
const normalizeFlagPointCoords = (value) => {
  if (!value || typeof value !== 'object') return null;
  const tx = Number(value?.tx);
  const ty = Number(value?.ty);
  const px = Number(value?.px);
  const py = Number(value?.py);
  if (![tx, ty, px, py].every(Number.isFinite)) return null;
  return {
    tx: normalizePreviewTileX(tx),
    ty: Math.trunc(ty),
    px: normalizePreviewTilePixel(px),
    py: normalizePreviewTilePixel(py),
  };
};
const flagPointCoordsToArray = (point) => {
  const normalized = normalizeFlagPointCoords(point);
  if (!normalized) return null;
  return [normalized.tx, normalized.ty, normalized.px, normalized.py];
};
const worldPointToFlagCoords = (worldX, worldY) => {
  const wrappedX = ((Math.trunc(worldX) % MAP_WORLD_WIDTH_PX) + MAP_WORLD_WIDTH_PX) % MAP_WORLD_WIDTH_PX;
  const safeY = Math.trunc(worldY);
  const tx = Math.floor(wrappedX / TEMPLATE_TILE_SIZE);
  const ty = Math.floor(safeY / TEMPLATE_TILE_SIZE);
  const px = wrappedX % TEMPLATE_TILE_SIZE;
  const py = ((safeY % TEMPLATE_TILE_SIZE) + TEMPLATE_TILE_SIZE) % TEMPLATE_TILE_SIZE;
  return { tx, ty, px, py };
};
const computeFlagTemplateRectFromPoints = (startCoords, endCoords) => {
  const start = flagPointCoordsToArray(startCoords);
  const end = flagPointCoordsToArray(endCoords);
  if (!start || !end) return null;
  const [[left, top], [width, height]] = calculateTopLeftAndSize(
    [[start[0], start[1]], [start[2], start[3]]],
    [[end[0], end[1]], [end[2], end[3]]]
  );
  const safeWidth = Math.max(1, Math.trunc(width));
  const safeHeight = Math.max(1, Math.trunc(height));
  const topLeft = worldPointToFlagCoords(left, top);
  const bottomRight = worldPointToFlagCoords(left + safeWidth - 1, top + safeHeight - 1);
  return {
    topLeft,
    bottomRight,
    width: safeWidth,
    height: safeHeight,
  };
};
const computeFlagTemplateEndFromStartAndSize = (startCoords, width, height) => {
  const start = normalizeFlagPointCoords(startCoords);
  if (!start) return null;
  const safeWidth = Math.max(1, Math.trunc(Number(width) || 0));
  const safeHeight = Math.max(1, Math.trunc(Number(height) || 0));
  const worldX = start.tx * TEMPLATE_TILE_SIZE + start.px;
  const worldY = start.ty * TEMPLATE_TILE_SIZE + start.py;
  return worldPointToFlagCoords(worldX + safeWidth - 1, worldY + safeHeight - 1);
};
const parseFourCoordsFromAnyText = (text) => {
  const value = String(text ?? '');
  const matches = value.match(/-?\d+/g);
  if (!Array.isArray(matches) || matches.length < 4) return null;
  const numbers = matches.slice(0, 4).map((entry) => Number(entry));
  if (!numbers.every(Number.isFinite)) return null;
  return {
    tx: numbers[0],
    ty: numbers[1],
    px: numbers[2],
    py: numbers[3],
  };
};
const buildRussianFlagTemplateName = ({ styleKey, width, height, stripeOrientation } = {}) => {
  const style = getRussianFlagStyle(styleKey);
  const safeWidth = normalizeFlagTemplateDimension(width, TEMPLATE_FLAG_DEFAULT_W);
  const safeHeight = normalizeFlagTemplateDimension(height, TEMPLATE_FLAG_DEFAULT_H);
  const orientation = normalizeFlagStripeOrientation(stripeOrientation);
  const orientationLabel = orientation === TEMPLATE_FLAG_ORIENTATION_VERTICAL ? 'vertical' : 'horizontal';
  return `${style.name} (${orientationLabel}) ${safeWidth}x${safeHeight}`;
};

const getCurrentTemplateTextColor = () => {
  const currentColorId = getCurrentColor();
  for (const option of templateTextPaletteOptions) {
    if (Number(option.id) === currentColorId) {
      return option.rgb.slice();
    }
  }
  return templateTextPaletteOptions[0]?.rgb?.slice() ?? [0, 0, 0];
};
const getCurrentTemplateTextColorKey = () => rgbToKey(getCurrentTemplateTextColor());
const resolveTemplateTextColor = (options = {}) => {
  const optionKey = String(options?.colorKey || '').trim();
  const fromKey = templateTextPaletteMap.get(optionKey);
  if (fromKey) return fromKey.rgb.slice();
  if (Array.isArray(options?.colorRgb) && options.colorRgb.length >= 3) {
    return options.colorRgb
      .slice(0, 3)
      .map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))));
  }
  return getCurrentTemplateTextColor();
};

const buildTextTemplateName = (text) => {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return 'Text Template';
  return compact.length <= 24 ? `Text: ${compact}` : `Text: ${compact.slice(0, 24)}...`;
};

const createTextTemplateBlob = async (rawText, options = {}) => {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) {
    throw new Error('Text template is empty.');
  }
  if (text.length > TEMPLATE_TEXT_MAX_CHARS) {
    throw new Error(`Text is too long. Max ${TEMPLATE_TEXT_MAX_CHARS} characters.`);
  }
  const fontSize = clampNumber(
    options?.fontSize,
    TEMPLATE_TEXT_FONT_SIZE_MIN,
    TEMPLATE_TEXT_FONT_SIZE_MAX,
    TEMPLATE_TEXT_FONT_SIZE
  );
  const fontOption = resolveTemplateTextFont(options);
  const isSmallFont = fontSize <= TEMPLATE_TEXT_HARD_EDGE_SMALL_FONT_MAX;
  const isPixelFont = templateTextPixelFontKeys.has(String(fontOption?.key || '').trim());
  const lineHeightFactor = Number(fontOption?.lineHeight);
  const lineHeight = Math.max(
    1,
    Math.ceil(fontSize * (Number.isFinite(lineHeightFactor) && lineHeightFactor > 0 ? lineHeightFactor : TEMPLATE_TEXT_LINE_HEIGHT_DEFAULT))
  );
  const colorRgb = resolveTemplateTextColor(options);

  const lines = text.split('\n').map(line => line.trimEnd());
  const baseFontWeight = clampNumber(fontOption?.weight, 100, 900, 700);
  const fontWeight = isSmallFont
    ? (isPixelFont ? baseFontWeight : Math.max(TEMPLATE_TEXT_SMALL_FONT_WEIGHT_MIN, baseFontWeight))
    : baseFontWeight;
  const fontFamily = String(fontOption?.family || '"Segoe UI", sans-serif');
  const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ensureTemplateTextWebFontsLoaded();
  const sampleText = (lines.join(' ').trim() || 'Hg').slice(0, 64);
  await ensureTemplateTextFontReady(font, sampleText);

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = 1;
  measureCanvas.height = 1;
  const measureContext = measureCanvas.getContext('2d');
  if (!measureContext) {
    throw new Error('Unable to prepare text template canvas.');
  }
  measureContext.font = font;

  const contentWidth = Math.max(...lines.map(line => Math.ceil(measureContext.measureText(line || ' ').width)), 1);
  const width = contentWidth + TEMPLATE_TEXT_PADDING * 2;
  const height = lines.length * lineHeight + TEMPLATE_TEXT_PADDING * 2;
  if (width > TEMPLATE_TEXT_MAX_DIMENSION || height > TEMPLATE_TEXT_MAX_DIMENSION) {
    throw new Error(`Text template is too large (${width}x${height}).`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to draw text template.');
  }

  context.clearRect(0, 0, width, height);
  context.font = font;
  context.textBaseline = 'top';
  context.fillStyle = rgbToCss(colorRgb);
  context.imageSmoothingEnabled = false;
  lines.forEach((line, index) => {
    context.fillText(line || ' ', TEMPLATE_TEXT_PADDING, TEMPLATE_TEXT_PADDING + index * lineHeight);
  });
  // Convert antialiased font edges into hard pixels for pixel-art templates.
  const hardEdgeThreshold = isSmallFont
    ? (isPixelFont ? TEMPLATE_TEXT_HARD_EDGE_ALPHA_THRESHOLD_SMALL_PIXEL : TEMPLATE_TEXT_HARD_EDGE_ALPHA_THRESHOLD_SMALL)
    : TEMPLATE_TEXT_HARD_EDGE_ALPHA_THRESHOLD;
  const rawPixelData = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
  const hardEdgeResult = await templateWorkerManager.runTask('applyHardEdgeThreshold', {
    pixelData: rawPixelData,
    colorR: colorRgb[0],
    colorG: colorRgb[1],
    colorB: colorRgb[2],
    threshold: hardEdgeThreshold,
  }, { transferList: [rawPixelData.buffer] }).catch(() => null);
  if (hardEdgeResult?.pixelData instanceof Uint8ClampedArray) {
    context.putImageData(new ImageData(hardEdgeResult.pixelData, width, height), 0, 0);
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((encodedBlob) => {
      if (!encodedBlob) {
        reject(new Error('Failed to encode text template image.'));
        return;
      }
      resolve(encodedBlob);
    }, 'image/png');
  });

  canvas.width = 0;
  canvas.height = 0;
  measureCanvas.width = 0;
  measureCanvas.height = 0;

  return {
    blob,
    text,
    width,
    height,
    colorRgb,
    fontSize,
    fontKey: fontOption?.key || TEMPLATE_TEXT_FONT_DEFAULT_KEY,
    fontName: fontOption?.name || 'Segoe UI Bold',
  };
};
const templatePreviewTileImageCache = new Map();
const normalizePreviewTileX = (value) => {
  const number = Math.trunc(Number(value) || 0);
  return ((number % 2048) + 2048) % 2048;
};
const parsePreviewTileY = (value) => Math.trunc(Number(value) || 0);
const normalizePreviewTileY = (value) => {
  const number = parsePreviewTileY(value);
  return Math.max(0, number);
};
const normalizePreviewTilePixel = (value) => {
  const number = Math.trunc(Number(value) || 0);
  return Math.max(0, Math.min(TEMPLATE_TILE_SIZE - 1, number));
};
const getPreviewTileUrl = (tileX, tileY) => {
  const safeX = normalizePreviewTileX(tileX);
  const safeY = parsePreviewTileY(tileY);
  return `${TEMPLATE_PREVIEW_TILE_BASE_URL}/${safeX}/${safeY}.png`;
};
const loadPreviewTileImage = async (tileX, tileY) => {
  const safeX = normalizePreviewTileX(tileX);
  const safeY = parsePreviewTileY(tileY);
  if (safeY < 0) {
    return null;
  }
  const cacheKey = `${safeX},${safeY}`;
  if (templatePreviewTileImageCache.has(cacheKey)) {
    return templatePreviewTileImageCache.get(cacheKey);
  }
  const tileUrl = getPreviewTileUrl(safeX, safeY);
  const loadPromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load tile preview: ${tileUrl}`));
    image.src = tileUrl;
  }).catch((error) => {
    templatePreviewTileImageCache.delete(cacheKey);
    throw error;
  });
  templatePreviewTileImageCache.set(cacheKey, loadPromise);
  return loadPromise;
};
const normalizeFlagTemplateTopLeftCoords = (value) => normalizeFlagPointCoords(value);
const loadLiveRegionImageDataForFlagMask = async ({
  topLeftCoords = null,
  width = TEMPLATE_FLAG_DEFAULT_W,
  height = TEMPLATE_FLAG_DEFAULT_H,
} = {}) => {
  const normalizedCoords = normalizeFlagTemplateTopLeftCoords(topLeftCoords);
  if (!normalizedCoords) {
    throw new Error('Valid top-left coordinates are required.');
  }
  const safeWidth = normalizeFlagTemplateDimension(width, TEMPLATE_FLAG_DEFAULT_W);
  const safeHeight = normalizeFlagTemplateDimension(height, TEMPLATE_FLAG_DEFAULT_H);
  const startWorldX = normalizedCoords.tx * TEMPLATE_TILE_SIZE + normalizedCoords.px;
  const startWorldY = normalizedCoords.ty * TEMPLATE_TILE_SIZE + normalizedCoords.py;
  const endWorldX = startWorldX + safeWidth - 1;
  const endWorldY = startWorldY + safeHeight - 1;
  const txMin = Math.floor(startWorldX / TEMPLATE_TILE_SIZE);
  const tyMin = Math.floor(startWorldY / TEMPLATE_TILE_SIZE);
  const txMax = Math.floor(endWorldX / TEMPLATE_TILE_SIZE);
  const tyMax = Math.floor(endWorldY / TEMPLATE_TILE_SIZE);
  const tileCount = Math.max(0, (txMax - txMin + 1) * (tyMax - tyMin + 1));
  if (tileCount <= 0) {
    throw new Error('The selected area does not intersect any tiles.');
  }
  if (tileCount > TEMPLATE_FLAG_IGNORE_MAX_TILE_REQUESTS) {
    throw new Error(
      `Ignore-arts area is too large (${tileCount} tiles). Limit: ${TEMPLATE_FLAG_IGNORE_MAX_TILE_REQUESTS} tiles.`
    );
  }

  let regionCanvas = new OffscreenCanvas(safeWidth, safeHeight);
  const regionContext = regionCanvas.getContext('2d', { willReadFrequently: true });
  if (!regionContext) {
    cleanUpCanvas(regionCanvas);
    regionCanvas = null;
    throw new Error('Could not initialize the map sampling canvas.');
  }
  regionContext.imageSmoothingEnabled = false;
  regionContext.clearRect(0, 0, safeWidth, safeHeight);

  const tileTasks = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      tileTasks.push((async () => {
        try {
          const image = await loadPreviewTileImage(tx, ty);
          return { tx, ty, image };
        } catch (_) {
          return { tx, ty, image: null };
        }
      })());
    }
  }
  const tileResults = await Promise.all(tileTasks);
  const failedTiles = tileResults.filter((entry) => !entry?.image);
  if (failedTiles.length > 0) {
    cleanUpCanvas(regionCanvas);
    regionCanvas = null;
    throw new Error('Could not load map tiles for ignore-arts masking. Try another position/size.');
  }

  const cropLeft = startWorldX;
  const cropTop = startWorldY;
  const cropRight = startWorldX + safeWidth;
  const cropBottom = startWorldY + safeHeight;
  for (const { tx, ty, image } of tileResults) {
    if (!image) continue;
    const tileLeft = tx * TEMPLATE_TILE_SIZE;
    const tileTop = ty * TEMPLATE_TILE_SIZE;
    const intersectLeft = Math.max(cropLeft, tileLeft);
    const intersectTop = Math.max(cropTop, tileTop);
    const intersectRight = Math.min(cropRight, tileLeft + TEMPLATE_TILE_SIZE);
    const intersectBottom = Math.min(cropBottom, tileTop + TEMPLATE_TILE_SIZE);
    const intersectWidth = intersectRight - intersectLeft;
    const intersectHeight = intersectBottom - intersectTop;
    if (intersectWidth <= 0 || intersectHeight <= 0) continue;
    const srcX = intersectLeft - tileLeft;
    const srcY = intersectTop - tileTop;
    const dstX = intersectLeft - cropLeft;
    const dstY = intersectTop - cropTop;
    regionContext.drawImage(
      image,
      srcX,
      srcY,
      intersectWidth,
      intersectHeight,
      dstX,
      dstY,
      intersectWidth,
      intersectHeight
    );
  }

  const regionImageData = regionContext.getImageData(0, 0, safeWidth, safeHeight);
  const regionPixelData = new Uint8ClampedArray(regionImageData.data);
  cleanUpCanvas(regionCanvas);
  regionCanvas = null;
  const colorResult = await templateWorkerManager.runTask('countRegionColors', {
    pixelData: regionPixelData,
    width: safeWidth,
    height: safeHeight,
  }, { transferList: [regionPixelData.buffer] }).catch(() => ({ sortedColorCounts: [], sortedBorderColorCounts: [] }));
  return {
    imageData: regionImageData,
    tileCount,
    sortedColorCounts: colorResult.sortedColorCounts,
    sortedBorderColorCounts: colorResult.sortedBorderColorCounts,
  };
};
const buildRussianFlagTemplateImageData = async ({
  styleKey = templateFlagStyleTricolor.key,
  width = TEMPLATE_FLAG_DEFAULT_W,
  height = TEMPLATE_FLAG_DEFAULT_H,
  stripeOrientation = TEMPLATE_FLAG_ORIENTATION_HORIZONTAL,
  verticalOrder = TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT,
  stripeColorKeys = null,
  stripeWeights = null,
  ignoreArts = false,
  ignoreMode = TEMPLATE_FLAG_IGNORE_MODE_ALL_EXCEPT_SELECTED,
  ignoreProtectedColorKeys = [],
  mapRegion = null,
} = {}) => {
  const style = getRussianFlagStyle(styleKey);
  const safeWidth = normalizeFlagTemplateDimension(width, TEMPLATE_FLAG_DEFAULT_W);
  const safeHeight = normalizeFlagTemplateDimension(height, TEMPLATE_FLAG_DEFAULT_H);
  const orientation = normalizeFlagStripeOrientation(stripeOrientation);
  const normalizedVerticalOrder = normalizeFlagVerticalOrder(verticalOrder);
  const normalizedStripeColorKeys = normalizeFlagStripeColorKeys(stripeColorKeys, style.key);
  const normalizedStripeWeights = normalizeFlagStripeWeights(stripeWeights);
  const normalizedIgnoreMode = normalizeFlagIgnoreMode(ignoreMode);
  const verticalStripeSpans = computeFlagStripeSpans(safeWidth, normalizedStripeWeights);
  const horizontalStripeSpans = computeFlagStripeSpans(safeHeight, normalizedStripeWeights);
  const resolveStripeIndex = (offset, spans) => (
    offset < spans[0]
      ? 0
      : (offset < spans[0] + spans[1] ? 1 : 2)
  );
  const data = new Uint8ClampedArray(safeWidth * safeHeight * 4);
  const stripeColors = normalizedStripeColorKeys.map((key, index) => {
    const option = templateTextPaletteMap.get(key);
    const styleStripe = style?.stripes?.[index];
    const fallbackRgb = Array.isArray(styleStripe?.rgb) ? styleStripe.rgb.slice(0, 3) : [0, 0, 0];
    return {
      key,
      rgb: Array.isArray(option?.rgb) ? option.rgb.slice(0, 3) : fallbackRgb,
    };
  });
  for (let y = 0; y < safeHeight; y++) {
    const rowOffset = y * safeWidth * 4;
    for (let x = 0; x < safeWidth; x++) {
      const stripeIndex = orientation === TEMPLATE_FLAG_ORIENTATION_VERTICAL
        ? (
          normalizedVerticalOrder === TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT
            ? 2 - resolveStripeIndex(x, verticalStripeSpans)
            : resolveStripeIndex(x, verticalStripeSpans)
        )
        : resolveStripeIndex(y, horizontalStripeSpans);
      const stripe = stripeColors[stripeIndex] || stripeColors[0] || { rgb: [0, 0, 0] };
      const r = stripe.rgb[0] ?? 0;
      const g = stripe.rgb[1] ?? 0;
      const b = stripe.rgb[2] ?? 0;
      const base = rowOffset + x * 4;
      data[base] = r;
      data[base + 1] = g;
      data[base + 2] = b;
      data[base + 3] = 255;
    }
  }

  let ignoredPixelCount = 0;
  let backgroundEntries = [];
  if (ignoreArts) {
    const mapPixels = mapRegion?.imageData?.data;
    if (!(mapPixels instanceof Uint8ClampedArray) || mapPixels.length !== data.length) {
      throw new Error('Ignore-arts map data is unavailable. Try previewing again.');
    }
    const sortedBorderColorCounts = Array.isArray(mapRegion?.sortedBorderColorCounts) ? mapRegion.sortedBorderColorCounts : [];
    const sortedColorCounts = Array.isArray(mapRegion?.sortedColorCounts) ? mapRegion.sortedColorCounts : [];
    backgroundEntries = (sortedBorderColorCounts.length ? sortedBorderColorCounts : sortedColorCounts)
      .slice(0, TEMPLATE_FLAG_IGNORE_BACKGROUND_COLOR_COUNT);
    const keyToPacked = (key) => {
      const m = String(key || '').match(/^(\d+),(\d+),(\d+)$/);
      return m ? (((m[1] | 0) << 16) | ((m[2] | 0) << 8) | (m[3] | 0)) >>> 0 : null;
    };
    const backgroundColorsPacked = Uint32Array.from(
      backgroundEntries.map(([key]) => keyToPacked(normalizeTemplatePaletteKey(key))).filter((v) => v !== null)
    );
    const protectedColorsPacked = Uint32Array.from(
      (Array.isArray(ignoreProtectedColorKeys) ? ignoreProtectedColorKeys : [])
        .map((key) => keyToPacked(normalizeTemplatePaletteKey(key))).filter((v) => v !== null)
    );
    const flagData = new Uint8ClampedArray(data);
    const mapData = new Uint8ClampedArray(mapPixels);
    const maskResult = await templateWorkerManager.runTask('applyFlagMask', {
      pixelData: flagData,
      mapPixels: mapData,
      backgroundColorsPacked,
      protectedColorsPacked,
      ignoreMode: normalizedIgnoreMode,
    }, { transferList: [flagData.buffer, mapData.buffer] }).catch(() => null);
    if (maskResult?.pixelData instanceof Uint8ClampedArray) {
      data.set(maskResult.pixelData);
      ignoredPixelCount = maskResult.ignoredPixelCount | 0;
    }
  }

  return {
    imageData: new ImageData(data, safeWidth, safeHeight),
    style,
    orientation,
    verticalOrder: normalizedVerticalOrder,
    stripeColorKeys: normalizedStripeColorKeys,
    stripeWeights: normalizedStripeWeights,
    ignoreMode: normalizedIgnoreMode,
    width: safeWidth,
    height: safeHeight,
    ignoredPixelCount,
    backgroundEntries,
  };
};

const applyOverlayVarsToFloatingElement = (element) => {
  const overlayRoot = document.getElementById('bm-overlay');
  if (!overlayRoot || !element) return;
  const computed = getComputedStyle(overlayRoot);
  for (let i = 0; i < computed.length; i++) {
    const propName = computed[i];
    if (!propName || !propName.startsWith('--bm-')) continue;
    const propValue = computed.getPropertyValue(propName);
    if (!propValue) continue;
    element.style.setProperty(propName, propValue);
  }
};
const normalizeTemplateCreateMode = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === TEMPLATE_CREATE_MODE_REMOTE_NAME) return TEMPLATE_CREATE_MODE_REMOTE_NAME;
  if (mode === TEMPLATE_CREATE_MODE_TEXT) return TEMPLATE_CREATE_MODE_TEXT;
  if (mode === TEMPLATE_CREATE_MODE_RUSSIAN_FLAG) return TEMPLATE_CREATE_MODE_RUSSIAN_FLAG;
  if (mode === TEMPLATE_CREATE_MODE_TIME_ARCHIVE) return TEMPLATE_CREATE_MODE_TIME_ARCHIVE;
  return TEMPLATE_CREATE_MODE_IMAGE;
};
const normalizeArchiveTemplateBaseUrl = (rawUrl = TEMPLATE_ARCHIVE_BASE_URL) => {
  const fallback = String(TEMPLATE_ARCHIVE_BASE_URL || '').trim();
  const value = String(rawUrl ?? '').trim();
  return (value || fallback).replace(/\/+$/, '');
};
const normalizeTimeArchiveMeta = (value) => {
  if (!value || typeof value !== 'object') return null;
  const source = String(value?.source || '').trim().toLowerCase();
  if (source !== 'time-archive') return null;
  const archiveVersion = String(value?.archiveVersion || '').trim();
  if (!archiveVersion) return null;
  const archiveDate = String(value?.archiveDate || '').trim();
  const archiveBaseUrl = normalizeArchiveTemplateBaseUrl(value?.archiveBaseUrl || TEMPLATE_ARCHIVE_BASE_URL);
  const regionName = String(value?.regionName || '').trim();
  const width = Number.isFinite(Number(value?.width)) ? Math.max(1, Math.trunc(Number(value.width))) : null;
  const height = Number.isFinite(Number(value?.height)) ? Math.max(1, Math.trunc(Number(value.height))) : null;
  return {
    source: 'time-archive',
    archiveVersion,
    archiveDate,
    archiveBaseUrl,
    regionName,
    width,
    height,
  };
};
const getTemplateTimeArchiveMeta = (template) => {
  if (!template) return null;
  const direct = normalizeTimeArchiveMeta(template?.timeArchiveMeta);
  if (direct) return direct;
  const templateStore = templateManager?.templatesJSON?.templates?.[template?.storageKey] ?? null;
  return normalizeTimeArchiveMeta(templateStore?.timeArchiveMeta);
};
const resolveTemplateArchiveBounds = (template) => {
  const topLeft = normalizeTilePixelCoords(template?.coords);
  if (!topLeft) return null;
  const templateStore = templateManager?.templatesJSON?.templates?.[template?.storageKey] ?? {};
  const timeArchiveMeta = getTemplateTimeArchiveMeta(template);
  const width = Number.isFinite(Number(template?.imageWidth))
    ? Math.max(1, Math.trunc(Number(template.imageWidth)))
    : (Number.isFinite(Number(templateStore?.width))
      ? Math.max(1, Math.trunc(Number(templateStore.width)))
      : (Number.isFinite(Number(timeArchiveMeta?.width)) ? Math.max(1, Math.trunc(Number(timeArchiveMeta.width))) : null));
  const height = Number.isFinite(Number(template?.imageHeight))
    ? Math.max(1, Math.trunc(Number(template.imageHeight)))
    : (Number.isFinite(Number(templateStore?.height))
      ? Math.max(1, Math.trunc(Number(templateStore.height)))
      : (Number.isFinite(Number(timeArchiveMeta?.height)) ? Math.max(1, Math.trunc(Number(timeArchiveMeta.height))) : null));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const leftWorldX = topLeft[0] * TEMPLATE_TILE_SIZE + topLeft[2];
  const topWorldY = topLeft[1] * TEMPLATE_TILE_SIZE + topLeft[3];
  const maxWorldX = leftWorldX + width - 1;
  const maxWorldY = topWorldY + height - 1;
  const tx2 = Math.floor(maxWorldX / TEMPLATE_TILE_SIZE);
  const ty2 = Math.floor(maxWorldY / TEMPLATE_TILE_SIZE);
  const px2 = ((maxWorldX % TEMPLATE_TILE_SIZE) + TEMPLATE_TILE_SIZE) % TEMPLATE_TILE_SIZE;
  const py2 = ((maxWorldY % TEMPLATE_TILE_SIZE) + TEMPLATE_TILE_SIZE) % TEMPLATE_TILE_SIZE;
  const bottomRight = normalizeTilePixelCoords([tx2, ty2, px2, py2]);
  if (!bottomRight) return null;
  return { topLeft, bottomRight, width, height };
};
const sanitizeTemplateFileNamePart = (value, fallback = 'template') => {
  const text = String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return text || fallback;
};
const buildTemplateImageFileName = (templateOrName) => {
  const templateName = typeof templateOrName === 'string'
    ? templateOrName
    : (templateOrName?.displayName
      || templateManager?.templatesJSON?.templates?.[templateOrName?.storageKey]?.name
      || 'template');
  return `${sanitizeTemplateFileNamePart(templateName, 'template')}.png`;
};
const triggerTemplateBlobDownload = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};
const createTemplateImageBlob = async (templateOrStorageKey) => {
  const template = typeof templateOrStorageKey === 'string'
    ? (templateManager.templatesArray ?? []).find((entry) => entry?.storageKey === String(templateOrStorageKey))
    : templateOrStorageKey;
  if (!template) {
    throw new Error('Template image download requires a valid template.');
  }
  if (
    typeof Blob !== 'undefined'
    && template.file instanceof Blob
    && String(template.file.type || '').toLowerCase() === 'image/png'
    && template.forcePaletteConversion !== true
  ) {
    return {
      blob: template.file,
      fileName: buildTemplateImageFileName(template),
    };
  }
  const templateStore = templateManager?.templatesJSON?.templates?.[template?.storageKey] ?? {};
  const bounds = resolveTemplateArchiveBounds(template);
  if (!bounds) {
    throw new Error('Could not resolve template image size.');
  }
  const { topLeft, width, height } = bounds;
  if (!testCanvasSize(width, height)) {
    throw new Error(`Template image is too large to download in this browser (${width} x ${height}).`);
  }
  const shreadSize = Math.max(1, Math.trunc(Number(template?.shreadSize || templateStore?.shreadSize || templateManager?.drawMult || 1)));
  const shreadCenter = (shreadSize - 1) >> 1;
  const topLeftWorldX = topLeft[0] * TEMPLATE_TILE_SIZE + topLeft[2];
  const topLeftWorldY = topLeft[1] * TEMPLATE_TILE_SIZE + topLeft[3];
  const templateWorldWidth = 2048 * TEMPLATE_TILE_SIZE;
  const tileKeys = template.getChunkKeys?.() ?? Object.keys(template.chunkedBuffer ?? template.chunked ?? {});
  let resultCanvas = new OffscreenCanvas(width, height);
  const resultContext = resultCanvas.getContext('2d', { willReadFrequently: true });
  if (!resultContext) {
    cleanUpCanvas(resultCanvas);
    resultCanvas = null;
    throw new Error('Could not initialize download canvas.');
  }
  resultContext.imageSmoothingEnabled = false;
  resultContext.clearRect(0, 0, width, height);

  try {
    for (const tileKey of tileKeys) {
      const coords = tileKey.split(',').map(Number);
      if (coords.length < 4 || coords.some((value) => !Number.isFinite(value))) continue;
      const chunkBitmapSource = template.chunked?.[tileKey];
      const canReuseBitmap = typeof ImageBitmap !== 'undefined' && chunkBitmapSource instanceof ImageBitmap;
      let chunkBitmap = null;
      let shouldCloseBitmap = false;
      let chunkCanvas = null;
      try {
        if (canReuseBitmap) {
          chunkBitmap = chunkBitmapSource;
        } else if (template.chunkedBuffer?.[tileKey]) {
          const chunkBytes = template.getChunkBufferBytes?.(tileKey) ?? template.chunkedBuffer[tileKey];
          const chunkBlob = new Blob([chunkBytes], { type: 'image/png' });
          chunkBitmap = await createBitmapPreservingPixels(chunkBlob);
          shouldCloseBitmap = true;
        }
        if (!chunkBitmap) {
          const sampleData = await template.getChunkSamples?.(tileKey, { allowBitmapFallback: false });
          if (!sampleData) continue;
          const chunkImageData = resultContext.createImageData(sampleData.width, sampleData.height);
          for (let index = 0; index < sampleData.count; index++) {
            if ((sampleData.flags[index] & 1) === 1) continue;
            const targetIndex = (sampleData.y[index] * sampleData.width + sampleData.x[index]) * 4;
            chunkImageData.data[targetIndex] = sampleData.r[index];
            chunkImageData.data[targetIndex + 1] = sampleData.g[index];
            chunkImageData.data[targetIndex + 2] = sampleData.b[index];
            chunkImageData.data[targetIndex + 3] = sampleData.a[index];
          }

          const chunkWorldX = coords[0] * TEMPLATE_TILE_SIZE + coords[2];
          const chunkWorldY = coords[1] * TEMPLATE_TILE_SIZE + coords[3];
          const offsetX = ((chunkWorldX - topLeftWorldX) % templateWorldWidth + templateWorldWidth) % templateWorldWidth;
          const offsetY = chunkWorldY - topLeftWorldY;
          resultContext.putImageData(chunkImageData, offsetX, offsetY);
          continue;
        }

        const chunkWidth = Math.max(1, Math.round(chunkBitmap.width / shreadSize));
        const chunkHeight = Math.max(1, Math.round(chunkBitmap.height / shreadSize));
        chunkCanvas = new OffscreenCanvas(chunkBitmap.width, chunkBitmap.height);
        const chunkContext = chunkCanvas.getContext('2d', { willReadFrequently: true });
        if (!chunkContext) continue;
        chunkContext.imageSmoothingEnabled = false;
        chunkContext.clearRect(0, 0, chunkBitmap.width, chunkBitmap.height);
        chunkContext.drawImage(chunkBitmap, 0, 0);
        const sourceData = new Uint8ClampedArray(chunkContext.getImageData(0, 0, chunkBitmap.width, chunkBitmap.height).data);
        const downsampleResult = await templateWorkerManager.runTask('downsampleChunk', {
          sourceData,
          sourceWidth: chunkBitmap.width,
          sourceHeight: chunkBitmap.height,
          chunkWidth,
          chunkHeight,
          shreadSize,
          shreadCenter,
        }, { transferList: [sourceData.buffer] }).catch(() => null);

        const chunkWorldX = coords[0] * TEMPLATE_TILE_SIZE + coords[2];
        const chunkWorldY = coords[1] * TEMPLATE_TILE_SIZE + coords[3];
        const offsetX = ((chunkWorldX - topLeftWorldX) % templateWorldWidth + templateWorldWidth) % templateWorldWidth;
        const offsetY = chunkWorldY - topLeftWorldY;
        if (downsampleResult?.pixelData instanceof Uint8ClampedArray) {
          resultContext.putImageData(new ImageData(downsampleResult.pixelData, chunkWidth, chunkHeight), offsetX, offsetY);
        }
      } finally {
        if (shouldCloseBitmap) {
          chunkBitmap?.close?.();
        }
        if (chunkCanvas) {
          cleanUpCanvas(chunkCanvas);
          chunkCanvas = null;
        }
      }
    }
    const blob = await resultCanvas.convertToBlob({ type: 'image/png' });
    return {
      blob,
      fileName: buildTemplateImageFileName(template),
    };
  } finally {
    cleanUpCanvas(resultCanvas);
    resultCanvas = null;
  }
};
const downloadTemplateImage = async (templateOrStorageKey) => {
  const { blob, fileName } = await createTemplateImageBlob(templateOrStorageKey);
  triggerTemplateBlobDownload(blob, fileName);
  return { fileName };
};
const downloadTemplateImageBlob = async (blob, templateName) => {
  const fileName = buildTemplateImageFileName(templateName);
  triggerTemplateBlobDownload(blob, fileName);
  return { fileName };
};
const normalizeFlag = (value) => value === true || value === 'true' || value === 1 || value === '1';
const DEFAULT_REMOTE_TEMPLATE_STREAM = 'root';
const normalizeTemplateRemoteStream = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  return text || DEFAULT_REMOTE_TEMPLATE_STREAM;
};
const isWplaceDarkTheme = () => {
  const theme = String(document.documentElement?.dataset?.theme ?? '').toLowerCase();
  return theme === 'dark' || theme === 'halloween';
};
const applyWplaceThemeState = () => {
  const mode = isWplaceDarkTheme() ? 'dark' : 'light';
  const overlay = document.getElementById('bm-overlay');
  if (overlay) {
    overlay.dataset.wplaceTheme = mode;
  }
  const notificationContainer = document.getElementById('bm-notification-container');
  if (notificationContainer) {
    notificationContainer.dataset.wplaceTheme = mode;
  }
};
const observeWplaceTheme = () => {
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'data-theme')) {
      applyWplaceThemeState();
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  applyWplaceThemeState();
};

const waitForBody = () => {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  });
};

const applyLayoutTheme = (value) => {
  const overlay = document.getElementById('bm-overlay');
  if (!overlay) return;
  const nextTheme = normalizeLayoutTheme(value);
  overlay.dataset.layoutTheme = nextTheme;
  applyWplaceThemeState();
  const notificationContainer = document.getElementById('bm-notification-container');
  if (notificationContainer) {
    notificationContainer.dataset.layoutTheme = nextTheme;
  }
  document.dispatchEvent(new CustomEvent('bm-layout-theme-changed', { detail: { layoutTheme: nextTheme } }));
};

function readInjectedSafeModeBootstrap() {
  try {
    const attrValue = document.documentElement?.getAttribute(INJECTED_SAFE_MODE_ATTR);
    if (attrValue === 'true' || attrValue === 'false') {
      return attrValue;
    }
    const storedValue = window.localStorage?.getItem(INJECTED_SAFE_MODE_STORAGE_KEY);
    if (storedValue === '1' || storedValue === 'true') {
      return 'true';
    }
    if (storedValue === '0' || storedValue === 'false') {
      return 'false';
    }
  } catch (_) {}
  return 'false';
}

function setInjectedSafeModeState(enabled, { broadcast = true } = {}) {
  const normalized = enabled ? 'true' : 'false';
  document.documentElement?.setAttribute(INJECTED_SAFE_MODE_ATTR, normalized);
  try {
    window.localStorage?.setItem(INJECTED_SAFE_MODE_STORAGE_KEY, enabled ? '1' : '0');
  } catch (_) {}
  if (broadcast) {
    window.postMessage({
      source: 'blue-marble',
      type: SAFE_MODE_MESSAGE_TYPE,
      enabled: enabled === true
    }, '*');
  }
}

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
    const script = document.createElement('script');
    script.setAttribute('bm-name', name); // Passes in the name value
    script.setAttribute('bm-cStyle', consoleStyle); // Passes in the console style value
    script.setAttribute('bm-safe-mode', readInjectedSafeModeBootstrap());
    script.setAttribute('bm-safe-mode-storage-key', INJECTED_SAFE_MODE_STORAGE_KEY);
    script.textContent = `(${callback})();`;
    // script.textContent = `setTimeout(${callback}, 1000);`; // For debugging the case when there is delay when starting the script
    document.documentElement?.appendChild(script);
    script.remove();
}

function gmRequest(url, responseType = "json") {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url,
      responseType,
      onload: (response) => resolve(response),
      onerror: (err) => reject(err)
    });
  });
}
function parseJsonResponse(response, fallback = {}) {
  const emptyFallback = fallback ?? {};
  if (!response) return emptyFallback;
  const raw = response.response ?? response.responseText;
  if (raw && typeof raw === 'object') {
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return emptyFallback;
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return emptyFallback;
    }
  }
  return emptyFallback;
}

let notificationPollId = null;
let notificationRotateId = null;
let notificationQueue = [];
let notificationCurrent = null;
const NOTIFICATION_SHOWN_STORAGE_KEY = 'bmNotificationShownIds';
const NOTIFICATION_SHOWN_MAX = 500;
const notificationShownIds = new Set();
let notificationShownList = [];
let notificationShownInitPromise = null;
let overlayBuildInFlight = false;

function ensureMapCommentsManager() {
  if (isSafeModeActive()) return null;
  if (mapCommentManager) return mapCommentManager;
  try {
    mapCommentManager = createMapCommentManager();
  } catch (error) {
    mapCommentManager = null;
    consoleWarn('Map comments initialization failed; chat will continue without map comments.', error);
  }
  return mapCommentManager;
}

function destroyMapCommentsManager() {
  if (!mapCommentManager) return;
  try {
    mapCommentManager['destroy']?.();
  } catch (error) {
    consoleWarn('Failed to destroy map comments manager.', error);
  }
  mapCommentManager = null;
}

function setMapCommentsEnabled(enabled) {
  const manager = ensureMapCommentsManager();
  if (!manager) return;
  try {
    manager['setVisible']?.(Boolean(enabled));
  } catch (error) {
    consoleWarn('Failed to toggle map comments visibility.', error);
  }
}

let cachedArchiveBackgroundVersion = null;

function gmRequestWithTimeout(url, responseType, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onTimeout = () => reject(new Error(`gmRequest timed out for ${url}`));
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      responseType,
      timeout: timeoutMs,
      onload: resolve,
      onerror: (err) => reject(new Error(`gmRequest error for ${url}: ${err?.statusText || err}`)),
      ontimeout: onTimeout,
      onabort: () => reject(new Error(`gmRequest aborted for ${url}`)),
    });
  });
}

async function fetchLatestArchiveVersion() {
  if (cachedArchiveBackgroundVersion) return cachedArchiveBackgroundVersion;
  consoleError('[archive bg] fetching archive index from', TEMPLATE_ARCHIVE_BASE_URL);
  try {
    const response = await gmRequestWithTimeout(`${TEMPLATE_ARCHIVE_BASE_URL}/`, 'text', 15000);
    consoleError('[archive bg] index response status:', response?.status);
    const html = String(response?.responseText || response?.response || '');
    consoleError('[archive bg] index html length:', html.length);
    const listMatch = html.match(/const\s+WPLACE_VERSIONS\s*=\s*\[([\s\S]*?)\];/);
    if (!listMatch) { consoleError('[archive bg] WPLACE_VERSIONS not found in index page'); return null; }
    const entryRegex = /\{[^{}]*version:\s*['"]([^'"]+)['"][^{}]*\}/g;
    let lastVersion = null, match;
    while ((match = entryRegex.exec(listMatch[1])) !== null) lastVersion = String(match[1]).trim();
    if (!lastVersion) { consoleError('[archive bg] version list was empty'); return null; }
    consoleError('[archive bg] latest version:', lastVersion);
    cachedArchiveBackgroundVersion = lastVersion;
    return lastVersion;
  } catch (err) {
    consoleError('[archive bg] failed to fetch archive index:', err?.message || err);
    return null;
  }
}

async function applyArchiveBackground(enabled) {
  consoleError('[archive bg] applyArchiveBackground called, enabled=', enabled);
  if (!enabled) {
    doAfterMapFound(() => {
      const map = resolveTemplateOverlayMapInstance();
      if (map) applyArchiveBgLayerToMap(map, null);
    });
    return;
  }
  const version = await fetchLatestArchiveVersion();
  consoleError('[archive bg] resolved version:', version);
  if (!version) { consoleError('[archive bg] no version, aborting'); return; }
  const tileUrl = `https://wplace.eralyon.net/tiles/${version}/11/{x}/{y}.png`;
  consoleError('[archive bg] calling applyArchiveBgLayerToMap with:', tileUrl);
  doAfterMapFound(() => {
    const map = resolveTemplateOverlayMapInstance();
    consoleError('[archive bg] doAfterMapFound fired, map=', !!map);
    if (!map) return;
    applyArchiveBgLayerToMap(map, tileUrl);
  });
}

function setMapCommentsVisibleForReport(visible) {
  if (!mapCommentManager) return;
  try {
    mapCommentManager['setVisible']?.(Boolean(visible));
  } catch (error) {
    consoleWarn('Failed to set report-time map comments visibility.', error);
  }
}

function applyReportCommentsHidden() {
  if (reportCommentsState.isApplied) return;
  reportCommentsState.isApplied = true;
  setMapCommentsVisibleForReport(false);
  const chatDetails = document.getElementById('bm-contain-chat');
  if (chatDetails) {
    reportCommentsState.chatDisplayBeforeHide = chatDetails.style.display;
    chatDetails.style.display = 'none';
  }
}

function clearReportCommentsHidden() {
  if (!reportCommentsState.isApplied) return;
  reportCommentsState.isApplied = false;
  const mapCommentsEnabled = templateManagerRef?.isMapCommentsEnabled?.() ?? true;
  setMapCommentsVisibleForReport(mapCommentsEnabled);
  const chatDetails = document.getElementById('bm-contain-chat');
  if (chatDetails) {
    const chatShouldBeVisible = !(templateManagerRef?.isChatDisabled?.() ?? false);
    chatDetails.style.display = chatShouldBeVisible
      ? (reportCommentsState.chatDisplayBeforeHide ?? '')
      : 'none';
  }
  reportCommentsState.chatDisplayBeforeHide = null;
}

function syncReportCommentsHiddenState() {
  const shouldHide = reportCommentsState.clickActive
    || reportCommentsState.reportModalOpen
    || reportCommentsState.postSendHold
    || reportCommentsState.requestCount > 0;
  if (shouldHide) {
    applyReportCommentsHidden();
  } else {
    clearReportCommentsHidden();
  }
}

function markReportSubmitClicked() {
  ensureReportModalObserver();
  reportCommentsState.clickActive = true;
  if (reportCommentsState.clickTimer) {
    clearTimeout(reportCommentsState.clickTimer);
  }
  reportCommentsState.clickTimer = setTimeout(() => {
    reportCommentsState.clickTimer = null;
    reportCommentsState.clickActive = false;
    updateReportModalState();
    syncReportCommentsHiddenState();
  }, REPORT_CLICK_FALLBACK_MS);
  updateReportModalState();
  syncReportCommentsHiddenState();
}

function markReportSubmitCancelled() {
  if (reportCommentsState.clickTimer) {
    clearTimeout(reportCommentsState.clickTimer);
    reportCommentsState.clickTimer = null;
  }
  reportCommentsState.clickActive = false;
  reportCommentsState.reportModalOpen = false;
  updateReportModalState();
  syncReportCommentsHiddenState();
}

function clearReportPostSendHold() {
  if (reportCommentsState.postSendTimer) {
    clearTimeout(reportCommentsState.postSendTimer);
    reportCommentsState.postSendTimer = null;
  }
  reportCommentsState.postSendHold = false;
}

function startReportPostSendHold() {
  clearReportPostSendHold();
  reportCommentsState.postSendHold = true;
  reportCommentsState.postSendTimer = setTimeout(() => {
    reportCommentsState.postSendTimer = null;
    reportCommentsState.postSendHold = false;
    syncReportCommentsHiddenState();
  }, REPORT_POST_SEND_HIDE_MS);
}

function markReportRequestStarted() {
  clearReportPostSendHold();
  if (reportCommentsState.clickActive) {
    reportCommentsState.clickActive = false;
    if (reportCommentsState.clickTimer) {
      clearTimeout(reportCommentsState.clickTimer);
      reportCommentsState.clickTimer = null;
    }
  }
  reportCommentsState.requestCount += 1;
  syncReportCommentsHiddenState();
}

function markReportRequestFinished() {
  if (reportCommentsState.requestCount > 0) {
    reportCommentsState.requestCount -= 1;
  }
  updateReportModalState();
  if (reportCommentsState.requestCount === 0) {
    startReportPostSendHold();
  }
  syncReportCommentsHiddenState();
}

function getReportControlContext(control) {
  const dialog = control.closest('[role="dialog"],[aria-modal="true"],dialog');
  const formAction = control.closest('form')?.getAttribute('action') || '';
  return [
    control.textContent,
    control.getAttribute('value'),
    control instanceof HTMLInputElement ? control.value : '',
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
    control.getAttribute('name'),
    control.id,
    control.className,
    formAction,
    dialog?.textContent,
    dialog?.getAttribute?.('aria-label'),
    dialog?.id,
    dialog?.className
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isReportDialogElement(dialogElement) {
  if (!(dialogElement instanceof HTMLElement)) return false;
  const combined = [
    dialogElement.textContent,
    dialogElement.getAttribute('aria-label'),
    dialogElement.id,
    dialogElement.className
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return combined.includes('report user') || combined.includes('/report-user');
}

function updateReportModalState() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog'));
  reportCommentsState.reportModalOpen = dialogs.some(isReportDialogElement);
}

function queueReportModalStateUpdate() {
  if (reportModalStateCheckQueued) return;
  reportModalStateCheckQueued = true;
  requestAnimationFrame(() => {
    reportModalStateCheckQueued = false;
    updateReportModalState();
    syncReportCommentsHiddenState();
  });
}

function ensureReportModalObserver() {
  if (reportCommentsState.reportModalObserver) return;
  const root = document.body || document.documentElement;
  if (!root) return;
  reportCommentsState.reportModalObserver = new MutationObserver(() => {
    queueReportModalStateUpdate();
  });
  reportCommentsState.reportModalObserver.observe(root, {
    childList: true,
    subtree: true
  });
  updateReportModalState();
}

function isReportSubmitControl(target) {
  if (!(target instanceof Element)) return false;
  const control = target.closest('button,input[type="submit"],input[type="button"]');
  if (!(control instanceof HTMLElement)) return false;
  const formAction = control.closest('form')?.getAttribute('action') || '';
  if (String(formAction).toLowerCase().includes('/report-user')) {
    return true;
  }
  const combined = getReportControlContext(control);
  return combined.includes('report') && (combined.includes('send') || combined.includes('submit'));
}

function isReportOpenControl(target) {
  if (!(target instanceof Element)) return false;
  const control = target.closest('button,input[type="button"]');
  if (!(control instanceof HTMLElement)) return false;
  const combined = getReportControlContext(control);
  return combined.includes('report user');
}

function isReportCancelControl(target) {
  if (!(target instanceof Element)) return false;
  const control = target.closest('button,input[type="button"]');
  if (!(control instanceof HTMLElement)) return false;
  const combined = getReportControlContext(control);
  const isCancel = combined.includes('cancel') || combined.includes('close');
  const isReportContext = combined.includes('report') || combined.includes('/report-user');
  return isCancel && isReportContext;
}

function loadNotificationShownIds() {
  if (notificationShownInitPromise) return notificationShownInitPromise;
  notificationShownInitPromise = GM.getValue(NOTIFICATION_SHOWN_STORAGE_KEY, '[]')
    .then((raw) => {
      let list = [];
      try {
        list = Array.isArray(raw) ? raw : JSON.parse(raw ?? '[]');
      } catch (_) {
        list = [];
      }
      if (!Array.isArray(list)) return;
      notificationShownList = list
        .map((id) => normalizeNotificationId(id))
        .filter((id) => id);
      notificationShownList.forEach((id) => notificationShownIds.add(id));
    })
    .catch(() => {});
  return notificationShownInitPromise;
}

function persistNotificationShownIds() {
  if (notificationShownList.length > NOTIFICATION_SHOWN_MAX) {
    notificationShownList = notificationShownList.slice(-NOTIFICATION_SHOWN_MAX);
  }
  try {
    GM.setValue(NOTIFICATION_SHOWN_STORAGE_KEY, JSON.stringify(notificationShownList));
  } catch (_) {}
}

function normalizeNotificationId(id) {
  return id === undefined || id === null ? null : String(id);
}

setInjectedSafeModeState(readInjectedSafeModeBootstrap() === 'true', { broadcast: false });

function trackNotificationShown(id) {
  const normalized = normalizeNotificationId(id);
  if (!normalized) return;
  if (notificationShownIds.has(normalized)) return;
  notificationShownIds.add(normalized);
  notificationShownList.push(normalized);
  persistNotificationShownIds();
}

function appendLinkedText(target, rawText, options = {}) {
  const { enableTeleport = false, shortenWplace = true } = options;
  const text = String(rawText ?? '');
  target.textContent = '';
  const urlRegex = /https?:\/\/[^\s)]+/g;
  let lastIndex = 0;
  let hasMatch = false;
  for (const match of text.matchAll(urlRegex)) {
    hasMatch = true;
    const matchText = match[0];
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      target.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
    }
    const link = document.createElement('a');
    let linkLabel = matchText;
    let parsedCoords = null;
    try {
      const parsed = new URL(matchText);
      if (shortenWplace && parsed.hostname.endsWith('wplace.live')) {
        const lat = Number(parsed.searchParams.get('lat'));
        const lng = Number(parsed.searchParams.get('lng'));
        const zoom = Number(parsed.searchParams.get('zoom'));
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          parsedCoords = {
            lat,
            lng,
            zoom: Number.isFinite(zoom) ? zoom : null
          };
          const shortLat = lat.toFixed(3);
          const shortLng = lng.toFixed(3);
          linkLabel = `wplace@${shortLat},${shortLng}`;
        }
      }
    } catch (_) {}
    link.href = matchText;
    link.textContent = linkLabel;
    link.title = matchText;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (enableTeleport && parsedCoords) {
      link.dataset.lat = String(parsedCoords.lat);
      link.dataset.lng = String(parsedCoords.lng);
      if (Number.isFinite(parsedCoords.zoom)) {
        link.dataset.zoom = String(parsedCoords.zoom);
      }
      link.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
          return;
        }
        event.preventDefault();
        const lat = Number(link.dataset.lat);
        const lng = Number(link.dataset.lng);
        const zoom = Number(link.dataset.zoom);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        doAfterMapFound(async () => {
          await teleportToGeoCoords(lat, lng);
          if (Number.isFinite(zoom)) {
            setZoom(zoom);
          }
        });
      });
    }
    target.appendChild(link);
    lastIndex = matchIndex + matchText.length;
  }
  if (!hasMatch) {
    target.textContent = text;
    return;
  }
  if (lastIndex < text.length) {
    target.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function ensureNotificationContainer() {
  let container = document.getElementById('bm-notification-container');
  if (container) return container;
  container = document.createElement('div');
  container.id = 'bm-notification-container';
  container.style.display = 'none';
  container.dataset.layoutTheme = normalizeLayoutTheme(templateManager?.getLayoutTheme?.());
  const card = document.createElement('div');
  card.id = 'bm-notification';
  const close = document.createElement('button');
  close.id = 'bm-notification-close';
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Dismiss notification';
  close.addEventListener('click', () => {
    notificationCurrent = null;
    if (notificationQueue.length) {
      showNextNotification();
    } else {
      hideNotification();
      stopNotificationRotation();
    }
  });
  const text = document.createElement('span');
  text.id = 'bm-notification-text';
  const meta = document.createElement('span');
  meta.id = 'bm-notification-meta';
  card.appendChild(close);
  card.appendChild(text);
  card.appendChild(meta);
  container.appendChild(card);
  document.body?.appendChild(container);
  return container;
}

function renderNotification(notification) {
  const container = ensureNotificationContainer();
  const textEl = container.querySelector('#bm-notification-text');
  const metaEl = container.querySelector('#bm-notification-meta');
  if (!textEl || !metaEl) return;
  appendLinkedText(textEl, notification?.text ?? '', { enableTeleport: true, shortenWplace: true });
  const createdBy = notification?.created_by ? String(notification.created_by) : '';
  const createdAtRaw = notification?.created_at ? String(notification.created_at) : '';
  let createdAt = '';
  if (createdAtRaw) {
    const parsed = new Date(createdAtRaw);
    if (!Number.isNaN(parsed.getTime())) {
      createdAt = parsed.toLocaleString();
    }
  }
  const metaParts = [];
  if (createdBy) metaParts.push(`by ${createdBy}`);
  if (createdAt) metaParts.push(createdAt);
  if (metaParts.length > 0) {
    metaEl.textContent = metaParts.join(' • ');
    metaEl.style.display = 'block';
  } else {
    metaEl.textContent = '';
    metaEl.style.display = 'none';
  }
  container.style.display = 'flex';
}

function hideNotification() {
  const container = document.getElementById('bm-notification-container');
  if (container) {
    container.style.display = 'none';
  }
}

function showNextNotification() {
  if (!notificationQueue.length) {
    notificationCurrent = null;
    hideNotification();
    stopNotificationRotation();
    return;
  }
  const current = notificationQueue.shift();
  notificationCurrent = current;
  trackNotificationShown(current?.id);
  renderNotification(current);
}

function startNotificationRotation() {
  if (notificationRotateId) return;
  notificationRotateId = setInterval(showNextNotification, NOTIFICATION_ROTATE_MS);
  showNextNotification();
}

function stopNotificationRotation() {
  if (notificationRotateId) {
    clearInterval(notificationRotateId);
    notificationRotateId = null;
  }
}

async function fetchNotifications() {
  try {
    const response = await gmRequest(`${TEMPLATE_SYNC_BASE_URL}/notifications`, "json");
    const data = parseJsonResponse(response, {});
    const list = Array.isArray(data?.notifications) ? data.notifications : [];
    const cleaned = list.filter(item => item && item.text && item.id !== undefined && item.id !== null);
    const queuedIds = new Set(
      notificationQueue
        .map(item => normalizeNotificationId(item?.id))
        .filter(id => id)
    );
    const currentId = normalizeNotificationId(notificationCurrent?.id);
    let added = 0;
    for (const item of cleaned) {
      const id = normalizeNotificationId(item.id);
      if (!id) continue;
      if (id === currentId) continue;
      if (notificationShownIds.has(id)) continue;
      if (queuedIds.has(id)) continue;
      notificationQueue.push(item);
      queuedIds.add(id);
      added += 1;
    }
    if (notificationQueue.length) {
      startNotificationRotation();
      if (!notificationCurrent && added > 0) {
        showNextNotification();
      }
    } else if (!notificationCurrent) {
      hideNotification();
      stopNotificationRotation();
    }
  } catch (_) {
    // Ignore polling errors to avoid noisy UI
  }
}

function startNotificationPolling() {
  if (notificationPollId) return;
  loadNotificationShownIds()
    .finally(() => {
      if (notificationPollId) return;
      notificationPollId = setInterval(fetchNotifications, NOTIFICATION_POLL_MS);
      fetchNotifications();
    });
}

function initChat() {
  if (!isSafeModeActive() && templateManager.isMapCommentsEnabled()) {
    ensureMapCommentsManager();
  }
  const CHAT_USER_COLORS_STORAGE_KEY = 'bmChatUserColors';
  const CHAT_LAST_READ_ID_STORAGE_KEY = 'bmChatLastReadMessageId';
  const CHAT_NICKNAME_COLOR_VARIANTS = [
    '#ff6b6b', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
    '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#ef4444',
    '#fb7185', '#f472b6', '#60a5fa', '#2dd4bf', '#34d399', '#a3e635'
  ];
  const statusTextEl = document.getElementById('bm-chat-status-text');
  const messagesEl = document.getElementById('bm-chat-messages');
  const userInput = document.getElementById('bm-chat-user');
  const modCodeInput = document.getElementById('bm-chat-modcode');
  const modCodeRow = document.getElementById('bm-chat-modcode-row');
  const textInput = document.getElementById('bm-chat-text');
  const replyBar = document.getElementById('bm-chat-reply');
  const replyLabel = document.getElementById('bm-chat-reply-label');
  const replyText = document.getElementById('bm-chat-reply-text');
  const replyClear = document.getElementById('bm-chat-reply-clear');
  const modTools = document.getElementById('bm-chat-mod-tools');
  const banTypeSelect = document.getElementById('bm-chat-ban-type');
  const banTargetInput = document.getElementById('bm-chat-ban-target');
  const banReasonInput = document.getElementById('bm-chat-ban-reason');
  const chatDetails = document.getElementById('bm-contain-chat');
  if (!chatDetails) return;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let replyToId = null;
  let chatConnectionNonce = 0;
  const chatUserColors = new Map();
  let chatUserColorsPersistTimer = null;
  const messageCache = new Map();
  let unreadBadge = null;
  let lastReadPersistTimer = null;
  let lastReadMessageId = null;
  const unreadMessageIds = new Set();
  const pendingReplies = [];
  const PENDING_REPLY_WINDOW_MS = 30000;
  let mapCommentsFaulted = false;
  const handleMapCommentsError = (context, error) => {
    if (mapCommentsFaulted) return;
    mapCommentsFaulted = true;
    consoleWarn(`Map comments disabled after runtime error (${context}).`, error);
    try {
      mapCommentManager?.['destroy']?.();
    } catch (_) {}
    mapCommentManager = null;
  };
  const upsertMapCommentSafe = (payload, context) => {
    if (!mapCommentManager || mapCommentsFaulted) return;
    try {
      mapCommentManager['upsertFromChatPayload']?.(payload);
    } catch (error) {
      handleMapCommentsError(context, error);
    }
  };
  const removeMapCommentSafe = (messageId, context) => {
    if (!mapCommentManager || mapCommentsFaulted) return;
    try {
      mapCommentManager['removeByMessageId']?.(messageId);
    } catch (error) {
      handleMapCommentsError(context, error);
    }
  };
  const normalizeColor = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (/^#[0-9a-f]{6}$/i.test(text)) return text;
    if (/^hsl\(\s*\d{1,3}\s+[\d.]+%\s+[\d.]+%\s*\)$/i.test(text)) return text;
    return null;
  };
  const makeRandomChatColor = () => {
    const idx = Math.floor(Math.random() * CHAT_NICKNAME_COLOR_VARIANTS.length);
    return CHAT_NICKNAME_COLOR_VARIANTS[idx] || '#9cc8ff';
  };
  const schedulePersistChatColors = () => {
    if (chatUserColorsPersistTimer) return;
    chatUserColorsPersistTimer = setTimeout(() => {
      chatUserColorsPersistTimer = null;
      const payload = Object.fromEntries(chatUserColors.entries());
      GM.setValue(CHAT_USER_COLORS_STORAGE_KEY, JSON.stringify(payload));
    }, 300);
  };
  const loadChatUserColors = () => {
    GM.getValue(CHAT_USER_COLORS_STORAGE_KEY, '{}').then((raw) => {
      let parsed = {};
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {});
      } catch (_) {
        parsed = {};
      }
      if (!parsed || typeof parsed !== 'object') return;
      Object.entries(parsed).forEach(([key, value]) => {
        const normalizedKey = String(key ?? '').trim().toLowerCase();
        const normalizedValue = normalizeColor(value);
        if (!normalizedKey || !normalizedValue) return;
        if (!chatUserColors.has(normalizedKey)) {
          chatUserColors.set(normalizedKey, normalizedValue);
        }
      });
    }).catch(() => {});
  };
  const getChatUserColor = (userValue) => {
    const key = normalizeUser(userValue).toLowerCase();
    if (!key) return '#9cc8ff';
    let color = chatUserColors.get(key);
    if (!color) {
      color = makeRandomChatColor();
      chatUserColors.set(key, color);
      schedulePersistChatColors();
    }
    return color;
  };
  loadChatUserColors();

  if (!messagesEl || !textInput) return;
  const normalizeMessageId = (value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return null;
    if (/^[0-9]+$/.test(normalized)) {
      return normalized.replace(/^0+(?=\d)/, '');
    }
    return normalized;
  };
  const resolveIncomingMessageId = (payload) => normalizeMessageId(
    payload?.id
    ?? payload?.message_id
    ?? payload?.msg_id
    ?? payload?.messageId
  );
  const isNumericMessageId = (value) => /^[0-9]+$/.test(value);
  const compareMessageIds = (leftValue, rightValue) => {
    const left = normalizeMessageId(leftValue);
    const right = normalizeMessageId(rightValue);
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    const leftIsNumeric = isNumericMessageId(left);
    const rightIsNumeric = isNumericMessageId(right);
    if (leftIsNumeric && rightIsNumeric) {
      if (left.length !== right.length) return left.length > right.length ? 1 : -1;
      if (left === right) return 0;
      return left > right ? 1 : -1;
    }
    if (left === right) return 0;
    return left > right ? 1 : -1;
  };
  const renderUnreadBadge = () => {
    if (!unreadBadge) return;
    const count = unreadMessageIds.size;
    if (count > 0) {
      unreadBadge.textContent = count > 99 ? '99+' : String(count);
      unreadBadge.style.display = 'inline-flex';
      unreadBadge.title = `${count} unread message${count === 1 ? '' : 's'}`;
      return;
    }
    unreadBadge.textContent = '';
    unreadBadge.style.display = 'none';
    unreadBadge.title = '';
  };
  const schedulePersistLastReadMessageId = () => {
    if (!lastReadMessageId) return;
    if (lastReadPersistTimer) return;
    lastReadPersistTimer = setTimeout(() => {
      lastReadPersistTimer = null;
      if (!lastReadMessageId) return;
      GM.setValue(CHAT_LAST_READ_ID_STORAGE_KEY, lastReadMessageId).catch(() => {});
    }, 200);
  };
  const pruneUnreadByLastRead = () => {
    if (!lastReadMessageId || !unreadMessageIds.size) return;
    for (const unreadId of Array.from(unreadMessageIds)) {
      if (compareMessageIds(unreadId, lastReadMessageId) <= 0) {
        unreadMessageIds.delete(unreadId);
      }
    }
  };
  const setLastReadMessageId = (messageId, options = {}) => {
    const normalized = normalizeMessageId(messageId);
    if (!normalized) return;
    if (compareMessageIds(normalized, lastReadMessageId) <= 0) return;
    lastReadMessageId = normalized;
    pruneUnreadByLastRead();
    renderUnreadBadge();
    if (options.persist !== false) {
      schedulePersistLastReadMessageId();
    }
  };
  const isChatVisibleAndOpen = () => Boolean(chatDetails.open && chatDetails.style.display !== 'none');
  const getLatestRenderedMessageId = () => {
    const rows = messagesEl.querySelectorAll('.bm-chat-message[data-msg-id]');
    for (let i = rows.length - 1; i >= 0; i--) {
      const id = normalizeMessageId(rows[i].getAttribute('data-msg-id'));
      if (id) return id;
    }
    return null;
  };
  const markChatAsRead = () => {
    const latest = getLatestRenderedMessageId();
    if (latest) {
      setLastReadMessageId(latest);
    }
    if (!unreadMessageIds.size) return;
    unreadMessageIds.clear();
    renderUnreadBadge();
  };
  const trackIncomingUnread = (messageId) => {
    const normalized = normalizeMessageId(messageId);
    if (!normalized) return;
    if (isChatVisibleAndOpen()) {
      setLastReadMessageId(normalized);
      if (!unreadMessageIds.size) return;
      unreadMessageIds.clear();
      renderUnreadBadge();
      return;
    }
    if (compareMessageIds(normalized, lastReadMessageId) <= 0) return;
    unreadMessageIds.add(normalized);
    renderUnreadBadge();
  };
  const setModCodeVisible = (visible) => {
    if (modCodeRow) {
      modCodeRow.style.display = visible ? 'flex' : 'none';
    }
    if (modCodeInput) {
      modCodeInput.style.display = visible ? '' : 'none';
    }
  };
  textInput.maxLength = CHAT_MAX_TEXT_LEN;
  if (userInput) {
    userInput.maxLength = CHAT_MAX_USER_LEN;
  }
  if (modCodeInput || modCodeRow) {
    setModCodeVisible(false);
  }
  // keep status row visible for connection indicator

  const chatSummary = chatDetails?.querySelector('summary');
  let chatFloatToggleBtn = null;
  let isChatFloating = false;
  let dragState = null;
  let floatingResizeObserver = null;
  let floatingExpandedWidth = '360px';
  let floatingExpandedHeight = '420px';
  const CHAT_FLOAT_ICON = '⧉';
  const CHAT_DOCK_ICON = '⇱';
  const originalChatParent = chatDetails.parentElement;
  const originalChatNextSibling = chatDetails.nextElementSibling;
  const overlayRoot = document.getElementById('bm-overlay');
  const floatingVarNames = [];
  let bansWindow = null;
  let bansWindowCount = null;
  let bansWindowList = null;
  let bansWindowDragState = null;
  let bansWindowMoveHandler = null;
  let bansWindowUpHandler = null;
  const BANS_WINDOW_MIN_W = 280;
  const BANS_WINDOW_MIN_H = 220;
  const BANS_WINDOW_DEFAULT_W = 380;
  const BANS_WINDOW_DEFAULT_H = 360;

  const applyOverlayVarsToElement = (element, trackedNames = null) => {
    if (!overlayRoot || !element) return;
    if (trackedNames) {
      trackedNames.length = 0;
    }
    const computed = getComputedStyle(overlayRoot);
    for (let i = 0; i < computed.length; i++) {
      const propName = computed[i];
      if (!propName || !propName.startsWith('--bm-')) continue;
      const propValue = computed.getPropertyValue(propName);
      if (!propValue) continue;
      element.style.setProperty(propName, propValue);
      if (trackedNames) {
        trackedNames.push(propName);
      }
    }
  };

  const applyFloatingThemeVars = () => {
    applyOverlayVarsToElement(chatDetails, floatingVarNames);
  };

  const clearFloatingThemeVars = () => {
    while (floatingVarNames.length) {
      const propName = floatingVarNames.pop();
      chatDetails.style.removeProperty(propName);
    }
  };
  const refreshChatThemeFromOverlay = () => {
    if (!isChatFloating) return;
    clearFloatingThemeVars();
    applyFloatingThemeVars();
    updateFloatingMessagesHeight();
  };
  const refreshBansThemeFromOverlay = () => {
    if (!bansWindow || bansWindow.style.display === 'none') return;
    applyOverlayVarsToElement(bansWindow);
  };
  const hideBansWindow = () => {
    if (!bansWindow) return;
    bansWindow.style.display = 'none';
  };
  const ensureBansWindow = () => {
    if (bansWindow && bansWindow.isConnected) return bansWindow;
    const panel = document.createElement('section');
    panel.id = 'bm-chat-bans-window';
    panel.className = 'bm-chat-bans-window';
    panel.style.display = 'none';
    panel.style.width = `${BANS_WINDOW_DEFAULT_W}px`;
    panel.style.height = `${BANS_WINDOW_DEFAULT_H}px`;
    panel.style.minWidth = `${BANS_WINDOW_MIN_W}px`;
    panel.style.minHeight = `${BANS_WINDOW_MIN_H}px`;
    panel.style.right = '24px';
    panel.style.bottom = '24px';

    const head = document.createElement('div');
    head.className = 'bm-chat-bans-window-head';
    head.title = 'Drag to move';

    const title = document.createElement('span');
    title.className = 'bm-chat-bans-window-title';
    title.textContent = 'Active Bans';
    head.appendChild(title);

    bansWindowCount = document.createElement('span');
    bansWindowCount.className = 'bm-chat-bans-window-count';
    bansWindowCount.textContent = '0';
    head.appendChild(bansWindowCount);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'bm-chat-bans-window-close';
    closeBtn.textContent = '✖';
    closeBtn.title = 'Close bans window';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideBansWindow();
    });
    head.appendChild(closeBtn);
    panel.appendChild(head);

    bansWindowList = document.createElement('div');
    bansWindowList.className = 'bm-chat-bans-window-list';
    panel.appendChild(bansWindowList);

    head.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      bansWindowDragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      bansWindowMoveHandler = (moveEvent) => {
        if (!bansWindowDragState) return;
        const currentRect = panel.getBoundingClientRect();
        const maxLeft = Math.max(8, window.innerWidth - currentRect.width - 8);
        const maxTop = Math.max(8, window.innerHeight - currentRect.height - 8);
        const left = Math.min(maxLeft, Math.max(8, moveEvent.clientX - bansWindowDragState.offsetX));
        const top = Math.min(maxTop, Math.max(8, moveEvent.clientY - bansWindowDragState.offsetY));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      };
      bansWindowUpHandler = () => {
        bansWindowDragState = null;
        if (bansWindowMoveHandler) {
          window.removeEventListener('mousemove', bansWindowMoveHandler);
          bansWindowMoveHandler = null;
        }
        if (bansWindowUpHandler) {
          window.removeEventListener('mouseup', bansWindowUpHandler);
          bansWindowUpHandler = null;
        }
      };
      window.addEventListener('mousemove', bansWindowMoveHandler);
      window.addEventListener('mouseup', bansWindowUpHandler);
      event.preventDefault();
    });

    document.body.appendChild(panel);
    bansWindow = panel;
    applyOverlayVarsToElement(bansWindow);
    return panel;
  };
  const showBansWindow = (bans) => {
    const isLikelyMessageId = (value) => {
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value !== 'string') return false;
      const trimmed = value.trim();
      return /^[0-9]+$/.test(trimmed);
    };
    const parseBanMessageEntry = (value) => {
      if (Array.isArray(value)) {
        return {
          id: value.length > 0 ? value[0] : null,
          text: value.length > 1 ? String(value[1] ?? '').trim() : ''
        };
      }
      if (value && typeof value === 'object') {
        return {
          id: value.id ?? value.message_id ?? value.msg_id ?? null,
          text: String(value.text ?? value.message ?? value.body ?? '').trim()
        };
      }
      return { id: null, text: String(value ?? '').trim() };
    };
    const normalizeBanMessages = (rawMessages) => {
      if (!Array.isArray(rawMessages) || !rawMessages.length) return [];

      if (
        rawMessages.length === 2
        && !Array.isArray(rawMessages[0])
        && !Array.isArray(rawMessages[1])
        && (!(rawMessages[0] && typeof rawMessages[0] === 'object'))
        && (!(rawMessages[1] && typeof rawMessages[1] === 'object'))
        && isLikelyMessageId(rawMessages[0])
      ) {
        return [parseBanMessageEntry(rawMessages)];
      }

      if (rawMessages.every(item => item && typeof item === 'object')) {
        return rawMessages.map(parseBanMessageEntry);
      }

      if (
        rawMessages.length % 2 === 0
        && rawMessages.every((item, index) => (
          index % 2 === 0 ? isLikelyMessageId(item) : (typeof item === 'string' || typeof item === 'number')
        ))
      ) {
        const pairs = [];
        for (let i = 0; i < rawMessages.length; i += 2) {
          pairs.push(parseBanMessageEntry([rawMessages[i], rawMessages[i + 1]]));
        }
        return pairs;
      }

      return rawMessages.map(parseBanMessageEntry);
    };

    const panel = ensureBansWindow();
    applyOverlayVarsToElement(panel);
    const list = Array.isArray(bans) ? bans : [];
    if (bansWindowCount) {
      bansWindowCount.textContent = String(list.length);
    }
    if (bansWindowList) {
      bansWindowList.textContent = '';
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'bm-chat-bans-window-empty';
        empty.textContent = 'No active bans.';
        bansWindowList.appendChild(empty);
      } else {
        list.forEach((entry) => {
          const item = document.createElement('article');
          item.className = 'bm-chat-bans-window-item';

          const banId = Number.isFinite(Number(entry?.id)) ? Number(entry.id) : null;
          const typeLabel = String(entry?.type || 'unknown');
          const identifier = String(entry?.identifier || entry?.ip || entry?.device_id || '?');
          const reason = String(entry?.reason || '').trim();
          const tsRaw = String(entry?.banned_at || entry?.created_at || '').trim();
          const messages = normalizeBanMessages(entry?.messages);
          const firstText = String(messages[0]?.text || '').trim();

          const title = document.createElement('div');
          title.className = 'bm-chat-bans-window-item-title';
          title.textContent = `#${banId ?? '?'} ${typeLabel}`;
          item.appendChild(title);

          const ident = document.createElement('div');
          ident.className = 'bm-chat-bans-window-item-ident';
          ident.textContent = identifier;
          item.appendChild(ident);

          if (reason) {
            const reasonEl = document.createElement('div');
            reasonEl.className = 'bm-chat-bans-window-item-reason';
            reasonEl.textContent = reason;
            item.appendChild(reasonEl);
          }

          if (tsRaw) {
            const tsEl = document.createElement('div');
            tsEl.className = 'bm-chat-bans-window-item-time';
            tsEl.textContent = tsRaw;
            item.appendChild(tsEl);
          }

          const msgMeta = document.createElement('div');
          msgMeta.className = 'bm-chat-bans-window-item-meta';
          msgMeta.textContent = `Messages: ${messages.length}`;
          item.appendChild(msgMeta);

          if (firstText) {
            const sample = document.createElement('div');
            sample.className = 'bm-chat-bans-window-item-sample';
            sample.textContent = clipText(firstText, 90);
            item.appendChild(sample);
          }

          if (banId !== null) {
            const unbanBtn = document.createElement('button');
            unbanBtn.type = 'button';
            unbanBtn.className = 'bm-chat-bans-window-item-use';
            unbanBtn.textContent = 'Unban';
            unbanBtn.title = `Unban #${banId}`;
            unbanBtn.addEventListener('click', () => {
              moderateUnban(banId, () => {
                fetchBans();
              });
            });
            item.appendChild(unbanBtn);
          }

          bansWindowList.appendChild(item);
        });
      }
    }
    panel.style.display = '';
  };
  if (chatSummary) {
    chatSummary.classList.add('bm-chat-summary');
    if (!chatSummary.querySelector('.bm-chat-status-light')) {
      const light = document.createElement('span');
      light.className = 'bm-chat-status-light';
      light.title = 'Chat status';
      chatSummary.appendChild(light);
    }
    chatFloatToggleBtn = document.createElement('button');
    chatFloatToggleBtn.type = 'button';
    chatFloatToggleBtn.className = 'bm-chat-float-toggle';
    chatFloatToggleBtn.textContent = CHAT_FLOAT_ICON;
    chatFloatToggleBtn.setAttribute('aria-label', 'Float chat');
    chatFloatToggleBtn.title = 'Open chat in floating window';
    unreadBadge = chatSummary.querySelector('.bm-chat-unread-badge');
    if (!unreadBadge) {
      unreadBadge = document.createElement('span');
      unreadBadge.className = 'bm-chat-unread-badge';
      unreadBadge.style.display = 'none';
    }
    const statusLight = chatSummary.querySelector('.bm-chat-status-light');
    if (statusLight) {
      chatSummary.insertBefore(chatFloatToggleBtn, statusLight);
      chatSummary.insertBefore(unreadBadge, statusLight);
    } else {
      chatSummary.appendChild(chatFloatToggleBtn);
      chatSummary.appendChild(unreadBadge);
    }
  }
  renderUnreadBadge();

  const outerHeight = (element) => {
    if (!element) return 0;
    const computed = getComputedStyle(element);
    if (computed.display === 'none') return 0;
    const marginTop = parseFloat(computed.marginTop) || 0;
    const marginBottom = parseFloat(computed.marginBottom) || 0;
    return element.offsetHeight + marginTop + marginBottom;
  };

  const updateFloatingMessagesHeight = () => {
    if (!isChatFloating) return;
    if (!chatDetails?.open) return;
    const chatComputed = getComputedStyle(chatDetails);
    const paddingTop = parseFloat(chatComputed.paddingTop) || 0;
    const paddingBottom = parseFloat(chatComputed.paddingBottom) || 0;
    const totalHeight = chatDetails.clientHeight;
    const occupied =
      outerHeight(chatSummary) +
      outerHeight(modTools) +
      outerHeight(replyBar) +
      outerHeight(document.getElementById('bm-chat-input-row')) +
      outerHeight(modCodeRow) +
      paddingTop +
      paddingBottom;
    const nextHeight = Math.max(80, Math.floor(totalHeight - occupied - 6));
    messagesEl.style.height = `${nextHeight}px`;
  };

  const scrollChatToBottom = () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };
  const captureChatViewport = () => {
    const scrollTop = messagesEl.scrollTop;
    const clientHeight = messagesEl.clientHeight;
    const scrollHeight = messagesEl.scrollHeight;
    const nearBottom = (scrollHeight - (scrollTop + clientHeight)) <= 4;
    const rows = Array.from(messagesEl.querySelectorAll('.bm-chat-message'));
    let anchorId = null;
    let anchorElement = null;
    let anchorIndex = -1;
    let anchorOffset = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowTop = row.offsetTop;
      const rowBottom = rowTop + row.offsetHeight;
      if (rowBottom > scrollTop) {
        anchorId = row.getAttribute('data-msg-id');
        anchorElement = row;
        anchorIndex = i;
        anchorOffset = scrollTop - rowTop;
        break;
      }
    }
    return {
      scrollTop,
      nearBottom,
      anchorId,
      anchorElement,
      anchorIndex,
      anchorOffset
    };
  };
  const restoreChatViewport = (state) => {
    if (!state) return;
    if (state.nearBottom) {
      scrollChatToBottom();
      return;
    }
    if (state.anchorId) {
      const row = Array.from(messagesEl.querySelectorAll('.bm-chat-message'))
        .find(item => item.getAttribute('data-msg-id') === state.anchorId);
      if (row) {
        messagesEl.scrollTop = Math.max(0, row.offsetTop + state.anchorOffset);
        return;
      }
    }
    if (state.anchorElement && state.anchorElement.isConnected) {
      messagesEl.scrollTop = Math.max(0, state.anchorElement.offsetTop + state.anchorOffset);
      return;
    }
    if (Number.isInteger(state.anchorIndex) && state.anchorIndex >= 0) {
      const rows = Array.from(messagesEl.querySelectorAll('.bm-chat-message'));
      const row = rows[state.anchorIndex];
      if (row) {
        messagesEl.scrollTop = Math.max(0, row.offsetTop + state.anchorOffset);
        return;
      }
    }
    const maxTop = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight);
    messagesEl.scrollTop = Math.min(Math.max(0, state.scrollTop), maxTop);
  };

  const syncFloatingCollapsedState = () => {
    if (!chatDetails) return;
    if (!isChatFloating) {
      chatDetails.classList.remove('bm-chat-floating-collapsed');
      return;
    }
    if (chatDetails.open) {
      chatDetails.classList.remove('bm-chat-floating-collapsed');
      chatDetails.style.width = floatingExpandedWidth;
      chatDetails.style.height = floatingExpandedHeight;
      updateFloatingMessagesHeight();
      return;
    }
    const rect = chatDetails.getBoundingClientRect();
    if (rect.width > 0) floatingExpandedWidth = `${Math.round(rect.width)}px`;
    if (rect.height > 0) floatingExpandedHeight = `${Math.round(rect.height)}px`;
    chatDetails.classList.add('bm-chat-floating-collapsed');
    chatDetails.style.width = '220px';
    chatDetails.style.height = 'auto';
    messagesEl.style.height = '';
  };

  const setChatFloating = (enabled) => {
    const viewportState = captureChatViewport();
    isChatFloating = Boolean(enabled);
    chatDetails.classList.toggle('bm-chat-floating', isChatFloating);
    if (chatFloatToggleBtn) {
      chatFloatToggleBtn.textContent = isChatFloating ? CHAT_DOCK_ICON : CHAT_FLOAT_ICON;
      chatFloatToggleBtn.setAttribute('aria-label', isChatFloating ? 'Dock chat' : 'Float chat');
      chatFloatToggleBtn.title = isChatFloating ? 'Return chat to main layout' : 'Open chat in floating window';
    }
    if (isChatFloating) {
      if (chatDetails.parentElement !== document.body) {
        document.body.appendChild(chatDetails);
      }
      clearFloatingThemeVars();
      applyFloatingThemeVars();
      chatDetails.open = true;
      if (!chatDetails.style.width) chatDetails.style.width = floatingExpandedWidth;
      if (!chatDetails.style.height || chatDetails.style.height === 'auto') chatDetails.style.height = floatingExpandedHeight;
      if (!chatDetails.style.left && !chatDetails.style.right) chatDetails.style.right = '20px';
      if (!chatDetails.style.top && !chatDetails.style.bottom) chatDetails.style.bottom = '20px';
      syncFloatingCollapsedState();
      updateFloatingMessagesHeight();
      if (!floatingResizeObserver) {
        floatingResizeObserver = new ResizeObserver(() => updateFloatingMessagesHeight());
      }
      floatingResizeObserver.observe(chatDetails);
    } else {
      if (floatingResizeObserver) {
        floatingResizeObserver.disconnect();
      }
      if (originalChatParent) {
        if (originalChatNextSibling && originalChatNextSibling.parentElement === originalChatParent) {
          originalChatParent.insertBefore(chatDetails, originalChatNextSibling);
        } else {
          originalChatParent.appendChild(chatDetails);
        }
      }
      clearFloatingThemeVars();
      chatDetails.classList.remove('bm-chat-floating-collapsed');
      chatDetails.style.left = '';
      chatDetails.style.top = '';
      chatDetails.style.right = '';
      chatDetails.style.bottom = '';
      chatDetails.style.width = '';
      chatDetails.style.height = '';
      messagesEl.style.height = '';
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreChatViewport(viewportState);
      });
    });
  };

  if (chatFloatToggleBtn) {
    chatFloatToggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setChatFloating(!isChatFloating);
    });
  }

  if (chatSummary) {
    chatSummary.addEventListener('mousedown', (event) => {
      if (!isChatFloating) return;
      if (event.button !== 0) return;
      if (chatFloatToggleBtn && chatFloatToggleBtn.contains(event.target)) return;
      const rect = chatDetails.getBoundingClientRect();
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false
      };
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event) => {
      if (!dragState || !isChatFloating) return;
      const dx = Math.abs(event.clientX - dragState.startX);
      const dy = Math.abs(event.clientY - dragState.startY);
      if (!dragState.moved && (dx > 3 || dy > 3)) {
        dragState.moved = true;
      }
      const rect = chatDetails.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      const left = Math.min(maxLeft, Math.max(8, event.clientX - dragState.offsetX));
      const top = Math.min(maxTop, Math.max(8, event.clientY - dragState.offsetY));
      chatDetails.style.left = `${left}px`;
      chatDetails.style.top = `${top}px`;
      chatDetails.style.right = 'auto';
      chatDetails.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!dragState) return;
      if (dragState.moved) {
        const blockClick = (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          chatSummary.removeEventListener('click', blockClick, true);
        };
        chatSummary.addEventListener('click', blockClick, true);
      }
      dragState = null;
    });
  }

  chatDetails?.addEventListener('toggle', () => {
    syncFloatingCollapsedState();
    if (chatDetails.open) {
      markChatAsRead();
    }
  });
  document.addEventListener('bm-layout-theme-changed', () => {
    refreshChatThemeFromOverlay();
    refreshBansThemeFromOverlay();
  });

  window.addEventListener('resize', () => updateFloatingMessagesHeight());

  const setStatus = (text) => {
    if (statusTextEl) {
      statusTextEl.textContent = `Status: ${text}`;
    }
    if (!chatDetails) return;
    const lowered = String(text || '').toLowerCase();
    let nextState = null;
    if (lowered.includes('connecting') || lowered.includes('reconnecting')) {
      nextState = 'connecting';
    } else if (lowered.includes('disconnected')) {
      nextState = 'error';
    } else if (lowered.includes('banned')) {
      nextState = 'error';
    } else if (lowered === 'connected') {
      nextState = 'connected';
    } else if (lowered === 'error') {
      nextState = 'error';
    }
    if (!nextState) return;
    chatDetails.classList.remove('bm-chat-state-connected', 'bm-chat-state-connecting', 'bm-chat-state-error');
    if (nextState === 'connecting') {
      chatDetails.classList.add('bm-chat-state-connecting');
    } else if (nextState === 'connected') {
      chatDetails.classList.add('bm-chat-state-connected');
    } else {
      chatDetails.classList.add('bm-chat-state-error');
    }
    updateFloatingMessagesHeight();
  };

  const getModCode = () => modCodeInput?.value?.trim() || '';
  const getUserName = () => normalizeUser(userInput?.value || document.getElementById('bm-user-name')?.textContent);
  const getDeviceId = () => {
    try {
      return localStorage.getItem('device_id') || '';
    } catch (_) {
      return '';
    }
  };
  const getAuthToken = () => {
    try {
      return localStorage.getItem('auth_token') || '';
    } catch (_) {
      return '';
    }
  };
  let rateLimitUntilTs = 0;
  let rateLimitTimer = null;
  let bannedInfo = null;
  let pendingSendRestore = null;
  const defaultChatTextPlaceholder = textInput.placeholder || 'Message';
  const clipText = (value, max = 120) => {
    const text = String(value ?? '');
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
  };
  const normalizeUser = (value) => {
    const name = String(value ?? '').trim().slice(0, CHAT_MAX_USER_LEN);
    return name || 'anon';
  };
  const enforceInputLimit = (input, maxLength) => {
    if (!input) return;
    const value = String(input.value ?? '');
    if (value.length <= maxLength) return;
    const nextValue = value.slice(0, maxLength);
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    input.value = nextValue;
    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      const nextStart = Math.min(maxLength, selectionStart);
      const nextEnd = Math.min(maxLength, selectionEnd);
      try {
        input.setSelectionRange(nextStart, nextEnd);
      } catch (_) {}
    }
  };
  const prunePendingReplies = (now = Date.now()) => {
    while (pendingReplies.length && now - pendingReplies[0].ts > PENDING_REPLY_WINDOW_MS) {
      pendingReplies.shift();
    }
  };
  const queuePendingReply = (user, text, replyId) => {
    pendingReplies.push({
      user: normalizeUser(user),
      text: String(text ?? ''),
      replyToId: String(replyId),
      ts: Date.now()
    });
  };
  const applyPendingReply = (payload) => {
    if (payload?.reply_to !== undefined && payload?.reply_to !== null && payload?.reply_to !== '') return;
    const user = normalizeUser(payload?.user);
    const text = String(payload?.text ?? '');
    const now = Date.now();
    prunePendingReplies(now);
    const index = pendingReplies.findIndex((entry) => entry.user === user && entry.text === text);
    if (index === -1) return;
    payload.reply_to = pendingReplies[index].replyToId;
    pendingReplies.splice(index, 1);
  };

  const clearReply = () => {
    replyToId = null;
    if (replyBar) replyBar.style.display = 'none';
    updateFloatingMessagesHeight();
  };

  const setReplyTo = (id) => {
    if (id === undefined || id === null || id === '') return;
    replyToId = String(id);
    const cached = messageCache.get(replyToId);
    if (replyBar) {
      replyBar.style.display = '';
    }
    if (replyLabel) {
      replyLabel.textContent = cached?.user ? `Replying to ${cached.user}` : `Replying to #${replyToId}`;
    }
    if (replyText) {
      replyText.textContent = clipText(cached?.text || '');
    }
    updateFloatingMessagesHeight();
  };
  const isChatDisabled = () => templateManager?.isChatDisabled?.() ?? false;

  const moderateDelete = (messageId) => {
    const code = getModCode();
    if (!code) {
      setStatus('missing moderation code');
      return;
    }
    GM_xmlhttpRequest({
      method: "POST",
      url: `${TEMPLATE_SYNC_BASE_URL}/chat/moderate/delete`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ code, id: messageId }),
      onload: (response) => {
        if (response.status >= 200 && response.status < 300) {
          setStatus('moderation delete sent');
        } else {
          setStatus(`moderation failed (${response.status})`);
        }
      },
      onerror: () => setStatus('moderation error')
    });
  };

  const parseBanTarget = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return { raw, id };
  };

  const postModerationAction = (endpoint, payload, successStatus = 'moderation ok', onSuccess = null) => {
    const requestPayload = { ...(payload || {}) };
    if (requestPayload.code !== undefined && requestPayload.secret_code === undefined) {
      requestPayload.secret_code = requestPayload.code;
    }
    GM_xmlhttpRequest({
      method: "POST",
      url: `${TEMPLATE_SYNC_BASE_URL}${endpoint}`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(requestPayload),
      onload: (response) => {
        if (response.status >= 200 && response.status < 300) {
          const data = parseJsonResponse(response, {});
          const suffix = data?.id !== undefined && data?.id !== null ? ` (#${data.id})` : '';
          setStatus(`${successStatus}${suffix}`);
          if (typeof onSuccess === 'function') {
            try {
              onSuccess(data);
            } catch (_) {}
          }
        } else {
          setStatus(`moderation failed (${response.status})`);
        }
      },
      onerror: () => setStatus('moderation error')
    });
  };

  const moderateBan = (target, type, reasonText = '') => {
    const code = getModCode();
    if (!code) {
      setStatus('missing moderation code');
      return;
    }
    const parsed = parseBanTarget(target);
    if (!parsed) {
      setStatus('invalid message id');
      return;
    }
    const normalizedType = type === 'device' ? 'device' : 'ip';
    const reason = String(reasonText ?? '').trim();
    if (!reason) {
      setStatus('ban reason required');
      banReasonInput?.focus();
      return;
    }
    const payload = {
      code,
      message_id: parsed.id,
      type: normalizedType,
      reason
    };
    postModerationAction('/chat/moderate/ban', payload, `ban sent (${normalizedType})`);
  };

  const moderateUnban = (target, onSuccess = null) => {
    const code = getModCode();
    if (!code) {
      setStatus('missing moderation code');
      return;
    }
    const parsed = parseBanTarget(target);
    if (!parsed) {
      setStatus('invalid ban id');
      return;
    }
    postModerationAction('/chat/moderate/unban', { code, ban_id: parsed.id }, 'unban sent', onSuccess);
  };

  const fetchBans = () => {
    const code = getModCode();
    if (!code) {
      setStatus('missing moderation code');
      return;
    }
    const requestBans = (path, fallbackPath = null) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `${TEMPLATE_SYNC_BASE_URL}${path}?code=${encodeURIComponent(code)}`,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            if (fallbackPath) {
              requestBans(fallbackPath, null);
              return;
            }
            setStatus(`moderation failed (${response.status})`);
            return;
          }
          const data = parseJsonResponse(response, {});
          const list = Array.isArray(data?.banned)
            ? data.banned
            : Array.isArray(data)
              ? data
              : [];
          if (!list.length) {
            setStatus('no bans');
            showBansWindow([]);
            return;
          }
          setStatus(`active bans: ${list.length}`);
          showBansWindow(list);
        },
        onerror: () => {
          if (fallbackPath) {
            requestBans(fallbackPath, null);
            return;
          }
          setStatus('moderation error');
        }
      });
    };
    requestBans('/chat/moderate/banned', '/chat/banned');
  };

  const ensureDeleteButton = (row) => {
    const messageId = row.getAttribute('data-msg-id');
    const messageIdNum = messageId ? Number(messageId) : NaN;
    const existing = row.querySelector('.bm-chat-delete');
    const code = getModCode();
    if (!code || !Number.isFinite(messageIdNum)) {
      if (existing) existing.remove();
      row.style.position = '';
      row.style.paddingRight = '';
      row.removeAttribute('data-mod-message-id');
      row.removeAttribute('title');
      return;
    }
    row.style.position = 'relative';
    row.style.paddingRight = '18px';
    row.setAttribute('data-mod-message-id', `ID ${messageId}`);
    row.title = `Message ID: ${messageId}`;
    if (existing) return;
    const btn = document.createElement('button');
    btn.className = 'bm-chat-delete';
    btn.type = 'button';
    btn.textContent = '✖';
    btn.title = 'Delete message';
    btn.style.position = 'absolute';
    btn.style.top = '2px';
    btn.style.right = '2px';
    btn.style.marginLeft = '0';
    btn.style.background = 'transparent';
    btn.style.border = '1px solid var(--bm-border-strong)';
    btn.style.color = 'var(--bm-accent-strong)';
    btn.style.borderRadius = '50%';
    btn.style.width = '14px';
    btn.style.height = '14px';
    btn.style.minWidth = '14px';
    btn.style.minHeight = '14px';
    btn.style.padding = '0';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.fontSize = '9px';
    btn.style.lineHeight = '1';
    btn.style.zIndex = '2';
    btn.style.pointerEvents = 'auto';
    btn.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      moderateDelete(messageIdNum);
    });
    row.appendChild(btn);
  };

  const renderModerationControls = () => {
    const rows = messagesEl.querySelectorAll('.bm-chat-message');
    rows.forEach(ensureDeleteButton);
    if (modTools) {
      modTools.style.display = getModCode() ? 'flex' : 'none';
    }
    updateFloatingMessagesHeight();
  };

  const isRateLimited = () => rateLimitUntilTs > Date.now();
  const getRateLimitSeconds = () => Math.max(0, (rateLimitUntilTs - Date.now()) / 1000);
  const isBanned = () => Boolean(bannedInfo);
  const clearRateLimitTimer = () => {
    if (rateLimitTimer) {
      clearInterval(rateLimitTimer);
      rateLimitTimer = null;
    }
  };
  const restoreChatInputState = () => {
    if (isBanned()) return;
    if (isRateLimited()) return;
    textInput.disabled = false;
    textInput.placeholder = defaultChatTextPlaceholder;
  };
  const clearRateLimitState = () => {
    rateLimitUntilTs = 0;
    clearRateLimitTimer();
    restoreChatInputState();
  };
  const restoreFailedSendDraft = () => {
    if (!pendingSendRestore) return;
    if (Date.now() - pendingSendRestore.ts > 15000) {
      pendingSendRestore = null;
      return;
    }
    if (String(textInput.value || '').trim()) return;
    textInput.value = pendingSendRestore.text;
    if (pendingSendRestore.replyToId) {
      setReplyTo(pendingSendRestore.replyToId);
    }
    pendingSendRestore = null;
  };
  const clearPendingSendRestoreIfMatch = (user, text, payloadReplyTo) => {
    if (!pendingSendRestore) return;
    const sameText = String(pendingSendRestore.text || '') === String(text || '');
    const sameUser = String(user || '') === String(getUserName() || '');
    const pendingReply = pendingSendRestore.replyToId ? String(pendingSendRestore.replyToId) : '';
    const incomingReply = payloadReplyTo ? String(payloadReplyTo) : '';
    const sameReply = pendingReply === incomingReply;
    if (sameText && sameUser && sameReply) {
      pendingSendRestore = null;
    }
  };

  const appendMessage = (payload, options = {}) => {
    const isSystem = Boolean(options?.isSystem);
    // Normalize user field from possible server keys for compatibility; prefer non-anon usernames when provided
    if (!isSystem) {
      const candidateUser = payload?.user ?? payload?.username ?? payload?.name ?? payload?.Lt;
      const fallbackUser = payload?.username ?? payload?.name ?? payload?.Lt;
      const resolvedUser = (candidateUser && candidateUser !== 'anon')
        ? candidateUser
        : (fallbackUser && fallbackUser !== 'anon')
          ? fallbackUser
          : 'anon';
      payload.user = normalizeUser(resolvedUser);
      applyPendingReply(payload);
    } else {
      payload.user = String(payload?.user || 'system').trim() || 'system';
    }
    const user = payload.user;
    const text = payload?.text || '';
    const ts = payload?.ts ? new Date(payload.ts) : new Date();
    const messageId = resolveIncomingMessageId(payload);
    if (messageId) {
      payload.id = messageId;
      if (messageCache.has(messageId)) {
        if (!isSystem) {
          upsertMapCommentSafe(payload, 'appendMessage:duplicate');
          clearPendingSendRestoreIfMatch(user, text, payload?.reply_to);
        }
        return;
      }
      messageCache.set(messageId, payload);
      const existingLine = Array.from(messagesEl.querySelectorAll('.bm-chat-message[data-msg-id]'))
        .find((item) => item.getAttribute('data-msg-id') === messageId);
      if (existingLine) {
        if (!isSystem) {
          upsertMapCommentSafe(payload, 'appendMessage:duplicate');
          clearPendingSendRestoreIfMatch(user, text, payload?.reply_to);
        }
        return;
      }
    }
    const line = document.createElement('div');
    line.className = 'bm-chat-message';
    if (isSystem) {
      line.classList.add('bm-chat-system');
      if (options?.systemKind === 'banned') {
        line.classList.add('bm-chat-system-banned');
      } else if (options?.systemKind === 'rate_limit') {
        line.classList.add('bm-chat-system-rate-limit');
      }
    }
    if (messageId) {
      line.setAttribute('data-msg-id', messageId);
    }
    if (!isSystem) {
      upsertMapCommentSafe(payload, 'appendMessage');
    }
    const replyId = !isSystem ? payload?.reply_to : null;
    if (replyId !== undefined && replyId !== null) {
      const replyBlock = document.createElement('div');
      replyBlock.className = 'bm-chat-reply-inline';
      const replySource = messageCache.get(String(replyId));
      const replyTitle = document.createElement('span');
      replyTitle.className = 'bm-chat-reply-title';
      replyTitle.textContent = replySource?.user ? `↪ Reply to ${replySource.user}` : `↪ Reply to #${replyId}`;
      const replySnippet = document.createElement('span');
      replySnippet.className = 'bm-chat-reply-snippet';
      replySnippet.textContent = clipText(replySource?.text || `Message #${replyId}`);
      replyBlock.appendChild(replyTitle);
      replyBlock.appendChild(replySnippet);
      line.appendChild(replyBlock);
    }
    const row = document.createElement('div');
    row.className = 'bm-chat-row';
    const meta = document.createElement('span');
    meta.className = 'bm-chat-meta';
    const timeLabel = ts.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    if (isSystem) {
      meta.textContent = `[${timeLabel}] System:`;
    } else {
      const metaColor = getChatUserColor(user);
      meta.style.color = metaColor;
      meta.style.fontWeight = '700';
      meta.textContent = `[${timeLabel}] ${user}:`;
    }
    const body = document.createElement('span');
    body.className = 'bm-chat-body';
    appendLinkedText(body, text, { enableTeleport: true, shortenWplace: true });
    row.appendChild(meta);
    row.appendChild(body);
    line.appendChild(row);
    messagesEl.appendChild(line);
    while (messagesEl.childElementCount > 200) {
      messagesEl.removeChild(messagesEl.firstChild);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (!isSystem && messageId) {
      trackIncomingUnread(messageId);
    }
    if (!isSystem) {
      clearPendingSendRestoreIfMatch(user, text, payload?.reply_to);
      ensureDeleteButton(line);
      line.addEventListener('dblclick', () => {
        const id = line.getAttribute('data-msg-id');
        if (id) {
          setReplyTo(id);
          textInput.focus();
        }
      });
    }
  };

  const appendSystemMessage = (message, ts, systemKind = 'notice') => {
    const text = String(message ?? '').trim();
    if (!text) return;
    appendMessage({
      user: 'system',
      text,
      ts: ts || new Date().toISOString()
    }, { isSystem: true, systemKind });
  };

  const applyRateLimitState = (payload) => {
    const retryAfter = Number(payload?.retry_after);
    if (!Number.isFinite(retryAfter) || retryAfter <= 0) return;
    const untilTs = Date.now() + retryAfter * 1000;
    rateLimitUntilTs = Math.max(rateLimitUntilTs, untilTs);
    if (payload?.message) {
      appendSystemMessage(payload.message, payload?.ts, 'rate_limit');
    }
    restoreFailedSendDraft();
    const tick = () => {
      if (!isRateLimited()) {
        clearRateLimitState();
        if (!isBanned() && chatSocket?.readyState === WebSocket.OPEN) {
          setStatus('connected');
        }
        return;
      }
      const remaining = getRateLimitSeconds();
      textInput.disabled = true;
      textInput.placeholder = `Wait ${remaining.toFixed(1)}s...`;
      setStatus(`slow mode ${remaining.toFixed(1)}s`);
    };
    tick();
    if (!rateLimitTimer) {
      rateLimitTimer = setInterval(tick, 200);
    }
  };

  const applyBannedState = (payload) => {
    const scope = payload?.scope === 'device'
      ? 'device'
      : payload?.scope === 'ip'
        ? 'ip'
        : 'chat';
    bannedInfo = {
      scope,
      ts: payload?.ts || null,
      message: String(payload?.message || 'You are banned from chat.').trim() || 'You are banned from chat.'
    };
    clearRateLimitState();
    textInput.disabled = true;
    textInput.placeholder = `Banned (${scope})`;
    clearReply();
    restoreFailedSendDraft();
    appendSystemMessage(bannedInfo.message, bannedInfo.ts, 'banned');
    setStatus(`banned (${scope})`);
    try { chatSocket?.close(); } catch (_) {}
  };

  const handleDeleted = (payload) => {
    const messageIdText = resolveIncomingMessageId(payload);
    if (!messageIdText) return;
    const row = messagesEl.querySelector(`.bm-chat-message[data-msg-id="${messageIdText}"]`);
    if (row) row.remove();
    if (unreadMessageIds.delete(messageIdText)) {
      renderUnreadBadge();
    }
    messageCache.delete(messageIdText);
    removeMapCommentSafe(messageIdText, 'handleDeleted');
    if (replyToId && messageIdText === replyToId) {
      clearReply();
    }
  };

  const scheduleReconnect = () => {
    const delay = reconnectAttempts === 0 ? 2000 : reconnectAttempts === 1 ? 4000 : 10000;
    reconnectAttempts = Math.min(reconnectAttempts + 1, 2);
    if (reconnectTimer) return;
    setStatus(`reconnecting in ${Math.round(delay / 1000)}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (chatSocket && (chatSocket.readyState === WebSocket.OPEN || chatSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clearRateLimitState();
    bannedInfo = null;
    restoreChatInputState();
    setStatus('connecting');
    const buildChatUrl = () => {
      try {
        const url = new URL(CHAT_WS_URL);
        url.searchParams.set('user', getUserName());
        const deviceId = getDeviceId();
        if (deviceId) {
          url.searchParams.set('device_id', deviceId);
        }
        return url.toString();
      } catch (_) {
        const sep = CHAT_WS_URL.includes('?') ? '&' : '?';
        const deviceId = getDeviceId();
        const extra = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : '';
        return `${CHAT_WS_URL}${sep}user=${encodeURIComponent(getUserName())}${extra}`;
      }
    };
    const socket = new WebSocket(buildChatUrl());
    const connectionNonce = ++chatConnectionNonce;
    chatSocket = socket;
    socket.onopen = () => {
      if (socket !== chatSocket || connectionNonce !== chatConnectionNonce) return;
      reconnectAttempts = 0;
      clearRateLimitState();
      bannedInfo = null;
      restoreChatInputState();
      setStatus('connected');
    };
    socket.onclose = () => {
      if (socket !== chatSocket || connectionNonce !== chatConnectionNonce) return;
      if (isBanned()) {
        setStatus(`banned (${bannedInfo?.scope || 'chat'})`);
        return;
      }
      setStatus('disconnected');
      scheduleReconnect();
    };
    socket.onerror = () => {
      if (socket !== chatSocket || connectionNonce !== chatConnectionNonce) return;
      if (!isBanned()) {
        setStatus('error');
      }
    };
    socket.onmessage = (event) => {
      if (socket !== chatSocket || connectionNonce !== chatConnectionNonce) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'chat') {
          appendMessage(payload);
        } else if (payload?.type === 'chat_deleted') {
          handleDeleted(payload);
        } else if (payload?.type === 'rate_limit') {
          applyRateLimitState(payload);
        } else if (payload?.type === 'banned') {
          applyBannedState(payload);
        }
      } catch (_) {}
    };
  };

  const sendMessage = () => {
    if (isBanned()) {
      setStatus(`banned (${bannedInfo?.scope || 'chat'})`);
      return;
    }
    if (isRateLimited()) {
      setStatus(`slow mode ${getRateLimitSeconds().toFixed(1)}s`);
      return;
    }
    let text = textInput.value.trim();
    if (!text) return;
    if (text.length > CHAT_MAX_TEXT_LEN) {
      text = text.slice(0, CHAT_MAX_TEXT_LEN);
      textInput.value = text;
    }
    const user = getUserName();
    if (userInput && userInput.value.trim() !== user) {
      userInput.value = user;
    }
    if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
      setStatus('disconnected');
      return;
    }
    const device_id = getDeviceId();
    const auth_token = getAuthToken();
    const payload = {
      type: 'chat',
      text,
      user,
      username: user,
      name: user,
      Lt: user,
      ...(device_id ? { device_id } : {}),
      ...(auth_token ? { auth_token } : {})
    };
    if (replyToId) {
      payload.reply_to = replyToId;
      queuePendingReply(user, text, replyToId);
    }
    pendingSendRestore = {
      text,
      replyToId: replyToId ? String(replyToId) : null,
      ts: Date.now()
    };
    try {
      chatSocket.send(JSON.stringify(payload));
    } catch (_) {
      setStatus('disconnected');
      restoreFailedSendDraft();
      return;
    }
    textInput.value = '';
    clearReply();
  };

  const setChatEnabled = (enabled) => {
    chatDetails.style.display = enabled ? '' : 'none';
    if (!enabled) {
      try { chatSocket?.close(); } catch (_) {}
      return;
    }
    connect();
  };

  window.setChatEnabled = setChatEnabled;

  if (chatInitialized) {
    setChatEnabled(!isChatDisabled());
    return;
  }
  chatInitialized = true;

  textInput.addEventListener('input', () => {
    enforceInputLimit(textInput, CHAT_MAX_TEXT_LEN);
  });
  userInput?.addEventListener('input', () => {
    enforceInputLimit(userInput, CHAT_MAX_USER_LEN);
  });

  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  modCodeInput?.addEventListener('input', () => {
    GM.setValue('bmChatModCode', modCodeInput.value.trim());
    renderModerationControls();
  });
  messagesEl.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.bm-chat-delete') : null;
    if (!target) return;
    const row = target.closest('.bm-chat-message');
    const messageId = row?.getAttribute('data-msg-id');
    const messageIdNum = messageId ? Number(messageId) : NaN;
    if (!Number.isFinite(messageIdNum)) return;
    event.preventDefault();
    event.stopPropagation();
    moderateDelete(messageIdNum);
  });
  const banBtn = document.getElementById('bm-chat-ban-btn');
  const bansBtn = document.getElementById('bm-chat-bans-btn');
  banBtn?.addEventListener('click', () => {
    moderateBan(banTargetInput?.value, banTypeSelect?.value || 'ip', banReasonInput?.value);
  });
  bansBtn?.addEventListener('click', () => {
    fetchBans();
  });
  replyClear?.addEventListener('click', () => {
    clearReply();
    textInput.focus();
  });
  userInput?.addEventListener('change', () => {
    const user = getUserName();
    userInput.value = user;
    GM.setValue('bmChatUser', user);
    // Reconnect to apply new username via query params; server doesn't support identify frames
    try { chatSocket?.close(); } catch (_) {}
    connect();
  });

  Promise.all([
    GM.getValue('bmChatUser', '').catch(() => ''),
    GM.getValue('bmChatModCode', '').catch(() => ''),
    GM.getValue(CHAT_LAST_READ_ID_STORAGE_KEY, '').catch(() => '')
  ]).then(([savedUser, savedCode, savedLastReadId]) => {
    if (userInput && !userInput.value) {
      const fallback = document.getElementById('bm-user-name')?.textContent?.trim() || '';
      userInput.value = normalizeUser(savedUser || fallback);
    }
    if (modCodeInput && !modCodeInput.value) {
      modCodeInput.value = savedCode || '';
      renderModerationControls();
    }
    const normalizedLastReadId = normalizeMessageId(savedLastReadId);
    if (normalizedLastReadId) {
      lastReadMessageId = normalizedLastReadId;
      pruneUnreadByLastRead();
    }
    if (chatDetails.open) {
      markChatAsRead();
    } else {
      renderUnreadBadge();
    }
  }).finally(() => {
    setChatEnabled(!isChatDisabled());
  });

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.key.toLowerCase() !== 'a') return;
    if (isChatDisabled()) return;
    const active = document.activeElement;
    if (active && active.tagName && ['INPUT', 'TEXTAREA'].includes(active.tagName) && active !== textInput && active !== userInput && active !== modCodeInput) {
      return;
    }
    const chatDetails = document.getElementById('bm-contain-chat');
    if (chatDetails && chatDetails.tagName === 'DETAILS') {
      chatDetails.open = true;
    }
    if (modCodeInput || modCodeRow) {
      const isHidden = modCodeRow ? modCodeRow.style.display === 'none' : modCodeInput.style.display === 'none';
      setModCodeVisible(isHidden);
      updateFloatingMessagesHeight();
      if (isHidden) {
        modCodeInput?.focus();
      } else {
        textInput.focus();
      }
    } else {
      textInput.focus();
    }
  });
}

/** What code to execute instantly in the client (webpage) to spy on fetch calls.
 * This code will execute outside of TamperMonkey's sandbox.
 * @since 0.11.15
 */
inject(() => {

  const script = document.currentScript; // Gets the current script HTML Script Element
  const consoleStyle = script?.getAttribute('bm-cStyle') || ''; // Gets the console style value that was passed in. Defaults to no styling if nothing was found
  const fetchedBlobQueue = new Map(); // Blobs being processed
  const REPORT_EVENT_TYPE = 'bm-report-request';
  const SAFE_MODE_EVENT_TYPE = 'bm-safe-mode';
  const SAFE_MODE_ATTR = 'data-bm-safe-mode';
  const safeModeStorageKey = script?.getAttribute('bm-safe-mode-storage-key') || 'bmSafeModeEnabled';
  let debugLoggingEnabled = script?.getAttribute('bm-debug') === 'true';
  let safeModeEnabled = false;
  const isDebugLoggingEnabledInjected = () => debugLoggingEnabled === true;
  const readSafeModeEnabled = () => {
    const scriptValue = script?.getAttribute('bm-safe-mode');
    if (scriptValue === 'true' || scriptValue === 'false') {
      return scriptValue === 'true';
    }
    const attrValue = document.documentElement?.getAttribute(SAFE_MODE_ATTR);
    if (attrValue === 'true' || attrValue === 'false') {
      return attrValue === 'true';
    }
    try {
      const storedValue = window.localStorage?.getItem(safeModeStorageKey);
      return storedValue === '1' || storedValue === 'true';
    } catch (_) {
      return false;
    }
  };
  const syncSafeModeEnabled = (value) => {
    safeModeEnabled = value === true;
    document.documentElement?.setAttribute(SAFE_MODE_ATTR, safeModeEnabled ? 'true' : 'false');
    try {
      window.localStorage?.setItem(safeModeStorageKey, safeModeEnabled ? '1' : '0');
    } catch (_) {}
  };
  syncSafeModeEnabled(readSafeModeEnabled());

  const postReportRequestPhase = (phase, endpoint) => {
    window.postMessage({
      source: 'blue-marble',
      type: REPORT_EVENT_TYPE,
      phase,
      endpoint: endpoint || ''
    }, '*');
  };

  const isReportUserEndpoint = (urlLike) => {
    if (!urlLike) return false;
    try {
      const parsed = new URL(String(urlLike), window.location.href);
      return parsed.pathname.includes('/report-user');
    } catch (_) {
      return String(urlLike).toLowerCase().includes('/report-user');
    }
  };

  // intercept 
  // const originalBroadcastChannel_onmessage = window.BroadcastChannel.prototype.onmessage;
  // function wrapped(...args) {
  //   console.log("BroadcastChannel onmessage", args);
  //   return originalBroadcastChannel_onmessage.apply(this, args);
  // }
  // window.BroadcastChannel.prototype.onmessage = wrapped;

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data ?? {};
    if (source === 'blue-marble' && event?.data?.type === SAFE_MODE_EVENT_TYPE) {
      syncSafeModeEnabled(event?.data?.enabled === true);
      return;
    }
    if (source === 'blue-marble' && event?.data?.type === 'bm-debug-logging') {
      debugLoggingEnabled = event?.data?.enabled === true;
      return;
    }
    if (source !== 'blue-marble' || !blobID || !blobData || endpoint) return;

    const elapsed = Number.isFinite(blink) ? (Date.now() - blink) : 0;

    if (isDebugLoggingEnabledInjected()) {
      console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
      console.log(`Blob fetch took %c${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')}%c MM:SS.mmm`, consoleStyle, '');
      console.log(fetchedBlobQueue);
      console.groupEnd();
    }

    const callback = fetchedBlobQueue.get(blobID); // Retrieves the blob based on the UUID

    // If the blobID is a valid function...
    if (typeof callback === 'function') {

      callback(blobData); // ...Retrieve the blob data from the blobID function
    } else {
      // ...else the blobID is unexpected. We don't know what it is, but we know for sure it is not a blob. This means we ignore it.

      console.warn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
    }

    fetchedBlobQueue.delete(blobID); // Delete the blob from the queue, because we don't need to process it again
  });

  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Archive tile CORS bypass: proxy requests to the archive tile server through the userscript.
  // MapLibre fetches raster tiles from Web Workers — we use BroadcastChannel so workers can
  // relay requests to the main thread, which posts to the TM side via window.postMessage.

  const BM_ARCHIVE_ORIGIN = 'https://wplace.eralyon.net';
  const BM_ARCHIVE_REQ = 'bm-archive-tile-req';
  const BM_ARCHIVE_DATA = 'bm-archive-tile-data';
  const BM_ARCHIVE_BC = 'bm-archive-bc';

  // Main-thread side of the BroadcastChannel relay: forward requests from any worker to TM
  const bmArchiveBc = new BroadcastChannel(BM_ARCHIVE_BC);
  bmArchiveBc.onmessage = (event) => {
    const d = event.data ?? {};
    if (d.type !== BM_ARCHIVE_REQ) return;
    console.error('[archive tile] BroadcastChannel relay: received req from worker, url=', d.url);
    window.postMessage({ source: 'blue-marble', type: BM_ARCHIVE_REQ, url: d.url, reqId: d.reqId }, '*');
  };
  // Forward TM responses back to all workers via BroadcastChannel
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data ?? {};
    if (d.source !== 'blue-marble' || d.type !== BM_ARCHIVE_DATA) return;
    bmArchiveBc.postMessage({ type: BM_ARCHIVE_DATA, reqId: d.reqId, buffer: d.buffer, error: d.error });
  });

  // Main-thread bmArchiveFetch — used for Image.src intercept
  const bmArchiveFetch = (url) => new Promise((resolve, reject) => {
    const reqId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    console.error('[archive tile] bmArchiveFetch requesting:', url);
    const handler = (event) => {
      if (event.source !== window) return;
      const d = event.data ?? {};
      if (d.source !== 'blue-marble' || d.type !== BM_ARCHIVE_DATA || d.reqId !== reqId) return;
      window.removeEventListener('message', handler);
      if (d.error) {
        console.error('[archive tile] bmArchiveFetch got error for:', url);
        reject(new Error('archive tile fetch failed'));
        return;
      }
      console.error('[archive tile] bmArchiveFetch got buffer, byteLength=', d.buffer?.byteLength, 'for:', url);
      resolve(d.buffer);
    };
    window.addEventListener('message', handler);
    window.postMessage({ source: 'blue-marble', type: BM_ARCHIVE_REQ, url, reqId }, '*');
  });

  // Inject fetch override into every Worker so MapLibre's tile workers are also covered
  (() => {
    const OriginalWorker = window.Worker;
    window.Worker = function(scriptURL, options) {
      // Build a blob that prepends the archive-tile fetch override before the real worker script
      const workerOverride = `
(function() {
  var BM_ARCHIVE_ORIGIN = '${BM_ARCHIVE_ORIGIN}';
  var BM_ARCHIVE_REQ = '${BM_ARCHIVE_REQ}';
  var BM_ARCHIVE_DATA = '${BM_ARCHIVE_DATA}';
  var BM_ARCHIVE_BC = '${BM_ARCHIVE_BC}';
  var bc = new BroadcastChannel(BM_ARCHIVE_BC);
  var pending = {};
  bc.onmessage = function(event) {
    var d = event.data || {};
    if (d.type !== BM_ARCHIVE_DATA) return;
    var p = pending[d.reqId];
    if (!p) return;
    delete pending[d.reqId];
    if (d.error) { p.reject(new Error('archive tile fetch failed')); return; }
    var blob = new Blob([d.buffer], { type: 'image/png' });
    var blobUrl = URL.createObjectURL(blob);
    originalFetch(blobUrl).then(function(res) { URL.revokeObjectURL(blobUrl); p.resolve(res); }).catch(p.reject);
  };
  var originalFetch = self.fetch;
  self.fetch = function() {
    var args = arguments;
    var url = (args[0] instanceof Request ? args[0].url : args[0]) || '';
    if (typeof url === 'string' && url.startsWith(BM_ARCHIVE_ORIGIN + '/tiles/')) {
      return new Promise(function(resolve, reject) {
        var reqId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        pending[reqId] = { resolve: resolve, reject: reject };
        bc.postMessage({ type: BM_ARCHIVE_REQ, url: url, reqId: reqId });
      });
    }
    return originalFetch.apply(self, args);
  };
})();
`;
      let workerScriptURL = scriptURL;
      const isModuleWorker = options && options.type === 'module';
      if (!isModuleWorker && (typeof scriptURL === 'string' || scriptURL instanceof URL)) {
        const scriptSrc = `${workerOverride}\nimportScripts(${JSON.stringify(String(scriptURL))});`;
        const blob = new Blob([scriptSrc], { type: 'application/javascript' });
        workerScriptURL = URL.createObjectURL(blob);
      }
      return new OriginalWorker(workerScriptURL, options);
    };
    window.Worker.prototype = OriginalWorker.prototype;
  })();

  // Hook Image.prototype src setter — fallback for non-worker tile loads
  (() => {
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (!srcDescriptor) return;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      get: srcDescriptor.get,
      set(url) {
        if (typeof url === 'string' && url.startsWith(BM_ARCHIVE_ORIGIN + '/tiles/')) {
          console.error('[archive tile] Image.src intercepted:', url);
          const img = this;
          bmArchiveFetch(url).then((buffer) => {
            const blob = new Blob([buffer], { type: 'image/png' });
            const blobUrl = URL.createObjectURL(blob);
            srcDescriptor.set.call(img, blobUrl);
            img.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
            img.addEventListener('error', () => URL.revokeObjectURL(blobUrl), { once: true });
          }).catch(() => {
            img.dispatchEvent(new Event('error'));
          });
        } else {
          srcDescriptor.set.call(this, url);
        }
      },
      configurable: true,
    });
  })();

  // Overrides fetch (main thread fallback — worker path above covers MapLibre workers)
  window.fetch = async function(...args) {

    const blink = Date.now(); // Current time
    const endpointName = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';

    // Intercept archive tile requests and proxy through TM to bypass CORS
    if (typeof endpointName === 'string' && endpointName.startsWith(BM_ARCHIVE_ORIGIN + '/tiles/')) {
      console.error('[archive tile] main-thread fetch intercepted:', endpointName);
      return bmArchiveFetch(endpointName).then((buffer) => {
        console.error('[archive tile] main-thread fetch resolved, byteLength=', buffer?.byteLength);
        const blob = new Blob([buffer], { type: 'image/png' });
        const blobUrl = URL.createObjectURL(blob);
        return originalFetch(blobUrl).then((res) => { URL.revokeObjectURL(blobUrl); return res; });
      }).catch((err) => {
        console.error('[archive tile] main-thread fetch rejected:', err?.message);
        throw err;
      });
    }

    const isReportRequest = !safeModeEnabled && isReportUserEndpoint(endpointName);
    if (isReportRequest) {
      postReportRequestPhase('start', endpointName);
    }

    let response;
    try {
      response = await originalFetch.apply(this, args); // Sends a fetch
    } catch (error) {
      if (isReportRequest) {
        postReportRequestPhase('end', endpointName);
      }
      throw error;
    }
    if (isReportRequest) {
      postReportRequestPhase('end', endpointName);
    }
    if (safeModeEnabled) {
      return response;
    }
    const cloned = response.clone(); // Makes a copy of the response

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      if (isDebugLoggingEnabledInjected()) {
        console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');
      }
      // Sends a message about the endpoint it spied on
      if (endpointName.endsWith("/tile/random")) {
        // modify the response to send to desired coordinate

        return new Promise((resolve) => {
          const blobUUID = crypto.randomUUID(); // Generates a random UUID
          fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
            // The response that triggers when the blob is finished processing

            // Creates a new response
            resolve(new Response(blobProcessed, {
              headers: cloned.headers,
              status: cloned.status,
              statusText: cloned.statusText
            }));

            if (isDebugLoggingEnabledInjected()) {
              console.log(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
            }
          });

          cloned.json()
          .then(jsonData => {
            window.postMessage({
              source: 'blue-marble',
              endpoint: endpointName,
              blobID: blobUUID,
              jsonData: jsonData,
              blink: blink
            }, '*');
          })
          .catch(err => {
            console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
          });
        });
      } if (endpointName.includes("/s0/pixel/") && endpointName.includes("?x=") && endpointName.includes("&y=") && cloned.status === 400) {
        // try to fix the JSON response
        return new Promise((resolve, reject) => {
          const cloned2 = response.clone();
          cloned2.text().then(text => {
            const errorPrefix = '{"error":"Invalid x","status":400}';
            if (text.startsWith(errorPrefix)) {
              const fixedPayload = text.slice(errorPrefix.length);
              console.error("Fixed", fixedPayload);
              try {
                const actualPayload = JSON.parse(fixedPayload);
                console.error("actualPayload", actualPayload);
                window.postMessage({
                  source: 'blue-marble',
                  endpoint: endpointName,
                  jsonData: actualPayload,
                  blink: blink
                }, '*');

                // Creates a new response
                resolve(new Response(fixedPayload, {
                  headers: cloned.headers,
                  status: 200,
                  statusText: 'OK'
                }));
              } catch (err) {
                console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
                // Return the original 400 response
                resolve(response);
              }
            } else {
              // Return the original 400 response
              resolve(response);
            }
          }).catch(err => {
            console.error(`%c${name}%c: Failed to get Content: `, consoleStyle, '', err);
            // Return the original 400 response
            resolve(response);
          });
        });
      } else {
        cloned.json()
        .then(jsonData => {
          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            jsonData: jsonData,
            blink: blink
          }, '*');
        })
        .catch(err => {
          console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
        });
      }
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
      // Fetch custom for all images but opensourcemap

      const blob = await cloned.blob(); // The original blob

      if (isDebugLoggingEnabledInjected()) {
        console.log(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');
      }

      // Send the received blob
      window.postMessage({
        source: 'blue-marble',
        endpoint: endpointName,
        lastModified: cloned.headers.get("Last-Modified"),
        blobData: blob,
        blink: blink
      });
    }

    return response; // Returns the original response
  };

  const originalXhrOpen = window.XMLHttpRequest?.prototype?.open;
  const originalXhrSend = window.XMLHttpRequest?.prototype?.send;
  if (originalXhrOpen && originalXhrSend) {
    window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (safeModeEnabled) {
        this.__bmReportEndpoint = null;
        this.__bmIsReportRequest = false;
        return originalXhrOpen.call(this, method, url, ...rest);
      }
      this.__bmReportEndpoint = url;
      this.__bmIsReportRequest = isReportUserEndpoint(url);
      return originalXhrOpen.call(this, method, url, ...rest);
    };
    window.XMLHttpRequest.prototype.send = function(...rest) {
      if (safeModeEnabled || !this.__bmIsReportRequest) {
        return originalXhrSend.apply(this, rest);
      }
      if (this.__bmIsReportRequest) {
        const endpoint = this.__bmReportEndpoint;
        postReportRequestPhase('start', endpoint);
        const onLoadEnd = () => {
          this.removeEventListener('loadend', onLoadEnd);
          postReportRequestPhase('end', endpoint);
        };
        this.addEventListener('loadend', onLoadEnd);
      }
      return originalXhrSend.apply(this, rest);
    };
  }

  const hookedMapFuncs = {
    "values": Map.prototype.values
  };
  const hookedMapValues = function () {
    const temp = hookedMapFuncs.values.call(this);
    Array.from(temp).forEach(x => {
        if (x && x["maps"] instanceof Set) {
            Array.from(x["maps"]).forEach(y => {
                if (y && y["flyTo"]) (document.head["__bmmap"] = y, restoreMapPrototype());
            });
        };
    })
    return temp;
  };
  const restoreMapPrototype = function () {
    for (const key in hookedMapFuncs) {
      Map.prototype[key] = hookedMapFuncs[key];
    }
  };
  // Don't hook "set", "get", "has", some Proxy object doing something like "setDefault" may make it into infinite recursion
  // [].forEach(key => {
  //   hookedMapFuncs[key] = Map.prototype[key];
  //   Map.prototype[key] = function (...args) {
  //     this.values(); // call this once
  //     return hookedMapFuncs[key].call(this, ...args);
  //   };
  // });
  Map.prototype.values = hookedMapValues;
});

// Imports the CSS file (inline build) or remote fallback
if (typeof __INLINE_CSS__ !== 'undefined' && __INLINE_CSS__) {
  GM.addStyle(__INLINE_CSS__);
} else {
  GM_xmlhttpRequest({
    method: "GET",
    url: CSS_BM_File,
    onload: (response) => {
      if (response.status >= 200 && response.status < 300) {
        GM.addStyle(response.responseText);
      } else {
        consoleWarn(`%c${name}%c: Failed to load CSS (${response.status}) from ${CSS_BM_File}`, consoleStyle, '');
        if (isDebugLoggingEnabled()) {
          console.log(`${name}: CSS load failed`, { status: response.status, url: CSS_BM_File });
        }
      }
    },
    onerror: (err) => {
      consoleWarn(`%c${name}%c: Failed to load CSS from ${CSS_BM_File}`, consoleStyle, '', err);
      if (isDebugLoggingEnabled()) {
        console.log(`${name}: CSS load error`, { url: CSS_BM_File, err });
      }
    }
  });
}

// CONSTRUCTORS
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
templateManagerRef = templateManager;
templateManager.setLivePixelsFetcher(getLiveTilePixels);
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object
let templateViewportOverlayRefreshBound = false;
let templateViewportOverlayRefreshMap = null;
let templateViewportOverlayRefreshHandler = null;

function isSafeModeActive() {
  return templateManager.isSafeModeEnabled?.() ?? false;
}

function resolveTemplateOverlayMapInstance() {
  const direct = document.head?.['__bmmap'];
  if (direct && typeof direct['on'] === 'function') return direct;
  const fallback = document.querySelector('.right-3>button')?.['__click']?.[3]?.['v'];
  if (fallback && typeof fallback['on'] === 'function') return fallback;
  return null;
}

setInterval(() => {
  const map = resolveTemplateOverlayMapInstance();
  if (!map) { consoleError('[archive zoom] map not found'); return; }
  const zoom = map['getZoom']?.();
  const center = map['getCenter']?.();
  consoleError('[archive zoom] zoom=', zoom, 'center=', center);
}, 5000);

function bindTemplateViewportOverlayRefresh() {
  if (templateViewportOverlayRefreshBound || isSafeModeActive()) return;
  doAfterMapFound(() => {
    if (templateViewportOverlayRefreshBound || isSafeModeActive()) return;
    const map = resolveTemplateOverlayMapInstance();
    if (!map || typeof map['on'] !== 'function') return;
    const refreshVisibleOverlay = () => {
      if (isSafeModeActive()) return;
      if (!(templateManager?.templatesArray ?? []).some((template) => template?.enabled)) {
        return;
      }
      templateManager.createOverlayOnMapVisibleOnly();
    };
    ['moveend', 'zoomend', 'resize'].forEach((eventName) => {
      map['on'](eventName, refreshVisibleOverlay);
    });
    templateViewportOverlayRefreshMap = map;
    templateViewportOverlayRefreshHandler = refreshVisibleOverlay;
    templateViewportOverlayRefreshBound = true;
  });
}

function unbindTemplateViewportOverlayRefresh() {
  if (!templateViewportOverlayRefreshBound || !templateViewportOverlayRefreshMap || !templateViewportOverlayRefreshHandler) {
    templateViewportOverlayRefreshBound = false;
    templateViewportOverlayRefreshMap = null;
    templateViewportOverlayRefreshHandler = null;
    return;
  }
  if (typeof templateViewportOverlayRefreshMap['off'] === 'function') {
    ['moveend', 'zoomend', 'resize'].forEach((eventName) => {
      templateViewportOverlayRefreshMap['off'](eventName, templateViewportOverlayRefreshHandler);
    });
  }
  templateViewportOverlayRefreshBound = false;
  templateViewportOverlayRefreshMap = null;
  templateViewportOverlayRefreshHandler = null;
}

const {
  openRemoteTemplateBuilder,
  openTemplatePaletteConversionPreview,
  openRussianFlagTemplateBuilder,
  openTextTemplateBuilder,
} = createTemplateCreationUi({
  t,
  applyOverlayVarsToFloatingElement,
  normalizeTemplatePaletteConversionOptions,
  templatePaletteConversionDefaults,
  convertTemplateImageFileToPaletteBlob,
  cleanUpCanvas,
  consoleWarn,
  TEMPLATE_PALETTE_PREVIEW_MAX_DIMENSION,
  ensureTemplateTextWebFontsLoaded,
  clampNumber,
  TEMPLATE_TEXT_MAX_CHARS,
  TEMPLATE_TEXT_FONT_SIZE,
  TEMPLATE_TEXT_FONT_SIZE_MIN,
  TEMPLATE_TEXT_FONT_SIZE_MAX,
  TEMPLATE_TEXT_FONT_DEFAULT_KEY,
  TEMPLATE_TEXT_PREVIEW_ZOOM_MIN,
  TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT,
  TEMPLATE_TEXT_PREVIEW_MAX_TILE_REQUESTS,
  TEMPLATE_TEXT_PREVIEW_MIN_W,
  TEMPLATE_TEXT_PREVIEW_MIN_H,
  TEMPLATE_TEXT_WINDOW_DEFAULT_W,
  TEMPLATE_TEXT_WINDOW_DEFAULT_H,
  TEMPLATE_TEXT_WINDOW_MIN_W,
  TEMPLATE_TEXT_WINDOW_MIN_H,
  TEMPLATE_TILE_SIZE,
  templateTextFontMap,
  templateTextFontOptions,
  resolveTemplateTextColor,
  rgbToKey,
  rgbToCss,
  templateTextPaletteMap,
  templateTextPaletteOptions,
  normalizePreviewTileX,
  normalizePreviewTileY,
  normalizePreviewTilePixel,
  loadPreviewTileImage,
  createTextTemplateBlob,
  TEMPLATE_FLAG_WINDOW_DEFAULT_W,
  TEMPLATE_FLAG_WINDOW_DEFAULT_H,
  TEMPLATE_FLAG_WINDOW_MIN_W,
  TEMPLATE_FLAG_WINDOW_MIN_H,
  TEMPLATE_FLAG_DIMENSION_MIN,
  TEMPLATE_FLAG_DIMENSION_MAX,
  TEMPLATE_FLAG_DEFAULT_W,
  TEMPLATE_FLAG_DEFAULT_H,
  TEMPLATE_FLAG_IGNORE_BACKGROUND_COLOR_COUNT,
  TEMPLATE_FLAG_IGNORE_MODE_ALL_EXCEPT_SELECTED,
  TEMPLATE_FLAG_IGNORE_MODE_ONLY_SELECTED,
  TEMPLATE_FLAG_ORIENTATION_HORIZONTAL,
  TEMPLATE_FLAG_ORIENTATION_VERTICAL,
  TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_LEFT,
  TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT,
  normalizeRussianFlagStyleKey,
  normalizeFlagIgnoreMode,
  normalizeFlagStripeOrientation,
  normalizeFlagVerticalOrder,
  normalizeFlagStripeColorKeys,
  normalizeFlagStripeWeights,
  normalizeFlagTemplateDimension,
  normalizeFlagPointCoords,
  computeFlagTemplateEndFromStartAndSize,
  parseFourCoordsFromAnyText,
  computeFlagTemplateRectFromPoints,
  getRussianFlagStyle,
  resolveTemplatePaletteNameByKey,
  getFlagDefaultStripeColorKeys,
  normalizeTemplatePaletteKey,
  templateRussianFlagStyles,
  TEMPLATE_RUSSIAN_FLAG_DEFAULT_PROTECTED_KEYS,
  buildRussianFlagTemplateImageData,
  buildRussianFlagTemplateName,
  loadLiveRegionImageDataForFlagMask,
  testCanvasSize,
});
const {
  openArchiveTemplateBuilder,
  startArchiveTemplatePointCapture,
  cancelArchiveTemplatePointCapture,
  handleArchiveTemplatePointCapture,
  isArchiveTemplatePointCaptureActive,
} = createArchiveTemplateUi({
  t,
  overlayMain,
  templateManager,
  applyOverlayVarsToFloatingElement,
  getTemplateTimeArchiveMeta,
  normalizeArchiveTemplateBaseUrl,
  normalizeTimeArchiveMeta,
  normalizeTilePixelCoords,
  formatTilePixelCoords,
  calculateTopLeftAndSize,
  TEMPLATE_TILE_SIZE,
  MAP_WORLD_WIDTH_PX,
  TEMPLATE_ARCHIVE_BASE_URL,
  TEMPLATE_ARCHIVE_PREVIEW_MAX_DIMENSION,
  TEMPLATE_ARCHIVE_PREVIEW_MAX_TILE_REQUESTS,
  TEMPLATE_ARCHIVE_PREVIEW_DOWNLOAD_CONCURRENCY,
  gmRequest,
  downloadTile,
  testCanvasSize,
  cleanUpCanvas,
  consoleWarn,
  downloadTemplateImageBlob,
});
apiManager.onCoordsUpdated = (rawCoords) => {
  handleDistanceToolCoordsUpdate(rawCoords);
  handleArchiveTemplatePointCapture(rawCoords);
};

overlayMain.setApiManager(apiManager); // Sets the API manager
const templateSync = createTemplateSync({
  name,
  consoleStyle,
  consoleLog,
  consoleWarn,
  gmRequest,
  templateManager,
  templateSyncBaseUrl: TEMPLATE_SYNC_BASE_URL,
  templateUpdatePollMs: TEMPLATE_UPDATE_POLL_MS,
  remoteFlagsRefreshMs: REMOTE_FLAGS_REFRESH_MS,
  buildTemplateFilterList: () => window.buildTemplateFilterList?.(),
  autoSyncOnStatus: (message) => overlayMain.handleDisplayStatus(message),
  autoSyncOnError: (message) => overlayMain.handleDisplayError(message),
  autoSyncSyncToggleList: () => window.syncToggleList?.(),
  autoSyncBuildTemplateFilterList: () => window.buildTemplateFilterList?.(),
  autoSyncBuildColorFilterList: () => window.buildColorFilterList?.(),
});

function stopNotificationPolling() {
  if (notificationPollId) {
    clearInterval(notificationPollId);
    notificationPollId = null;
  }
  stopNotificationRotation();
  notificationQueue = [];
  notificationCurrent = null;
  hideNotification();
}

function applySafeModeState() {
  const enabled = isSafeModeActive();
  setInjectedSafeModeState(enabled);
  setForcedTileRefreshSuppressed(enabled);

  const chatDetails = document.getElementById('bm-contain-chat');
  if (enabled) {
    stopNotificationPolling();
    templateSync.stopTemplateUpdatePolling?.();
    unbindTemplateViewportOverlayRefresh();
    stopObserveBlack();
    if (chatDetails) {
      chatDetails.style.display = 'none';
    }
    try {
      window.setChatEnabled?.(false);
    } catch (_) {}
    destroyMapCommentsManager();
    return;
  }

  bindTemplateViewportOverlayRefresh();
  observeBlack();
  initChat();
  if (chatDetails) {
    chatDetails.style.display = templateManager.isChatDisabled() ? 'none' : '';
  }
  try {
    window.setChatEnabled?.(!templateManager.isChatDisabled());
  } catch (_) {}
  if (templateManager.isMapCommentsEnabled()) {
    setMapCommentsEnabled(true);
  }
  templateSync.startTemplateUpdatePolling();
  startNotificationPolling();
}

document.addEventListener('click', (event) => {
  if (isReportCancelControl(event.target)) {
    markReportSubmitCancelled();
    return;
  }
  if (isReportSubmitControl(event.target) || isReportOpenControl(event.target)) {
    markReportSubmitClicked();
  }
}, true);

window.addEventListener('message', (event) => {
  const payload = event?.data;
  if (!payload || payload.source !== 'blue-marble' || payload.type !== REPORT_REQUEST_EVENT_TYPE) {
    return;
  }
  if (payload.phase === 'start') {
    markReportRequestStarted();
  } else if (payload.phase === 'end') {
    markReportRequestFinished();
  }
});

// Proxy archive tile requests from the injected fetch hook through GM_xmlhttpRequest (no CORS restriction)
window.addEventListener('message', (event) => {
  const d = event?.data;
  if (!d || d.source !== 'blue-marble' || d.type !== 'bm-archive-tile-req') return;
  const { url, reqId } = d;
  if (!url || !reqId) return;
  consoleError('[archive tile] GM handler: fetching', url);
  GM_xmlhttpRequest({
    method: 'GET',
    url,
    responseType: 'arraybuffer',
    onload: (response) => {
      consoleError('[archive tile] GM handler: onload status=', response.status, 'byteLength=', response.response?.byteLength, 'url=', url);
      if (response.status < 200 || response.status >= 300) {
        window.postMessage({ source: 'blue-marble', type: 'bm-archive-tile-data', reqId, error: true }, '*');
        return;
      }
      const buffer = response.response;
      window.postMessage(
        { source: 'blue-marble', type: 'bm-archive-tile-data', reqId, buffer },
        '*',
        buffer instanceof ArrayBuffer ? [buffer] : []
      );
    },
    onerror: (err) => {
      consoleError('[archive tile] GM handler: onerror for', url, err);
      window.postMessage({ source: 'blue-marble', type: 'bm-archive-tile-data', reqId, error: true }, '*');
    },
    ontimeout: () => {
      consoleError('[archive tile] GM handler: ontimeout for', url);
      window.postMessage({ source: 'blue-marble', type: 'bm-archive-tile-data', reqId, error: true }, '*');
    },
  });
});

GM.getValue('bmTemplates', '{}').then(async storageTemplatesValue => {
  const userSettingsValue = await GM.getValue('bmUserSettings', '{}');
  let userSettings;
  try {
    userSettings = JSON.parse(userSettingsValue);
  } catch {
    userSettings = {};
  }
  consoleLog(userSettings);
  consoleLog(Object.keys(userSettings).length);
  if (Object.keys(userSettings).length == 0) {
    const uuid = crypto.randomUUID(); // Generates a random UUID
    consoleLog(uuid);
    templateManager.setUserSettings({
      'uuid': uuid,
      'hideLockedColors': false,
      'progressBarEnabled': true,
      'hideCompletedColors': false,
      'sortBy': 'total-desc',
      'anchor': 'lt', // Top left
      'memorySavingMode': false,
      'eventEnabled': false,
      'eventProvider': '',
      'eventClaimedShown': true,
      'eventUnavailableShown': true,
      'onlyCurrentColorShown': false,
      'themeOverridden': false,
      'currentTheme': '',
      'layoutLanguage': 'en',
      'layoutTheme': 'classic',
      'templateDisplay': 'cross',
      'templateListRemaining': true,
      'hideDroplets': false,
      'hideNextLevel': false,
      'hideStatus': false,
      'isLegacyDisplay': false,
      'showErrorMap': false,
      'showOnlyEnabledColorsErrorMap': false, // Hidden in settings
      'showIntegerZoom': false,
      'enableKeybinds': false,
      'enableNextTemplatePixelShortcut': true,
      'lineTemplateButton': false, // Hidden in settings
      'ruspixelFlagEnabled': true,
      'autoSyncTemplates': false,
      'templateSyncStreams': ['root'],
      'chatDisabled': false,
      'mapCommentsDisabled': false,
      'safeMode': false,
      'debugLogging': false,
    });
    templateManager.storeUserSettings();
  } else {
    templateManager.setUserSettings(userSettings);
  }
  const _qp = new URLSearchParams(window.location.search);

  currentLayoutLanguage = normalizeLayoutLanguage(templateManager.getLayoutLanguage?.());
  setMapCommentsEnabled(templateManager.isMapCommentsEnabled());
  consoleError('[archive bg] isArchiveBackgroundEnabled=', templateManager.isArchiveBackgroundEnabled());
  if (templateManager.isArchiveBackgroundEnabled()) applyArchiveBackground(true);

  // load templates after user settings
  let storageTemplates;
  try {
    storageTemplates = JSON.parse(storageTemplatesValue);
  } catch {
    storageTemplates = {};
  }

  consoleLog(storageTemplates);
  templateManager.importJSON(storageTemplates); // Loads the templates
  registerBmCanvasRestoreOnStyleChange(); // Re-adds overlay layers after any map style reload

  await waitForBody();
  observeWplaceTheme();
  await buildOverlayMain(); // Builds the main overlay
  applyLayoutLanguage(currentLayoutLanguage);
  applySafeModeState();

  overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay
  const rebuildOverlayIfMissing = async () => {
    if (overlayBuildInFlight || document.getElementById('bm-overlay')) return;
    overlayBuildInFlight = true;
    try {
      await buildOverlayMain();
      overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag');
      applyWplaceThemeState();
    } catch (err) {
      consoleWarn(`%c${name}%c: Failed to rebuild overlay`, consoleStyle, '', err);
    } finally {
      overlayBuildInFlight = false;
    }
  };
  setInterval(rebuildOverlayIfMissing, 2000);

  const keysPressed = new Set();
  let animationFrameId = null;
  const PAN_SPEED = 25; // pixels per frame

  function panLoop() {
    if (!templateManager.areKeybindsEnabled()) {
        keysPressed.clear();
    }

    if (keysPressed.size === 0) {
      animationFrameId = null;
      return;
    }

    let dx = 0;
    let dy = 0;

    if (keysPressed.has('w') || keysPressed.has('arrowup')) dy -= 1;
    if (keysPressed.has('s') || keysPressed.has('arrowdown')) dy += 1;
    if (keysPressed.has('a') || keysPressed.has('arrowleft')) dx -= 1;
    if (keysPressed.has('d') || keysPressed.has('arrowright')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      if (dx !== 0 && dy !== 0) {
        // Normalize diagonal movement speed
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;
      }
      panMap([dx * PAN_SPEED, dy * PAN_SPEED]);
    }

    animationFrameId = requestAnimationFrame(panLoop);
  }

  document.addEventListener('keydown', (event) => {
    // Don't pan if user is typing in an input
    if (
      document.activeElement?.tagName === 'INPUT'
      || document.activeElement?.tagName === 'TEXTAREA'
      || document.activeElement?.isContentEditable
    ) {
        return;
    }

    const key = event.key.toLowerCase();
    if (
      (key === 'j' || key === 'о')
      && templateManager.isNextTemplatePixelShortcutEnabled()
      && !event.repeat
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
    ) {
      event.preventDefault();
      void jumpToNextUnpaintedTemplatePixel();
      return;
    }
    if (
      (key === 'b' || key === 'и')
      && !event.repeat
      && !event.ctrlKey
      && !event.metaKey
      && event.altKey
    ) {
      event.preventDefault();
      const nextVal = !templateManager.isBackgroundModeEnabled();
      void templateManager.setBackgroundModeEnabled(nextVal).then(() => {
        templateManager.createOverlayOnMap();
        overlayMain.handleDisplayStatus(nextVal ? 'Background Mode: ON' : 'Background Mode: OFF');
        const checkbox = document.getElementById('bm-background-mode-enabled');
        if (checkbox) checkbox.checked = nextVal;
      });
      return;
    }
    // Don't pan if disabled
    if (!templateManager.areKeybindsEnabled()) {
        return;
    }
    const validKeys = ['w', 'a', 's', 'd']; //, 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']; // also used by wplace to handle rotation, so not capturing these

    // Ignore invalid keys or repeated keydown events
    if (!validKeys.includes(key) || keysPressed.has(key)) {
        return;
    }

    keysPressed.add(key);

    // Start the loop if it's not already running
    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(panLoop);
    }
  }, true);

  document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    keysPressed.delete(key);
    // The loop will stop itself on the next frame if no keys are pressed
  }, true);

  apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

  consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');
});

/** Add the zoom level buttons if they do not exist.
 * @since 0.86.15
 */
function createZoomButtons() {
  // If the 1x zoom button does not exist, we make new zoom level buttons
  const zoom1 = document.getElementById('BM-zoom-1x');
  if (zoom1) return;
  const ref = Array.from(document.querySelectorAll(".gap-1>.btn[title]")).slice(-1)[0];
  if (!ref) return;
  const container = ref.parentNode;
  if (!container) return;

  const isShown = templateManager.areIntegerZoomButtonsShown();

  function createZoomButton(zoomLevel) {
    const zoomBtn = document.createElement('button');

    const label = zoomLevel === 0 ? "Min" : (zoomLevel + 'x');
    zoomBtn.id = `BM-zoom-${label}`;
    zoomBtn.textContent = label;

    zoomBtn.className = ref.className;
    zoomBtn.classList.add('bm-zoom-btn');
    if (!isShown) {
      zoomBtn.style.display = "none";
    };

    zoomBtn.onclick = function() {
      var actualZoomLevel = zoomLevel;
      if (zoomLevel === 0) {
        var currentTileSize = getCurrentTileSize();
        var epsilon = 1e-7; // Ensure no rounding issue but remain negligible
        setZoom(Math.log2(8 * currentTileSize * currentTileSize) / 2 + epsilon);
        return;
      }
      applyIntegerZoomLevel(actualZoomLevel);
    };

    container.appendChild(zoomBtn); // Adds the zoom level button
  };

  [0, 1, 2, 3, 4, 5, 10, 25].forEach( zoom => createZoomButton(zoom) );
}

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  if (observeBlackObserver || isSafeModeActive()) {
    return;
  }
  let syncQueued = false;
  const hasObservedControls = () => {
    if (!document.getElementById('BM-zoom-1x')) return false;
    if (!document.getElementById('bm-button-move')) return false;
    return true;
  };
  const isRelevantObserveBlackNode = (node) => (
    node instanceof Element
    && (
      node.matches?.('#color-1, .gap-1, .gap-1 > .btn[title], #bm-button-move, #bm-button-paint')
      || node.querySelector?.('#color-1, .gap-1 > .btn[title], #bm-button-move, #bm-button-paint')
    )
  );
  const queueObserveBlackSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      if (isSafeModeActive()) {
        return;
      }
      createZoomButtons();

      const black = document.querySelector('#color-1');
      if (!black) { return; }

      let move = document.querySelector('#bm-button-move');

      // If the move button does not exist, we make a new one
      if (!move) {
        move = document.createElement('button');
        move.id = 'bm-button-move';
        move.textContent = 'Move Up';
        move.className = 'btn btn-soft';
        move.onclick = function() {
          const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
          const shouldMoveUp = (this.textContent === 'Move Up');
          roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
          roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
          roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
          roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
          roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
          this.textContent = shouldMoveUp ? 'Move Down' : 'Move Up';
        }

        // Attempts to find the "Paint Pixel" element for anchoring
        const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

        paintPixel.parentNode?.appendChild(move); // Adds the move button
      }


      // Hook color change to force refresh
      Array.from(black.parentNode.parentNode.getElementsByTagName('button')).forEach((button) => {
        // seems that the color selected button will remove all classes once clicked, so we hook the parent
        if (button.parentElement.classList.contains("bm-hooked")) {
          return;
        }
        button.addEventListener('click', function () {
          if (templateManager.isOnlyCurrentColorShown()) {
            // prevent lagging
            setTimeout(() => {
              templateManager.createOverlayOnMap()
              if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
                forceRefreshTiles();
              };
              // Just build the list (with the selected color toggled) as nothing has changed
              buildColorFilterList();
            }, 0);
          };
        });
        button.parentElement.classList.add("bm-hooked");
      });
    });
  };

  const observer = new MutationObserver((mutations, observer) => {
    if (!hasObservedControls()) {
      queueObserveBlackSync();
      return;
    }
    const hasRelevantMutation = mutations.some((mutation) => (
      [...mutation.addedNodes, ...mutation.removedNodes].some(isRelevantObserveBlackNode)
    ));
    if (hasRelevantMutation) {
      queueObserveBlackSync();
    }
  });

  queueObserveBlackSync();
  observeBlackObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserveBlack() {
  if (!observeBlackObserver) return;
  try {
    observeBlackObserver.disconnect();
  } catch (_) {}
  observeBlackObserver = null;
}

function normalizeTilePixelCoords(rawCoords) {
  if (!Array.isArray(rawCoords) || rawCoords.length < 4) return null;
  const txRaw = Number(rawCoords[0]);
  const tyRaw = Number(rawCoords[1]);
  const pxRaw = Number(rawCoords[2]);
  const pyRaw = Number(rawCoords[3]);
  if (![txRaw, tyRaw, pxRaw, pyRaw].every(Number.isFinite)) return null;

  const tx = ((Math.trunc(txRaw) % 2048) + 2048) % 2048;
  const ty = Math.trunc(tyRaw);
  const px = ((Math.trunc(pxRaw) % 1000) + 1000) % 1000;
  const py = ((Math.trunc(pyRaw) % 1000) + 1000) % 1000;
  return [tx, ty, px, py];
}

function parseTemplateChunkKey(tileKey) {
  const parts = String(tileKey || '').split(',').map(Number);
  if (parts.length < 4 || !parts.slice(0, 4).every(Number.isFinite)) return null;
  return [Math.trunc(parts[0]), Math.trunc(parts[1]), Math.trunc(parts[2]), Math.trunc(parts[3])];
}

function formatTemplateChunkKey(coords) {
  if (!Array.isArray(coords) || coords.length < 4) return null;
  const tx = Math.trunc(Number(coords[0]) || 0);
  const ty = Math.trunc(Number(coords[1]) || 0);
  const px = ((Math.trunc(Number(coords[2]) || 0) % TEMPLATE_TILE_SIZE) + TEMPLATE_TILE_SIZE) % TEMPLATE_TILE_SIZE;
  const py = ((Math.trunc(Number(coords[3]) || 0) % TEMPLATE_TILE_SIZE) + TEMPLATE_TILE_SIZE) % TEMPLATE_TILE_SIZE;
  return `${tx.toString().padStart(4, '0')},${ty.toString().padStart(4, '0')},${px.toString().padStart(3, '0')},${py.toString().padStart(3, '0')}`;
}

function computeWrappedWorldDeltaX(currentWorldX, targetWorldX) {
  const world = MAP_WORLD_WIDTH_PX;
  let delta = Math.trunc(Number(targetWorldX) || 0) - Math.trunc(Number(currentWorldX) || 0);
  if (delta > world / 2) delta -= world;
  if (delta < -world / 2) delta += world;
  return delta;
}

function shiftTemplateChunkKey(tileKey, deltaWorldX, deltaWorldY) {
  const parsed = parseTemplateChunkKey(tileKey);
  if (!parsed) return null;
  const [tx, ty, px, py] = parsed;
  const rawShiftX = tx * TEMPLATE_TILE_SIZE + px + Math.trunc(Number(deltaWorldX) || 0);
  const wrappedX = ((rawShiftX % MAP_WORLD_WIDTH_PX) + MAP_WORLD_WIDTH_PX) % MAP_WORLD_WIDTH_PX;
  const nextTx = Math.floor(wrappedX / TEMPLATE_TILE_SIZE);
  const nextPx = wrappedX % TEMPLATE_TILE_SIZE;

  const shiftedY = ty * TEMPLATE_TILE_SIZE + py + Math.trunc(Number(deltaWorldY) || 0);
  const nextTy = Math.floor(shiftedY / TEMPLATE_TILE_SIZE);
  const nextPy = ((shiftedY % TEMPLATE_TILE_SIZE) + TEMPLATE_TILE_SIZE) % TEMPLATE_TILE_SIZE;
  return formatTemplateChunkKey([nextTx, nextTy, nextPx, nextPy]);
}

function rekeyTemplateChunkMap(sourceMap, deltaWorldX, deltaWorldY) {
  const entries = Object.entries(sourceMap || {});
  const result = {};
  entries.forEach(([oldKey, value]) => {
    const shiftedKey = shiftTemplateChunkKey(oldKey, deltaWorldX, deltaWorldY);
    if (!shiftedKey) return;
    result[shiftedKey] = value;
  });
  return result;
}

function shiftTilePixelCoordsByPixels(rawCoords, deltaPixelX, deltaPixelY) {
  const coords = normalizeTilePixelCoords(rawCoords);
  if (!coords) return null;
  const worldX = ((coords[0] * TEMPLATE_TILE_SIZE + coords[2] + Math.trunc(Number(deltaPixelX) || 0)) % MAP_WORLD_WIDTH_PX + MAP_WORLD_WIDTH_PX) % MAP_WORLD_WIDTH_PX;
  const unclampedY = coords[1] * TEMPLATE_TILE_SIZE + coords[3] + Math.trunc(Number(deltaPixelY) || 0);
  const worldY = Math.max(0, Math.min(MAP_WORLD_HEIGHT_PX - 1, unclampedY));
  const tx = Math.floor(worldX / TEMPLATE_TILE_SIZE);
  const ty = Math.floor(worldY / TEMPLATE_TILE_SIZE);
  const px = worldX % TEMPLATE_TILE_SIZE;
  const py = worldY % TEMPLATE_TILE_SIZE;
  return [tx, ty, px, py];
}

function resolveTemplateFocusCoords(rawCoords, imageWidth, imageHeight) {
  const coords = normalizeTilePixelCoords(rawCoords);
  if (!coords) return null;
  const width = Number(imageWidth);
  const height = Number(imageHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return coords;
  }
  const shiftX = Math.floor((Math.max(1, Math.trunc(width)) - 1) / 2);
  const shiftY = Math.floor((Math.max(1, Math.trunc(height)) - 1) / 2);
  return shiftTilePixelCoordsByPixels(coords, shiftX, shiftY);
}

function resolveTemplateFocusZoom(imageWidth, imageHeight) {
  const width = Number(imageWidth);
  const height = Number(imageHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const usableViewportWidth = Math.max(240, Math.floor(window.innerWidth * TEMPLATE_FOCUS_VIEWPORT_RATIO));
  const usableViewportHeight = Math.max(180, Math.floor(window.innerHeight * TEMPLATE_FOCUS_VIEWPORT_RATIO));
  const fitScale = Math.min(
    usableViewportWidth / Math.max(1, Math.trunc(width)),
    usableViewportHeight / Math.max(1, Math.trunc(height))
  );
  if (!Number.isFinite(fitScale) || fitScale <= 0) return null;
  const targetScale = Math.max(TEMPLATE_FOCUS_SCALE_MIN, fitScale / TEMPLATE_FOCUS_SCALE_PADDING);
  const dpr = Math.max(0.25, Number(window.devicePixelRatio) || 1);
  const focusZoom = Math.log2((4000 * targetScale) / dpr);
  if (!Number.isFinite(focusZoom)) return null;
  return Math.max(TEMPLATE_FOCUS_ZOOM_MIN, Math.min(TEMPLATE_FOCUS_ZOOM_MAX, focusZoom));
}

function applyTemplateFocusZoom(imageWidth, imageHeight) {
  const focusZoom = resolveTemplateFocusZoom(imageWidth, imageHeight);
  if (!Number.isFinite(focusZoom)) return false;
  setZoom(focusZoom);
  return true;
}

function resolveIntegerZoomMapValue(zoomLevel) {
  const numericZoomLevel = Number(zoomLevel);
  if (!Number.isFinite(numericZoomLevel) || numericZoomLevel <= 0) return null;
  const dpr = Math.max(0.25, Number(window.devicePixelRatio) || 1);
  const zoomValue = Math.log2((4000 * numericZoomLevel) / dpr);
  return Number.isFinite(zoomValue) ? zoomValue : null;
}

function applyIntegerZoomLevel(zoomLevel) {
  const zoomValue = resolveIntegerZoomMapValue(zoomLevel);
  if (!Number.isFinite(zoomValue)) return false;
  setZoom(zoomValue);
  return true;
}

function isElementActuallyVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (!element.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (
    style.display === 'none'
    || style.visibility === 'hidden'
    || style.pointerEvents === 'none'
    || Number(style.opacity || 1) <= 0
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getNormalizedElementText(element) {
  return String(element?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isLikelyPixelInfoHeadingText(text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized || !/#\d+\b/.test(normalized)) return false;
  return !/(leaderboard|notifications?|active bans|report user|rus marble|distance)/.test(normalized);
}

function getCloseLikeControls(container) {
  if (!(container instanceof HTMLElement)) return [];
  const controls = Array.from(container.querySelectorAll('button, [role="button"], [aria-label], [title]'));
  return controls.filter((control) => {
    if (!(control instanceof HTMLElement)) return false;
    if (!isElementActuallyVisible(control)) return false;
    if (control.closest('#bm-overlay')) return false;
    if (control instanceof HTMLButtonElement && control.disabled) return false;
    const text = [
      control.textContent,
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.getAttribute('name'),
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return (
      text === 'x'
      || text === '×'
      || text === '✕'
      || /\b(close|dismiss|cancel|back)\b/.test(text)
    );
  });
}

function scoreCloseLikeControl(control) {
  const text = [
    control.textContent,
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
    control.getAttribute('name'),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  let score = 0;
  if (/\bclose\b/.test(text)) score += 10;
  if (/\b(dismiss|cancel|back)\b/.test(text)) score += 6;
  if (text === '✕' || text === '×' || text === 'x') score += 8;
  const rect = control.getBoundingClientRect();
  if (rect.width <= 48 && rect.height <= 48) score += 2;
  return score;
}

function clickElementLikeUser(element) {
  if (!(element instanceof HTMLElement)) return false;
  try {
    if (typeof element.focus === 'function') {
      try {
        element.focus({ preventScroll: true });
      } catch (_) {
        element.focus();
      }
    }
    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }));
      element.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }));
    }
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    element.click();
    return true;
  } catch (_) {
    return false;
  }
}

function getPaintPaletteRoot() {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
    .filter((heading) => heading instanceof HTMLElement)
    .filter((heading) => isElementActuallyVisible(heading))
    .filter((heading) => getNormalizedElementText(heading).startsWith('paint pixel'));
  for (const heading of headings) {
    const root = heading.closest('.rounded-t-box');
    if (root instanceof HTMLElement && isElementActuallyVisible(root)) {
      return root;
    }
  }
  return null;
}

function isExtendedPaintPaletteOpen(root = getPaintPaletteRoot()) {
  if (!(root instanceof HTMLElement)) return false;
  return ['color-32', 'color-33', 'color-34', 'color-35', 'color-63']
    .some((id) => {
      const swatch = root.querySelector(`#${id}`);
      return swatch instanceof HTMLElement && isElementActuallyVisible(swatch);
    });
}

function getPaintPaletteExpandButton(root = getPaintPaletteRoot()) {
  if (!(root instanceof HTMLElement)) return null;
  const footerRow = Array.from(root.querySelectorAll('div.relative.h-12'))
    .find((row) => row instanceof HTMLElement && isElementActuallyVisible(row));
  if (!(footerRow instanceof HTMLElement)) return null;
  const candidates = Array.from(footerRow.querySelectorAll('button'))
    .filter((button) => button instanceof HTMLButtonElement)
    .filter((button) => isElementActuallyVisible(button))
    .filter((button) => !button.disabled)
    .map((button) => {
      const rect = button.getBoundingClientRect();
      let score = 0;
      if (button.classList.contains('btn-square')) score += 4;
      if (button.classList.contains('shadow-md')) score += 2;
      if (button.closest('.absolute.bottom-0.left-0')) score += 8;
      if (getNormalizedElementText(button).includes('eraser')) score -= 20;
      score -= rect.left / 1000;
      return { button, score };
    })
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.button ?? null;
}

function ensureExtendedPaintPalette() {
  const paletteRoot = getPaintPaletteRoot();
  if (!(paletteRoot instanceof HTMLElement)) {
    throw new Error('Paint palette is not open.');
  }
  if (isExtendedPaintPaletteOpen(paletteRoot)) {
    return 'Paint palette is already extended.';
  }
  const expandButton = getPaintPaletteExpandButton(paletteRoot);
  if (!(expandButton instanceof HTMLElement)) {
    throw new Error('Paint palette expand button was not found.');
  }
  if (!clickElementLikeUser(expandButton)) {
    throw new Error('Failed to click the paint palette expand button.');
  }
  return 'Paint palette expansion requested.';
}

function closePixelInfoWindows() {
  let closedAny = false;
  try {
    const directCloseButton = apiManager?.getCloseButton?.();
    if (directCloseButton && clickElementLikeUser(directCloseButton)) {
      closedAny = true;
    }
  } catch (_) {}

  const directCloseCandidates = Array.from(document.querySelectorAll(
    '.rounded-t-box button[aria-label="Close"], dialog.modal button[aria-label="Close"], dialog button[aria-label="Close"], .modal button[aria-label="Close"]'
  ))
    .filter((button) => button instanceof HTMLElement)
    .filter((button) => isElementActuallyVisible(button))
    .map((button) => {
      const container = button.closest('.rounded-t-box, dialog.modal, dialog, .modal');
      const text = getNormalizedElementText(container);
      let score = scoreCloseLikeControl(button);
      if (container && isElementActuallyVisible(container)) score += 4;
      if (/\bpaint\b/.test(text) || /\bshare\b/.test(text)) score += 6;
      if (/\bnot painted\b/.test(text) || /\bpainted by\b/.test(text) || /\bno alliance\b/.test(text)) score += 4;
      if (/#\s*\d+\b/.test(text)) score += 2;
      return { button, score };
    })
    .sort((left, right) => right.score - left.score);
  for (const { button, score } of directCloseCandidates) {
    if (score <= 0) continue;
    closedAny = clickElementLikeUser(button) || closedAny;
  }

  const visitedContainers = new Set();
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))
    .filter((heading) => heading instanceof HTMLElement)
    .filter((heading) => isElementActuallyVisible(heading))
    .filter((heading) => isLikelyPixelInfoHeadingText(getNormalizedElementText(heading)));
  for (const heading of headings) {
    let container = heading;
    let depth = 0;
    while (container && container instanceof HTMLElement && container !== document.body && depth < 8) {
      if (visitedContainers.has(container)) break;
      const closeControls = getCloseLikeControls(container)
        .sort((left, right) => scoreCloseLikeControl(right) - scoreCloseLikeControl(left));
      if (closeControls.length > 0) {
        visitedContainers.add(container);
        closedAny = clickElementLikeUser(closeControls[0]) || closedAny;
        break;
      }
      container = container.parentElement;
      depth += 1;
    }
  }
  return closedAny;
}

function schedulePixelInfoCloseBurst() {
  closePixelInfoWindows();
  requestAnimationFrame(() => {
    closePixelInfoWindows();
  });
  window.setTimeout(() => {
    closePixelInfoWindows();
  }, 80);
  window.setTimeout(() => {
    closePixelInfoWindows();
  }, 220);
}

function normalizeTemplateJumpOriginMode(value) {
  const normalizedValue = String(value ?? 'center').trim().toLowerCase().replace(/[\s_]+/g, '-');
  switch (normalizedValue) {
    case 'center':
    case 'middle':
    case 'c':
      return 'center';
    case 'top-left':
    case 'left-top':
    case 'tl':
    case 'lt':
      return 'top-left';
    case 'top-right':
    case 'right-top':
    case 'tr':
    case 'rt':
      return 'top-right';
    case 'bottom-left':
    case 'left-bottom':
    case 'bl':
    case 'lb':
      return 'bottom-left';
    case 'bottom-right':
    case 'right-bottom':
    case 'br':
    case 'rb':
      return 'bottom-right';
    default:
      return 'center';
  }
}

function getTemplateJumpOriginLabel(originMode) {
  switch (normalizeTemplateJumpOriginMode(originMode)) {
    case 'top-left':
      return 'top-left';
    case 'top-right':
      return 'top-right';
    case 'bottom-left':
      return 'bottom-left';
    case 'bottom-right':
      return 'bottom-right';
    default:
      return 'center';
  }
}

function getTemplateJumpOriginGeoCoords(bounds, originMode) {
  if (!bounds?.sw || !bounds?.ne) return null;
  switch (normalizeTemplateJumpOriginMode(originMode)) {
    case 'top-left':
      return [bounds.ne[0], bounds.sw[1]];
    case 'top-right':
      return [bounds.ne[0], bounds.ne[1]];
    case 'bottom-left':
      return [bounds.sw[0], bounds.sw[1]];
    case 'bottom-right':
      return [bounds.sw[0], bounds.ne[1]];
    default:
      return null;
  }
}

function getTemplateJumpOriginCoords(originMode = 'center') {
  const normalizedOriginMode = normalizeTemplateJumpOriginMode(originMode);
  try {
    if (normalizedOriginMode !== 'center') {
      const cornerGeoCoords = getTemplateJumpOriginGeoCoords(getMapBounds(), normalizedOriginMode);
      if (Array.isArray(cornerGeoCoords) && cornerGeoCoords.length >= 2) {
        const [coordsTile, coordsPixel] = coordsGeoCoordsToTileCoords(cornerGeoCoords[0], cornerGeoCoords[1], true);
        return normalizeTilePixelCoords([coordsTile[0], coordsTile[1], coordsPixel[0], coordsPixel[1]]);
      }
    }
    const geoCoords = getCenterGeoCoords();
    const [coordsTile, coordsPixel] = coordsGeoCoordsToTileCoords(geoCoords[0], geoCoords[1], true);
    return normalizeTilePixelCoords([coordsTile[0], coordsTile[1], coordsPixel[0], coordsPixel[1]]);
  } catch (_) {
    return normalizeTilePixelCoords(apiManager?.coordsTilePixel ?? null);
  }
}

function getWrappedRangeDistance(currentValue, minValue, maxValue, worldSize = null) {
  const current = Number(currentValue);
  const min = Number(minValue);
  const max = Number(maxValue);
  if (![current, min, max].every(Number.isFinite)) return Infinity;
  const calculateDistance = (value) => {
    if (value < min) return min - value;
    if (value > max) return value - max;
    return 0;
  };
  if (!Number.isFinite(worldSize) || worldSize <= 0) {
    return calculateDistance(current);
  }
  return Math.min(
    calculateDistance(current),
    calculateDistance(current - worldSize),
    calculateDistance(current + worldSize)
  );
}

function getTileLowerBoundDistanceSq(originPoint, tileX, tileY) {
  const minX = tileX * TEMPLATE_TILE_SIZE;
  const maxX = minX + TEMPLATE_TILE_SIZE - 1;
  const minY = tileY * TEMPLATE_TILE_SIZE;
  const maxY = minY + TEMPLATE_TILE_SIZE - 1;
  const dx = getWrappedRangeDistance(originPoint?.x, minX, maxX, MAP_WORLD_WIDTH_PX);
  const dy = getWrappedRangeDistance(originPoint?.y, minY, maxY);
  return dx * dx + dy * dy;
}

function getTilePixelDistanceSq(originPoint, rawCoords) {
  const coords = normalizeTilePixelCoords(rawCoords);
  if (!originPoint || !coords) return Infinity;
  const targetWorldX = coords[0] * TEMPLATE_TILE_SIZE + coords[2];
  const targetWorldY = coords[1] * TEMPLATE_TILE_SIZE + coords[3];
  const dx = computeWrappedWorldDeltaX(originPoint.x, targetWorldX);
  const dy = targetWorldY - originPoint.y;
  return dx * dx + dy * dy;
}

const templateJumpCycleState = {
  scopeKey: '',
  visitedCoordsKeys: new Set(),
};

function buildTemplateJumpCycleScopeKey(activeTemplates, displayedColors, originMode = 'center') {
  const templateKey = (activeTemplates ?? [])
    .map((template) => `${template?.storageKey ?? ''}:${template?.storageTimeString ?? ''}`)
    .sort()
    .join('|');
  const colorKey = (displayedColors ?? []).slice().sort().join('|');
  return `${templateKey}||${colorKey}||${normalizeTemplateJumpOriginMode(originMode)}`;
}

function syncTemplateJumpCycleState(scopeKey) {
  if (templateJumpCycleState.scopeKey === scopeKey) {
    return templateJumpCycleState.visitedCoordsKeys;
  }
  templateJumpCycleState.scopeKey = scopeKey;
  templateJumpCycleState.visitedCoordsKeys = new Set();
  return templateJumpCycleState.visitedCoordsKeys;
}

function findNearestCachedTemplatePixel(originPoint, displayedColorSet, excludedCoordsKeys) {
  let bestCandidate = null;
  for (const stats of templateManager.tileProgress.values()) {
    for (const [colorKey, content] of Object.entries(stats?.palette ?? {})) {
      if (!displayedColorSet.has(colorKey)) continue;
      const examples = content?.examplesEnabled ?? [];
      for (const example of examples) {
        if (!Array.isArray(example) || example.length < 2) continue;
        const coords = normalizeTilePixelCoords([
          example?.[0]?.[0],
          example?.[0]?.[1],
          example?.[1]?.[0],
          example?.[1]?.[1],
        ]);
        if (!coords) continue;
        const coordsKey = coords.join(',');
        if (excludedCoordsKeys?.has(coordsKey)) continue;
        const distanceSq = getTilePixelDistanceSq(originPoint, coords);
        if (!Number.isFinite(distanceSq)) continue;
        if (!bestCandidate || distanceSq < bestCandidate.distanceSq) {
          bestCandidate = { coords, coordsKey, distanceSq };
        }
      }
    }
  }
  return bestCandidate;
}

async function getLiveTilePixels(tileX, tileY) {
  const tileImage = await downloadTile(tileX, tileY);
  let canvas = new OffscreenCanvas(TEMPLATE_TILE_SIZE, TEMPLATE_TILE_SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    cleanUpCanvas(canvas);
    canvas = null;
    throw new Error('Failed to initialize live tile canvas.');
  }
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, TEMPLATE_TILE_SIZE, TEMPLATE_TILE_SIZE);
  context.drawImage(tileImage, 0, 0, TEMPLATE_TILE_SIZE, TEMPLATE_TILE_SIZE);
  const imageData = context.getImageData(0, 0, TEMPLATE_TILE_SIZE, TEMPLATE_TILE_SIZE).data;
  cleanUpCanvas(canvas);
  canvas = null;
  return imageData;
}

async function findNearestTemplatePixelInTile(tileCandidate, liveTilePixels, originPoint, displayedColorSet, excludedCoordsKeys, memorySavingMode) {
  const displayedColorsPacked = Uint32Array.from(
    typeof displayedColorSet?.values === 'function' ? displayedColorSet : []
  );
  const excludedCoordsKeySet = excludedCoordsKeys instanceof Set
    ? [...excludedCoordsKeys]
    : (Array.isArray(excludedCoordsKeys) ? excludedCoordsKeys : []);
  const liveTilePixelsClone = new Uint8ClampedArray(liveTilePixels);

  let bestCandidate = null;
  for (const entry of tileCandidate.entries) {
    const sampleData = await entry.template.getChunkSamples(entry.tileKey, { memorySaving: memorySavingMode });
    if (!sampleData) continue;
    const encodedSampleData = encodeChunkSampleBytes(sampleData);
    const liveTilePixelsCopy = new Uint8ClampedArray(liveTilePixelsClone);
    const displayedColorsCopy = new Uint32Array(displayedColorsPacked);
    const entryBest = await templateWorkerManager.runTask('findNearestUnpainted', {
      sampleData: encodedSampleData,
      liveTilePixels: liveTilePixelsCopy,
      tileSize: TEMPLATE_TILE_SIZE,
      offsetX: entry.offsetX,
      offsetY: entry.offsetY,
      tileX: tileCandidate.tileX,
      tileY: tileCandidate.tileY,
      originPoint,
      displayedColorsPacked: displayedColorsCopy,
      excludedCoordsKeySet,
      templateName: entry.template.displayName,
      mapWorldWidthPx: MAP_WORLD_WIDTH_PX,
    }, { transferList: [encodedSampleData.buffer, liveTilePixelsCopy.buffer, displayedColorsCopy.buffer] }).catch(() => null);
    if (entryBest && (!bestCandidate || entryBest.distanceSq < bestCandidate.distanceSq)) {
      bestCandidate = entryBest;
    }
  }
  return bestCandidate;
}

let isJumpToNextTemplatePixelRunning = false;
async function jumpToNextUnpaintedTemplatePixel(options = null) {
  if (isJumpToNextTemplatePixelRunning) return;
  isJumpToNextTemplatePixelRunning = true;
  try {
    const originMode = normalizeTemplateJumpOriginMode(options?.originMode);
    const originLabel = getTemplateJumpOriginLabel(originMode);
    schedulePixelInfoCloseBurst();
    const activeTemplates = (templateManager.templatesArray ?? []).filter((template) => template?.enabled);
    if (!activeTemplates.length) {
      overlayMain.handleDisplayStatus('No active templates enabled.');
      return;
    }

    const displayedColors = templateManager.getDisplayedColorsSorted().filter((rgb) => {
      const meta = rgbToMeta.get(rgb);
      return typeof meta?.id === 'number' && meta.id > 0;
    });
    if (!displayedColors.length) {
      overlayMain.handleDisplayStatus('No active template colors available for jump.');
      return;
    }

    const jumpCycleVisitedCoordsKeys = syncTemplateJumpCycleState(
      buildTemplateJumpCycleScopeKey(activeTemplates, displayedColors, originMode)
    );

    const originCoords = getTemplateJumpOriginCoords(originMode);
    const originPoint = tilePixelCoordsToWorldPoint(originCoords);
    if (!originPoint) {
      overlayMain.handleDisplayError('Map position is unavailable.');
      return;
    }

    overlayMain.handleDisplayStatus(
      originMode === 'center'
        ? 'Searching for the next unpainted template pixel...'
        : `Searching for the next unpainted template pixel from the ${originLabel}...`
    );
    const excludedCoordsKeys = new Set(jumpCycleVisitedCoordsKeys);
    excludedCoordsKeys.add(originPoint.coords.join(','));
    const displayedColorSet = new Set(displayedColors);
    let bestCandidate = profiler.measure('findNearestCachedTemplatePixel', () => findNearestCachedTemplatePixel(originPoint, displayedColorSet, excludedCoordsKeys));
    const tileCandidatesMap = new Map();
    for (const template of activeTemplates) {
      const tileKeys = template.getChunkKeys?.() ?? Object.keys(template.chunkedBuffer ?? template.chunked ?? {});
      for (const tileKey of tileKeys) {
        const parsedTileKey = parseTemplateChunkKey(tileKey);
        if (!parsedTileKey) continue;
        const tilePrefix = `${parsedTileKey[0].toString().padStart(4, '0')},${parsedTileKey[1].toString().padStart(4, '0')}`;
        if (!tileCandidatesMap.has(tilePrefix)) {
          tileCandidatesMap.set(tilePrefix, {
            tileX: parsedTileKey[0],
            tileY: parsedTileKey[1],
            lowerBoundDistanceSq: getTileLowerBoundDistanceSq(originPoint, parsedTileKey[0], parsedTileKey[1]),
            entries: [],
          });
        }
        tileCandidatesMap.get(tilePrefix).entries.push({
          template,
          tileKey,
          offsetX: parsedTileKey[2],
          offsetY: parsedTileKey[3],
        });
      }
    }

    const tileCandidates = [...tileCandidatesMap.values()]
      .sort((left, right) => left.lowerBoundDistanceSq - right.lowerBoundDistanceSq);
    const memorySavingMode = templateManager.isMemorySavingModeOn();
    for (const tileCandidate of tileCandidates) {
      if (bestCandidate && tileCandidate.lowerBoundDistanceSq > bestCandidate.distanceSq) {
        break;
      }
      try {
        const liveTilePixels = await profiler.measureAsync('getLiveTilePixels', () => getLiveTilePixels(tileCandidate.tileX, tileCandidate.tileY));
        const tileCandidateBest = await profiler.measureAsync('findNearestTemplatePixelInTile', () => findNearestTemplatePixelInTile(
          tileCandidate,
          liveTilePixels,
          originPoint,
          displayedColorSet,
          excludedCoordsKeys,
          memorySavingMode
        ));
        if (tileCandidateBest && (!bestCandidate || tileCandidateBest.distanceSq < bestCandidate.distanceSq)) {
          bestCandidate = tileCandidateBest;
        }
      } catch (error) {
        consoleWarn('Failed to inspect live tile for next template pixel jump.', {
          tileX: tileCandidate.tileX,
          tileY: tileCandidate.tileY,
          error,
        });
      }
    }

    if (!bestCandidate) {
      if (jumpCycleVisitedCoordsKeys.size > 0) {
        jumpCycleVisitedCoordsKeys.clear();
        overlayMain.handleDisplayStatus(
          originMode === 'center'
            ? 'Reached the last unfinished pixel. Press J again to restart the cycle.'
            : `Reached the last unfinished pixel for the ${originLabel} jump. Trigger it again to restart the cycle.`
        );
        return;
      }
      overlayMain.handleDisplayStatus('No other unpainted pixels found for active templates.');
      return;
    }

    jumpCycleVisitedCoordsKeys.add(bestCandidate.coordsKey);
    await teleportToTileCoords(bestCandidate.coords.slice(0, 2), bestCandidate.coords.slice(2, 4), {
      revealPixelInfo: false,
    });
    schedulePixelInfoCloseBurst();
    applyIntegerZoomLevel(NEXT_TEMPLATE_PIXEL_ZOOM_LEVEL);
    const templateLabel = bestCandidate.templateName ? ` in "${bestCandidate.templateName}"` : '';
    const originSuffix = originMode === 'center' ? '' : ` from ${originLabel}`;
    overlayMain.handleDisplayStatus(`Jumped to next unpainted pixel${originSuffix}${templateLabel}: ${formatTilePixelCoords(bestCandidate.coords)}.`);
  } catch (error) {
    consoleWarn('Failed to jump to the next unpainted template pixel.', error);
    overlayMain.handleDisplayError('Failed to find the next unpainted template pixel.');
  } finally {
    isJumpToNextTemplatePixelRunning = false;
  }
}

function resolveDistanceMapInstance() {
  const direct = document.head?.['__bmmap'];
  if (direct && typeof direct['project'] === 'function') return direct;
  const myLocationButton = document.querySelector('.right-3>button');
  const fallback = myLocationButton?.['__click']?.[3]?.['v'];
  if (fallback && typeof fallback['project'] === 'function') return fallback;
  return null;
}

function tilePixelCoordsToWorldPoint(rawCoords) {
  const coords = normalizeTilePixelCoords(rawCoords);
  if (!coords) return null;
  const [tx, ty, px, py] = coords;
  const [lat, lng] = coordsTileCoordsToGeoCoords([tx, ty], [px, py], true);
  return {
    coords,
    x: tx * 1000 + px,
    y: ty * 1000 + py,
    lat,
    lng,
  };
}

function formatTilePixelCoords(coords) {
  const normalized = normalizeTilePixelCoords(coords);
  if (!normalized) return 'Unavailable';
  const [tx, ty, px, py] = normalized;
  return `Tl X: ${tx}, Tl Y: ${ty}, Px X: ${px}, Px Y: ${py}`;
}

function getDistanceMetrics(startPoint, endPoint) {
  if (!startPoint || !endPoint) return null;
  let dx = endPoint.x - startPoint.x;
  if (Math.abs(dx) > MAP_WORLD_WIDTH_PX / 2) {
    dx += dx > 0 ? -MAP_WORLD_WIDTH_PX : MAP_WORLD_WIDTH_PX;
  }
  const dy = endPoint.y - startPoint.y;
  const width = Math.abs(dx) + 1;
  const height = Math.abs(dy) + 1;
  const area = width * height;
  const euclidean = Math.hypot(dx, dy);
  const chebyshev = Math.max(Math.abs(dx), Math.abs(dy));
  const manhattan = Math.abs(dx) + Math.abs(dy);
  return { dx, dy, width, height, area, euclidean, chebyshev, manhattan };
}

function formatDistanceMetrics(metrics) {
  if (!metrics) return t('distance.output.unavailable');
  const numberFmt = new Intl.NumberFormat();
  const euclideanText = metrics.euclidean.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (value) => `${value >= 0 ? '+' : ''}${numberFmt.format(value)}`;
  return t('distance.output', {
    euclidean: euclideanText,
    dx: signed(metrics.dx),
    dy: signed(metrics.dy),
    width: numberFmt.format(metrics.width),
    height: numberFmt.format(metrics.height),
    area: numberFmt.format(metrics.area),
    grid: numberFmt.format(metrics.chebyshev),
    manhattan: numberFmt.format(metrics.manhattan),
  });
}

function setDistanceToolOutput(text) {
  distanceMeasureState.lastOutput = text;
  const output = document.getElementById('bm-distance-output');
  if (output) {
    output.textContent = text;
  }
}

function syncDistanceToolUi() {
  const button = document.getElementById('bm-button-distance');
  if (button) {
    button.classList.toggle('bm-distance-active', distanceMeasureState.active);
    button.title = distanceMeasureState.active
      ? t('distance.button.on')
      : t('distance.button.off');
  }

  const output = document.getElementById('bm-distance-output');
  if (output) {
    output.textContent = distanceMeasureState.lastOutput;
  }
}

function ensureDistanceLineCanvas() {
  const map = distanceMeasureState.map;
  if (!map) return;
  if (!distanceMeasureState.lineCanvas || !distanceMeasureState.lineCanvas.isConnected) {
    const mapContainer =
      map['getCanvasContainer']?.() ||
      map['getContainer']?.() ||
      document.querySelector('#map');
    if (!mapContainer) return;

    distanceMeasureState.mapContainer = mapContainer;
    const canvas = document.createElement('canvas');
    canvas.id = 'bm-distance-line-layer';
    canvas.className = 'bm-distance-line-layer';
    mapContainer.appendChild(canvas);
    distanceMeasureState.lineCanvas = canvas;
    distanceMeasureState.lineContext = canvas.getContext('2d');
  }
  resizeDistanceLineCanvas();
}

function removeDistanceLineCanvas() {
  if (distanceMeasureState.lineCanvas) {
    distanceMeasureState.lineCanvas.width = 0;
    distanceMeasureState.lineCanvas.height = 0;
    distanceMeasureState.lineCanvas.remove();
  }
  distanceMeasureState.lineCanvas = null;
  distanceMeasureState.lineContext = null;
}

function resizeDistanceLineCanvas() {
  const canvas = distanceMeasureState.lineCanvas;
  const ctx = distanceMeasureState.lineContext;
  const map = distanceMeasureState.map;
  if (!canvas || !ctx || !map) return;
  const mapCanvas = map['getCanvas']?.();
  const width = mapCanvas?.clientWidth ?? mapCanvas?.width ?? 0;
  const height = mapCanvas?.clientHeight ?? mapCanvas?.height ?? 0;
  if (!(width > 0) || !(height > 0)) return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const nextWidth = Math.round(width * dpr);
  const nextHeight = Math.round(height * dpr);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.dataset.dpr = dpr.toString();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function clearDistanceLineDrawing() {
  const canvas = distanceMeasureState.lineCanvas;
  const ctx = distanceMeasureState.lineContext;
  if (!canvas || !ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function projectDistancePoint(point) {
  if (!point || !distanceMeasureState.map || typeof distanceMeasureState.map['project'] !== 'function') return null;
  const projected = distanceMeasureState.map['project']([point.lng, point.lat]);
  if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null;
  return { x: projected.x, y: projected.y };
}

function alignProjectedDistancePoints(startProjected, endProjected) {
  if (!startProjected) return null;
  if (!endProjected) return { start: startProjected, end: null };

  let startX = startProjected.x;
  let endX = endProjected.x;
  const worldSize = Number(distanceMeasureState.map?.['transform']?.['worldSize']);
  if (Number.isFinite(worldSize) && worldSize > 0) {
    while (endX - startX > worldSize / 2) endX -= worldSize;
    while (endX - startX < -worldSize / 2) endX += worldSize;

    const mapCanvas = distanceMeasureState.map?.['getCanvas']?.();
    const canvasWidth = mapCanvas?.clientWidth ?? mapCanvas?.width ?? 0;
    const centerX = canvasWidth / 2;
    while (startX - centerX > worldSize / 2) {
      startX -= worldSize;
      endX -= worldSize;
    }
    while (startX - centerX < -worldSize / 2) {
      startX += worldSize;
      endX += worldSize;
    }
  }

  return {
    start: { x: startX, y: startProjected.y },
    end: { x: endX, y: endProjected.y },
  };
}

function drawDistanceLineOverlay() {
  if (!distanceMeasureState.active) {
    clearDistanceLineDrawing();
    return;
  }
  ensureDistanceMapAttached();
  ensureDistanceLineCanvas();
  const canvas = distanceMeasureState.lineCanvas;
  const ctx = distanceMeasureState.lineContext;
  if (!canvas || !ctx) return;
  clearDistanceLineDrawing();

  if (!distanceMeasureState.startPoint) return;

  const startProjected = projectDistancePoint(distanceMeasureState.startPoint);
  const endProjected = projectDistancePoint(distanceMeasureState.hoverPoint);
  const projected = alignProjectedDistancePoints(startProjected, endProjected);
  if (!projected?.start) return;

  const dpr = Number(canvas.dataset.dpr || '1');
  const strokeColor = getComputedStyle(document.getElementById('bm-overlay') ?? document.documentElement).getPropertyValue('--bm-accent-strong').trim() || '#ffe8ee';
  const shadowColor = 'rgba(0, 0, 0, 0.55)';
  const lineOutlineColor = 'rgba(0, 0, 0, 0.88)';
  const lineInnerColor = 'rgba(255, 255, 255, 0.96)';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (projected.end) {
    ctx.setLineDash([]);
    ctx.strokeStyle = lineOutlineColor;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(projected.start.x, projected.start.y);
    ctx.lineTo(projected.end.x, projected.end.y);
    ctx.stroke();

    ctx.strokeStyle = lineInnerColor;
    ctx.lineWidth = 4.25;
    ctx.beginPath();
    ctx.moveTo(projected.start.x, projected.start.y);
    ctx.lineTo(projected.end.x, projected.end.y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.35;
    ctx.beginPath();
    ctx.moveTo(projected.start.x, projected.start.y);
    ctx.lineTo(projected.end.x, projected.end.y);
    ctx.stroke();

    const metrics = getDistanceMetrics(distanceMeasureState.startPoint, distanceMeasureState.hoverPoint);
    if (metrics) {
      const x0 = projected.start.x;
      const y0 = projected.start.y;
      const x1 = projected.end.x;
      const y1 = projected.end.y;
      const cornerX = x1;
      const cornerY = y0;

      const canvasW = canvas.width / dpr;
      const canvasH = canvas.height / dpr;
      const LABEL_MARGIN = 4;
      const clampToBounds = (cx, cy, w, h) => ({
        x: Math.max(w / 2 + LABEL_MARGIN, Math.min(canvasW - w / 2 - LABEL_MARGIN, cx)),
        y: Math.max(h / 2 + LABEL_MARGIN, Math.min(canvasH - h / 2 - LABEL_MARGIN, cy)),
      });
      const rectsOverlap = (ax, ay, aw, ah, bx, by, bw, bh, gap = 4) =>
        Math.abs(ax - bx) < (aw + bw) / 2 + gap && Math.abs(ay - by) < (ah + bh) / 2 + gap;

      // Returns bounding box { cx, cy, w, h } for later overlap checking.
      const drawGuideLabel = (text, rawX, rawY) => {
        const padX = 5;
        const padY = 2;
        ctx.font = '600 10px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(text).width;
        const w = textWidth + padX * 2;
        const h = 12 + padY * 2;
        const { x: cx, y: cy } = clampToBounds(rawX, rawY, w, h);
        const boxLeft = cx - w / 2;
        const boxTop = cy - h / 2;
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
        ctx.fillRect(boxLeft, boxTop, w, h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxLeft + 0.5, boxTop + 0.5, w - 1, h - 1);
        ctx.fillStyle = strokeColor;
        ctx.fillText(text, cx, cy);
        return { cx, cy, w, h };
      };

      const drawGuideSegment = (fromX, fromY, toX, toY) => {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = lineOutlineColor;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.strokeStyle = lineInnerColor;
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
      };

      ctx.globalAlpha = 0.85;
      const widthLabelOffsetY = y1 >= y0 ? -12 : 12;
      const heightLabelOffsetX = x1 >= x0 ? 12 : -12;
      let wBox = null;
      let hBox = null;
      if (metrics.width > 1) {
        drawGuideSegment(x0, y0, cornerX, cornerY);
        wBox = drawGuideLabel(`W: ${metrics.width}px`, (x0 + cornerX) / 2, y0 + widthLabelOffsetY);
      }
      if (metrics.height > 1) {
        drawGuideSegment(cornerX, cornerY, x1, y1);
        hBox = drawGuideLabel(`H: ${metrics.height}px`, x1 + heightLabelOffsetX, (cornerY + y1) / 2);
      }
      ctx.globalAlpha = 1;

      const labelText = `${metrics.euclidean.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} px | area ${metrics.area.toLocaleString()}`;
      const dxLine = projected.end.x - projected.start.x;
      const dyLine = projected.end.y - projected.start.y;
      const lineLen = Math.hypot(dxLine, dyLine);
      const nx = lineLen > 0 ? -dyLine / lineLen : 0;
      const ny = lineLen > 0 ? dxLine / lineLen : -1;
      const midX = (projected.start.x + projected.end.x) / 2;
      const midY = (projected.start.y + projected.end.y) / 2;

      const hypPadX = 6;
      const hypPadY = 3;
      ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hypTextWidth = ctx.measureText(labelText).width;
      const hypW = hypTextWidth + hypPadX * 2;
      const hypH = 14 + hypPadY * 2;

      // Try perpendicular offsets on both sides until a non-overlapping position is found.
      let hypCX = midX;
      let hypCY = midY;
      let placed = false;
      const tryOffsets = [18, 28, 40, 56];
      const trySides = [1, -1];
      outer: for (const dist of tryOffsets) {
        for (const side of trySides) {
          const { x: cx, y: cy } = clampToBounds(midX + nx * dist * side, midY + ny * dist * side, hypW, hypH);
          const clearW = !wBox || !rectsOverlap(cx, cy, hypW, hypH, wBox.cx, wBox.cy, wBox.w, wBox.h);
          const clearH = !hBox || !rectsOverlap(cx, cy, hypW, hypH, hBox.cx, hBox.cy, hBox.w, hBox.h);
          if (clearW && clearH) {
            hypCX = cx;
            hypCY = cy;
            placed = true;
            break outer;
          }
        }
      }
      if (!placed) {
        const { x: cx, y: cy } = clampToBounds(midX + nx * 18, midY + ny * 18, hypW, hypH);
        hypCX = cx;
        hypCY = cy;
      }

      ctx.setLineDash([]);
      const hypBoxLeft = hypCX - hypW / 2;
      const hypBoxTop = hypCY - hypH / 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fillRect(hypBoxLeft, hypBoxTop, hypW, hypH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(hypBoxLeft + 0.5, hypBoxTop + 0.5, hypW - 1, hypH - 1);
      ctx.fillStyle = strokeColor;
      ctx.fillText(labelText, hypCX, hypCY);
    }
  }

  const drawMarker = (x, y) => {
    ctx.beginPath();
    ctx.fillStyle = lineOutlineColor;
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = lineInnerColor;
    ctx.arc(x, y, 4.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = strokeColor;
    ctx.arc(x, y, 2.7, 0, Math.PI * 2);
    ctx.fill();
  };

  drawMarker(projected.start.x, projected.start.y);
  if (projected.end) {
    drawMarker(projected.end.x, projected.end.y);
  }
}

function mapEventToWorldPoint(event) {
  const lat = Number(event?.lngLat?.lat);
  const lng = Number(event?.lngLat?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const [coordsTile, coordsPixel] = coordsGeoCoordsToTileCoords(lat, lng, true);
  const point = tilePixelCoordsToWorldPoint([coordsTile[0], coordsTile[1], coordsPixel[0], coordsPixel[1]]);
  return point;
}

function updateDistanceOutputForPoint(point, announce = false) {
  const metrics = getDistanceMetrics(distanceMeasureState.startPoint, point);
  const message = formatDistanceMetrics(metrics);
  setDistanceToolOutput(message);
  if (announce) {
    overlayMain.handleDisplayStatus(message);
  }
}

function handleDistanceMapMouseMove(event) {
  if (!distanceMeasureState.active || !distanceMeasureState.startPoint) return;
  const point = mapEventToWorldPoint(event);
  if (!point) return;
  distanceMeasureState.hoverPoint = point;
  updateDistanceOutputForPoint(point, false);
  drawDistanceLineOverlay();
}

function handleDistanceMapMouseLeave() {
  if (!distanceMeasureState.active) return;
  distanceMeasureState.hoverPoint = null;
  if (distanceMeasureState.startPoint) {
    const startText = formatTilePixelCoords(distanceMeasureState.startPoint.coords);
    setDistanceToolOutput(t('distance.output.start', { coords: startText }));
  }
  drawDistanceLineOverlay();
}

function handleDistanceMapViewChanged() {
  if (!distanceMeasureState.active) return;
  drawDistanceLineOverlay();
}

function handleDistanceMapContextMenu(event) {
  if (!distanceMeasureState.active) return;
  event?.originalEvent?.preventDefault?.();
  event?.originalEvent?.stopPropagation?.();
  setDistanceToolActive(false, overlayMain);
}

function bindDistanceMapEvents() {
  const map = distanceMeasureState.map;
  if (!map || distanceMeasureState.mapEventsBound || typeof map['on'] !== 'function') return;
  map['on']('mousemove', handleDistanceMapMouseMove);
  map['on']('contextmenu', handleDistanceMapContextMenu);
  ['move', 'zoom', 'resize', 'moveend', 'zoomend', 'rotate', 'pitch'].forEach((eventName) => {
    map['on'](eventName, handleDistanceMapViewChanged);
  });
  const mapContainer =
    map['getCanvasContainer']?.() ||
    map['getContainer']?.() ||
    document.querySelector('#map');
  if (mapContainer) {
    distanceMeasureState.mapContainer = mapContainer;
    mapContainer.addEventListener('mouseleave', handleDistanceMapMouseLeave);
  }
  distanceMeasureState.mapEventsBound = true;
}

function unbindDistanceMapEvents() {
  const map = distanceMeasureState.map;
  if (!map || !distanceMeasureState.mapEventsBound || typeof map['off'] !== 'function') return;
  map['off']('mousemove', handleDistanceMapMouseMove);
  map['off']('contextmenu', handleDistanceMapContextMenu);
  ['move', 'zoom', 'resize', 'moveend', 'zoomend', 'rotate', 'pitch'].forEach((eventName) => {
    map['off'](eventName, handleDistanceMapViewChanged);
  });
  if (distanceMeasureState.mapContainer) {
    distanceMeasureState.mapContainer.removeEventListener('mouseleave', handleDistanceMapMouseLeave);
  }
  distanceMeasureState.mapEventsBound = false;
}

function ensureDistanceMapAttached() {
  if (!distanceMeasureState.map || typeof distanceMeasureState.map['project'] !== 'function') {
    const map = resolveDistanceMapInstance();
    if (!map) return false;
    distanceMeasureState.map = map;
  }
  if (distanceMeasureState.mapReadyPollId) {
    clearInterval(distanceMeasureState.mapReadyPollId);
    distanceMeasureState.mapReadyPollId = null;
  }
  if (distanceMeasureState.active) {
    bindDistanceMapEvents();
    ensureDistanceLineCanvas();
  }
  return true;
}

function startDistanceMapPolling() {
  if (distanceMeasureState.mapReadyPollId) return;
  distanceMeasureState.mapReadyPollId = setInterval(() => {
    if (ensureDistanceMapAttached()) {
      clearInterval(distanceMeasureState.mapReadyPollId);
      distanceMeasureState.mapReadyPollId = null;
      drawDistanceLineOverlay();
    }
  }, 2000);
}

function setDistanceToolActive(active, overlayInstance) {
  distanceMeasureState.active = Boolean(active);
  distanceMeasureState.startPoint = null;
  distanceMeasureState.hoverPoint = null;
  if (distanceMeasureState.active) {
    setDistanceToolOutput(t('distance.output.clickStart'));
    overlayInstance?.handleDisplayStatus('Distance tool enabled. Click one pixel to set start, then move the cursor to measure in real time.');
    doAfterMapFound(() => {
      if (distanceMeasureState.active && ensureDistanceMapAttached()) {
        drawDistanceLineOverlay();
      }
    });
    if (!ensureDistanceMapAttached()) {
      startDistanceMapPolling();
    } else {
      drawDistanceLineOverlay();
    }
  } else {
    unbindDistanceMapEvents();
    removeDistanceLineCanvas();
    if (distanceMeasureState.mapReadyPollId) {
      clearInterval(distanceMeasureState.mapReadyPollId);
      distanceMeasureState.mapReadyPollId = null;
    }
    setDistanceToolOutput('');
    overlayInstance?.handleDisplayStatus('Distance tool disabled.');
  }
  syncDistanceToolUi();
}

function handleDistanceToolCoordsUpdate(rawCoords) {
  if (!distanceMeasureState.active) return;
  const point = tilePixelCoordsToWorldPoint(rawCoords);
  if (!point) return;
  distanceMeasureState.hoverPoint = point;

  if (!distanceMeasureState.startPoint) {
    distanceMeasureState.startPoint = point;
    const startText = formatTilePixelCoords(point.coords);
    setDistanceToolOutput(t('distance.output.start', { coords: startText }));
    overlayMain.handleDisplayStatus(`Distance start point set at (${startText}).`);
    drawDistanceLineOverlay();
    syncDistanceToolUi();
    return;
  }

  updateDistanceOutputForPoint(point, true);
  drawDistanceLineOverlay();
  syncDistanceToolUi();
}

const persistCoords = () => {
  try {
    const [[tx, ty], [px, py]] = getOverlayCoords();
    const data = { tx, ty, px, py };
    GM.setValue('bmCoords', JSON.stringify(data));
  } catch (_) {}
};

const teleportCoords = () => {
  try {
    const [[tx, ty], [px, py]] = getOverlayCoords();
    teleportToTileCoords([tx, ty], [px, py]);
  } catch (_) {}
};

const setFirstTextNode = (element, text) => {
  if (!element) return;
  let textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (!textNode) {
    textNode = document.createTextNode('');
    element.insertBefore(textNode, element.firstChild);
  }
  textNode.textContent = text;
};

const setSummaryText = (detailsId, text) => {
  const summary = document.querySelector(`#${detailsId} > summary`);
  if (!summary) return;
  setFirstTextNode(summary, text);
};

const setCheckboxLabelText = (inputId, text) => {
  const input = document.getElementById(inputId);
  const label = input?.parentElement;
  if (!(label instanceof HTMLLabelElement)) return;
  let textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (!textNode) {
    textNode = document.createTextNode('');
    label.insertBefore(textNode, input.nextSibling);
  }
  textNode.textContent = text;
};

const replaceSelectOptions = (select, entries, selectedValue = null) => {
  if (!(select instanceof HTMLSelectElement)) return;
  const nextValue = selectedValue ?? select.value;
  select.textContent = '';
  entries.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (String(value) === String(nextValue)) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  if (nextValue !== null && nextValue !== undefined) {
    select.value = String(nextValue);
  }
};

const syncTemplateStreamsHelpLanguage = () => {
  const help = document.getElementById('bm-template-streams-help');
  if (!help) return;
  help.textContent = '';
  const beta = document.createElement('b');
  beta.textContent = t('settings.templateStreams.helpPrefix');
  help.appendChild(beta);
  help.append(t('settings.templateStreams.helpBody'));
  const link = document.createElement('a');
  link.href = 'https://t.me/rusmarble_bot';
  link.textContent = '@rusmarble_bot';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.color = 'var(--bm-link, #8ecbff)';
  link.style.textDecoration = 'underline';
  help.appendChild(link);
  help.append('.');
};

const getNextPixelPluralSuffix = (count) => {
  const numeric = Math.abs(Number(count));
  if (currentLayoutLanguage !== 'ru') {
    return Number.isFinite(numeric) && numeric === 1 ? '' : t('user.morePixelPlural');
  }
  if (!Number.isFinite(numeric)) {
    return 'ей';
  }
  const mod100 = numeric % 100;
  const mod10 = numeric % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return 'ей';
  }
  if (mod10 === 1) {
    return 'ь';
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return 'я';
  }
  return 'ей';
};

const syncNextLevelRowLanguage = () => {
  const row = document.getElementById('bm-user-nextlevel-row');
  if (!row) return;
  const nodes = Array.from(row.childNodes);
  const morePixelNode = nodes.find((node, index) =>
    node.nodeType === Node.TEXT_NODE
    && nodes[index - 1] instanceof HTMLElement
    && nodes[index - 1].id === 'bm-user-nextpixel'
  );
  const toLevelNode = nodes.find((node, index) =>
    node.nodeType === Node.TEXT_NODE
    && nodes[index - 1] instanceof HTMLElement
    && nodes[index - 1].id === 'bm-user-nextpixel-plural'
  );
  if (morePixelNode) {
    morePixelNode.textContent = t('user.morePixel');
  }
  if (toLevelNode) {
    toLevelNode.textContent = t('user.toLevel');
  }
  const nextPixel = document.getElementById('bm-user-nextpixel');
  const plural = document.getElementById('bm-user-nextpixel-plural');
  if (!plural) return;
  const numeric = Number(String(nextPixel?.textContent || '').replace(/[^\d.-]/g, ''));
  plural.textContent = getNextPixelPluralSuffix(numeric);
};

const syncStatusBoxLanguage = () => {
  const statusBox = document.getElementById(overlayMain.outputStatusId);
  if (!(statusBox instanceof HTMLTextAreaElement)) return;
  statusBox.placeholder = t('status.placeholder', { version });
  const currentText = String(statusBox.value || statusBox.textContent || '');
  const match = currentText.match(/^(Status|Статус|Error|Ошибка):\s*(.*)$/s);
  if (!match) return;
  const [, prefix, message] = match;
  const nextPrefix = /error|ошибка/i.test(prefix) ? t('error.label') : t('status.label');
  statusBox.value = `${nextPrefix}: ${message}`;
};

const syncChatStaticLanguage = () => {
  const banTypeSelect = document.getElementById('bm-chat-ban-type');
  replaceSelectOptions(
    banTypeSelect,
    [
      ['ip', getChatBanTypeLabel(currentLayoutLanguage, 'ip')],
      ['device', getChatBanTypeLabel(currentLayoutLanguage, 'device')],
    ],
    banTypeSelect?.value || 'ip'
  );
  const banTarget = document.getElementById('bm-chat-ban-target');
  if (banTarget) banTarget.placeholder = t('chat.banTargetPlaceholder');
  const banReason = document.getElementById('bm-chat-ban-reason');
  if (banReason) banReason.placeholder = t('chat.banReasonPlaceholder');
  const banBtn = document.getElementById('bm-chat-ban-btn');
  if (banBtn) banBtn.textContent = t('chat.ban');
  const bansBtn = document.getElementById('bm-chat-bans-btn');
  if (bansBtn) bansBtn.textContent = t('chat.bans');
  const replyLabel = document.getElementById('bm-chat-reply-label');
  if (replyLabel) {
    const current = String(replyLabel.textContent || '').trim();
    const match = current.match(/^(?:Replying to|Ответ на)\s+(.*)$/);
    replyLabel.textContent = match ? `${t('chat.replyingTo')} ${match[1]}` : t('chat.replyingTo');
  }
  const userInput = document.getElementById('bm-chat-user');
  if (userInput) userInput.placeholder = t('chat.userPlaceholder');
  const textInput = document.getElementById('bm-chat-text');
  if (textInput && !/^Banned \(/.test(textInput.placeholder || '')) {
    textInput.placeholder = t('chat.messagePlaceholder');
  }
  const modCodeInput = document.getElementById('bm-chat-modcode');
  if (modCodeInput) modCodeInput.placeholder = t('chat.codePlaceholder');
  const statusLight = document.querySelector('.bm-chat-status-light');
  if (statusLight) statusLight.title = t('chat.statusLightTitle');
  const floatButton = document.querySelector('.bm-chat-float-toggle');
  if (floatButton instanceof HTMLButtonElement) {
    const isDock = floatButton.textContent?.trim() === '⇱';
    floatButton.title = isDock ? t('chat.dockTitle') : t('chat.floatTitle');
    floatButton.setAttribute('aria-label', isDock ? t('chat.dockAria') : t('chat.floatAria'));
  }
};

const syncTemplatePositionJoystickLanguage = () => {
  const panel = document.getElementById('bm-template-position-joystick');
  if (!panel) return;
  const hint = panel.querySelector('.bm-template-position-joystick-hint');
  if (hint) hint.textContent = t('joystick.hint');
  const up = panel.querySelector('.bm-template-position-joystick-up');
  if (up) up.title = t('joystick.moveUp');
  const left = panel.querySelector('.bm-template-position-joystick-left');
  if (left) left.title = t('joystick.moveLeft');
  const right = panel.querySelector('.bm-template-position-joystick-right');
  if (right) right.title = t('joystick.moveRight');
  const down = panel.querySelector('.bm-template-position-joystick-down');
  if (down) down.title = t('joystick.moveDown');
  const archiveBtn = panel.querySelector('[data-role="archive-edit-btn"]');
  if (archiveBtn) {
    archiveBtn.textContent = t('joystick.archiveDate');
    archiveBtn.title = t('joystick.archiveDateTitle');
  }
  const downloadBtn = panel.querySelector('[data-role="template-download-btn"]');
  if (downloadBtn) {
    downloadBtn.textContent = t('joystick.download');
    downloadBtn.title = t('joystick.downloadTitle');
  }
};

const syncOverlayBrandLanguage = () => {
  const title = document.getElementById('bm-overlay-title');
  if (title) setFirstTextNode(title, t('brand.name'));
  const logo = document.getElementById('bm-overlay-logo');
  if (!logo) return;
  const overlay = document.getElementById('bm-overlay');
  if (!overlay) {
    logo.alt = t('brand.iconAlt');
    return;
  }
  logo.alt = overlay.classList.contains('bm-overlay-minimized') ? t('brand.iconAltMin') : t('brand.iconAltMax');
};

const applyLayoutLanguage = (value = null) => {
  currentLayoutLanguage = normalizeLayoutLanguage(value ?? templateManager.getLayoutLanguage?.());
  document.documentElement.dataset.bmLayoutLanguage = currentLayoutLanguage;
  const overlayElement = document.getElementById('bm-overlay');
  if (overlayElement) {
    overlayElement.classList.toggle('bm-layout-language-ru', currentLayoutLanguage === 'ru');
  }
  overlayMain.setStatusLabels({ status: t('status.label'), error: t('error.label') });
  syncOverlayBrandLanguage();

  setSummaryText('bm-checkbox-container', t('settings.section'));
  const languageLabel = document.getElementById('bm-layout-language-label');
  if (languageLabel) languageLabel.textContent = t('settings.language.label');
  const languageSelect = document.getElementById('bm-layout-language');
  replaceSelectOptions(languageSelect, Object.entries(layoutLanguageOptions), currentLayoutLanguage);
  const templateStreamsLabel = document.getElementById('bm-template-sync-streams-label');
  if (templateStreamsLabel) templateStreamsLabel.textContent = t('settings.templateStreams.label');
  const templateStreamsInput = document.getElementById('bm-template-sync-streams');
  if (templateStreamsInput) templateStreamsInput.placeholder = t('settings.templateStreams.placeholder');
  syncTemplateStreamsHelpLanguage();
  const layoutThemeLabel = document.getElementById('bm-layout-theme-label');
  if (layoutThemeLabel) layoutThemeLabel.textContent = t('settings.layoutTheme.label');
  replaceSelectOptions(
    document.getElementById('bm-layout-theme'),
    Object.keys(layoutThemeOptions).map((valueKey) => [valueKey, getLayoutThemeLabel(valueKey)]),
    normalizeLayoutTheme(templateManager.getLayoutTheme())
  );
  setCheckboxLabelText('bm-theme-override-enabled', t('settings.themeOverride.label'));
  setCheckboxLabelText('bm-show-zoom-buttons', t('settings.showIntegerZoomButtons'));
  setCheckboxLabelText('bm-enable-keybinds', t('settings.enableKeybinds'));
  setCheckboxLabelText('bm-enable-next-template-pixel-shortcut', t('settings.enableNextTemplatePixelShortcut'));
  setCheckboxLabelText('bm-chat-enabled', t('settings.enableChat'));
  setCheckboxLabelText('bm-map-comments-enabled', t('settings.enableMapComments'));
  setCheckboxLabelText('bm-progress-bar-enabled', t('settings.showProgressBar'));
  setCheckboxLabelText('bm-hide-user-droplets', t('settings.hideDroplets'));
  setCheckboxLabelText('bm-hide-user-nextlevel', t('settings.hideNextLevel'));
  setCheckboxLabelText('bm-status-hidden', t('settings.hideStatusDisplay'));
  const templateDisplayLabel = document.getElementById('bm-template-display-label');
  if (templateDisplayLabel) templateDisplayLabel.textContent = t('settings.templateDisplay.label');
  replaceSelectOptions(
    document.getElementById('bm-template-display'),
    Object.keys(templateDisplayOptions).map((valueKey) => [valueKey, getTemplateDisplayLabel(valueKey)]),
    normalizeTemplateDisplay(templateManager.getTemplateDisplayMode())
  );
  setCheckboxLabelText('bm-template-list-remaining', t('settings.showRemainingCount'));
  setCheckboxLabelText('bm-enable-line-template', t('settings.shapeTemplates'));
  setCheckboxLabelText('bm-ruspixel-flag-enabled', t('settings.ruspixelFlag'));
  setCheckboxLabelText('bm-auto-sync-templates', t('settings.autoUpdateTemplates'));
  setCheckboxLabelText('bm-only-current-color-enabled', t('settings.showCurrentColorOnly'));
  setCheckboxLabelText('bm-checkbox-colors-unlocked', t('settings.hideLockedColors'));
  setCheckboxLabelText('bm-checkbox-colors-completed', t('settings.hideCompletedColors'));
  setCheckboxLabelText('bm-show-error-map', t('settings.showErrorMap'));
  setCheckboxLabelText('bm-show-only-enabled-colors-on-error-map', t('settings.onlyEnabledColorsOnErrorMap'));
  setCheckboxLabelText('bm-event-enabled', t('settings.enableEvent'));
  setCheckboxLabelText('bm-event-hide-claimed', t('settings.hideClaimedEventItems'));
  setCheckboxLabelText('bm-event-hide-unavailable', t('settings.hideUnavailableEventItems'));
  setCheckboxLabelText('bm-background-mode-enabled', t('settings.backgroundMode'));
  setCheckboxLabelText('bm-memory-saving-enabled', t('settings.memorySaving'));
  setCheckboxLabelText('bm-debug-logs-enabled', t('settings.debugLogs'));

  setSummaryText('bm-contain-colorfilter', t('section.colors'));
  const colorSortLabel = document.getElementById('bm-color-sort-label');
  if (colorSortLabel) setFirstTextNode(colorSortLabel, t('colors.sortBy'));
  replaceSelectOptions(
    document.getElementById('bm-color-sort'),
    Object.keys(sortByOptions).flatMap((key) => ([
      [`${key}-asc`, getColorSortLabel(currentLayoutLanguage, key, 'asc')],
      [`${key}-desc`, getColorSortLabel(currentLayoutLanguage, key, 'desc')],
    ])),
    templateManager.getSortBy()
  );
  const enableAllColorsButton = document.getElementById('bm-button-colors-enable-all');
  if (enableAllColorsButton) enableAllColorsButton.textContent = t('colors.enableAll');
  const disableAllColorsButton = document.getElementById('bm-button-colors-disable-all');
  if (disableAllColorsButton) disableAllColorsButton.textContent = t('colors.disableAll');
  const disablePaidColorsButton = document.getElementById('bm-button-colors-disable-paid');
  if (disablePaidColorsButton) disablePaidColorsButton.textContent = t('colors.disablePaid');

  setSummaryText('bm-contain-templatefilter', t('section.templates'));
  replaceSelectOptions(
    document.getElementById('bm-template-create-mode'),
    [
      ['', getTemplateCreateModeLabel(currentLayoutLanguage, '')],
      [TEMPLATE_CREATE_MODE_IMAGE, getTemplateCreateModeLabel(currentLayoutLanguage, TEMPLATE_CREATE_MODE_IMAGE)],
      [TEMPLATE_CREATE_MODE_REMOTE_NAME, getTemplateCreateModeLabel(currentLayoutLanguage, TEMPLATE_CREATE_MODE_REMOTE_NAME)],
      [TEMPLATE_CREATE_MODE_TEXT, getTemplateCreateModeLabel(currentLayoutLanguage, TEMPLATE_CREATE_MODE_TEXT)],
      [TEMPLATE_CREATE_MODE_RUSSIAN_FLAG, getTemplateCreateModeLabel(currentLayoutLanguage, TEMPLATE_CREATE_MODE_RUSSIAN_FLAG)],
      [TEMPLATE_CREATE_MODE_TIME_ARCHIVE, getTemplateCreateModeLabel(currentLayoutLanguage, TEMPLATE_CREATE_MODE_TIME_ARCHIVE)],
    ],
    ''
  );
  const syncTemplatesButton = document.getElementById('bm-button-sync-templates');
  if (syncTemplatesButton) syncTemplatesButton.title = t('templates.syncTitle');

  setSummaryText('bm-contain-chat', t('section.chat'));
  syncChatStaticLanguage();

  setSummaryText('bm-contain-eventitem', t('section.event'));
  const setProviderButton = document.getElementById('bm-button-set-eventprovider');
  if (setProviderButton) setProviderButton.textContent = t('event.setProvider');
  const refreshEventButton = document.getElementById('bm-button-refresh-event');
  if (refreshEventButton) refreshEventButton.textContent = t('event.refresh');

  const usernameRow = document.getElementById('bm-user-name-row');
  if (usernameRow) setFirstTextNode(usernameRow, t('user.username'));
  const chargesRow = document.getElementById('bm-user-charges');
  if (chargesRow) setFirstTextNode(chargesRow, t('user.fullChargesIn'));
  const suspendRow = document.getElementById('bm-user-suspend');
  if (suspendRow) setFirstTextNode(suspendRow, t('user.suspensionExpiresIn'));
  const suspendReasonRow = document.getElementById('bm-user-suspend-reason');
  if (suspendReasonRow) setFirstTextNode(suspendReasonRow, t('user.reason'));
  const dropletsRow = document.getElementById('bm-user-droplets-row');
  if (dropletsRow) setFirstTextNode(dropletsRow, t('user.droplets'));
  syncNextLevelRowLanguage();
  const txInput = document.getElementById('bm-input-tx');
  if (txInput) txInput.placeholder = t('coords.placeholder.tx');
  const tyInput = document.getElementById('bm-input-ty');
  if (tyInput) tyInput.placeholder = t('coords.placeholder.ty');
  const pxInput = document.getElementById('bm-input-px');
  if (pxInput) pxInput.placeholder = t('coords.placeholder.px');
  const pyInput = document.getElementById('bm-input-py');
  if (pyInput) pyInput.placeholder = t('coords.placeholder.py');
  const teleportButton = document.getElementById('bm-button-teleport');
  if (teleportButton) teleportButton.title = t('coords.teleportTitle');

  syncStatusBoxLanguage();
  const convertButton = document.getElementById('bm-button-convert');
  if (convertButton) convertButton.title = t('action.colorConverter');
  const websiteButton = document.getElementById('bm-button-website');
  if (websiteButton) websiteButton.title = t('action.website');
  const footerText = document.getElementById('bm-footer-text');
  if (footerText) {
    footerText.textContent = t('footer.forkedBy');
    footerText.title = t('footer.title');
  }
  syncTemplatePositionJoystickLanguage();
  if (distanceMeasureState.active) {
    if (distanceMeasureState.hoverPoint && distanceMeasureState.startPoint) {
      updateDistanceOutputForPoint(distanceMeasureState.hoverPoint, false);
    } else if (distanceMeasureState.startPoint) {
      setDistanceToolOutput(t('distance.output.start', {
        coords: formatTilePixelCoords(distanceMeasureState.startPoint.coords),
      }));
    } else {
      setDistanceToolOutput(t('distance.output.clickStart'));
    }
  }
  syncDistanceToolUi();
  try { window.buildColorFilterList?.(); } catch (_) {}
  try { window.buildTemplateFilterList?.(); } catch (_) {}
  try { window.buildEventList?.(); } catch (_) {}
};
window.getBlueMarbleNextPixelPlural = (count) => getNextPixelPluralSuffix(count);

/** Deploys the overlay to the page with minimize/maximize functionality.
 * Creates a responsive overlay UI that can toggle between full-featured and minimized states.
 * 
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 * Changed to async since 0.85.17
 */
async function buildOverlayMain() {
  let isMinimized = false; // Overlay state tracker (false = maximized, true = minimized)
  // Load last saved coordinates (if any)
  let savedCoords = {};
  const savedCoordsValue = await GM.getValue('bmCoords', '{}');
  try {
    savedCoords = JSON.parse(savedCoordsValue) || {};
  } catch {
    savedCoords = {};
  }
  
  overlayMain.addDiv({'id': 'bm-overlay', 'style': 'top: 10px; right: 75px;'})
    .addDiv({'id': 'bm-contain-header'})
      .addDiv({'id': 'bm-bar-drag'}).buildElement()
      .addImg({'id': 'bm-overlay-logo', 'alt': t('brand.iconAlt'), 'src': 'https://raw.githubusercontent.com/korobkakonfet/rusmarble/custom-improve/dist/assets/logo_rusmarble.png', 'style': 'cursor: pointer;'},
        (instance, img) => {
          /** Click event handler for overlay minimize/maximize functionality.
           * 
           * Toggles between two distinct UI states:
           * 1. MINIMIZED STATE (60Ã—76px):
           *    - Shows only the Rus Marble icon and drag bar
           *    - Hides all input fields, buttons, and status information
           *    - Applies fixed dimensions for consistent appearance
           *    - Repositions icon with 3px right offset for visual centering
           * 
           * 2. MAXIMIZED STATE (responsive):
           *    - Restores full functionality with all UI elements
           *    - Removes fixed dimensions to allow responsive behavior
           *    - Resets icon positioning to default alignment
           *    - Shows success message when returning to maximized state
           * 
           * @param {Event} event - The click event object (implicit)
           */
          img.addEventListener('click', () => {
            isMinimized = !isMinimized; // Toggle the current state

            const overlay = document.querySelector('#bm-overlay');
            overlay?.classList.toggle('bm-overlay-minimized', isMinimized);
            document.dispatchEvent(new CustomEvent('bm-overlay-minimized-changed', { detail: { minimized: isMinimized } }));
            const header = document.querySelector('#bm-contain-header');
            const dragBar = document.querySelector('#bm-bar-drag');
            const coordsContainer = document.querySelector('#bm-contain-coords');
            const coordsButton = document.querySelector('#bm-button-coords');
            const createButton = document.querySelector('#bm-button-create');
            const enableButton = document.querySelector('#bm-button-enable');
            const disableButton = document.querySelector('#bm-button-disable');
            const eventContainer = document.querySelector('#bm-contain-eventitem');
            const coordInputs = document.querySelectorAll('#bm-contain-coords input');
            const statusTextbox = document.getElementById(instance.outputStatusId); // Status log textarea for user feedback
            
            // Pre-restore original dimensions when switching to maximized state
            // This ensures smooth transition and prevents layout issues
            if (!isMinimized) {
              overlay.style.width = "auto";
              overlay.style.maxWidth = "300px";
              overlay.style.minWidth = "200px";
              overlay.style.padding = "10px";
            }
            
            // Define elements that should be hidden/shown during state transitions
            // Each element is documented with its purpose for maintainability
            const elementsToToggle = [
              '#bm-overlay h1',                    // Main title "Rus Marble"
              '#bm-contain-userinfo',              // User information section (username, droplets, level)
              '#bm-overlay hr',                    // Visual separator lines
              '#bm-contain-automation > *:not(#bm-contain-coords)', // Automation section excluding coordinates
              '#bm-contain-buttons-action',        // Action buttons container
            ];
            
            // Apply visibility changes to all toggleable elements
            elementsToToggle.forEach(selector => {
              const elements = document.querySelectorAll(selector);
              elements.forEach(element => {
                element.style.display = isMinimized ? 'none' : '';
              });
            });
            // Handle coordinate container and button visibility based on state
            if (isMinimized) {
              // ==================== MINIMIZED STATE CONFIGURATION ====================
              // In minimized state, we hide ALL interactive elements except the icon and drag bar
              // This creates a clean, unobtrusive interface that maintains only essential functionality
              
              // Hide coordinate input container completely
              if (coordsContainer) {
                coordsContainer.style.display = 'none';
              }
              
              // Hide coordinate button (pin icon)
              if (coordsButton) {
                coordsButton.style.display = 'none';
              }
              
              // Hide create template button
              if (createButton) {
                createButton.style.display = 'none';
              }

              // Hide enable templates button
              if (enableButton) {
                enableButton.style.display = 'none';
              }

              // Hide disable templates button
              if (disableButton) {
                disableButton.style.display = 'none';
              }

              // Hide bm-contain-eventitem
              if (templateManager.isEventEnabled()) {
                eventContainer.style.display = 'none';
              }
              
              // Hide status textarea
              if (!templateManager.isStatusHidden()) {
                statusTextbox.style.display = 'none';
              }

              // Hide all coordinate input fields individually (failsafe)
              coordInputs.forEach(input => {
                input.style.display = 'none';
              });
              
              // Apply fixed dimensions for consistent minimized appearance
              // These dimensions were chosen to accommodate the icon while remaining compact
              overlay.style.width = '60px';    // Fixed width for consistency
              overlay.style.height = '76px';   // Fixed height (60px + 16px for better proportions)
              overlay.style.maxWidth = '60px';  // Prevent expansion
              overlay.style.minWidth = '60px';  // Prevent shrinking
              overlay.style.padding = '8px';    // Comfortable padding around icon
              
              // Apply icon positioning for better visual centering in minimized state
              // The 3px offset compensates for visual weight distribution
              img.style.marginLeft = '3px';
              
              // Configure header layout for minimized state
              header.style.textAlign = 'center';
              header.style.margin = '0';
              header.style.marginBottom = '0';
              
              // Ensure drag bar remains visible and properly spaced
              if (dragBar) {
                dragBar.style.display = '';
                dragBar.style.marginBottom = '0.35em';
              }
            } else {
              // ==================== MAXIMIZED STATE RESTORATION ====================
              // In maximized state, we restore all elements to their default functionality
              // This involves clearing all style overrides applied during minimization
              
              // Restore coordinate container to default state
              if (coordsContainer) {
                coordsContainer.style.display = '';           // Show container
                coordsContainer.style.flexDirection = '';     // Reset flex layout
                coordsContainer.style.justifyContent = '';    // Reset alignment
                coordsContainer.style.alignItems = '';        // Reset alignment
                coordsContainer.style.gap = '';               // Reset spacing
                coordsContainer.style.textAlign = '';         // Reset text alignment
                coordsContainer.style.margin = '';            // Reset margins
              }
              
              // Restore coordinate button visibility
              if (coordsButton) {
                coordsButton.style.display = '';
              }
              
              // Restore create button visibility and reset positioning
              if (createButton) {
                createButton.style.display = '';
                createButton.style.marginTop = '';
              }

              // Restore enable button visibility and reset positioning
              if (enableButton) {
                enableButton.style.display = '';
                enableButton.style.marginTop = '';
              }

              // Restore disable button visibility and reset positioning
              if (disableButton) {
                disableButton.style.display = '';
                disableButton.style.marginTop = '';
              }

              // Restore bm-contain-eventitem
              if (templateManager.isEventEnabled()) {
                eventContainer.style.display = '';
              } else {
                eventContainer.style.display = 'none'; // eventManager itself matches #bm-contain-automation > *:not(#bm-contain-coords)
              }
              
              // Restore status textarea
              if (!templateManager.isStatusHidden()) {
                statusTextbox.style.display = '';
              } else {
                statusTextbox.style.display = 'none'; // statusTextbox itself matches #bm-contain-automation > *:not(#bm-contain-coords)
              }
              
              // Restore all coordinate input fields
              coordInputs.forEach(input => {
                input.style.display = '';
              });
              
              // Reset icon positioning to default (remove minimized state offset)
              img.style.marginLeft = '';
              
              // Restore overlay to responsive dimensions
              overlay.style.padding = '10px';
              
              // Reset header styling to defaults
              header.style.textAlign = '';
              header.style.margin = '';
              header.style.marginBottom = '';
              
              // Reset drag bar spacing
              if (dragBar) {
                dragBar.style.marginBottom = '0.65em';
              }
              
              // Remove all fixed dimensions to allow responsive behavior
              // This ensures the overlay can adapt to content changes
              overlay.style.width = '';
              overlay.style.height = '';
            }
            
            // ==================== ACCESSIBILITY AND USER FEEDBACK ====================
            // Update accessibility information for screen readers and tooltips
            
            // Update alt text to reflect current state for screen readers and tooltips
            img.alt = isMinimized ? t('brand.iconAltMin') : t('brand.iconAltMax');
            
            // No status message needed - state change is visually obvious to users
          });
        }
      ).buildElement()
      .addHeader(1, {'id': 'bm-overlay-title', 'textContent': t('brand.name')})
        .addSmall({'textContent': ` v${version}`}).buildElement()
      .buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-userinfo'})
      .addP({'id': 'bm-user-name-row', 'textContent': t('user.username')})
        .addB({'id': 'bm-user-name'}).buildElement()
      .buildElement()
      .addP({'id': 'bm-user-charges'}, (_, element) => {
        element.setAttribute('aria-live', 'polite');
      })
        .addText(t('user.fullChargesIn'))
        .addSpan({'className': 'bm-charge-countdown', 'textContent': '--:--'}, (_, element) => {
          element.dataset.role = 'countdown';
        }).buildElement()
        .addText(' ')
        .addSpan({'className': 'bm-charge-count', 'textContent': '(0 / 0)'}, (_, element) => {
          element.dataset.role = 'charge-count';
        }).buildElement()
      .buildElement()
      .addP({'id': 'bm-user-suspend', 'style': 'display: none;'}, (_, element) => {
        element.setAttribute('aria-live', 'polite');
      })
        .addText(t('user.suspensionExpiresIn'))
        .addSpan({'className': 'bm-suspend-countdown', 'textContent': '--:--'}, (_, element) => {
          element.dataset.role = 'suspend-countdown';
        }).buildElement()
      .buildElement()
      .addP({'id': 'bm-user-suspend-reason', 'textContent': t('user.reason'), 'style': 'display: none;'})
        .addB({'id': 'bm-suspend-reason', 'textContent': 'Unknown'}).buildElement()
      .buildElement()
        .addP({'id': 'bm-user-droplets-row', 'textContent': t('user.droplets')}, (_, element) => {
          if (templateManager.isDropletsHidden()) {
            element.style.display = 'none';
          }
        })
          .addB({'id': 'bm-user-droplets'}).buildElement()
        .buildElement()
        .addP({'id': 'bm-user-nextlevel-row'}, (_, element) => {
          if (templateManager.isNextLevelHidden()) {
            element.style.display = 'none';
          }
        })
          .addB({'id': 'bm-user-nextpixel', 'textContent': '--'}).buildElement()
          .addText(t('user.morePixel'))
        .addSpan({'id': 'bm-user-nextpixel-plural', 'textContent': t('user.morePixelPlural')}).buildElement()
        .addText(t('user.toLevel'))
        .addB({'id': 'bm-user-nextlevel', 'textContent': '--'}).buildElement()
      .buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-automation'})
      // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
      // .addBr().buildElement()
      // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
      // .addBr().buildElement()
      .addDiv({'id': 'bm-contain-coords'})
        .addButton({'id': 'bm-button-coords', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>'},
          (instance, button) => {
            button.onclick = () => {
              const coords = instance.apiManager?.coordsTilePixel; // Retrieves the coords from the API manager
              const emptyIfUndefined = value => value ?? "";
              if (coords?.[0] === undefined) {
                instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
                return;
              }
              instance.updateInnerHTML('bm-input-tx', emptyIfUndefined(coords?.[0]));
              instance.updateInnerHTML('bm-input-ty', emptyIfUndefined(coords?.[1]));
              instance.updateInnerHTML('bm-input-px', emptyIfUndefined(coords?.[2]));
              instance.updateInnerHTML('bm-input-py', emptyIfUndefined(coords?.[3]));
              apiManager.updateDownloadButton();
              persistCoords();
            }
          }
        ).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': t('coords.placeholder.tx'), 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.tx ?? '')}, (instance, input) => {
          //if a paste happens on tx, split and format it into other coordinates if possible
          input.addEventListener("paste", (event) => {
            const clipboardText = (event.clipboardData || window.clipboardData).getData("text");

            const matchResult = [
              /^\s*([012]?\d{1,3}),\s*([012]?\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\s*$/, // comma-separated
              /^\s*([012]?\d{1,3})\s+([012]?\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/, // space-separated
              /^\s*\(?Tl X: ([012]?\d{1,3}), Tl Y: ([012]?\d{1,3}), Px X: (\d{1,3}), Px Y: (\d{1,3})\)?\s*$/, // display format
            ].map(r => r.exec(clipboardText)).filter(r => r).pop(); //find the regex that matches the clipboard text

            if (matchResult === undefined) { // If we don't have 4 clean coordinates, end the function.
              return;
            }
            // let splitText = clipboardText.split(" ").filter(n => n).map(Number).filter(n => !isNaN(n)); //split and filter all Non Numbers

            // if (splitText.length !== 4 ) { // If we don't have 4 clean coordinates, end the function.
            //   return;
            // }

            let splitText = matchResult.slice(1).map(Number);

            let coords = selectAllCoordinateInputs(document); 

            for (let i = 0; i < coords.length; i++) { 
              coords[i].value = splitText[i]; //add the split vales
            }

            apiManager.updateDownloadButton();
            persistCoords();

            event.preventDefault(); //prevent the pasting of the original paste that would overide the split value
          })
          const handler = () => (apiManager.updateDownloadButton(), persistCoords());
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': t('coords.placeholder.ty'), 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.ty ?? '')}, (instance, input) => {
          const handler = () => (apiManager.updateDownloadButton(), persistCoords());
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': t('coords.placeholder.px'), 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.px ?? '')}, (instance, input) => {
          const handler = () => (apiManager.updateDownloadButton(), persistCoords());
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': t('coords.placeholder.py'), 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.py ?? '')}, (instance, input) => {
          const handler = () => (apiManager.updateDownloadButton(), persistCoords());
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '✈️', 'title': t('coords.teleportTitle')},
          (instance, button) => {
            button.onclick = () => {
              teleportCoords();
            }
          }
        ).buildElement()
        .addDiv({'id': 'bm-distance-output', 'textContent': ''}).buildElement()
      .buildElement();

    buildUserSettingsSection({
      overlay: overlayMain,
      templateManager,
      apiManager,
      layoutLanguageOptions,
      layoutThemeOptions,
      templateDisplayOptions,
      normalizeLayoutLanguage,
      normalizeLayoutTheme,
      normalizeTemplateDisplay,
      getLayoutThemeLabel,
      getTemplateDisplayLabel,
      applyLayoutLanguage: (value) => applyLayoutLanguage(value),
      applyLayoutTheme,
      forceUpdateTheme: () => forceUpdateTheme(),
      buildColorFilterList: () => buildColorFilterList(),
      buildTemplateFilterList: () => buildTemplateFilterList(),
      buildEventList: () => buildEventList(),
      forceRefreshTiles,
      removeLayer,
      setMapCommentsEnabled: (enabled) => setMapCommentsEnabled(enabled),
      applyArchiveBackground: (enabled) => applyArchiveBackground(enabled),
      applySafeMode: () => applySafeModeState(),
      themeList,
      outputStatusId: overlayMain.outputStatusId,
      t,
    });

    overlayMain
      .addDetails({'id': 'bm-contain-colorfilter', 'textContent': t('section.colors'), 'style': 'border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;'}, (instance, summary, details) => {
        details.open = true;
      })
        // Color sorting
        .addP({
          'id': 'bm-color-sort-label',
          'textContent': t('colors.sortBy'),
          'style': 'font-size: small; margin-top: 3px; margin-left: 5px; display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; white-space: nowrap;'
        })
          // Sorting UI
          .addSelect({'id': 'bm-color-sort', 'style': 'flex: 1 1 auto; min-width: 0; width: auto;'}, (instance, select) => {
            const order = [
              "Asc", "Desc"
            ]
            const currentSortBy = templateManager.getSortBy();
            Object.keys(sortByOptions).forEach(o => {
              order.forEach(o2 => {
                const option = document.createElement('option');
                option.value = `${o.toLowerCase()}-${o2.toLowerCase()}`;
                option.textContent = `${o[0].toUpperCase() + o.slice(1).toLowerCase()} (${o2}.)`;
                if (option.value === currentSortBy) { option.selected = true; }
                select.appendChild(option);
              })
            });
            select.addEventListener('change', () => {
              templateManager.setSortBy(select.value);
              buildColorFilterList();
              const parts = select.value.split('-');
              instance.handleDisplayStatus(`Changed the sort criteria to "${parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase()}" in ${parts[1]}ending order.`);
            })
          }).buildElement()
        .buildElement()
        // Color buttons
        .addDiv({'id': 'bm-button-colors-container', 'style': 'display: flex; gap: 6px; margin-top: 3px; margin-bottom: 3px;'})
          .addButton({'id': 'bm-button-colors-enable-all', 'textContent': t('colors.enableAll')}, (instance, button) => {
            button.onclick = () => {
              templateManager.templatesArray.forEach(t => {
                if (!t?.colorPalette) { return; }
                Object.values(t.colorPalette).forEach(v => v.enabled = true);
              })
              syncToggleList();
              removeLayer("overlay");
              templateManager.createOverlayOnMapVisibleFirst();
              buildColorFilterList();
              instance.handleDisplayStatus('Enabled all colors');
              if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
                forceRefreshTiles();
              };
            };
          }).buildElement()
          .addButton({'id': 'bm-button-colors-disable-all', 'textContent': t('colors.disableAll')}, (instance, button) => {
            button.onclick = () => {
              templateManager.templatesArray.forEach(t => {
                if (!t?.colorPalette) { return; }
                Object.values(t.colorPalette).forEach(v => v.enabled = false);
              })
              syncToggleList();
              removeLayer("overlay");
              templateManager.createOverlayOnMapVisibleFirst();
              buildColorFilterList();
              instance.handleDisplayStatus('Disabled all colors');
              if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
                forceRefreshTiles();
              };
            };
          }).buildElement()
          .addButton({'id': 'bm-button-colors-disable-paid', 'textContent': t('colors.disablePaid')}, (instance, button) => {
            button.onclick = () => {
              templateManager.templatesArray.forEach(t => {
                if (!t?.colorPalette) { return; }
                Object.entries(t.colorPalette).forEach(([rgb, value]) => {
                  const meta = rgbToMeta.get(rgb);
                  const colorId = Number(meta?.id);
                  if (Number.isFinite(colorId) && colorId >= 32) {
                    value.enabled = false;
                  }
                });
              });
              syncToggleList();
              templateManager.createOverlayOnMapVisibleFirst();
              buildColorFilterList();
              instance.handleDisplayStatus('Disabled paid colors');
              if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
                forceRefreshTiles();
              };
            };
          }).buildElement()
        .buildElement()
        .addDiv({'id': 'bm-colorfilter-list', 'style': 'max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;'}).buildElement()
      .buildElement()
      // Template filter UI
      .addDetails({'id': 'bm-contain-templatefilter', 'textContent': t('section.templates'), 'style': 'border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;'}, (instance, summary, details) => {
        details.open = true;
      })
        // Template buttons
        .addDiv({'id': 'bm-contain-buttons-template', 'style': 'margin-bottom: 3px;'})
          .addInput({'type': 'file', 'id': 'bm-input-file-template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif', 'style': 'display: none;'}).buildElement()
          .addSelect({'id': 'bm-template-create-mode', 'style': 'margin: 0 0.5ch; min-width: 15ch;'}, (instance, select) => {
            const getTemplateFileInput = () => document.querySelector('#bm-input-file-template');
            let createFlowBusy = false;
            const runTemplateCreationFlow = async ({ mode, imageFile = null } = {}) => {
              const createMode = normalizeTemplateCreateMode(mode);
              if (createMode === TEMPLATE_CREATE_MODE_TIME_ARCHIVE) {
                startArchiveTemplatePointCapture(instance);
                return;
              }
              if (createFlowBusy) {
                instance.handleDisplayStatus('Template creation is already in progress.');
                return;
              }
              createFlowBusy = true;
              try {
                if (createMode === TEMPLATE_CREATE_MODE_REMOTE_NAME) {
                  const remoteTemplateConfig = await openRemoteTemplateBuilder({
                    configuredStreams: templateManager.getTemplateSyncStreams?.() ?? [DEFAULT_REMOTE_TEMPLATE_STREAM],
                    fetchSuggestedNames: () => templateSync.fetchRemoteTemplateNames(),
                  });
                  if (!remoteTemplateConfig?.templateName) {
                    return;
                  }
                  const trimmedRemoteTemplateName = String(remoteTemplateConfig.templateName ?? '').trim();
                  const createdTemplate = await templateSync.importTemplateByName({
                    templateName: trimmedRemoteTemplateName,
                    onStatus: (message) => instance.handleDisplayStatus(message),
                    onError: (message) => instance.handleDisplayError(message),
                    syncToggleList: () => window.syncToggleList?.(),
                    buildTemplateFilterList: () => window.buildTemplateFilterList?.(),
                    buildColorFilterList: () => window.buildColorFilterList?.(),
                    defaultEnabled: true,
                  });
                  if (createdTemplate) {
                    instance.handleDisplayStatus(`Template "${trimmedRemoteTemplateName}" imported as a local template.`);
                  }
                  return;
                }
                const coordTlX = document.querySelector('#bm-input-tx');
                if (!coordTlX.checkValidity()) {coordTlX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
                const coordTlY = document.querySelector('#bm-input-ty');
                if (!coordTlY.checkValidity()) {coordTlY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
                const coordPxX = document.querySelector('#bm-input-px');
                if (!coordPxX.checkValidity()) {coordPxX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
                const coordPxY = document.querySelector('#bm-input-py');
                if (!coordPxY.checkValidity()) {coordPxY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}

                let sourceFile = createMode === TEMPLATE_CREATE_MODE_IMAGE ? imageFile : null;
                const sourceIsUploadedImage = createMode === TEMPLATE_CREATE_MODE_IMAGE && Boolean(sourceFile);
                const originalUploadedFile = sourceIsUploadedImage ? sourceFile : null;
                let preConversionPromptShown = false;
                let createWithPaletteConversion = false;
                let paletteConversionOptions = null;
                let templateName = sourceFile?.name?.replace(/\.[^/.]+$/, '') || '';
                let flagCreateMeta = null;

                if (createMode === TEMPLATE_CREATE_MODE_IMAGE && !sourceFile) {
                  instance.handleDisplayError('Image file was not selected.');
                  return;
                }

                if (!sourceFile) {
                  if (createMode === TEMPLATE_CREATE_MODE_TEXT) {
                    const textTemplate = await openTextTemplateBuilder({
                      initialColorKey: getCurrentTemplateTextColorKey(),
                      initialFontSize: TEMPLATE_TEXT_FONT_SIZE,
                      previewTileX: Number(coordTlX.value),
                      previewTileY: Number(coordTlY.value),
                      previewPixelX: Number(coordPxX.value),
                      previewPixelY: Number(coordPxY.value),
                    });
                    if (!textTemplate) {
                      return;
                    }
                    sourceFile = textTemplate.blob;
                    templateName = buildTextTemplateName(textTemplate.text);
                    if (Number.isFinite(Number(textTemplate.previewPixelX))) {
                      coordPxX.value = String(normalizePreviewTilePixel(textTemplate.previewPixelX));
                    }
                    if (Number.isFinite(Number(textTemplate.previewPixelY))) {
                      coordPxY.value = String(normalizePreviewTilePixel(textTemplate.previewPixelY));
                    }
                    apiManager.updateDownloadButton();
                    persistCoords();
                  } else if (createMode === TEMPLATE_CREATE_MODE_RUSSIAN_FLAG) {
                    const flagTemplate = await openRussianFlagTemplateBuilder({
                      initialStyleKey: templateFlagStyleTricolor.key,
                      initialStripeOrientation: TEMPLATE_FLAG_ORIENTATION_HORIZONTAL,
                      initialWidth: TEMPLATE_FLAG_DEFAULT_W,
                      initialHeight: TEMPLATE_FLAG_DEFAULT_H,
                      initialIgnoreArts: false,
                      initialProtectedColorKeys: TEMPLATE_RUSSIAN_FLAG_DEFAULT_PROTECTED_KEYS,
                      startCoords: {
                        tx: Number(coordTlX.value),
                        ty: Number(coordTlY.value),
                        px: Number(coordPxX.value),
                        py: Number(coordPxY.value),
                      },
                    });
                    if (!flagTemplate?.file) {
                      return;
                    }
                    sourceFile = flagTemplate.file;
                    flagCreateMeta = {
                      ignoreArts: Boolean(flagTemplate.ignoreArts),
                      ignoredPixelCount: Math.max(0, Number(flagTemplate.ignoredPixelCount) || 0),
                    };
                    if (Array.isArray(flagTemplate.createCoords) && flagTemplate.createCoords.length >= 4) {
                      coordTlX.value = String(Number(flagTemplate.createCoords[0]) || 0);
                      coordTlY.value = String(Number(flagTemplate.createCoords[1]) || 0);
                      coordPxX.value = String(normalizePreviewTilePixel(flagTemplate.createCoords[2]));
                      coordPxY.value = String(normalizePreviewTilePixel(flagTemplate.createCoords[3]));
                      apiManager.updateDownloadButton();
                      persistCoords();
                    }
                    templateName = String(flagTemplate.templateName || '').trim() || buildRussianFlagTemplateName({
                      styleKey: flagTemplate.styleKey,
                      width: flagTemplate.width,
                      height: flagTemplate.height,
                      stripeOrientation: flagTemplate.stripeOrientation,
                    });
                  } else {
                    instance.handleDisplayError('Unsupported template mode.');
                    return;
                  }
                }

                if (sourceIsUploadedImage && sourceFile) {
                  try {
                    const otherScan = await detectTemplateImageOtherColors(sourceFile);
                    if (otherScan.skipped) {
                      const pixelCountText = new Intl.NumberFormat().format(otherScan.pixelCount || 0);
                      instance.handleDisplayStatus(
                        `Skipped pre-scan for large image (${pixelCountText} px > ${new Intl.NumberFormat().format(TEMPLATE_PRE_SCAN_MAX_PIXELS)} px).`
                      );
                    }
                    if (otherScan.otherPixelCount > 0) {
                      preConversionPromptShown = true;
                      const conversionChoice = await openTemplatePaletteConversionPreview({
                        sourceFile,
                        otherPixelCount: otherScan.otherPixelCount,
                        otherColorCount: otherScan.otherColorCount,
                      });
                      if (conversionChoice?.convert) {
                        createWithPaletteConversion = true;
                        paletteConversionOptions = conversionChoice.options || normalizeTemplatePaletteConversionOptions(templatePaletteConversionDefaults);
                        instance.handleDisplayStatus('Applying palette conversion with selected settings.');
                      } else {
                        instance.handleDisplayStatus('Keeping original image colors. Non-palette pixels will remain as "other".');
                      }
                    }
                  } catch (error) {
                    consoleWarn('Failed to convert non-palette colors during template creation.', error);
                    instance.handleDisplayStatus('Palette conversion failed. Creating template from original image.');
                  }
                }

                const createCoords = [
                  Number(coordTlX.value),
                  Number(coordTlY.value),
                  Number(coordPxX.value),
                  Number(coordPxY.value),
                ];
                const createAnchor = templateManager.getAnchor();
                const createdTemplate = await templateManager.createTemplate(
                  sourceFile,
                  templateName,
                  createCoords,
                  createAnchor,
                  {
                    convertToPalette: createWithPaletteConversion,
                    convertOptions: paletteConversionOptions,
                  }
                );

                if (sourceIsUploadedImage && !createWithPaletteConversion && !preConversionPromptShown) {
                  const createdOtherPixels = Number(createdTemplate?.colorPalette?.other?.count) || 0;
                  if (createdOtherPixels > 0) {
                    const conversionChoice = await openTemplatePaletteConversionPreview({
                      sourceFile: originalUploadedFile || sourceFile,
                      otherPixelCount: createdOtherPixels,
                      otherColorCount: 1,
                      postCreation: true,
                      initialOptions: paletteConversionOptions || templatePaletteConversionDefaults,
                    });
                    if (conversionChoice?.convert) {
                      try {
                        instance.handleDisplayStatus('Recreating template with nearest palette conversion...');
                        await templateManager.deleteTemplate(createdTemplate?.storageKey);
                        await templateManager.createTemplate(
                          originalUploadedFile || sourceFile,
                          templateName,
                          createCoords,
                          createAnchor,
                          {
                            convertToPalette: true,
                            convertOptions: conversionChoice.options || normalizeTemplatePaletteConversionOptions(templatePaletteConversionDefaults),
                          }
                        );
                        instance.handleDisplayStatus('Converted non-palette colors and recreated the template.');
                        return;
                      } catch (error) {
                        consoleWarn('Failed to convert and recreate template after creation.', error);
                        instance.handleDisplayStatus('Could not convert and recreate template. Kept current template.');
                      }
                    }
                  }
                }
                if (createMode === TEMPLATE_CREATE_MODE_RUSSIAN_FLAG && flagCreateMeta?.ignoreArts) {
                  instance.handleDisplayStatus(
                    `Template created with Ignore Arts mask (${flagCreateMeta.ignoredPixelCount.toLocaleString()} pixel(s) transparent). Rendering visible crosses...`
                  );
                } else {
                  instance.handleDisplayStatus('Template created. Rendering visible crosses...');
                }
              } finally {
                createFlowBusy = false;
                const input = getTemplateFileInput();
                if (input) input.value = '';
              }
            };

            [
              ['', 'Create template...'],
              [TEMPLATE_CREATE_MODE_IMAGE, 'Image template'],
              [TEMPLATE_CREATE_MODE_REMOTE_NAME, 'Remote template by name'],
              [TEMPLATE_CREATE_MODE_TEXT, 'Text template'],
              [TEMPLATE_CREATE_MODE_RUSSIAN_FLAG, 'Russian flag template'],
              [TEMPLATE_CREATE_MODE_TIME_ARCHIVE, 'Time-archive template'],
            ].forEach(([value, label]) => {
              const option = document.createElement('option');
              option.value = value;
              option.textContent = label;
              select.appendChild(option);
            });
            select.value = '';
            select.addEventListener('change', async () => {
              if (!select.value) {
                return;
              }
              const nextMode = normalizeTemplateCreateMode(select.value);
              if (nextMode !== TEMPLATE_CREATE_MODE_TIME_ARCHIVE && isArchiveTemplatePointCaptureActive()) {
                cancelArchiveTemplatePointCapture('Time-archive point capture cancelled.');
              }
              select.value = '';
              if (nextMode === TEMPLATE_CREATE_MODE_IMAGE) {
                const input = getTemplateFileInput();
                if (!input) {
                  instance.handleDisplayError('Template image picker is unavailable.');
                  return;
                }
                input.value = '';
                input.onchange = async () => {
                  const selectedFile = input?.files?.[0] ?? null;
                  input.onchange = null;
                  if (!selectedFile) return;
                  await runTemplateCreationFlow({
                    mode: TEMPLATE_CREATE_MODE_IMAGE,
                    imageFile: selectedFile,
                  });
                };
                input.click();
                return;
              }
              await runTemplateCreationFlow({ mode: nextMode });
            });
          }).buildElement()
          .addButton({'id': 'bm-button-sync-templates', 'textContent': '🔄', 'title': t('templates.syncTitle')}, (instance, button) => {
            button.style.position = 'relative';
            button.style.overflow = 'visible';
            const badge = document.createElement('span');
            badge.id = 'bm-sync-templates-badge';
            badge.className = 'bm-sync-badge';
            badge.style.display = 'none';
            button.appendChild(badge);
            button.onclick = async () => {
              try {
                await templateSync.syncTemplatesFromServer({
                  onStatus: (message) => instance.handleDisplayStatus(message),
                  onError: (message) => instance.handleDisplayError(message),
                  syncToggleList: () => window.syncToggleList?.(),
                  buildTemplateFilterList: () => window.buildTemplateFilterList?.(),
                  buildColorFilterList: () => window.buildColorFilterList?.(),
                });
              } catch (err) {
                // Error already reported in the sync helper.
              }
              };
            }).buildElement()
            .addSelect({'id': 'bm-template-anchor'}, (instance, select) => {
            const anchors = {
              "lt": "⟔",
              "mt": "⨪",
              "rt": "ᒬ",
              "lm": "꜏",
              "mm": "⊡",
              "rm": "꜊",
              "lb": "Ŀ",
              "mb": "∸",
              "rb": "⟓",
            };
            const anchorTextX = {
              "l": "Left",
              "m": "Center",
              "r": "Right",
            };
            const anchorTextY = {
              "t": "Top",
              "m": "Middle",
              "b": "Bottom",
            };
            const currentAnchor = templateManager.getAnchor();
            Object.entries(anchors).forEach(([anchor, displayText]) => {
              const option = document.createElement('option');
              option.value = anchor;
              option.textContent = displayText;
              if (anchor === currentAnchor) { option.selected = true; }
              select.appendChild(option);
            });
            select.addEventListener('change', () => {
              templateManager.setAnchor(select.value);
              instance.handleDisplayStatus(`Changed the default template anchor to "${anchorTextY[select.value[1]]} ${anchorTextX[select.value[0]]}".`);
            })
          }).buildElement()
        .buildElement()
        .addDiv({'id': 'bm-templatefilter-list', 'style': 'max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;'}).buildElement()
        .buildElement()
        // Chat UI
      .addDetails({'id': 'bm-contain-chat', 'textContent': t('section.chat'), 'style': 'border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;'}, (instance, summary, details) => {
          details.open = false;
        })
          .addDiv({'id': 'bm-chat-mod-tools', 'style': 'display: none; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 4px;'})
            .addSelect({'id': 'bm-chat-ban-type', 'style': 'width: 8ch;'}, (instance, select) => {
              const optIp = document.createElement('option');
              optIp.value = 'ip';
              optIp.textContent = 'IP';
              const optDevice = document.createElement('option');
              optDevice.value = 'device';
              optDevice.textContent = 'Device';
              select.appendChild(optIp);
              select.appendChild(optDevice);
            }).buildElement()
            .addInput({'type': 'text', 'id': 'bm-chat-ban-target', 'placeholder': 'Message ID', 'inputMode': 'numeric', 'maxLength': 20, 'style': 'width: 15ch;'}).buildElement()
            .addInput({'type': 'text', 'id': 'bm-chat-ban-reason', 'placeholder': 'Reason', 'maxLength': 120, 'style': 'flex: 1; min-width: 16ch;'}).buildElement()
            .addButton({'id': 'bm-chat-ban-btn', 'textContent': 'Ban', 'style': 'font-size: 11px; padding: 0 6px;'}).buildElement()
            .addButton({'id': 'bm-chat-bans-btn', 'textContent': 'Bans', 'style': 'font-size: 11px; padding: 0 6px;'}).buildElement()
          .buildElement()
          .addDiv({'id': 'bm-chat-messages', 'style': 'max-height: 120px; overflow-y: auto; border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-bottom: 4px;'}).buildElement()
          .addDiv({'id': 'bm-chat-reply', 'style': 'display: none; border-left: 3px solid var(--bm-chat-reply-border); padding: 4px 6px; margin-bottom: 4px; border-radius: 4px; background: var(--bm-chat-reply-bg);'})
            .addSpan({'id': 'bm-chat-reply-label', 'textContent': 'Replying to'}).buildElement()
            .addSpan({'id': 'bm-chat-reply-text', 'style': 'display: block; font-size: 11px; color: var(--bm-muted);'}).buildElement()
            .addButton({'id': 'bm-chat-reply-clear', 'textContent': '✖', 'style': 'float: right; font-size: 10px; padding: 0 4px;'}).buildElement()
          .buildElement()
          .addDiv({'id': 'bm-chat-input-row', 'style': 'display: flex; gap: 4px; align-items: center;'})
            .addInput({'type': 'text', 'id': 'bm-chat-user', 'placeholder': 'User', 'maxLength': CHAT_MAX_USER_LEN, 'style': 'width: 15ch;'}).buildElement()
            .addInput({'type': 'text', 'id': 'bm-chat-text', 'placeholder': 'Message', 'maxLength': CHAT_MAX_TEXT_LEN, 'style': 'flex: 1;'}).buildElement()
          .buildElement()
          .addDiv({'id': 'bm-chat-modcode-row', 'style': 'display: none; margin-top: 4px;'})
            .addInput({'type': 'password', 'id': 'bm-chat-modcode', 'placeholder': 'Code', 'maxLength': 64, 'style': 'width: 100%;'}).buildElement()
          .buildElement()
        .buildElement()
      // Event UI
      .addDetails({'id': 'bm-contain-eventitem', 'textContent': t('section.event'), 'style': 'border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; display: none; margin-top: 4px;'}, (instance, summary, details) => {
        if (templateManager.isEventEnabled()) {
          details.style.display = '';
        }
        details.open = true;
      })
        .addButton({'id': 'bm-button-set-eventprovider', 'textContent': t('event.setProvider'), 'style': 'margin: 0 1ch;'}, (instance, button) => {
          button.onclick = () => {
            const currentProvider = templateManager.getEventProvider();
            const providerURL = prompt('Enter the event data provider JSON URL:', currentProvider === "" ? "https://wplace.samuelscheit.com/tiles/pumpkin.json" : currentProvider);
            if (!providerURL) { return; }
            const isUrl = (content => {
              try { return Boolean(new URL(content)); }
              catch(e){ return false; }
            })(providerURL);
            if (!isUrl) {
              alert("The URL you entered is not valid!");
              return;
            }
            templateManager.setEventProvider(providerURL);
            buildEventList();
          };
        }).buildElement()
        .addButton({'id': 'bm-button-refresh-event', 'textContent': t('event.refresh'), 'style': 'margin: 0 1ch;'}, (instance, button) => {
          button.onclick = () => buildEventList();
        }).buildElement()
        .addDiv({'id': 'bm-eventitem-list', 'style': 'max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;'}).buildElement()
      .buildElement()
      // Status
      .addTextarea({'id': overlayMain.outputStatusId, 'placeholder': t('status.placeholder', { version }), 'readOnly': true}, (instance, textarea) => {
        if (templateManager.isStatusHidden()) {
          textarea.style.display = 'none';
        }
      }).buildElement()
      .addDiv({'id': 'bm-contain-buttons-action'})
        .addDiv()
          // .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'textContent': '✈'}).buildElement()
          // .addButton({'id': 'bm-button-favorite', 'className': 'bm-help', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon points="10,2 12,7.5 18,7.5 13.5,11.5 15.5,18 10,14 4.5,18 6.5,11.5 2,7.5 8,7.5" fill="white"></polygon></svg>'}).buildElement()
          // .addButton({'id': 'bm-button-templates', 'className': 'bm-help', 'innerHTML': '🖌'}).buildElement()
          .addButton({'id': 'bm-button-convert', 'className': 'bm-help', 'innerHTML': '<span class="bm-action-icon" aria-hidden="true">🎨</span>', 'title': t('action.colorConverter')}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
          .addButton({'id': 'bm-button-distance', 'className': 'bm-help', 'innerHTML': '<span class="bm-action-icon" aria-hidden="true">📏</span>', 'title': t('distance.button.off')},
            (instance, button) => {
            button.onclick = () => {
              setDistanceToolActive(!distanceMeasureState.active, instance);
            };
            button.addEventListener('contextmenu', (event) => {
              event.preventDefault();
              if (distanceMeasureState.active) {
                setDistanceToolActive(false, instance);
              }
            });
            syncDistanceToolUi();
          }).buildElement()
          .addButton({'id': 'bm-button-website', 'className': 'bm-help', 'innerHTML': '<span class="bm-action-icon" aria-hidden="true">🌐</span>', 'title': t('action.website')}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://t.me/ruswplace', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
        .buildElement()
        .addDiv({'id': 'bm-footer'})
          .addSmall({'id': 'bm-footer-text', 'textContent': t('footer.forkedBy'), 'title': t('footer.title'), 'style': 'margin-top: auto;'}).buildElement()
        .buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay(document.body);
  initProfiler();
  syncDistanceToolUi();

  applyLayoutTheme(templateManager.getLayoutTheme());
  applyLayoutLanguage(currentLayoutLanguage);

  // ------- Helper: Build the color filter list -------
  const syncToggleList = () => {
    try {
      (templateManager.templatesArray ?? []).forEach(t => {
        const key = t.storageKey;
        if (key && templateManager.templatesJSON?.templates?.[key]) {
          const templateJSON = templateManager.templatesJSON.templates[key]
          templateJSON.enabled = t.enabled;
          templateJSON.palette = t.colorPalette;
        }
      })
      // persist immediately
      templateManager.storeTemplates();
    } catch (_) {};
  };
  window.syncToggleList = syncToggleList;
  let templatePositionEditStorageKey = null;
  const getOverlayCoordinateInputs = () => ({
    tx: document.querySelector('#bm-input-tx'),
    ty: document.querySelector('#bm-input-ty'),
    px: document.querySelector('#bm-input-px'),
    py: document.querySelector('#bm-input-py'),
  });
  const getOverlayCoordsFromInputsNormalized = () => {
    const { tx, ty, px, py } = getOverlayCoordinateInputs();
    if (!tx || !ty || !px || !py) return null;
    return normalizeTilePixelCoords([tx.value, ty.value, px.value, py.value]);
  };
  const setOverlayCoordsInputs = (coords) => {
    const normalized = normalizeTilePixelCoords(coords);
    if (!normalized) return false;
    const { tx, ty, px, py } = getOverlayCoordinateInputs();
    if (!tx || !ty || !px || !py) return false;
    tx.value = String(normalized[0]);
    ty.value = String(normalized[1]);
    px.value = String(normalized[2]);
    py.value = String(normalized[3]);
    apiManager.updateDownloadButton();
    persistCoords();
    return true;
  };
  const moveTemplateToCoords = async (template, targetCoords, options = {}) => {
    const refreshLists = options?.refreshLists !== false;
    const overlayMode = options?.overlayMode === 'single' ? 'single' : 'visible-first';
    if (isTemplateRemote(template)) {
      return { ok: false, moved: false, message: 'Remote templates cannot be repositioned.' };
    }
    const currentCoords = normalizeTilePixelCoords(template?.coords);
    const nextCoords = normalizeTilePixelCoords(targetCoords);
    if (!currentCoords || !nextCoords) {
      return { ok: false, moved: false, message: 'Template coordinates are malformed.' };
    }
    const currentWorldX = currentCoords[0] * TEMPLATE_TILE_SIZE + currentCoords[2];
    const nextWorldX = nextCoords[0] * TEMPLATE_TILE_SIZE + nextCoords[2];
    const currentWorldY = currentCoords[1] * TEMPLATE_TILE_SIZE + currentCoords[3];
    const nextWorldY = nextCoords[1] * TEMPLATE_TILE_SIZE + nextCoords[3];
    const deltaX = computeWrappedWorldDeltaX(currentWorldX, nextWorldX);
    const deltaY = nextWorldY - currentWorldY;
    if (deltaX === 0 && deltaY === 0) {
      return { ok: true, moved: false, message: 'Template is already at that position.' };
    }

    const shiftedChunked = rekeyTemplateChunkMap(template.chunked, deltaX, deltaY);
    const shiftedChunkedBuffer = rekeyTemplateChunkMap(template.chunkedBuffer, deltaX, deltaY);
    const shiftedChunkedSamples = rekeyTemplateChunkMap(template.chunkedSamples, deltaX, deltaY);
    const shiftedChunkedSamplesBuffer = rekeyTemplateChunkMap(template.chunkedSamplesBuffer, deltaX, deltaY);
    const shiftedKeys = [...new Set([
      ...Object.keys(shiftedChunked),
      ...Object.keys(shiftedChunkedBuffer),
      ...Object.keys(shiftedChunkedSamples),
      ...Object.keys(shiftedChunkedSamplesBuffer),
    ])];
    const nextTilePrefixes = new Set(
      shiftedKeys.map((key) => key.split(',').slice(0, 2).join(','))
    );
    if (!nextTilePrefixes.size) {
      return { ok: false, moved: false, message: 'Unable to move template: no chunks were shifted.' };
    }

    templateManager.clearTileProgress(template);
    removeLayer(null, template.sortID);

    template.chunked = shiftedChunked;
    template.chunkedBuffer = shiftedChunkedBuffer;
    template.chunkedSamples = shiftedChunkedSamples;
    template.chunkedSamplesBuffer = shiftedChunkedSamplesBuffer;
    template.tilePrefixes = nextTilePrefixes;
    template.coords = nextCoords;
    template.storageTimeString = Date.now().toString();
    template._tileKeysByPrefix = null;
    template._tileKeysByPrefixVersion = null;

    const templateJSON = templateManager.templatesJSON?.templates?.[template.storageKey];
    if (templateJSON) {
      templateJSON.coords = nextCoords.join(', ');
      templateJSON.tiles = rekeyTemplateChunkMap(templateJSON.tiles, deltaX, deltaY);
      templateJSON.samples = rekeyTemplateChunkMap(templateJSON.samples, deltaX, deltaY);
      templateJSON.tileKeys = shiftedKeys;
    }

    await templateManager.storeTemplates();
    if (overlayMode === 'single') {
      await templateManager.createOverlayOnMap(template.sortID, { immediate: true });
    } else {
      await templateManager.createOverlayOnMapVisibleFirst(template.sortID);
    }
    if (refreshLists) {
      buildColorFilterList();
      buildTemplateFilterList();
    }
    return { ok: true, moved: true, message: 'Template position updated.' };
  };
  let templatePositionJoystickWindow = null;
  let templatePositionJoystickPendingDeltaX = 0;
  let templatePositionJoystickPendingDeltaY = 0;
  let templatePositionJoystickIsProcessing = false;
  let templatePositionJoystickTrailingTimer = null;
  const TEMPLATE_POSITION_JOYSTICK_TRAILING_MS = 90;
  function isTemplateRemote(template) {
    if (!template) return false;
    const templateStore = templateManager.templatesJSON?.templates?.[template.storageKey] ?? {};
    return template.isRemote === true || templateStore.remote === true;
  }
  function getTemplateRemoteStream(template) {
    if (!template) return DEFAULT_REMOTE_TEMPLATE_STREAM;
    const templateStore = templateManager.templatesJSON?.templates?.[template.storageKey] ?? {};
    return normalizeTemplateRemoteStream(template.remoteStream ?? templateStore.remoteStream);
  }
  const clearTemplatePositionJoystickPending = () => {
    templatePositionJoystickPendingDeltaX = 0;
    templatePositionJoystickPendingDeltaY = 0;
    if (templatePositionJoystickTrailingTimer) {
      clearTimeout(templatePositionJoystickTrailingTimer);
      templatePositionJoystickTrailingTimer = null;
    }
  };
  const scheduleTemplatePositionJoystickTrailingMove = () => {
    if (templatePositionJoystickTrailingTimer) {
      clearTimeout(templatePositionJoystickTrailingTimer);
    }
    templatePositionJoystickTrailingTimer = setTimeout(() => {
      templatePositionJoystickTrailingTimer = null;
      void runTemplatePositionJoystickMove();
    }, TEMPLATE_POSITION_JOYSTICK_TRAILING_MS);
  };
  const runTemplatePositionJoystickMove = async () => {
    if (templatePositionJoystickIsProcessing) return;
    if (!templatePositionEditStorageKey) return;
    if (templatePositionJoystickPendingDeltaX === 0 && templatePositionJoystickPendingDeltaY === 0) return;
    templatePositionJoystickIsProcessing = true;
    const aggregateDeltaX = templatePositionJoystickPendingDeltaX;
    const aggregateDeltaY = templatePositionJoystickPendingDeltaY;
    templatePositionJoystickPendingDeltaX = 0;
    templatePositionJoystickPendingDeltaY = 0;
    try {
      const activeTemplate = (templateManager.templatesArray ?? [])
        .find((template) => template.storageKey === templatePositionEditStorageKey);
      if (!activeTemplate) return;
      if (isTemplateRemote(activeTemplate)) {
        templatePositionEditStorageKey = null;
        clearTemplatePositionJoystickPending();
        syncTemplatePositionJoystickWindow();
        buildTemplateFilterList();
        overlayMain.handleDisplayStatus('Remote templates cannot be repositioned.');
        return;
      }
      const current = getOverlayCoordsFromInputsNormalized()
        || normalizeTilePixelCoords(activeTemplate.coords);
      if (!current) {
        overlayMain.handleDisplayError('Coordinates are malformed.');
        return;
      }
      const next = shiftTilePixelCoordsByPixels(current, aggregateDeltaX, aggregateDeltaY);
      if (!next) {
        overlayMain.handleDisplayError('Failed to update position from joystick.');
        return;
      }
      const moveResult = await moveTemplateToCoords(activeTemplate, next, {
        refreshLists: false,
        overlayMode: 'single',
      });
      if (!moveResult.ok) {
        overlayMain.handleDisplayError(moveResult.message || 'Failed to reposition template.');
        return;
      }
      setOverlayCoordsInputs(activeTemplate.coords);
    } finally {
      templatePositionJoystickIsProcessing = false;
      if (
        templatePositionEditStorageKey &&
        (templatePositionJoystickPendingDeltaX !== 0 || templatePositionJoystickPendingDeltaY !== 0)
      ) {
        scheduleTemplatePositionJoystickTrailingMove();
      }
    }
  };
  const positionTemplateJoystickWindow = () => {
    const panel = templatePositionJoystickWindow;
    if (!panel) return;
    if (panel.style.display === 'none') return;
    const overlayRoot = document.getElementById('bm-overlay');
    if (!overlayRoot) return;
    const rect = overlayRoot.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 128;
    const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
    const preferredLeft = Math.round(rect.left - panelWidth - 10);
    const left = Math.min(maxLeft, Math.max(8, preferredLeft));
    const top = Math.min(Math.max(8, Math.round(rect.top)), Math.max(8, window.innerHeight - (panel.offsetHeight || 120) - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  const shiftCoordsFromJoystick = (event, dx, dy) => {
    event.preventDefault();
    const isCtrl = event.ctrlKey;
    const step = isCtrl ? 10 : 1;
    templatePositionJoystickPendingDeltaX += dx * step;
    templatePositionJoystickPendingDeltaY += dy * step;
    if (!templatePositionJoystickIsProcessing && !templatePositionJoystickTrailingTimer) {
      void runTemplatePositionJoystickMove();
      return;
    }
    scheduleTemplatePositionJoystickTrailingMove();
  };
  const ensureTemplatePositionJoystickWindow = () => {
    if (templatePositionJoystickWindow) return templatePositionJoystickWindow;
    const panel = document.createElement('section');
    panel.id = 'bm-template-position-joystick';
    panel.className = 'bm-template-position-joystick';
    applyOverlayVarsToFloatingElement(panel);

    const hint = document.createElement('div');
    hint.className = 'bm-template-position-joystick-hint';
    hint.textContent = 'Ctrl+Click = 10px';
    panel.appendChild(hint);

    const center = document.createElement('div');
    center.className = 'bm-template-position-joystick-center';
    center.textContent = '•';
    panel.appendChild(center);

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'bm-template-position-joystick-btn bm-template-position-joystick-up';
    up.textContent = '▲';
    up.title = 'Move up by 1px (Ctrl+Click = 10px)';
    up.addEventListener('click', (event) => shiftCoordsFromJoystick(event, 0, -1));
    panel.appendChild(up);

    const left = document.createElement('button');
    left.type = 'button';
    left.className = 'bm-template-position-joystick-btn bm-template-position-joystick-left';
    left.textContent = '▲';
    left.title = 'Move left by 1px (Ctrl+Click = 10px)';
    left.addEventListener('click', (event) => shiftCoordsFromJoystick(event, -1, 0));
    panel.appendChild(left);

    const right = document.createElement('button');
    right.type = 'button';
    right.className = 'bm-template-position-joystick-btn bm-template-position-joystick-right';
    right.textContent = '▲';
    right.title = 'Move right by 1px (Ctrl+Click = 10px)';
    right.addEventListener('click', (event) => shiftCoordsFromJoystick(event, 1, 0));
    panel.appendChild(right);

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'bm-template-position-joystick-btn bm-template-position-joystick-down';
    down.textContent = '▲';
    down.title = 'Move down by 1px (Ctrl+Click = 10px)';
    down.addEventListener('click', (event) => shiftCoordsFromJoystick(event, 0, 1));
    panel.appendChild(down);

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.textContent = 'Download Image';
    downloadButton.title = 'Download this template as an image.';
    downloadButton.style.gridColumn = '1 / 4';
    downloadButton.style.border = '1px solid var(--bm-border-strong)';
    downloadButton.style.borderRadius = '6px';
    downloadButton.style.background = 'var(--bm-subtle-bg)';
    downloadButton.style.color = 'var(--bm-fg)';
    downloadButton.style.fontSize = '10px';
    downloadButton.style.lineHeight = '1.2';
    downloadButton.style.padding = '3px 5px';
    downloadButton.style.cursor = 'pointer';
    downloadButton.dataset.role = 'template-download-btn';
    panel.appendChild(downloadButton);

    const archiveTools = document.createElement('div');
    archiveTools.style.gridColumn = '1 / 4';
    archiveTools.style.display = 'none';
    archiveTools.style.flexDirection = 'column';
    archiveTools.style.gap = '3px';
    const archiveButton = document.createElement('button');
    archiveButton.type = 'button';
    archiveButton.textContent = 'Archive Date...';
    archiveButton.title = 'Change date/version for this time-archive template.';
    archiveButton.style.border = '1px solid var(--bm-border-strong)';
    archiveButton.style.borderRadius = '6px';
    archiveButton.style.background = 'var(--bm-subtle-bg)';
    archiveButton.style.color = 'var(--bm-fg)';
    archiveButton.style.fontSize = '10px';
    archiveButton.style.lineHeight = '1.2';
    archiveButton.style.padding = '3px 5px';
    archiveButton.style.cursor = 'pointer';
    archiveButton.dataset.role = 'archive-edit-btn';
    const archiveMeta = document.createElement('div');
    archiveMeta.style.fontSize = '9px';
    archiveMeta.style.color = 'var(--bm-muted)';
    archiveMeta.style.textAlign = 'center';
    archiveMeta.style.whiteSpace = 'nowrap';
    archiveMeta.style.overflow = 'hidden';
    archiveMeta.style.textOverflow = 'ellipsis';
    archiveMeta.dataset.role = 'archive-meta';
    archiveTools.appendChild(archiveButton);
    archiveTools.appendChild(archiveMeta);
    panel.appendChild(archiveTools);

    archiveButton.addEventListener('click', async () => {
      if (!templatePositionEditStorageKey) return;
      const activeTemplate = (templateManager.templatesArray ?? [])
        .find((template) => template.storageKey === templatePositionEditStorageKey);
      if (!activeTemplate) {
        overlayMain.handleDisplayError('No active template selected for archive edit.');
        return;
      }
      const archiveMetaValue = getTemplateTimeArchiveMeta(activeTemplate);
      if (!archiveMetaValue) {
        overlayMain.handleDisplayError('This template is not a time-archive template.');
        return;
      }
      const bounds = resolveTemplateArchiveBounds(activeTemplate);
      if (!bounds) {
        overlayMain.handleDisplayError('Could not resolve template size for archive update.');
        return;
      }
      const result = await openArchiveTemplateBuilder({
        firstPoint: bounds.topLeft,
        secondPoint: bounds.bottomRight,
        overlayInstance: overlayMain,
        targetTemplate: activeTemplate,
      });
      if (result?.updated && result?.storageKey) {
        templatePositionEditStorageKey = String(result.storageKey);
        clearTemplatePositionJoystickPending();
        const nextTemplate = (templateManager.templatesArray ?? [])
          .find((template) => template.storageKey === templatePositionEditStorageKey);
        if (nextTemplate) {
          setOverlayCoordsInputs(nextTemplate.coords);
        }
        syncTemplatePositionJoystickWindow();
        buildTemplateFilterList();
      }
    });
    downloadButton.addEventListener('click', async () => {
      if (!templatePositionEditStorageKey) return;
      const activeTemplate = (templateManager.templatesArray ?? [])
        .find((template) => template.storageKey === templatePositionEditStorageKey);
      if (!activeTemplate) {
        overlayMain.handleDisplayError('No active template selected for download.');
        return;
      }
      try {
        const result = await downloadTemplateImage(activeTemplate);
        overlayMain.handleDisplayStatus(`Downloaded "${activeTemplate.displayName}" as ${result.fileName}.`);
      } catch (error) {
        consoleWarn('Failed to download template image.', error);
        overlayMain.handleDisplayError(`Could not download template: ${error?.message || error}`);
      }
    });

    panel.style.display = 'none';
    document.body.appendChild(panel);
    window.addEventListener('resize', positionTemplateJoystickWindow);
    templatePositionJoystickWindow = panel;
    return panel;
  };
  const syncTemplatePositionJoystickWindow = () => {
    const panel = ensureTemplatePositionJoystickWindow();
    const archiveButton = panel.querySelector('[data-role="archive-edit-btn"]');
    const archiveMetaLabel = panel.querySelector('[data-role="archive-meta"]');
    const archiveTools = archiveButton?.parentElement ?? null;
    let isActive = Boolean(templatePositionEditStorageKey);
    let activeTemplate = null;
    if (isActive) {
      activeTemplate = (templateManager.templatesArray ?? [])
        .find((template) => template.storageKey === templatePositionEditStorageKey);
      if (!activeTemplate || isTemplateRemote(activeTemplate)) {
        templatePositionEditStorageKey = null;
        clearTemplatePositionJoystickPending();
        isActive = false;
        activeTemplate = null;
      }
    }
    panel.style.display = isActive ? 'grid' : 'none';
    panel.classList.toggle('bm-template-position-joystick-active', isActive);
    if (archiveTools && archiveButton && archiveMetaLabel) {
      if (!isActive || !activeTemplate) {
        archiveTools.style.display = 'none';
        archiveMetaLabel.textContent = '';
      } else {
        const archiveMeta = getTemplateTimeArchiveMeta(activeTemplate);
        if (!archiveMeta) {
          archiveTools.style.display = 'none';
          archiveMetaLabel.textContent = '';
        } else {
          archiveTools.style.display = 'flex';
          archiveMetaLabel.textContent = archiveMeta.archiveDate
            ? `${archiveMeta.archiveDate} (${archiveMeta.archiveVersion})`
            : archiveMeta.archiveVersion;
        }
      }
    }
    if (isActive) {
      applyOverlayVarsToFloatingElement(panel);
      positionTemplateJoystickWindow();
    }
  };
  syncTemplatePositionJoystickWindow();

  let progressUiRefreshQueued = false;
  const scheduleProgressUiRefresh = () => {
    if (progressUiRefreshQueued) return;
    progressUiRefreshQueued = true;
    requestAnimationFrame(() => {
      progressUiRefreshQueued = false;
      const progressSnapshot = profiler.measure('getOverallPerColorProgress', () => templateManager.getOverallPerColorProgress());
      profiler.measure('buildColorFilterList', () => buildColorFilterList(progressSnapshot));
      profiler.measure('buildTemplateFilterList', () => buildTemplateFilterList(progressSnapshot));
    });
  };
  window.scheduleProgressUiRefresh = scheduleProgressUiRefresh;

  const buildColorFilterList = (progressSnapshot = null) => {
    const listContainer = document.querySelector('#bm-colorfilter-list');
    const toggleStatus = templateManager.getPaletteToggledStatus();
    const hideCompleted = templateManager.areCompletedColorsHidden();
    const hideLocked = templateManager.areLockedColorsHidden();
    listContainer.innerHTML = '';

    const { paletteSum, combinedProgress } = progressSnapshot ?? templateManager.getOverallPerColorProgress();

    if (!listContainer || !(Object.keys(paletteSum).length)) {
      if (listContainer) { listContainer.innerHTML = `<small>${t('colors.empty.none')}</small>`; }
      return;
    }

    const sortBy = templateManager.getSortBy();
    const sortByParts = sortBy.split('-');
    const keyFunction = sortByOptions[sortByParts[0]];

    const compareFunction = (
      sortByParts[1] === "asc" ?
        (a,b) => keyFunction(a) - keyFunction(b) :
        (a,b) => keyFunction(b) - keyFunction(a)
    );

    const paletteSumSorted = Object.entries(paletteSum)
      .map(([rgb, count]) => [rgb, combinedProgress[rgb]?.paintedAndEnabled ?? 0, count])
      .sort(compareFunction); // sort by frequency desc

    let hasColors = false;
    for (const [rgb, paintedCount, totalCount] of paletteSumSorted) {
      if (hideLocked && rgb === 'other') continue;
      if (hideCompleted && paintedCount === totalCount) continue;
      let row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      let swatch = document.createElement('div');
      swatch.style.width = '14px';
      swatch.style.height = '14px';
      swatch.style.border = '1px solid var(--bm-border-strong)';

      let colorName = '';
      let colorKey = '';
      const tMeta = rgbToMeta.get(rgb);
      // Special handling for "other" and "transparent"
      if (rgb === 'other') {
        swatch.style.background = '#888'; // Neutral color for "Other"
        colorName = t('colors.other');
        colorKey = "other";
      } else if (rgb === '#deface') {
        swatch.style.background = '#deface';
        colorName = t('colors.transparent');
        colorKey = "transparent";
      } else {
        const [r, g, b] = rgb.split(',').map(Number);
        swatch.style.background = `rgb(${r},${g},${b})`;
        try {
          if (tMeta && typeof tMeta.id === 'number') {
            if (hideLocked && !templateManager.isColorUnlocked(tMeta.id)) continue;
            const displayName = tMeta?.name || `rgb(${r},${g},${b})`;
            // const starLeft = tMeta.premium ? '★ ' : '';
            // colorName = `#${tMeta.id} ${starLeft}${displayName}`;
            if (tMeta.premium) {
              swatch.style.borderColor = "gold";
              swatch.style.boxShadow = "0 0 2px yellow";
            }
            colorName = `${displayName}`;
            colorKey = `${r},${g},${b}`;
          }
        } catch (ignored) {}
      }

      let label = document.createElement('span');
      label.style.fontSize = '12px';

      const remainingCount = Math.max(0, totalCount - paintedCount);
      if (sortByParts[0] === "remaining" || (hideCompleted && sortByParts[0] !== "painted")) {
        const remainingLabelText = remainingCount.toLocaleString();
        label.textContent = `${colorName} • ${remainingLabelText} ${t('colors.leftSuffix')}`;
      } else {
        const labelText = totalCount.toLocaleString();
        const paintedLabelText = paintedCount.toLocaleString();
        label.textContent = `${colorName} • ${paintedLabelText} / ${labelText}`;
      }

      if (templateManager.isProgressBarEnabled()) {
        const percentageProgress = paintedCount / (totalCount === 0 ? 1 : totalCount) * 100;
        row.style.background = `linear-gradient(to right, rgb(0, 128, 0, 0.8) 0%, rgb(0, 128, 0, 0.8) ${percentageProgress}%, transparent ${percentageProgress}%, transparent 100%)`;
      }

      const paletteEntry = combinedProgress[colorKey];
      if (remainingCount > 0 && (paletteEntry?.examplesEnabled?.length ?? 0) === 0 && colorKey !== 'other') continue;
      let currentIndex = 0;
      swatch.addEventListener('click', () => {
        // if ((paletteEntry?.examples?.length ?? 0) > 0) {
        if ((paletteEntry?.examplesEnabled?.length ?? 0) > 0) {
          // const examples = paletteEntry.examples;
          const examples = paletteEntry.examplesEnabled;
          // const exampleIndex = Math.floor(Math.random() * examples.length);
          const exampleIndex = currentIndex % examples.length;
          teleportToTileCoords(examples[exampleIndex][0], examples[exampleIndex][1]);
          ++currentIndex;
        }
      });
      // if ((paletteEntry?.examples?.length ?? 0) > 0) {
      if ((paletteEntry?.examplesEnabled?.length ?? 0) > 0) {
        swatch.style["cursor"] = "pointer";
      };

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      if (templateManager.isOnlyCurrentColorShown()) {
        toggle.checked = tMeta?.id === getCurrentColor();
        toggle.disabled = true;
      } else {
        toggle.checked = toggleStatus[rgb] ?? true;
      }
      toggle.addEventListener('change', () => {
        (templateManager.templatesArray ?? []).forEach(template => {
          if (!template?.colorPalette) return;
          if (template.colorPalette[rgb] !== undefined) {
            template.colorPalette[rgb].enabled = toggle.checked;
          }
        })
        overlayMain.handleDisplayStatus(`${toggle.checked ? 'Enabled' : 'Disabled'} ${rgb}`);
        syncToggleList();
        templateManager.createOverlayOnMapVisibleFirst();
        if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
          forceRefreshTiles();
        };
      });

      row.appendChild(toggle);
      row.appendChild(swatch);
      row.appendChild(label);
      listContainer.appendChild(row);
      hasColors = true;
    }
    if (!hasColors && listContainer) {
      if (hideLocked) {
        if (hideCompleted) {
          listContainer.innerHTML = `<small>${t('colors.empty.allOwnedCompleted')}</small>`;
        } else {
          listContainer.innerHTML = `<small>${t('colors.empty.remainingLocked')}</small>`;
        }
      } else { // hideCompleted
        listContainer.innerHTML = `<small>${t('colors.empty.allCompleted')}</small>`;
      }
    }
  };
  window.buildColorFilterList = buildColorFilterList;

  const buildTemplateFilterList = (progressSnapshot = null) => {
    const listContainer = document.querySelector('#bm-templatefilter-list');
    consoleLog(templateManager);
    if (templateManager.templatesArray?.length === 0) {
      templatePositionEditStorageKey = null;
      clearTemplatePositionJoystickPending();
      syncTemplatePositionJoystickWindow();
      if (listContainer) { listContainer.innerHTML = `<small>${t('templates.empty')}</small>`; }
      return;
    }
    const activePositionTemplate = templatePositionEditStorageKey
      ? (templateManager.templatesArray ?? []).find((template) => template.storageKey === templatePositionEditStorageKey)
      : null;
    if (templatePositionEditStorageKey && (!activePositionTemplate || isTemplateRemote(activePositionTemplate))) {
      templatePositionEditStorageKey = null;
      clearTemplatePositionJoystickPending();
      syncTemplatePositionJoystickWindow();
    }

    listContainer.innerHTML = '';
      const entries = templateManager.templatesArray;
      const entriesIndexed = entries.map((t, idx) => ({ t, idx }));
      entriesIndexed.sort((a, b) => {
        const aStore = templateManager.templatesJSON?.templates?.[a.t.storageKey] ?? {};
        const bStore = templateManager.templatesJSON?.templates?.[b.t.storageKey] ?? {};
        const aStoreRemote = aStore.remote === true;
        const bStoreRemote = bStore.remote === true;
        const aIsRemote = a.t.isRemote === true || aStoreRemote;
        const bIsRemote = b.t.isRemote === true || bStoreRemote;
        const aTop = normalizeFlag(a.t.remoteToTop) || normalizeFlag(aStore.remoteToTop);
        const bTop = normalizeFlag(b.t.remoteToTop) || normalizeFlag(bStore.remoteToTop);
        const aGroup = aTop ? 0 : (aIsRemote ? 2 : 1);
        const bGroup = bTop ? 0 : (bIsRemote ? 2 : 1);
        if (aGroup !== bGroup) return aGroup - bGroup;
        if (aGroup === 1) return a.idx - b.idx;
        const aOrder = normalizeRemoteOrder(
          Number.isFinite(a.t.remoteOrder) ? a.t.remoteOrder : aStore.remoteOrder
        );
        const bOrder = normalizeRemoteOrder(
          Number.isFinite(b.t.remoteOrder) ? b.t.remoteOrder : bStore.remoteOrder
        );
        const aOrderValue = aOrder === null ? Number.MAX_SAFE_INTEGER : aOrder;
        const bOrderValue = bOrder === null ? Number.MAX_SAFE_INTEGER : bOrder;
        if (aOrderValue !== bOrderValue) return aOrderValue - bOrderValue;
        return a.idx - b.idx;
      });
      const rootLevelEntries = [];
      const streamEntryGroups = new Map();
      const streamGroupContainers = new Map();
      const ensureStreamGroupContainer = (streamName, count = 0) => {
        const normalizedStream = normalizeTemplateRemoteStream(streamName);
        if (normalizedStream === DEFAULT_REMOTE_TEMPLATE_STREAM) {
          return listContainer;
        }
        if (streamGroupContainers.has(normalizedStream)) {
          return streamGroupContainers.get(normalizedStream);
        }
        const details = document.createElement('details');
        details.open = true;
        details.style.border = '1px solid var(--bm-border)';
        details.style.borderRadius = '6px';
        details.style.padding = '4px 6px';
        details.style.background = 'var(--bm-panel-bg, transparent)';

        const summary = document.createElement('summary');
        summary.textContent = count > 0
          ? t('templates.streamGroup', { stream: normalizedStream, count })
          : normalizedStream;
        summary.style.cursor = 'pointer';
        summary.style.fontSize = '12px';
        summary.style.fontWeight = '600';
        summary.style.textTransform = 'lowercase';

        const body = document.createElement('div');
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '4px';
        body.style.padding = '4px 0 0 12px';

        details.appendChild(summary);
        details.appendChild(body);
        listContainer.appendChild(details);
        streamGroupContainers.set(normalizedStream, body);
        return body;
      };
      for (const entry of entriesIndexed) {
        const template = entry.t;
        const isRemote = isTemplateRemote(template);
        const remoteStream = isRemote ? getTemplateRemoteStream(template) : DEFAULT_REMOTE_TEMPLATE_STREAM;
        if (!isRemote || remoteStream === DEFAULT_REMOTE_TEMPLATE_STREAM) {
          rootLevelEntries.push(entry);
          continue;
        }
        if (!streamEntryGroups.has(remoteStream)) {
          streamEntryGroups.set(remoteStream, []);
        }
        streamEntryGroups.get(remoteStream).push(entry);
      }
      const entriesToRender = [
        ...rootLevelEntries,
        ...[...streamEntryGroups.keys()]
          .sort((a, b) => a.localeCompare(b))
          .flatMap((stream) => streamEntryGroups.get(stream) ?? []),
      ];
      const templateEnabledState = Object.fromEntries(
        (templateManager.templatesArray ?? []).map(t => [t.storageKey, t.enabled ?? true])
      );
      const {
        paletteSum: paletteSumForTemplateList,
        combinedProgress: combinedProgressForTemplateList,
      } = progressSnapshot ?? templateManager.getOverallPerColorProgress();
      const phantomColorKeys = new Set();
      Object.entries(paletteSumForTemplateList).forEach(([rgb, totalCount]) => {
        if (rgb === 'other') return;
        const paintedCount = Number(combinedProgressForTemplateList[rgb]?.paintedAndEnabled ?? 0);
        const remainingCount = Math.max(0, (Number(totalCount) || 0) - paintedCount);
        const exampleCount = Number(combinedProgressForTemplateList[rgb]?.examplesEnabled?.length ?? 0);
        if (remainingCount > 0 && exampleCount === 0) {
          phantomColorKeys.add(rgb);
        }
      });
      // Use incremental running totals — O(templates) instead of O(tiles × templates).
      const combinedTemplate = {};
      const runningTemplate = templateManager._runningTemplate;
      for (const storageKey in runningTemplate) {
        if (templateEnabledState[storageKey] === false) continue;
        const data = runningTemplate[storageKey];
        const palette = {};
        for (const rgb in data.palette) {
          const v = Number(data.palette[rgb]) || 0;
          if (v !== 0) palette[rgb] = v;
        }
        combinedTemplate[storageKey] = { painted: Math.max(0, data.painted), palette };
      }

      for (const entry of entriesToRender) {
        const template = entry.t;
      const templateName = template["displayName"];
      const templateStore = templateManager.templatesJSON?.templates?.[template.storageKey] ?? {};
      const isRemote = isTemplateRemote(template);
      const remoteStream = isRemote ? getTemplateRemoteStream(template) : DEFAULT_REMOTE_TEMPLATE_STREAM;
      const timeArchiveMeta = getTemplateTimeArchiveMeta(template);
      const storedWidth = Number(templateStore.width);
      const storedHeight = Number(templateStore.height);
      const imageWidth = Number.isFinite(Number(template.imageWidth)) ? Number(template.imageWidth) : storedWidth;
      const imageHeight = Number.isFinite(Number(template.imageHeight)) ? Number(template.imageHeight) : storedHeight;
      const isPositionEditing = templatePositionEditStorageKey === template.storageKey;
      let row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      let removeButton = document.createElement('a');
      removeButton.className = 'bm-icon-link';
      removeButton.title = t('templates.removeTitle');
      removeButton.textContent = "🗑️";
      removeButton.style.fontSize = '12px';
      removeButton.onclick = () => {
        if (confirm(`Remove template ${template?.displayName}?`)) {
          templateManager.deleteTemplate(template?.storageKey);
        }
      }

      let teleportButton = document.createElement('a');
      teleportButton.className = 'bm-icon-link';
      teleportButton.title = t('templates.teleportTitle');
      teleportButton.textContent = "✈️";
      teleportButton.style.fontSize = '12px';
      teleportButton.onclick = () => {
        teleportToTileCoords(template.coords.slice(0, 2), template.coords.slice(2, 4));
      }

      let positionButton = document.createElement('a');
      positionButton.className = 'bm-icon-link bm-template-position-button';
      positionButton.title = isRemote
        ? t('templates.position.cannotRemote')
        : (isPositionEditing
          ? t('templates.position.apply')
          : t('templates.position.adjust'));
      positionButton.textContent = isPositionEditing ? "✅" : "⚙️";
      positionButton.style.fontSize = '12px';
      positionButton.onclick = async () => {
        if (isRemote) {
          overlayMain.handleDisplayStatus('Remote templates cannot be repositioned.');
          return;
        }
        if (templatePositionEditStorageKey !== template.storageKey) {
          templatePositionEditStorageKey = template.storageKey;
          clearTemplatePositionJoystickPending();
          if (!setOverlayCoordsInputs(template.coords)) {
            templatePositionEditStorageKey = null;
            syncTemplatePositionJoystickWindow();
            overlayMain.handleDisplayError('Unable to load template coordinates into inputs.');
            return;
          }
          syncTemplatePositionJoystickWindow();
          const focusCoords = resolveTemplateFocusCoords(
            template.coords,
            imageWidth,
            imageHeight
          );
          const targetCoords = focusCoords || normalizeTilePixelCoords(template.coords) || template.coords;
          await teleportToTileCoords(targetCoords.slice(0, 2), targetCoords.slice(2, 4));
          applyTemplateFocusZoom(imageWidth, imageHeight);
          buildTemplateFilterList();
          overlayMain.handleDisplayStatus(`Adjusting "${templateName}". Update coords on the map, then click ⚙️ again to apply.`);
          return;
        }
        const nextCoords = getOverlayCoordsFromInputsNormalized();
        if (!nextCoords) {
          overlayMain.handleDisplayError('Coordinates are malformed.');
          return;
        }
        templatePositionEditStorageKey = null;
        clearTemplatePositionJoystickPending();
        syncTemplatePositionJoystickWindow();
        const moveResult = await moveTemplateToCoords(template, nextCoords);
        if (!moveResult.ok) {
          overlayMain.handleDisplayError(moveResult.message || 'Failed to reposition template.');
          buildTemplateFilterList();
          return;
        }
        if (moveResult.moved) {
          overlayMain.handleDisplayStatus(`Template "${templateName}" moved to ${nextCoords.join(', ')}.`);
          const targetCoords = resolveTemplateFocusCoords(nextCoords, imageWidth, imageHeight) || nextCoords;
          await teleportToTileCoords(targetCoords.slice(0, 2), targetCoords.slice(2, 4));
          applyTemplateFocusZoom(imageWidth, imageHeight);
        } else {
          overlayMain.handleDisplayStatus(moveResult.message || 'Template position unchanged.');
          buildTemplateFilterList();
        }
      };
      positionButton.addEventListener('contextmenu', (event) => {
        if (templatePositionEditStorageKey !== template.storageKey) return;
        event.preventDefault();
        templatePositionEditStorageKey = null;
        clearTemplatePositionJoystickPending();
        syncTemplatePositionJoystickWindow();
        buildTemplateFilterList();
        overlayMain.handleDisplayStatus(`Canceled position edit for "${templateName}".`);
      });

	        let label = document.createElement('span');
	        label.style.fontSize = '12px';
	        const paletteEntries = template?.colorPalette ? Object.entries(template.colorPalette) : [];
	        const paletteTotal = paletteEntries.length
	          ? paletteEntries.reduce((sum, [, meta]) => sum + (Number(meta?.count) || 0), 0)
	          : 0;
	        const paletteFilteredTotal = paletteEntries.length
	          ? paletteEntries.reduce((sum, [rgb, meta]) => (
	            phantomColorKeys.has(rgb) ? sum : sum + (Number(meta?.count) || 0)
	          ), 0)
	          : 0;
	        const totalFallback = Number(template.requiredPixelCount ?? template.pixelCount ?? paletteTotal) || 0;
	        const totalCount = paletteEntries.length ? paletteFilteredTotal : totalFallback;
	        const totalLabelText = totalCount.toLocaleString();

	        const isHighlighted = normalizeFlag(template.remoteHighlighted) || normalizeFlag(templateStore.remoteHighlighted);
	        const templatePaintedPalette = combinedTemplate[template.storageKey]?.palette || {};
	        const filledByFilteredPalette = paletteEntries.length
	          ? paletteEntries.reduce((sum, [rgb, meta]) => {
	            if (phantomColorKeys.has(rgb)) return sum;
	            const expectedCount = Number(meta?.count) || 0;
	            const paintedCountForColor = Number(templatePaintedPalette[rgb]) || 0;
	            return sum + Math.min(expectedCount, paintedCountForColor);
	          }, 0)
	          : 0;
	        const filledRaw = Number(combinedTemplate[template.storageKey]?.painted ?? 0);
	        const filledBase = paletteEntries.length ? filledByFilteredPalette : (Number.isFinite(filledRaw) ? filledRaw : 0);
	        const filledCount = Math.max(0, Math.min(totalCount, filledBase));
	        const filledLabelText = `${filledCount.toLocaleString()}`;
	        const remainingCount = Math.max(0, totalCount - filledCount);
        const remainingLabelText = `${remainingCount.toLocaleString()}`;
        const showRemaining = templateManager.isTemplateListRemainingEnabled();
        const shouldShowCount = !showRemaining || template.enabled;
        const renameElement = document.createElement('span');
        renameElement.textContent = templateName;
        renameElement.className = "bm-templatename";
        renameElement.style.cursor = isRemote ? 'not-allowed' : 'text';
        renameElement.title = isRemote ? t('templates.rename.cannotRemote') : t('templates.rename.click');
        renameElement.addEventListener('click', () => {
        if (isRemote) {
          overlayMain.handleDisplayStatus('Remote templates cannot be renamed.');
          return;
        }
        if (renameElement.dataset.editing === 'true') { return; }
        renameElement.dataset.editing = 'true';
        const currentName = template["displayName"];
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'bm-template-rename-input';
        let finished = false;
        const finish = (shouldSave) => {
          if (finished) { return; }
          finished = true;
          const nextName = input.value.trim();
          label.replaceChild(renameElement, input);
          renameElement.dataset.editing = '';
          if (!shouldSave || !nextName || nextName === currentName) { return; }
          template["displayName"] = nextName;
          renameElement.textContent = nextName;
          try {
            const templateJSON = templateManager.templatesJSON?.templates?.[template.storageKey];
            if (templateJSON) {
              templateJSON.name = nextName;
              templateManager.storeTemplates();
            }
          } catch (_) {}
          buildTemplateFilterList();
        };
        label.replaceChild(input, renameElement);
        input.focus();
        input.select();
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
          }
        });
        input.addEventListener('blur', () => finish(true));
      });
        if (isRemote) {
          row.classList.add('bm-template-remote');
          const badge = document.createElement('span');
          badge.className = 'bm-remote-badge';
          badge.textContent = t('templates.badgeRemote');
          label.appendChild(badge);
        }
        if (timeArchiveMeta) {
          const archiveBadge = document.createElement('span');
          archiveBadge.className = 'bm-remote-badge bm-archive-badge';
          archiveBadge.textContent = t('templates.badgeArchive');
          archiveBadge.title = timeArchiveMeta.regionName
            ? t('templates.archiveTitle.region', {
              region: timeArchiveMeta.regionName,
              date: timeArchiveMeta.archiveDate || timeArchiveMeta.archiveVersion,
              version: timeArchiveMeta.archiveVersion,
            })
            : (
              timeArchiveMeta.archiveDate
                ? t('templates.archiveTitle.date', {
                  date: timeArchiveMeta.archiveDate,
                  version: timeArchiveMeta.archiveVersion,
                })
                : t('templates.archiveTitle.version', { version: timeArchiveMeta.archiveVersion })
            );
          label.appendChild(archiveBadge);
        }
        if (isHighlighted) {
          row.classList.add('bm-template-highlight');
        }
      if (isPositionEditing) {
        row.classList.add('bm-template-position-editing');
      }
      label.appendChild(renameElement);
      if (shouldShowCount) {
        const countSpan = document.createElement('span');
        countSpan.className = 'bm-template-count';
        countSpan.textContent = showRemaining
          ? t('templates.count.left', { count: remainingLabelText })
          : ` • ${filledLabelText} / ${totalLabelText}`;
        label.appendChild(countSpan);
      }

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = template.enabled;
      toggle.addEventListener('change', async () => {
        template.enabled = toggle.checked;
        row.classList.toggle('bm-template-inactive', !toggle.checked);
        overlayMain.handleDisplayStatus(
          toggle.checked
            ? `Enabled ${templateName}. Rendering visible crosses...`
            : `Disabled ${templateName}`
        );
        templateManager.clearTileProgress(template);
        syncToggleList();
        buildTemplateFilterList();
        // The total count has changed from clearTileProgress, and that may be a template outside the current view, so we need to refresh
        buildColorFilterList();
        forceRefreshTiles();
        if (toggle.checked) {
          // Show existing layers instantly, then refresh to catch any newly-visible tiles
          setTemplateSortIDLayersOpacity(template.sortID, 1);
          await templateManager.queueOverlayRefreshAfterUi(template.sortID, {
            visibleFirst: true,
            followUpFull: true,
            immediate: true,
          });
        } else {
          // Hide layers without removing them — re-enable is then instant (no re-registration)
          setTemplateSortIDLayersOpacity(template.sortID, 0);
        }
      });

      row.appendChild(toggle);
      row.appendChild(removeButton);
      row.appendChild(teleportButton);
      if (!isRemote) {
        row.appendChild(positionButton);
      }
      row.appendChild(label);
      const targetContainer = isRemote && remoteStream !== DEFAULT_REMOTE_TEMPLATE_STREAM
        ? ensureStreamGroupContainer(remoteStream, streamEntryGroups.get(remoteStream)?.length ?? 0)
        : listContainer;
      targetContainer.appendChild(row);
    }
    syncTemplatePositionJoystickWindow();
  };
  window.buildTemplateFilterList = buildTemplateFilterList;

  const parseBooleanLike = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    const normalizedValue = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enable', 'enabled'].includes(normalizedValue)) return true;
    if (['false', '0', 'no', 'off', 'disable', 'disabled'].includes(normalizedValue)) return false;
    return null;
  };

  const findTemplatesByNames = (templateNames) => {
    const safeNames = Array.isArray(templateNames) ? templateNames : [];
    const uniqueNames = [...new Set(
      safeNames
        .map((templateName) => String(templateName ?? '').trim())
        .filter(Boolean)
    )];
    const matches = [];
    const missing = [];
    uniqueNames.forEach((templateName) => {
      const lookup = templateName.toLowerCase();
      const foundTemplates = (templateManager.templatesArray ?? []).filter((template) => {
        const candidates = [
          template?.displayName,
          template?.remoteName,
          template?.storageKey,
        ];
        return candidates.some((candidate) => String(candidate ?? '').trim().toLowerCase() === lookup);
      });
      if (!foundTemplates.length) {
        missing.push(templateName);
        return;
      }
      foundTemplates.forEach((template) => {
        if (!matches.includes(template)) {
          matches.push(template);
        }
      });
    });
    return { matches, missing };
  };

  const getRusMarbleColorEntries = (progressSnapshot = null, options = {}) => {
    const visibleOnly = options?.visibleOnly === true;
    const toggleStatus = templateManager.getPaletteToggledStatus();
    const hideCompleted = templateManager.areCompletedColorsHidden();
    const hideLocked = templateManager.areLockedColorsHidden();
    const { paletteSum, combinedProgress } = progressSnapshot ?? templateManager.getOverallPerColorProgress();
    const sortBy = templateManager.getSortBy();
    const sortByParts = sortBy.split('-');
    const keyFunction = sortByOptions[sortByParts[0]];
    const compareFunction = (
      sortByParts[1] === 'asc'
        ? (a, b) => keyFunction(a) - keyFunction(b)
        : (a, b) => keyFunction(b) - keyFunction(a)
    );
    const paletteSumSorted = Object.entries(paletteSum)
      .map(([rgb, count]) => [rgb, combinedProgress[rgb]?.paintedAndEnabled ?? 0, count])
      .sort(compareFunction);
    const entries = [];
    for (const [rgb, paintedCount, totalCount] of paletteSumSorted) {
      const remainingCount = Math.max(0, totalCount - paintedCount);
      const examplesEnabledCount = combinedProgress[rgb]?.examplesEnabled?.length ?? 0;
      const meta = (
        rgb === '#deface'
          ? (rgbToMeta.get('222,250,206') ?? { id: 0, premium: false, name: 'Transparent' })
          : rgbToMeta.get(rgb)
      );
      const rgbValue = rgb === '#deface'
        ? [222, 250, 206]
        : (/^\d{1,3},\d{1,3},\d{1,3}$/.test(rgb) ? rgb.split(',').map((channel) => Number(channel)) : null);
      const colorId = typeof meta?.id === 'number' ? meta.id : null;
      const colorName = rgb === 'other'
        ? t('colors.other')
        : (rgb === '#deface'
          ? t('colors.transparent')
          : (meta?.name || rgb));
      const isUnlocked = colorId === null ? null : templateManager.isColorUnlocked(colorId);
      const visibleInColorList = (() => {
        if (hideLocked && rgb === 'other') return false;
        if (hideCompleted && paintedCount === totalCount) return false;
        if (hideLocked && colorId !== null && !isUnlocked) return false;
        if (remainingCount > 0 && examplesEnabledCount === 0 && rgb !== 'other') return false;
        return true;
      })();
      if (visibleOnly && !visibleInColorList) continue;
      entries.push({
        key: rgb,
        rgb: rgbValue,
        rgbText: Array.isArray(rgbValue) ? rgbValue.join(',') : null,
        name: colorName,
        id: colorId,
        premium: meta?.premium === true,
        enabled: toggleStatus[rgb] ?? true,
        unlocked: isUnlocked,
        totalCount,
        paintedCount,
        remainingCount,
        examplesEnabledCount,
        visibleInColorList,
      });
    }
    return entries;
  };

  const getRusMarbleColorTargetsFromInfo = (info) => {
    if (!info || typeof info !== 'object') return [];
    const rawTargets = [
      ...(Array.isArray(info.colors) ? info.colors : []),
      ...(Array.isArray(info.colorNames) ? info.colorNames : []),
      ...(Array.isArray(info.colorIds) ? info.colorIds : []),
      ...(Array.isArray(info.rgbValues) ? info.rgbValues : []),
    ];
    if (rawTargets.length === 0) {
      rawTargets.push(
        info.color
        ?? info.colorName
        ?? info.colorId
        ?? info.rgb
        ?? info.name
        ?? ''
      );
    }
    return [...new Set(
      rawTargets
        .map((target) => String(target ?? '').trim())
        .filter(Boolean)
    )];
  };

  const getRusMarbleColorLookupTokens = (entry) => {
    const tokens = new Set();
    const addToken = (value) => {
      const token = String(value ?? '').trim().toLowerCase();
      if (token) tokens.add(token);
    };
    addToken(entry?.key);
    addToken(entry?.name);
    addToken(entry?.rgbText);
    if (typeof entry?.id === 'number') addToken(entry.id);
    if (entry?.key === '#deface') {
      addToken('transparent');
      addToken('#deface');
      addToken('222,250,206');
      addToken(0);
    }
    if (entry?.key === 'other') {
      addToken('other');
    }
    return tokens;
  };

  const findColorsByTargets = (colorTargets) => {
    const safeTargets = Array.isArray(colorTargets) ? colorTargets : [];
    const uniqueTargets = [...new Set(
      safeTargets
        .map((colorTarget) => String(colorTarget ?? '').trim())
        .filter(Boolean)
    )];
    const availableColors = getRusMarbleColorEntries();
    const matches = [];
    const missing = [];
    uniqueTargets.forEach((colorTarget) => {
      const lookup = colorTarget.toLowerCase();
      const foundColors = availableColors.filter((entry) => getRusMarbleColorLookupTokens(entry).has(lookup));
      if (!foundColors.length) {
        missing.push(colorTarget);
        return;
      }
      foundColors.forEach((entry) => {
        if (!matches.some((match) => match?.key === entry.key)) {
          matches.push(entry);
        }
      });
    });
    return { matches, missing };
  };

  const setMatchedTemplatesEnabledState = async (matchedTemplates, enabled) => {
    const safeTemplates = Array.isArray(matchedTemplates) ? matchedTemplates.filter(Boolean) : [];
    let changedCount = 0;
    for (const template of safeTemplates) {
      const nextEnabled = Boolean(enabled);
      if (template.enabled === nextEnabled) continue;
      template.enabled = nextEnabled;
      changedCount += 1;
      templateManager.clearTileProgress(template);
      if (!nextEnabled) {
        removeLayer(null, template.sortID);
      }
    }
    if (!changedCount) {
      return { matched: safeTemplates.length, changed: 0 };
    }
    syncToggleList();
    buildTemplateFilterList();
    buildColorFilterList();
    forceRefreshTiles();
    if (enabled) {
      await templateManager.createOverlayOnMapVisibleFirst();
    }
    return { matched: safeTemplates.length, changed: changedCount };
  };

  const setMatchedColorsEnabledState = async (matchedColors, enabled) => {
    const colorKeys = [...new Set(
      (Array.isArray(matchedColors) ? matchedColors : [])
        .map((entry) => String(entry?.key ?? '').trim())
        .filter(Boolean)
    )];
    let changedCount = 0;
    for (const template of (templateManager.templatesArray ?? [])) {
      if (!template?.colorPalette) continue;
      for (const colorKey of colorKeys) {
        const paletteEntry = template.colorPalette[colorKey];
        if (!paletteEntry) continue;
        const nextEnabled = Boolean(enabled);
        if (paletteEntry.enabled === nextEnabled) continue;
        paletteEntry.enabled = nextEnabled;
        changedCount += 1;
      }
    }
    if (!changedCount) {
      return { matched: colorKeys.length, changed: 0 };
    }
    syncToggleList();
    buildColorFilterList();
    await templateManager.createOverlayOnMapVisibleFirst();
    if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
      forceRefreshTiles();
    }
    return { matched: colorKeys.length, changed: changedCount };
  };

  const normalizeRusMarbleControlAction = (info) => {
    if (!info || typeof info !== 'object') return null;
    const rawAction = String(
      info.bmAction
      ?? info.action
      ?? info.command
      ?? info.kind
      ?? ''
    ).trim().toLowerCase().replace(/[\s_]+/g, '-');
    const singleTemplateName = String(info.templateName ?? info.template ?? info.name ?? '').trim();
    const templateNames = Array.isArray(info.templateNames)
      ? info.templateNames.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : (singleTemplateName ? [singleTemplateName] : []);
    const colorTargets = getRusMarbleColorTargetsFromInfo(info);
    const enabledValue = parseBooleanLike(info.enabled ?? info.value ?? null);
    switch (rawAction) {
      case 'add-template':
      case 'add-template-by-name':
      case 'import-template':
      case 'import-template-by-name':
      case 'template-add':
      case 'template-add-by-name':
        if (!singleTemplateName) return null;
        return {
          kind: 'add-template-by-name',
          templateName: singleTemplateName,
          buttonText: 'Add',
          label: info.label ?? `Add template "${singleTemplateName}"`,
        };
      case 'enable-template':
      case 'enable-templates':
      case 'template-enable':
        if (!templateNames.length) return null;
        return {
          kind: 'set-template-enabled',
          enabled: true,
          templateNames,
          buttonText: 'Enable',
          label: info.label ?? `Enable template${templateNames.length === 1 ? '' : 's'}: ${templateNames.join(', ')}`,
        };
      case 'disable-template':
      case 'disable-templates':
      case 'template-disable':
        if (!templateNames.length) return null;
        return {
          kind: 'set-template-enabled',
          enabled: false,
          templateNames,
          buttonText: 'Disable',
          label: info.label ?? `Disable template${templateNames.length === 1 ? '' : 's'}: ${templateNames.join(', ')}`,
        };
      case 'toggle-template':
      case 'template-toggle':
        if (!templateNames.length || enabledValue === null) return null;
        return {
          kind: 'set-template-enabled',
          enabled: enabledValue,
          templateNames,
          buttonText: enabledValue ? 'Enable' : 'Disable',
          label: info.label ?? `${enabledValue ? 'Enable' : 'Disable'} template${templateNames.length === 1 ? '' : 's'}: ${templateNames.join(', ')}`,
        };
      case 'disable-all-templates':
      case 'template-disable-all':
      case 'templates-disable-all':
        return {
          kind: 'set-all-templates-enabled',
          enabled: false,
          buttonText: 'Disable All',
          label: info.label ?? 'Disable all templates',
        };
      case 'enable-all-templates':
      case 'template-enable-all':
      case 'templates-enable-all':
        return {
          kind: 'set-all-templates-enabled',
          enabled: true,
          buttonText: 'Enable All',
          label: info.label ?? 'Enable all templates',
        };
      case 'enable-color':
      case 'enable-colors':
      case 'color-enable':
        if (!colorTargets.length) return null;
        return {
          kind: 'set-color-enabled',
          enabled: true,
          colorTargets,
          buttonText: 'Enable Colors',
          label: info.label ?? `Enable color${colorTargets.length === 1 ? '' : 's'}: ${colorTargets.join(', ')}`,
        };
      case 'disable-color':
      case 'disable-colors':
      case 'color-disable':
        if (!colorTargets.length) return null;
        return {
          kind: 'set-color-enabled',
          enabled: false,
          colorTargets,
          buttonText: 'Disable Colors',
          label: info.label ?? `Disable color${colorTargets.length === 1 ? '' : 's'}: ${colorTargets.join(', ')}`,
        };
      case 'toggle-color':
      case 'toggle-colors':
      case 'color-toggle':
        if (!colorTargets.length || enabledValue === null) return null;
        return {
          kind: 'set-color-enabled',
          enabled: enabledValue,
          colorTargets,
          buttonText: enabledValue ? 'Enable Colors' : 'Disable Colors',
          label: info.label ?? `${enabledValue ? 'Enable' : 'Disable'} color${colorTargets.length === 1 ? '' : 's'}: ${colorTargets.join(', ')}`,
        };
      case 'disable-all-colors':
      case 'colors-disable-all':
      case 'color-disable-all':
        return {
          kind: 'set-all-colors-enabled',
          enabled: false,
          buttonText: 'Disable All Colors',
          label: info.label ?? 'Disable all colors',
        };
      case 'enable-all-colors':
      case 'colors-enable-all':
      case 'color-enable-all':
        return {
          kind: 'set-all-colors-enabled',
          enabled: true,
          buttonText: 'Enable All Colors',
          label: info.label ?? 'Enable all colors',
        };
      case 'jump':
      case 'j':
      case 'jump-next-template-pixel':
      case 'next-template-pixel':
      case 'template-jump':
      case 'j-functionality':
        return {
          kind: 'jump-next-template-pixel',
          originMode: normalizeTemplateJumpOriginMode(
            info.origin
            ?? info.point
            ?? info.corner
            ?? info.from
            ?? 'center'
          ),
          buttonText: 'Jump',
          label: info.label ?? `Jump to next template pixel from ${getTemplateJumpOriginLabel(
            info.origin ?? info.point ?? info.corner ?? info.from ?? 'center'
          )}`,
        };
      case 'close-pixel-info':
      case 'close-pixel-info-window':
      case 'close-pixel-info-panel':
      case 'pixel-info-close':
      case 'close-info':
        return {
          kind: 'close-pixel-info',
          buttonText: 'Close',
          label: info.label ?? 'Close pixel info',
        };
      case 'open-extended-palette':
      case 'open-extended-paint-palette':
      case 'extend-palette':
      case 'extend-paint-palette':
      case 'palette-extend':
      case 'palette-expand':
      case 'expand-palette':
      case 'expand-paint-palette':
        return {
          kind: 'open-extended-palette',
          buttonText: 'Palette',
          label: info.label ?? 'Open extended palette',
        };
      default:
        return null;
    }
  };

  const getEventDataEntries = (data) => {
    if (Array.isArray(data)) {
      return data.map((entry, index) => [entry?.id ?? index, entry]);
    }
    if (Array.isArray(data?.items)) {
      return data.items.map((entry, index) => [entry?.id ?? index, entry]);
    }
    if (Array.isArray(data?.events)) {
      return data.events.map((entry, index) => [entry?.id ?? index, entry]);
    }
    if (Array.isArray(data?.entries)) {
      return data.entries.map((entry, index) => [entry?.id ?? index, entry]);
    }
    return Object.entries(data);
  };

  const getRusMarbleTemplateList = () => (
    (templateManager.templatesArray ?? []).map((template, index) => {
      const store = template?.storageKey
        ? (templateManager.templatesJSON?.templates?.[template.storageKey] ?? {})
        : {};
      const isRemote = template?.isRemote === true || store?.remote === true;
      return {
        index,
        storageKey: template?.storageKey ?? null,
        displayName: template?.displayName ?? store?.name ?? null,
        remoteName: template?.remoteName ?? store?.remoteName ?? null,
        enabled: template?.enabled ?? store?.enabled ?? true,
        isRemote,
        remoteStream: isRemote ? (template?.remoteStream ?? store?.remoteStream ?? null) : null,
        coords: Array.isArray(template?.coords) ? [...template.coords] : null,
        sortID: template?.sortID ?? null,
      };
    })
  );

  const getRusMarbleColorList = () => getRusMarbleColorEntries();

  const executeRusMarbleControlAction = async (controlAction) => {
    if (!controlAction) return;
    switch (controlAction.kind) {
      case 'add-template-by-name': {
        const createdTemplate = await templateSync.importTemplateByName({
          templateName: controlAction.templateName,
          onStatus: (message) => overlayMain.handleDisplayStatus(message),
          onError: (message) => overlayMain.handleDisplayError(message),
          syncToggleList: () => window.syncToggleList?.(),
          buildTemplateFilterList: () => window.buildTemplateFilterList?.(),
          buildColorFilterList: () => window.buildColorFilterList?.(),
          defaultEnabled: true,
          replaceExistingMatches: true,
        });
        if (createdTemplate) {
          const statusMessage = `Template "${controlAction.templateName}" added or updated as a local template from event control.`;
          overlayMain.handleDisplayStatus(statusMessage);
          return statusMessage;
        }
        return `Template "${controlAction.templateName}" add/update requested.`;
      }
      case 'set-template-enabled': {
        const { matches, missing } = findTemplatesByNames(controlAction.templateNames);
        if (!matches.length) {
          throw new Error(`Template${controlAction.templateNames.length === 1 ? '' : 's'} not found: ${controlAction.templateNames.join(', ')}.`);
        }
        const result = await setMatchedTemplatesEnabledState(matches, controlAction.enabled);
        const actionLabel = controlAction.enabled ? 'Enabled' : 'Disabled';
        let statusMessage = `${actionLabel} ${result.changed || result.matched} template${(result.changed || result.matched) === 1 ? '' : 's'}.`;
        if (missing.length) {
          statusMessage += ` Missing: ${missing.join(', ')}.`;
        }
        overlayMain.handleDisplayStatus(statusMessage);
        return statusMessage;
      }
      case 'set-all-templates-enabled': {
        const templates = templateManager.templatesArray ?? [];
        if (!templates.length) {
          throw new Error('No templates are loaded.');
        }
        const result = await setMatchedTemplatesEnabledState(templates, controlAction.enabled);
        const statusMessage = (
          `${controlAction.enabled ? 'Enabled' : 'Disabled'} all templates${result.changed ? ` (${result.changed} changed)` : ''}.`
        );
        overlayMain.handleDisplayStatus(statusMessage);
        return statusMessage;
      }
      case 'set-color-enabled': {
        const { matches, missing } = findColorsByTargets(controlAction.colorTargets);
        if (!matches.length) {
          throw new Error(`Color${controlAction.colorTargets.length === 1 ? '' : 's'} not found: ${controlAction.colorTargets.join(', ')}.`);
        }
        const result = await setMatchedColorsEnabledState(matches, controlAction.enabled);
        const actionLabel = controlAction.enabled ? 'Enabled' : 'Disabled';
        let statusMessage = `${actionLabel} ${result.changed || result.matched} color${(result.changed || result.matched) === 1 ? '' : 's'}.`;
        if (missing.length) {
          statusMessage += ` Missing: ${missing.join(', ')}.`;
        }
        overlayMain.handleDisplayStatus(statusMessage);
        return statusMessage;
      }
      case 'set-all-colors-enabled': {
        const colors = getRusMarbleColorEntries();
        if (!colors.length) {
          throw new Error('No colors are available.');
        }
        const result = await setMatchedColorsEnabledState(colors, controlAction.enabled);
        const statusMessage = (
          `${controlAction.enabled ? 'Enabled' : 'Disabled'} all colors${result.changed ? ` (${result.changed} changed)` : ''}.`
        );
        overlayMain.handleDisplayStatus(statusMessage);
        return statusMessage;
      }
      case 'jump-next-template-pixel':
        await jumpToNextUnpaintedTemplatePixel({ originMode: controlAction.originMode });
        return `Jump requested from ${getTemplateJumpOriginLabel(controlAction.originMode)}.`;
      case 'close-pixel-info': {
        schedulePixelInfoCloseBurst();
        const statusMessage = 'Close pixel info requested.';
        overlayMain.handleDisplayStatus(statusMessage);
        return statusMessage;
      }
      case 'open-extended-palette': {
        const statusMessage = ensureExtendedPaintPalette();
        overlayMain.handleDisplayStatus(statusMessage);
        return statusMessage;
      }
      default:
        throw new Error('Unsupported RusMarble control action.');
    }
  };

  const BM_CONSOLE_REQUEST_EVENT = 'bm-console-command';
  const BM_CONSOLE_RESPONSE_EVENT = 'bm-console-response';

  const dispatchRusMarbleConsoleResponse = (requestId, payload = {}) => {
    if (!requestId) return;
    document.dispatchEvent(new CustomEvent(BM_CONSOLE_RESPONSE_EVENT, {
      detail: {
        requestId,
        ...payload,
      },
    }));
  };

  const handleRusMarbleConsoleCommand = async (detail = {}) => {
    const requestId = String(detail?.requestId ?? '').trim();
    const command = String(detail?.command ?? '').trim().toLowerCase();
    try {
      switch (command) {
        case 'control': {
          const controlAction = normalizeRusMarbleControlAction(detail?.payload);
          if (!controlAction) {
            throw new Error('Invalid RusMarble control payload.');
          }
          const result = await executeRusMarbleControlAction(controlAction);
          dispatchRusMarbleConsoleResponse(requestId, { ok: true, result });
          return;
        }
        case 'build-event-list':
          buildEventList();
          dispatchRusMarbleConsoleResponse(requestId, { ok: true, result: 'Event list rebuild requested.' });
          return;
        case 'build-template-filter-list':
          buildTemplateFilterList();
          dispatchRusMarbleConsoleResponse(requestId, { ok: true, result: 'Template list rebuild requested.' });
          return;
        case 'get-template-list':
        case 'list-templates':
          dispatchRusMarbleConsoleResponse(requestId, { ok: true, result: getRusMarbleTemplateList() });
          return;
        case 'get-color-list':
        case 'list-colors':
          dispatchRusMarbleConsoleResponse(requestId, { ok: true, result: getRusMarbleColorList() });
          return;
        case 'build-color-filter-list':
          buildColorFilterList();
          dispatchRusMarbleConsoleResponse(requestId, { ok: true, result: 'Color list rebuild requested.' });
          return;
        case 'sync-toggle-list':
          syncToggleList();
          dispatchRusMarbleConsoleResponse(requestId, { ok: true, result: 'Template state synced.' });
          return;
        default:
          throw new Error(`Unknown RusMarble console command: ${command || '(empty)'}.`);
      }
    } catch (error) {
      dispatchRusMarbleConsoleResponse(requestId, {
        ok: false,
        error: error?.message || 'RusMarble console command failed.',
      });
    }
  };

  document.removeEventListener(BM_CONSOLE_REQUEST_EVENT, document.__bmConsoleCommandListener);
  document.__bmConsoleCommandListener = (event) => {
    void handleRusMarbleConsoleCommand(event?.detail ?? {});
  };
  document.addEventListener(BM_CONSOLE_REQUEST_EVENT, document.__bmConsoleCommandListener);

  const installRusMarblePageConsoleBridge = () => {
    if (!document.documentElement || document.documentElement.dataset.bmConsoleBridgeInstalled === '1') return;
    const script = document.createElement('script');
    script.textContent = `
      (() => {
        if (window.bmControl && window.buildEventList && window.buildTemplateFilterList && window.buildColorFilterList && window.getTemplateList && window.getColorList) {
          return;
        }
        const requestEventName = ${JSON.stringify(BM_CONSOLE_REQUEST_EVENT)};
        const responseEventName = ${JSON.stringify(BM_CONSOLE_RESPONSE_EVENT)};
        let sequence = 0;
        const sendRusMarbleCommand = (command, payload) => new Promise((resolve, reject) => {
          const requestId = 'bm-console-' + Date.now() + '-' + (++sequence);
          let settled = false;
          let timeoutId = null;
          const cleanup = () => {
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            document.removeEventListener(responseEventName, onResponse);
          };
          const onResponse = (event) => {
            if (event?.detail?.requestId !== requestId || settled) return;
            settled = true;
            cleanup();
            if (event.detail.ok) {
              resolve(event.detail.result);
            } else {
              reject(new Error(event.detail.error || 'RusMarble command failed.'));
            }
          };
          document.addEventListener(responseEventName, onResponse);
          timeoutId = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('RusMarble did not respond to the console command.'));
          }, 15000);
          document.dispatchEvent(new CustomEvent(requestEventName, {
            detail: {
              requestId,
              command,
              payload,
            },
          }));
        });
        window.bmControl = (payload) => sendRusMarbleCommand('control', payload);
        window.buildEventList = () => sendRusMarbleCommand('build-event-list');
        window.buildTemplateFilterList = () => sendRusMarbleCommand('build-template-filter-list');
        window.getTemplateList = () => sendRusMarbleCommand('get-template-list');
        window.getColorList = () => sendRusMarbleCommand('get-color-list');
        window.buildColorFilterList = () => sendRusMarbleCommand('build-color-filter-list');
        window.syncToggleList = () => sendRusMarbleCommand('sync-toggle-list');
      })();
    `;
    document.documentElement.dataset.bmConsoleBridgeInstalled = '1';
    document.documentElement.appendChild(script);
    script.remove();
  };

  installRusMarblePageConsoleBridge();

  const buildEventList = () => {
    const listContainer = document.querySelector('#bm-eventitem-list');
    const showClaimed = templateManager.isEventClaimedShown();
    const showUnavailable = templateManager.isEventUnavailableShown();
    const provider = apiManager.eventDataURL ?? templateManager.getEventProvider();
    if (apiManager.eventData === null && (provider === null || provider == "")) {
      // rely on external sources
      listContainer.innerHTML = `<small>${
        apiManager.eventClaimed === null
          ? t('event.noClaimedLoaded')
          : t('event.providerNotSet')
      }</small>`;
      return;
    };
    const eventClaimedList = new Set(Array.isArray(apiManager.eventClaimed) ? apiManager.eventClaimed : []);
    consoleLog("eventClaimedList", eventClaimedList);
    // Format: e.g. https://wplace.samuelscheit.com/tiles/pumpkin.json
    (
      apiManager.eventData === null ?
      fetch(provider, {
        "credentials": "include",
      }).then(response => response.json()) :
      new Promise(resolve => {
        const consumed = apiManager.eventData;
        apiManager.eventData = null; // already consumed
        resolve(consumed);
      })
    ).then(data => {
      consoleLog("event Location data", data);
      if (typeof data !== 'object') {
        listContainer.innerHTML = `<small>${t('event.unknownFormat')}</small>`;
        return;
      }
      listContainer.textContent = "";
      let hasEntries = false;
      const dataSource = getEventDataEntries(data);
      dataSource.forEach(([itemId, info]) => {
        const numericItemId = Number(itemId);
        const hasNumericItemId = Number.isFinite(numericItemId);
        const itemLabel = hasNumericItemId ? `#${numericItemId}` : `#${String(itemId ?? '').trim() || '?'}`;
        const controlAction = normalizeRusMarbleControlAction(info);
        const isClaimed = hasNumericItemId && eventClaimedList.has(numericItemId);
        if (!controlAction && isClaimed && !showClaimed) return;
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '6px';

        let coords = null;
        let coordStatus = "";
        if (typeof info === 'object') {
          if (info['lat'] !== undefined && info['lng'] !== undefined) {
            coords = [info['lat'], info['lng']];
          } else if (info['latitude'] !== undefined && info['longitude'] !== undefined) {
            coords = [info['latitude'], info['longitude']];
          } else if (
            info['tileX'] !== undefined && info['offsetX'] !== undefined &&
            info['tileY'] !== undefined && info['offsetY'] !== undefined
          ) {
            coords = coordsTileCoordsToGeoCoords(
              [info['tileX'], info['tileY']],
              [info['offsetX'], info['offsetY']]
            )
          }
          // Check Time
          if (info['foundAt'] !== undefined) {
            const currentTimestamp = Date.now();
            const currentHour = currentTimestamp - (currentTimestamp % 3600000);
            const foundTimestamp = new Date(info['foundAt']).getTime();
            const foundHour = foundTimestamp - (foundTimestamp % 3600000);
            if (currentHour !== foundHour) {
              coordStatus = t('event.expiredPrefix');
              if (!showUnavailable) return;
            }
          }
        }

        if (coords !== null) {
          let teleportButton = document.createElement('a');
          teleportButton.className = 'bm-icon-link';
          teleportButton.title = t('event.teleportTitle');
          teleportButton.textContent = "✈️";
          teleportButton.style.fontSize = '12px';
          teleportButton.onclick = () => {
            teleportToGeoCoords(coords[0], coords[1]);
            const mapMarkers = Array.from(
              document.querySelectorAll(".cursor-pointer.z-10") // z-10: not the pin (z-20)
            ).filter( x => {
              if (x.style.opacity != 1) return false;
              const rect = x.getBoundingClientRect();
              const windowWidth = window.innerWidth || document.documentElement.clientWidth;
              const windowHeight = window.innerHeight || document.documentElement.clientHeight;
              return (
                rect.top >= 0 && rect.bottom <= windowWidth &&
                rect.left >= 0 && rect.right <= windowHeight
              );
            });
            if (mapMarkers.length === 1) { // only 1 opaque marker on screen
              mapMarkers[0].click(); // safely click it  
            };
          }
          row.appendChild(teleportButton);
        } else if (!controlAction) {
          coordStatus = t('event.unknownCoordsPrefix');
        }

        if (controlAction) {
          const actionButton = document.createElement('button');
          actionButton.type = 'button';
          actionButton.textContent = controlAction.buttonText;
          actionButton.style.fontSize = '11px';
          actionButton.style.padding = '0 6px';
          actionButton.onclick = async () => {
            actionButton.disabled = true;
            try {
              await executeRusMarbleControlAction(controlAction);
            } catch (error) {
              consoleWarn('Failed to execute RusMarble control event.', { controlAction, error });
              overlayMain.handleDisplayError(error?.message || 'Failed to execute the RusMarble control event.');
            } finally {
              actionButton.disabled = false;
            }
          };
          row.appendChild(actionButton);
        }

        let label = document.createElement('span');
        label.style.fontSize = '12px';
        if (controlAction) {
          const prefix = itemLabel ? `${itemLabel} • ` : '';
          label.textContent = `${prefix}${controlAction.label}`;
        } else {
          label.textContent = `${itemLabel} • ${coordStatus}${eventClaimedList.has(numericItemId) ? t('event.claimed') : t('event.unclaimed')}`;
        }
        row.appendChild(label);
        listContainer.appendChild(row);
        hasEntries = true;
      });
      if (!hasEntries && listContainer) {
        listContainer.innerHTML = `<small>${t('event.noItems', {
          claimed: showClaimed ? '' : t('event.unclaimedQualifier'),
          recent: showUnavailable ? '' : t('event.recentQualifier'),
        })}</small>`;
      }
    }).catch(err => {
      listContainer.innerHTML = `<small>${t('event.fetchFailed')}</small>`;
    });

  };
  window.buildEventList = buildEventList;

  const forceUpdateTheme = () => {
    if (templateManager.isThemeOverridden()) {
      setTheme(templateManager.getCurrentTheme());
    } else {
      setTheme(Object.keys(themeList)[0]);
    }
  };
  window.forceUpdateTheme = forceUpdateTheme;

  // a workaround to force Map.prototype to be called
  const forceClickCenter = () => {
    if (!isMapTilerLoaded()) {
      if (!forceClickCenter.clickCount) forceClickCenter.clickCount = 0;
      // Try at most 10 times
      if (forceClickCenter.clickCount < 10) {
        const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
        if (allianceOrRankingButton) {
          // not in painting mode
          const canvas = document.querySelector("canvas.maplibregl-canvas");
          if (canvas) {
            const ev = new MouseEvent("click", {
              "bubbles": true, "cancelable": true,
              "clientX": canvas.offsetWidth / 2,
              "clientY": canvas.offsetHeight / 2,
              "button": 0
            });
            canvas.dispatchEvent(ev);
            ++forceClickCenter.clickCount;
          };
        }
      };
      setTimeout(forceClickCenter, 100);
    };
  };
  window.forceClickCenter = forceClickCenter;

  // Listen for template creation/import completion to (re)build palette list
  window.addEventListener('message', (event) => {
    if (event?.data?.bmEvent === 'bm-rebuild-color-list') {
      try { buildColorFilterList(); } catch (_) {}
    } else if (event?.data?.bmEvent === 'bm-rebuild-template-list') {
      try { buildTemplateFilterList(); } catch (_) {}
    } else if (event?.data?.bmEvent === 'bm-rebuild-event-list') {
      try { buildEventList(); } catch (_) {}
    }
  });

  // If a template was already loaded from storage, show the color UI and build list
  setTimeout(() => {
    try {
      if (templateManager.templatesArray?.length > 0) {
        // const colorUI = document.querySelector('#bm-contain-colorfilter');
        // if (colorUI) { colorUI.style.display = ''; }
        buildColorFilterList();
      }
      if (templateManager.templatesArray?.length > 0) {
        buildTemplateFilterList();
      }
    } catch (_) {}
    try {
      if (templateManager.isEventEnabled()) {
        buildEventList();
      }
    } catch (_) {}
    try {
      // this feature is currently broken by wplace
      if (templateManager.isThemeOverridden()) {
        doAfterMapFound(forceUpdateTheme);
      }
    } catch (_) {}
    try {
      forceClickCenter();
    } catch (_) {}
  }, 0);


}
