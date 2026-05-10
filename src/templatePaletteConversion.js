import { colorpalette } from './utils.js';
import { convertImageDataToPaletteWithWasm, isTemplatePaletteWasmAvailable } from './templatePaletteWasm.js';

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
const clampUnit = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const normalizeDistanceMode = (value) => String(value || '').toLowerCase() === 'euclidean' ? 'euclidean' : 'weighted';
const normalizeDitherMode = (value) => String(value || '').toLowerCase() === 'floyd-steinberg' ? 'floyd-steinberg' : 'none';
const packRgb = (r, g, b) => ((r << 16) | (g << 8) | b) >>> 0;

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

export const templatePalettePackedEntries = templatePaletteColors.map((entry) => ({
  ...entry,
  packed: packRgb(entry.rgb[0], entry.rgb[1], entry.rgb[2]),
}));

export const templatePalettePackedSet = new Set(
  templatePalettePackedEntries.map((entry) => entry.packed)
);

export const templatePaletteWasmBytes = (() => {
  const bytes = new Uint8Array(templatePalettePackedEntries.length * 4);
  for (let index = 0; index < templatePalettePackedEntries.length; index++) {
    const offset = index << 2;
    const rgb = templatePalettePackedEntries[index].rgb;
    bytes[offset] = rgb[0];
    bytes[offset + 1] = rgb[1];
    bytes[offset + 2] = rgb[2];
    bytes[offset + 3] = 0;
  }
  return bytes;
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
  return dr * dr * 0.2126 + dg * dg * 0.7152 + db * db * 0.0722;
};

const getNearestPaletteColor = (r, g, b, options, cache) => {
  const cacheKey = packRgb(clampByte(r), clampByte(g), clampByte(b));
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let nearest = templatePalettePackedEntries[0];
  let nearestDistance = Infinity;
  for (const entry of templatePalettePackedEntries) {
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
  const allowWasm = options?.useWasm !== false;
  const width = Math.max(1, Math.trunc(imageData.width));
  const height = Math.max(1, Math.trunc(imageData.height));
  const data = imageData.data;
  const pixelCount = width * height;
  const original = new Uint8ClampedArray(data);
  const alphaPass = new Uint8Array(pixelCount);
  const nonPalettePackedColors = new Set();

  let nonPalettePixels = 0;
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    const alpha = original[base + 3];
    if (alpha < normalizedOptions.alphaThreshold) {
      data[base + 3] = 0;
      continue;
    }
    alphaPass[i] = 1;
    const packed = packRgb(original[base], original[base + 1], original[base + 2]);
    if (!templatePalettePackedSet.has(packed)) {
      nonPalettePixels++;
      nonPalettePackedColors.add(packed);
    }
  }

  const nearestCache = new Map();
  const canUseWasm = (
    allowWasm
    && nonPalettePixels > 0
    && normalizedOptions.ditherMode === 'none'
    && normalizedOptions.antiDitherStrength <= 0
    && isTemplatePaletteWasmAvailable()
  );
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
        const originalPacked = packRgb(original[base], original[base + 1], original[base + 2]);
        if (templatePalettePackedSet.has(originalPacked)) {
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
  } else if (canUseWasm) {
    convertImageDataToPaletteWithWasm({
      data,
      paletteBytes: templatePaletteWasmBytes,
      alphaThreshold: normalizedOptions.alphaThreshold,
      distanceMode: normalizedOptions.distanceMode,
    });
  } else {
    for (let i = 0; i < pixelCount; i++) {
      const base = i * 4;
      if (!alphaPass[i]) {
        data[base + 3] = 0;
        continue;
      }
      const originalPacked = packRgb(original[base], original[base + 1], original[base + 2]);
      if (templatePalettePackedSet.has(originalPacked)) {
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
      const minDominance = 0.75 - 0.4 * strength;
      const passes = Math.max(1, Math.round(strength * 3));
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

  const convertedColorPacks = new Set();
  let convertedPixels = 0;
  let remainingOtherPixels = 0;
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    if (data[base + 3] === 0) continue;
    const outputPacked = packRgb(data[base], data[base + 1], data[base + 2]);
    if (!templatePalettePackedSet.has(outputPacked)) {
      remainingOtherPixels++;
    }
    if (
      original[base] !== data[base] ||
      original[base + 1] !== data[base + 1] ||
      original[base + 2] !== data[base + 2] ||
      original[base + 3] !== data[base + 3]
    ) {
      convertedPixels++;
      convertedColorPacks.add(packRgb(original[base], original[base + 1], original[base + 2]));
    }
  }

  return {
    imageData,
    options: normalizedOptions,
    stats: {
      nonPalettePixels,
      nonPaletteColorCount: nonPalettePackedColors.size,
      convertedPixels,
      convertedColorCount: convertedColorPacks.size,
      remainingOtherPixels,
    },
  };
}
