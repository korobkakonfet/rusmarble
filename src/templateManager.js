import Template from "./Template";
import { getTemplateMaskPoints } from './templateMaskPoints.js';
import { profiler } from './profiler.js';
import { numberToEncoded, cleanUpCanvas, rgbToMeta, sortByOptions, testCanvasSize, getCurrentColor, sleep, createBitmapPreservingPixels, consoleLog, consoleWarn, uint8ToBase64, base64ToUint8, TEMPLATE_BUFFER_GZIP_PREFIX, canCompressTemplateBuffers, compressTemplateBufferPayload, setDebugLoggingEnabled as setGlobalDebugLoggingEnabled } from "./utils";
import { themeList, addTemplateCanvas, addTemplateFullCanvas, removeLayer, removeTemplateCanvasSources, forceRefreshTiles, coordsGeoCoordsToTileCoords, getMapBounds, doAfterMapFound, isMapTilerLoaded, bmCanvas, getMountedTemplateCanvasSourceIDs, setUsageLayersOpacity } from './utilsMaptiler.js';
import {
  buildMaskRowSpans,
  cloneMaskRowSpans,
  collectTemplateProgressFromSamples,
  encodeChunkSampleBytes,
  getMaskRowSpansTransferList,
  mergeSerializedPaletteProgress,
  mergeSerializedTemplateProgress,
  mergeTemplateExampleReservoir,
  decodeChunkSampleBuffer,
  readChunkSampleHeader,
  renderSampleDataToImage,
  TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE,
} from './templateChunkUtils.js';
import { templateWorkerManager } from './templateWorkerManager.js';
import { canUseTemplateBufferDb, readTemplateBuffers, writeTemplateBuffers, deleteTemplateBuffers, listTemplateBufferKeys, reportTemplateBufferBytes, estimateStorageQuota } from './templateBufferStore.js';

const DEFAULT_TEMPLATE_SYNC_STREAM = 'root';
const DEFAULT_TEMPLATE_EXAMPLE_LIMIT = 32;
const SMART_TEMPLATE_EXAMPLE_LIMIT = Infinity;
const TEMPLATE_OTHER_COLOR_KEY = 'other';
const OVERLAY_RASTER_CACHE_MAX = 256;
const DEFAULT_TRANSPARENT_ERASE_COLOR = '#ff0000';
/** Max characters per stored buffer slice. GM.setValue rides Chrome's extension messaging
 * channel, which rejects anything over 64MiB; base64 is single-byte so characters ~= bytes.
 * 8MiB leaves generous headroom for the surrounding message envelope.
 */
const TEMPLATE_BUFFER_CHUNK_CHARS = 8 * 1024 * 1024;

/** Records a render problem somewhere the production build can still surface it.
 * Terser strips console.* from production, so console.warn is invisible to users. It also has to
 * live on document.head rather than window: @grant puts the script in Tampermonkey's sandbox,
 * which has its own window that the page's devtools console cannot read. document.head is the
 * same node in both contexts, which is why __bmmap and __bmCanvas are bridged the same way.
 * Readable from the console as document.head.__bmOverlayIssues.
 */
