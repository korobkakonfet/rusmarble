import { colorpalette } from './utils.js';
import { convertImageDataToPaletteWithWasm, isTemplatePaletteWasmAvailable } from './templatePaletteWasm.js';
import { createExactNearestLookup } from './templateNearestPalette.js';

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
const clampUnit = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const normalizeDistanceMode = (value) => String(value || '').toLowerCase() === 'euclidean' ? 'euclidean' : 'weighted';
const normalizeDitherMode = (value) => String(value || '').toLowerCase() === 'floyd-steinberg' ? 'floyd-steinberg' : 'none';
const packRgb = (r, g, b) => ((r << 16) | (g << 8) | b) >>> 0;
// rgb(222,250,206) is the #deface marker for the in-game Transparent colour. It is not a
// paintable palette entry (templatePaletteColors drops "transparent" below), so without an
// explicit carve-out the nearest-colour search snaps it to a real colour - light yellow.
const PACKED_DEFACE_RGB = packRgb(222, 250, 206);

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

/** Parallel channel arrays for the full template palette, in tie-break order. */
export const templatePaletteChannels = (() => {
  const count = templatePalettePackedEntries.length;
  const r = new Uint8Array(count);
  const g = new Uint8Array(count);
  const b = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const rgb = templatePalettePackedEntries[index].rgb;
    r[index] = rgb[0];
    g[index] = rgb[1];
    b[index] = rgb[2];
  }
  return { r, g, b, count };
})();

// One cube per metric, built on first use and reused for the lifetime of the page.
const nearestLookupByMode = { weighted: null, euclidean: null };
const getNearestPaletteLookup = (distanceMode) => {
  const key = distanceMode === 'euclidean' ? 'euclidean' : 'weighted';
  if (!nearestLookupByMode[key]) {
    nearestLookupByMode[key] = key === 'euclidean'
      ? createExactNearestLookup(templatePaletteChannels)
      : createExactNearestLookup(templatePaletteChannels, { weightR: 0.2126, weightG: 0.7152, weightB: 0.0722 });
  }
  return nearestLookupByMode[key];
};

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

/**
 * Collapse isolated dither speckle by replacing a pixel with the dominant colour of its 3x3
 * neighbourhood, repeated for a strength-derived number of passes.
 *
 * The neighbourhood holds at most nine colours, so the tally lives in two nine-slot scratch arrays
 * scanned linearly. That replaces a `new Map()` allocated for every pixel of every pass, which was
 * the single heaviest allocation in the conversion pipeline. Scan order and the strictly-greater
 * comparison below are preserved exactly, so ties break the same way they always did.
 */
