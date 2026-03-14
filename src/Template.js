import { uint8ToBase64, base64ToUint8, cleanUpCanvas, rgbToMeta, colorpalette, testCanvasSize, createBitmapPreservingPixels } from "./utils";
import {
  buildMaskRowSpans,
  createChunkSampleData,
  encodeChunkSampleData,
  decodeChunkSampleBuffer,
  inspectSourceImagePalette,
  createPaletteStatsAccumulator,
  finalizePaletteStatsAccumulator,
  buildChunkSampleDataFromSource,
  renderSampleDataToImage,
} from "./templateChunkUtils.js";

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
const clampUnit = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const normalizeDistanceMode = (value) => String(value || '').toLowerCase() === 'euclidean' ? 'euclidean' : 'weighted';
const normalizeDitherMode = (value) => String(value || '').toLowerCase() === 'floyd-steinberg' ? 'floyd-steinberg' : 'none';

const templatePaletteColors = (() => {
  const options = [];
  const seen = new Set();
  for (const color of colorpalette) {
    const colorName = String(color?.name || '').trim().toLowerCase();
    if (!Array.isArray(color?.rgb) || color.rgb.length < 3) continue;
    if (colorName === 'transparent') continue;
    const rgb = color.rgb.slice(0, 3).map(clampByte);
    const key = rgb.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ key, rgb });
  }
  if (!options.length) {
    options.push({ key: '0,0,0', rgb: [0, 0, 0] });
  }
  return options;
})();

export const templatePaletteConversionDefaults = Object.freeze({
  ditherMode: 'none',
  ditherStrength: 1,
  distanceMode: 'weighted',
  alphaThreshold: 1,
  serpentine: true,
  antiDitherStrength: 0,
});

export function normalizeTemplatePaletteConversionOptions(options = {}) {
  const normalized = {
    ditherMode: normalizeDitherMode(options?.ditherMode ?? templatePaletteConversionDefaults.ditherMode),
    ditherStrength: clampUnit(options?.ditherStrength ?? templatePaletteConversionDefaults.ditherStrength),
    distanceMode: normalizeDistanceMode(options?.distanceMode ?? templatePaletteConversionDefaults.distanceMode),
    alphaThreshold: clampByte(options?.alphaThreshold ?? templatePaletteConversionDefaults.alphaThreshold),
    serpentine: options?.serpentine !== false,
    antiDitherStrength: clampUnit(options?.antiDitherStrength ?? templatePaletteConversionDefaults.antiDitherStrength),
  };
  if (normalized.ditherMode === 'none') {
    normalized.ditherStrength = 0;
  }
  return normalized;
}

const colorDistanceSq = (r, g, b, paletteRgb, distanceMode) => {
  const dr = r - paletteRgb[0];
  const dg = g - paletteRgb[1];
  const db = b - paletteRgb[2];
  if (distanceMode === 'euclidean') {
    return dr * dr + dg * dg + db * db;
  }
  // A weighted RGB distance that better reflects perceived luminance.
  return dr * dr * 0.2126 + dg * dg * 0.7152 + db * db * 0.0722;
};

