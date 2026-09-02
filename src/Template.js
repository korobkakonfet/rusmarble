import { base64ToUint8, cleanUpCanvas, testCanvasSize, createBitmapPreservingPixels } from "./utils.js";
import {
  buildMaskRowSpans,
  cloneMaskRowSpans,
  createChunkSampleData,
  decodeChunkSampleBuffer,
  encodeChunkSampleBytes,
  getMaskRowSpansTransferList,
  inspectSourceImagePalette,
  createPaletteStatsAccumulator,
  finalizePaletteStatsAccumulator,
  buildChunkSampleDataFromSource,
  mergePaletteStatsAccumulator,
  renderSampleDataToImage,
  TEMPLATE_DEFACE_RGB,
  TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE,
  isDefaceRgb,
  snapRgbToNearestPalette,
} from "./templateChunkUtils.js";
import {
  templatePalettePackedSet,
  templatePaletteConversionDefaults,
  normalizeTemplatePaletteConversionOptions,
  convertImageDataToWplacePalette,
} from './templatePaletteConversion.js';
export { templatePaletteConversionDefaults, normalizeTemplatePaletteConversionOptions, convertImageDataToWplacePalette };
import { templateWorkerManager } from './templateWorkerManager.js';
import { profiler } from './profiler.js';

const packRgb = (r, g, b) => ((r << 16) | (g << 8) | b) >>> 0;
const TEMPLATE_DEFACE_PACKED = packRgb(TEMPLATE_DEFACE_RGB[0], TEMPLATE_DEFACE_RGB[1], TEMPLATE_DEFACE_RGB[2]);

const TEMPLATE_CHUNK_BATCH_SIZE = 8;

const renderPixelsToCanvas = (pixels, width, height) => {
  let canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    cleanUpCanvas(canvas);
    canvas = null;
    throw new Error('Failed to initialize canvas for rendered worker pixels.');
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
};

/** An instance of a template.
 * Handles all mathematics, manipulation, and analysis regarding a single template.
 * @class Template
 * @since 0.65.2
 */
/** Notified when a template lazily extracts chunk samples that were not already persisted, so
 * the manager can schedule a (debounced) write-back. Set once by templateManager.
 * @type {((template: Template) => void) | null}
 */
let chunkSampleCacheListener = null;

/** @param {((template: Template) => void) | null} listener */
export function setChunkSampleCacheListener(listener) {
  chunkSampleCacheListener = typeof listener === 'function' ? listener : null;
}

export default class Template {

  /** The constructor for the {@link Template} class with enhanced pixel tracking.
   * @param {Object} [params={}] - Object containing all optional parameters
   * @param {string} [params.displayName='My template'] - The display name of the template
   * @param {number} [params.sortID=0] - The sort number of the template for rendering priority
   * @param {string} [params.authorID=''] - The user ID of the person who exported the template (prevents sort ID collisions)
   * @param {string} [params.url=''] - The URL to the source image
   * @param {File | ImageBitmap | ImageData} [params.file=null] - The template file (pre-processed File or processed bitmap)
   * @param {Array<number>} [params.coords=null] - The coordinates of the top left corner as (tileX, tileY, pixelX, pixelY)
   * @param {Object} [params.chunked=null] - The affected chunks of the template, and their template for each chunk
   * @param {number} [params.tileSize=1000] - The size of a tile in pixels (assumes square tiles)
   * @param {number} [params.pixelCount=0] - Total number of pixels in the template (calculated automatically during processing)
   * @since 0.65.2
   */
  constructor({
    displayName = 'My template',
    sortID = 0,
    authorID = '',
    url = '',
    file = null,
    coords = null,
    chunked = null,
    chunkedBuffer = null,
    chunkedSamples = null,
    chunkedSamplesBuffer = null,
    tileSize = 1000,
    imageWidth = null,
    imageHeight = null,
    forcePaletteConversion = false,
    paletteConversionOptions = null,
    sampleNormalizeToPalette = false,
  } = {}) {
    this.displayName = displayName;
    this.sortID = sortID;
    this.authorID = authorID;
    this.url = url;
    this.file = file;
    this.coords = coords;
    this.chunked = chunked; // tileKey => ImageBitmap, null if memory saving
    this.chunkedBuffer = chunkedBuffer;
    this.chunkedSamples = chunkedSamples || {};
    this.chunkedSamplesBuffer = chunkedSamplesBuffer || {};
    this.persistBitmapTiles = false;
    this.persistChunkSamples = false;
    this.tileSize = tileSize;
    this.imageWidth = Number.isFinite(Number(imageWidth)) ? Math.max(1, Math.trunc(Number(imageWidth))) : null;
    this.imageHeight = Number.isFinite(Number(imageHeight)) ? Math.max(1, Math.trunc(Number(imageHeight))) : null;
    this.forcePaletteConversion = Boolean(forcePaletteConversion);
    this.paletteConversionOptions = normalizeTemplatePaletteConversionOptions(paletteConversionOptions || templatePaletteConversionDefaults);
    this.sampleNormalizeToPalette = Boolean(sampleNormalizeToPalette);
    this.enforceTransparentAsDeface = false;
    this.enabled = true;
    this.pixelCount = 0; // Total pixel count in template
    this.requiredPixelCount = 0; // Total number of non-transparent, non-#deface pixels
    this.defacePixelCount = 0; // Number of #deface pixels (represents Transparent color in-game)
    this.colorPalette = {}; // key: "r,g,b" -> { count: number, enabled: boolean }
    this.tilePrefixes = new Set(); // Set of "xxxx,yyyy" tiles this template touches
    this.storageKey = null; // Key used inside templatesJSON to persist settings
    this.storageTimeString = Date.now().toString(); // Use to identify if the template is replaced but still with the same storageKey

    // Build allowed color set from site palette (exclude special Transparent entry by name)
    // Creates a Set of Wplace palette colors excluding "transparent"
    // const allowed = Array.isArray(colorpalette) ? colorpalette : [];
    // this.allowedColorsSet = allowedColorsSet;

    // Map rgb-> {id, premium}
    // this.rgbToMeta = rgbToMeta;

    this.shreadSize = null; // Scale image factor, same as TemplateManager's drawMult
  }

