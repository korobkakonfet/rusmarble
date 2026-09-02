import {
  buildChunkSampleDataFromSource,
  collectTemplateProgressFromSamples,
  decodeChunkSampleBuffer,
  encodeChunkSampleBytes,
  finalizePaletteStatsAccumulator,
  renderSampleDataToImage,
  findNearestUnpaintedSamplePixel,
  TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE,
  isDefaceRgb,
  snapRgbToNearestPalette,
} from './templateChunkUtils.js';
import {
  filterBitmapPixelsWithWasm,
  isFilterBitmapPixelsWasmAvailable,
} from './templateFilterWasm.js';
import { convertImageDataToWplacePalette, templatePalettePackedSet } from './templatePaletteConversion.js';
import { uint8ToBase64, compressTemplateBufferPayload } from './utils.js';

const cloneDisplayedColorSet = (displayedColors) => (
  Array.isArray(displayedColors) ? new Set(displayedColors) : null
);

const toUint16RowSpans = (maskRowSpans) => (
  Array.isArray(maskRowSpans)
    ? maskRowSpans.map((row) => (row instanceof Uint16Array ? row : Uint16Array.from(row || [])))
    : []
);

const toUint8Clamped = (value) => (
  value instanceof Uint8ClampedArray ? value : new Uint8ClampedArray(value || 0)
);

const transferBuffers = (parts) => {
  const transferList = [];
  parts.forEach((part) => {
    if (part?.buffer instanceof ArrayBuffer) {
      transferList.push(part.buffer);
    }
  });
  return transferList;
};

const renderChunkPixels = ({
  sampleData,
  resultWidth,
  resultHeight,
  drawSize,
  maskPoints,
  maskRowSpans,
  displayedColors,
  defaceRender,
  enforceTransparentAsDeface,
  transparentEraseColor,
}) => {
  const pixels = new Uint8ClampedArray(resultWidth * resultHeight * 4);
  renderSampleDataToImage({
    sampleData,
    imageData: { data: pixels },
    resultWidth,
    drawSize,
    maskPoints,
    maskRowSpans: toUint16RowSpans(maskRowSpans),
    displayedColorSet: cloneDisplayedColorSet(displayedColors),
    defaceRender,
      enforceTransparentAsDeface,
    transparentEraseColor,
  });
  return pixels;
};

const packRgb = (r, g, b) => ((r << 16) | (g << 8) | b);

const filterBitmapPixelsJs = ({
  templateData,
  templateWidth,
  templateHeight,
  resultWidth,
  resultHeight,
  drawMultTemplate,
  drawMultResult,
  drawMultCenter,
  maskPoints,
  displayedColorPackedSet,
  knownColorPackedSet,
  displayOther,
}) => {
  const pixels = new Uint8ClampedArray(resultWidth * resultHeight * 4);
  const templateRowStepBytes = templateWidth << 2;
  const resultRowStepBytes = resultWidth << 2;
  const drawMultTemplateStepBytes = drawMultTemplate << 2;
  const drawMultResultStepBytes = drawMultResult << 2;
  for (const [offsetX, offsetY] of maskPoints) {
    let templateRowBase = drawMultCenter * templateRowStepBytes;
    let resultRowBase = offsetY * resultRowStepBytes;
    for (let yt = drawMultCenter; yt < templateHeight; yt += drawMultTemplate) {
      let templatePixelPtr = templateRowBase + (drawMultCenter << 2);
      let resultPixelPtr = resultRowBase + (offsetX << 2);
      for (let xt = drawMultCenter; xt < templateWidth; xt += drawMultTemplate) {
        const A = templateData[templatePixelPtr + 3];
        if (A >= 1) {
          const R = templateData[templatePixelPtr];
          const G = templateData[templatePixelPtr + 1];
          const B = templateData[templatePixelPtr + 2];
          const packed = packRgb(R, G, B);
          const shouldRender = displayedColorPackedSet.has(packed)
            || (displayOther && !knownColorPackedSet.has(packed));
          if (shouldRender) {
            pixels[resultPixelPtr] = R;
            pixels[resultPixelPtr + 1] = G;
            pixels[resultPixelPtr + 2] = B;
            pixels[resultPixelPtr + 3] = A;
          }
        }
        templatePixelPtr += drawMultTemplateStepBytes;
        resultPixelPtr += drawMultResultStepBytes;
      }
      templateRowBase += drawMultTemplate * templateRowStepBytes;
      resultRowBase += drawMultResult * resultRowStepBytes;
    }
  }
  return pixels;
};

