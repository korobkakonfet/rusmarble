import { templateSampleExtractWasmBytes } from './generated/templateSampleExtractWasmBytes.js';
import { rgbToMeta } from './utils.js';

const WASM_PAGE_BYTES = 64 * 1024;
const TEMPLATE_OTHER_COLOR_KEY = 'other';
const TEMPLATE_DEFACE_KEY = '222,250,206';

let wasmSampleExtractState;

const packRgb = (r, g, b) => ((r << 16) | (g << 8) | b) >>> 0;
const TEMPLATE_DEFACE_PACKED = packRgb(222, 250, 206);
const align = (value, alignment) => ((value + alignment - 1) & ~(alignment - 1));
const ensureMemoryCapacity = (memory, requiredBytes) => {
  const currentBytes = memory.buffer.byteLength;
  if (requiredBytes <= currentBytes) return;
  const growPages = Math.ceil((requiredBytes - currentBytes) / WASM_PAGE_BYTES);
  memory.grow(growPages);
};
const paletteState = (() => {
  const seen = new Set();
  const keys = [];
  const packed = [];
  const keyByPacked = new Map();
  for (const key of rgbToMeta.keys()) {
    if (key === TEMPLATE_OTHER_COLOR_KEY || key === TEMPLATE_DEFACE_KEY) continue;
    const parts = key.split(',').map(Number);
    if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) continue;
    const packedColor = packRgb(parts[0], parts[1], parts[2]);
    if (seen.has(packedColor)) continue;
    seen.add(packedColor);
    keys.push(key);
    packed.push(packedColor);
    keyByPacked.set(packedColor, key);
  }
  return {
    keys,
    packed: Uint32Array.from(packed),
    keyByPacked,
  };
})();

const getTemplateSampleExtractWasmState = () => {
  if (wasmSampleExtractState !== undefined) {
    return wasmSampleExtractState;
  }
  try {
    if (
      typeof WebAssembly === 'undefined'
      || !(templateSampleExtractWasmBytes instanceof Uint8Array)
      || templateSampleExtractWasmBytes.length === 0
    ) {
      wasmSampleExtractState = null;
      return wasmSampleExtractState;
    }
    const module = new WebAssembly.Module(templateSampleExtractWasmBytes);
    const instance = new WebAssembly.Instance(module, {});
    const extractSamples = instance.exports?.extract_samples;
    const memory = instance.exports?.memory;
    if (!(memory instanceof WebAssembly.Memory) || typeof extractSamples !== 'function') {
      wasmSampleExtractState = null;
      return wasmSampleExtractState;
    }
    wasmSampleExtractState = {
      memory,
      extractSamples,
    };
  } catch (_) {
    wasmSampleExtractState = null;
  }
  return wasmSampleExtractState;
};

export function isTemplateSampleExtractWasmAvailable() {
  return getTemplateSampleExtractWasmState() !== null;
}

export function createTemplateSampleExtractorWithWasm({
  sourceData,
  imageWidth,
} = {}) {
  const state = getTemplateSampleExtractWasmState();
  if (!state || !(sourceData instanceof Uint8ClampedArray) || !Number.isFinite(imageWidth)) {
    return null;
  }

  const sourceBytes = new Uint8Array(
    sourceData.buffer,
    sourceData.byteOffset,
    sourceData.byteLength
  );
  const palettePacked = paletteState.packed;
  const sourcePtr = 0;
  const palettePtr = align(sourceBytes.byteLength, 4);
  let loadedBuffer = null;

  const loadStaticMemory = () => {
    const memoryBytes = new Uint8Array(state.memory.buffer);
    memoryBytes.set(sourceBytes, sourcePtr);
    memoryBytes.set(
      new Uint8Array(palettePacked.buffer, palettePacked.byteOffset, palettePacked.byteLength),
      palettePtr
    );
    loadedBuffer = state.memory.buffer;
  };

  return ({
    sourceX,
    sourceY,
    chunkWidth,
    chunkHeight,
    includeStats = false,
  } = {}) => {
    const maxCount = Math.max(0, Math.trunc((chunkWidth || 0) * (chunkHeight || 0)));
    const statsEnabled = includeStats === true;
    let cursor = align(palettePtr + palettePacked.byteLength, 4);
    const xPtr = cursor;
    cursor += maxCount * 2;
    const yPtr = cursor;
    cursor += maxCount * 2;
    const rPtr = cursor;
    cursor += maxCount;
    const gPtr = cursor;
    cursor += maxCount;
    const bPtr = cursor;
    cursor += maxCount;
    const aPtr = cursor;
    cursor += maxCount;
    const flagsPtr = cursor;
    cursor += maxCount;
    ensureMemoryCapacity(state.memory, cursor);
    if (loadedBuffer !== state.memory.buffer) {
      loadStaticMemory();
    }

    const count = state.extractSamples(
      sourcePtr,
      Math.trunc(imageWidth),
      Math.max(0, Math.trunc(sourceX || 0)),
      Math.max(0, Math.trunc(sourceY || 0)),
      Math.max(0, Math.trunc(chunkWidth || 0)),
      Math.max(0, Math.trunc(chunkHeight || 0)),
      xPtr,
      yPtr,
      rPtr,
      gPtr,
      bPtr,
      aPtr,
      flagsPtr,
      palettePtr,
      0,
      0,
      0
    ) >>> 0;

    const sampleData = {
      width: Math.max(0, Math.trunc(chunkWidth || 0)),
      height: Math.max(0, Math.trunc(chunkHeight || 0)),
      count,
      x: new Uint16Array(count),
      y: new Uint16Array(count),
      r: new Uint8Array(count),
      g: new Uint8Array(count),
      b: new Uint8Array(count),
      a: new Uint8Array(count),
      flags: new Uint8Array(count),
      native: true,
    };
    sampleData.x.set(new Uint16Array(state.memory.buffer, xPtr, count));
    sampleData.y.set(new Uint16Array(state.memory.buffer, yPtr, count));
    sampleData.r.set(new Uint8Array(state.memory.buffer, rPtr, count));
    sampleData.g.set(new Uint8Array(state.memory.buffer, gPtr, count));
    sampleData.b.set(new Uint8Array(state.memory.buffer, bPtr, count));
    sampleData.a.set(new Uint8Array(state.memory.buffer, aPtr, count));
    sampleData.flags.set(new Uint8Array(state.memory.buffer, flagsPtr, count));

    let stats = null;
    if (statsEnabled) {
      const paletteCounts = Object.create(null);
      let required = 0;
      let deface = 0;
      let hasOther = false;
      for (let index = 0; index < count; index++) {
        const packedColor = packRgb(sampleData.r[index], sampleData.g[index], sampleData.b[index]);
        if (packedColor === TEMPLATE_DEFACE_PACKED) {
          sampleData.flags[index] = 1;
          if (sampleData.a[index] >= 64) {
            deface++;
          }
          continue;
        }
        sampleData.flags[index] = 0;
        if (sampleData.a[index] < 64) {
          continue;
        }
        required++;
        const key = paletteState.keyByPacked.get(packedColor) || TEMPLATE_OTHER_COLOR_KEY;
        if (key === TEMPLATE_OTHER_COLOR_KEY) {
          hasOther = true;
        }
        paletteCounts[key] = (paletteCounts[key] || 0) + 1;
      }
      stats = {
        required,
        deface,
        hasOther,
        paletteCounts,
      };
    }
    return {
      sampleData,
      stats,
    };
  };
}
