import { uint8ToBase64, base64ToUint8, rgbToMeta } from './utils.js';

export const TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE = 1;
export const TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES = 8;
export const TEMPLATE_CHUNK_SAMPLE_RECORD_BYTES = 9;
export const TEMPLATE_DEFACE_RGB = [222, 250, 206];
export const TEMPLATE_OTHER_COLOR_KEY = 'other';
const IMAGE_DATA_LITTLE_ENDIAN = (() => {
  const buffer = new ArrayBuffer(4);
  new Uint32Array(buffer)[0] = 0x0a0b0c0d;
  return new Uint8Array(buffer)[0] === 0x0d;
})();

const packRgb = (r, g, b) => ((r << 16) | (g << 8) | b);
const packRgbaUint32 = (r, g, b, a) => (
  IMAGE_DATA_LITTLE_ENDIAN
    ? (((a << 24) | (b << 16) | (g << 8) | r) >>> 0)
    : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0)
);
const paletteKeyByPackedRgb = (() => {
  const map = new Map();
  for (const key of rgbToMeta.keys()) {
    if (key === TEMPLATE_OTHER_COLOR_KEY) continue;
    const parts = key.split(',').map(Number);
    if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) continue;
    map.set(packRgb(parts[0], parts[1], parts[2]), key);
  }
  return map;
})();

export const isDefaceRgb = (r, g, b) => (
  r === TEMPLATE_DEFACE_RGB[0]
  && g === TEMPLATE_DEFACE_RGB[1]
  && b === TEMPLATE_DEFACE_RGB[2]
);

export const getPaletteKeyForRgb = (r, g, b) => (
  paletteKeyByPackedRgb.get(packRgb(r, g, b)) || TEMPLATE_OTHER_COLOR_KEY
);

export const buildMaskRowSpans = (maskPoints, size) => {
  const safeSize = Math.max(0, Math.trunc(Number(size) || 0));
  const rows = Array.from({ length: safeSize }, () => []);
  if (!Array.isArray(maskPoints) || safeSize < 1) {
    return rows;
  }
  for (const point of maskPoints) {
    const offsetX = Math.trunc(Number(point?.[0]) || 0);
    const offsetY = Math.trunc(Number(point?.[1]) || 0);
    if (offsetX < 0 || offsetY < 0 || offsetX >= safeSize || offsetY >= safeSize) continue;
    rows[offsetY].push(offsetX);
  }
  return rows.map((entries) => {
    if (!entries.length) return [];
    entries.sort((left, right) => left - right);
    const spans = [];
    let start = entries[0];
    let previous = entries[0];
    for (let index = 1; index < entries.length; index++) {
      const value = entries[index];
      if (value <= previous + 1) {
        previous = value;
        continue;
      }
      spans.push(start, previous + 1);
      start = value;
      previous = value;
    }
    spans.push(start, previous + 1);
    return spans;
  });
};

export const renderSampleDataToImage = ({
  sampleData,
  imageData,
  resultWidth,
  drawSize,
  maskPoints = null,
  maskRowSpans,
  displayedColorSet = null,
  includeDefaceCheckerboard = false,
}) => {
  if (!sampleData || !imageData?.data || !Number.isFinite(resultWidth) || !Number.isFinite(drawSize)) {
    return imageData;
  }
  const safeResultWidth = Math.max(1, Math.trunc(Number(resultWidth) || 0));
  const safeDrawSize = Math.max(1, Math.trunc(Number(drawSize) || 0));
  const pixelData32 = new Uint32Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength >>> 2
  );
  const usePointMode = Array.isArray(maskPoints) && maskPoints.length > 0 && maskPoints.length <= 32;
  const pointOffsets = usePointMode
    ? maskPoints.map((point) => point[1] * safeResultWidth + point[0])
    : null;
  const checkerDark = packRgbaUint32(0, 0, 0, 32);
  const checkerLight = packRgbaUint32(255, 255, 255, 32);

  for (let index = 0; index < sampleData.count; index++) {
    const alpha = sampleData.a[index];
    if (alpha < 1) continue;
    const baseX = sampleData.x[index] * safeDrawSize;
    const baseY = sampleData.y[index] * safeDrawSize;
    const red = sampleData.r[index];
    const green = sampleData.g[index];
    const blue = sampleData.b[index];
    const isDefacePixel = (sampleData.flags[index] & TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE) === TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE;

    if (isDefacePixel) {
      if (!includeDefaceCheckerboard) continue;
      for (let offsetY = 0; offsetY < safeDrawSize; offsetY++) {
        const rowOffset = (baseY + offsetY) * safeResultWidth + baseX;
        const parity = offsetY & 1;
        for (let offsetX = 0; offsetX < safeDrawSize; offsetX++) {
          pixelData32[rowOffset + offsetX] = ((offsetX + parity) & 1) === 0 ? checkerDark : checkerLight;
        }
      }
      continue;
    }

    if (displayedColorSet) {
      const colorKey = getPaletteKeyForRgb(red, green, blue);
      if (!displayedColorSet.has(colorKey)) continue;
    }

    const packedColor = packRgbaUint32(red, green, blue, alpha);
    if (usePointMode) {
      const baseOffset = baseY * safeResultWidth + baseX;
      for (let pointIndex = 0; pointIndex < pointOffsets.length; pointIndex++) {
        pixelData32[baseOffset + pointOffsets[pointIndex]] = packedColor;
      }
      continue;
    }
    for (let row = 0; row < maskRowSpans.length; row++) {
      const spans = maskRowSpans[row];
      if (!spans || spans.length === 0) continue;
      const rowOffset = (baseY + row) * safeResultWidth + baseX;
      for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 2) {
        pixelData32.fill(
          packedColor,
          rowOffset + spans[spanIndex],
          rowOffset + spans[spanIndex + 1]
        );
      }
    }
  }
  return imageData;
};

