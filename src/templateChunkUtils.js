import { uint8ToBase64, base64ToUint8, rgbToMeta } from './utils.js';
import { findNearestUnpaintedPixelWithWasm, isTemplateNearestWasmAvailable } from './templateNearestWasm.js';
import { collectProgressWithWasm, isCollectProgressWasmAvailable } from './templateProgressWasm.js';

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
const PACKED_DEFACE_RGB = packRgb(TEMPLATE_DEFACE_RGB[0], TEMPLATE_DEFACE_RGB[1], TEMPLATE_DEFACE_RGB[2]);
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
const paletteKeyByIndex = [];
const paletteIndexByPackedRgb = (() => {
  const map = new Map();
  const indexByKey = new Map();
  for (const [packed, key] of paletteKeyByPackedRgb.entries()) {
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = paletteKeyByIndex.length;
      indexByKey.set(key, index);
      paletteKeyByIndex.push(key);
    }
    map.set(packed, index);
  }
  return map;
})();
const PALETTE_INDEX_OTHER = (() => {
  let index = paletteKeyByIndex.indexOf(TEMPLATE_OTHER_COLOR_KEY);
  if (index === -1) {
    index = paletteKeyByIndex.length;
    paletteKeyByIndex.push(TEMPLATE_OTHER_COLOR_KEY);
  }
  return index;
})();
// Some browsers can slightly shift decoded tile RGB values (color management / canvas path differences).
// Keep a tolerant per-channel delta so painted pixels are still recognized reliably.
const LIVE_COLOR_MATCH_DELTA = 8;
const NEAREST_PAINTABLE_CACHE_MAX = 16384;
const getPaletteIndexForPackedRgb = (packedColor) => (
  paletteIndexByPackedRgb.get(packedColor) ?? PALETTE_INDEX_OTHER
);
const parseRgbKey = (key) => {
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
const paintablePackedRgbSet = (() => {
  const set = new Set();
  for (const [key, meta] of rgbToMeta.entries()) {
    if (typeof meta?.id !== 'number' || meta.id <= 0) continue;
    const packed = parseRgbKey(key);
    if (packed !== null) {
      set.add(packed);
    }
  }
  return set;
})();
const paintablePaletteColors = [...paintablePackedRgbSet].map((packed) => ({
  packed,
  r: (packed >> 16) & 255,
  g: (packed >> 8) & 255,
  b: packed & 255,
}));
// Flat typed arrays for WASM palette lookup (built once, re-used each call)
const wasmPalettePackedColors = Uint32Array.from(paintablePaletteColors, (c) => c.packed);
const wasmPaletteRgb = (() => {
  const n = paintablePaletteColors.length;
  const r = new Uint8Array(n);
  const g = new Uint8Array(n);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = paintablePaletteColors[i].r;
    g[i] = paintablePaletteColors[i].g;
    b[i] = paintablePaletteColors[i].b;
  }
  return { r, g, b };
})();
const nearestPaintablePackedCache = new Map();
const cacheNearestPaintablePacked = (packed, nearestPacked) => {
  if (nearestPaintablePackedCache.size >= NEAREST_PAINTABLE_CACHE_MAX) {
    const oldestKey = nearestPaintablePackedCache.keys().next().value;
    if (oldestKey !== undefined) {
      nearestPaintablePackedCache.delete(oldestKey);
    }
  }
  nearestPaintablePackedCache.set(packed, nearestPacked);
  return nearestPacked;
};
const getNearestPaintablePacked = (r, g, b) => {
  const packed = packRgb(r, g, b);
  const cached = nearestPaintablePackedCache.get(packed);
  if (cached !== undefined) {
    return cached;
  }
  let bestPacked = packed;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < paintablePaletteColors.length; index++) {
    const color = paintablePaletteColors[index];
    const dr = color.r - r;
    const dg = color.g - g;
    const db = color.b - b;
    const distanceSq = dr * dr + dg * dg + db * db;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestPacked = color.packed;
      if (distanceSq === 0) {
        break;
      }
    }
  }
  return cacheNearestPaintablePacked(packed, bestPacked);
};
export const snapRgbToNearestPalette = (r, g, b) => {
  const packed = getNearestPaintablePacked(r, g, b);
  return { r: (packed >> 16) & 255, g: (packed >> 8) & 255, b: packed & 255 };
};
const displayedColorPackedSetCache = new WeakMap();
const displayedColorPackedArrayCache = new WeakMap();
const getDisplayedColorPackedSet = (displayedColorSet) => {
  if (!(displayedColorSet instanceof Set)) return null;
  const cached = displayedColorPackedSetCache.get(displayedColorSet);
  if (cached) return cached;
  const packedSet = new Set();
  for (const key of displayedColorSet) {
    const packed = parseRgbKey(key);
    if (packed !== null) {
      packedSet.add(packed);
    }
  }
  displayedColorPackedSetCache.set(displayedColorSet, packedSet);
  return packedSet;
};
const getDisplayedColorPackedArray = (displayedColorSet) => {
  if (!(displayedColorSet instanceof Set)) return null;
  const cached = displayedColorPackedArrayCache.get(displayedColorSet);
  if (cached) return cached;
  const packedSet = getDisplayedColorPackedSet(displayedColorSet);
  if (!packedSet || packedSet.size === 0) {
    return null;
  }
  const packedArray = Uint32Array.from(packedSet);
  displayedColorPackedArrayCache.set(displayedColorSet, packedArray);
  return packedArray;
};
const parseCoordsKey = (coordsKey) => {
  if (typeof coordsKey !== 'string') return null;
  const parts = coordsKey.split(',');
  if (parts.length < 4) return null;
  const tx = Number(parts[0]);
  const ty = Number(parts[1]);
  const px = Number(parts[2]);
  const py = Number(parts[3]);
  if (![tx, ty, px, py].every(Number.isFinite)) return null;
  return [tx, ty, px, py];
};

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
  enforceTransparentAsDeface = false,
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

  // Post-pass: fill transparent grid positions with checkerboard when mode is active.
  // Any output pixel block that is still fully transparent after the sample render pass
  // corresponds to a transparent template pixel.
  if (enforceTransparentAsDeface && (includeDefaceCheckerboard || !displayedColorSet)) {
    const logicalWidth = sampleData.width | 0;
    const logicalHeight = sampleData.height | 0;
    for (let ly = 0; ly < logicalHeight; ly++) {
      const baseY = ly * safeDrawSize;
      for (let lx = 0; lx < logicalWidth; lx++) {
        const baseX = lx * safeDrawSize;
        const centerOffset = (baseY + (safeDrawSize >> 1)) * safeResultWidth + baseX + (safeDrawSize >> 1);
        if ((pixelData32[centerOffset] >>> 24) !== 0) continue;
        for (let offsetY = 0; offsetY < safeDrawSize; offsetY++) {
          const rowOffset = (baseY + offsetY) * safeResultWidth + baseX;
          const parity = offsetY & 1;
          for (let offsetX = 0; offsetX < safeDrawSize; offsetX++) {
            pixelData32[rowOffset + offsetX] = ((offsetX + parity) & 1) === 0 ? checkerDark : checkerLight;
          }
        }
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

// Columnar format v1: header bytes[1] has 0x80 set as version flag.
// Layout after 8-byte header: x[count*2] | y[count*2] | flags[count] | r[count] | g[count] | b[count] | a[count]
// x/y use native-endian Uint16; total size identical to interleaved (8 + 9*count bytes).
export const encodeChunkSampleBytes = (sampleData) => {
  const width = Math.max(0, Math.trunc(Number(sampleData?.width) || 0));
  const height = Math.max(0, Math.trunc(Number(sampleData?.height) || 0));
  const count = Math.max(0, Math.trunc(Number(sampleData?.count) || 0));
  const bytes = new Uint8Array(TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES + count * TEMPLATE_CHUNK_SAMPLE_RECORD_BYTES);
  bytes[0] = width & 255;
  bytes[1] = 0x80 | ((width >> 8) & 0x0F); // 0x80 = columnar format marker
  bytes[2] = height & 255;
  bytes[3] = (height >> 8) & 255;
  bytes[4] = count & 255;
  bytes[5] = (count >> 8) & 255;
  bytes[6] = (count >> 16) & 255;
  bytes[7] = (count >> 24) & 255;
  if (count > 0) {
    const xOffset = TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES;
    const yOffset = xOffset + count * 2;
    const flagsOffset = yOffset + count * 2;
    const rOffset = flagsOffset + count;
    const gOffset = rOffset + count;
    const bOffset = gOffset + count;
    const aOffset = bOffset + count;
    new Uint16Array(bytes.buffer, xOffset, count).set(sampleData.x.subarray(0, count));
    new Uint16Array(bytes.buffer, yOffset, count).set(sampleData.y.subarray(0, count));
    bytes.set(sampleData.flags.subarray(0, count), flagsOffset);
    bytes.set(sampleData.r.subarray(0, count), rOffset);
    bytes.set(sampleData.g.subarray(0, count), gOffset);
    bytes.set(sampleData.b.subarray(0, count), bOffset);
    bytes.set(sampleData.a.subarray(0, count), aOffset);
  }
  return bytes;
};

export const encodeChunkSampleData = (sampleData) => {
  return uint8ToBase64(encodeChunkSampleBytes(sampleData));
};

// Read only width/height from the 8-byte header without allocating TypedArrays.
export const readChunkSampleHeader = (bufferValue) => {
  const bytes = bufferValue instanceof Uint8Array ? bufferValue : null;
  if (!bytes || bytes.length < TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES) return null;
  const isColumnar = (bytes[1] & 0x80) !== 0;
  const width = isColumnar ? (bytes[0] | ((bytes[1] & 0x0F) << 8)) : (bytes[0] | (bytes[1] << 8));
  const height = bytes[2] | (bytes[3] << 8);
  return { width, height };
};

export const decodeChunkSampleBuffer = (bufferValue) => {
  if (bufferValue === undefined || bufferValue === null) return null;
  const bytes = typeof bufferValue === 'string' ? base64ToUint8(bufferValue) : bufferValue;
  if (!(bytes instanceof Uint8Array) || bytes.length < TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES) {
    return null;
  }
  const isColumnar = (bytes[1] & 0x80) !== 0;
  const width = isColumnar ? (bytes[0] | ((bytes[1] & 0x0F) << 8)) : (bytes[0] | (bytes[1] << 8));
  const height = bytes[2] | (bytes[3] << 8);
  const count = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
  const expectedLength = TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES + count * TEMPLATE_CHUNK_SAMPLE_RECORD_BYTES;
  if (bytes.length < expectedLength) {
    return null;
  }
  const sampleData = createChunkSampleData(width, height, count, true);
  if (count > 0) {
    if (isColumnar) {
      const xOffset = TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES;
      const yOffset = xOffset + count * 2;
      const flagsOffset = yOffset + count * 2;
      const rOffset = flagsOffset + count;
      const gOffset = rOffset + count;
      const bOffset = gOffset + count;
      const aOffset = bOffset + count;
      sampleData.x.set(new Uint16Array(bytes.buffer, bytes.byteOffset + xOffset, count));
      sampleData.y.set(new Uint16Array(bytes.buffer, bytes.byteOffset + yOffset, count));
      sampleData.flags.set(bytes.subarray(flagsOffset, flagsOffset + count));
      sampleData.r.set(bytes.subarray(rOffset, rOffset + count));
      sampleData.g.set(bytes.subarray(gOffset, gOffset + count));
      sampleData.b.set(bytes.subarray(bOffset, bOffset + count));
      sampleData.a.set(bytes.subarray(aOffset, aOffset + count));
    } else {
      let offset = TEMPLATE_CHUNK_SAMPLE_HEADER_BYTES;
      for (let index = 0; index < count; index++) {
        sampleData.x[index] = bytes[offset] | (bytes[offset + 1] << 8);
        sampleData.y[index] = bytes[offset + 2] | (bytes[offset + 3] << 8);
        sampleData.flags[index] = bytes[offset + 4];
        sampleData.r[index] = bytes[offset + 5];
        sampleData.g[index] = bytes[offset + 6];
        sampleData.b[index] = bytes[offset + 7];
        sampleData.a[index] = bytes[offset + 8];
        offset += TEMPLATE_CHUNK_SAMPLE_RECORD_BYTES;
      }
    }
    // Snap non-deface pixels to nearest palette color. This fixes templates stored
    // before snapping was applied at extraction time (e.g. remote templates, old local
    // templates, Brave-noise-affected data).
    for (let i = 0; i < count; i++) {
      if (sampleData.a[i] < 64) continue;
      const r = sampleData.r[i], g = sampleData.g[i], b = sampleData.b[i];
      const alreadyDeface = (sampleData.flags[i] & TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE) !== 0;
      if (alreadyDeface || isDefaceRgb(r, g, b)) {
        sampleData.flags[i] |= TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE;
        continue;
      }
      const snapped = snapRgbToNearestPalette(r, g, b);
      sampleData.r[i] = snapped.r;
      sampleData.g[i] = snapped.g;
      sampleData.b[i] = snapped.b;
    }
  }
  return sampleData;
};

export const serializeChunkSampleData = (sampleData) => {
  if (!sampleData || !Number.isFinite(sampleData.count)) {
    return null;
  }
  const count = Math.max(0, Math.trunc(Number(sampleData.count) || 0));
  return {
    width: Math.max(0, Math.trunc(Number(sampleData.width) || 0)),
    height: Math.max(0, Math.trunc(Number(sampleData.height) || 0)),
    count,
    native: sampleData.native !== false,
    x: sampleData.x instanceof Uint16Array ? sampleData.x.slice(0, count) : new Uint16Array(0),
    y: sampleData.y instanceof Uint16Array ? sampleData.y.slice(0, count) : new Uint16Array(0),
    r: sampleData.r instanceof Uint8Array ? sampleData.r.slice(0, count) : new Uint8Array(0),
    g: sampleData.g instanceof Uint8Array ? sampleData.g.slice(0, count) : new Uint8Array(0),
    b: sampleData.b instanceof Uint8Array ? sampleData.b.slice(0, count) : new Uint8Array(0),
    a: sampleData.a instanceof Uint8Array ? sampleData.a.slice(0, count) : new Uint8Array(0),
    flags: sampleData.flags instanceof Uint8Array ? sampleData.flags.slice(0, count) : new Uint8Array(0),
  };
};

export const deserializeChunkSampleData = (value) => {
  if (!value || !Number.isFinite(value.count)) {
    return null;
  }
  const count = Math.max(0, Math.trunc(Number(value.count) || 0));
  return {
    width: Math.max(0, Math.trunc(Number(value.width) || 0)),
    height: Math.max(0, Math.trunc(Number(value.height) || 0)),
    count,
    native: value.native !== false,
    x: value.x instanceof Uint16Array ? value.x : new Uint16Array(value.x || 0),
    y: value.y instanceof Uint16Array ? value.y : new Uint16Array(value.y || 0),
    r: value.r instanceof Uint8Array ? value.r : new Uint8Array(value.r || 0),
    g: value.g instanceof Uint8Array ? value.g : new Uint8Array(value.g || 0),
    b: value.b instanceof Uint8Array ? value.b : new Uint8Array(value.b || 0),
    a: value.a instanceof Uint8Array ? value.a : new Uint8Array(value.a || 0),
    flags: value.flags instanceof Uint8Array ? value.flags : new Uint8Array(value.flags || 0),
  };
};

export const getChunkSampleTransferList = (value) => {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const transferList = [];
  [value.x, value.y, value.r, value.g, value.b, value.a, value.flags].forEach((entry) => {
    if (entry?.buffer instanceof ArrayBuffer) {
      transferList.push(entry.buffer);
    }
  });
  return transferList;
};

export const cloneMaskRowSpans = (maskRowSpans) => (
  Array.isArray(maskRowSpans)
    ? maskRowSpans.map((spans) => Uint16Array.from(Array.isArray(spans) ? spans : []))
    : []
);

export const getMaskRowSpansTransferList = (maskRowSpans) => (
  Array.isArray(maskRowSpans)
    ? maskRowSpans
      .filter((spans) => spans?.buffer instanceof ArrayBuffer)
      .map((spans) => spans.buffer)
    : []
);

export const mergeSerializedPaletteProgress = (target, incoming, exampleMax) => {
  if (!incoming || typeof incoming !== 'object') {
    return target;
  }
  for (const [key, entry] of Object.entries(incoming)) {
    if (!entry || typeof entry !== 'object') continue;
    let targetEntry = target[key];
    if (!targetEntry) {
      targetEntry = {
        painted: 0,
        paintedAndEnabled: 0,
        missing: 0,
        examplesEnabled: [],
      };
      target[key] = targetEntry;
    }
    targetEntry.painted += Math.max(0, Number(entry.painted) || 0);
    targetEntry.paintedAndEnabled += Math.max(0, Number(entry.paintedAndEnabled) || 0);
    targetEntry.missing += Math.max(0, Number(entry.missing) || 0);
    mergeTemplateExampleReservoir(
      targetEntry,
      Array.isArray(entry.examplesEnabled) ? entry.examplesEnabled : [],
      exampleMax
    );
    if (Array.isArray(entry.examplesUnpainted) && entry.examplesUnpainted.length > 0) {
      for (const ex of entry.examplesUnpainted) {
        addUnpaintedPixelExampleToReservoir(targetEntry, ex[0], ex[1][0], ex[1][1], exampleMax, Math.random);
      }
    }
  }
  return target;
};

export const mergeSerializedTemplateProgress = (target, incoming) => {
  if (!incoming || typeof incoming !== 'object') {
    return target;
  }
  for (const [templateKey, entry] of Object.entries(incoming)) {
    if (!entry || typeof entry !== 'object') continue;
    const targetEntry = target[templateKey] ?? (target[templateKey] = { painted: 0, palette: {} });
    targetEntry.painted += Math.max(0, Number(entry.painted) || 0);
    const palette = (entry.palette && typeof entry.palette === 'object') ? entry.palette : {};
    for (const [colorKey, count] of Object.entries(palette)) {
      targetEntry.palette[colorKey] = (Number(targetEntry.palette[colorKey]) || 0) + (Number(count) || 0);
    }
  }
  return target;
};

export const inspectSourceImagePalette = (sourceData, width, height) => {
  if (!sourceData || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { required: 0, deface: 0, paletteMap: new Map() };
  }
  let required = 0;
  let deface = 0;
  const paletteCountsByIndex = new Uint32Array(paletteKeyByIndex.length);
  const seenPaletteOrder = [];
  const pixelBytes = Math.min(sourceData.length, Math.max(0, Math.trunc(width * height * 4)));
  for (let idx = 0; idx < pixelBytes; idx += 4) {
    const a = sourceData[idx + 3];
    if (a < 64) continue;
    const r = sourceData[idx];
    const g = sourceData[idx + 1];
    const b = sourceData[idx + 2];
    const packedColor = packRgb(r, g, b);
    if (packedColor === PACKED_DEFACE_RGB) {
      deface++;
      continue;
    }
    const paletteIndex = getPaletteIndexForPackedRgb(packedColor);
    required++;
    if (paletteCountsByIndex[paletteIndex] === 0) {
      seenPaletteOrder.push(paletteIndex);
    }
    paletteCountsByIndex[paletteIndex]++;
  }
  const paletteMap = new Map();
  for (let index = 0; index < seenPaletteOrder.length; index++) {
    const paletteIndex = seenPaletteOrder[index];
    paletteMap.set(paletteKeyByIndex[paletteIndex], paletteCountsByIndex[paletteIndex]);
  }
  return { required, deface, paletteMap };
};

export const createPaletteStatsAccumulator = () => ({
  required: 0,
  deface: 0,
  hasOther: false,
  paletteCounts: Object.create(null),
  paletteCountsByIndex: new Uint32Array(paletteKeyByIndex.length),
  seenPaletteOrder: [],
});

export const mergePaletteStatsAccumulator = (accumulator, stats = {}) => {
  if (!accumulator || typeof accumulator !== 'object') {
    return accumulator;
  }
  accumulator.required = Math.max(0, Number(accumulator.required) || 0) + Math.max(0, Number(stats.required) || 0);
  accumulator.deface = Math.max(0, Number(accumulator.deface) || 0) + Math.max(0, Number(stats.deface) || 0);
  if (stats.hasOther === true) {
    accumulator.hasOther = true;
  }
  const paletteCounts = (stats.paletteCounts && typeof stats.paletteCounts === 'object') ? stats.paletteCounts : null;
  if (paletteCounts && Object.keys(paletteCounts).length) {
    accumulator.paletteCounts = accumulator.paletteCounts || Object.create(null);
    for (const [key, count] of Object.entries(paletteCounts)) {
      const safeCount = Math.max(0, Number(count) || 0);
      if (safeCount <= 0) continue;
      accumulator.paletteCounts[key] = (accumulator.paletteCounts[key] || 0) + safeCount;
    }
    accumulator.paletteCountsByIndex = null;
    accumulator.seenPaletteOrder = null;
  }
  return accumulator;
};

export const finalizePaletteStatsAccumulator = (accumulator) => {
  if (!accumulator || typeof accumulator !== 'object') {
    return { required: 0, deface: 0, hasOther: false, paletteMap: new Map() };
  }
  const paletteMap = new Map();
  const objectCounts = accumulator.paletteCounts || {};
  const hasObjectCounts = Object.keys(objectCounts).length > 0;
  if (
    accumulator.paletteCountsByIndex instanceof Uint32Array
    && Array.isArray(accumulator.seenPaletteOrder)
    && (!hasObjectCounts || accumulator.seenPaletteOrder.length > 0)
  ) {
    for (let index = 0; index < accumulator.seenPaletteOrder.length; index++) {
      const paletteIndex = accumulator.seenPaletteOrder[index];
      const count = accumulator.paletteCountsByIndex[paletteIndex] || 0;
      if (count <= 0) continue;
      paletteMap.set(paletteKeyByIndex[paletteIndex] || TEMPLATE_OTHER_COLOR_KEY, count);
    }
  } else {
    for (const [key, count] of Object.entries(objectCounts)) {
      if ((Number(count) || 0) > 0) {
        paletteMap.set(key, Number(count) || 0);
      }
    }
  }
  return {
    required: Math.max(0, Math.trunc(Number(accumulator.required) || 0)),
    deface: Math.max(0, Math.trunc(Number(accumulator.deface) || 0)),
    hasOther: accumulator.hasOther === true,
    paletteMap,
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
  const paletteCountsByIndex = (paletteStatsAccumulator?.paletteCountsByIndex instanceof Uint32Array)
    ? paletteStatsAccumulator.paletteCountsByIndex
    : null;
  const seenPaletteOrder = Array.isArray(paletteStatsAccumulator?.seenPaletteOrder)
    ? paletteStatsAccumulator.seenPaletteOrder
    : null;
  const paletteCountsObject = (paletteStatsAccumulator && typeof paletteStatsAccumulator === 'object')
    ? (paletteStatsAccumulator.paletteCounts || (paletteStatsAccumulator.paletteCounts = Object.create(null)))
    : null;
  const maxCount = Math.max(0, Math.trunc(chunkWidth * chunkHeight));
  const sampleData = createChunkSampleData(chunkWidth, chunkHeight, maxCount, true);
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
      const packedRaw = packRgb(red, green, blue);
      const isDefacePixel = forcedDeface || packedRaw === PACKED_DEFACE_RGB;
      if (!isDefacePixel && alphaOut >= 64 && typeof sampleNormalizer !== 'function') {
        const snapped = snapRgbToNearestPalette(red, green, blue);
        red = snapped.r; green = snapped.g; blue = snapped.b;
      }
      sampleData.x[writeIndex] = x;
      sampleData.y[writeIndex] = y;
      sampleData.r[writeIndex] = red;
      sampleData.g[writeIndex] = green;
      sampleData.b[writeIndex] = blue;
      sampleData.a[writeIndex] = alphaOut;
      const packedColor = packRgb(red, green, blue);
      sampleData.flags[writeIndex] = isDefacePixel ? TEMPLATE_CHUNK_SAMPLE_FLAG_DEFACE : 0;
      if (paletteStatsAccumulator && alphaOut >= 64) {
        if (isDefacePixel) {
          paletteStatsAccumulator.deface++;
        } else {
          const paletteIndex = getPaletteIndexForPackedRgb(packedColor);
          paletteStatsAccumulator.required++;
          if (paletteIndex === PALETTE_INDEX_OTHER) {
            paletteStatsAccumulator.hasOther = true;
          }
          if (paletteCountsByIndex && seenPaletteOrder && paletteIndex < paletteCountsByIndex.length) {
            if (paletteCountsByIndex[paletteIndex] === 0) {
              seenPaletteOrder.push(paletteIndex);
            }
            paletteCountsByIndex[paletteIndex]++;
          } else if (paletteCountsObject) {
            const paletteKey = paletteKeyByIndex[paletteIndex] || TEMPLATE_OTHER_COLOR_KEY;
            paletteCountsObject[paletteKey] = (paletteCountsObject[paletteKey] || 0) + 1;
          }
        }
      }
      writeIndex++;
    }
  }
  if (writeIndex !== maxCount) {
    sampleData.x = sampleData.x.subarray(0, writeIndex);
    sampleData.y = sampleData.y.subarray(0, writeIndex);
    sampleData.r = sampleData.r.subarray(0, writeIndex);
    sampleData.g = sampleData.g.subarray(0, writeIndex);
    sampleData.b = sampleData.b.subarray(0, writeIndex);
    sampleData.a = sampleData.a.subarray(0, writeIndex);
    sampleData.flags = sampleData.flags.subarray(0, writeIndex);
  }
  sampleData.count = writeIndex;
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

// Variant of addTemplateExampleToReservoir for the pixel-scan hot path.
// Accepts primitive coords and only allocates the example arrays when the reservoir actually accepts the sample.
const addPixelExampleToReservoir = (target, tileCoords, pixelX, pixelY, exampleMax, randomFn) => {
  if (!target || !Array.isArray(target.examplesEnabled) || exampleMax <= 0) {
    return;
  }
  target._exampleSeenCount = Math.max(
    Number(target._exampleSeenCount) || 0,
    target.examplesEnabled.length
  );
  target._exampleSeenCount++;
  if (target.examplesEnabled.length < exampleMax) {
    target.examplesEnabled.push([tileCoords, [pixelX, pixelY]]);
    return;
  }
  if (randomFn() * target._exampleSeenCount < exampleMax) {
    target.examplesEnabled[Math.floor(randomFn() * exampleMax)] = [tileCoords, [pixelX, pixelY]];
  }
};

const addUnpaintedPixelExampleToReservoir = (target, tileCoords, pixelX, pixelY, exampleMax, randomFn) => {
  if (!target || exampleMax <= 0) return;
  if (!Array.isArray(target.examplesUnpainted)) target.examplesUnpainted = [];
  target._exampleUnpaintedSeenCount = Math.max(
    Number(target._exampleUnpaintedSeenCount) || 0,
    target.examplesUnpainted.length
  );
  target._exampleUnpaintedSeenCount++;
  if (target.examplesUnpainted.length < exampleMax) {
    target.examplesUnpainted.push([tileCoords, [pixelX, pixelY]]);
    return;
  }
  if (randomFn() * target._exampleUnpaintedSeenCount < exampleMax) {
    target.examplesUnpainted[Math.floor(randomFn() * exampleMax)] = [tileCoords, [pixelX, pixelY]];
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
  colorMatchDelta = LIVE_COLOR_MATCH_DELTA,
  errorMapOnlyEnabledColors = false,
  displayedColors = null,
  errorData = null,
  errorWidth = 0,
  randomFn = Math.random,
  useWasm = true,
}) => {
  if (!sampleData || !tilePixels || !Number.isFinite(tileSize)) {
    return { paintedCount: 0, wrongCount: 0, requiredCount: 0 };
  }

  // --- WASM fast path ---
  if (useWasm && isCollectProgressWasmAvailable() && tilePixels instanceof Uint8ClampedArray) {
    const displayedColorPackedArr = errorMapOnlyEnabledColors
      ? getDisplayedColorPackedArray(displayedColors)
      : null;
    const displayOtherInErrorMap = errorMapOnlyEnabledColors
      ? (displayedColors?.has(TEMPLATE_OTHER_COLOR_KEY) === true)
      : true;
    const paletteCount = wasmPalettePackedColors.length;
    const wasmResult = collectProgressWithWasm({
      sampleData,
      tilePixels,
      tileSize: Math.max(1, Math.trunc(Number(tileSize) || 0)),
      offsetX,
      offsetY,
      palettePackedColors: wasmPalettePackedColors,
      paletteRgb: wasmPaletteRgb,
      paletteCount,
      colorMatchDelta,
      templateEnabled: templateEnabled !== false,
      errorDataPtr0: errorData instanceof Uint8ClampedArray ? errorData : null,
      errorWidth,
      errorMapOnlyEnabled: errorMapOnlyEnabledColors,
      displayedColorsPacked: displayedColorPackedArr,
      displayOther: displayOtherInErrorMap,
    });
    if (wasmResult) {
      const { paintedCount, wrongCount, requiredCount, paintedByIndex, paintedAndEnabledByIndex, missingByIndex, missingMask } = wasmResult;
      const isEnabled = templateEnabled !== false;
      // Reconstruct string-keyed paletteStats from indexed WASM output
      for (let i = 0; i <= paletteCount; i++) {
        const p = paintedByIndex[i] | 0;
        const pe = paintedAndEnabledByIndex[i] | 0;
        const m = missingByIndex[i] | 0;
        if (p === 0 && m === 0) continue;
        const colorKey = i < paletteCount ? (paletteKeyByIndex[i] || TEMPLATE_OTHER_COLOR_KEY) : TEMPLATE_OTHER_COLOR_KEY;
        let entry = paletteStats[colorKey];
        if (entry === undefined) {
          entry = { painted: 0, paintedAndEnabled: 0, missing: 0, examplesEnabled: [] };
          paletteStats[colorKey] = entry;
        }
        entry.painted += p;
        entry.paintedAndEnabled += pe;
        entry.missing += m;
      }
      // Build templateStats from total painted count
      if (templateKey) {
        let tp = templateStats[templateKey];
        if (tp === undefined) {
          tp = { painted: 0, palette: {} };
          templateStats[templateKey] = tp;
        }
        tp.painted += paintedCount;
        for (let i = 0; i <= paletteCount; i++) {
          const p = paintedByIndex[i] | 0;
          if (p === 0) continue;
          const colorKey = i < paletteCount ? (paletteKeyByIndex[i] || TEMPLATE_OTHER_COLOR_KEY) : TEMPLATE_OTHER_COLOR_KEY;
          tp.palette[colorKey] = (Number(tp.palette[colorKey]) || 0) + p;
        }
      }
      // Collect examples via missingMask (second pass — cheap byte scan)
      if (isEnabled && exampleMax > 0) {
        const safeTileSize = Math.max(1, Math.trunc(Number(tileSize) || 0));
        for (let i = 0; i < sampleData.count; i++) {
          const maskVal = missingMask[i];
          if (maskVal === 0) continue;
          const paletteIndex = maskVal - 1;
          const colorKey = paletteIndex < paletteCount ? (paletteKeyByIndex[paletteIndex] || TEMPLATE_OTHER_COLOR_KEY) : TEMPLATE_OTHER_COLOR_KEY;
          let entry = paletteStats[colorKey];
          if (entry === undefined) {
            entry = { painted: 0, paintedAndEnabled: 0, missing: 0, examplesEnabled: [] };
            paletteStats[colorKey] = entry;
          }
          const pixelX = offsetX + sampleData.x[i];
          const pixelY = offsetY + sampleData.y[i];
          if (pixelX < 0 || pixelY < 0 || pixelX >= safeTileSize || pixelY >= safeTileSize) continue;
          addPixelExampleToReservoir(entry, tileCoords, pixelX, pixelY, exampleMax, randomFn);
          if (tilePixels instanceof Uint8ClampedArray && tilePixels[(pixelY * safeTileSize + pixelX) * 4 + 3] < 1) {
            addUnpaintedPixelExampleToReservoir(entry, tileCoords, pixelX, pixelY, exampleMax, randomFn);
          }
        }
      }
      return { paintedCount, wrongCount, requiredCount };
    }
  }

  // --- JS fallback ---
  let paintedCount = 0;
  let wrongCount = 0;
  let requiredCount = 0;
  const safeTileSize = Math.max(1, Math.trunc(Number(tileSize) || 0));
  const templateProgress = templateKey
    ? (templateStats[templateKey] ?? (templateStats[templateKey] = { painted: 0, palette: {} }))
    : null;
  const canWriteErrorMap = !!(errorData && templateEnabled);
  const displayedColorPackedSet = errorMapOnlyEnabledColors ? getDisplayedColorPackedSet(displayedColors) : null;
  const displayOther = errorMapOnlyEnabledColors ? displayedColors?.has(TEMPLATE_OTHER_COLOR_KEY) === true : true;

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
    const packedTemplateColor = packRgb(templateRed, templateGreen, templateBlue);
    const paletteIndex = getPaletteIndexForPackedRgb(packedTemplateColor);
    const colorKey = paletteKeyByIndex[paletteIndex] || TEMPLATE_OTHER_COLOR_KEY;
    const tileIndex = (pixelY * safeTileSize + pixelX) * 4;
    const liveRed = tilePixels[tileIndex];
    const liveGreen = tilePixels[tileIndex + 1];
    const liveBlue = tilePixels[tileIndex + 2];
    const liveAlpha = tilePixels[tileIndex + 3];
    const shouldColorAppearInErrorMap = !errorMapOnlyEnabledColors || (
      paletteIndex === PALETTE_INDEX_OTHER
        ? displayOther
        : displayedColorPackedSet?.has(packedTemplateColor)
    );
    const shouldWriteError = canWriteErrorMap && shouldColorAppearInErrorMap;
    const errorIndex = shouldWriteError ? (localY * errorWidth + localX) * 4 : -1;

    let isPainted = false;
    if (liveAlpha < 64) {
      if (shouldWriteError) {
        errorData[errorIndex] = 128;
        errorData[errorIndex + 1] = 128;
        errorData[errorIndex + 2] = 128;
        errorData[errorIndex + 3] = 255;
      }
    } else {
      const exactMatch = liveRed === templateRed && liveGreen === templateGreen && liveBlue === templateBlue;
      const closeMatch = paletteIndex !== PALETTE_INDEX_OTHER && (
        Math.abs(liveRed - templateRed) <= colorMatchDelta
        && Math.abs(liveGreen - templateGreen) <= colorMatchDelta
        && Math.abs(liveBlue - templateBlue) <= colorMatchDelta
      );
      let paletteMatch = false;
      if (!(exactMatch || closeMatch)) {
        const packedLiveColor = packRgb(liveRed, liveGreen, liveBlue);
        const normalizedLivePacked = paintablePackedRgbSet.has(packedLiveColor)
          ? packedLiveColor
          : getNearestPaintablePacked(liveRed, liveGreen, liveBlue);
        paletteMatch = paletteIndex !== PALETTE_INDEX_OTHER && normalizedLivePacked === packedTemplateColor;
      }
      if (!(exactMatch || closeMatch || paletteMatch)) {
        wrongCount++;
        if (shouldWriteError) {
          errorData[errorIndex] = 255;
          errorData[errorIndex + 1] = 0;
          errorData[errorIndex + 2] = 0;
          errorData[errorIndex + 3] = 255;
        }
      } else {
        paintedCount++;
        isPainted = true;
        let paletteEntry = paletteStats[colorKey];
        if (paletteEntry === undefined) {
          paletteEntry = {
            painted: 0,
            paintedAndEnabled: 0,
            missing: 0,
            examplesEnabled: [],
          };
          paletteStats[colorKey] = paletteEntry;
        }
        paletteEntry.painted++;
        if (templateEnabled) {
          paletteEntry.paintedAndEnabled++;
        }
        if (templateProgress) {
          templateProgress.painted++;
          if (!templateProgress.palette || typeof templateProgress.palette !== 'object') {
            templateProgress.palette = {};
          }
          templateProgress.palette[colorKey] = (Number(templateProgress.palette[colorKey]) || 0) + 1;
        }
        if (shouldWriteError) {
          errorData[errorIndex] = 0;
          errorData[errorIndex + 1] = 128;
          errorData[errorIndex + 2] = 0;
          errorData[errorIndex + 3] = 255;
        }
      }
    }

    if (!isPainted) {
      let paletteEntry = paletteStats[colorKey];
      if (paletteEntry === undefined) {
        paletteEntry = {
          painted: 0,
          paintedAndEnabled: 0,
          missing: 0,
          examplesEnabled: [],
        };
        paletteStats[colorKey] = paletteEntry;
      }
      paletteEntry.missing++;
      if (templateEnabled) {
        addPixelExampleToReservoir(paletteEntry, tileCoords, pixelX, pixelY, exampleMax, randomFn);
        if (liveAlpha < 1) {
          addUnpaintedPixelExampleToReservoir(paletteEntry, tileCoords, pixelX, pixelY, exampleMax, randomFn);
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
  excludedCoordsKeySet,
  templateName,
  distanceSqFn,
  colorMatchDelta = LIVE_COLOR_MATCH_DELTA,
  useWasm = true,
}) => {
  if (!sampleData || !liveTilePixels || !Number.isFinite(tileSize) || typeof distanceSqFn !== 'function') {
    return null;
  }

  const displayedColorPackedSet = getDisplayedColorPackedSet(displayedColorSet);
  if (!displayedColorPackedSet || displayedColorPackedSet.size === 0) {
    return null;
  }

  const excludedCoordsSet = excludedCoordsKeySet instanceof Set ? excludedCoordsKeySet : null;
  const singleExcludedCoordsKey = (
    excludedCoordsSet && excludedCoordsSet.size === 1
      ? excludedCoordsSet.values().next().value
      : excludedCoordsKey
  );
  const excludedCoords = parseCoordsKey(singleExcludedCoordsKey);
  const safeTileSize = Math.max(1, Math.trunc(Number(tileSize) || 0));
  if (useWasm && (!excludedCoordsSet || excludedCoordsSet.size <= 1) && isTemplateNearestWasmAvailable()) {
    const displayedColorPackedArray = getDisplayedColorPackedArray(displayedColorSet);
    if (displayedColorPackedArray && displayedColorPackedArray.length > 0) {
      const wasmResult = findNearestUnpaintedPixelWithWasm({
        sampleData,
        liveTilePixels,
        tileSize: safeTileSize,
        offsetX,
        offsetY,
        tileX,
        tileY,
        originPoint,
        excludedCoords,
        allowedPackedColors: displayedColorPackedArray,
        colorMatchDelta,
      });
      if (wasmResult && Number.isFinite(wasmResult.distanceSq)) {
        const coords = [tileX, tileY, wasmResult.pixelX, wasmResult.pixelY];
        return {
          coords,
          coordsKey: coords.join(','),
          distanceSq: wasmResult.distanceSq,
          templateName,
        };
      }
    }
  }

  const coordsScratch = [tileX, tileY, 0, 0];
  let bestDistanceSq = Infinity;
  let bestPixelX = null;
  let bestPixelY = null;
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
    const packedTemplateColor = packRgb(templateRed, templateGreen, templateBlue);
    if (!paintablePackedRgbSet.has(packedTemplateColor) || !displayedColorPackedSet.has(packedTemplateColor)) continue;

    const tileIndex = (pixelY * safeTileSize + pixelX) * 4;
    const liveAlpha = liveTilePixels[tileIndex + 3];
    const liveRed = liveTilePixels[tileIndex];
    const liveGreen = liveTilePixels[tileIndex + 1];
    const liveBlue = liveTilePixels[tileIndex + 2];
    const exactMatch = liveRed === templateRed && liveGreen === templateGreen && liveBlue === templateBlue;
    const closeMatch = (
      Math.abs(liveRed - templateRed) <= colorMatchDelta
      && Math.abs(liveGreen - templateGreen) <= colorMatchDelta
      && Math.abs(liveBlue - templateBlue) <= colorMatchDelta
    );
    let isPainted = liveAlpha >= 64 && (exactMatch || closeMatch);
    if (!isPainted && liveAlpha >= 64) {
      const packedLiveColor = packRgb(liveRed, liveGreen, liveBlue);
      const normalizedLivePacked = paintablePackedRgbSet.has(packedLiveColor)
        ? packedLiveColor
        : getNearestPaintablePacked(liveRed, liveGreen, liveBlue);
      isPainted = normalizedLivePacked === packedTemplateColor;
    }
    if (isPainted) continue;

    if (
      excludedCoords
      && tileX === excludedCoords[0]
      && tileY === excludedCoords[1]
      && pixelX === excludedCoords[2]
      && pixelY === excludedCoords[3]
    ) {
      continue;
    }

    coordsScratch[2] = pixelX;
    coordsScratch[3] = pixelY;
    if (excludedCoordsSet?.has(coordsScratch.join(','))) {
      continue;
    }
    const distanceSq = distanceSqFn(originPoint, coordsScratch);
    if (!Number.isFinite(distanceSq)) continue;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestPixelX = pixelX;
      bestPixelY = pixelY;
    }
  }
  if (!Number.isFinite(bestDistanceSq) || bestPixelX === null || bestPixelY === null) {
    return null;
  }
  const coords = [tileX, tileY, bestPixelX, bestPixelY];
  return {
    coords,
    coordsKey: coords.join(','),
    distanceSq: bestDistanceSq,
    templateName,
  };
};
