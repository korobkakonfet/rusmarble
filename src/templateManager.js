import Template from "./Template";
import { numberToEncoded, cleanUpCanvas, rgbToMeta, sortByOptions, testCanvasSize, getCurrentColor, sleep, createBitmapPreservingPixels, consoleLog, setDebugLoggingEnabled as setGlobalDebugLoggingEnabled } from "./utils";
import { themeList, addTemplateCanvas, removeLayer, removeTemplateCanvasSources, forceRefreshTiles, coordsGeoCoordsToTileCoords, getMapBounds, doAfterMapFound, isMapTilerLoaded, bmCanvas, getMountedTemplateCanvasSourceIDs } from './utilsMaptiler.js';
import { buildMaskRowSpans, collectTemplateProgressFromSamples, mergeTemplateExampleReservoir, renderSampleDataToImage } from './templateChunkUtils.js';

const DEFAULT_TEMPLATE_SYNC_STREAM = 'root';
const DEFAULT_TEMPLATE_EXAMPLE_LIMIT = 32;
const SMART_TEMPLATE_EXAMPLE_LIMIT = 128;
const TEMPLATE_OTHER_COLOR_KEY = 'other';
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
const UI_WORK_SLICE_MS = 8;
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
    // this.tileOverlay = new Map(); // Cache tile overlay to save time
    this.extraColorsBitmap = 0; // List of unlocked colors, set by apiManager
    this.completedColorsBitmapLo = 0; // 0 ~ 31
    this.completedColorsBitmapHi = 0; // 32 ~ 63 List of completed colors, calculated when getOverallPerColorProgress is called
    this.userSettings = {}; // User settings
    this.hideLockedColors = false; 
    this.largestSeenSortID = 0; // Even a safer approach: recording the largest storage Keys that have been used in this session. Don't remove anything here.
    this.importPromise = Promise.resolve();
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
   * @param {string} anchor - The anchor of the template
   * @since 0.65.77
   */
  async createTemplate(file, name, coords, anchor, options = {}) {
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
      keepBitmapTilesInMemory: options?.keepBitmapTilesInMemory ?? !preferBitmapTileStorage,
      persistChunkSamples: options?.persistChunkSamples ?? !preferBitmapTileStorage,
      keepChunkSamplesInMemory: options?.keepChunkSamplesInMemory ?? !preferBitmapTileStorage,
    };
    this.largestSeenSortID++;
    template.shreadSize = this.drawMult; // Copy to template's shread Size
    //template.chunked = await template.createTemplateTiles(this.tileSize); // Chunks the tiles
    const {
      templateTiles,
      templateTilesBuffers,
      templateChunkSamples,
      templateChunkSampleBuffers,
      templateTileKeys,
    } = await template.createTemplateTiles(anchor || this.getAnchor(), createTileOptions); // Chunks the tiles
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
    template.chunkedSamplesBuffer = createTileOptions.persistChunkSamples === false ? {} : templateChunkSampleBuffers;
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
      "samples": createTileOptions.persistChunkSamples ? templateChunkSampleBuffers : {},
      "tileKeys": templateTileKeys,
      "palette": template.colorPalette, // Persist palette and enabled flags
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
    const pixelCountFormatted = new Intl.NumberFormat().format(template.pixelCount);
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

  requestEventRebuild() {
    if (!this.isEventEnabled()) return;
    try {
      const templateUI = document.querySelector('#bm-contain-eventlist');
      if (templateUI) { templateUI.style.display = ''; }
      // Deferred palette list rendering; actual DOM is built in main via helper
      window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-event-list' }, '*');
    } catch (_) { /* no-op */ }
  }

  /** Generates a {@link Template} class instance from the JSON object template
   */
  #loadTemplate() {

  }

  /** Stores the JSON object of the loaded templates into TamperMonkey (GreaseMonkey) storage.
   * @since 0.72.7
   */
  async storeTemplates() {
    await GM.setValue('bmTemplates', JSON.stringify(this.templatesJSON));
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
    const displayedColors = errorMapOnlyEnabledColors ? new Set(this.getDisplayedColorsSorted()) : null;

    let paintedCount = 0;
    let wrongCount = 0;
    let requiredCount = 0;
    let paletteStats = {};
    let templateStats = {};

    const tileBitmap = await createBitmapPreservingPixels(tileBlob);
    const isErrorMapShown = this.isErrorMapShown();
    const tileSize = this.tileSize;
    const exampleMax = this.getTemplateExampleLimit();

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
        errorContext.clearRect(0, 0, errorWidth, errorHeight);
        errorImage = errorContext.getImageData(0, 0, errorWidth, errorHeight);
        errorData = errorImage.data;
      }

      const offsetXResult = templateTile.pixelCoords[0];
      const offsetYResult = templateTile.pixelCoords[1];

      try {
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
          errorContext.putImageData(errorImage, 0, 0);
          addTemplateCanvas(template.sortID, templateTile.tileKey, [errorWidth, errorHeight], errorCanvas, "error");
          cleanUpCanvas(errorCanvas);
          errorCanvas = null;
        }
      } catch (exception) {
        console.warn('Failed to compute per-tile painted/wrong stats:', exception);
      }
    }

    if (templateCount === 0) {
      if (this.tileProgress.has(tileCoordsPadded)) {
        this.tileProgress.delete(tileCoordsPadded);
      }
    } else {
      this.tileProgress.set(tileCoordsPadded, {
        painted: paintedCount,
        required: requiredCount,
        wrong: wrongCount,
        palette: paletteStats,
        template: templateStats,
      });
    }

    let aggPainted = 0;
    const templateEnabledState = Object.fromEntries((this?.templatesArray ?? []).map((template) => [template.storageKey, template.enabled]));
    for (const stats of this.tileProgress.values()) {
      Object.entries(stats.template).forEach(([storageKey, content]) => {
        if (!templateEnabledState[storageKey]) return;
        aggPainted += content.painted || 0;
      });
    }

    const totalRequired = this.templatesArray.reduce((sum, template) =>
      sum + (template.enabled ? (template.requiredPixelCount || template.pixelCount || 0) : 0), 0);

    const paintedStr = new Intl.NumberFormat().format(aggPainted);
    const requiredStr = new Intl.NumberFormat().format(totalRequired);
    const wrongStr = new Intl.NumberFormat().format(totalRequired - aggPainted);

    this.overlay.handleDisplayStatus(
      `Displaying ${enabledTemplateCount} template${enabledTemplateCount == 1 ? '' : 's'}.\nPainted ${paintedStr} / ${requiredStr} • Wrong ${wrongStr}`
    );

    cleanUpCanvas(canvas);

    if (typeof window.scheduleProgressUiRefresh === 'function') {
      window.scheduleProgressUiRefresh();
    } else {
      window.buildColorFilterList?.();
      window.buildTemplateFilterList?.();
    }

    return tileBlob;
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
        needsRun: false
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

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (!state.promise) {
      state.promise = new Promise((resolve, reject) => {
        state.resolve = resolve;
        state.reject = reject;
      });
    }

    state.timer = setTimeout(async () => {
      state.timer = null;
      state.running = true;
      const pending = state.pendingSortID;
      const pendingOptions = state.pendingOptions;
      const followUpFull = !!(pendingOptions?.followUpFull && pendingOptions?.tilePrefixes);
      state.pendingSortID = undefined;
      state.pendingOptions = null;
      try {
        await this._createOverlayOnMapInternal(pending, pendingOptions);
        state.resolve?.();
      } catch (err) {
        state.reject?.(err);
      } finally {
        state.promise = null;
        state.resolve = null;
        state.reject = null;
        state.running = false;
        if (state.needsRun) {
          state.needsRun = false;
          this.createOverlayOnMap(state.pendingSortID ?? null, state.pendingOptions ?? null);
        } else if (followUpFull) {
          this.createOverlayOnMap(pending ?? null);
        }
      }
    }, normalizedOptions?.immediate ? 0 : 100);

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
  async createOverlayOnMapVisibleOnly(sortID = null) {
    const visiblePrefixes = this.getVisibleTilePrefixes();
    if (visiblePrefixes && visiblePrefixes.size) {
      this.pruneOverlayToVisiblePrefixes(sortID, visiblePrefixes);
      return this.createOverlayOnMap(sortID, { tilePrefixes: visiblePrefixes, immediate: true, skipExisting: true });
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

  /** Queue an overlay refresh after the browser has had a chance to paint UI updates first.
   * @param {number?} sortID
   * @param {object?} options
   * @since 0.90.0
   */
  async queueOverlayRefreshAfterUi(sortID = null, options = null) {
    await waitForUiPaint();
    return this.createOverlayOnMap(sortID, options);
  }

  /** Add the template overlay layer to the map (no debounce)
   * @param {number?} sortID
   * @since 0.86.1
   */
  async _createOverlayOnMapInternal(sortID = null, options = null) {
    const yieldUi = createUiWorkScheduler();
    const tilePrefixSet = options?.tilePrefixes ?? null;
    const skipExisting = options?.skipExisting === true;
    const mountedOverlaySourceIDs = skipExisting
      ? new Set(getMountedTemplateCanvasSourceIDs('overlay'))
      : null;

    const currentMemorySavingMode = this.isMemorySavingModeOn(); // To make sure that we do not free the object if it is stored due to race conditions.
    const templates = (this.templatesArray ?? []).filter(t => t.enabled && (sortID === null || t.sortID == sortID));
    // Keep color visibility consistent across all templates rendered in this pass.
    const displayedColors = this.getDisplayedColorsSorted();
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
    const hasColorDisabled = displayedColors.length !== Object.keys(this.getPaletteToggledStatus()).length;
    const allColorsDisabled = displayedColors.length === 0; // Check if every color is disabled

    for (const template of templates) {
      await yieldUi();
      if (!template.enabled) return; // no need to draw if template is disabled
      if (allColorsDisabled) {
        // make sure we removed all layers related to this template
        removeLayer("overlay", template.sortID);
        continue;
      };
      const displayMode = this.getTemplateDisplayMode();
      const drawMultResult = this.getTemplateDrawSize(displayMode);
      const maskPoints = this.getTemplateMaskPoints(displayMode, drawMultResult, template);
      const maskRowSpans = buildMaskRowSpans(maskPoints, drawMultResult);
      const tileKeys = this._getTemplateTileKeys(template, tilePrefixSet);
      if (!tileKeys.length) {
        continue;
      }
      for (const tileKey of tileKeys) {
        await yieldUi();
        const sourceID = `BM-overlay-${tileKey}-${template.sortID}`;
        if (skipExisting && mountedOverlaySourceIDs?.has(sourceID)) {
          continue;
        }
        const drawMultTemplate = template.shreadSize;
        const drawMultCenterTemplate = (template.shreadSize - 1) >> 1;
        // Prefer sample-based overlay rendering even for bitmap-backed chunks.
        // This keeps the displayed shape consistent across browsers and avoids
        // occasional Chrome bitmap-path glitches where the cross mask is not visible.
        const sampleData = await template.getChunkSamples(tileKey, {
          memorySaving: currentMemorySavingMode,
        });
        const templateTileBitmap = sampleData
          ? null
          : await template.getChunked(tileKey, currentMemorySavingMode);
        const originalWidth = sampleData
          ? sampleData.width
          : Math.max(1, Math.round((templateTileBitmap?.width || 0) / template.shreadSize));
        const safeOriginalWidth = Math.max(1, Math.round(Number(originalWidth) || 0));
        const originalHeight = sampleData
          ? sampleData.height
          : Math.max(1, Math.round((templateTileBitmap?.height || 0) / template.shreadSize));
        const safeOriginalHeight = Math.max(1, Math.round(Number(originalHeight) || 0));
        const resultWidth = safeOriginalWidth * drawMultResult; // Calculate draw multiplier for scaling
        const resultHeight = safeOriginalHeight * drawMultResult;

        let resultCanvas = new OffscreenCanvas(resultWidth, resultHeight);
        const resultContext = resultCanvas.getContext('2d');

        resultContext.imageSmoothingEnabled = false; // Nearest neighbor

        // Tells the canvas to ignore anything outside of this area
        resultContext.beginPath();
        resultContext.rect(0, 0, resultWidth, resultHeight);
        resultContext.clip();

        resultContext.clearRect(0, 0, resultWidth, resultHeight); // Draws transparent background

        try {
          if (sampleData) {
            const image = resultContext.createImageData(resultWidth, resultHeight);
            if (!hasColorDisabled && drawMultTemplate === drawMultResult && displayMode !== 'fill') {
              renderSampleDataToImage({
                sampleData,
                imageData: image,
                resultWidth,
                drawSize: drawMultResult,
                maskPoints,
                maskRowSpans,
                includeDefaceCheckerboard: true,
              });
            } else if (!allColorsDisabled) {
              renderSampleDataToImage({
                sampleData,
                imageData: image,
                resultWidth,
                drawSize: drawMultResult,
                maskPoints,
                maskRowSpans,
                displayedColorSet,
                includeDefaceCheckerboard: false,
              });
            }
            resultContext.putImageData(image, 0, 0);
          } else if (!hasColorDisabled && drawMultTemplate === drawMultResult && displayMode !== 'fill') {
            resultContext.drawImage(templateTileBitmap, 0, 0);
          } else if (!allColorsDisabled) {
            // ELSE we need to apply the color filter
            const templateWidth = templateTileBitmap.width;
            const templateHeight = templateTileBitmap.height;
            let templateCanvas = new OffscreenCanvas(templateWidth, templateHeight);
            const templateContext = templateCanvas.getContext('2d', { willReadFrequently: true });
            templateContext.imageSmoothingEnabled = false;
            templateContext.clearRect(0, 0, templateWidth, templateHeight);
            templateContext.drawImage(templateTileBitmap, 0, 0);
            const templateData = templateContext.getImageData(0, 0, templateWidth, templateHeight).data;
            const image = resultContext.createImageData(resultWidth, resultHeight);
            const imageData = image.data;
            const drawMultCenterTemplateLocal = drawMultCenterTemplate;
            const drawMultTemplateStepBytes = drawMultTemplate << 2;
            const drawMultResultStepBytes = drawMultResult << 2;
            const templateRowStepBytes = templateWidth << 2;
            const resultRowStepBytes = resultWidth << 2;
            const shouldCheckUnknownColors = displayOtherColor === true;
            for (const [offsetX, offsetY] of maskPoints) {
              let processedRows = 0;
              for (
                let yt = drawMultCenterTemplateLocal, yr = offsetY;
                yt < templateHeight;
                yt += drawMultTemplate, yr += drawMultResult
              ) {
                processedRows++;
                if ((processedRows & 7) === 0) {
                  await yieldUi();
                }
                const templateRowBase = yt * templateRowStepBytes;
                const resultRowBase = yr * resultRowStepBytes;
                for (
                  let xt = drawMultCenterTemplate, xr = offsetX,
                    templatePixelCenter = templateRowBase + (xt << 2),
                    realPixelCenter = resultRowBase + (xr << 2);
                  xt < templateWidth;
                  xt += drawMultTemplate, xr += drawMultResult,
                    templatePixelCenter += drawMultTemplateStepBytes,
                    realPixelCenter += drawMultResultStepBytes
                ) {
                  const templatePixelCenterRed = templateData[templatePixelCenter]; // Shread block's center pixel's RED value
                  const templatePixelCenterGreen = templateData[templatePixelCenter + 1]; // Shread block's center pixel's GREEN value
                  const templatePixelCenterBlue = templateData[templatePixelCenter + 2]; // Shread block's center pixel's BLUE value
                  const templatePixelCenterAlpha = templateData[templatePixelCenter + 3]; // Shread block's center pixel's ALPHA value

                  if (templatePixelCenterAlpha < 1) { continue; } // leave transparent pixels as is
                  const packedTemplateColor = packRgb(
                    templatePixelCenterRed,
                    templatePixelCenterGreen,
                    templatePixelCenterBlue
                  );
                  const shouldRender = displayedColorPackedSet.has(packedTemplateColor)
                    || (shouldCheckUnknownColors && !knownPalettePackedColors.has(packedTemplateColor));
                  if (shouldRender) {
                    // // show enabled color center pixel
                    imageData[realPixelCenter] = templatePixelCenterRed;
                    imageData[realPixelCenter + 1] = templatePixelCenterGreen;
                    imageData[realPixelCenter + 2] = templatePixelCenterBlue;
                    imageData[realPixelCenter + 3] = templatePixelCenterAlpha;
                  };
                }
              }
            }
            resultContext.putImageData(image, 0, 0);
          }
        } catch (exception) {

          // If filtering fails, we can log the error or handle it accordingly
          console.warn('Failed to apply color filter:', exception);

          // Fallback to drawing raw bitmap if filtering fails
          if (templateTileBitmap) {
            resultContext.drawImage(templateTileBitmap, 0, 0);
          }
        }

        addTemplateCanvas(template.sortID, tileKey, [safeOriginalWidth, safeOriginalHeight], resultCanvas, "overlay");
        cleanUpCanvas(resultCanvas);
        resultCanvas = null;
        
        if (currentMemorySavingMode && templateTileBitmap) {
          templateTileBitmap.close();
        }
      };
    }

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
        const tilesbase64 = (templateValue.tiles && typeof templateValue.tiles === 'object')
          ? templateValue.tiles
          : {};
        const samplesBase64 = (templateValue.samples && typeof templateValue.samples === 'object')
          ? templateValue.samples
          : {};
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
      }

      try {
        window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-color-list' }, '*');
      } catch (_) {}
      try {
        window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*');
      } catch (_) {}
      this.createOverlayOnMapVisibleOnly();
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
  getDisplayedColorsSorted() {
    const currentOnly = this.isOnlyCurrentColorShown();
    const hideLocked = this.extraColorsBitmap !== -1 && this.areLockedColorsHidden(); // If -1 then all colors are unlocked, skip the hide color check
    const toggledStatus = this.getPaletteToggledStatus();
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
    for (let colorId = 0, mask = 1; colorId < 64; colorId++, mask <<= 1) {
      if (this.completedColorsBitmap & mask) result.add(colorId);
    };
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

  getTemplateExampleLimit() {
    return (this.userSettings?.smartPlace ?? false)
      ? SMART_TEMPLATE_EXAMPLE_LIMIT
      : DEFAULT_TEMPLATE_EXAMPLE_LIMIT;
  }

  mergeTemplateExamples(target, incoming, exampleMax) {
    mergeTemplateExampleReservoir(target, incoming, exampleMax);
  }

  /** Gets the overall color progress in all template tiles
   * @since 0.86.4
   */
  getOverallPerColorProgress() {
    const paletteSum = {};
    (this.templatesArray ?? []).forEach(t => {
      if (!t.enabled) return; // only count enabled templates
      if (!t?.colorPalette) return;
      for (const [rgb, meta] of Object.entries(t.colorPalette)) {
        paletteSum[rgb] = (paletteSum[rgb] ?? 0) + meta.count;
      }
    })

    const combinedProgress = {};
    const exampleMax = this.getTemplateExampleLimit();
    for (const stats of this.tileProgress.values()) {
      Object.entries(stats.palette).forEach(([colorKey, content]) => {
        if (combinedProgress[colorKey] === undefined) {
          combinedProgress[colorKey] = Object.fromEntries(Object.entries(content));
          combinedProgress[colorKey].examplesEnabled = [];
          combinedProgress[colorKey]._exampleSeenCount = 0;
          this.mergeTemplateExamples(combinedProgress[colorKey], content.examplesEnabled, exampleMax);
        } else {
          combinedProgress[colorKey].painted += content.painted;
          combinedProgress[colorKey].paintedAndEnabled += content.paintedAndEnabled;
          combinedProgress[colorKey].missing += content.missing;
          this.mergeTemplateExamples(combinedProgress[colorKey], content.examplesEnabled, exampleMax);
        }
      })
    };

    Object.values(combinedProgress).forEach((content) => {
      delete content._exampleSeenCount;
    });

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
      this.completedColorsBitmapLo = completedColorsBitmapLo;
      this.completedColorsBitmapHi = completedColorsBitmapHi;
      if (this.areCompletedColorsHidden()) {
        this.createOverlayOnMap();
        if (this.isErrorMapShown() && this.isErrorMapOnlyEnabledColorsShown()) {
          // Change to completed color -> Change to Enabled color
          // Change to enabled color -> Change to error map
          // Force refresh to prevent the delay before the normal scheduled tile update
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

  /** A utility to get the current anchor.
   * @since 0.85.34
   * @returns {string}
   */
  getAnchor() {
    const temp = this.userSettings?.anchor ?? 'lt'; // top left
    if (this.isValidAnchor(temp)) return temp.toLowerCase();
    return 'lt';
  }


  /** A utility to check if the anchor is valid.
   * @param {string} value - The anchor
   * @returns {boolean}
   * @since 0.85.34
   */
  isValidAnchor(value) {
    if (value.length !== 2) return false;
    value = value.toLowerCase();
    return "lmr".includes(value[0]) && "tmb".includes(value[1]);
  }

  /** Sets the anchor to a value.
   * @param {string} value - The anchor
   * @since 0.85.34
   */
  async setAnchor(value) {
    if (!this.isValidAnchor(value)) return false;
    this.userSettings.anchor = value.toLowerCase();
    await this.storeUserSettings();
    return true;
  }

  /** A utility to check if events are enabled.
   * @returns {boolean}
   * @since 0.85.35
   */
  isEventEnabled() {
    return this.userSettings?.eventEnabled ?? false;
  }

  /** Sets the event enabled to a value.
   * @param {boolean} value - The value
   * @since 0.85.35
   */
  async setEventEnabled(value) {
    this.userSettings.eventEnabled = value;
    await this.storeUserSettings();
  }

  /** A utility to check if event claimed are shown.
   * @returns {boolean}
   * @since 0.85.35
   */
  isEventClaimedShown() {
    return this.userSettings?.eventClaimedShown ?? true;
  }

  /** Sets the event claimed shown to a value.
   * @param {boolean} value - The value
   * @since 0.85.35
   */
  async setEventClaimedShown(value) {
    this.userSettings.eventClaimedShown = value;
    await this.storeUserSettings();
  }

  /** A utility to check if event unavailable are shown.
   * @returns {boolean}
   * @since 0.85.35
   */
  isEventUnavailableShown() {
    return this.userSettings?.eventUnavailableShown ?? true;
  }

  /** Sets the event unavailable shown to a value.
   * @param {boolean} value - The value
   * @since 0.85.35
   */
  async setEventUnavailableShown(value) {
    this.userSettings.eventUnavailableShown = value;
    await this.storeUserSettings();
  }

  /** A utility to return the current event provider.
   * @returns {string}
   * @since 0.85.35
   */
  getEventProvider() {
    return this.userSettings?.eventProvider ?? "";
  }

  /** Sets the event provider to a value.
   * @param {string} value - The value
   * @since 0.85.35
   */
  async setEventProvider(value) {
    this.userSettings.eventProvider = value;
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
    if (mode === 'dot') {
      const center = (size - 1) >> 1;
      return [[center, center]];
    }
    if (mode === 'fill') {
      const points = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          points.push([x, y]);
        }
      }
      return points;
    }
    if (mode.startsWith('cross-z')) {
      const points = [];
      const inset = Math.max(1, Math.floor(size / 5));
      const min = inset;
      const max = size - 1 - inset;
      if (min > max) {
        const center = (size - 1) >> 1;
        return [[center, center]];
      }
      const bandSize = max - min + 1;
      const edgeThickness = Math.min(bandSize, bandSize >= 5 ? 2 : 1);
      const diagThickness = Math.min(bandSize, bandSize >= 5 ? 3 : 2);
      for (let y = min; y <= max; y++) {
        for (let x = min; x <= max; x++) {
          const isTop = y >= min && y <= min + edgeThickness - 1;
          const isBottom = y <= max && y >= max - edgeThickness + 1;
          let isDiagonal = false;
          const diag = min + max - y;
          const offsetStart = -Math.floor(diagThickness / 2);
          const offsetEnd = Math.ceil(diagThickness / 2) - 1;
          for (let offset = offsetStart; offset <= offsetEnd; offset++) {
            if (x === diag + offset) {
              isDiagonal = true;
              break;
            }
          }
          if (isTop || isBottom || isDiagonal) {
            points.push([x, y]);
          }
        }
      }
      return points;
    }
    return template.customMaskPoints(size);
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

  /** Whether the "+ Line" and "+ Circle" buttons are displayed
   * @returns {boolean}
   * @since 0.86.13
   */
  isLineTemplateButtonShown() {
    return this.userSettings?.lineTemplateButton ?? false;
  }

  /** Sets the lineTemplateButton to a value.
   * @param {boolean} value - The value
   * @since 0.86.13
   */
  async setLineTemplateButtonEnabled(value) {
    this.userSettings.lineTemplateButton = value;
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
  clearTileProgress(template) {
    // may improve: only delete those tiles that are no longer involved in other templates
    template.tilePrefixes.forEach(prefix => {
      this.tileProgress.delete(prefix);
      // this.tileOverlay.delete(prefix);
    });
    // should not be needed if color filter list (that calls getOverallPerColorProgress) is called after this. But just in case
    this.completedColorsBitmapLo = 0;
    this.completedColorsBitmapHi = 0;
  }
}