  customMask(x, y, shreadSize) {
    // Original: Center dot
    // return x % shreadSize == 1 && y % shreadSize == 1;
    // Modifed: + cross
    const center = (shreadSize - 1) >> 1; // Even: better be up left than down right
    return (
      x % shreadSize == center || y % shreadSize == center
    ) && (
      x % shreadSize >= center - 1 && x % shreadSize <= center + 1 &&
      y % shreadSize >= center - 1 && y % shreadSize <= center + 1
    );
  }

  customMaskPoints(shreadSize) {
    const result = [];
    for (let offsetY = 0; offsetY < shreadSize; offsetY++) {
      for (let offsetX = 0; offsetX < shreadSize; offsetX++) {
        if (this.customMask(offsetX, offsetY, shreadSize)) {
          result.push([offsetX, offsetY]);
        }
      }
    }
    return result;
  }

  async convertBitmapToWplacePalette(bitmap) {
    if (!(bitmap instanceof ImageBitmap) || !this.forcePaletteConversion) {
      return bitmap;
    }
    let conversionCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const conversionCtx = conversionCanvas.getContext('2d', { willReadFrequently: true });
    if (!conversionCtx) {
      cleanUpCanvas(conversionCanvas);
      conversionCanvas = null;
      return bitmap;
    }
    conversionCtx.imageSmoothingEnabled = false;
    conversionCtx.clearRect(0, 0, bitmap.width, bitmap.height);
    conversionCtx.drawImage(bitmap, 0, 0);
    const sourceImageData = conversionCtx.getImageData(0, 0, bitmap.width, bitmap.height);
    const pixelData = new Uint8ClampedArray(sourceImageData.data);
    const workerResult = await templateWorkerManager.runTask('convertImageData', {
      pixelData,
      width: bitmap.width,
      height: bitmap.height,
      options: this.paletteConversionOptions,
    }, { transferList: [pixelData.buffer] }).catch(() => null);
    const changed = Number(workerResult?.stats?.convertedPixels) || 0;
    if (changed <= 0) {
      cleanUpCanvas(conversionCanvas);
      conversionCanvas = null;
      return bitmap;
    }
    if (workerResult.pixelData instanceof Uint8ClampedArray) {
      conversionCtx.putImageData(new ImageData(workerResult.pixelData, bitmap.width, bitmap.height), 0, 0);
    }
    const convertedBitmap = await createImageBitmap(conversionCanvas);
    bitmap.close?.();
    cleanUpCanvas(conversionCanvas);
    conversionCanvas = null;
    return convertedBitmap;
  }

  inspectBitmapPalette(bitmap) {
    if (!(bitmap instanceof ImageBitmap)) {
      return null;
    }

    let inspectCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const inspectCtx = inspectCanvas.getContext('2d', { willReadFrequently: true });
    if (!inspectCtx) {
      cleanUpCanvas(inspectCanvas);
      inspectCanvas = null;
      return null;
    }
    inspectCtx.imageSmoothingEnabled = false;
    inspectCtx.clearRect(0, 0, bitmap.width, bitmap.height);
    inspectCtx.drawImage(bitmap, 0, 0);
    const inspectData = inspectCtx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    cleanUpCanvas(inspectCanvas);
    inspectCanvas = null;

    return inspectSourceImagePalette(inspectData, bitmap.width, bitmap.height);
  }

  async normalizeSourceImageDataForSamples(imageData) {
    if (
      !this.sampleNormalizeToPalette
      || !imageData?.data
      || !Number.isFinite(imageData?.width)
      || !Number.isFinite(imageData?.height)
    ) {
      return imageData;
    }

    const data = imageData.data;
    const defaceOffsets = [];
    let hasNonPaletteColors = false;
    for (let base = 0; base < data.length; base += 4) {
      if ((data[base + 3] || 0) <= 0) continue;
      const packed = packRgb(data[base], data[base + 1], data[base + 2]);
      if (packed === TEMPLATE_DEFACE_PACKED) {
        defaceOffsets.push(base);
        continue;
      }
      if (!templatePalettePackedSet.has(packed)) {
        hasNonPaletteColors = true;
      }
    }
    if (!hasNonPaletteColors) {
      return imageData;
    }

    const options = {
      ...this.paletteConversionOptions,
      ditherMode: 'none',
      ditherStrength: 0,
      antiDitherStrength: 0,
      alphaThreshold: 1,
      // The JS path now resolves nearest-palette from a proven-exact RGB cube and benchmarks about
      // twice as fast as the WASM module for identical output, so it is the one we want here. The
      // WASM path is kept behind this flag and still measured by build/benchmark.js.
      useWasm: false,
    };
    const pixelData = new Uint8ClampedArray(data);
    const workerResult = await templateWorkerManager.runTask('convertImageData', {
      pixelData,
      width: imageData.width,
      height: imageData.height,
      options,
    }, { transferList: [pixelData.buffer] }).catch(() => null);
    if (workerResult?.pixelData instanceof Uint8ClampedArray) {
      data.set(workerResult.pixelData);
    }
    if (defaceOffsets.length > 0) {
      for (let index = 0; index < defaceOffsets.length; index++) {
        const base = defaceOffsets[index];
        data[base] = TEMPLATE_DEFACE_RGB[0];
        data[base + 1] = TEMPLATE_DEFACE_RGB[1];
        data[base + 2] = TEMPLATE_DEFACE_RGB[2];
      }
    }
    return imageData;
  }