export const createChunkSampleData = (width, height, count, native = true) => ({
  width: Math.max(0, Math.trunc(Number(width) || 0)),
  height: Math.max(0, Math.trunc(Number(height) || 0)),
  count: Math.max(0, Math.trunc(Number(count) || 0)),
  x: new Uint16Array(Math.max(0, Math.trunc(Number(count) || 0))),
  y: new Uint16Array(Math.max(0, Math.trunc(Number(count) || 0))),
  r: new Uint8Array(Math.max(0, Math.trunc(Number(count) || 0))),
  g: new Uint8Array(Math.max(0, Math.trunc(Number(count) || 0))),
  b: new Uint8Array(Math.max(0, Math.trunc(Number(count) || 0))),
  a: new Uint8Array(Math.max(0, Math.trunc(Number(count) || 0))),
  flags: new Uint8Array(Math.max(0, Math.trunc(Number(count) || 0))),
  native,
});

export const encodeChunkSampleData = (sampleData) => {
  const width = Math.max(0, Math.trunc(Number(sampleData?.width) || 0));
  const height = Math.max(0, Math.trunc(Number(sampleData?.height) || 0));
  const count = Math.max(0, Math.trunc(Number(sampleData?.count) || 0));
  const buffer = new ArrayBuffer(TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES + count * TEMPLATE_CHUNK_SAMPLE_RECORD_BYTES);
  const view = new DataView(buffer);
  view.setUint16(0, width, true);
  view.setUint16(2, height, true);
  view.setUint32(4, count, true);
  let offset = TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES;
  for (let index = 0; index < count; index++) {
    view.setUint16(offset, sampleData.x[index], true);
    view.setUint16(offset + 2, sampleData.y[index], true);
    view.setUint8(offset + 4, sampleData.flags[index] || 0);
    view.setUint8(offset + 5, sampleData.r[index] || 0);
    view.setUint8(offset + 6, sampleData.g[index] || 0);
    view.setUint8(offset + 7, sampleData.b[index] || 0);
    view.setUint8(offset + 8, sampleData.a[index] || 0);
    offset += TEMPLATE_CHUNK_SAMPLE_RECORD_BYTES;
  }
  return uint8ToBase64(new Uint8Array(buffer));
};

