import { templatePaletteWasmBytes } from './generated/templatePaletteWasmBytes.js';

const WASM_PAGE_BYTES = 64 * 1024;
const WASM_DISTANCE_MODE = Object.freeze({
  euclidean: 0,
  weighted: 1,
});

let wasmPaletteState;

const getTemplatePaletteWasmState = () => {
  if (wasmPaletteState !== undefined) {
    return wasmPaletteState;
  }
  try {
    if (
      typeof WebAssembly === 'undefined'
      || !(templatePaletteWasmBytes instanceof Uint8Array)
      || templatePaletteWasmBytes.length === 0
    ) {
      wasmPaletteState = null;
      return wasmPaletteState;
    }
    const module = new WebAssembly.Module(templatePaletteWasmBytes);
    const instance = new WebAssembly.Instance(module, {});
    const convertPixels = instance.exports?.convert_pixels;
    const memory = instance.exports?.memory;
    if (!(memory instanceof WebAssembly.Memory) || typeof convertPixels !== 'function') {
      wasmPaletteState = null;
      return wasmPaletteState;
    }
    wasmPaletteState = {
      memory,
      convertPixels,
    };
  } catch (_) {
    wasmPaletteState = null;
  }
  return wasmPaletteState;
};

const ensureMemoryCapacity = (memory, requiredBytes) => {
  const currentBytes = memory.buffer.byteLength;
  if (requiredBytes <= currentBytes) return;
  const missingBytes = requiredBytes - currentBytes;
  const growPages = Math.ceil(missingBytes / WASM_PAGE_BYTES);
  memory.grow(growPages);
};

export function isTemplatePaletteWasmAvailable() {
  return getTemplatePaletteWasmState() !== null;
}

export function convertImageDataToPaletteWithWasm({
  data,
  paletteBytes,
  alphaThreshold = 1,
  distanceMode = 'weighted',
} = {}) {
  const state = getTemplatePaletteWasmState();
  if (!state) return null;
  if (!(data instanceof Uint8ClampedArray) || !(paletteBytes instanceof Uint8Array)) {
    return null;
  }

  const pixelCount = data.length >>> 2;
  const paletteCount = paletteBytes.length >>> 2;
  if (pixelCount < 1 || paletteCount < 1) {
    return { convertedPixels: 0 };
  }

  const dataPtr = 0;
  const palettePtr = data.length;
  const totalBytes = palettePtr + paletteBytes.length;
  ensureMemoryCapacity(state.memory, totalBytes);

  const memoryBytes = new Uint8Array(state.memory.buffer);
  memoryBytes.set(data, dataPtr);
  memoryBytes.set(paletteBytes, palettePtr);

  const convertedPixels = state.convertPixels(
    dataPtr,
    pixelCount,
    Math.max(0, Math.min(255, Math.trunc(Number(alphaThreshold) || 0))),
    palettePtr,
    paletteCount,
    WASM_DISTANCE_MODE[distanceMode] ?? WASM_DISTANCE_MODE.weighted
  ) >>> 0;

  data.set(memoryBytes.subarray(dataPtr, dataPtr + data.length));
  return { convertedPixels };
}