const getNearestPaletteColor = (r, g, b, options, cache) => {
  const cacheKey = `${clampByte(r)},${clampByte(g)},${clampByte(b)},${options.distanceMode}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  let nearest = templatePaletteColors[0];
  let nearestDistance = Infinity;
  for (const entry of templatePaletteColors) {
    const distance = colorDistanceSq(r, g, b, entry.rgb, options.distanceMode);
    if (distance < nearestDistance) {
      nearest = entry;
      nearestDistance = distance;
      if (distance === 0) break;
    }
  }
  cache.set(cacheKey, nearest);
  return nearest;
};

export function convertImageDataToWplacePalette(imageData, options = {}) {
  if (!imageData || !imageData.data || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height)) {
    return {
      imageData,
      options: normalizeTemplatePaletteConversionOptions(options),
      stats: {
        nonPalettePixels: 0,
        nonPaletteColorCount: 0,
        convertedPixels: 0,
        convertedColorCount: 0,
        remainingOtherPixels: 0,
      },
    };
  }

  const normalizedOptions = normalizeTemplatePaletteConversionOptions(options);
  const width = Math.max(1, Math.trunc(imageData.width));
  const height = Math.max(1, Math.trunc(imageData.height));
  const data = imageData.data;
  const pixelCount = width * height;
  const original = new Uint8ClampedArray(data);
  const alphaPass = new Uint8Array(pixelCount);
  const nonPaletteColorKeys = new Set();

  let nonPalettePixels = 0;
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    const alpha = original[base + 3];
    if (alpha < normalizedOptions.alphaThreshold) {
      data[base + 3] = 0;
      continue;
    }
    alphaPass[i] = 1;
    const key = `${original[base]},${original[base + 1]},${original[base + 2]}`;
    if (!rgbToMeta.has(key)) {
      nonPalettePixels++;
      nonPaletteColorKeys.add(key);
    }
  }

  const nearestCache = new Map();
  if (normalizedOptions.ditherMode === 'floyd-steinberg' && normalizedOptions.ditherStrength > 0) {
    const workingR = new Float32Array(pixelCount);
    const workingG = new Float32Array(pixelCount);
    const workingB = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const base = i * 4;
      workingR[i] = original[base];
      workingG[i] = original[base + 1];
      workingB[i] = original[base + 2];
    }
    const addError = (x, y, errR, errG, errB, factor) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const idx = y * width + x;
      if (!alphaPass[idx]) return;
      workingR[idx] += errR * factor;
      workingG[idx] += errG * factor;
      workingB[idx] += errB * factor;
    };

    for (let y = 0; y < height; y++) {
      const reverse = normalizedOptions.serpentine && (y % 2 === 1);
      const xStart = reverse ? width - 1 : 0;
      const xEnd = reverse ? -1 : width;
      const xStep = reverse ? -1 : 1;
      for (let x = xStart; x !== xEnd; x += xStep) {
        const idx = y * width + x;
        const base = idx * 4;
        if (!alphaPass[idx]) {
          data[base + 3] = 0;
          continue;
        }
        const originalKey = `${original[base]},${original[base + 1]},${original[base + 2]}`;
        if (rgbToMeta.has(originalKey)) {
          data[base] = original[base];
          data[base + 1] = original[base + 1];
          data[base + 2] = original[base + 2];
          data[base + 3] = original[base + 3];
          continue;
        }

        const sourceR = clampByte(workingR[idx]);
        const sourceG = clampByte(workingG[idx]);
        const sourceB = clampByte(workingB[idx]);
        const nearest = getNearestPaletteColor(sourceR, sourceG, sourceB, normalizedOptions, nearestCache);
        data[base] = nearest.rgb[0];
        data[base + 1] = nearest.rgb[1];
        data[base + 2] = nearest.rgb[2];
        data[base + 3] = original[base + 3];

        const errR = (workingR[idx] - nearest.rgb[0]) * normalizedOptions.ditherStrength;
        const errG = (workingG[idx] - nearest.rgb[1]) * normalizedOptions.ditherStrength;
        const errB = (workingB[idx] - nearest.rgb[2]) * normalizedOptions.ditherStrength;

        if (!reverse) {
          addError(x + 1, y, errR, errG, errB, 7 / 16);
          addError(x - 1, y + 1, errR, errG, errB, 3 / 16);
          addError(x, y + 1, errR, errG, errB, 5 / 16);
          addError(x + 1, y + 1, errR, errG, errB, 1 / 16);
        } else {
          addError(x - 1, y, errR, errG, errB, 7 / 16);
          addError(x + 1, y + 1, errR, errG, errB, 3 / 16);
          addError(x, y + 1, errR, errG, errB, 5 / 16);
          addError(x - 1, y + 1, errR, errG, errB, 1 / 16);
        }
      }
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      const base = i * 4;
      if (!alphaPass[i]) {
        data[base + 3] = 0;
        continue;
      }
      const originalKey = `${original[base]},${original[base + 1]},${original[base + 2]}`;
      if (rgbToMeta.has(originalKey)) {
        data[base] = original[base];
        data[base + 1] = original[base + 1];
        data[base + 2] = original[base + 2];
        data[base + 3] = original[base + 3];
        continue;
      }
      const nearest = getNearestPaletteColor(original[base], original[base + 1], original[base + 2], normalizedOptions, nearestCache);
      data[base] = nearest.rgb[0];
      data[base + 1] = nearest.rgb[1];
      data[base + 2] = nearest.rgb[2];
      data[base + 3] = original[base + 3];
    }
  }

  if (normalizedOptions.antiDitherStrength > 0) {
    const applyAntiDither = () => {
      const strength = normalizedOptions.antiDitherStrength;
      const minDominance = 0.75 - 0.4 * strength; // 0.75 -> 0.35
      const passes = Math.max(1, Math.round(strength * 3)); // 1..3
      let src = new Uint8ClampedArray(data);
      let dst = new Uint8ClampedArray(src.length);
      const neighborOffsets = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0],  [0, 0],  [1, 0],
        [-1, 1],  [0, 1],  [1, 1],
      ];
      for (let pass = 0; pass < passes; pass++) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const base = idx * 4;
            const alpha = src[base + 3];
            if (alpha < normalizedOptions.alphaThreshold) {
              dst[base] = src[base];
              dst[base + 1] = src[base + 1];
              dst[base + 2] = src[base + 2];
              dst[base + 3] = 0;
              continue;
            }

            let total = 0;
            let bestKey = (src[base] << 16) | (src[base + 1] << 8) | src[base + 2];
            let bestCount = 0;
            const counts = new Map();

            for (const [ox, oy] of neighborOffsets) {
              const nx = x + ox;
              const ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const nidx = ny * width + nx;
              const nbase = nidx * 4;
              if (src[nbase + 3] < normalizedOptions.alphaThreshold) continue;
              const key = (src[nbase] << 16) | (src[nbase + 1] << 8) | src[nbase + 2];
              const count = (counts.get(key) || 0) + 1;
              counts.set(key, count);
              total++;
              if (count > bestCount) {
                bestCount = count;
                bestKey = key;
              }
            }

            const dominance = total > 0 ? bestCount / total : 0;
            const outKey = dominance >= minDominance
              ? bestKey
              : ((src[base] << 16) | (src[base + 1] << 8) | src[base + 2]);
            dst[base] = (outKey >> 16) & 255;
            dst[base + 1] = (outKey >> 8) & 255;
            dst[base + 2] = outKey & 255;
            dst[base + 3] = src[base + 3];
          }
        }
        const temp = src;
        src = dst;
        dst = temp;
      }
      data.set(src);
    };
    applyAntiDither();
  }

  const convertedColorKeys = new Set();
  let convertedPixels = 0;
  let remainingOtherPixels = 0;
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    if (data[base + 3] === 0) continue;
    const outputKey = `${data[base]},${data[base + 1]},${data[base + 2]}`;
    if (!rgbToMeta.has(outputKey)) {
      remainingOtherPixels++;
    }
    if (
      original[base] !== data[base] ||
      original[base + 1] !== data[base + 1] ||
      original[base + 2] !== data[base + 2] ||
      original[base + 3] !== data[base + 3]
    ) {
      convertedPixels++;
      convertedColorKeys.add(`${original[base]},${original[base + 1]},${original[base + 2]}`);
    }
  }

  return {
    imageData,
    options: normalizedOptions,
    stats: {
      nonPalettePixels,
      nonPaletteColorCount: nonPaletteColorKeys.size,
      convertedPixels,
      convertedColorCount: convertedColorKeys.size,
      remainingOtherPixels,
    },
  };
}

/** An instance of a template.
 * Handles all mathematics, manipulation, and analysis regarding a single template.
 * @class Template
 * @since 0.65.2
 */
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
    this.tileSize = tileSize;
    this.imageWidth = Number.isFinite(Number(imageWidth)) ? Math.max(1, Math.trunc(Number(imageWidth))) : null;
    this.imageHeight = Number.isFinite(Number(imageHeight)) ? Math.max(1, Math.trunc(Number(imageHeight))) : null;
    this.forcePaletteConversion = Boolean(forcePaletteConversion);
    this.paletteConversionOptions = normalizeTemplatePaletteConversionOptions(paletteConversionOptions || templatePaletteConversionDefaults);
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
    const conversion = convertImageDataToWplacePalette(sourceImageData, this.paletteConversionOptions);
    const changed = Number(conversion?.stats?.convertedPixels) || 0;
    if (changed <= 0) {
      cleanUpCanvas(conversionCanvas);
      conversionCanvas = null;
      return bitmap;
    }
    conversionCtx.putImageData(conversion.imageData, 0, 0);
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
    let count = 0;
    for (let y = 0, sampleY = center; y < logicalHeight; y++, sampleY += shreadSize) {
      for (let x = 0, sampleX = center; x < logicalWidth; x++, sampleX += shreadSize) {
        const idx = (sampleY * bitmap.width + sampleX) * 4;
        if ((imageData[idx + 3] || 0) > 0) {
          count++;
        }
      }
    }
    const sampleData = createChunkSampleData(logicalWidth, logicalHeight, count, false);
    let writeIndex = 0;
    for (let y = 0, sampleY = center; y < logicalHeight; y++, sampleY += shreadSize) {
      for (let x = 0, sampleX = center; x < logicalWidth; x++, sampleX += shreadSize) {
        const idx = (sampleY * bitmap.width + sampleX) * 4;
        const alpha = imageData[idx + 3] || 0;
        if (alpha <= 0) continue;
        sampleData.x[writeIndex] = x;
        sampleData.y[writeIndex] = y;
        sampleData.r[writeIndex] = imageData[idx];
        sampleData.g[writeIndex] = imageData[idx + 1];
        sampleData.b[writeIndex] = imageData[idx + 2];
        sampleData.a[writeIndex] = alpha;
        sampleData.flags[writeIndex] = 0;
        writeIndex++;
      }
    }
    return sampleData;
  }

  async getChunkSamples(tileKey, options = {}) {
    const stored = this.decodeStoredChunkSamples(tileKey);
    if (stored) {
      return stored;
    }
    if (this.chunkedSamples?.[tileKey]) {
      return this.chunkedSamples[tileKey];
    }
    if (options?.allowBitmapFallback === false) {
      return null;
    }
    const memorySaving = options?.memorySaving === true;
    const bitmap = await this.getChunked(tileKey, memorySaving);
    if (!(bitmap instanceof ImageBitmap)) {
      return null;
    }
    const sampleData = this.extractChunkSamplesFromBitmap(bitmap);
    if (sampleData) {
      this.chunkedSamples[tileKey] = sampleData;
    }
    if (memorySaving) {
      bitmap.close?.();
    }
    return sampleData;
  }

  /** Creates chunks of the template for each tile.
   * 
   * @returns {Object} Collection of template bitmaps & buffers organized by tile coordinates
   * @since 0.65.4
   */
  async createTemplateTiles(anchor, options = {}) {
    if (this.shreadSize === null) {
      // initialize shreadSize (usually already assigned by the template manager)
      this.shreadSize = testCanvasSize(5000, 5000) ? 5 : 4; // Scale image factor for pixel art enhancement (must be odd)
    }
    const shreadSize = this.shreadSize;
    const persistBitmapTiles = options?.persistBitmapTiles === true;
    const keepBitmapTilesInMemory = options?.keepBitmapTilesInMemory !== false;
    const persistChunkSamples = options?.persistChunkSamples !== false;
    const keepChunkSamplesInMemory = options?.keepChunkSamplesInMemory !== false;
    let bitmap = this.file instanceof ImageBitmap ? this.file : await createBitmapPreservingPixels(this.file); // Create efficient bitmap from uploaded file
    if (this.forcePaletteConversion) {
      bitmap = await this.convertBitmapToWplacePalette(bitmap);
    }
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;
    this.imageWidth = Math.max(1, Math.trunc(imageWidth));
    this.imageHeight = Math.max(1, Math.trunc(imageHeight));
  
    const [tx, ty, px, py] = this.coords;
    let mapX = tx * this.tileSize + px;
    let mapY = ty * this.tileSize + py;
    // process anchor
    mapX -= Math.floor((imageWidth - 1) * {
      "l": 0,
      "m": 0.5,
      "r": 1,
    }[anchor[0]]);
    mapY -= Math.floor((imageHeight - 1) * {
      "t": 0,
      "m": 0.5,
      "b": 1,
    }[anchor[1]]);
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
    try {
      sourceCanvas = new OffscreenCanvas(imageWidth, imageHeight);
      sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) {
        throw new Error('Failed to initialize template source canvas.');
      }
      sourceContext.imageSmoothingEnabled = false;
      sourceContext.clearRect(0, 0, imageWidth, imageHeight);
      sourceContext.drawImage(bitmap, 0, 0);
      sourceData = sourceContext.getImageData(0, 0, imageWidth, imageHeight).data;
      paletteStatsAccumulator = createPaletteStatsAccumulator();
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
    let canvas = null;
    let context = null;

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
        templateTileKeys.push(templateTileName);

        const sourceX = pixelX - this.coords[2];
        const sourceY = pixelY - this.coords[3];
        const sampleData = sourceData
          ? buildChunkSampleDataFromSource(
            sourceData,
            imageWidth,
            sourceX,
            sourceY,
            drawSizeX,
            drawSizeY,
            paletteStatsAccumulator,
          )
          : createChunkSampleData(drawSizeX, drawSizeY, 0, true);

        if (sourceData ? (persistBitmapTiles || keepBitmapTilesInMemory) : true) {
          if (!canvas) {
            canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
            context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) {
              throw new Error('Failed to initialize template chunk canvas.');
            }
            context.imageSmoothingEnabled = false;
          }
          const canvasWidth = drawSizeX * shreadSize;
          const canvasHeight = drawSizeY * shreadSize;
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          context.imageSmoothingEnabled = false;
          context.clearRect(0, 0, canvasWidth, canvasHeight);
          if (sourceData) {
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
              pixelX - this.coords[2],
              pixelY - this.coords[3],
              drawSizeX,
              drawSizeY,
              0,
              0,
              drawSizeX * shreadSize,
              drawSizeY * shreadSize
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
            templateTiles[templateTileName] = await createBitmapPreservingPixels(canvas);
          }
          if (persistBitmapTiles) {
            const canvasBlob = await canvas.convertToBlob();
            const canvasBuffer = await canvasBlob.arrayBuffer();
            templateTilesBuffers[templateTileName] = uint8ToBase64(new Uint8Array(canvasBuffer));
          }
        }
        if (keepChunkSamplesInMemory) {
          templateChunkSamples[templateTileName] = sampleData;
        }
        if (persistChunkSamples) {
          templateChunkSampleBuffers[templateTileName] = encodeChunkSampleData(sampleData);
        }
        // Record tile prefix for fast lookup later
        this.tilePrefixes.add(templateTileName.split(',').slice(0,2).join(','));

        pixelX += drawSizeX;
      }

      pixelY += drawSizeY;
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
    }
    bitmap.close();
    cleanUpCanvas(sourceCanvas);
    sourceCanvas = null;
    if (canvas) {
      cleanUpCanvas(canvas);
      canvas = null;
    }

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