export const decodeChunkSampleBuffer = (bufferValue) => {
  if (bufferValue === undefined || bufferValue === null) return null;
  const bytes = typeof bufferValue === 'string' ? base64ToUint8(bufferValue) : bufferValue;
  if (!(bytes instanceof Uint8Array) || bytes.length < TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  const count = view.getUint32(4, true);
  const expectedLength = TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES + count * TEMPLATE_CHUNK_SAMPLE_RECORD_BYTES;
  if (bytes.length < expectedLength) {
    return null;
  }
  const sampleData = createChunkSampleData(width, height, count, true);
  let offset = TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES;
  for (let index = 0; index < count; index++) {
    sampleData.x[index] = view.getUint16(offset, true);
    sampleData.y[index] = view.getUint16(offset + 2, true);
    sampleData.flags[index] = view.getUint8(offset + 4);
    sampleData.r[index] = view.getUint8(offset + 5);
    sampleData.g[index] = view.getUint8(offset + 6);
    sampleData.b[index] = view.getUint8(offset + 7);
    sampleData.a[index] = view.getUint8(offset + 8);
    offset += TEMPLATE_CHUNK_SAMPLE_RECORD_BYTES;
  }
  return sampleData;
};

export const inspectSourceImagePalette = (sourceData, width, height) => {
  if (!sourceData || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { required: 0, deface: 0, paletteMap: new Map() };
  }
  let required = 0;
  let deface = 0;
  const paletteCounts = Object.create(null);
  const pixelBytes = Math.min(sourceData.length, Math.max(0, Math.trunc(width * height * 4)));
  for (let idx = 0; idx < pixelBytes; idx += 4) {
    const a = sourceData[idx + 3];
    if (a < 64) continue;
    const r = sourceData[idx];
    const g = sourceData[idx + 1];
    const b = sourceData[idx + 2];
    if (isDefaceRgb(r, g, b)) {
      deface++;
      continue;
    }
    const key = getPaletteKeyForRgb(r, g, b);
    required++;
    paletteCounts[key] = (paletteCounts[key] || 0) + 1;
  }
  const paletteMap = new Map(Object.entries(paletteCounts));
  return { required, deface, paletteMap };
};

export const createPaletteStatsAccumulator = () => ({
  required: 0,
  deface: 0,
  hasOther: false,
  paletteCounts: Object.create(null),
});

export const finalizePaletteStatsAccumulator = (accumulator) => {
  if (!accumulator || typeof accumulator !== 'object') {
    return { required: 0, deface: 0, hasOther: false, paletteMap: new Map() };
  }
  return {
    required: Math.max(0, Math.trunc(Number(accumulator.required) || 0)),
    deface: Math.max(0, Math.trunc(Number(accumulator.deface) || 0)),
    hasOther: accumulator.hasOther === true,
    paletteMap: new Map(Object.entries(accumulator.paletteCounts || {})),
  };
};

export const buildChunkSampleDataFromSource = (
  sourceData,
  imageWidth,
  sourceX,
  sourceY,
  chunkWidth,
  chunkHeight,
  paletteStatsAccumulator = null,
  sampleNormalizer = null,
) => {
  let count = 0;
  for (let y = 0; y < chunkHeight; y++) {
    for (let x = 0; x < chunkWidth; x++) {
      const idx = ((sourceY + y) * imageWidth + (sourceX + x)) * 4;
      if ((sourceData[idx + 3] || 0) > 0) {
        count++;
      }
    }
  }
  const sampleData = createChunkSampleData(chunkWidth, chunkHeight, count, true);
  let writeIndex = 0;
  for (let y = 0; y < chunkHeight; y++) {
    for (let x = 0; x < chunkWidth; x++) {
      const idx = ((sourceY + y) * imageWidth + (sourceX + x)) * 4;
      const alpha = sourceData[idx + 3] || 0;
      if (alpha <= 0) continue;
      let red = sourceData[idx];
      let green = sourceData[idx + 1];
      let blue = sourceData[idx + 2];
      let alphaOut = alpha;
      let forcedDeface = false;
      if (typeof sampleNormalizer === 'function' && alpha >= 64) {
        const normalized = sampleNormalizer(red, green, blue, alpha);
        if (normalized && Number.isFinite(normalized.r) && Number.isFinite(normalized.g) && Number.isFinite(normalized.b)) {
          red = Math.max(0, Math.min(255, Math.round(normalized.r)));
          green = Math.max(0, Math.min(255, Math.round(normalized.g)));
          blue = Math.max(0, Math.min(255, Math.round(normalized.b)));
          if (Number.isFinite(normalized.a)) {
            alphaOut = Math.max(0, Math.min(255, Math.round(normalized.a)));
          }
          forcedDeface = normalized.isDeface === true;
        }
      }
      sampleData.x[writeIndex] = x;
      sampleData.y[writeIndex] = y;
      sampleData.r[writeIndex] = red;
      sampleData.g[writeIndex] = green;
      sampleData.b[writeIndex] = blue;
      sampleData.a[writeIndex] = alphaOut;
      const isDefacePixel = forcedDeface || isDefaceRgb(red, green, blue);
      sampleData.flags[writeIndex] = isDefacePixel ? TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE : 0;
      if (paletteStatsAccumulator && alphaOut >= 64) {
        if (isDefacePixel) {
          paletteStatsAccumulator.deface++;
        } else {
          const paletteKey = getPaletteKeyForRgb(red, green, blue);
          paletteStatsAccumulator.required++;
          if (paletteKey === TEMPLATE_OTHER_COLOR_KEY) {
            paletteStatsAccumulator.hasOther = true;
          }
          paletteStatsAccumulator.paletteCounts[paletteKey] = (paletteStatsAccumulator.paletteCounts[paletteKey] || 0) + 1;
        }
      }
      writeIndex++;
    }
  }
  return sampleData;
};

export const addTemplateExampleToReservoir = (target, example, exampleMax, randomFn = Math.random) => {
  if (!target || !Array.isArray(target.examplesEnabled) || exampleMax <= 0) {
    return;
  }
  target._exampleSeenCount = Math.max(
    Number(target._exampleSeenCount) || 0,
    target.examplesEnabled.length
  );
  target._exampleSeenCount++;
  if (target.examplesEnabled.length < exampleMax) {
    target.examplesEnabled.push(example);
    return;
  }
  if (randomFn() * target._exampleSeenCount < exampleMax) {
    const replaceIndex = Math.floor(randomFn() * exampleMax);
    target.examplesEnabled[replaceIndex] = example;
  }
};

export const mergeTemplateExampleReservoir = (target, incoming, exampleMax, randomFn = Math.random) => {
  if (!target || !Array.isArray(incoming) || incoming.length === 0 || exampleMax <= 0) {
    return;
  }
  if (!Array.isArray(target.examplesEnabled)) {
    target.examplesEnabled = [];
  }
  for (const example of incoming) {
    addTemplateExampleToReservoir(target, example, exampleMax, randomFn);
  }
};

export const collectTemplateProgressFromSamples = ({
  sampleData,
  tilePixels,
  tileSize,
  offsetX,
  offsetY,
  tileCoords,
  templateEnabled,
  templateKey,
  paletteStats,
  templateStats,
  exampleMax,
  colorMatchDelta = 3,
  errorMapOnlyEnabledColors = false,
  displayedColors = null,
  errorData = null,
  errorWidth = 0,
  randomFn = Math.random,
}) => {
  if (!sampleData || !tilePixels || !Number.isFinite(tileSize)) {
    return { paintedCount: 0, wrongCount: 0, requiredCount: 0 };
  }

  let paintedCount = 0;
  let wrongCount = 0;
  let requiredCount = 0;
  const safeTileSize = Math.max(1, Math.trunc(Number(tileSize) || 0));
  const ensureTemplateProgress = () => {
    if (!templateKey) return null;
    if (templateStats[templateKey] === undefined) {
      templateStats[templateKey] = { painted: 0 };
    }
    return templateStats[templateKey];
  };

  for (let index = 0; index < sampleData.count; index++) {
    const localX = sampleData.x[index];
    const localY = sampleData.y[index];
    const pixelX = offsetX + localX;
    const pixelY = offsetY + localY;
    if (pixelX < 0 || pixelY < 0 || pixelX >= safeTileSize || pixelY >= safeTileSize) continue;

    const templateRed = sampleData.r[index];
    const templateGreen = sampleData.g[index];
    const templateBlue = sampleData.b[index];
    const templateAlpha = sampleData.a[index];
    const isDefacePixel = (sampleData.flags[index] & TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE) === TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE;
    if (templateAlpha < 64 || isDefacePixel) {
      continue;
    }

    requiredCount++;
    const templateProgress = ensureTemplateProgress();
    const colorKey = rgbToMeta.has(`${templateRed},${templateGreen},${templateBlue}`)
      ? `${templateRed},${templateGreen},${templateBlue}`
      : 'other';
    const tileIndex = (pixelY * safeTileSize + pixelX) * 4;
    const liveRed = tilePixels[tileIndex];
    const liveGreen = tilePixels[tileIndex + 1];
    const liveBlue = tilePixels[tileIndex + 2];
    const liveAlpha = tilePixels[tileIndex + 3];
    const shouldColorAppearInErrorMap = !errorMapOnlyEnabledColors || displayedColors?.has(colorKey);
    const errorIndex = errorData ? (localY * errorWidth + localX) * 4 : -1;

    let isPainted = false;
    if (liveAlpha < 64) {
      if (errorData && templateEnabled && shouldColorAppearInErrorMap) {
        errorData[errorIndex] = 128;
        errorData[errorIndex + 1] = 128;
        errorData[errorIndex + 2] = 128;
        errorData[errorIndex + 3] = 200;
      }
    } else if (
      (liveRed === templateRed && liveGreen === templateGreen && liveBlue === templateBlue)
      || (
        colorKey !== 'other'
        && Math.abs(liveRed - templateRed) <= colorMatchDelta
        && Math.abs(liveGreen - templateGreen) <= colorMatchDelta
        && Math.abs(liveBlue - templateBlue) <= colorMatchDelta
      )
    ) {
      paintedCount++;
      isPainted = true;
      if (paletteStats[colorKey] === undefined) {
        paletteStats[colorKey] = {
          painted: 1,
          paintedAndEnabled: +templateEnabled,
          missing: 0,
          examplesEnabled: [],
        };
      } else {
        paletteStats[colorKey].painted++;
        if (templateEnabled) {
          paletteStats[colorKey].paintedAndEnabled++;
        }
      }
      if (templateProgress) {
        templateProgress.painted++;
      }
      if (errorData && templateEnabled && shouldColorAppearInErrorMap) {
        errorData[errorIndex] = 0;
        errorData[errorIndex + 1] = 128;
        errorData[errorIndex + 2] = 0;
        errorData[errorIndex + 3] = 160;
      }
    } else {
      wrongCount++;
      if (errorData && templateEnabled && shouldColorAppearInErrorMap) {
        errorData[errorIndex] = 255;
        errorData[errorIndex + 1] = 0;
        errorData[errorIndex + 2] = 0;
        errorData[errorIndex + 3] = 224;
      }
    }

    if (!isPainted) {
      const example = [
        tileCoords,
        [pixelX, pixelY],
      ];
      if (paletteStats[colorKey] === undefined) {
        paletteStats[colorKey] = {
          painted: 0,
          paintedAndEnabled: 0,
          missing: 1,
          examplesEnabled: [],
        };
        if (templateEnabled) {
          addTemplateExampleToReservoir(paletteStats[colorKey], example, exampleMax, randomFn);
        }
      } else {
        paletteStats[colorKey].missing++;
        if (templateEnabled) {
          addTemplateExampleToReservoir(paletteStats[colorKey], example, exampleMax, randomFn);
        }
      }
    }
  }

  return { paintedCount, wrongCount, requiredCount };
};

export const findNearestUnpaintedSamplePixel = ({
  sampleData,
  liveTilePixels,
  tileSize,
  offsetX,
  offsetY,
  tileX,
  tileY,
  originPoint,
  displayedColorSet,
  excludedCoordsKey,
  templateName,
  distanceSqFn,
  colorMatchDelta = 3,
}) => {
  if (!sampleData || !liveTilePixels || !Number.isFinite(tileSize) || typeof distanceSqFn !== 'function') {
    return null;
  }

  let bestCandidate = null;
  const safeTileSize = Math.max(1, Math.trunc(Number(tileSize) || 0));
  for (let index = 0; index < sampleData.count; index++) {
    if (sampleData.a[index] < 64 || (sampleData.flags[index] & TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE) === TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE) {
      continue;
    }

    const pixelX = offsetX + sampleData.x[index];
    const pixelY = offsetY + sampleData.y[index];
    if (pixelX < 0 || pixelX >= safeTileSize || pixelY < 0 || pixelY >= safeTileSize) continue;

    const templateRed = sampleData.r[index];
    const templateGreen = sampleData.g[index];
    const templateBlue = sampleData.b[index];
    const colorKey = `${templateRed},${templateGreen},${templateBlue}`;
    const colorMeta = rgbToMeta.get(colorKey);
    if (!colorMeta || colorMeta.id === 0 || !displayedColorSet.has(colorKey)) continue;

    const tileIndex = (pixelY * safeTileSize + pixelX) * 4;
    const liveAlpha = liveTilePixels[tileIndex + 3];
    const liveRed = liveTilePixels[tileIndex];
    const liveGreen = liveTilePixels[tileIndex + 1];
    const liveBlue = liveTilePixels[tileIndex + 2];
    const isPainted = liveAlpha >= 64 && (
      (liveRed === templateRed && liveGreen === templateGreen && liveBlue === templateBlue)
      || (
        Math.abs(liveRed - templateRed) <= colorMatchDelta
        && Math.abs(liveGreen - templateGreen) <= colorMatchDelta
        && Math.abs(liveBlue - templateBlue) <= colorMatchDelta
      )
    );
    if (isPainted) continue;

    const coords = [tileX, tileY, pixelX, pixelY];
    const coordsKey = coords.join(',');
    if (coordsKey === excludedCoordsKey) continue;
    const distanceSq = distanceSqFn(originPoint, coords);
    if (!Number.isFinite(distanceSq)) continue;
    if (!bestCandidate || distanceSq < bestCandidate.distanceSq) {
      bestCandidate = {
        coords,
        coordsKey,
        distanceSq,
        templateName,
      };
    }
  }
  return bestCandidate;
};