/** Decode a tile PNG straight to pixels inside the worker.
 * Mirrors createBitmapPreservingPixels: the explicit options keep Chromium variants from
 * colour-managing the tile differently, which would produce phantom "wrong pixel" counts.
 */
const decodeTilePixelsInWorker = async (tileBytes, tileSize) => {
  const blob = new Blob([tileBytes]);
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
      imageOrientation: 'none',
    });
  } catch (_) {
    bitmap = await createImageBitmap(blob);
  }
  const canvas = new OffscreenCanvas(tileSize, tileSize);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, tileSize, tileSize);
  context.drawImage(bitmap, 0, 0, tileSize, tileSize);
  bitmap.close();
  const pixels = context.getImageData(0, 0, tileSize, tileSize).data;
  canvas.width = 0;
  canvas.height = 0;
  return pixels;
};

const handlers = {
  /** Count progress for every template chunk that lands on one map tile, in a single call.
   * Doing all chunks together means the tile's pixels are decoded once and never copied: the
   * per-chunk variant had to hand the main thread's buffer over by transfer, forcing a fresh
   * 1MB clone for each additional template on the same tile.
   * @since 0.87.71
   */
  async scanTileProgressBatch(payload) {
    const tileSize = payload.tileSize;
    // tileBytes is the encoded PNG — pass it through untouched; coercing it to Uint8ClampedArray
    // would copy the whole buffer for no reason.
    const tilePixels = payload.tileBytes
      ? await decodeTilePixelsInWorker(payload.tileBytes, tileSize)
      : toUint8Clamped(payload.tilePixels);

    // collectTemplateProgressFromSamples accumulates into these, so sharing them across entries
    // merges the chunks for free — no cross-entry merge pass needed.
    const paletteStats = {};
    const templateStats = {};
    const displayedColors = cloneDisplayedColorSet(payload.displayedColors);
    let paintedCount = 0;
    let wrongCount = 0;
    let requiredCount = 0;
    const errorMaps = [];

    for (const entry of (payload.entries || [])) {
      const sampleData = decodeChunkSampleBuffer(entry.sampleData);
      if (!sampleData) continue;
      const errorWidth = Math.max(0, Math.trunc(Number(entry.errorWidth) || 0));
      const errorHeight = Math.max(0, Math.trunc(Number(entry.errorHeight) || 0));
      const errorData = entry.includeErrorMap && errorWidth > 0 && errorHeight > 0
        ? new Uint8ClampedArray(errorWidth * errorHeight * 4)
        : null;

      const result = collectTemplateProgressFromSamples({
        sampleData,
        tilePixels,
        tileSize,
        offsetX: entry.offsetX,
        offsetY: entry.offsetY,
        tileCoords: payload.tileCoords,
        templateEnabled: entry.templateEnabled !== false,
        templateKey: entry.templateKey,
        paletteStats,
        templateStats,
        exampleMax: payload.exampleMax,
        errorMapOnlyEnabledColors: payload.errorMapOnlyEnabledColors === true,
        displayedColors,
        errorData,
        errorWidth,
      });

      paintedCount += result.paintedCount || 0;
      wrongCount += result.wrongCount || 0;
      requiredCount += result.requiredCount || 0;
      if (errorData) {
        errorMaps.push({ tileKey: entry.tileKey, sortID: entry.sortID, errorWidth, errorHeight, errorData });
      }
    }

    return { paintedCount, wrongCount, requiredCount, paletteStats, templateStats, errorMaps };
  },

  scanTileProgress(payload) {
    const sampleData = decodeChunkSampleBuffer(payload.sampleData);
    const paletteStats = {};
    const templateStats = {};
    const errorWidth = Math.max(0, Math.trunc(Number(payload.errorWidth) || 0));
    const errorHeight = Math.max(0, Math.trunc(Number(payload.errorHeight) || 0));
    const errorData = payload.includeErrorMap && errorWidth > 0 && errorHeight > 0
      ? new Uint8ClampedArray(errorWidth * errorHeight * 4)
      : null;
    const result = collectTemplateProgressFromSamples({
      sampleData,
      tilePixels: toUint8Clamped(payload.tilePixels),
      tileSize: payload.tileSize,
      offsetX: payload.offsetX,
      offsetY: payload.offsetY,
      tileCoords: payload.tileCoords,
      templateEnabled: payload.templateEnabled !== false,
      templateKey: payload.templateKey,
      paletteStats,
      templateStats,
      exampleMax: payload.exampleMax,
      errorMapOnlyEnabledColors: payload.errorMapOnlyEnabledColors === true,
      displayedColors: cloneDisplayedColorSet(payload.displayedColors),
      errorData,
      errorWidth,
    });
    return {
      ...result,
      paletteStats,
      templateStats,
      errorWidth,
      errorHeight,
      errorData,
    };
  },

  renderOverlayChunk(payload) {
    const sampleData = decodeChunkSampleBuffer(payload.sampleData);
    const pixels = renderChunkPixels({
      sampleData,
      resultWidth: payload.resultWidth,
      resultHeight: payload.resultHeight,
      drawSize: payload.drawSize,
      maskPoints: payload.maskPoints,
      maskRowSpans: payload.maskRowSpans,
      displayedColors: payload.displayedColors,
    });
    return {
      resultWidth: payload.resultWidth,
      resultHeight: payload.resultHeight,
      pixels,
    };
  },

  renderOverlayChunkBatch(payload) {
    const shared = {
      drawSize: payload.drawSize,
      maskPoints: payload.maskPoints,
      maskRowSpans: toUint16RowSpans(payload.maskRowSpans),
      displayedColors: payload.displayedColors,
      defaceRender: payload.defaceRender ?? 'color',
      enforceTransparentAsDeface: payload.enforceTransparentAsDeface === true,
      transparentEraseColor: payload.transparentEraseColor ?? null,
    };
    const results = (payload.chunks ?? []).map((chunk) => {
      const sampleData = decodeChunkSampleBuffer(chunk.sampleData);
      const pixels = renderChunkPixels({
        sampleData,
        resultWidth: chunk.resultWidth,
        resultHeight: chunk.resultHeight,
        ...shared,
      });
      return { tileKey: chunk.tileKey, resultWidth: chunk.resultWidth, resultHeight: chunk.resultHeight, pixels };
    });
    return { results };
  },

  // Renders all sample tiles and composites them (plus any pre-rendered cached tiles) into one
  // OffscreenCanvas, returning a transferable ImageBitmap.
  // sampleChunks: tiles with raw sample data that need renderChunkPixels.
  // cachedChunks:  tiles with pre-rendered pixels (Uint8ClampedArray) to composite directly.
  // Both carry destX/destY (pixel offset within the merged canvas).
  // This lets the main thread do a single addTemplateFullCanvas call instead of N addTemplateCanvas calls.
  renderAndMergeOverlayChunks(payload) {
    const canvasWidth = payload.canvasWidth | 0;
    const canvasHeight = payload.canvasHeight | 0;
    if (canvasWidth <= 0 || canvasHeight <= 0) return { bitmap: null };
    const shared = {
      drawSize: payload.drawSize,
      maskPoints: payload.maskPoints,
      maskRowSpans: toUint16RowSpans(payload.maskRowSpans),
      displayedColors: payload.displayedColors,
      defaceRender: payload.defaceRender ?? 'color',
      enforceTransparentAsDeface: payload.enforceTransparentAsDeface === true,
      transparentEraseColor: payload.transparentEraseColor ?? null,
    };
    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    // Render and place uncached sample tiles
    for (const chunk of (payload.sampleChunks ?? [])) {
      const sampleData = decodeChunkSampleBuffer(chunk.sampleData);
      const pixels = renderChunkPixels({
        sampleData,
        resultWidth: chunk.resultWidth,
        resultHeight: chunk.resultHeight,
        ...shared,
      });
      if (pixels instanceof Uint8ClampedArray) {
        ctx.putImageData(new ImageData(pixels, chunk.resultWidth, chunk.resultHeight), chunk.destX | 0, chunk.destY | 0);
      }
    }
    // Place pre-rendered cached tiles (no re-rendering needed)
    for (const chunk of (payload.cachedChunks ?? [])) {
      if (chunk.pixels instanceof Uint8ClampedArray) {
        ctx.putImageData(new ImageData(chunk.pixels, chunk.resultWidth, chunk.resultHeight), chunk.destX | 0, chunk.destY | 0);
      }
    }
    const bitmap = canvas.transferToImageBitmap();
    return { bitmap };
  },

  filterTemplateBitmap(payload) {
    const templateData = toUint8Clamped(payload.templateData);
    const templateWidth = payload.templateWidth | 0;
    const templateHeight = payload.templateHeight | 0;
    const resultWidth = payload.resultWidth | 0;
    const resultHeight = payload.resultHeight | 0;
    const drawMultTemplate = payload.drawMultTemplate | 0;
    const drawMultResult = payload.drawMultResult | 0;
    const drawMultCenter = payload.drawMultCenter | 0;
    const maskPoints = Array.isArray(payload.maskPoints) ? payload.maskPoints : [];
    const displayOther = payload.displayOther === true;

    const displayedColorsPacked = payload.displayedColorsPacked instanceof Uint32Array
      ? payload.displayedColorsPacked
      : new Uint32Array(0);
    const knownColorsPacked = payload.knownColorsPacked instanceof Uint32Array
      ? payload.knownColorsPacked
      : new Uint32Array(0);

    let pixels;
    if (isFilterBitmapPixelsWasmAvailable()) {
      pixels = filterBitmapPixelsWithWasm({
        templateData,
        templateWidth,
        templateHeight,
        resultWidth,
        resultHeight,
        drawMultTemplate,
        drawMultResult,
        drawMultCenter,
        maskPoints,
        displayedColorsPacked,
        knownColorsPacked,
        displayOther,
      });
    }
    if (!pixels) {
      pixels = filterBitmapPixelsJs({
        templateData,
        templateWidth,
        templateHeight,
        resultWidth,
        resultHeight,
        drawMultTemplate,
        drawMultResult,
        drawMultCenter,
        maskPoints,
        displayedColorPackedSet: new Set(displayedColorsPacked),
        knownColorPackedSet: new Set(knownColorsPacked),
        displayOther,
      });
    }
    return { resultWidth, resultHeight, pixels };
  },

  /** Encodes rendered chunk pixels to PNG bytes in-worker.
   * Returns null when the runtime can't do it, so the caller keeps the raw pixels and the main
   * thread can encode them itself.
   */
  async encodeRenderedChunkToPng(pixels, width, height) {
    if (typeof OffscreenCanvas === 'undefined') return null;
    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.putImageData(new ImageData(pixels, width, height), 0, 0);
      const blob = await canvas.convertToBlob();
      return new Uint8Array(await blob.arrayBuffer());
    } catch (_) {
      return null;
    }
  },

  async buildTemplateChunkBatch(payload) {
    const sourceData = toUint8Clamped(payload.sourceData);
    const chunkResults = [];
    const paletteStatsAccumulator = {
      required: 0,
      deface: 0,
      hasOther: false,
      paletteCounts: Object.create(null),
      paletteCountsByIndex: null,
      seenPaletteOrder: null,
    };
    const maskRowSpans = toUint16RowSpans(payload.maskRowSpans);

    for (const chunk of (payload.chunks || [])) {
      const sampleData = buildChunkSampleDataFromSource(
        sourceData,
        payload.imageWidth,
        chunk.sourceX,
        chunk.sourceY,
        chunk.drawSizeX,
        chunk.drawSizeY,
        paletteStatsAccumulator,
      );
      const sampleBytes = encodeChunkSampleBytes(sampleData);
      const resultEntry = {
        tileKey: chunk.tileKey,
        sampleBytes,
      };
      // Rendered pixels are shreadSize² larger than the source region — 25x on most machines —
      // so returning them is by far the most expensive part of the reply. Encode to PNG here
      // when the caller only wants bytes to persist: that both shrinks the transfer by an order
      // of magnitude and keeps the encode off the main thread.
      const needsRenderedPixels = payload.renderChunks === true;
      const needsPng = payload.encodeChunkPngs === true;
      if (needsRenderedPixels || needsPng) {
        const renderedWidth = chunk.drawSizeX * payload.shreadSize;
        const renderedHeight = chunk.drawSizeY * payload.shreadSize;
        const renderedPixels = renderChunkPixels({
          sampleData,
          resultWidth: renderedWidth,
          resultHeight: renderedHeight,
          drawSize: payload.shreadSize,
          maskPoints: payload.maskPoints,
          maskRowSpans,
          displayedColors: null,
        });
        resultEntry.renderedWidth = renderedWidth;
        resultEntry.renderedHeight = renderedHeight;
        const pngBytes = needsPng
          ? await handlers.encodeRenderedChunkToPng(renderedPixels, renderedWidth, renderedHeight)
          : null;
        if (pngBytes) {
          resultEntry.pngBytes = pngBytes;
        }
        // Keep the raw pixels only when the caller needs them for an in-memory bitmap, or when
        // the in-worker encode failed and the main thread has to do it instead.
        if (needsRenderedPixels || !pngBytes) {
          resultEntry.renderedPixels = renderedPixels;
        }
      }
      chunkResults.push(resultEntry);
    }

    return {
      chunkResults,
      paletteStats: finalizePaletteStatsAccumulator(paletteStatsAccumulator),
    };
  },

  convertImageData(payload) {
    const width = payload.width | 0;
    const height = payload.height | 0;
    const pixelData = toUint8Clamped(payload.pixelData);
    const imageData = { data: pixelData, width, height };
    const result = convertImageDataToWplacePalette(imageData, payload.options || {});
    return {
      pixelData: result.imageData.data,
      stats: result.stats,
    };
  },

  countNonPalettePixels(payload) {
    const pixelData = toUint8Clamped(payload.pixelData);
    const knownSet = payload.knownColorsPacked instanceof Uint32Array
      ? new Set(payload.knownColorsPacked)
      : templatePalettePackedSet;
    let otherPixelCount = 0;
    const otherPackedSet = new Set();
    for (let i = 0; i < pixelData.length; i += 4) {
      if (pixelData[i + 3] === 0) continue;
      const packed = ((pixelData[i] << 16) | (pixelData[i + 1] << 8) | pixelData[i + 2]) >>> 0;
      if (knownSet.has(packed)) continue;
      otherPixelCount++;
      otherPackedSet.add(packed);
    }
    return { otherPixelCount, otherColorCount: otherPackedSet.size };
  },

  applyHardEdgeThreshold(payload) {
    const pixelData = toUint8Clamped(payload.pixelData);
    const threshold = (payload.threshold | 0) || 128;
    const colorR = payload.colorR | 0;
    const colorG = payload.colorG | 0;
    const colorB = payload.colorB | 0;
    for (let i = 0; i < pixelData.length; i += 4) {
      if (pixelData[i + 3] < threshold) {
        pixelData[i + 3] = 0;
        continue;
      }
      pixelData[i] = colorR;
      pixelData[i + 1] = colorG;
      pixelData[i + 2] = colorB;
      pixelData[i + 3] = 255;
    }
    return { pixelData };
  },

  countRegionColors(payload) {
    const pixelData = toUint8Clamped(payload.pixelData);
    const width = payload.width | 0;
    const height = payload.height | 0;
    const colorCounts = new Map();
    const borderColorCounts = new Map();
    for (let i = 0; i < pixelData.length; i += 4) {
      if (pixelData[i + 3] < 1) continue;
      const key = `${pixelData[i]},${pixelData[i + 1]},${pixelData[i + 2]}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
      const pixelIndex = i >> 2;
      const y = Math.floor(pixelIndex / width);
      const x = pixelIndex - y * width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        borderColorCounts.set(key, (borderColorCounts.get(key) || 0) + 1);
      }
    }
    return {
      sortedColorCounts: [...colorCounts.entries()].sort((a, b) => b[1] - a[1]),
      sortedBorderColorCounts: [...borderColorCounts.entries()].sort((a, b) => b[1] - a[1]),
    };
  },

  applyFlagMask(payload) {
    const pixelData = toUint8Clamped(payload.pixelData);
    const mapPixels = toUint8Clamped(payload.mapPixels);
    const backgroundPacked = payload.backgroundColorsPacked instanceof Uint32Array
      ? payload.backgroundColorsPacked : new Uint32Array(0);
    const protectedPacked = payload.protectedColorsPacked instanceof Uint32Array
      ? payload.protectedColorsPacked : new Uint32Array(0);
    const backgroundSet = new Set(backgroundPacked);
    const protectedSet = new Set(protectedPacked);
    const onlySelected = payload.ignoreMode === 'only_selected';
    let ignoredPixelCount = 0;
    for (let i = 0; i < pixelData.length; i += 4) {
      if (pixelData[i + 3] < 1) continue;
      const mapPacked = ((mapPixels[i] << 16) | (mapPixels[i + 1] << 8) | mapPixels[i + 2]) >>> 0;
      if (!backgroundSet.has(mapPacked)) continue;
      const isSelected = protectedSet.has(mapPacked);
      const shouldIgnore = onlySelected ? isSelected : !isSelected;
      if (!shouldIgnore) continue;
      pixelData[i + 3] = 0;
      ignoredPixelCount++;
    }
    return { pixelData, ignoredPixelCount };
  },

  downsampleChunk(payload) {
    const sourceData = toUint8Clamped(payload.sourceData);
    const sourceWidth = payload.sourceWidth | 0;
    const sourceHeight = payload.sourceHeight | 0;
    const chunkWidth = payload.chunkWidth | 0;
    const chunkHeight = payload.chunkHeight | 0;
    const shreadSize = Math.max(1, payload.shreadSize | 0);
    const shreadCenter = payload.shreadCenter | 0;
    const pixelData = new Uint8ClampedArray(chunkWidth * chunkHeight * 4);
    for (let y = 0; y < chunkHeight; y++) {
      for (let x = 0; x < chunkWidth; x++) {
        const sourceX = Math.min(sourceWidth - 1, x * shreadSize + shreadCenter);
        const sourceY = Math.min(sourceHeight - 1, y * shreadSize + shreadCenter);
        const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
        const targetIndex = (y * chunkWidth + x) * 4;
        let r = sourceData[sourceIndex];
        let g = sourceData[sourceIndex + 1];
        let b = sourceData[sourceIndex + 2];
        let a = sourceData[sourceIndex + 3];
        if (a <= 32 && (r === 0 || r === 255) && g === r && b === r) a = 0;
        pixelData[targetIndex] = r;
        pixelData[targetIndex + 1] = g;
        pixelData[targetIndex + 2] = b;
        pixelData[targetIndex + 3] = a;
      }
    }
    return { pixelData };
  },

  extractChunkSamples(payload) {
    const shreadSize = Math.max(1, payload.shreadSize | 0);
    let imageWidth, imageHeight, pixelData;
    if (payload.bitmap instanceof ImageBitmap) {
      imageWidth = payload.bitmap.width;
      imageHeight = payload.bitmap.height;
      const canvas = new OffscreenCanvas(imageWidth, imageHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(payload.bitmap, 0, 0);
      pixelData = ctx.getImageData(0, 0, imageWidth, imageHeight).data;
      payload.bitmap.close?.();
    } else {
      imageWidth = payload.imageWidth | 0;
      imageHeight = payload.imageHeight | 0;
      pixelData = toUint8Clamped(payload.pixelData);
    }
    const logicalWidth = Math.max(1, Math.round(imageWidth / shreadSize));
    const logicalHeight = Math.max(1, Math.round(imageHeight / shreadSize));
    const center = (shreadSize - 1) >> 1;

    let count = 0;
    for (let y = 0, sampleY = center; y < logicalHeight; y++, sampleY += shreadSize) {
      for (let x = 0, sampleX = center; x < logicalWidth; x++, sampleX += shreadSize) {
        const idx = (sampleY * imageWidth + sampleX) * 4;
        if ((pixelData[idx + 3] || 0) > 0) count++;
      }
    }

    const xArr = new Uint16Array(count);
    const yArr = new Uint16Array(count);
    const rArr = new Uint8Array(count);
    const gArr = new Uint8Array(count);
    const bArr = new Uint8Array(count);
    const aArr = new Uint8Array(count);
    const flagsArr = new Uint8Array(count);
    let writeIndex = 0;
    for (let y = 0, sampleY = center; y < logicalHeight; y++, sampleY += shreadSize) {
      for (let x = 0, sampleX = center; x < logicalWidth; x++, sampleX += shreadSize) {
        const idx = (sampleY * imageWidth + sampleX) * 4;
        const alpha = pixelData[idx + 3] || 0;
        if (alpha <= 0) continue;
        xArr[writeIndex] = x;
        yArr[writeIndex] = y;
        const rawR = pixelData[idx], rawG = pixelData[idx + 1], rawB = pixelData[idx + 2];
        if (isDefaceRgb(rawR, rawG, rawB)) {
          rArr[writeIndex] = rawR; gArr[writeIndex] = rawG; bArr[writeIndex] = rawB;
          flagsArr[writeIndex] = TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE;
        } else {
          const snapped = snapRgbToNearestPalette(rawR, rawG, rawB);
          rArr[writeIndex] = snapped.r; gArr[writeIndex] = snapped.g; bArr[writeIndex] = snapped.b;
          flagsArr[writeIndex] = 0;
        }
        aArr[writeIndex] = alpha;
        writeIndex++;
      }
    }

    const sampleData = {
      width: logicalWidth,
      height: logicalHeight,
      count,
      x: xArr,
      y: yArr,
      r: rArr,
      g: gArr,
      b: bArr,
      a: aArr,
      flags: flagsArr,
    };
    return { sampleData };
  },

  /** Serializes a buffer payload, and optionally gzips it, entirely off the main thread.
   * Both passes are expensive over megabytes: JSON.stringify with the base64 replacer, and then
   * the base64 of the compressed bytes. Doing them here keeps template creation from blocking
   * the UI while it persists. `compress` is false for the pagehide flush, which has no time for
   * the extra async hops.
   */
  async serializeJson(payload) {
    const jsonReplacer = (_key, value) => (value instanceof Uint8Array ? uint8ToBase64(value) : value);
    const json = JSON.stringify(payload.data, jsonReplacer);
    if (payload.compress !== true) return { json, compressed: false };
    const compressed = await compressTemplateBufferPayload(json);
    return compressed ? { json: compressed, compressed: true } : { json, compressed: false };
  },

  findNearestUnpainted(payload) {
    const sampleData = decodeChunkSampleBuffer(payload.sampleData);
    if (!sampleData) return null;
    const liveTilePixels = toUint8Clamped(payload.liveTilePixels);
    const displayedColorsPacked = payload.displayedColorsPacked instanceof Uint32Array
      ? payload.displayedColorsPacked : new Uint32Array(0);
    const displayedColorSet = new Set(displayedColorsPacked);
    const mapWorldWidthPx = payload.mapWorldWidthPx | 0;
    const tileSize = payload.tileSize | 0;

    const computeWrappedDeltaX = (currentX, targetX) => {
      let delta = targetX - currentX;
      if (delta > mapWorldWidthPx / 2) delta -= mapWorldWidthPx;
      if (delta < -mapWorldWidthPx / 2) delta += mapWorldWidthPx;
      return delta;
    };
    const distanceSqFn = (originPoint, coords) => {
      if (!originPoint || !Array.isArray(coords)) return Infinity;
      const targetWorldX = (coords[0] | 0) * tileSize + (coords[2] | 0);
      const targetWorldY = (coords[1] | 0) * tileSize + (coords[3] | 0);
      const dx = computeWrappedDeltaX(originPoint.x, targetWorldX);
      const dy = targetWorldY - originPoint.y;
      return dx * dx + dy * dy;
    };

    return findNearestUnpaintedSamplePixel({
      sampleData,
      liveTilePixels,
      tileSize,
      offsetX: payload.offsetX | 0,
      offsetY: payload.offsetY | 0,
      tileX: payload.tileX | 0,
      tileY: payload.tileY | 0,
      originPoint: payload.originPoint,
      displayedColorSet,
      excludedCoordsKeySet: payload.excludedCoordsKeySet
        ? new Set(payload.excludedCoordsKeySet)
        : null,
      templateName: payload.templateName,
      colorMatchDelta: payload.colorMatchDelta,
      excludedCoords: payload.excludedCoords,
      distanceSqFn,
    });
  },
};

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    const handler = handlers[type];
    if (typeof handler !== 'function') {
      throw new Error(`Unknown template worker message type: ${type}`);
    }
    // Await so handlers that decode images in-worker can be async; sync handlers are unaffected.
    const result = await handler(payload || {});
    const transferList = [];
    if (result?.errorData instanceof Uint8ClampedArray) {
      transferList.push(result.errorData.buffer);
    }
    if (result?.pixels instanceof Uint8ClampedArray) {
      transferList.push(result.pixels.buffer);
    }
    if (result?.pixelData instanceof Uint8ClampedArray) {
      transferList.push(result.pixelData.buffer);
    }
    if (Array.isArray(result?.chunkResults)) {
      result.chunkResults.forEach((entry) => {
        transferList.push(...transferBuffers([entry.sampleBytes, entry.renderedPixels, entry.pngBytes]));
      });
    }
    if (Array.isArray(result?.results)) {
      result.results.forEach((entry) => {
        if (entry?.pixels instanceof Uint8ClampedArray) transferList.push(entry.pixels.buffer);
      });
    }
    if (result?.bitmap instanceof ImageBitmap) {
      transferList.push(result.bitmap);
    }
    if (Array.isArray(result?.errorMaps)) {
      result.errorMaps.forEach((entry) => {
        if (entry?.errorData instanceof Uint8ClampedArray) transferList.push(entry.errorData.buffer);
      });
    }
    self.postMessage({ id, ok: true, result }, transferList);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error?.message || String(error),
    });
  }
};