const noteOverlayIssue = (message, detail) => {
  try {
    if (typeof document === 'undefined' || !document.head) return;
    if (!Array.isArray(document.head['__bmOverlayIssues'])) document.head['__bmOverlayIssues'] = [];
    const issues = document.head['__bmOverlayIssues'];
    issues.push({ at: new Date().toISOString(), message, detail: String(detail ?? '') });
    if (issues.length > 50) issues.shift();
  } catch (_) {}
};
const packRgb = (r, g, b) => ((r << 16) | (g << 8) | b);
const parsePackedRgbKey = (key) => {
  if (typeof key !== 'string') return null;
  const firstComma = key.indexOf(',');
  if (firstComma < 1) return null;
  const secondComma = key.indexOf(',', firstComma + 1);
  if (secondComma < firstComma + 2 || secondComma >= key.length - 1) return null;
  const red = Number(key.slice(0, firstComma));
  const green = Number(key.slice(firstComma + 1, secondComma));
  const blue = Number(key.slice(secondComma + 1));
  if (
    !Number.isInteger(red) || red < 0 || red > 255
    || !Number.isInteger(green) || green < 0 || green > 255
    || !Number.isInteger(blue) || blue < 0 || blue > 255
  ) {
    return null;
  }
  return packRgb(red, green, blue);
};
const _numberFormat = new Intl.NumberFormat();
const knownPalettePackedColors = (() => {
  const packedSet = new Set();
  for (const key of rgbToMeta.keys()) {
    if (key === TEMPLATE_OTHER_COLOR_KEY) continue;
    const packed = parsePackedRgbKey(key);
    if (packed !== null) {
      packedSet.add(packed);
    }
  }
  return packedSet;
})();
const knownColorsSorted = Uint32Array.from(knownPalettePackedColors).sort();
const UI_WORK_SLICE_MS = 30;
const getNowMs = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);
const yieldToBrowser = () => (
  typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
    ? new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
    : sleep(0)
);
const createUiWorkScheduler = (sliceMs = UI_WORK_SLICE_MS) => {
  let lastYieldAt = getNowMs();
  return async (force = false) => {
    const now = getNowMs();
    if (!force && now - lastYieldAt < sliceMs) return;
    await yieldToBrowser();
    lastYieldAt = getNowMs();
  };
};
const waitForUiPaint = async () => {
  await yieldToBrowser();
  await yieldToBrowser();
};
const syncInjectedDebugLogging = (enabled) => {
  try {
    if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
      window.postMessage({
        source: 'blue-marble',
        type: 'bm-debug-logging',
        enabled: enabled === true,
      }, '*');
    }
  } catch (_) {}
};
const normalizeFlagValue = (value) => value === true || value === 'true' || value === 1 || value === '1';
const normalizeTemplateSyncStreamValue = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  return text || DEFAULT_TEMPLATE_SYNC_STREAM;
};
const normalizeTemplateSyncStreamsValue = (value) => {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[\s,]+/) : []);
  const streams = [];
  const seen = new Set();
  for (const entry of source) {
    const normalized = normalizeTemplateSyncStreamValue(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    streams.push(normalized);
  }
  return streams.length ? streams : [DEFAULT_TEMPLATE_SYNC_STREAM];
};
const normalizeTimeArchiveMeta = (value) => {
  if (!value || typeof value !== 'object') return null;
  const source = String(value?.source || '').trim().toLowerCase();
  if (source !== 'time-archive') return null;
  const archiveVersion = String(value?.archiveVersion || '').trim();
  if (!archiveVersion) return null;
  const archiveDate = String(value?.archiveDate || '').trim();
  const archiveBaseUrl = String(value?.archiveBaseUrl || '').trim().replace(/\/+$/, '');
  const regionName = String(value?.regionName || '').trim();
  const width = Number.isFinite(Number(value?.width))
    ? Math.max(1, Math.trunc(Number(value.width)))
    : null;
  const height = Number.isFinite(Number(value?.height))
    ? Math.max(1, Math.trunc(Number(value.height)))
    : null;
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
const templateJsonReplacer = (_key, value) => (
  value instanceof Uint8Array ? uint8ToBase64(value) : value
);
/** Storage keys whose read failed or timed out; surfaced alongside the boot diagnostics. */
const templateBufferReadFailures = new Set();

/** GM.getValue that cannot strand the caller.
 * Tampermonkey moves storage over Chrome's extension messaging channel, which rejects payloads
 * over 64MiB. An oversized key written by an older build makes the read reject *or* never settle
 * at all. Every buffer read below sits on the boot path, so an unsettled promise there silently
 * kills the whole script. Resolving to the fallback instead lets the template be skipped and the
 * UI (and the getStorageReport diagnostic) come up so the bad data can be found and removed.
 * @since 0.87.80
 */
const readTemplateStorageValue = (key, fallback = '', timeoutMs = 15000) => Promise.race([
  Promise.resolve().then(() => GM.getValue(key, fallback)),
  new Promise((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
]).then((value) => {
  if (value === undefined || value === null) {
    templateBufferReadFailures.add(key);
    return fallback;
  }
  return value;
}).catch(() => {
  templateBufferReadFailures.add(key);
  return fallback;
});

/** Reverses compressTemplateBufferPayload, passing uncompressed payloads through untouched. */
async function decompressTemplateBufferPayload(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(TEMPLATE_BUFFER_GZIP_PREFIX)) {
    return payload; // pre-compression payload: already plain JSON
  }
  const bytes = base64ToUint8(payload.slice(TEMPLATE_BUFFER_GZIP_PREFIX.length));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

const paintPixelsToCanvas = (pixels, width, height) => {
  let canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    cleanUpCanvas(canvas);
    canvas = null;
    throw new Error('Failed to initialize canvas for worker pixels.');
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
};


/** Manages the template system.
 * This class handles all external requests for template modification, creation, and analysis.
 * It serves as the central coordinator between template instances and the user interface.
 * @class TemplateManager
 * @since 0.55.8
 * @example
 * // JSON structure for a template
 * {
 *   "whoami": "BlueMarble",
 *   "scriptVersion": "1.13.0",
 *   "schemaVersion": "2.1.0",
 *   "templates": {
 *     "0 $Z": {
 *       "name": "My Template",
 *       "enabled": true,
 *       "tiles": {
 *         "1231,0047,183,593": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
 *         "1231,0048,183,000": "data:image/png;AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     },
 *     "1 $Z": {
 *       "name": "My Template",
 *       "URL": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Flag_of_Russia.svg/960px-Flag_of_Russia.svg.png",
 *       "URLType": "template",
 *       "enabled": false,
 *       "tiles": {
 *         "375,1846,276,188": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
 *         "376,1846,000,188": "data:image/png;AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     }
 *   }
 * }
 */
export default class TemplateManager {

  /** The constructor for the {@link TemplateManager} class.
   * @since 0.55.8
   */
  constructor(name, version, overlay) {

    // Meta
    this.name = name; // Name of userscript
    this.version = version; // Version of userscript
    this.overlay = overlay; // The main instance of the Overlay class
    this.templatesVersion = '1.0.0'; // Version of JSON schema
    this.userID = null; // The ID of the current user
    this.encodingBase = '!#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~'; // Characters to use for encoding/decoding
    this.tileSize = 1000; // The number of pixels in a tile. Assumes the tile is square

    this.drawMult = testCanvasSize(5000, 5000) ? 5 : 3; // The enlarged size for each pixel. E.g. when "3", a 1x1 pixel becomes a 1x1 pixel inside a 3x3 area. MUST BE ODD

    this.drawMultCenter = (this.drawMult - 1) >> 1; // Even: better be upper left than down right
    
    // Template
    this.canvasTemplate = null; // Our canvas
    this.canvasTemplateZoomed = null; // The template when zoomed out
    this.canvasTemplateID = 'bm-canvas'; // Our canvas ID
    this.canvasMainID = 'div#map canvas.maplibregl-canvas'; // The selector for the main canvas
    this.template = null; // The template image.
    // this.templateState = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
    /** @type {Template[]} */
    this.templatesArray = []; // All Template instnaces currently loaded (Template)
    this.templatesJSON = null; // All templates currently loaded (JSON)
    // this.templatesShouldBeDrawn = true; // Should ALL templates be drawn to the canvas?
    this.tileProgress = new Map(); // Tracks per-tile progress stats {painted, required, wrong}
    this._runningPalette = Object.create(null);  // colorKey -> {painted, paintedAndEnabled, missing}
    this._runningTemplate = Object.create(null); // storageKey -> {painted, palette: {colorKey: count}}
    this._runningExamples = Object.create(null); // colorKey -> {examplesEnabled, _exampleSeenCount} — kept in sync incrementally
    this._examplesColorDirty = new Set();        // colors whose examples need full rebuild (after tile removal)
    // this.tileOverlay = new Map(); // Cache tile overlay to save time
    this.extraColorsBitmap = 0; // List of unlocked colors, set by apiManager
    this.completedColorsBitmapLo = 0; // 0 ~ 31
    this.completedColorsBitmapHi = 0; // 32 ~ 63 List of completed colors, calculated when getOverallPerColorProgress is called
    this.userSettings = {}; // User settings
    this.hideLockedColors = false; 
    this.largestSeenSortID = 0; // Even a safer approach: recording the largest storage Keys that have been used in this session. Don't remove anything here.
    this.importPromise = Promise.resolve();
    this._visiblePrefixCache = null; // { key: string, result: Set }
    this._overlayRenderGeneration = 0;
    this._activeOverlayGenerationId = null;
    this._overlayRasterCache = new Map();
    this._livePixelsFetcher = null;
    // Freshest tile PNGs as the page itself received them, keyed "0000,0000". The overlay reads
    // erase pixels against these instead of re-requesting the tile URL, which the browser cache
    // and wplace's own service worker both answer with a stale copy.
    this._latestTileBlobs = new Map();
    // Bumped whenever any tile PNG arrives. Templates with erase pixels are rendered against live
    // canvas state, so this is the only thing that can tell their cached render apart.
    this._tileBlobEpoch = 0;
  }

  /** Retrieves the pixel art canvas.
   * If the canvas has been updated/replaced, it retrieves the new one.
   * @param {string} selector - The CSS selector to use to find the canvas.
   * @returns {HTMLCanvasElement|null} The canvas as an HTML Canvas Element, or null if the canvas does not exist
   * @since 0.58.3
   * @deprecated Not in use since 0.63.25
   */
  /* @__PURE__ */getCanvas() {

    // If the stored canvas is "fresh", return the stored canvas
    if (document.body.contains(this.canvasTemplate)) {return this.canvasTemplate;}
    // Else, the stored canvas is "stale", get the canvas again

    // Attempt to find and destroy the "stale" canvas
    document.getElementById(this.canvasTemplateID)?.remove(); 

    const canvasMain = document.querySelector(this.canvasMainID);

    const canvasTemplateNew = document.createElement('canvas');
    canvasTemplateNew.id = this.canvasTemplateID;
    canvasTemplateNew.className = 'maplibregl-canvas';
    canvasTemplateNew.style.position = 'absolute';
    canvasTemplateNew.style.top = '0';
    canvasTemplateNew.style.left = '0';
    canvasTemplateNew.style.height = `${canvasMain?.clientHeight * (window.devicePixelRatio || 1)}px`;
    canvasTemplateNew.style.width = `${canvasMain?.clientWidth * (window.devicePixelRatio || 1)}px`;
    canvasTemplateNew.height = canvasMain?.clientHeight * (window.devicePixelRatio || 1);
    canvasTemplateNew.width = canvasMain?.clientWidth * (window.devicePixelRatio || 1);
    canvasTemplateNew.style.zIndex = '8999';
    canvasTemplateNew.style.pointerEvents = 'none';
    canvasMain?.parentElement?.appendChild(canvasTemplateNew); // Append the newCanvas as a child of the parent of the main canvas
    this.canvasTemplate = canvasTemplateNew; // Store the new canvas

    window.addEventListener('move', this.onMove);
    window.addEventListener('zoom', this.onZoom);
    window.addEventListener('resize', this.onResize);

    return this.canvasTemplate; // Return the new canvas
  }

  /** Creates the JSON object to store templates in
   * @returns {{ whoami: string, scriptVersion: string, schemaVersion: string, templates: Object }} The JSON object
   * @since 0.65.4
   */
  async createJSON() {
    return {
      "whoami": "BlueMarble", // Use BlueMarble for template compatibility
      "scriptVersion": this.version, // Version of userscript
      "schemaVersion": this.templatesVersion, // Version of JSON schema
      "templates": {} // The templates
    };
  }

  /** Creates the template from the inputed file blob
   * @param {File | ImageBitmap | ImageData} file - The file blob to create a template from
   * @param {string} name - The display name of the template
   * @param {Array<number, number, number, number>} coords - The coordinates of the top left corner of the template
   * @since 0.65.77
   */
  async createTemplate(file, name, coords, options = {}) {
    const deferPersist = options?.deferPersist === true;
    const deferListRebuild = options?.deferListRebuild === true;
    const deferOverlayRefresh = options?.deferOverlayRefresh === true;
    const suppressStatus = options?.suppressStatus === true;

    // Creates the JSON object if it does not already exist
    if (!this.templatesJSON) {this.templatesJSON = await this.createJSON(); consoleLog(`Creating JSON...`);}

    if (!suppressStatus) {
      this.overlay.handleDisplayStatus(`Creating template at ${coords.join(', ')}...`);
    }

    // Creates a new template instance
    const authorID = numberToEncoded(this.userID || 0, this.encodingBase);
    const template = new Template({
      displayName: name,
      sortID: this.largestSeenSortID + 1, // Uncomment this to enable multiple templates (1/2)
      authorID: authorID,
      file: file,
      coords: coords,
      tileSize: this.tileSize,
      forcePaletteConversion: Boolean(options?.convertToPalette),
      paletteConversionOptions: options?.convertOptions || null,
      sampleNormalizeToPalette: Boolean(options?.normalizeSamplesToPalette ?? options?.remote),
    });
    const timeArchiveMeta = normalizeTimeArchiveMeta(options?.timeArchiveMeta);
    template.timeArchiveMeta = timeArchiveMeta;
    const preferBitmapTileStorage = options?.preferBitmapTileStorage === true || options?.remote === true;
    const createTileOptions = {
      persistBitmapTiles: options?.persistBitmapTiles ?? preferBitmapTileStorage,
      keepBitmapTilesInMemory: options?.keepBitmapTilesInMemory ?? false,
      persistChunkSamples: options?.persistChunkSamples ?? !preferBitmapTileStorage,
      keepChunkSamplesInMemory: options?.keepChunkSamplesInMemory ?? !preferBitmapTileStorage,
    };
    createTileOptions.lazyPersistChunkSamples = (
      createTileOptions.persistChunkSamples === true
      && createTileOptions.keepChunkSamplesInMemory === true
      && options?.lazyPersistChunkSamples !== false
    );
    this.largestSeenSortID++;
    template.shreadSize = this.drawMult; // Copy to template's shread Size
    //template.chunked = await template.createTemplateTiles(this.tileSize); // Chunks the tiles
    const {
      templateTiles,
      templateTilesBuffers,
      templateChunkSamples,
      templateChunkSampleBuffers,
      templateTileKeys,
    } = await template.createTemplateTiles(createTileOptions); // Chunks the tiles
    // Modify palette enabled status using the honored one
    const toggleStatus = this.getPaletteToggledStatus();
    for (const key of Object.keys(template.colorPalette)) {
      if (toggleStatus[key] !== undefined) {
        template.colorPalette[key].enabled = toggleStatus[key];
      }
    }
    const placeholderTileKeys = [...new Set([
      ...templateTileKeys,
      ...Object.keys(templateTiles),
      ...Object.keys(templateTilesBuffers),
      ...Object.keys(templateChunkSamples),
      ...Object.keys(templateChunkSampleBuffers),
    ])];
    if (this.isMemorySavingModeOn() || createTileOptions.keepBitmapTilesInMemory === false) {
      template.chunked = {};
      placeholderTileKeys.forEach((key) => {
        template.chunked[key] = null;
      });
      Object.values(templateTiles).forEach((value) => {
        value?.close?.();
      });
    } else {
      template.chunked = templateTiles; // Stores the chunked tile bitmaps
    }
    template.chunkedBuffer = templateTilesBuffers;
    template.chunkedSamples = createTileOptions.keepChunkSamplesInMemory === false ? {} : templateChunkSamples;
    // Not dropped when persistChunkSamples is off: createTemplateTiles still fills this for chunks
    // holding #deface pixels, whose flag cannot be recovered from a bitmap tile.
    template.chunkedSamplesBuffer = templateChunkSampleBuffers;
    template.persistBitmapTiles = createTileOptions.persistBitmapTiles === true;
    template.persistChunkSamples = createTileOptions.persistChunkSamples === true;
    const storedTileBuffers = createTileOptions.persistBitmapTiles ? templateTilesBuffers : {};

    // Appends a child into the templates object
    // The child's name is the number of templates already in the list (sort order) plus the encoded player ID
    const storageKey = `${template.sortID} ${template.authorID}`;
    template.storageKey = storageKey;
    const templateEnabled = options?.enabled ?? true;
    this.templatesJSON.templates[storageKey] = {
      "name": template.displayName, // Display name of template
      "coords": coords.join(', '), // The coords of the template
      "width": Number.isFinite(template.imageWidth) ? template.imageWidth : null,
      "height": Number.isFinite(template.imageHeight) ? template.imageHeight : null,
      "enabled": templateEnabled,
      "tiles": storedTileBuffers,
      "samples": createTileOptions.lazyPersistChunkSamples === true ? {} : templateChunkSampleBuffers,
      "tileKeys": templateTileKeys,
      "palette": template.colorPalette, // Persist palette and enabled flags
      // #deface pixels are counted apart from the palette, so nothing in "palette" implies them.
      // Without this the count is 0 for every template restored from storage, and the overlay
      // cannot tell which templates need their erase pixels checked against the live canvas.
      "deface": Math.max(0, Number(template.defacePixelCount) || 0),
      "shreadSize": template.shreadSize // Record shread size of the created template
    };
    if (timeArchiveMeta) {
      this.templatesJSON.templates[storageKey].timeArchiveMeta = timeArchiveMeta;
    }
    template.enabled = templateEnabled;
    if (options?.remote) {
      template.isRemote = true;
      template.remoteName = options.remoteName || template.displayName;
      template.remoteManual = options.remoteManual === true;
      template.remoteStream = normalizeTemplateSyncStreamValue(options.remoteStream);
      template.remoteUpdatedAt = options.remoteUpdatedAt || null;
      template.remoteImageUpdatedAt = options.remoteImageUpdatedAt || null;
      template.remoteFlagsCheckedAt = options.remoteFlagsCheckedAt || null;
      template.remoteFlagsCheckedAtLocal = options.remoteFlagsCheckedAtLocal || null;
      template.remoteCoords = Array.isArray(options.remoteCoords)
        ? options.remoteCoords.map(Number)
        : null;
      template.remoteToTop = normalizeFlagValue(options.remoteToTop);
      template.remoteToTopAt = options.remoteToTopAt || null;
      template.remoteHighlighted = normalizeFlagValue(options.remoteHighlighted);
      template.remoteHighlightedAt = options.remoteHighlightedAt || null;
      template.remoteOrder = Number.isFinite(options.remoteOrder) ? options.remoteOrder : null;
      this.templatesJSON.templates[storageKey].remote = true;
      this.templatesJSON.templates[storageKey].remoteName = template.remoteName;
      this.templatesJSON.templates[storageKey].remoteManual = template.remoteManual;
      this.templatesJSON.templates[storageKey].remoteStream = template.remoteStream;
      this.templatesJSON.templates[storageKey].remoteUpdatedAt = template.remoteUpdatedAt;
      this.templatesJSON.templates[storageKey].remoteImageUpdatedAt = template.remoteImageUpdatedAt;
      this.templatesJSON.templates[storageKey].remoteFlagsCheckedAt = template.remoteFlagsCheckedAt;
      this.templatesJSON.templates[storageKey].remoteFlagsCheckedAtLocal = template.remoteFlagsCheckedAtLocal;
      this.templatesJSON.templates[storageKey].remoteCoords = template.remoteCoords;
      this.templatesJSON.templates[storageKey].remoteToTop = template.remoteToTop;
      this.templatesJSON.templates[storageKey].remoteToTopAt = template.remoteToTopAt;
      this.templatesJSON.templates[storageKey].remoteHighlighted = template.remoteHighlighted;
      this.templatesJSON.templates[storageKey].remoteHighlightedAt = template.remoteHighlightedAt;
      this.templatesJSON.templates[storageKey].remoteOrder = template.remoteOrder;
    }

    // this.templatesArray = []; // Remove this to enable multiple templates (2/2)
    this.templatesArray.push(template); // Pushes the Template object instance to the Template Array

    // reset related tiles
    this.clearTileProgress(template);

    // ==================== PIXEL COUNT DISPLAY SYSTEM ====================
    // Display pixel count statistics with internationalized number formatting
    // This provides immediate feedback to users about template complexity and size
    const pixelCountFormatted = _numberFormat.format(template.pixelCount);
    if (!suppressStatus) {
      this.overlay.handleDisplayStatus(`Template created at ${coords.join(', ')}! Total pixels: ${pixelCountFormatted}`);
    }

    if (!deferPersist) {
      await this.storeTemplates();
    }
    if (!deferListRebuild) {
      this.requestListRebuild();
    }
    if (!deferOverlayRefresh) {
      if (!suppressStatus) {
        this.overlay.handleDisplayStatus(`Template created. Rendering visible crosses for "${template.displayName}"...`);
      }
      this.queueOverlayRefreshAfterUi(template.sortID, {
        visibleFirst: true,
        followUpFull: true,
        immediate: true,
      });
    }
    return template;
  }

  requestListRebuild() {
    try {
      // const colorUI = document.querySelector('#bm-contain-colorfilter');
      // if (colorUI) { colorUI.style.display = ''; }
      // Deferred palette list rendering; actual DOM is built in main via helper
      window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-color-list' }, '*');
    } catch (_) { /* no-op */ }
    try {
      // const templateUI = document.querySelector('#bm-contain-templatefilter');
      // if (templateUI) { templateUI.style.display = ''; }
      // Deferred palette list rendering; actual DOM is built in main via helper
      window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*');
    } catch (_) { /* no-op */ }
  }

  /** Generates a {@link Template} class instance from the JSON object template
   */
  #loadTemplate() {

  }

  /** Stores the JSON object of the loaded templates into TamperMonkey (GreaseMonkey) storage.
   * @since 0.72.7
   */
  async storeTemplates(options = {}) {
    // An explicit write supersedes any queued debounced one.
    if (this._storeTemplatesTimer) {
      clearTimeout(this._storeTemplatesTimer);
      this._storeTemplatesTimer = null;
    }
    this._storeTemplatesPending = false;

    // Buffers live in their own per-template keys and only get rewritten when their contents
    // actually changed, so a metadata-only save (an enabled flip, a palette toggle) never touches
    // them. See _persistTemplateBuffers for how "changed" is decided.
    await this._persistChangedTemplateBuffers(options);

    const data = this.getPersistableTemplatesJSON();
    // Metadata only — no Uint8Arrays reach this — so stringify on the main thread is cheap and
    // avoids the structured-clone round trip to a worker.
    await GM.setValue('bmTemplates', JSON.stringify(data, templateJsonReplacer));
  }

  /** Storage key holding one template's tile/sample buffers.
   * With no part index this is the manifest key; with one it is a payload slice.
   */
  _getTemplateBuffersStorageKey(storageKey, part = null) {
    const base = `bmTemplateBuffers:${storageKey}`;
    return part === null ? base : `${base}:${part}`;
  }

  /** Reads a buffer manifest, tolerating both the chunked and pre-chunking layouts.
   * @returns {Promise<{parts:number}|object|null>}
   */
  async _readTemplateBufferManifest(storageKey) {
    const raw = await readTemplateStorageValue(this._getTemplateBuffersStorageKey(storageKey), '');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  /** Measures how much GM storage each template's buffers occupy.
   * Diagnostic for "Message exceeded maximum allowed size of 64MiB": Tampermonkey moves storage
   * over Chrome's extension messaging channel. Reports per-template and total bytes, flags any
   * slice that fails to read back, and reports the compressed-vs-raw split.
   * @returns {Promise<object>}
   * @since 0.87.79
   */
  async reportStorageUsage() {
    const rows = [];
    let total = 0;
    const storageKeys = Object.keys(this.templatesJSON?.templates || {});
    for (const storageKey of storageKeys) {
      const manifest = await this._readTemplateBufferManifest(storageKey).catch(() => null);
      const parts = Number.isFinite(manifest?.parts) ? manifest.parts : (manifest ? 1 : 0);
      let bytes = 0;
      let compressed = false;
      const failedParts = [];
      for (let index = 0; index < parts; index++) {
        const key = Number.isFinite(manifest?.parts)
          ? this._getTemplateBuffersStorageKey(storageKey, index)
          : this._getTemplateBuffersStorageKey(storageKey);
        try {
          const slice = await readTemplateStorageValue(key, '');
          if (!slice) { failedParts.push(index); continue; }
          if (index === 0 && slice.startsWith(TEMPLATE_BUFFER_GZIP_PREFIX)) compressed = true;
          bytes += slice.length; // base64 payload: characters ~= bytes
        } catch (_) {
          failedParts.push(index);
        }
      }
      total += bytes;
      rows.push({
        name: this.templatesJSON?.templates?.[storageKey]?.name ?? storageKey,
        storageKey,
        parts,
        bytes,
        MiB: (bytes / 1048576).toFixed(2),
        compressed,
        failedParts,
      });
    }

    const metadata = JSON.stringify(this.getPersistableTemplatesJSON(), templateJsonReplacer).length;
    total += metadata;
    rows.sort((a, b) => b.bytes - a.bytes);

    // IndexedDB bytes are reported separately: they do NOT cross the extension messaging
    // channel, so they never count toward the 64MiB ceiling that breaks startup. Only the GM
    // total above does.
    let indexedDb = { available: canUseTemplateBufferDb(), templates: [], totalBytes: 0 };
    if (canUseTemplateBufferDb()) {
      try {
        const idbRows = await reportTemplateBufferBytes();
        let idbTotal = 0;
        for (const row of idbRows) idbTotal += row.bytes;
        indexedDb = {
          available: true,
          // `persisted: false` on mobile means these buffers can be evicted by the browser.
          quota: await estimateStorageQuota(),
          totalBytes: idbTotal,
          totalMiB: (idbTotal / 1048576).toFixed(2),
          templates: idbRows
            .map((row) => ({
              ...row,
              name: this.templatesJSON?.templates?.[row.storageKey]?.name ?? row.storageKey,
              MiB: (row.bytes / 1048576).toFixed(2),
            }))
            .sort((a, b) => b.bytes - a.bytes),
        };
      } catch (error) {
        indexedDb = { available: true, error: error?.message || String(error), templates: [], totalBytes: 0 };
      }
    }

    return {
      gmStorageTotal: total,
      gmStorageTotalMiB: (total / 1048576).toFixed(2),
      metadataBytes: metadata,
      metadataMiB: (metadata / 1048576).toFixed(2),
      // Only GM storage rides the capped channel.
      overChromeLimit: total > 64 * 1048576,
      legacyGmBuffersRemaining: rows.filter((row) => row.bytes > 0).length,
      compressionAvailable: canCompressTemplateBuffers(),
      indexedDb,
      templates: rows,
    };
  }

  /** Deletes buffer keys that no live template refers to.
   * The read guard keeps an oversized legacy key from stranding boot, but the key itself stays in
   * storage and keeps failing on every load. This is the cleanup: it enumerates every
   * `bmTemplateBuffers:*` key, keeps only those belonging to a template still present in
   * `templatesJSON` (and within that template's declared part count), and deletes the rest.
   * Reachable from the page console as `RusMarble.purgeStorage()`.
   * @returns {Promise<{deleted:string[], kept:number, unavailable?:boolean}>}
   * @since 0.87.80
   */
  async purgeOrphanTemplateBuffers() {
    if (typeof GM.listValues !== 'function' || typeof GM.deleteValue !== 'function') {
      return { deleted: [], kept: 0, unavailable: true };
    }
    const keys = await GM.listValues().catch(() => []);
    const live = new Set();
    for (const storageKey of Object.keys(this.templatesJSON?.templates || {})) {
      const manifestKey = this._getTemplateBuffersStorageKey(storageKey);
      live.add(manifestKey);
      // The manifest read is guarded, so a hostile key here degrades to "no parts" rather than
      // hanging; its slices then look orphaned and get swept, which is the desired outcome.
      const manifest = await this._readTemplateBufferManifest(storageKey).catch(() => null);
      const parts = Number.isFinite(manifest?.parts) ? manifest.parts : 0;
      for (let index = 0; index < parts; index++) {
        live.add(this._getTemplateBuffersStorageKey(storageKey, index));
      }
    }
    const deleted = [];
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith('bmTemplateBuffers:')) continue;
      if (live.has(key)) continue;
      try {
        await GM.deleteValue(key);
        deleted.push(key);
      } catch (_) {}
    }

    // Sweep IndexedDB records whose template no longer exists.
    const deletedFromDb = [];
    if (canUseTemplateBufferDb()) {
      const liveTemplates = new Set(Object.keys(this.templatesJSON?.templates || {}));
      try {
        for (const storageKey of await listTemplateBufferKeys()) {
          if (liveTemplates.has(storageKey)) continue;
          try {
            await deleteTemplateBuffers(storageKey);
            deletedFromDb.push(storageKey);
          } catch (_) {}
        }
      } catch (_) {}
    }

    return {
      deleted,
      deletedFromIndexedDb: deletedFromDb,
      kept: live.size,
      readFailures: [...templateBufferReadFailures],
    };
  }

  /** Removes a template's legacy GM-storage buffer manifest and every payload slice it refers to.
   * Buffers now live in IndexedDB; this only cleans up what the GM-storage era left behind.
   */
  async _deleteLegacyTemplateBufferKeys(storageKey, knownParts = null) {
    if (typeof GM.deleteValue !== 'function') return;
    let parts = knownParts;
    if (parts === null) {
      const manifest = await this._readTemplateBufferManifest(storageKey).catch(() => null);
      parts = Number.isFinite(manifest?.parts) ? manifest.parts : 0;
    }
    for (let index = 0; index < parts; index++) {
      try { await GM.deleteValue(this._getTemplateBuffersStorageKey(storageKey, index)); } catch (_) {}
    }
    try { await GM.deleteValue(this._getTemplateBuffersStorageKey(storageKey)); } catch (_) {}
  }

  /** Removes a template's buffers from both stores. */
  async _deleteTemplateBufferKeys(storageKey, knownParts = null) {
    if (canUseTemplateBufferDb()) {
      try { await deleteTemplateBuffers(storageKey); } catch (_) {}
    }
    await this._deleteLegacyTemplateBufferKeys(storageKey, knownParts);
  }

  /** A cheap stand-in for the buffer payload's identity: which chunks exist and how big each is.
   * Comparing this is O(tiles); comparing the actual bytes would be O(megabytes). It catches
   * every way the buffers can change in practice — new template, re-import, repositioning
   * (which rekeys the chunks), and lazily-added sample buffers.
   */
  _getTemplateBufferFingerprint(template) {
    const sizeOf = (value) => {
      if (!value) return 0;
      if (value instanceof Uint8Array) return value.length;
      if (typeof value === 'string') return value.length;
      return 0;
    };
    const tileKeys = (template.getChunkKeys?.() ?? []).slice().sort();
    const parts = [];
    for (const tileKey of tileKeys) {
      parts.push(`${tileKey}:${sizeOf(template.chunkedBuffer?.[tileKey])}:${sizeOf(template.chunkedSamplesBuffer?.[tileKey])}`);
    }
    return parts.join('|');
  }

  /** Writes the buffer blob for every template whose buffers changed since the last write. */
  async _persistChangedTemplateBuffers(options = {}) {
    const teardown = options?.teardown === true;
    if (!this._persistedBufferFingerprints) this._persistedBufferFingerprints = new Map();
    for (const template of (this.templatesArray || [])) {
      const storageKey = template?.storageKey;
      if (!storageKey) continue;
      const fingerprint = this._getTemplateBufferFingerprint(template);
      if (this._persistedBufferFingerprints.get(storageKey) === fingerprint) continue;

      const tileKeys = template.getChunkKeys?.() ?? [];
      const payload = {
        tiles: template.getPersistableChunkBuffers?.(tileKeys) ?? {},
        samples: template.getPersistableChunkSampleBuffers?.(tileKeys) ?? {},
      };

      // IndexedDB structured-clones the Uint8Arrays straight through: no base64, no
      // JSON.stringify, no gzip, no chunking, and no worker round trip. That is why this path is
      // both smaller on disk and fast enough to run inline during a teardown flush.
      if (canUseTemplateBufferDb()) {
        try {
          await writeTemplateBuffers(storageKey, payload);
          // Retire whatever the GM-storage era left behind for this template, so the two copies
          // cannot both count against storage.
          await this._deleteLegacyTemplateBufferKeys(storageKey);
          this._persistedBufferFingerprints.set(storageKey, fingerprint);
          continue;
        } catch (error) {
          consoleWarn('IndexedDB write failed; falling back to GM storage.', error);
        }
      }

      // Fallback only: IndexedDB unavailable (or the write failed). This is the old GM-storage
      // path, kept intact — it still carries the 64MiB aggregate risk, hence the fallback status.
      let json;
      let alreadyCompressed = false;
      if (templateWorkerManager.canUseWorkers()) {
        const result = await templateWorkerManager
          .runTask('serializeJson', { data: payload, compress: !teardown })
          .catch(() => null);
        if (result?.json) {
          json = result.json;
          alreadyCompressed = result.compressed === true;
        } else {
          json = JSON.stringify(payload, templateJsonReplacer);
        }
      } else {
        json = JSON.stringify(payload, templateJsonReplacer);
      }
      const previousParts = Number.isFinite(this._persistedBufferParts?.get(storageKey))
        ? this._persistedBufferParts.get(storageKey)
        : (Number((await this._readTemplateBufferManifest(storageKey).catch(() => null))?.parts) || 0);
      const storedPayload = (teardown || alreadyCompressed)
        ? json
        : ((await compressTemplateBufferPayload(json)) ?? json);

      const partCount = Math.max(1, Math.ceil(storedPayload.length / TEMPLATE_BUFFER_CHUNK_CHARS));
      for (let index = 0; index < partCount; index++) {
        const slice = storedPayload.slice(index * TEMPLATE_BUFFER_CHUNK_CHARS, (index + 1) * TEMPLATE_BUFFER_CHUNK_CHARS);
        await GM.setValue(this._getTemplateBuffersStorageKey(storageKey, index), slice);
      }
      await GM.setValue(this._getTemplateBuffersStorageKey(storageKey), JSON.stringify({ parts: partCount }));
      for (let index = partCount; index < previousParts; index++) {
        try { await GM.deleteValue?.(this._getTemplateBuffersStorageKey(storageKey, index)); } catch (_) {}
      }
      if (!this._persistedBufferParts) this._persistedBufferParts = new Map();
      this._persistedBufferParts.set(storageKey, partCount);
      this._persistedBufferFingerprints.set(storageKey, fingerprint);
    }
  }

  /** Loads a template's buffers, preferring IndexedDB and migrating legacy GM-storage data.
   * Templates saved before the IndexedDB move still live in GM keys; the first successful read
   * of one copies it across and deletes the originals, which is what actually drains the
   * oversized GM storage that broke script startup.
   * Returns null when absent.
   */
  async _loadTemplateBuffers(storageKey) {
    if (canUseTemplateBufferDb()) {
      try {
        const stored = await readTemplateBuffers(storageKey);
        if (stored && (Object.keys(stored.tiles).length || Object.keys(stored.samples).length)) {
          return stored;
        }
      } catch (error) {
        consoleWarn('IndexedDB read failed; falling back to GM storage.', error);
      }
    }
    const legacy = await this._loadLegacyTemplateBuffers(storageKey);
    if (legacy && canUseTemplateBufferDb()) {
      try {
        await writeTemplateBuffers(storageKey, legacy);
        await this._deleteLegacyTemplateBufferKeys(storageKey);
        consoleLog(`Migrated template buffers to IndexedDB: ${storageKey}`);
      } catch (error) {
        consoleWarn('Failed to migrate template buffers to IndexedDB.', error);
      }
    }
    return legacy;
  }

  /** The pre-IndexedDB reader: chunked (or single-blob) base64 payloads in GM storage. */
  async _loadLegacyTemplateBuffers(storageKey) {
    try {
      const manifest = await this._readTemplateBufferManifest(storageKey);
      if (!manifest || typeof manifest !== 'object') return null;

      let parsed;
      if (Number.isFinite(manifest.parts)) {
        const slices = [];
        for (let index = 0; index < manifest.parts; index++) {
          const slice = await readTemplateStorageValue(this._getTemplateBuffersStorageKey(storageKey, index), '');
          if (!slice) return null; // incomplete payload — treat as absent rather than corrupt
          slices.push(slice);
        }
        // Payloads written before compression existed are plain JSON; the prefix check inside
        // decompressTemplateBufferPayload passes those through unchanged.
        parsed = JSON.parse(await decompressTemplateBufferPayload(slices.join('')));
        if (!this._persistedBufferParts) this._persistedBufferParts = new Map();
        this._persistedBufferParts.set(storageKey, manifest.parts);
      } else {
        // Pre-chunking layout: the manifest key held the whole payload.
        parsed = manifest;
      }

      if (!parsed || typeof parsed !== 'object') return null;
      return {
        tiles: (parsed.tiles && typeof parsed.tiles === 'object') ? parsed.tiles : {},
        samples: (parsed.samples && typeof parsed.samples === 'object') ? parsed.samples : {},
      };
    } catch (_) {
      return null;
    }
  }

  /** Coalescing wrapper around {@link storeTemplates}.
   * Persisting re-serializes every template's tile/sample buffers (megabytes of base64), so
   * calling it straight from a UI handler stalls the click. Cheap metadata flips (enabled flag,
   * palette toggles) should use this instead: the in-memory JSON is already updated, and the
   * expensive write is deferred and collapsed across bursts of toggles.
   * @param {number} delayMs
   */
  storeTemplatesDebounced(delayMs = 800) {
    if (this._storeTemplatesTimer) clearTimeout(this._storeTemplatesTimer);
    this._storeTemplatesPending = true;
    if (!this._storeTemplatesFlushHooked) {
      this._storeTemplatesFlushHooked = true;
      const flush = () => { this.flushStoreTemplates(); };
      window.addEventListener('pagehide', flush);
      window.addEventListener('beforeunload', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    }
    this._storeTemplatesTimer = setTimeout(() => {
      this._storeTemplatesTimer = null;
      this._storeTemplatesPending = false;
      this.storeTemplates().catch(() => {});
    }, delayMs);
  }

  /** Immediately performs any pending debounced persist. */
  flushStoreTemplates() {
    if (this._storeTemplatesTimer) {
      clearTimeout(this._storeTemplatesTimer);
      this._storeTemplatesTimer = null;
    }
    if (!this._storeTemplatesPending) return Promise.resolve();
    this._storeTemplatesPending = false;
    // Teardown: skip compression so the write can land synchronously enough to survive unload.
    return this.storeTemplates({ teardown: true }).catch(() => {});
  }

  getPersistableTemplatesJSON() {
    const source = this.templatesJSON || {
      whoami: 'BlueMarble',
      scriptVersion: this.version,
      schemaVersion: this.templatesVersion,
      templates: {},
    };
    const templates = {};
    for (const [storageKey, templateStore] of Object.entries(source.templates || {})) {
      templates[storageKey] = { ...templateStore };
    }
    const templateByKey = new Map(
      (this.templatesArray || [])
        .filter((template) => template?.storageKey)
        .map((template) => [template.storageKey, template])
    );
    for (const [storageKey, templateStore] of Object.entries(templates)) {
      const template = templateByKey.get(storageKey);
      if (!template) continue;
      templateStore.tileKeys = template.getChunkKeys?.() ?? templateStore.tileKeys ?? [];
      // Buffers are persisted separately by _persistChangedTemplateBuffers. Dropping them here is
      // what makes a metadata save cost kilobytes instead of megabytes.
      delete templateStore.tiles;
      delete templateStore.samples;
    }
    return {
      ...source,
      templates,
    };
  }

  /** Deletes a template from the JSON object.
   * Also delete's the corrosponding {@link Template} class instance
   */
  async deleteTemplate(storageKey, options = {}) {
    const deferPersist = options?.deferPersist === true;
    const deferListRebuild = options?.deferListRebuild === true;
    const suppressStatus = options?.suppressStatus === true;
    // Delete the template class instance
    const targetTemplate = this.templatesArray.find(template => template.storageKey === storageKey);
    if (targetTemplate === undefined) return;
    const removeIndex = this.templatesArray.indexOf(targetTemplate);
    this.templatesArray.splice(removeIndex, 1);

    // Delete the JSON Entry
    const templates = this.templatesJSON?.templates;
    if (templates && templates?.[storageKey]) {
      delete templates[storageKey];
    }

    // Drop the template's separate buffer blob, otherwise it lingers in storage forever.
    const knownParts = this._persistedBufferParts?.get(storageKey) ?? null;
    this._persistedBufferFingerprints?.delete(storageKey);
    this._persistedBufferParts?.delete(storageKey);
    try {
      await this._deleteTemplateBufferKeys(storageKey, knownParts);
    } catch (_) {}

    // reset related tiles
    this.clearTileProgress(targetTemplate);
    removeLayer(null, targetTemplate.sortID);

    if (!suppressStatus) {
      this.overlay.handleDisplayStatus(`Template ${targetTemplate.displayName} is deleted!`);
    }
  
    if (!deferPersist) {
      await this.storeTemplates();
    }
    if (!deferListRebuild) {
      this.requestListRebuild();
    }
  }

  /** Disables the template from view
   */
  async disableTemplate() {

    // Creates the JSON object if it does not already exist
    if (!this.templatesJSON) {this.templatesJSON = await this.createJSON(); consoleLog(`Creating JSON...`);}
  }

  /** Draws all templates on the specified tile.
   * This method handles the rendering of template overlays on individual tiles.
   * @param {File} tileBlob - The pixels that are placed on a tile
   * @param {Array<number>} tileCoords - The tile coordinates [x, y]
   * @since 0.65.77
   */
  async countTemplateStatus(tileBlob, tileCoords, options = null) {
    void options;
    const yieldUi = createUiWorkScheduler();

    const tileCoordsPadded = tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0');

    const involvedTemplates = this.getInvolvedTemplates(tileCoords);
    if (involvedTemplates.length === 0) return;

    const currentMemorySavingMode = this.isMemorySavingModeOn();
    const templatesTilesToHandle = involvedTemplates.flatMap((template) => {
      const matchingTiles = this._getTileKeysByPrefixMap(template).get(tileCoordsPadded) ?? [];
      if (!matchingTiles.length) return [];
      if (matchingTiles.length > 1) {
        consoleLog(
          '[TemplateProgress] Multiple chunks matched same tile prefix; processing all chunks.',
          {
            tilePrefix: tileCoordsPadded,
            template: template?.displayName,
            storageKey: template?.storageKey,
            chunkCount: matchingTiles.length,
            chunkKeys: matchingTiles,
          }
        );
      }
      return matchingTiles.map((tileKey) => {
        const coords = tileKey.split(',');
        return {
          template,
          tileKey,
          tileCoords: [+coords[0], +coords[1]],
          pixelCoords: [+coords[2], +coords[3]],
        };
      });
    });

    const templateCount = templatesTilesToHandle?.length || 0;
    const enabledTemplateCount = this.templatesArray.filter((template) => template.enabled).length;
    const errorMapOnlyEnabledColors = this.isErrorMapShown() && this.isErrorMapOnlyEnabledColorsShown();
    const displayedColorList = errorMapOnlyEnabledColors ? this.getDisplayedColorsSorted() : null;
    const displayedColors = displayedColorList ? new Set(displayedColorList) : null;

    let paintedCount = 0;
    let wrongCount = 0;
    let requiredCount = 0;
    let paletteStats = {};
    let templateStats = {};

    const isErrorMapShown = this.isErrorMapShown();
    const tileSize = this.tileSize;
    const exampleMax = this.getTemplateExampleLimit();

    // ── Fast path: hand the encoded tile to a worker and stay off the main thread entirely ──
    // The main thread never decodes the PNG, never allocates the 1MB pixel buffer, and never
    // copies it per template. All chunks landing on this tile are counted in one call.
    if (templateWorkerManager.canUseWorkers()) {
      const batched = await this._countTemplateStatusInWorker({
        tileBlob, tileCoords, tileSize, templatesTilesToHandle,
        isErrorMapShown, exampleMax, errorMapOnlyEnabledColors, displayedColorList,
        currentMemorySavingMode,
      }).catch((exception) => {
        console.warn('Worker tile progress scan failed; falling back to main thread:', exception);
        return null;
      });
      if (batched) {
        this._finishTileProgress(tileCoordsPadded, templateCount, batched, enabledTemplateCount);
        return tileBlob;
      }
    }

    // ── Fallback: decode and scan on the main thread (no worker support, or the worker failed) ──
    const tileBitmap = await createBitmapPreservingPixels(tileBlob);

    let canvas = new OffscreenCanvas(tileSize, tileSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.beginPath();
    context.rect(0, 0, tileSize, tileSize);
    context.clip();
    context.clearRect(0, 0, tileSize, tileSize);
    context.drawImage(tileBitmap, 0, 0, tileSize, tileSize);
    tileBitmap.close();
    const tilePixels = context.getImageData(0, 0, tileSize, tileSize).data;

    for (const templateTile of templatesTilesToHandle) {
      await yieldUi();
      const template = templateTile.template;
      const templateKey = template.storageKey;
      const sampleData = await template.getChunkSamples(templateTile.tileKey, {
        memorySaving: currentMemorySavingMode,
      });
      if (!sampleData) {
        continue;
      }

      const errorWidth = Math.max(0, Math.trunc(Number(sampleData.width) || 0));
      const errorHeight = Math.max(0, Math.trunc(Number(sampleData.height) || 0));
      let errorCanvas = null;
      let errorContext = null;
      let errorImage = null;
      let errorData = null;

      const templateTileEnabled = template.enabled ?? true;
      if (isErrorMapShown && templateTileEnabled) {
        errorCanvas = new OffscreenCanvas(errorWidth, errorHeight);
        errorContext = errorCanvas.getContext('2d', { willReadFrequently: true });
        // Use a zero-filled buffer rather than getImageData — in anti-fingerprinting
        // browsers (Brave) getImageData adds noise to alpha=0 background pixels,
        // which makes them visibly colored on the map.
        errorData = new Uint8ClampedArray(errorWidth * errorHeight * 4);
      }

      const offsetXResult = templateTile.pixelCoords[0];
      const offsetYResult = templateTile.pixelCoords[1];

      try {
        const encodedSampleBytes = sampleData ? encodeChunkSampleBytes(sampleData) : null;
        const workerTilePixels = tilePixels.slice();
        const workerResult = encodedSampleBytes
          ? await templateWorkerManager.runTask('scanTileProgress', {
            sampleData: encodedSampleBytes,
            tilePixels: workerTilePixels,
            tileSize,
            offsetX: offsetXResult,
            offsetY: offsetYResult,
            tileCoords,
            templateEnabled: templateTileEnabled,
            templateKey,
            exampleMax,
            errorMapOnlyEnabledColors,
            displayedColors: displayedColorList,
            includeErrorMap: isErrorMapShown && templateTileEnabled,
            errorWidth,
            errorHeight,
          }, {
            transferList: [
              encodedSampleBytes.buffer,
              workerTilePixels.buffer,
            ],
          }).catch(() => null) // degrade to the main-thread scan below rather than losing the tile
          : null;

        if (workerResult) {
          paintedCount += workerResult.paintedCount || 0;
          wrongCount += workerResult.wrongCount || 0;
          requiredCount += workerResult.requiredCount || 0;
          mergeSerializedPaletteProgress(paletteStats, workerResult.paletteStats, exampleMax);
          mergeSerializedTemplateProgress(templateStats, workerResult.templateStats);

          if (
            isErrorMapShown
            && templateTileEnabled
            && workerResult.errorData instanceof Uint8ClampedArray
          ) {
            errorImage = new ImageData(workerResult.errorData, errorWidth, errorHeight);
            errorContext.putImageData(errorImage, 0, 0);
            addTemplateCanvas(template.sortID, templateTile.tileKey, [errorWidth, errorHeight], errorCanvas, "error");
            cleanUpCanvas(errorCanvas);
            errorCanvas = null;
          }
        } else {
          const progress = collectTemplateProgressFromSamples({
            sampleData,
            tilePixels,
            tileSize,
            offsetX: offsetXResult,
            offsetY: offsetYResult,
            tileCoords,
            templateEnabled: templateTileEnabled,
            templateKey,
            paletteStats,
            templateStats,
            exampleMax,
            errorMapOnlyEnabledColors,
            displayedColors,
            errorData: isErrorMapShown && templateTileEnabled ? errorData : null,
            errorWidth,
          });
          paintedCount += progress.paintedCount;
          wrongCount += progress.wrongCount;
          requiredCount += progress.requiredCount;

          if (isErrorMapShown && templateTileEnabled) {
            errorContext.putImageData(new ImageData(errorData, errorWidth, errorHeight), 0, 0);
            addTemplateCanvas(template.sortID, templateTile.tileKey, [errorWidth, errorHeight], errorCanvas, "error");
            cleanUpCanvas(errorCanvas);
            errorCanvas = null;
          }
        }
      } catch (exception) {
        console.warn('Failed to compute per-tile painted/wrong stats:', exception);
      }
    }

    cleanUpCanvas(canvas);

    this._finishTileProgress(
      tileCoordsPadded,
      templateCount,
      { paintedCount, wrongCount, requiredCount, paletteStats, templateStats },
      enabledTemplateCount
    );

    return tileBlob;
  }

  /** Counts every template chunk on one map tile in a single worker call.
   * The encoded tile is transferred rather than decoded here, so the main thread does no image
   * decoding, no getImageData readback, and no per-template pixel copies.
   * @returns {Promise<object|null>} accumulated stats, or null if there was nothing to scan
   * @since 0.87.71
   */
  async _countTemplateStatusInWorker({
    tileBlob, tileCoords, tileSize, templatesTilesToHandle,
    isErrorMapShown, exampleMax, errorMapOnlyEnabledColors, displayedColorList,
    currentMemorySavingMode,
  }) {
    const entries = [];
    const transferList = [];

    for (const templateTile of templatesTilesToHandle) {
      const template = templateTile.template;
      const sampleData = await template.getChunkSamples(templateTile.tileKey, {
        memorySaving: currentMemorySavingMode,
      });
      if (!sampleData) continue;
      const sampleBytes = encodeChunkSampleBytes(sampleData);
      if (!sampleBytes) continue;

      const templateTileEnabled = template.enabled ?? true;
      entries.push({
        sampleData: sampleBytes,
        tileKey: templateTile.tileKey,
        sortID: template.sortID,
        templateKey: template.storageKey,
        templateEnabled: templateTileEnabled,
        offsetX: templateTile.pixelCoords[0],
        offsetY: templateTile.pixelCoords[1],
        includeErrorMap: isErrorMapShown && templateTileEnabled,
        errorWidth: Math.max(0, Math.trunc(Number(sampleData.width) || 0)),
        errorHeight: Math.max(0, Math.trunc(Number(sampleData.height) || 0)),
      });
      transferList.push(sampleBytes.buffer);
    }

    if (!entries.length) return null;

    const tileBytes = new Uint8Array(await tileBlob.arrayBuffer());
    transferList.push(tileBytes.buffer);

    const result = await templateWorkerManager.runTask('scanTileProgressBatch', {
      tileBytes,
      tileSize,
      tileCoords,
      entries,
      exampleMax,
      errorMapOnlyEnabledColors,
      displayedColors: displayedColorList,
    }, { transferList });

    if (!result) return null;

    // The error map is an optional debug overlay; painting it is the only main-thread pixel work
    // left, and only when the user has it turned on.
    for (const errorMap of (result.errorMaps || [])) {
      if (!(errorMap?.errorData instanceof Uint8ClampedArray)) continue;
      if (!(errorMap.errorWidth > 0 && errorMap.errorHeight > 0)) continue;
      const errorCanvas = new OffscreenCanvas(errorMap.errorWidth, errorMap.errorHeight);
      const errorContext = errorCanvas.getContext('2d');
      errorContext.putImageData(new ImageData(errorMap.errorData, errorMap.errorWidth, errorMap.errorHeight), 0, 0);
      addTemplateCanvas(errorMap.sortID, errorMap.tileKey, [errorMap.errorWidth, errorMap.errorHeight], errorCanvas, "error");
      cleanUpCanvas(errorCanvas);
    }

    return {
      paintedCount: result.paintedCount || 0,
      wrongCount: result.wrongCount || 0,
      requiredCount: result.requiredCount || 0,
      paletteStats: result.paletteStats || {},
      templateStats: result.templateStats || {},
    };
  }

  /** Records a tile's counted stats and refreshes the status line / progress UI.
   * Shared by the worker and main-thread counting paths.
   */
  _finishTileProgress(tileCoordsPadded, templateCount, stats, enabledTemplateCount) {
    if (templateCount === 0) {
      if (this.tileProgress.has(tileCoordsPadded)) {
        this._deleteTileProgress(tileCoordsPadded);
      }
    } else {
      this._setTileProgress(tileCoordsPadded, {
        painted: stats.paintedCount,
        required: stats.requiredCount,
        wrong: stats.wrongCount,
        palette: stats.paletteStats,
        template: stats.templateStats,
      });
    }

    // Use running totals — O(templates) instead of O(tiles × templates).
    let aggPainted = 0;
    for (const template of (this.templatesArray ?? [])) {
      if (!template.enabled) continue;
      aggPainted += this._runningTemplate[template.storageKey]?.painted || 0;
    }

    const totalRequired = this.templatesArray.reduce((sum, template) =>
      sum + (template.enabled ? (template.requiredPixelCount || template.pixelCount || 0) : 0), 0);

    const paintedStr = _numberFormat.format(aggPainted);
    const requiredStr = _numberFormat.format(totalRequired);
    const wrongStr = _numberFormat.format(totalRequired - aggPainted);

    this.overlay.handleDisplayStatus(
      `Displaying ${enabledTemplateCount} template${enabledTemplateCount == 1 ? '' : 's'}.\nPainted ${paintedStr} / ${requiredStr} • Wrong ${wrongStr}`
    );

    if (typeof window.scheduleProgressUiRefresh === 'function') {
      window.scheduleProgressUiRefresh();
    } else {
      window.buildColorFilterList?.();
      window.buildTemplateFilterList?.();
    }
  }

    /** Add the template overlay layer to the map
   * @param {number?} sortID
   * @since 0.86.1
   */
  async createOverlayOnMap(sortID = null, options = null) {
    if (!this._overlayRebuildState) {
      this._overlayRebuildState = {
        timer: null,
        pendingSortID: undefined,
        pendingOptions: null,
        promise: null,
        resolve: null,
        reject: null,
        running: false,
        needsRun: false,
        lastFullRebuildAt: 0,   // timestamp of last full (non-prefix-scoped) rebuild completion
        lastScopedRebuildAt: 0, // timestamp of last prefix-scoped rebuild completion
      };
    }

    const state = this._overlayRebuildState;
    let normalizedOptions = options ? { ...options } : null;
    if (normalizedOptions?.visibleFirst && !normalizedOptions.tilePrefixes) {
      const visiblePrefixes = this.getVisibleTilePrefixes();
      if (visiblePrefixes && visiblePrefixes.size) {
        normalizedOptions.tilePrefixes = visiblePrefixes;
        normalizedOptions.followUpFull = true;
        if (normalizedOptions.immediate === undefined) normalizedOptions.immediate = true;
      } else {
        normalizedOptions = null;
      }
    }
    if (normalizedOptions?.tilePrefixes && !(normalizedOptions.tilePrefixes instanceof Set)) {
      normalizedOptions.tilePrefixes = new Set(normalizedOptions.tilePrefixes);
    }

    const mergeSortId = (current, next) => {
      if (next === null) return null;
      if (current === undefined) return next;
      if (current === null) return null;
      return current === next ? current : null;
    };

    state.pendingSortID = mergeSortId(state.pendingSortID, sortID);
    state.pendingOptions = normalizedOptions;

    if (state.running) {
      state.needsRun = true;
      return state.promise || Promise.resolve();
    }

    // Rate-limit rebuilds: full rebuilds cooldown 2s, scoped-prefix rebuilds cooldown 500ms.
    // immediate:true bypasses both (used for color-completion and visibleFirst triggers).
    const FULL_REBUILD_COOLDOWN_MS = 2000;
    const SCOPED_REBUILD_COOLDOWN_MS = 500;
    const isFullRebuild = !normalizedOptions?.tilePrefixes;
    const msSinceLastFull = getNowMs() - state.lastFullRebuildAt;
    const msSinceLastScoped = getNowMs() - state.lastScopedRebuildAt;
    const delayMs = normalizedOptions?.immediate
      ? 0
      : isFullRebuild && msSinceLastFull < FULL_REBUILD_COOLDOWN_MS
        ? FULL_REBUILD_COOLDOWN_MS - msSinceLastFull
        : !isFullRebuild && msSinceLastScoped < SCOPED_REBUILD_COOLDOWN_MS
          ? SCOPED_REBUILD_COOLDOWN_MS - msSinceLastScoped
          : 100;

    // Only reset the timer if the new delay is shorter (don't push a queued rebuild further out).
    if (state.timer) {
      if (delayMs >= state._pendingDelay) {
        // Already have a timer firing sooner or at the same time — don't reset it.
        return state.promise || Promise.resolve();
      }
      clearTimeout(state.timer);
      state.timer = null;
    }

    state._pendingDelay = delayMs;
    if (!state.promise) {
      state.promise = new Promise((resolve, reject) => {
        state.resolve = resolve;
        state.reject = reject;
      });
    }

    state.timer = setTimeout(async () => {
      state.timer = null;
      state._pendingDelay = 0;
      state.running = true;
      const pending = state.pendingSortID;
      const pendingOptions = state.pendingOptions;
      const followUpFull = !!(pendingOptions?.followUpFull && pendingOptions?.tilePrefixes);
      // The follow-up full pass must inherit skipExisting, otherwise a toggle-on whose layers are
      // already valid pays for a complete re-render one tick after we deliberately skipped it.
      const followUpOptions = pendingOptions?.skipExisting ? { skipExisting: true } : null;
      state.pendingSortID = undefined;
      state.pendingOptions = null;
      try {
        await profiler.measureAsync('createOverlayOnMap', () => this._createOverlayOnMapInternal(pending, pendingOptions));
        if (!pendingOptions?.tilePrefixes) {
          state.lastFullRebuildAt = getNowMs();
        } else {
          state.lastScopedRebuildAt = getNowMs();
        }
        state.resolve?.();
      } catch (err) {
        // A render that dies here leaves the map with no crosses and, without this, no trace of why.
        noteOverlayIssue('overlay render threw', err?.stack || err?.message || String(err));
        state.reject?.(err);
      } finally {
        state.promise = null;
        state.resolve = null;
        state.reject = null;
        state.running = false;
        if (state.needsRun) {
          state.needsRun = false;
          if (followUpFull) {
            // Full rebuild supersedes any queued scoped render — don't drop the follow-up.
            state.pendingOptions = null;
            this.createOverlayOnMap(pending ?? null, followUpOptions);
          } else {
            this.createOverlayOnMap(state.pendingSortID ?? null, state.pendingOptions ?? null);
          }
        } else if (followUpFull) {
          this.createOverlayOnMap(pending ?? null, followUpOptions);
        }
      }
    }, delayMs);

    return state.promise;
  }

  /** Add the template overlay layer to the map for visible tiles first, then full.
   * @param {number?} sortID
   * @since 0.90.0
   */
  async createOverlayOnMapVisibleFirst(sortID = null) {
    return this.createOverlayOnMap(sortID, { visibleFirst: true, followUpFull: true, immediate: true });
  }

  /** Add the template overlay layer to the map for currently visible tiles only.
   * @param {number?} sortID
   * @since 0.90.0
   */
  async createOverlayOnMapVisibleOnly(sortID = null, options = null) {
    // skipExisting defaults on (mounted tiles are assumed current); pass false when the render
    // settings changed underneath them and the mounted canvases must be redrawn.
    const skipExisting = options?.skipExisting !== false;
    const visiblePrefixes = this.getVisibleTilePrefixes();
    if (visiblePrefixes && visiblePrefixes.size) {
      this.pruneOverlayToVisiblePrefixes(sortID, visiblePrefixes);
      return this.createOverlayOnMap(sortID, { tilePrefixes: visiblePrefixes, immediate: true, skipExisting });
    }
    if (!isMapTilerLoaded()) {
      doAfterMapFound(() => {
        try {
          this.createOverlayOnMapVisibleOnly(sortID);
        } catch (_) {}
      });
    }
    return Promise.resolve();
  }

  /** Render overlay after the map is ready. Used on startup to restore crosses from storage.
   * Polls until the map has bounds (confirming it is truly initialized), then renders.
   * Uses the same code path as toggle-on (queueOverlayRefreshAfterUi) for reliability.
   */
  _createOverlayAfterMapReady(sortID = null) {
    doAfterMapFound(() => {
      const poll = (attempts = 0) => {
        const bounds = getMapBounds?.();
        const ready = bounds && bounds.sw && bounds.ne;
        if (!ready && attempts < 20) {
          setTimeout(() => poll(attempts + 1), 250);
          return;
        }
        try { window.__bmStartupRenderFired = (window.__bmStartupRenderFired || 0) + 1; } catch(_) {}
        this.overlay?.handleDisplayStatus?.('Rendering crosses from storage...');
        this.queueOverlayRefreshAfterUi(sortID, {
          visibleFirst: true,
          followUpFull: true,
          immediate: true,
        }).then(() => {
          this.overlay?.handleDisplayStatus?.('');
        }).catch(() => {
          this.overlay?.handleDisplayStatus?.('Startup render failed');
        });
      };
      poll();
    });
  }

  /** Pre-extract chunk samples for any tile that has a bitmap but no sample buffer.
   * Runs in the background after template load so panning to new areas doesn't stall.
   * Uses sleep(0) yields between tiles to avoid competing with active renders.
   */
  async _prewarmTemplateSamples(template) {
    const allKeys = template.getChunkKeys();
    for (const tileKey of allKeys) {
      if (template.getRawChunkBuffer(tileKey) || template.chunkedSamples?.[tileKey]) continue;
      const hasBitmap = (template.chunked && Object.prototype.hasOwnProperty.call(template.chunked, tileKey))
        || (template.chunkedBuffer && Object.prototype.hasOwnProperty.call(template.chunkedBuffer, tileKey));
      if (!hasBitmap) continue;
      try {
        await template.getChunkSamples(tileKey, { memorySaving: false });
      } catch (_) {}
      await sleep(0);
    }
  }

  /** Speculatively extract samples for a template's currently-visible tiles.
   * Fire-and-forget: getChunkSamples deduplicates in-flight work, so calling this from a hover
   * handler just gives the eventual render a head start on its slowest step (PNG decode +
   * worker extraction). Safe to call on templates that are already warm — it no-ops.
   * @since 0.87.71
   */
  prewarmTemplateVisibleTiles(template) {
    if (!template) return;
    const now = getNowMs();
    if (!this._prewarmVisibleCooldown) this._prewarmVisibleCooldown = new Map();
    const key = String(template.sortID);
    if (now - (this._prewarmVisibleCooldown.get(key) ?? -Infinity) < 1000) return;
    this._prewarmVisibleCooldown.set(key, now);

    const visiblePrefixes = this.getVisibleTilePrefixes();
    if (!visiblePrefixes || !visiblePrefixes.size) return;
    const memorySaving = this.isMemorySavingModeOn();
    for (const tileKey of this._getTemplateTileKeys(template, visiblePrefixes)) {
      if (template.getRawChunkBuffer(tileKey) || template.chunkedSamples?.[tileKey]) continue;
      try {
        Promise.resolve(template.getChunkSamples(tileKey, { memorySaving })).catch(() => {});
      } catch (_) {}
    }
  }

  /** Schedule background sample pre-extraction for a template.
   * Delayed by 1s to let the initial render complete first.
   */
  _schedulePrewarm(template) {
    setTimeout(async () => {
      try {
        await this._prewarmTemplateSamples(template);
      } catch (_) {}
    }, 1000);
  }

  /** Queue an overlay refresh after the browser has had a chance to paint UI updates first.
   * @param {number?} sortID
   * @param {object?} options
   * @since 0.90.0
   */
  async queueOverlayRefreshAfterUi(sortID = null, options = null) {
    await waitForUiPaint();
    return this.createOverlayOnMap(sortID, options);
  }

  /** Compute a tile's pixel offset (in template-space pixels) relative to the template's top-left corner. */
  _getTileOffsetInTemplate(template, tileKey) {
    const tileSize = this.tileSize;
    const templateWorldWidth = 2048 * tileSize;
    const coords = template.coords;
    const topLeftWorldX = coords[0] * tileSize + coords[2];
    const topLeftWorldY = coords[1] * tileSize + coords[3];
    const tileCoords = String(tileKey).split(',').map(Number);
    const chunkWorldX = tileCoords[0] * tileSize + tileCoords[2];
    const chunkWorldY = tileCoords[1] * tileSize + tileCoords[3];
    const offsetX = ((chunkWorldX - topLeftWorldX) % templateWorldWidth + templateWorldWidth) % templateWorldWidth;
    const offsetY = chunkWorldY - topLeftWorldY;
    return { offsetX, offsetY };
  }

  /** Add the template overlay layer to the map (no debounce)
   * @param {number?} sortID
   * @since 0.86.1
   */
  async _createOverlayOnMapInternal(sortID = null, options = null) {
    if (this._activeOverlayGenerationId) {
      templateWorkerManager.cancelGeneration(this._activeOverlayGenerationId);
    }
    const overlayGenerationId = `overlay:${++this._overlayRenderGeneration}`;
    this._activeOverlayGenerationId = overlayGenerationId;
    const tilePrefixSet = options?.tilePrefixes ?? null;
    const skipExisting = options?.skipExisting === true;
    const mountedOverlaySourceIDs = skipExisting
      ? new Set(getMountedTemplateCanvasSourceIDs('overlay'))
      : null;

    const currentMemorySavingMode = this.isMemorySavingModeOn();
    const templates = (this.templatesArray ?? []).filter(t => t.enabled && (sortID === null || t.sortID == sortID));
    const _paletteToggledStatus = this.getPaletteToggledStatus();
    const displayedColors = this.getDisplayedColorsSorted(_paletteToggledStatus);
    const displayedColorSet = new Set(displayedColors);
    const displayedColorPackedSet = new Set();
    let displayOtherColor = false;
    for (const colorKey of displayedColorSet) {
      if (colorKey === TEMPLATE_OTHER_COLOR_KEY) {
        displayOtherColor = true;
        continue;
      }
      const packedColor = parsePackedRgbKey(colorKey);
      if (packedColor !== null) {
        displayedColorPackedSet.add(packedColor);
      }
    }
    const hasColorDisabled = displayedColors.length !== Object.keys(_paletteToggledStatus).length;
    const allColorsDisabled = displayedColors.length === 0;

    const displayMode = this.getTemplateDisplayMode();
    const drawMultResult = this.getTemplateDrawSize(displayMode);
    const maskPoints = this.getTemplateMaskPoints(displayMode, drawMultResult, templates[0] ?? null);
    const maskRowSpans = buildMaskRowSpans(maskPoints, drawMultResult);
    const displayedColorsHash = this.getOverlayDisplayedColorsHash(displayedColors);

    if (allColorsDisabled) {
      for (const template of templates) {
        removeLayer("overlay", template.sortID);
      }
      return;
    }

    // ── Phase 1+2: collect tile data and dispatch worker calls for ALL templates in parallel ──
    // Each template gets its own yield scheduler so their rAF pauses interleave rather than stack.
    profiler.start('overlay:phase1');
    const phase12Results = await Promise.all(templates.map(async (template) => {
      if (!template.enabled) return null;
      // If skipExisting and the merged full-canvas is already mounted, there is nothing to add —
      // this holds for scoped and unscoped renders alike, since one canvas covers every tile.
      if (skipExisting && mountedOverlaySourceIDs?.has(`BM-overlay-full-${template.sortID}`)) return null;
      const tileKeys = this._getTemplateTileKeys(template, tilePrefixSet);
      if (!tileKeys.length) return null;
      // The merged path composites into one canvas spanning the WHOLE template and mounts it as the
      // single source for it. That is only correct when this render covers every tile — a scoped
      // (visible-only) render would bake a canvas that is blank everywhere off-screen, and
      // skipExisting then treats it as complete forever, so those areas never get crosses.
      const coversAllTiles = tileKeys.length === template.getChunkKeys().length;

      const drawMultTemplate = template.shreadSize;
      const drawMultCenterTemplate = (template.shreadSize - 1) >> 1;
      const useUnfilteredRender = !hasColorDisabled && drawMultTemplate === drawMultResult && displayMode !== 'fill';
      const backgroundMode = this.isBackgroundModeEnabled() && !!this._livePixelsFetcher;
      const chunkDefaceFlags = (template._chunkDefaceFlags ??= new Map());
      // Comparing erase pixels against the live canvas only matters when we actually draw them.
      // It costs a tile read per pass, and those reads go to wplace's service worker -- the same
      // one that composes the punched-out pixels while painting -- so in 'off' mode, where nothing
      // is drawn for them anyway, none of that machinery may run.
      const defaceNeedsLiveCheck = this.getDefaceDisplayMode() !== 'off';

      // Phase 1: categorize tiles into cached / sample / bitmap buckets
      const yieldUi = createUiWorkScheduler(); // independent scheduler per template
      const cachedTiles = [];
      const sampleTiles = [];
      const bitmapTiles = [];

      // ── Pass 1: categorize tiles synchronously (fast-path) or collect for parallel extraction ──
      // Tiles with a raw binary sample buffer are resolved without any async work.
      // Tiles needing bitmap extraction are collected and fired in parallel below.
      const slowTiles = []; // { tileKey, sourceID }
      // Tiles skipped because they are already mounted per-tile. The merged path can't be used when
      // any were skipped: it would composite only the collected tiles into a whole-template canvas
      // and then prune the mounted per-tile ones, blanking exactly the area that was already right.
      let skippedMountedTiles = false;
      for (const tileKey of tileKeys) {
        const sourceID = `BM-overlay-${tileKey}-${template.sortID}`;
        // A chunk with erase pixels is rendered against the live canvas, so "its layer is already
        // mounted" says nothing about whether it is still correct: the cross computed before the
        // tile arrived would stay up forever.
        const chunkHoldsDeface = defaceNeedsLiveCheck && chunkDefaceFlags.get(tileKey) === true;
        if (skipExisting && !chunkHoldsDeface && mountedOverlaySourceIDs?.has(sourceID)) { skippedMountedTiles = true; continue; }

        // A chunk with #deface pixels has to be re-checked against the live canvas on every pass,
        // so it cannot take the raw-buffer fast path or come out of the raster cache. Which chunks
        // those are is learned on the first decode below and remembered per chunk, so a template
        // without erase pixels pays one slow pass per chunk and then behaves exactly as before.
        const chunkKnownWithoutDeface = !defaceNeedsLiveCheck || chunkDefaceFlags.get(tileKey) === false;
        const rawBuffer = (!backgroundMode && chunkKnownWithoutDeface)
          ? template.getRawChunkBuffer(tileKey)
          : null;
        if (rawBuffer) {
          const header = readChunkSampleHeader(rawBuffer);
          if (header) {
            const safeW = Math.max(1, header.width);
            const safeH = Math.max(1, header.height);
            const resultWidth = safeW * drawMultResult;
            const resultHeight = safeH * drawMultResult;
            const overlayCacheKey = this.getOverlayRasterCacheKey(tileKey, template.sortID, drawMultResult, displayMode, displayedColorsHash);
            const cachedRaster = this.getOverlayRasterCacheEntry(overlayCacheKey);
            if (cachedRaster?.pixels instanceof Uint8ClampedArray) {
              cachedTiles.push({ tileKey, sourceID, pixels: cachedRaster.pixels.slice(), resultWidth, resultHeight, safeW, safeH });
            } else {
              sampleTiles.push({ tileKey, sourceID, rawBuffer, resultWidth, resultHeight, safeW, safeH, overlayCacheKey });
            }
            continue;
          }
        }
        slowTiles.push({ tileKey, sourceID });
      }

      if (this._activeOverlayGenerationId !== overlayGenerationId) return null;

      // ── Pass 2: extract samples for slow tiles in parallel ──
      // All getChunkSamples calls (PNG decode + worker extraction) run concurrently.
      // getChunkSamples deduplicates: if prewarm already started extraction for a tile,
      // we join the existing promise rather than starting a new worker task.
      if (slowTiles.length > 0) {
        await yieldUi();
        if (this._activeOverlayGenerationId !== overlayGenerationId) return null;

        const slowResults = await Promise.all(slowTiles.map(async ({ tileKey, sourceID }) => {
          let sampleData = await template.getChunkSamples(tileKey, { memorySaving: currentMemorySavingMode });

          let chunkHasDeface = false;
          if (sampleData && defaceNeedsLiveCheck) {
            for (let i = 0; i < sampleData.count; i++) {
              if ((sampleData.flags[i] & TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE) !== 0) { chunkHasDeface = true; break; }
            }
            chunkDefaceFlags.set(tileKey, chunkHasDeface);
          }
          // Erase pixels are filtered whatever the mode: a #deface pixel sitting on an already
          // empty canvas pixel is in its correct state, so it must not be marked at all.
          const defaceFilter = !backgroundMode && chunkHasDeface;

          if (sampleData && (backgroundMode || defaceFilter)) {
            // Diagnostic, because the catch below is silent by design and a failure here looks
            // exactly like "the filter does nothing". Read it as `bmDefaceDiag` in the console.
            const diag = (globalThis.bmDefaceDiag ??= {
              runs: 0, deface: 0, dropped: 0, kept: 0, noLivePixels: 0, errors: 0, lastError: null,
            });
            diag.runs++;
            try {
              const tileKeyParts = String(tileKey).split(',').map(Number);
              const liveTileX = tileKeyParts[0];
              const liveTileY = tileKeyParts[1];
              const tileOffsetX = tileKeyParts[2] || 0;
              const tileOffsetY = tileKeyParts[3] || 0;
              // Background mode keeps the fetcher it always used. The erase-pixel filter reads
              // only the already-loaded tile, so it never adds a request of its own.
              const livePixels = backgroundMode
                ? await this._livePixelsFetcher(liveTileX, liveTileY)
                : await this.getCachedTilePixels(
                  `${String(liveTileX).padStart(4, '0')},${String(liveTileY).padStart(4, '0')}`
                );
              if (!(livePixels instanceof Uint8ClampedArray) || livePixels.length < 4) diag.noLivePixels++;
              if (livePixels instanceof Uint8ClampedArray && livePixels.length >= 4) {
                const liveTileSize = Math.round(Math.sqrt(livePixels.length / 4));
                const filteredSample = {
                  ...sampleData,
                  x: new Uint16Array(sampleData.count),
                  y: new Uint16Array(sampleData.count),
                  r: new Uint8Array(sampleData.count),
                  g: new Uint8Array(sampleData.count),
                  b: new Uint8Array(sampleData.count),
                  a: new Uint8Array(sampleData.count),
                  flags: new Uint8Array(sampleData.count),
                  count: 0,
                  native: false,
                };
                for (let i = 0; i < sampleData.count; i++) {
                  if (sampleData.a[i] < 1) continue;
                  const lx = tileOffsetX + sampleData.x[i];
                  const ly = tileOffsetY + sampleData.y[i];
                  if (lx < 0 || ly < 0 || lx >= liveTileSize || ly >= liveTileSize) {
                    const wi = filteredSample.count++;
                    filteredSample.x[wi] = sampleData.x[i];
                    filteredSample.y[wi] = sampleData.y[i];
                    filteredSample.r[wi] = sampleData.r[i];
                    filteredSample.g[wi] = sampleData.g[i];
                    filteredSample.b[wi] = sampleData.b[i];
                    filteredSample.a[wi] = sampleData.a[i];
                    filteredSample.flags[wi] = sampleData.flags[i];
                    continue;
                  }
                  const liveAlpha = livePixels[(ly * liveTileSize + lx) * 4 + 3];
                  // Background mode shows what is left to do, and for a #deface pixel that is the
                  // opposite test: it asks for the canvas to be EMPTY, so it is done once the live
                  // pixel is gone and still outstanding while paint is there. Sharing the
                  // `liveAlpha < 1` rule marked every finished erase pixel and hid every pending
                  // one -- exactly inverted.
                  const isDefaceSample = (sampleData.flags[i] & TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE) !== 0;
                  // Background mode keeps only what is left to do. Outside it, nothing is dropped
                  // except erase pixels that are already erased.
                  const keepSample = isDefaceSample
                    ? liveAlpha >= 1
                    : (backgroundMode ? liveAlpha < 1 : true);
                  if (isDefaceSample) {
                    diag.deface++;
                    if (keepSample) diag.kept++; else diag.dropped++;
                  }
                  if (keepSample) {
                    const wi = filteredSample.count++;
                    filteredSample.x[wi] = sampleData.x[i];
                    filteredSample.y[wi] = sampleData.y[i];
                    filteredSample.r[wi] = sampleData.r[i];
                    filteredSample.g[wi] = sampleData.g[i];
                    filteredSample.b[wi] = sampleData.b[i];
                    filteredSample.a[wi] = sampleData.a[i];
                    filteredSample.flags[wi] = sampleData.flags[i];
                  }
                }
                sampleData = filteredSample;
              }
            } catch (exception) {
              // Was `catch (_) {}`: a throw here (a tainted-canvas read in getLiveTilePixels, for
              // one) silently left every erase marker in place, which is indistinguishable from
              // the filter simply not working.
              diag.errors++;
              diag.lastError = String(exception?.message || exception);
            }
          }

          return { tileKey, sourceID, sampleData, defaceFilter };
        }));

        if (this._activeOverlayGenerationId !== overlayGenerationId) return null;

        for (const { tileKey, sourceID, sampleData, defaceFilter } of slowResults) {
          if (sampleData) {
            const safeW = Math.max(1, Math.round(Number(sampleData.width) || 0));
            const safeH = Math.max(1, Math.round(Number(sampleData.height) || 0));
            const resultWidth = safeW * drawMultResult;
            const resultHeight = safeH * drawMultResult;
            // A null key both skips the lookup and makes setOverlayRasterCacheEntry a no-op.
            const overlayCacheKey = (backgroundMode || defaceFilter)
              ? null
              : this.getOverlayRasterCacheKey(tileKey, template.sortID, drawMultResult, displayMode, displayedColorsHash);
            const cachedRaster = overlayCacheKey ? this.getOverlayRasterCacheEntry(overlayCacheKey) : null;
            if (cachedRaster?.pixels instanceof Uint8ClampedArray) {
              cachedTiles.push({ tileKey, sourceID, pixels: cachedRaster.pixels.slice(), resultWidth, resultHeight, safeW, safeH });
            } else {
              sampleTiles.push({ tileKey, sourceID, sampleData, resultWidth, resultHeight, safeW, safeH, overlayCacheKey });
            }
          } else {
            const templateTileBitmap = await template.getChunked(tileKey, currentMemorySavingMode);
            const safeW = Math.max(1, Math.round((templateTileBitmap?.width || 0) / template.shreadSize));
            const safeH = Math.max(1, Math.round((templateTileBitmap?.height || 0) / template.shreadSize));
            const resultWidth = safeW * drawMultResult;
            const resultHeight = safeH * drawMultResult;
            bitmapTiles.push({ tileKey, sourceID, bitmap: templateTileBitmap, resultWidth, resultHeight, safeW, safeH });
          }
        }
      }

      if (this._activeOverlayGenerationId !== overlayGenerationId) return null;

      // Phase 2: render all tiles in the worker and merge into a single bitmap (if the template
      // is small enough). Otherwise fall back to the per-tile batch approach.
      const imageW = template.imageWidth;
      const imageH = template.imageHeight;
      const MAX_MERGED_PX = 4096; // max dimension for merged canvas
      const canMerge = coversAllTiles && !skippedMountedTiles && imageW > 0 && imageH > 0 && bitmapTiles.length === 0
        && imageW * drawMultResult <= MAX_MERGED_PX && imageH * drawMultResult <= MAX_MERGED_PX;

      let workerPixelMap = new Map();
      let mergedBitmap = null;

      if (canMerge && (sampleTiles.length > 0 || cachedTiles.length > 0)) {
        // Build sampleChunks (need rendering) and cachedChunks (pixels already available)
        const sampleChunks = sampleTiles.map(t => {
          const { offsetX, offsetY } = this._getTileOffsetInTemplate(template, t.tileKey);
          // Reuse the raw buffer if available (fast-path tile): avoids a full encode cycle.
          // Otherwise fall back to encoding from decoded sampleData (slow-path tile).
          const sampleBytes = t.rawBuffer instanceof Uint8Array
            ? t.rawBuffer.slice()
            : encodeChunkSampleBytes(t.sampleData);
          return {
            sampleData: sampleBytes,
            resultWidth: t.resultWidth,
            resultHeight: t.resultHeight,
            destX: offsetX * drawMultResult,
            destY: offsetY * drawMultResult,
          };
        });
        const cachedChunks = cachedTiles.map(t => {
          const { offsetX, offsetY } = this._getTileOffsetInTemplate(template, t.tileKey);
          return {
            pixels: t.pixels,
            resultWidth: t.resultWidth,
            resultHeight: t.resultHeight,
            destX: offsetX * drawMultResult,
            destY: offsetY * drawMultResult,
          };
        });
        const serializedMaskRowSpans = cloneMaskRowSpans(maskRowSpans);
        // Deliberately NOT transferring cachedChunks pixels. Phase 3 falls back to per-tile
        // registration whenever the merge yields no bitmap (worker failure, cancelled
        // generation), and it reads these same arrays — transferring them detaches the
        // originals, so the fallback would throw and take every template's crosses down with it.
        const mergeTransferList = [
          ...sampleChunks.map(c => c.sampleData.buffer),
          ...getMaskRowSpansTransferList(serializedMaskRowSpans),
        ];
        const mergeResult = await templateWorkerManager.runTask('renderAndMergeOverlayChunks', {
          canvasWidth: imageW * drawMultResult,
          canvasHeight: imageH * drawMultResult,
          sampleChunks,
          cachedChunks,
          drawSize: drawMultResult,
          maskPoints,
          maskRowSpans: serializedMaskRowSpans,
          displayedColors: useUnfilteredRender ? null : displayedColors,
          defaceRender: this.getDefaceDisplayMode(),
          enforceTransparentAsDeface: template.enforceTransparentAsDeface === true,
          transparentEraseColor: this.getTransparentEraseColor(),
        }, { generation: overlayGenerationId, transferList: mergeTransferList });

        if (this._activeOverlayGenerationId !== overlayGenerationId) return null;
        mergedBitmap = mergeResult?.bitmap ?? null;
      } else if (!canMerge && sampleTiles.length > 0) {
        // Fall back: per-tile batch for large/bitmap templates
        const batchChunks = sampleTiles.map(t => ({
          tileKey: t.tileKey,
          sampleData: t.rawBuffer instanceof Uint8Array
            ? t.rawBuffer.slice()
            : encodeChunkSampleBytes(t.sampleData),
          resultWidth: t.resultWidth,
          resultHeight: t.resultHeight,
        }));
        const serializedMaskRowSpans = cloneMaskRowSpans(maskRowSpans);
        const batchTransferList = [
          ...batchChunks.map(c => c.sampleData.buffer),
          ...getMaskRowSpansTransferList(serializedMaskRowSpans),
        ];
        const batchResult = await templateWorkerManager.runTask('renderOverlayChunkBatch', {
          chunks: batchChunks,
          drawSize: drawMultResult,
          maskPoints,
          maskRowSpans: serializedMaskRowSpans,
          displayedColors: useUnfilteredRender ? null : displayedColors,
          defaceRender: this.getDefaceDisplayMode(),
          enforceTransparentAsDeface: template.enforceTransparentAsDeface === true,
          transparentEraseColor: this.getTransparentEraseColor(),
        }, { generation: overlayGenerationId, transferList: batchTransferList });

        if (this._activeOverlayGenerationId !== overlayGenerationId) return null;
        if (Array.isArray(batchResult?.results)) {
          for (const r of batchResult.results) {
            if (r?.pixels instanceof Uint8ClampedArray) workerPixelMap.set(r.tileKey, r);
          }
        }
      }

      return { template, cachedTiles, sampleTiles, bitmapTiles, workerPixelMap, mergedBitmap, canMerge,
        useUnfilteredRender, drawMultTemplate, drawMultCenterTemplate };
    }));
    profiler.end('overlay:phase1');

    if (this._activeOverlayGenerationId !== overlayGenerationId) return;

    // ── Phase 3: register canvases with MapTiler (must stay on main thread) ──────────────────────
    // Merged path: 1 addTemplateFullCanvas call per template (bitmap already composited by worker).
    // Fallback path: per-tile addTemplateCanvas (large/bitmap templates).
    profiler.start('overlay:phase3');
    const yieldUi = createUiWorkScheduler();
    for (const result of phase12Results) {
      if (!result) continue;
      if (this._activeOverlayGenerationId !== overlayGenerationId) return;
      const { template, cachedTiles, sampleTiles, bitmapTiles, workerPixelMap, mergedBitmap, canMerge,
        useUnfilteredRender, drawMultTemplate, drawMultCenterTemplate } = result;

      if (canMerge && mergedBitmap instanceof ImageBitmap) {
        // Worker has already composited all tiles — one MapTiler call suffices.
        addTemplateFullCanvas(template.sortID, template.coords,
          [template.imageWidth, template.imageHeight], mergedBitmap, "overlay");
        mergedBitmap.close?.();
        this._pruneConflictingOverlayMounts(template.sortID, 'full');
        if (this.isErrorMapShown()) setUsageLayersOpacity("overlay", 0);
        continue;
      }
      if (canMerge) {
        // Merge was attempted but produced nothing; the per-tile fallback below has to cover it.
        noteOverlayIssue('merged render returned no bitmap', `sortID=${template?.sortID} name=${template?.displayName}`);
      }

      // Fallback: per-tile registration (bitmap templates, very large templates, scoped renders)
      if (cachedTiles.length || sampleTiles.length || bitmapTiles.length) {
        this._pruneConflictingOverlayMounts(template.sortID, 'tiles');
      }
      for (const t of cachedTiles) {
        await yieldUi();
        if (this._activeOverlayGenerationId !== overlayGenerationId) return;
        // Hand the pixels over as ImageData. addTemplateCanvas putImageData's them straight into
        // the source canvas, so staging them through an OffscreenCanvas first would just be an
        // extra full-size allocation and blit per tile.
        try {
          addTemplateCanvas(template.sortID, t.tileKey, [t.safeW, t.safeH],
            new ImageData(t.pixels, t.resultWidth, t.resultHeight), "overlay");
        } catch (exception) {
          noteOverlayIssue('cached tile canvas failed', `tile=${t.tileKey} ${exception?.message ?? exception}`);
          continue;
        }
        if (this.isErrorMapShown()) setUsageLayersOpacity("overlay", 0);
      }

      for (const t of sampleTiles) {
        await yieldUi();
        if (this._activeOverlayGenerationId !== overlayGenerationId) return;
        // Produce ImageData rather than a staging canvas — addTemplateCanvas writes it into the
        // source canvas directly, so an intermediate OffscreenCanvas is a wasted alloc + blit.
        let resultImage = null;
        const workerResult = workerPixelMap.get(t.tileKey);
        if (workerResult?.pixels instanceof Uint8ClampedArray) {
          this.setOverlayRasterCacheEntry(t.overlayCacheKey, {
            width: t.resultWidth,
            height: t.resultHeight,
            pixels: workerResult.pixels.slice(),
          });
          resultImage = new ImageData(workerResult.pixels, t.resultWidth, t.resultHeight);
        }
        if (!resultImage) {
          const image = new ImageData(t.resultWidth, t.resultHeight);
          const sampleDataForFallback = t.sampleData ??
            (t.rawBuffer instanceof Uint8Array ? decodeChunkSampleBuffer(t.rawBuffer) : null);
          if (useUnfilteredRender) {
            renderSampleDataToImage({ sampleData: sampleDataForFallback, imageData: image, resultWidth: t.resultWidth, drawSize: drawMultResult, maskPoints, maskRowSpans, defaceRender: this.getDefaceDisplayMode(), enforceTransparentAsDeface: template.enforceTransparentAsDeface === true, transparentEraseColor: this.getTransparentEraseColor() });
          } else if (!allColorsDisabled) {
            renderSampleDataToImage({ sampleData: sampleDataForFallback, imageData: image, resultWidth: t.resultWidth, drawSize: drawMultResult, maskPoints, maskRowSpans, displayedColorSet, defaceRender: this.getDefaceDisplayMode(), enforceTransparentAsDeface: template.enforceTransparentAsDeface === true, transparentEraseColor: this.getTransparentEraseColor() });
          }
          resultImage = image;
        }
        addTemplateCanvas(template.sortID, t.tileKey, [t.safeW, t.safeH], resultImage, "overlay");
        if (this.isErrorMapShown()) setUsageLayersOpacity("overlay", 0);
      }

      for (const t of bitmapTiles) {
        await yieldUi();
        if (this._activeOverlayGenerationId !== overlayGenerationId) return;
        let resultCanvas = null;
        let resultContext = null;
        try {
          if (!hasColorDisabled && drawMultTemplate === drawMultResult && displayMode !== 'fill') {
            resultCanvas = new OffscreenCanvas(t.resultWidth, t.resultHeight);
            resultContext = resultCanvas.getContext('2d');
            resultContext.imageSmoothingEnabled = false;
            resultContext.drawImage(t.bitmap, 0, 0);
          } else if (!allColorsDisabled) {
            const templateWidth = t.bitmap.width;
            const templateHeight = t.bitmap.height;
            const templateCanvas = new OffscreenCanvas(templateWidth, templateHeight);
            const templateCtx = templateCanvas.getContext('2d', { willReadFrequently: true });
            templateCtx.imageSmoothingEnabled = false;
            templateCtx.drawImage(t.bitmap, 0, 0);
            const templateData = templateCtx.getImageData(0, 0, templateWidth, templateHeight).data;
            const displayedColorsSorted = Uint32Array.from(displayedColorPackedSet).sort();
            const filterResult = await templateWorkerManager.runTask('filterTemplateBitmap', {
              templateData, templateWidth, templateHeight,
              resultWidth: t.resultWidth, resultHeight: t.resultHeight,
              drawMultTemplate, drawMultResult, drawMultCenter: drawMultCenterTemplate,
              maskPoints,
              displayedColorsPacked: displayedColorsSorted,
              knownColorsPacked: knownColorsSorted,
              displayOther: displayOtherColor === true,
            }, { generation: overlayGenerationId, transferList: [templateData.buffer, displayedColorsSorted.buffer] });
            resultCanvas = new OffscreenCanvas(t.resultWidth, t.resultHeight);
            resultContext = resultCanvas.getContext('2d');
            resultContext.imageSmoothingEnabled = false;
            if (filterResult?.pixels instanceof Uint8ClampedArray) {
              resultContext.putImageData(new ImageData(filterResult.pixels, t.resultWidth, t.resultHeight), 0, 0);
            }
          }
        } catch (exception) {
          console.warn('Failed to apply color filter:', exception);
          if (t.bitmap) {
            if (!resultCanvas) {
              resultCanvas = new OffscreenCanvas(t.resultWidth, t.resultHeight);
              resultContext = resultCanvas.getContext('2d');
            }
            resultContext.drawImage(t.bitmap, 0, 0);
          }
        }
        if (!resultCanvas) resultCanvas = new OffscreenCanvas(t.resultWidth, t.resultHeight);
        addTemplateCanvas(template.sortID, t.tileKey, [t.safeW, t.safeH], resultCanvas, "overlay");
        if (this.isErrorMapShown()) setUsageLayersOpacity("overlay", 0);
        cleanUpCanvas(resultCanvas);
        if (currentMemorySavingMode && t.bitmap) t.bitmap.close();
      }
    }
    // Record what these layers were rendered with, so a later toggle-on can skip redoing them.
    if (!this._overlayRenderSignatures) this._overlayRenderSignatures = new Map();
    const globalSignature = [drawMultResult, displayMode, displayedColorsHash, (this.isBackgroundModeEnabled() && !!this._livePixelsFetcher) ? 1 : 0].join('||');
    for (const result of phase12Results) {
      if (!result?.template) continue;
      // A template with erase pixels is rendered against the live canvas, which the normal
      // signature cannot represent. Keying it on the tile-blob epoch re-renders exactly when new
      // tile data arrived -- Date.now() here forced a full rebuild on every single overlay pass,
      // which is both wasteful and a lot more churn during painting.
      let hasDefaceChunk = false;
      for (const flag of (this.getDefaceDisplayMode() === 'off' ? [] : result.template._chunkDefaceFlags?.values() ?? [])) {
        if (flag) { hasDefaceChunk = true; break; }
      }
      if (hasDefaceChunk) {
        // Keyed on the tile-blob epoch this used to look fresh whenever no new tile had arrived,
        // which is exactly the case right after the canvas changed under a mounted layer. There is
        // no signature that can stand in for live canvas state, so record none.
        this._overlayRenderSignatures.delete(String(result.template.sortID));
        continue;
      }
      this._overlayRenderSignatures.set(
        String(result.template.sortID),
        `${globalSignature}||${this._getTemplateRenderSignaturePart(result.template)}`
      );
    }
    profiler.end('overlay:phase3');
  }


  /** Imports the JSON object, and appends it to any JSON object already loaded
   * @param {string} json - The JSON string to parse
   */
  importJSON(json) {
    // If the passed in JSON is a Blue Marble template object...
    if (json?.whoami == 'BlueMarble' || json?.whoami == 'RusMarble') {
      this.templatesJSON = json;
      this.importPromise = this.#parseRusMarble(json)
        .catch((err) => {
          console.warn('Failed to import templates', err);
        });
    }
  }

  /** Parses the Rus Marble JSON object
   * @param {string} json - The JSON string to parse
   * @since 0.72.13
   */
  async #parseRusMarble(json) {
    const templates = json.templates;

    if (Object.keys(templates).length > 0) {
      for (const template in templates) {
        if (!templates.hasOwnProperty(template)) continue;

        const templateKey = template;
        const templateValue = templates[template];
        const templateCoords = templateValue.coords.split(',').map(Number);
        const templateKeyArray = templateKey.split(' ');
        const sortID = Number(templateKeyArray?.[0]);
        const authorID = templateKeyArray?.[1] || '0';
        const displayName = templateValue.name || `Template ${sortID || ''}`;
        // Buffers normally live in their own storage key. Templates saved by an older version
        // still carry them inline, so fall back to that and let the next save migrate them out.
        const separateBuffers = await this._loadTemplateBuffers(templateKey);
        const tilesbase64 = (separateBuffers?.tiles)
          ?? ((templateValue.tiles && typeof templateValue.tiles === 'object') ? templateValue.tiles : {});
        const samplesBase64 = (separateBuffers?.samples)
          ?? ((templateValue.samples && typeof templateValue.samples === 'object') ? templateValue.samples : {});
        if (!Object.keys(tilesbase64).length && !Object.keys(samplesBase64).length) {
          continue;
        }
        const storedTileKeys = Array.isArray(templateValue.tileKeys)
          ? templateValue.tileKeys.filter((value) => typeof value === 'string' && value)
          : [];
        const parsedShreadSize = Math.max(1, Number(templateValue.shreadSize) || this.drawMult);
        const templateWorldWidth = 2048 * this.tileSize;
        const topLeftWorldX = templateCoords[0] * this.tileSize + templateCoords[2];
        const topLeftWorldY = templateCoords[1] * this.tileSize + templateCoords[3];
        const persistedPalette = (templateValue.palette && typeof templateValue.palette === 'object')
          ? templateValue.palette
          : null;
        const hasPersistedPalette = !!(persistedPalette && Object.keys(persistedPalette).length);
        let inferredImageWidth = Number.isFinite(Number(templateValue.width))
          ? Math.max(1, Math.trunc(Number(templateValue.width)))
          : 0;
        let inferredImageHeight = Number.isFinite(Number(templateValue.height))
          ? Math.max(1, Math.trunc(Number(templateValue.height)))
          : 0;
        let requiredPixelCount = 0;
        const paletteMap = new Map();

        let chunkKeys = [...new Set([
          ...storedTileKeys,
          ...Object.keys(tilesbase64),
          ...Object.keys(samplesBase64),
        ])];
        const chunkPlaceholders = Object.fromEntries(chunkKeys.map((key) => [key, null]));

        const templateInstance = new Template({
          displayName,
          sortID: sortID || (this.largestSeenSortID + 1) || 0,
          authorID: authorID || '',
          coords: templateCoords,
          chunked: chunkPlaceholders,
          chunkedBuffer: { ...tilesbase64 },
          chunkedSamples: {},
          chunkedSamplesBuffer: { ...samplesBase64 },
          imageWidth: inferredImageWidth > 0 ? inferredImageWidth : null,
          imageHeight: inferredImageHeight > 0 ? inferredImageHeight : null,
        });
        if (templateInstance.sortID > this.largestSeenSortID) {
          this.largestSeenSortID = templateInstance.sortID;
        }
        templateInstance.shreadSize = parsedShreadSize;
        templateInstance.persistBitmapTiles = Object.keys(tilesbase64).length > 0;
        templateInstance.persistChunkSamples = Object.keys(samplesBase64).length > 0;
        templateInstance.enabled = templateValue.enabled ?? true;
        templateInstance.isRemote = templateValue.remote === true;
        templateInstance.remoteName = templateValue.remoteName ?? null;
        templateInstance.remoteManual = templateValue.remoteManual === true;
        templateInstance.remoteStream = normalizeTemplateSyncStreamValue(templateValue.remoteStream);
        templateInstance.remoteUpdatedAt = templateValue.remoteUpdatedAt ?? null;
        templateInstance.remoteImageUpdatedAt = templateValue.remoteImageUpdatedAt ?? null;
        templateInstance.remoteFlagsCheckedAt = templateValue.remoteFlagsCheckedAt ?? null;
        templateInstance.remoteFlagsCheckedAtLocal = templateValue.remoteFlagsCheckedAtLocal ?? null;
        templateInstance.remoteCoords = templateValue.remoteCoords ?? null;
        templateInstance.remoteToTop = normalizeFlagValue(templateValue.remoteToTop);
        templateInstance.remoteToTopAt = templateValue.remoteToTopAt ?? null;
        templateInstance.remoteHighlighted = normalizeFlagValue(templateValue.remoteHighlighted);
        templateInstance.remoteHighlightedAt = templateValue.remoteHighlightedAt ?? null;
        templateInstance.remoteOrder = templateValue.remoteOrder ?? null;
        templateInstance.timeArchiveMeta = normalizeTimeArchiveMeta(templateValue.timeArchiveMeta);
        templateInstance.enforceTransparentAsDeface = templateValue.enforceTransparentAsDeface === true;

        for (const tileKey of chunkKeys) {
          const tileCoords = tileKey.split(',').map(Number);
          if (tileCoords.length < 4 || !tileCoords.slice(0, 4).every(Number.isFinite)) {
            continue;
          }

          let sampleData = null;
          if (Object.prototype.hasOwnProperty.call(samplesBase64, tileKey)) {
            sampleData = await templateInstance.getChunkSamples(tileKey, { allowBitmapFallback: false });
          } else if (!hasPersistedPalette || inferredImageWidth <= 0 || inferredImageHeight <= 0) {
            sampleData = await templateInstance.getChunkSamples(tileKey, { memorySaving: true });
          }

          let chunkWidth = Math.max(0, Math.trunc(Number(sampleData?.width) || 0));
          let chunkHeight = Math.max(0, Math.trunc(Number(sampleData?.height) || 0));
          if ((!chunkWidth || !chunkHeight) && Object.prototype.hasOwnProperty.call(tilesbase64, tileKey)) {
            const templateBitmap = await templateInstance.getChunked(tileKey, true);
            if (templateBitmap) {
              chunkWidth = Math.max(1, Math.round(templateBitmap.width / parsedShreadSize));
              chunkHeight = Math.max(1, Math.round(templateBitmap.height / parsedShreadSize));
              templateBitmap.close?.();
            }
          }

          const chunkWorldX = tileCoords[0] * this.tileSize + tileCoords[2];
          const chunkWorldY = tileCoords[1] * this.tileSize + tileCoords[3];
          const offsetX = ((chunkWorldX - topLeftWorldX) % templateWorldWidth + templateWorldWidth) % templateWorldWidth;
          const offsetY = chunkWorldY - topLeftWorldY;
          if (chunkWidth > 0) {
            inferredImageWidth = Math.max(inferredImageWidth, offsetX + chunkWidth);
          }
          if (chunkHeight > 0 && offsetY >= 0) {
            inferredImageHeight = Math.max(inferredImageHeight, offsetY + chunkHeight);
          }

          if (!hasPersistedPalette && sampleData) {
            for (let index = 0; index < sampleData.count; index++) {
              if (sampleData.a[index] < 64 || (sampleData.flags[index] & 1) === 1) continue;
              requiredPixelCount++;
              const colorKey = rgbToMeta.has(`${sampleData.r[index]},${sampleData.g[index]},${sampleData.b[index]}`)
                ? `${sampleData.r[index]},${sampleData.g[index]},${sampleData.b[index]}`
                : 'other';
              paletteMap.set(colorKey, (paletteMap.get(colorKey) || 0) + 1);
            }
          }
        }

        if (inferredImageWidth > 0) {
          templateInstance.imageWidth = inferredImageWidth;
          templates[templateKey].width = inferredImageWidth;
        }
        if (inferredImageHeight > 0) {
          templateInstance.imageHeight = inferredImageHeight;
          templates[templateKey].height = inferredImageHeight;
        }
        templateInstance.pixelCount = Math.max(0, (templateInstance.imageWidth || 0) * (templateInstance.imageHeight || 0));
        templateInstance.defacePixelCount = Math.max(0, Number(templateValue.deface) || 0);

        if (hasPersistedPalette) {
          const paletteObj = {};
          let persistedRequiredPixelCount = 0;
          for (const [key, meta] of Object.entries(persistedPalette)) {
            const count = Math.max(0, Number(meta?.count) || 0);
            paletteObj[key] = { count, enabled: meta?.enabled !== false };
            persistedRequiredPixelCount += count;
          }
          templateInstance.requiredPixelCount = persistedRequiredPixelCount;
          templateInstance.colorPalette = paletteObj;
        } else {
          const paletteObj = {};
          for (const [key, count] of paletteMap.entries()) {
            paletteObj[key] = { count, enabled: true };
          }
          templateInstance.requiredPixelCount = requiredPixelCount;
          templateInstance.colorPalette = paletteObj;
        }

        try {
          chunkKeys.forEach((key) => {
            templateInstance.tilePrefixes?.add(key.split(',').slice(0, 2).join(','));
          });
        } catch (_) {}

        try {
          const persisted = templates?.[templateKey]?.palette;
          if (persisted) {
            for (const [rgb, meta] of Object.entries(persisted)) {
              if (!templateInstance.colorPalette[rgb]) {
                templateInstance.colorPalette[rgb] = { count: meta?.count || 0, enabled: !!meta?.enabled };
              } else {
                templateInstance.colorPalette[rgb].enabled = !!meta?.enabled;
              }
            }
          }
        } catch (_) {}

        templateInstance.storageKey = templateKey;
        this.templatesArray.push(templateInstance);
        if (separateBuffers) {
          // Came from its own key and is byte-identical to what is stored, so record the
          // fingerprint now and the next save will skip rewriting it. Templates loaded from the
          // old inline format are deliberately left unrecorded so they migrate on first save.
          if (!this._persistedBufferFingerprints) this._persistedBufferFingerprints = new Map();
          this._persistedBufferFingerprints.set(
            templateKey,
            this._getTemplateBufferFingerprint(templateInstance)
          );
        }
        this._schedulePrewarm(templateInstance);
      }

      try {
        window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-color-list' }, '*');
      } catch (_) {}
      try {
        window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*');
      } catch (_) {}
      this._createOverlayAfterMapReady();
    }
  }

  /** Parses the OSU! Place JSON object
   */
  #parseOSU() {

  }

  /** Sets the `templatesShouldBeDrawn` boolean to a value.
   * @param {boolean} value - The value to set the boolean to
   * @since 0.73.7
   */
  // setTemplatesShouldBeDrawn(value) {
  //   this.templatesShouldBeDrawn = value;
  // }

  /** Gets the palette toggled status from the first appearance of the color as a temporary measure
   * @since 0.85.11
   */
  getPaletteToggledStatus() {
    const status = {};
    for (const template of this.templatesArray) {
      for (const [rgb, meta] of Object.entries(template.colorPalette)) {
        if (status[rgb]) { continue; }; // take the first appearance
        status[rgb] = meta.enabled;
      }
    }
    return status;
  }

  /** Gets the list of displayed colors, sorted by rgb
   * does not hide completed colors as that may become incomplete over time
   * @returns {string[]}
   * @since 0.85.30
   */
  getDisplayedColorsSorted(toggledStatus = null) {
    const currentOnly = this.isOnlyCurrentColorShown();
    const hideLocked = this.extraColorsBitmap !== -1 && this.areLockedColorsHidden(); // If -1 then all colors are unlocked, skip the hide color check
    toggledStatus = toggledStatus ?? this.getPaletteToggledStatus();
    const hideCompleted = this.areCompletedColorsHidden();
    const colors = [];
    if (currentOnly) {
      const currentColor = getCurrentColor();
      Object.entries(toggledStatus).forEach(([rgb, enabled]) => {
        const colorId = rgbToMeta.get(rgb).id;
        if (colorId !== currentColor) return;
        if (hideLocked && !this.isColorUnlocked(colorId)) return;
        if (hideCompleted && this.isColorCompleted(colorId)) return;
        colors.push(rgb);
      });
    } else {
      Object.entries(toggledStatus).forEach(([rgb, enabled]) => {
        const colorId = rgbToMeta.get(rgb).id;
        if (!enabled) return;
        if (hideLocked && !this.isColorUnlocked(colorId)) return;
        if (hideCompleted && this.isColorCompleted(colorId)) return;
        colors.push(rgb);
      });
    }
    return colors.sort();
  }

  /** Gets the list of ids of completed colors
   * does not hide completed colors as that may become incomplete over time
   * @returns {Set<number>}
   * @since 0.86.4
   */
  getCompletedColors() {
    this.getOverallPerColorProgress();
    const result = new Set();
    for (let colorId = 0; colorId < 64; colorId++) {
      if (this.isColorCompleted(colorId)) result.add(colorId);
    }
    return result;
  }

  /** Gets the list of involved templates, sorted by sortID
   * @param {number[]} tileCoords
   * @returns {Template[]}
   * @since 0.85.30
   */
  getInvolvedTemplates(tileCoords) {
    const tileCoordsPadded = tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0');
    return this.templatesArray.filter( template => {
      if (!template || typeof template.getChunkKeys !== 'function') return false;
      // Fast path via recorded tile prefixes if available
      if (template.tilePrefixes && template.tilePrefixes.size > 0) {
        return template.tilePrefixes.has(tileCoordsPadded);
      }
      // Fallback: scan chunked keys
      return template.getChunkKeys().some(k => k.startsWith(tileCoordsPadded));
    }).sort((a, b) => a.sortID - b.sortID);
  }

  /** Gets the key that indicates if the toggled status is unchanged, so we can skip redrawing the overlay
   * @param {number[]} tileCoords
   * @since 0.85.30
   */
  getTileCacheKey(tileCoords) {
    const displayedColors = this.getDisplayedColorsSorted();
    const involvedTemplates = this.getInvolvedTemplates(tileCoords);
    return this.getTileCacheKeyFromCalculated(displayedColors, involvedTemplates);
  }

  /** Gets the key that indicates if the toggled status is unchanged, so we can skip redrawing the overlay
   * @param {string[]} displayedColors
   * @param {Template[]} involvedTemplates
   * @returns {string}
   * @since 0.85.30
   */
  getTileCacheKeyFromCalculated(displayedColors, involvedTemplates) {
    // we still need to check the enabled status since disabled templates should still have the painted count updated.
    return displayedColors.join(';') + '||' + involvedTemplates.map(t => t.storageKey + "," + t.storageTimeString + "," + (+(t.enabled ?? true))).join(';');
  }

  /** Returns tile prefixes for currently visible map bounds (with padding).
   * @param {number} pad - Tiles to pad around the viewport.
   * @returns {Set<string> | null}
   * @since 0.90.0
   */
  getVisibleTilePrefixes(pad = 1) {
    const bounds = getMapBounds?.();
    if (!bounds || !bounds.sw || !bounds.ne) return null;
    const sw = bounds.sw;
    const ne = bounds.ne;
    if (!Array.isArray(sw) || !Array.isArray(ne)) return null;
    const [tileSW] = coordsGeoCoordsToTileCoords(sw[0], sw[1], true);
    const [tileNE] = coordsGeoCoordsToTileCoords(ne[0], ne[1], true);
    if (!tileSW || !tileNE) return null;

    const cacheKey = `${pad},${tileSW[0]},${tileSW[1]},${tileNE[0]},${tileNE[1]},${sw[1]},${ne[1]}`;
    if (this._visiblePrefixCache?.key === cacheKey) return this._visiblePrefixCache.result;

    let minY = Math.min(tileSW[1], tileNE[1]);
    let maxY = Math.max(tileSW[1], tileNE[1]);
    minY = Math.max(0, minY - pad);
    maxY = Math.min(2047, maxY + pad);

    const ranges = [];
    const westLng = sw[1];
    const eastLng = ne[1];
    if (westLng <= eastLng) {
      let minX = Math.min(tileSW[0], tileNE[0]);
      let maxX = Math.max(tileSW[0], tileNE[0]);
      minX = Math.max(0, minX - pad);
      maxX = Math.min(2047, maxX + pad);
      ranges.push([minX, maxX]);
    } else {
      let minX1 = Math.max(0, tileSW[0] - pad);
      let maxX1 = 2047;
      let minX2 = 0;
      let maxX2 = Math.min(2047, tileNE[0] + pad);
      ranges.push([minX1, maxX1], [minX2, maxX2]);
    }

    const maxTiles = 6000;
    let totalTiles = 0;
    for (const [minX, maxX] of ranges) {
      totalTiles += (maxX - minX + 1) * (maxY - minY + 1);
      if (!Number.isFinite(totalTiles) || totalTiles > maxTiles) return null;
    }

    const result = new Set();
    for (const [minX, maxX] of ranges) {
      for (let y = minY; y <= maxY; y++) {
        const yStr = y.toString().padStart(4, '0');
        for (let x = minX; x <= maxX; x++) {
          result.add(`${x.toString().padStart(4, '0')},${yStr}`);
        }
      }
    }
    this._visiblePrefixCache = { key: cacheKey, result };
    return result;
  }

  _getTileKeysByPrefixMap(template) {
    const version = template.storageTimeString;
    if (template._tileKeysByPrefix && template._tileKeysByPrefixVersion === version) {
      return template._tileKeysByPrefix;
    }
    const map = new Map();
    for (const key of template.getChunkKeys()) {
      const prefix = key.split(',').slice(0, 2).join(',');
      let list = map.get(prefix);
      if (!list) {
        list = [];
        map.set(prefix, list);
      }
      list.push(key);
    }
    template._tileKeysByPrefix = map;
    template._tileKeysByPrefixVersion = version;
    return map;
  }

  /** Drop whichever overlay mounting style a template is NOT currently using.
   * A template is drawn either as one merged full canvas or as a set of per-tile canvases; leaving
   * both mounted double-draws every pixel they share.
   * @param {number} sortID
   * @param {'full'|'tiles'} keep - the style being mounted now
   */
  _pruneConflictingOverlayMounts(sortID, keep) {
    if (sortID === null || sortID === undefined) return;
    const fullSourceID = `BM-overlay-full-${sortID}`;
    const toRemove = Object.keys(bmCanvas.overlay ?? {}).filter((sourceID) => {
      if (!sourceID.startsWith('BM-overlay-') || !sourceID.endsWith(`-${sortID}`)) return false;
      return keep === 'full' ? sourceID !== fullSourceID : sourceID === fullSourceID;
    });
    if (toRemove.length) removeTemplateCanvasSources(toRemove, 'overlay');
  }

  pruneOverlayToVisiblePrefixes(sortID, visiblePrefixes) {
    if (!(visiblePrefixes instanceof Set) || visiblePrefixes.size === 0) {
      return;
    }

    const overlaySources = Object.keys(bmCanvas.overlay ?? {});
    if (!overlaySources.length) {
      return;
    }

    const toRemove = overlaySources.filter((sourceID) => {
      if (!sourceID.startsWith('BM-overlay-')) return false;
      if (sortID !== null && !sourceID.endsWith(`-${sortID}`)) return false;
      const suffixIndex = sourceID.lastIndexOf('-');
      if (suffixIndex < 'BM-overlay-'.length) return false;
      const tileKey = sourceID.slice('BM-overlay-'.length, suffixIndex);
      if (!tileKey.includes(',')) return false; // full-canvas source — never prune
      const prefix = tileKey.split(',').slice(0, 2).join(',');
      return !visiblePrefixes.has(prefix);
    });

    if (toRemove.length) {
      removeTemplateCanvasSources(toRemove, 'overlay');
    }
  }

  _getTemplateTileKeys(template, prefixSet) {
    const keys = template.getChunkKeys();
    if (!prefixSet || prefixSet.size === 0) return keys;
    const prefixMap = this._getTileKeysByPrefixMap(template);
    const result = [];
    for (const prefix of prefixSet) {
      const list = prefixMap.get(prefix);
      if (list && list.length) {
        result.push(...list);
      }
    }
    return result;
  }

  getOverlayDisplayedColorsHash(displayedColors) {
    return Array.isArray(displayedColors) ? displayedColors.join(';') : '';
  }

  /** A fingerprint of every global input that affects how overlay canvases are rasterized.
   * If it is unchanged since a sortID's layers were mounted, those layers are still correct and
   * re-rendering them is pure waste.
   * @since 0.87.71
   */
  getOverlayRenderSignature() {
    const displayMode = this.getTemplateDisplayMode();
    const drawMult = this.getTemplateDrawSize(displayMode);
    const displayedColors = this.getDisplayedColorsSorted(this.getPaletteToggledStatus());
    const backgroundMode = this.isBackgroundModeEnabled() && !!this._livePixelsFetcher;
    return [drawMult, displayMode, this.getOverlayDisplayedColorsHash(displayedColors), backgroundMode ? 1 : 0].join('||');
  }

  /** The per-template half of the render signature: anything about the template itself that
   * changes what its canvases should look like.
   */
  _getTemplateRenderSignaturePart(template) {
    if (!template) return '';
    return [
      template.storageTimeString ?? '',
      Array.isArray(template.coords) ? template.coords.join(',') : '',
      template.shreadSize ?? '',
      template.enforceTransparentAsDeface === true ? 1 : 0,
    ].join('|');
  }

  /** The colour used to mark transparent template pixels when a template enforces them as erase.
   * @returns {string} a "#rrggbb" string
   */
  getTransparentEraseColor() {
    const value = String(this.userSettings?.transparentEraseColor ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_TRANSPARENT_ERASE_COLOR;
  }

  async setTransparentEraseColor(value) {
    const normalized = String(value ?? '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return false;
    this.userSettings.transparentEraseColor = normalized.toLowerCase();
    await this.storeUserSettings();
    // Every template that enforces transparent-as-erase now rasterizes differently, so drop the
    // cached rasters and the freshness signatures that would otherwise skip the re-render.
    this._overlayRasterCache?.clear();
    this._overlayRenderSignatures?.clear?.();
    return true;
  }

  /** Whether a sortID's mounted overlay layers were rendered with the current settings. */
  isOverlaySortIDFresh(sortID) {
    if (sortID === null || sortID === undefined) return false;
    const recorded = this._overlayRenderSignatures?.get(String(sortID));
    if (!recorded) return false;
    const template = (this.templatesArray ?? []).find((t) => t?.sortID == sortID);
    if (!template) return false;
    return recorded === `${this.getOverlayRenderSignature()}||${this._getTemplateRenderSignaturePart(template)}`;
  }

  /** Marks a sortID's mounted overlay layers as stale, forcing a full re-render next time. */
  invalidateOverlaySortIDSignature(sortID) {
    if (!this._overlayRenderSignatures) return;
    if (sortID === null || sortID === undefined) {
      this._overlayRenderSignatures.clear();
      return;
    }
    this._overlayRenderSignatures.delete(String(sortID));
  }

  invalidateOverlayRasterCacheForTemplate(sortID) {
    this.invalidateOverlaySortIDSignature(sortID);
    const sortIDStr = String(sortID);
    for (const key of this._overlayRasterCache.keys()) {
      if (key.includes(`||${sortIDStr}||`)) {
        this._overlayRasterCache.delete(key);
      }
    }
  }

  getOverlayRasterCacheKey(tileKey, sortID, drawSize, displayMode, displayedColorsHash) {
    return [tileKey, sortID, drawSize, displayMode, displayedColorsHash].join('||');
  }

  getOverlayRasterCacheEntry(cacheKey) {
    const entry = this._overlayRasterCache.get(cacheKey);
    if (!entry) return null;
    this._overlayRasterCache.delete(cacheKey);
    this._overlayRasterCache.set(cacheKey, entry);
    return entry;
  }

  setOverlayRasterCacheEntry(cacheKey, entry) {
    if (!cacheKey || !entry) return;
    if (this._overlayRasterCache.has(cacheKey)) {
      this._overlayRasterCache.delete(cacheKey);
    }
    this._overlayRasterCache.set(cacheKey, entry);
    while (this._overlayRasterCache.size > OVERLAY_RASTER_CACHE_MAX) {
      const oldestKey = this._overlayRasterCache.keys().next().value;
      if (oldestKey === undefined) break;
      this._overlayRasterCache.delete(oldestKey);
    }
  }

  getTemplateExampleLimit() {
    return DEFAULT_TEMPLATE_EXAMPLE_LIMIT;
  }

  mergeTemplateExamples(target, incoming, exampleMax) {
    mergeTemplateExampleReservoir(target, incoming, exampleMax);
  }

  /** Gets the overall color progress in all template tiles
   * @since 0.86.4
   */
  getOverallPerColorProgress() {
    // paletteSum: O(templates × colors) — not a bottleneck
    const paletteSum = {};
    (this.templatesArray ?? []).forEach(t => {
      if (!t.enabled) return;
      if (!t?.colorPalette) return;
      for (const [rgb, meta] of Object.entries(t.colorPalette)) {
        paletteSum[rgb] = (paletteSum[rgb] ?? 0) + meta.count;
      }
    });

    // counts: O(colors) from incremental running totals — no tile iteration needed
    const combinedProgress = {};
    for (const colorKey in this._runningPalette) {
      const slot = this._runningPalette[colorKey];
      combinedProgress[colorKey] = {
        painted: Math.max(0, slot.painted),
        paintedAndEnabled: Math.max(0, slot.paintedAndEnabled),
        missing: Math.max(0, slot.missing),
        examplesEnabled: [],
      };
    }

    // examples: incremental via _runningExamples; only dirty colors (removed tiles) need a full tile scan.
    if (this._examplesColorDirty.size > 0) {
      const exampleMax = this.getTemplateExampleLimit();
      // Rebuild every dirty color in a single pass over tileProgress. Scanning the whole map once
      // per dirty color is O(colors x tiles), and a template toggle dirties nearly every color at
      // once via clearTileProgress — that combination was the expensive part of this function.
      const rebuilding = new Map();
      for (const colorKey of this._examplesColorDirty) {
        rebuilding.set(colorKey, { examplesEnabled: [], _exampleSeenCount: 0 });
      }
      for (const stats of this.tileProgress.values()) {
        const palette = stats.palette;
        if (!palette) continue;
        for (const colorKey in palette) {
          const target = rebuilding.get(colorKey);
          if (!target) continue;
          const content = palette[colorKey];
          if (content?.examplesEnabled?.length) {
            mergeTemplateExampleReservoir(target, content.examplesEnabled, exampleMax);
          }
        }
      }
      for (const [colorKey, rebuilt] of rebuilding) {
        this._runningExamples[colorKey] = rebuilt;
      }
      this._examplesColorDirty.clear();
    }
    for (const colorKey in this._runningExamples) {
      if (combinedProgress[colorKey]) {
        combinedProgress[colorKey].examplesEnabled = this._runningExamples[colorKey]?.examplesEnabled ?? [];
      }
    }

    var completedColorsBitmapLo = 0;
    var completedColorsBitmapHi = 0;
    Object.entries(paletteSum).forEach(([rgb, count]) => {
      if ((combinedProgress[rgb]?.paintedAndEnabled ?? 0) >= count) {
        const colorId = rgbToMeta.get(rgb)?.id ?? 0;
        if (colorId < 32) {
          completedColorsBitmapLo |= (1 << colorId);
        } else {
          completedColorsBitmapHi |= (1 << (colorId - 32));
        }
      }
    })

    if (
      completedColorsBitmapLo !== this.completedColorsBitmapLo ||
      completedColorsBitmapHi !== this.completedColorsBitmapHi
    ) {
      const prevLo = this.completedColorsBitmapLo;
      const prevHi = this.completedColorsBitmapHi;
      this.completedColorsBitmapLo = completedColorsBitmapLo;
      this.completedColorsBitmapHi = completedColorsBitmapHi;
      if (this.areCompletedColorsHidden()) {
        // Only rebuild tiles that contain a color whose completion status changed.
        // This avoids a full N-tile rebuild just because one color finished.
        const changedLo = prevLo ^ completedColorsBitmapLo;
        const changedHi = prevHi ^ completedColorsBitmapHi;
        const changedColorIds = new Set();
        for (let bit = 0; bit < 32; bit++) {
          if (changedLo & (1 << bit)) changedColorIds.add(bit);
          if (changedHi & (1 << bit)) changedColorIds.add(bit + 32);
        }
        // Map changed color IDs → rgb keys
        const changedRgbKeys = new Set();
        for (const [rgb, meta] of rgbToMeta) {
          if (typeof meta?.id === 'number' && changedColorIds.has(meta.id)) changedRgbKeys.add(rgb);
        }
        // Collect tile prefixes that contain any of the changed colors
        const affectedPrefixes = new Set();
        for (const [prefix, stats] of this.tileProgress) {
          if (!stats?.palette) continue;
          for (const colorKey of changedRgbKeys) {
            if (stats.palette[colorKey]) { affectedPrefixes.add(prefix); break; }
          }
        }
        if (affectedPrefixes.size > 0) {
          this.createOverlayOnMap(null, { tilePrefixes: affectedPrefixes, immediate: true });
        }
        if (this.isErrorMapShown() && this.isErrorMapOnlyEnabledColorsShown()) {
          forceRefreshTiles();
        }
      }
    }
  
    return { paletteSum, combinedProgress };
  }

  /** Stores the JSON object of the user settings into TamperMonkey (GreaseMonkey) storage.
   * @since 0.85.17
   */
  async storeUserSettings() {
    await GM.setValue('bmUserSettings', JSON.stringify(this.userSettings));
  }

  /** Sets the `userSettings` object to a value.
   * @param {object} value - The value to set the object to
   * @since 0.85.17
   */
  setUserSettings(value) {
    this.userSettings = value || {};
    this.userSettings.templateSyncStreams = normalizeTemplateSyncStreamsValue(this.userSettings?.templateSyncStreams);
    const enabled = this.isDebugLoggingEnabled();
    setGlobalDebugLoggingEnabled(enabled);
    syncInjectedDebugLogging(enabled);
  }

  /** A utility to check if hidden colors are set to be hidden.
   * @since 0.85.17
   */
  areLockedColorsHidden() {
    return this.userSettings?.hideLockedColors ?? false;
  }

  /** Sets the `hideLockedColors` boolean in the `userSettings` to a value.
   * @param {boolean} value - The value to set the boolean to
   * @since 0.85.17
   */
  async setHideLockedColors(value) {
    this.userSettings.hideLockedColors = value;
    await this.storeUserSettings();
  }

  /** A utility to get the current sort criteria.
   * @since 0.85.23
   */
  getSortBy() {
    const temp = this.userSettings?.sortBy ?? 'total-desc';
    if (this.isValidSortBy(temp)) return temp;
    return 'total-desc';
  }


  /** A utility to check if the sort criteria is valid.
   * @param {string} value - The sort criteria
   * @returns {boolean}
   * @since 0.85.23
   */
  isValidSortBy(value) {
    const parts = value.toLowerCase().split("-");
    if (parts.length !== 2) return false;
    if (sortByOptions[parts[0]] === undefined) return false;
    if (!['desc', 'asc'].includes(parts[1])) return false;
    return true;
  }

  /** Sets the sort criteria to a value.
   * @param {string} value - The sort criteria
   * @returns {boolean}
   * @since 0.85.23
   */
  async setSortBy(value) {
    if (!this.isValidSortBy(value)) return false;
    this.userSettings.sortBy = value.toLowerCase();
    await this.storeUserSettings();
    return true;
  }

  /** A utility to check if hidden colors are set to be hidden.
   * @returns {boolean}
   * @since 0.85.26
   */
  isProgressBarEnabled() {
    return this.userSettings?.progressBarEnabled ?? true;
  }

  /** Sets the sort criteria to a value.
   * @param {boolean} value - The sort criteria
   * @since 0.85.23
   */
  async setProgressBarEnabled(value) {
    this.userSettings.progressBarEnabled = value;
    await this.storeUserSettings();
  }

  
  /** A utility to check if template list should show remaining count.
   * @returns {boolean}
   * @since 0.90.0
   */
  isTemplateListRemainingEnabled() {
    return this.userSettings?.templateListRemaining ?? true;
  }

  /** Sets the template list remaining count display toggle.
   * @param {boolean} value - The value
   * @since 0.90.0
   */
  async setTemplateListRemainingEnabled(value) {
    this.userSettings.templateListRemaining = value;
    await this.storeUserSettings();
  }

  /** A utility to check if completed colors are set to be hidden.
   * @returns {boolean}
   * @since 0.85.27
   */
  areCompletedColorsHidden() {
    return this.userSettings?.hideCompletedColors ?? false;
  }

  /** Sets the `hideCompletedColors` boolean in the `userSettings` to a value.
   * @param {boolean} value - The value to set the boolean to
   * @since 0.85.27
   */
  async setHideCompletedColors(value) {
    this.userSettings.hideCompletedColors = value;
    await this.storeUserSettings();
  }

  /** A utility to check if memory-saving mode is on.
   * @returns {boolean}
   * @since 0.85.27
   */
  isMemorySavingModeOn() {
    return this.userSettings?.memorySavingMode ?? false;
  }

  /** Sets the `memorySavingMode` boolean in the `userSettings` to a value.
   * @param {boolean} value - The value to set the boolean to
   * @since 0.85.33
   */
  async setMemorySavingMode(value) {
    this.userSettings.memorySavingMode = value;
    await this.storeUserSettings();
    if (value) {
      // unload template tiles in memory
      this.templatesArray.forEach( template => {
        if (!template?.chunked) return; // no bitmap
        const chunked = template.chunked;
        const temp = {};
        Object.entries(chunked).forEach(([key, value]) => {
          temp[key] = null;
          if (value === null) return;
          value.close();
        });
        template.chunked = temp;
      });
    }
  }

  /** A utility to check if debug logging is enabled.
   * @returns {boolean}
   */
  isDebugLoggingEnabled() {
    return this.userSettings?.debugLogging === true;
  }

  /** Sets debug logging visibility in console.
   * @param {boolean} value - Whether debug logging is enabled
   */
  async setDebugLoggingEnabled(value) {
    const enabled = value === true;
    this.userSettings.debugLogging = enabled;
    setGlobalDebugLoggingEnabled(enabled);
    syncInjectedDebugLogging(enabled);
    await this.storeUserSettings();
  }

  /** A utility to check if only the currently selected color is shown.
   * @returns {boolean}
   * @since 0.85.37
   */
  isOnlyCurrentColorShown() {
    return this.userSettings?.onlyCurrentColorShown ?? false;
  }

  /** Sets the onlyCurrentColorShown to a value.
   * @param {boolean} value - The value
   * @since 0.85.37
   */
  async setOnlyCurrentColorShown(value) {
    this.userSettings.onlyCurrentColorShown = value;
    await this.storeUserSettings();
  }

  /** A utility to check if the theme is overridden.
   * @returns {boolean}
   * @since 0.85.40
   */
  isThemeOverridden() {
    return this.userSettings?.themeOverridden ?? false;
  }

  /** Sets the themeOverridden to a value.
   * @param {boolean} value - The value
   * @since 0.85.40
   */
  async setThemeOverridden(value) {
    this.userSettings.themeOverridden = value;
    await this.storeUserSettings();
  }

  /** A utility to return the current theme.
   * @returns {string}
   * @since 0.85.40
   */
  getCurrentTheme() {
    const temp = (this.userSettings?.currentTheme ?? Object.keys(themeList)[0]).toLowerCase();
    if (themeList[temp]) return temp;
    return Object.keys(themeList)[0];
  }

  /** Sets the current theme to a value.
   * @param {string} value - The value
   * @returns {boolean}
   * @since 0.85.40
   */
  async setCurrentTheme(value) {
    value = value.toLowerCase();
    if (!themeList[value]) return false;
    this.userSettings.currentTheme = value;
    await this.storeUserSettings();
    return true;
  }

  /** A utility to return the current layout theme.
   * @returns {string}
   * @since 0.85.47
   */
  getLayoutTheme() {
    return String(this.userSettings?.layoutTheme ?? 'classic').toLowerCase();
  }

  /** A utility to return the current layout language.
   * @returns {string}
   */
  getLayoutLanguage() {
    return String(this.userSettings?.layoutLanguage ?? 'en').toLowerCase();
  }

  /** Sets the current layout theme to a value.
   * @param {string} value - The value
   * @since 0.85.47
   */
  async setLayoutTheme(value) {
    this.userSettings.layoutTheme = String(value ?? 'classic').toLowerCase();
    await this.storeUserSettings();
  }

  /** A utility to return the user-defined custom theme palette.
   * @returns {object} The raw stored palette; callers normalize it.
   * @since 0.87.76
   */
  getCustomTheme() {
    const stored = this.userSettings?.customTheme;
    return (stored && typeof stored === 'object') ? stored : {};
  }

  /** Stores the user-defined custom theme palette.
   * @param {object} value - The palette, keyed by token name.
   * @since 0.87.76
   */
  async setCustomTheme(value) {
    this.userSettings.customTheme = (value && typeof value === 'object') ? { ...value } : {};
    await this.storeUserSettings();
  }

  /** Whether the custom theme also repaints wplace's own UI.
   * @returns {boolean}
   * @since 0.87.76
   */
  getCustomThemeApplyToSite() {
    return this.userSettings?.customThemeApplyToSite === true;
  }

  /** Sets whether the custom theme also repaints wplace's own UI.
   * @param {boolean} value
   * @since 0.87.76
   */
  async setCustomThemeApplyToSite(value) {
    this.userSettings.customThemeApplyToSite = !!value;
    await this.storeUserSettings();
  }

  /** Sets the current layout language to a value.
   * @param {string} value - The value
   */
  async setLayoutLanguage(value) {
    this.userSettings.layoutLanguage = String(value ?? 'en').toLowerCase();
    await this.storeUserSettings();
  }

  /** A utility to check if the status textbox is hidden.
   * @returns {boolean}
   * @since 0.85.41
   */
  isStatusHidden() {
    return this.userSettings?.hideStatus ?? false;
  }

  /** Sets the hideStatus to a value.
   * @param {boolean} value - The value
   * @since 0.85.41
   */
  async setStatusHidden(value) {
    this.userSettings.hideStatus = value;
    await this.storeUserSettings();
  }

  /** A utility to check if droplets are hidden
   * @returns {boolean}
   * @since 0.90.0
   */
  isDropletsHidden() {
    return this.userSettings?.hideDroplets ?? false;
  }

  /** Sets the hideDroplets to a value.
   * @param {boolean} value - The value
   * @since 0.90.0
   */
  async setDropletsHidden(value) {
    this.userSettings.hideDroplets = value;
    await this.storeUserSettings();
  }

  /** A utility to check if next level progress is hidden
   * @returns {boolean}
   * @since 0.90.0
   */
  isNextLevelHidden() {
    return this.userSettings?.hideNextLevel ?? false;
  }

  /** Sets the hideNextLevel to a value.
   * @param {boolean} value - The value
   * @since 0.90.0
   */
  async setNextLevelHidden(value) {
    this.userSettings.hideNextLevel = value;
    await this.storeUserSettings();
  }

  /** Returns the template display mode.
   * @returns {string}
   * @since 0.90.0
   */
  getTemplateDisplayMode() {
    const raw = String(this.userSettings?.templateDisplay ?? '').toLowerCase();
    if (raw === 'cross-z') return 'cross-z-9';
    if (raw === 'dot' || raw === 'fill' || raw === 'cross' || raw === 'cross-z-9' || raw === 'cross-z-11') return raw;
    const legacy = this.userSettings?.legacyDisplay ?? this.userSettings?.isLegacyDisplay ?? false;
    return legacy ? 'dot' : 'cross';
  }

  /** Returns the draw size for the given template display mode.
   * @param {string} mode - The display mode
   * @returns {number}
   * @since 0.90.0
   */
  getTemplateDrawSize(mode) {
    if (mode === 'dot') return 3;
    if (mode === 'cross-z-11') return 11;
    if (mode === 'cross-z-9') return 9;
    return this.drawMult;
  }

  /** Sets the template display mode.
   * @param {string} value - The value
   * @since 0.90.0
   */
  async setTemplateDisplayMode(value) {
    const raw = String(value ?? '').toLowerCase();
    const mode = (raw === 'dot' || raw === 'fill' || raw === 'cross' || raw === 'cross-z-9' || raw === 'cross-z-11')
      ? raw
      : 'cross';
    this.userSettings.templateDisplay = mode;
    const isDot = mode === 'dot';
    this.userSettings.legacyDisplay = isDot;
    this.userSettings.isLegacyDisplay = isDot;
    await this.storeUserSettings();
  }

  /** Returns the mask points for the current template display mode.
   * @param {string} mode - The display mode
   * @param {number} size - The mask size
   * @param {Template} template - The template instance
   * @returns {Array<Array<number>>}
   * @since 0.90.0
   */
  getTemplateMaskPoints(mode, size, template) {
    return getTemplateMaskPoints(mode, size);
  }

  /** A utility to check if it uses the dot template display (legacy).
   * @returns {boolean}
   * @since 0.85.46
   */
  isLegacyDisplay() {
    return this.getTemplateDisplayMode() === 'dot';
  }

  /** Sets the legacyDisplay to a value.
   * @param {boolean} value - The value
   * @since 0.85.46
   */
  async setLegacyDisplay(value) {
    await this.setTemplateDisplayMode(value ? 'dot' : 'cross');
  }

  /** A utility to determine whether the error map should be shown
   * @returns {boolean}
   * @since 0.85.46
   */
  isErrorMapShown() {
    return this.userSettings?.showErrorMap ?? false;
  }

  /** Sets the showErrorMap to a value.
   * @param {boolean} value - The value
   * @since 0.85.46
   */
  async setErrorMapShown(value) {
    this.userSettings.showErrorMap = value;
    setUsageLayersOpacity("overlay", value ? 0 : 1);
    await this.storeUserSettings();
  }

  /** A utility to deterine whether the error map only covers the enabled colors
   * @returns {boolean}
   * @since 0.86.14
   */
  isErrorMapOnlyEnabledColorsShown() {
    return this.userSettings?.showOnlyEnabledColorsErrorMap ?? false;
  }

  /** Sets the showOnlyEnabledColorsErrorMap to a value.
   * @param {boolean} value - The value
   * @since 0.86.14
   */
  async setErrorMapOnlyEnabledColorsShown(value) {
    this.userSettings.showOnlyEnabledColorsErrorMap = value;
    await this.storeUserSettings();
  }

  /** A utility to check if zoom buttons are shown
   * @returns {boolean}
   * @since 0.86.10
   */
  areIntegerZoomButtonsShown() {
    return this.userSettings?.showIntegerZoom ?? false;
  }

  /** How #deface (erase) pixels are shown.
   *   'off'     - nothing at all, leaving wplace's own punched-out rendering visible
   *   'color'   - their own colour, rgb(222,250,206)
   *   'crossed' - a hollow cross drawn over wplace's pixels
   * @returns {'off'|'color'|'crossed'}
   * @since 0.87.83
   */
  getDefaceDisplayMode() {
    const stored = this.userSettings?.defaceDisplayMode;
    if (stored === 'crossed' || stored === 'color' || stored === 'off') return stored;
    // Migrates the boolean this setting shipped as before the mode existed.
    return this.userSettings?.showDefaceCrossed === true ? 'crossed' : 'off';
  }

  /** Sets how #deface pixels are shown.
   * @param {'off'|'color'|'crossed'} value - The mode
   * @since 0.87.83
   */
  async setDefaceDisplayMode(value) {
    const mode = (value === 'crossed' || value === 'color') ? value : 'off';
    this.userSettings.defaceDisplayMode = mode;
    delete this.userSettings.showDefaceCrossed;
    await this.storeUserSettings();
    // Every #deface pixel now rasterizes differently, and the mode is not part of the overlay
    // raster cache key, so drop the cached rasters and the signatures that would skip the redraw.
    this._overlayRasterCache?.clear();
    this._overlayRenderSignatures?.clear?.();
  }


  /** Sets the showIntegerZoom to a value.
   * @param {boolean} value - The value
   * @since 0.86.10
   */
  async setIntegerZoomButtonsShown(value) {
    this.userSettings.showIntegerZoom = value;
    await this.storeUserSettings();
  }

  /** A utility to enable / disable arrow key keybinds
   * @returns {boolean}
   * @since 0.86.12
   */
  areKeybindsEnabled() {
    return this.userSettings?.enableKeybinds ?? false;
  }

  /** Sets the enableKeybinds to a value.
   * @param {boolean} value - The value
   * @since 0.86.12
   */
  async setKeybindsEnabled(value) {
    this.userSettings.enableKeybinds = value;
    await this.storeUserSettings();
  }

  /** A utility to enable / disable the jump-to-next-template-pixel shortcut.
   * @returns {boolean}
   * @since 0.90.0
   */
  isBackgroundModeEnabled() {
    return this.userSettings?.backgroundMode ?? false;
  }

  async setBackgroundModeEnabled(value) {
    this.userSettings.backgroundMode = Boolean(value);
    await this.storeUserSettings();
  }

  /** Records the tile PNG the page just received, for the overlay's live-canvas comparison.
   * @param {string} tileKey - Padded "tileX,tileY".
   * @param {Blob} blob - The tile PNG.
   * @param {string|null} lastModified - The response's Last-Modified, used as the decode cache tag.
   * @since 0.87.83
   */
  setLatestTileBlob(tileKey, blob, lastModified = null) {
    if (!tileKey || !blob) return;
    // Small and strictly bounded: only the tiles currently on screen are ever asked for.
    this._tileBlobEpoch++;
    if (this._latestTileBlobs.has(tileKey)) this._latestTileBlobs.delete(tileKey);
    this._latestTileBlobs.set(tileKey, { blob, lastModified, time: Date.now() });
    while (this._latestTileBlobs.size > 24) {
      this._latestTileBlobs.delete(this._latestTileBlobs.keys().next().value);
    }
  }

  /** @returns {{blob: Blob, lastModified: string|null}|null} The last tile PNG seen for that tile. */
  getLatestTileBlob(tileKey) {
    return this._latestTileBlobs.get(tileKey) ?? null;
  }

  /** Live canvas pixels for a tile, decoded from the copy the page already loaded.
   *
   * Deliberately never fetches: asking for the tile ourselves goes through wplace's service
   * worker, which owns that URL and composes the pixels being painted, and the extra traffic was
   * stalling tile loading during painting. No copy yet simply means no filtering this pass.
   * @param {string} tileKey - Padded "tileX,tileY".
   * @returns {Promise<Uint8ClampedArray|null>}
   * @since 0.87.89
   */
  async getCachedTilePixels(tileKey) {
    const latest = this._latestTileBlobs.get(tileKey);
    if (!latest?.blob) return null;
    if (latest.pixels) return latest.pixels;
    if (latest.decoding) return latest.decoding;

    const size = this.tileSize;
    latest.decoding = (async () => {
      let canvas = null;
      try {
        const bitmap = await createBitmapPreservingPixels(latest.blob);
        canvas = new OffscreenCanvas(size, size);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, size, size);
        context.drawImage(bitmap, 0, 0, size, size);
        bitmap.close();
        const pixels = context.getImageData(0, 0, size, size).data;
        latest.pixels = pixels;
        return pixels;
      } catch (exception) {
        consoleWarn('[deface] Could not decode the cached tile.', exception);
        return null;
      } finally {
        latest.decoding = null;
        if (canvas) cleanUpCanvas(canvas);
        canvas = null;
      }
    })();
    return latest.decoding;
  }

  setLivePixelsFetcher(fn) {
    this._livePixelsFetcher = typeof fn === 'function' ? fn : null;
  }

  isNextTemplatePixelShortcutEnabled() {
    return this.userSettings?.enableNextTemplatePixelShortcut ?? true;
  }

  /** Sets the jump-to-next-template-pixel shortcut enabled state.
   * @param {boolean} value - The value
   * @since 0.90.0
   */
  async setNextTemplatePixelShortcutEnabled(value) {
    this.userSettings.enableNextTemplatePixelShortcut = Boolean(value);
    await this.storeUserSettings();
  }

  /** A utility to check if chat is disabled.
   * @returns {boolean}
   * @since 0.88.1
   */
  isChatDisabled() {
    return this.userSettings?.chatDisabled ?? false;
  }

  /** Sets the chatDisabled flag.
   * @param {boolean} value - The value
   * @since 0.88.1
   */
  async setChatDisabled(value) {
    this.userSettings.chatDisabled = value;
    await this.storeUserSettings();
  }

  /** A utility to check if map comments are disabled.
   * @returns {boolean}
   * @since 0.90.0
   */
  isMapCommentsDisabled() {
    return this.userSettings?.mapCommentsDisabled ?? false;
  }

  /** A utility to check if map comments are enabled.
   * @returns {boolean}
   * @since 0.90.0
   */
  isMapCommentsEnabled() {
    return !this.isMapCommentsDisabled();
  }

  /** Sets the map comments disabled flag.
   * @param {boolean} value - The value
   * @since 0.90.0
   */
  async setMapCommentsDisabled(value) {
    this.userSettings.mapCommentsDisabled = Boolean(value);
    await this.storeUserSettings();
  }

  /** Sets the map comments enabled flag.
   * @param {boolean} value - The value
   * @since 0.90.0
   */
  async setMapCommentsEnabled(value) {
    this.userSettings.mapCommentsDisabled = !Boolean(value);
    await this.storeUserSettings();
  }

  /** A utility to check if safe mode is enabled.
   * @returns {boolean}
   * @since 0.90.0
   */
  isSafeModeEnabled() {
    return this.userSettings?.safeMode === true;
  }

  /** Sets the safe mode flag.
   * @param {boolean} value - The value
   * @since 0.90.0
   */
  async setSafeModeEnabled(value) {
    this.userSettings.safeMode = Boolean(value);
    await this.storeUserSettings();
  }

  /** Whether the Ruspixel flag background is enabled for pixel info.
   * @returns {boolean}
   * @since 0.87.6
   */
  isRuspixelFlagEnabled() {
    return this.userSettings?.ruspixelFlagEnabled ?? true;
  }

  /** Sets the ruspixelFlagEnabled flag.
   * @param {boolean} value - The value
   * @since 0.87.6
   */
  async setRuspixelFlagEnabled(value) {
    this.userSettings.ruspixelFlagEnabled = value;
    await this.storeUserSettings();
  }

  /** Whether auto-sync for remote templates is enabled.
   * @returns {boolean}
   * @since 0.87.6
   */
  isTemplateAutoSyncEnabled() {
    return this.userSettings?.autoSyncTemplates ?? false;
  }

  /** Sets auto-sync for remote templates.
   * @param {boolean} value - The value
   * @since 0.87.6
   */
  async setTemplateAutoSyncEnabled(value) {
    this.userSettings.autoSyncTemplates = value;
    await this.storeUserSettings();
  }

  isArchiveBackgroundEnabled() {
    return this.userSettings?.archiveBackgroundEnabled ?? false;
  }

  async setArchiveBackgroundEnabled(value) {
    this.userSettings.archiveBackgroundEnabled = Boolean(value);
    await this.storeUserSettings();
  }

  /** Returns configured remote template streams.
   * @returns {string[]}
   */
  getTemplateSyncStreams() {
    return normalizeTemplateSyncStreamsValue(this.userSettings?.templateSyncStreams);
  }

  /** Sets remote template streams.
   * @param {string[]|string} value
   */
  async setTemplateSyncStreams(value) {
    const nextStreams = normalizeTemplateSyncStreamsValue(value);
    this.userSettings.templateSyncStreams = nextStreams;
    await this.storeUserSettings();
    return await this.pruneRemoteTemplatesByStreams(nextStreams);
  }

  /** Removes remote templates that belong to streams outside the allowed set.
   * @param {string[]|string} allowedStreams
   * @returns {Promise<number>}
   */
  async pruneRemoteTemplatesByStreams(allowedStreams) {
    const allowed = new Set(normalizeTemplateSyncStreamsValue(allowedStreams));
    const remoteTemplatesToRemove = (this.templatesArray ?? []).filter((template) => {
      if (!template) return false;
      const store = this.templatesJSON?.templates?.[template.storageKey] ?? {};
      const isRemote = template.isRemote === true || store.remote === true;
      if (!isRemote) return false;
      // Manually added templates are kept even when their stream is disabled — the user asked for
      // them by name, they were never pulled in by the stream listing.
      if (template.remoteManual === true || store.remoteManual === true) return false;
      const stream = normalizeTemplateSyncStreamValue(template.remoteStream ?? store.remoteStream);
      return !allowed.has(stream);
    });
    if (remoteTemplatesToRemove.length === 0) {
      this.requestListRebuild();
      return 0;
    }

    for (const template of remoteTemplatesToRemove) {
      const removeIndex = this.templatesArray.indexOf(template);
      if (removeIndex >= 0) {
        this.templatesArray.splice(removeIndex, 1);
      }
      if (template?.storageKey && this.templatesJSON?.templates?.[template.storageKey]) {
        delete this.templatesJSON.templates[template.storageKey];
      }
      this.clearTileProgress(template);
      removeLayer(null, template.sortID);
    }

    await this.storeTemplates();
    this.requestListRebuild();
    this.overlay.handleDisplayStatus(
      `Removed ${remoteTemplatesToRemove.length} remote template${remoteTemplatesToRemove.length === 1 ? '' : 's'} from disabled stream${remoteTemplatesToRemove.length === 1 ? '' : 's'}.`
    );
    return remoteTemplatesToRemove.length;
  }

  /** Sets the `extraColorsBitmap` to an updated mask, refresh the color filter if changed.
   * @param {number} value - The value to set the mask to
   * @since 0.85.17
   */
  updateExtraColorsBitmap(value) {
    if (this.extraColorsBitmap === value) return;
    // the extra colors bitmap has changed
    this.extraColorsBitmap = value;
    window.buildColorFilterList();
    this.createOverlayOnMap();
  }

  /** A utility to check if a color is unlocked.
   * @param {number} color - The id of the color
   * @returns {boolean}
   * @since 0.85.17
   */
  isColorUnlocked(color) {
    if (this.extraColorsBitmap === -1) return true; // all colors unlocked
    if (color < 32) return true;
    const mask = 1 << (color - 32);
    return (this.extraColorsBitmap & mask) !== 0;
  }

  /** A utility to check if a color is unlocked.
   * @param {number} color - The id of the color
   * @returns {boolean}
   * @since 0.86.4
   */
  isColorCompleted(color) {
    if (color < 32) {
      const mask = 1 << color;
      return (this.completedColorsBitmapLo & mask) !== 0;
    } else {
      const mask = 1 << (color - 32);
      return (this.completedColorsBitmapHi & mask) !== 0;
    }
  }

  /** A utility clear all the tiles related to a template
   * @param {Template} template
   * @since 0.85.19
   */
  // Apply a tile's palette/template counts to running totals. sign = +1 to add, -1 to subtract.
  _applyTileToRunning(stats, sign) {
    if (!stats) return;
    const palette = stats.palette;
    if (palette) {
      const exampleMax = this.getTemplateExampleLimit();
      for (const colorKey in palette) {
        const entry = palette[colorKey];
        if (!entry) continue;
        let slot = this._runningPalette[colorKey];
        if (!slot) {
          slot = { painted: 0, paintedAndEnabled: 0, missing: 0 };
          this._runningPalette[colorKey] = slot;
        }
        slot.painted += sign * (entry.painted || 0);
        slot.paintedAndEnabled += sign * (entry.paintedAndEnabled || 0);
        slot.missing += sign * (entry.missing || 0);

        // Maintain incremental examples reservoir.
        if (sign === 1 && Array.isArray(entry.examplesEnabled) && entry.examplesEnabled.length > 0) {
          // On add: skip if this color is already dirty (rebuild will include this tile via tileProgress).
          if (!this._examplesColorDirty.has(colorKey)) {
            if (!this._runningExamples[colorKey]) {
              this._runningExamples[colorKey] = { examplesEnabled: [], _exampleSeenCount: 0 };
            }
            mergeTemplateExampleReservoir(this._runningExamples[colorKey], entry.examplesEnabled, exampleMax);
          }
        } else if (sign === -1 && Array.isArray(entry.examplesEnabled) && entry.examplesEnabled.length > 0) {
          // On remove: reservoir sampling is not invertible — mark for full rebuild.
          this._examplesColorDirty.add(colorKey);
          delete this._runningExamples[colorKey];
        }
      }
    }
    const template = stats.template;
    if (template) {
      for (const storageKey in template) {
        const entry = template[storageKey];
        if (!entry) continue;
        let slot = this._runningTemplate[storageKey];
        if (!slot) {
          slot = { painted: 0, palette: Object.create(null) };
          this._runningTemplate[storageKey] = slot;
        }
        slot.painted += sign * (entry.painted || 0);
        const pal = entry.palette;
        if (pal) {
          for (const colorKey in pal) {
            slot.palette[colorKey] = (slot.palette[colorKey] || 0) + sign * (Number(pal[colorKey]) || 0);
          }
        }
      }
    }
  }

  // Set a tile's progress and keep running totals in sync.
  _setTileProgress(key, stats) {
    const old = this.tileProgress.get(key);
    if (old) this._applyTileToRunning(old, -1);
    this.tileProgress.set(key, stats);
    if (stats) this._applyTileToRunning(stats, +1);
  }

  // Delete a tile's progress and keep running totals in sync.
  _deleteTileProgress(key) {
    const old = this.tileProgress.get(key);
    if (old) this._applyTileToRunning(old, -1);
    this.tileProgress.delete(key);
  }

  clearTileProgress(template) {
    // may improve: only delete those tiles that are no longer involved in other templates
    template.tilePrefixes.forEach(prefix => {
      this._deleteTileProgress(prefix);
      // this.tileOverlay.delete(prefix);
    });
    // should not be needed if color filter list (that calls getOverallPerColorProgress) is called after this. But just in case
    this.completedColorsBitmapLo = 0;
    this.completedColorsBitmapHi = 0;
  }
}