  getChunkKeys() {
    const keys = new Set();
    const sources = [
      this.chunked,
      this.chunkedBuffer,
      this.chunkedSamples,
      this.chunkedSamplesBuffer,
    ];
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      Object.keys(source).forEach((key) => keys.add(key));
    }
    return [...keys];
  }

  getPersistableChunkBuffers(tileKeys = null) {
    if (this.persistBitmapTiles !== true) {
      return {};
    }
    const keys = Array.isArray(tileKeys) && tileKeys.length ? tileKeys : this.getChunkKeys();
    const result = {};
    for (const tileKey of keys) {
      if (!this.chunkedBuffer || !Object.prototype.hasOwnProperty.call(this.chunkedBuffer, tileKey)) continue;
      result[tileKey] = this.chunkedBuffer[tileKey];
    }
    return result;
  }

  getPersistableChunkSampleBuffers(tileKeys = null) {
    if (this.persistChunkSamples !== true) {
      return {};
    }
    const keys = Array.isArray(tileKeys) && tileKeys.length ? tileKeys : this.getChunkKeys();
    const result = {};
    for (const tileKey of keys) {
      if (this.chunkedSamplesBuffer && Object.prototype.hasOwnProperty.call(this.chunkedSamplesBuffer, tileKey)) {
        result[tileKey] = this.chunkedSamplesBuffer[tileKey];
        continue;
      }
      if (this.chunkedSamples && this.chunkedSamples[tileKey]) {
        result[tileKey] = encodeChunkSampleBytes(this.chunkedSamples[tileKey]);
      }
    }
    return result;
  }

  hasNativeChunkSamples(tileKey) {
    if (this.chunkedSamples?.[tileKey]?.native === true) {
      return true;
    }
    return !!(this.chunkedSamplesBuffer && Object.prototype.hasOwnProperty.call(this.chunkedSamplesBuffer, tileKey));
  }

  getChunkBufferBytes(tileKey) {
    if (!this.chunkedBuffer || !Object.prototype.hasOwnProperty.call(this.chunkedBuffer, tileKey)) {
      return null;
    }
    const value = this.chunkedBuffer[tileKey];
    if (value instanceof Uint8Array) {
      return value;
    }
    if (typeof value === 'string') {
      const bytes = base64ToUint8(value);
      this.chunkedBuffer[tileKey] = bytes;
      return bytes;
    }
    return null;
  }

  // Returns the raw Uint8Array buffer for a tile. If the buffer is stored as a base64 string
  // (the case after GM.getValue restore), decodes it once and caches the result back so subsequent
  // calls are O(1). Returns null if no buffer exists for this tile.
  getRawChunkBuffer(tileKey) {
    let buf = this.chunkedSamplesBuffer?.[tileKey];
    if (typeof buf === 'string') {
      const decoded = base64ToUint8(buf);
      if (decoded instanceof Uint8Array) {
        this.chunkedSamplesBuffer[tileKey] = decoded;
        buf = decoded;
      } else {
        buf = null;
      }
    }
    return buf instanceof Uint8Array ? buf : null;
  }

  decodeStoredChunkSamples(tileKey) {
    if (this.chunkedSamples?.[tileKey]) {
      return this.chunkedSamples[tileKey];
    }
    if (!this.chunkedSamplesBuffer || !Object.prototype.hasOwnProperty.call(this.chunkedSamplesBuffer, tileKey)) {
      return null;
    }
    const decoded = decodeChunkSampleBuffer(this.chunkedSamplesBuffer[tileKey]);
    if (!decoded) {
      return null;
    }
    decoded.native = true;
    this.chunkedSamples[tileKey] = decoded;
    return decoded;
  }

  extractChunkSamplesFromBitmap(bitmap) {
    if (!(bitmap instanceof ImageBitmap)) {
      return null;
    }
    const shreadSize = Math.max(1, Math.trunc(Number(this.shreadSize) || 1));
    const logicalWidth = Math.max(1, Math.round(bitmap.width / shreadSize));
    const logicalHeight = Math.max(1, Math.round(bitmap.height / shreadSize));

    let sampleCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleContext) {
      cleanUpCanvas(sampleCanvas);
      sampleCanvas = null;
      return null;
    }
    sampleContext.imageSmoothingEnabled = false;
    sampleContext.clearRect(0, 0, bitmap.width, bitmap.height);
    sampleContext.drawImage(bitmap, 0, 0);
    const imageData = sampleContext.getImageData(0, 0, bitmap.width, bitmap.height).data;
    cleanUpCanvas(sampleCanvas);
    sampleCanvas = null;

    const center = (shreadSize - 1) >> 1;
    // Single pass over the logical grid. Allocating at the full grid size and trimming with
    // subarray afterwards -- the same shape buildChunkSampleDataFromSource uses -- costs one
    // transient allocation instead of a second full scan just to learn the count.
    const sampleData = createChunkSampleData(logicalWidth, logicalHeight, logicalWidth * logicalHeight, false);
    const outX = sampleData.x, outY = sampleData.y, outFlags = sampleData.flags;
    const outR = sampleData.r, outG = sampleData.g, outB = sampleData.b, outA = sampleData.a;
    let writeIndex = 0;
    for (let y = 0, sampleY = center; y < logicalHeight; y++, sampleY += shreadSize) {
      for (let x = 0, sampleX = center; x < logicalWidth; x++, sampleX += shreadSize) {
        const idx = (sampleY * bitmap.width + sampleX) * 4;
        const alpha = imageData[idx + 3] || 0;
        if (alpha <= 0) continue;
        outX[writeIndex] = x;
        outY[writeIndex] = y;
        const rawR = imageData[idx], rawG = imageData[idx + 1], rawB = imageData[idx + 2];
        if (isDefaceRgb(rawR, rawG, rawB)) {
          outR[writeIndex] = rawR;
          outG[writeIndex] = rawG;
          outB[writeIndex] = rawB;
          outFlags[writeIndex] = TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE;
        } else {
          const snapped = snapRgbToNearestPalette(rawR, rawG, rawB);
          outR[writeIndex] = snapped.r;
          outG[writeIndex] = snapped.g;
          outB[writeIndex] = snapped.b;
          outFlags[writeIndex] = 0;
        }
        outA[writeIndex] = alpha;
        writeIndex++;
      }
    }
    if (writeIndex !== outX.length) {
      sampleData.x = outX.subarray(0, writeIndex);
      sampleData.y = outY.subarray(0, writeIndex);
      sampleData.r = outR.subarray(0, writeIndex);
      sampleData.g = outG.subarray(0, writeIndex);
      sampleData.b = outB.subarray(0, writeIndex);
      sampleData.a = outA.subarray(0, writeIndex);
      sampleData.flags = outFlags.subarray(0, writeIndex);
    }
    sampleData.count = writeIndex;
    return sampleData;
  }

  async getChunkSamples(tileKey, options = {}) {
    const stored = this.decodeStoredChunkSamples(tileKey);
    // Cache hit vs miss, so a profile shows whether the write-back is actually paying off across
    // sessions. A warm session should be nearly all storeHit and no extractChunkSamples calls.
    if (stored) {
      profiler.record('samples:storeHit', 0);
      return stored;
    }
    if (this.chunkedSamples?.[tileKey]) return this.chunkedSamples[tileKey];
    if (options?.allowBitmapFallback === false) return null;

    // Deduplicate concurrent extraction for the same tile — prewarm and render may race.
    // Both callers get the same promise and share the single worker round-trip.
    if (!this._pendingExtractions) this._pendingExtractions = new Map();
    if (this._pendingExtractions.has(tileKey)) {
      return this._pendingExtractions.get(tileKey);
    }
    const extractPromise = (async () => {
      const memorySaving = options?.memorySaving === true;
      profiler.record('samples:extractMiss', 0);
      const bitmap = await this.getChunked(tileKey, memorySaving);
      if (!(bitmap instanceof ImageBitmap)) return null;
      const shreadSize = Math.max(1, Math.trunc(Number(this.shreadSize) || 1));
      let sampleData = null;
      if (templateWorkerManager.canUseWorkers()) {
        const workerResult = await templateWorkerManager.runTask('extractChunkSamples', {
          bitmap,
          shreadSize,
        }, { transferList: [bitmap] }).catch(() => null);
        if (workerResult?.sampleData) {
          sampleData = { ...workerResult.sampleData, native: true };
        }
      } else {
        sampleData = this.extractChunkSamplesFromBitmap(bitmap);
        if (memorySaving) bitmap.close?.();
      }
      if (sampleData) {
        this.chunkedSamples[tileKey] = sampleData;
        // Remote templates are created with persistChunkSamples=false (they persist PNG tiles
        // instead), so every session re-derived these samples from the PNGs — measured at ~8s of
        // worker time across 20 tiles. Flip persistence on once we have paid that cost so the
        // samples get written back and later sessions read them straight from storage.
        // getPersistableChunkSampleBuffers already encodes in-memory samples when no buffer
        // exists, so flipping the flag is all that is needed on the Template side.
        this.persistChunkSamples = true;
        // Encode into chunkedSamplesBuffer, not just chunkedSamples. The manager decides whether
        // a template needs rewriting via _getTemplateBufferFingerprint, which only looks at
        // chunkedSamplesBuffer — leaving the samples decoded-only would keep the fingerprint
        // identical and the write-back would be skipped as "unchanged".
        try {
          if (!this.chunkedSamplesBuffer) this.chunkedSamplesBuffer = {};
          this.chunkedSamplesBuffer[tileKey] = encodeChunkSampleBytes(sampleData);
        } catch (_) { /* fall back to the encode-on-persist path in getPersistableChunkSampleBuffers */ }
        try { chunkSampleCacheListener?.(this); } catch (_) {}
      }
      return sampleData;
    })();
    this._pendingExtractions.set(tileKey, extractPromise);
    try {
      return await extractPromise;
    } finally {
      this._pendingExtractions.delete(tileKey);
    }
  }

  /** Creates chunks of the template for each tile.
   * 
   * @returns {Object} Collection of template bitmaps & buffers organized by tile coordinates
   * @since 0.65.4
   */
  async createTemplateTiles(options = {}) {
    if (this.shreadSize === null) {
      // initialize shreadSize (usually already assigned by the template manager)
      this.shreadSize = testCanvasSize(5000, 5000) ? 5 : 3; // Scale image factor for pixel art enhancement (must be odd)
    }
    const shreadSize = this.shreadSize;
    const persistBitmapTiles = options?.persistBitmapTiles === true;
    const keepBitmapTilesInMemory = options?.keepBitmapTilesInMemory !== false;
    const persistChunkSamples = options?.persistChunkSamples !== false;
    const keepChunkSamplesInMemory = options?.keepChunkSamplesInMemory !== false;
    const lazyPersistChunkSamples = options?.lazyPersistChunkSamples === true;
    // Creation was the one hot path with no timings at all, so "why is this template slow"
    // could not be answered from a profile. The phases below are the ones that actually scale
    // with image size.
    profiler.start('create:total');
    let bitmap = this.file instanceof ImageBitmap
      ? this.file
      : await profiler.measureAsync('create:decodeBitmap', () => createBitmapPreservingPixels(this.file)); // Create efficient bitmap from uploaded file
    if (this.forcePaletteConversion) {
      bitmap = await profiler.measureAsync('create:paletteConvert', () => this.convertBitmapToWplacePalette(bitmap));
    }
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;
    this.imageWidth = Math.max(1, Math.trunc(imageWidth));
    this.imageHeight = Math.max(1, Math.trunc(imageHeight));
  
    const [tx, ty, px, py] = this.coords;
    // Coordinates always name the template's top-left corner.
    let mapX = tx * this.tileSize + px;
    let mapY = ty * this.tileSize + py;
    if (mapX < 0) {
      mapX += 2048 * this.tileSize;
    }
    this.coords = [
      Math.floor(mapX / this.tileSize),
      Math.floor(mapY / this.tileSize),
      mapX % this.tileSize,
      mapY % this.tileSize
    ];
    // Calculate total pixel count using standard width × height formula
    // TODO: Use non-transparent pixels instead of basic width times height
    const totalPixels = imageWidth * imageHeight;
    // Store pixel count in instance property for access by template manager and UI components
    this.pixelCount = totalPixels;
    let sourceCanvas = null;
    let sourceContext = null;
    let sourceData = null;
    let paletteStatsAccumulator = null;
    let precomputedPaletteStats = null;
    const needsChunkSamples = keepChunkSamplesInMemory || persistChunkSamples;
    try {
      sourceCanvas = new OffscreenCanvas(imageWidth, imageHeight);
      sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) {
        throw new Error('Failed to initialize template source canvas.');
      }
      sourceContext.imageSmoothingEnabled = false;
      sourceContext.clearRect(0, 0, imageWidth, imageHeight);
      sourceContext.drawImage(bitmap, 0, 0);
      const sourceImageData = profiler.measure(
        'create:readSource',
        () => sourceContext.getImageData(0, 0, imageWidth, imageHeight),
      );
      if (this.sampleNormalizeToPalette) {
        await this.normalizeSourceImageDataForSamples(sourceImageData);
      }
      sourceData = sourceImageData.data;
      if (needsChunkSamples) {
        paletteStatsAccumulator = createPaletteStatsAccumulator();
      } else {
        precomputedPaletteStats = inspectSourceImagePalette(sourceData, imageWidth, imageHeight);
      }
    } catch (err) {
      this.requiredPixelCount = Math.max(0, this.pixelCount);
      this.defacePixelCount = 0;
      console.warn('Failed to compute required/deface counts. Falling back to total pixels.', err);
    }

    const templateTiles = {};
    const templateTilesBuffers = {};
    const templateChunkSamples = {};
    const templateChunkSampleBuffers = {};
    const templateTileKeys = [];
    const templateMaskPoints = this.customMaskPoints(shreadSize);
    const templateMaskRowSpans = buildMaskRowSpans(templateMaskPoints, shreadSize);
    const useWorkerChunkBuild = !!(
      sourceData
      && needsChunkSamples
      && templateWorkerManager.canUseWorkers()
    );
    let canvas = null;
    let context = null;
    const chunkDescriptors = [];

    // For every tile...
    for (let pixelY = this.coords[3]; pixelY < imageHeight + this.coords[3]; ) {

      // Draws the partial tile first, if any
      // This calculates the size based on which is smaller:
      // A. The top left corner of the current tile to the bottom right corner of the current tile
      // B. The top left corner of the current tile to the bottom right corner of the image
      const drawSizeY = Math.min(
        this.tileSize - (pixelY % this.tileSize), // remaining y in this tile
        imageHeight + this.coords[3] - pixelY // bottom y
      );

      for (let pixelX = this.coords[2]; pixelX < imageWidth + this.coords[2];) {
        // Draws the partial tile first, if any
        // This calculates the size based on which is smaller:
        // A. The top left corner of the current tile to the bottom right corner of the current tile
        // B. The top left corner of the current tile to the bottom right corner of the image
        const drawSizeX = Math.min(
          this.tileSize - (pixelX % this.tileSize), // remaining x in this tile
          imageWidth + this.coords[2] - pixelX　// right x
        );

        // Creates the "0000,0000,000,000" key name
        const templateTileName = `${
          ((this.coords[0] + Math.floor(pixelX / this.tileSize)) % 2048) // wrap
          .toString()
          .padStart(4, '0')
        },${
          (this.coords[1] + Math.floor(pixelY / this.tileSize))
          .toString()
          .padStart(4, '0')
        },${
          (pixelX % this.tileSize)
          .toString()
          .padStart(3, '0')
        },${
          (pixelY % this.tileSize)
          .toString()
          .padStart(3, '0')
        }`;

        const sourceX = pixelX - this.coords[2];
        const sourceY = pixelY - this.coords[3];
        // The tile key and prefix are registered after the empty-chunk filter below, so a tile
        // the template does not actually cover never enters the lookup structures.
        chunkDescriptors.push({
          tileKey: templateTileName,
          sourceX,
          sourceY,
          drawSizeX,
          drawSizeY,
          pixelX,
          pixelY,
        });

        pixelX += drawSizeX;
      }

      pixelY += drawSizeY;
    }
    // Drop chunks the template does not actually cover.
    //
    // The descriptors above tile the image's bounding box, but a shape that only occupies a
    // thin band of that box — a diagonal road is the extreme case — leaves most of those tiles
    // fully transparent. Each one still cost a worker round trip, a sample buffer, and (with
    // bitmap tiles) a chunkWidth*shreadSize squared canvas to render nothing into.
    //
    // Skipping them is exact rather than approximate: buildChunkSampleDataFromSource ignores
    // every pixel with `alpha === 0`, so an all-zero-alpha chunk produces an empty sample,
    // contributes nothing to the palette stats, and renders a fully transparent bitmap. The
    // test below uses the same `alpha > 0` predicate, so a chunk is dropped only when the
    // builder would have produced nothing from it.
    if (sourceData) {
      const rowStride = imageWidth * 4;
      const hasContent = (chunk) => {
        const endY = chunk.sourceY + chunk.drawSizeY;
        const endX = chunk.sourceX + chunk.drawSizeX;
        for (let y = chunk.sourceY; y < endY; y++) {
          // Alpha only, and bail on the first hit: a covered chunk costs a few reads, and an
          // empty one is a linear scan we were about to pay for many times over anyway.
          for (let idx = y * rowStride + chunk.sourceX * 4 + 3; idx < y * rowStride + endX * 4; idx += 4) {
            if (sourceData[idx] > 0) return true;
          }
        }
        return false;
      };
      const covered = chunkDescriptors.filter(hasContent);
      // A fully transparent image would otherwise produce a template with no tiles at all;
      // keep one so every template still has a chunk downstream can look up.
      const kept = covered.length ? covered : chunkDescriptors.slice(0, 1);
      profiler.record('create:emptyTilesSkipped', chunkDescriptors.length - kept.length);
      // Rewritten in place rather than spread back in: a spread of every kept descriptor is
      // one argument per tile, which a large template can push past the call-argument limit.
      chunkDescriptors.length = 0;
      for (const chunk of kept) chunkDescriptors.push(chunk);
    }

    for (const chunk of chunkDescriptors) {
      templateTileKeys.push(chunk.tileKey);
      // Record tile prefix for fast lookup later
      this.tilePrefixes.add(chunk.tileKey.split(',').slice(0, 2).join(','));
    }

    let workerChunkBuildFailed = false;
    if (useWorkerChunkBuild) {
      const batches = [];
      for (let index = 0; index < chunkDescriptors.length; index += TEMPLATE_CHUNK_BATCH_SIZE) {
        batches.push(chunkDescriptors.slice(index, index + TEMPLATE_CHUNK_BATCH_SIZE));
      }

      const dispatchBatch = (batchChunks) => {
        profiler.start('create:bandCopy');
        const serializedMaskRowSpans = cloneMaskRowSpans(templateMaskRowSpans);

        // Send only the rectangle this batch actually reads. Copying the whole image per batch
        // meant a full RGBA duplicate of the source for every 8 chunks — on a 3000x3000
        // template that is 36MB copied and transferred, repeated for each batch.
        //
        // Chunks are generated row-major, so a batch is a contiguous run of tiles: bounding it
        // in Y alone is enough only while 8 chunks still span the whole width. Past that — a
        // template wider than 8 tiles, i.e. the long banners and roads — each row's band was
        // re-copied at FULL image width once per batch, so the cost grew with
        // ceil(tilesPerRow / 8) instead of staying at one image. Bounding X as well keeps the
        // total at roughly one image whatever the aspect ratio.
        let bandStartY = imageHeight;
        let bandEndY = 0;
        let bandStartX = imageWidth;
        let bandEndX = 0;
        for (const chunk of batchChunks) {
          if (chunk.sourceY < bandStartY) bandStartY = chunk.sourceY;
          const chunkEndY = chunk.sourceY + chunk.drawSizeY;
          if (chunkEndY > bandEndY) bandEndY = chunkEndY;
          if (chunk.sourceX < bandStartX) bandStartX = chunk.sourceX;
          const chunkEndX = chunk.sourceX + chunk.drawSizeX;
          if (chunkEndX > bandEndX) bandEndX = chunkEndX;
        }
        bandStartY = Math.max(0, Math.min(bandStartY, imageHeight));
        bandEndY = Math.max(bandStartY, Math.min(bandEndY, imageHeight));
        bandStartX = Math.max(0, Math.min(bandStartX, imageWidth));
        bandEndX = Math.max(bandStartX, Math.min(bandEndX, imageWidth));
        const rowStride = imageWidth * 4;
        const bandWidth = bandEndX - bandStartX;
        const bandHeight = bandEndY - bandStartY;
        let workerSourceData;
        if (bandWidth === imageWidth) {
          // Full-width band: one contiguous range, so let slice() do it in one memcpy.
          workerSourceData = sourceData.slice(bandStartY * rowStride, bandEndY * rowStride);
        } else {
          // Partial width: the rows are strided in the source, so copy them one by one into a
          // tightly packed buffer. This still moves far less than the full-width slice did.
          const bandRowStride = bandWidth * 4;
          workerSourceData = new Uint8ClampedArray(bandRowStride * bandHeight);
          for (let row = 0; row < bandHeight; row++) {
            const sourceStart = (bandStartY + row) * rowStride + bandStartX * 4;
            workerSourceData.set(
              sourceData.subarray(sourceStart, sourceStart + bandRowStride),
              row * bandRowStride,
            );
          }
        }

        profiler.record('create:bandBytes', workerSourceData.length);
        profiler.end('create:bandCopy');

        return templateWorkerManager.runTask('buildTemplateChunkBatch', {
          sourceData: workerSourceData,
          // The worker indexes the buffer it was given, so the band's own width is the stride.
          imageWidth: bandWidth,
          chunks: batchChunks.map((chunk) => ({
            tileKey: chunk.tileKey,
            // Rebase onto the band we sent; the worker indexes from its top-left corner.
            sourceX: chunk.sourceX - bandStartX,
            sourceY: chunk.sourceY - bandStartY,
            drawSizeX: chunk.drawSizeX,
            drawSizeY: chunk.drawSizeY,
          })),
          shreadSize,
          maskPoints: templateMaskPoints,
          maskRowSpans: serializedMaskRowSpans,
          // Raw pixels only when an in-memory bitmap needs them; persisted tiles come back as
          // PNG bytes the worker encoded itself.
          renderChunks: keepBitmapTilesInMemory,
          encodeChunkPngs: persistBitmapTiles,
        }, {
          transferList: [
            workerSourceData.buffer,
            ...getMaskRowSpansTransferList(serializedMaskRowSpans),
          ],
        // A crashed worker takes the pool down with it, so every later batch would return null
        // anyway. Treating the rejection as a failed batch drops us onto the main-thread fallback
        // below instead of failing template creation outright.
        }).catch(() => null);
      };

      // The pool runs several workers, so dispatching one batch at a time left all but one idle.
      // Keep the pool fed while still consuming results in batch order: palette stats merge into
      // a shared accumulator whose iteration order decides the colour list's order, and holding
      // only a window of results bounds the rendered-pixel memory in flight.
      // A batch that returns raw rendered pixels is heavy — a full-tile chunk at shreadSize 5 is
      // 5000x5000 RGBA — so keep that window narrow. Batches that come back as PNG bytes (or as
      // samples only) are small enough to saturate the pool with.
      const dispatchWindow = keepBitmapTilesInMemory
        ? Math.min(2, templateWorkerManager.getPoolSize())
        : templateWorkerManager.getPoolSize();
      const maxInFlight = Math.max(1, Math.min(dispatchWindow, batches.length));
      const inFlight = new Map();
      let nextToDispatch = 0;
      const fillDispatchWindow = () => {
        while (inFlight.size < maxInFlight && nextToDispatch < batches.length) {
          const batchIndex = nextToDispatch++;
          inFlight.set(batchIndex, dispatchBatch(batches[batchIndex]));
        }
      };

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        fillDispatchWindow();
        const workerResult = await profiler.measureAsync(
          'create:chunkBatchWait',
          () => inFlight.get(batchIndex),
        );
        inFlight.delete(batchIndex);
        if (!workerResult) {
          workerChunkBuildFailed = true;
          break;
        }
        mergePaletteStatsAccumulator(paletteStatsAccumulator, workerResult.paletteStats);
        // Each tile's canvas work is independent, so encode them together rather than serially.
        const pendingTileWork = [];
        for (const entry of (workerResult.chunkResults || [])) {
          const sampleData = decodeChunkSampleBuffer(entry.sampleBytes);
          if (sampleData) {
            sampleData.native = true;
            if (keepChunkSamplesInMemory) {
              templateChunkSamples[entry.tileKey] = sampleData;
            }
            if (persistChunkSamples && !lazyPersistChunkSamples) {
              templateChunkSampleBuffers[entry.tileKey] = entry.sampleBytes;
            }
          }
          if (persistBitmapTiles && entry.pngBytes instanceof Uint8Array) {
            templateTilesBuffers[entry.tileKey] = entry.pngBytes;
          }
          // Raw pixels arrive when an in-memory bitmap was requested, or when the worker could
          // not encode the PNG itself and left the job to us.
          const needsMainThreadPng = persistBitmapTiles && !(entry.pngBytes instanceof Uint8Array);
          if ((keepBitmapTilesInMemory || needsMainThreadPng) && entry.renderedPixels instanceof Uint8ClampedArray) {
            pendingTileWork.push((async () => {
              let renderedCanvas = null;
              try {
                renderedCanvas = renderPixelsToCanvas(entry.renderedPixels, entry.renderedWidth, entry.renderedHeight);
                if (keepBitmapTilesInMemory) {
                  templateTiles[entry.tileKey] = await createBitmapPreservingPixels(renderedCanvas);
                }
                if (needsMainThreadPng) {
                  const canvasBlob = await renderedCanvas.convertToBlob();
                  const canvasBuffer = await canvasBlob.arrayBuffer();
                  templateTilesBuffers[entry.tileKey] = new Uint8Array(canvasBuffer);
                }
              } finally {
                if (renderedCanvas) {
                  cleanUpCanvas(renderedCanvas);
                }
              }
            })());
          }
        }
        if (pendingTileWork.length > 0) {
          await Promise.all(pendingTileWork);
        }
      }
      // Drain anything still dispatched when the loop broke early, so a later rejection cannot
      // surface as an unhandled rejection.
      for (const pending of inFlight.values()) {
        try { await pending; } catch (_) {}
      }
      inFlight.clear();
    }
    if (workerChunkBuildFailed) {
      Object.keys(templateTiles).forEach((key) => { delete templateTiles[key]; });
      Object.keys(templateTilesBuffers).forEach((key) => { delete templateTilesBuffers[key]; });
      Object.keys(templateChunkSamples).forEach((key) => { delete templateChunkSamples[key]; });
      Object.keys(templateChunkSampleBuffers).forEach((key) => { delete templateChunkSampleBuffers[key]; });
      paletteStatsAccumulator = createPaletteStatsAccumulator();
    }
    if (!useWorkerChunkBuild || workerChunkBuildFailed) {
      for (const chunk of chunkDescriptors) {
        const useSampleBasedChunking = !!(sourceData && needsChunkSamples);
        const sampleData = useSampleBasedChunking
          ? buildChunkSampleDataFromSource(
            sourceData,
            imageWidth,
            chunk.sourceX,
            chunk.sourceY,
            chunk.drawSizeX,
            chunk.drawSizeY,
            paletteStatsAccumulator,
          )
          : (sourceData ? null : createChunkSampleData(chunk.drawSizeX, chunk.drawSizeY, 0, true));

        if (sourceData ? (persistBitmapTiles || keepBitmapTilesInMemory) : true) {
          if (!canvas) {
            canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
            context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) {
              throw new Error('Failed to initialize template chunk canvas.');
            }
            context.imageSmoothingEnabled = false;
          }
          const canvasWidth = chunk.drawSizeX * shreadSize;
          const canvasHeight = chunk.drawSizeY * shreadSize;
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          context.imageSmoothingEnabled = false;
          context.clearRect(0, 0, canvasWidth, canvasHeight);
          if (sampleData) {
            const chunkImage = context.createImageData(canvasWidth, canvasHeight);
            renderSampleDataToImage({
              sampleData,
              imageData: chunkImage,
              resultWidth: canvasWidth,
              drawSize: shreadSize,
              maskPoints: templateMaskPoints,
              maskRowSpans: templateMaskRowSpans,
              includeDefaceCheckerboard: true,
            });
            context.putImageData(chunkImage, 0, 0);
          } else {
            context.drawImage(
              bitmap,
              chunk.pixelX - this.coords[2],
              chunk.pixelY - this.coords[3],
              chunk.drawSizeX,
              chunk.drawSizeY,
              0,
              0,
              chunk.drawSizeX * shreadSize,
              chunk.drawSizeY * shreadSize
            );

            const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
            for (let y = 0; y < canvasHeight; y++) {
              for (let x = 0; x < canvasWidth; x++) {
                const pixelIndex = (y * canvasWidth + x) * 4;
                if (
                  imageData.data[pixelIndex] === 222 &&
                  imageData.data[pixelIndex + 1] === 250 &&
                  imageData.data[pixelIndex + 2] === 206
                ) {
                  if ((x + y) % 2 === 0) {
                    imageData.data[pixelIndex] = 0;
                    imageData.data[pixelIndex + 1] = 0;
                    imageData.data[pixelIndex + 2] = 0;
                  } else {
                    imageData.data[pixelIndex] = 255;
                    imageData.data[pixelIndex + 1] = 255;
                    imageData.data[pixelIndex + 2] = 255;
                  }
                  imageData.data[pixelIndex + 3] = 32;
                } else if (!this.customMask(x, y, shreadSize)) {
                  imageData.data[pixelIndex + 3] = 0;
                }
              }
            }
            context.putImageData(imageData, 0, 0);
          }
          if (keepBitmapTilesInMemory) {
            templateTiles[chunk.tileKey] = await createBitmapPreservingPixels(canvas);
          }
          if (persistBitmapTiles) {
            const canvasBlob = await canvas.convertToBlob();
            const canvasBuffer = await canvasBlob.arrayBuffer();
            templateTilesBuffers[chunk.tileKey] = new Uint8Array(canvasBuffer);
          }
        }
        if (keepChunkSamplesInMemory && sampleData) {
          templateChunkSamples[chunk.tileKey] = sampleData;
        }
        if (persistChunkSamples && sampleData && !lazyPersistChunkSamples) {
          templateChunkSampleBuffers[chunk.tileKey] = encodeChunkSampleBytes(sampleData);
        }
      }
    }
    if (paletteStatsAccumulator) {
      const paletteStats = finalizePaletteStatsAccumulator(paletteStatsAccumulator);
      this.requiredPixelCount = paletteStats.required;
      this.defacePixelCount = paletteStats.deface;
      const paletteObj = {};
      for (const [key, count] of (paletteStats.paletteMap ?? new Map()).entries()) {
        paletteObj[key] = { count, enabled: true };
      }
      this.colorPalette = paletteObj;
    } else if (precomputedPaletteStats) {
      this.requiredPixelCount = Math.max(0, Number(precomputedPaletteStats.required) || 0);
      this.defacePixelCount = Math.max(0, Number(precomputedPaletteStats.deface) || 0);
      const paletteObj = {};
      for (const [key, count] of (precomputedPaletteStats.paletteMap ?? new Map()).entries()) {
        paletteObj[key] = { count, enabled: true };
      }
      this.colorPalette = paletteObj;
    }
    bitmap.close();
    cleanUpCanvas(sourceCanvas);
    sourceCanvas = null;
    if (canvas) {
      cleanUpCanvas(canvas);
      canvas = null;
    }

    profiler.record('create:tiles', templateTileKeys.length);
    profiler.record('create:pixels', imageWidth * imageHeight);
    profiler.end('create:total');

    return {
      templateTiles,
      templateTilesBuffers,
      templateChunkSamples,
      templateChunkSampleBuffers,
      templateTileKeys,
    };
  }

  /** Get the bitmap for a tile key. Supporting memory-saving mode
   * @param {string} tileKey - The tile key
   * @param {boolean} memorySaving - Whether to store the bitmap in memory
   * @since 0.85.33
   */
  async getChunked(tileKey, memorySaving = false) {
    const hasChunk = this.chunked && Object.prototype.hasOwnProperty.call(this.chunked, tileKey);
    const hasBuffer = this.chunkedBuffer && Object.prototype.hasOwnProperty.call(this.chunkedBuffer, tileKey);
    if (!hasChunk && !hasBuffer) {
      return undefined;
    }
    if (hasChunk && this.chunked[tileKey] !== null) {
      const result = this.chunked[tileKey];
      if (memorySaving) {
        // boundary case: setMemorySavingMode should have cleared this
        // need to set to null since memorySaving would close the bitmap after use
        this.chunked[tileKey] = null;
      }
      return result;
    }
    const bufferBytes = this.getChunkBufferBytes(tileKey);
    if (!(bufferBytes instanceof Uint8Array)) {
      return undefined;
    }
    const templateBlob = new Blob([bufferBytes], { type: "image/png" });
    const templateBitmap = await createBitmapPreservingPixels(templateBlob); // Blob -> Bitmap
    if (memorySaving === false) {
      if (!this.chunked || typeof this.chunked !== 'object') {
        this.chunked = {};
      }
      this.chunked[tileKey] = templateBitmap;
    };
    return templateBitmap;
  }
}