const applyAntiDither = (data, width, height, normalizedOptions) => {
  const strength = normalizedOptions.antiDitherStrength;
  const alphaThreshold = normalizedOptions.alphaThreshold;
  const minDominance = 0.75 - 0.4 * strength;
  const passes = Math.max(1, Math.round(strength * 3));
  let src = new Uint8ClampedArray(data);
  let dst = new Uint8ClampedArray(src.length);

  const offsetX = Int8Array.from([-1, 0, 1, -1, 0, 1, -1, 0, 1]);
  const offsetY = Int8Array.from([-1, -1, -1, 0, 0, 0, 1, 1, 1]);
  const tallyKeys = new Int32Array(9);
  const tallyCounts = new Int32Array(9);

  for (let pass = 0; pass < passes; pass++) {
    // Neighbour byte deltas are constant for every interior pixel, so the interior loop indexes
    // straight off them instead of recomputing nx/ny and bounds-checking nine times per pixel.
    const neighborDelta = new Int32Array(9);
    for (let n = 0; n < 9; n++) {
      neighborDelta[n] = (offsetY[n] * width + offsetX[n]) * 4;
    }

    for (let y = 0; y < height; y++) {
      const interiorRow = y > 0 && y < height - 1;
      for (let x = 0; x < width; x++) {
        const base = (y * width + x) * 4;
        const selfKey = (src[base] << 16) | (src[base + 1] << 8) | src[base + 2];
        if (src[base + 3] < alphaThreshold) {
          dst[base] = src[base];
          dst[base + 1] = src[base + 1];
          dst[base + 2] = src[base + 2];
          dst[base + 3] = 0;
          continue;
        }

        let total = 0;
        let bestKey = selfKey;
        let bestCount = 0;
        let tallyLength = 0;
        const interior = interiorRow && x > 0 && x < width - 1;

        for (let n = 0; n < 9; n++) {
          let nbase;
          if (interior) {
            nbase = base + neighborDelta[n];
          } else {
            const nx = x + offsetX[n];
            const ny = y + offsetY[n];
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            nbase = (ny * width + nx) * 4;
          }
          if (src[nbase + 3] < alphaThreshold) continue;
          const key = (src[nbase] << 16) | (src[nbase + 1] << 8) | src[nbase + 2];

          let slot = -1;
          for (let t = 0; t < tallyLength; t++) {
            if (tallyKeys[t] === key) { slot = t; break; }
          }
          let count;
          if (slot < 0) {
            slot = tallyLength++;
            tallyKeys[slot] = key;
            count = 1;
          } else {
            count = tallyCounts[slot] + 1;
          }
          tallyCounts[slot] = count;
          total++;
          if (count > bestCount) {
            bestCount = count;
            bestKey = key;
          }
        }

        const dominance = total > 0 ? bestCount / total : 0;
        const outKey = dominance >= minDominance ? bestKey : selfKey;
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

  const canUseWasm = (
    allowWasm
    && normalizedOptions.ditherMode === 'none'
    && normalizedOptions.antiDitherStrength <= 0
    && isTemplatePaletteWasmAvailable()
  );
  // Only the WASM and anti-dither paths need a before/after diff to produce their stats: the WASM
  // module is opaque to us, and anti-dither can recolour pixels that were already in the palette.
  // Every other path knows exactly which pixels it changed, so it derives the stats inline and
  // skips both the full-image copy and the full-image verify pass this used to always pay.
  const needsVerifyPass = canUseWasm || normalizedOptions.antiDitherStrength > 0;
  const original = needsVerifyPass ? new Uint8ClampedArray(data) : null;

  // Pre-pass, one sweep, two facts per pixel: did it clear the alpha gate, and is its colour
  // already a palette colour. Recording membership here means the conversion loops below never
  // repeat the pack + Set.has that used to run a second time per pixel.
  const FLAG_ALPHA = 1;
  const FLAG_IN_PALETTE = 2;
  const FLAG_DEFACE = 4;
  const pixelFlags = new Uint8Array(pixelCount);
  const nonPalettePackedColors = new Set();
  // Offsets of the #deface pixels, so the opaque WASM path and anti-dither -- neither of which can
  // be told to leave a colour alone -- can be undone for exactly those pixels afterwards.
  const defaceOffsets = [];

  let nonPalettePixels = 0;
  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    if (data[base + 3] < normalizedOptions.alphaThreshold) {
      data[base + 3] = 0;
      continue;
    }
    const packed = packRgb(data[base], data[base + 1], data[base + 2]);
    if (packed === PACKED_DEFACE_RGB) {
      pixelFlags[i] = FLAG_ALPHA | FLAG_IN_PALETTE | FLAG_DEFACE;
      defaceOffsets.push(base);
      continue;
    }
    if (templatePalettePackedSet.has(packed)) {
      pixelFlags[i] = FLAG_ALPHA | FLAG_IN_PALETTE;
      continue;
    }
    pixelFlags[i] = FLAG_ALPHA;
    nonPalettePixels++;
    nonPalettePackedColors.add(packed);
  }

  const useWasmNow = canUseWasm && nonPalettePixels > 0;
  // Resolved once per call, not once per pixel: the metric branch and the palette layout are both
  // baked into the returned closure, which answers from a proven-exact RGB cube.
  const nearestIndexOf = (!useWasmNow && nonPalettePixels > 0)
    ? getNearestPaletteLookup(normalizedOptions.distanceMode)
    : null;
  const paletteR = templatePaletteChannels.r;
  const paletteG = templatePaletteChannels.g;
  const paletteB = templatePaletteChannels.b;

  if (normalizedOptions.ditherMode === 'floyd-steinberg' && normalizedOptions.ditherStrength > 0) {
    const workingR = new Float32Array(pixelCount);
    const workingG = new Float32Array(pixelCount);
    const workingB = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const base = i * 4;
      workingR[i] = data[base];
      workingG[i] = data[base + 1];
      workingB[i] = data[base + 2];
    }

    const strength = normalizedOptions.ditherStrength;
    const serpentine = normalizedOptions.serpentine;
    const lastRow = height - 1;
    for (let y = 0; y < height; y++) {
      const reverse = serpentine && (y & 1) === 1;
      const rowStart = y * width;
      const nextRowStart = rowStart + width;
      const hasNextRow = y < lastRow;
      const xStart = reverse ? width - 1 : 0;
      const xEnd = reverse ? -1 : width;
      const xStep = reverse ? -1 : 1;
      for (let x = xStart; x !== xEnd; x += xStep) {
        const idx = rowStart + x;
        const base = idx * 4;
        const flags = pixelFlags[idx];
        if ((flags & FLAG_ALPHA) === 0) {
          data[base + 3] = 0;
          continue;
        }
        if ((flags & FLAG_IN_PALETTE) !== 0) continue;

        let sourceR = workingR[idx];
        let sourceG = workingG[idx];
        let sourceB = workingB[idx];
        sourceR = sourceR < 0 ? 0 : (sourceR > 255 ? 255 : Math.round(sourceR));
        sourceG = sourceG < 0 ? 0 : (sourceG > 255 ? 255 : Math.round(sourceG));
        sourceB = sourceB < 0 ? 0 : (sourceB > 255 ? 255 : Math.round(sourceB));
        const nearestIndex = nearestIndexOf(sourceR, sourceG, sourceB);
        const outR = paletteR[nearestIndex];
        const outG = paletteG[nearestIndex];
        const outB = paletteB[nearestIndex];
        data[base] = outR;
        data[base + 1] = outG;
        data[base + 2] = outB;

        const errR = (workingR[idx] - outR) * strength;
        const errG = (workingG[idx] - outG) * strength;
        const errB = (workingB[idx] - outB) * strength;

        // addError inlined. The four targets differ only by index, and each one's bounds check
        // collapses to a comparison the closure used to redo from scratch four times per pixel.
        const ahead = reverse ? x - 1 : x + 1;
        const behind = reverse ? x + 1 : x - 1;
        if (ahead >= 0 && ahead < width) {
          const t = rowStart + ahead;
          if ((pixelFlags[t] & FLAG_ALPHA) !== 0) {
            workingR[t] += errR * 0.4375; workingG[t] += errG * 0.4375; workingB[t] += errB * 0.4375;
          }
        }
        if (hasNextRow) {
          if (behind >= 0 && behind < width) {
            const t = nextRowStart + behind;
            if ((pixelFlags[t] & FLAG_ALPHA) !== 0) {
              workingR[t] += errR * 0.1875; workingG[t] += errG * 0.1875; workingB[t] += errB * 0.1875;
            }
          }
          const below = nextRowStart + x;
          if ((pixelFlags[below] & FLAG_ALPHA) !== 0) {
            workingR[below] += errR * 0.3125; workingG[below] += errG * 0.3125; workingB[below] += errB * 0.3125;
          }
          if (ahead >= 0 && ahead < width) {
            const t = nextRowStart + ahead;
            if ((pixelFlags[t] & FLAG_ALPHA) !== 0) {
              workingR[t] += errR * 0.0625; workingG[t] += errG * 0.0625; workingB[t] += errB * 0.0625;
            }
          }
        }
      }
    }
  } else if (useWasmNow) {
    convertImageDataToPaletteWithWasm({
      data,
      paletteBytes: templatePaletteWasmBytes,
      alphaThreshold: normalizedOptions.alphaThreshold,
      distanceMode: normalizedOptions.distanceMode,
    });
  } else if (nonPalettePixels > 0) {
    for (let i = 0; i < pixelCount; i++) {
      // In-palette and alpha-failed pixels are already correct after the pre-pass, so the only
      // work left is the pixels that actually need a new colour.
      if (pixelFlags[i] !== FLAG_ALPHA) continue;
      const base = i * 4;
      const nearestIndex = nearestIndexOf(data[base], data[base + 1], data[base + 2]);
      data[base] = paletteR[nearestIndex];
      data[base + 1] = paletteG[nearestIndex];
      data[base + 2] = paletteB[nearestIndex];
    }
  }

  if (normalizedOptions.antiDitherStrength > 0) {
    applyAntiDither(data, width, height, normalizedOptions);
  }

  for (let index = 0; index < defaceOffsets.length; index++) {
    const base = defaceOffsets[index];
    data[base] = 222;
    data[base + 1] = 250;
    data[base + 2] = 206;
  }

  let convertedPixels;
  let convertedColorCount;
  let remainingOtherPixels;
  if (needsVerifyPass) {
    const convertedColorPacks = new Set();
    convertedPixels = 0;
    remainingOtherPixels = 0;
    for (let i = 0; i < pixelCount; i++) {
      const base = i * 4;
      if (data[base + 3] === 0) continue;
      if ((pixelFlags[i] & FLAG_DEFACE) !== 0) continue;
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
    convertedColorCount = convertedColorPacks.size;
  } else {
    // Every alpha-passing pixel that was not already a palette colour got replaced by a palette
    // colour, and nothing else was touched -- so the counts are exactly the pre-pass tallies and
    // nothing is left outside the palette.
    convertedPixels = nonPalettePixels;
    convertedColorCount = nonPalettePackedColors.size;
    remainingOtherPixels = 0;
  }

  return {
    imageData,
    options: normalizedOptions,
    stats: {
      nonPalettePixels,
      nonPaletteColorCount: nonPalettePackedColors.size,
      convertedPixels,
      convertedColorCount,
      remainingOtherPixels,
    },
  };
}
