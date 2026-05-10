import { filterBitmapPixelsWasmBytes } from './generated/filterBitmapPixelsWasmBytes.js';

const WASM_PAGE_BYTES = 64 * 1024;

let wasmState = null;

if (
  typeof WebAssembly !== 'undefined'
  && filterBitmapPixelsWasmBytes instanceof Uint8Array
  && filterBitmapPixelsWasmBytes.length > 0
) {
  WebAssembly.instantiate(filterBitmapPixelsWasmBytes, {}).then(({ instance }) => {
    const filterBitmapPixels = instance.exports?.filter_bitmap_pixels;
    const memory = instance.exports?.memory;
    if (memory instanceof WebAssembly.Memory && typeof filterBitmapPixels === 'function') {
      wasmState = { memory, filterBitmapPixels };
    }
  }).catch(() => {});
}

const getWasmState = () => wasmState;

const align4 = (v) => (v + 3) & ~3;
const ensureMemory = (memory, required) => {
  const current = memory.buffer.byteLength;
  if (required > current) {
    memory.grow(Math.ceil((required - current) / WASM_PAGE_BYTES));
  }
};

export const isFilterBitmapPixelsWasmAvailable = () => getWasmState() !== null;

// Pre-sorted Uint32Array of all known paintable packed colors — computed once at load time.
// Exported so templateManager can reuse it rather than converting the Set each call.
export let knownPaletteColorsSorted = null;
export const initKnownPaletteColorsSorted = (packedSet) => {
  knownPaletteColorsSorted = Uint32Array.from(packedSet).sort();
};

export const filterBitmapPixelsWithWasm = ({
  templateData,      // Uint8ClampedArray — RGBA pixels of the template tile
  templateWidth,
  templateHeight,
  resultWidth,
  resultHeight,
  drawMultTemplate,
  drawMultResult,
  drawMultCenter,    // (shreadSize - 1) >> 1
  maskPoints,        // Array of [offsetX, offsetY] pairs
  displayedColorsPacked, // Uint32Array sorted
  knownColorsPacked,     // Uint32Array sorted
  displayOther,      // boolean
} = {}) => {
  const state = getWasmState();
  if (!state) return null;
  if (
    !(templateData instanceof Uint8ClampedArray)
    || !(displayedColorsPacked instanceof Uint32Array)
    || !(knownColorsPacked instanceof Uint32Array)
    || !Array.isArray(maskPoints)
  ) return null;

  const maskCount = maskPoints.length;
  const templateBytes = templateData.byteLength;
  const resultBytes = resultWidth * resultHeight * 4;
  const maskBytes = maskCount * 8; // 2 × Int32 per point
  const dispBytes = displayedColorsPacked.byteLength;
  const knownBytes = knownColorsPacked.byteLength;

  let cursor = 0;
  const alloc = (bytes, alignment = 1) => {
    cursor = alignment > 1 ? ((cursor + alignment - 1) & ~(alignment - 1)) : cursor;
    const ptr = cursor;
    cursor += bytes;
    return ptr;
  };

  const templatePtr = alloc(templateBytes, 4);
  const resultPtr = alloc(resultBytes, 4);
  const maskPtr = maskBytes > 0 ? alloc(maskBytes, 4) : 0;
  const dispPtr = dispBytes > 0 ? alloc(dispBytes, 4) : 0;
  const knownPtr = knownBytes > 0 ? alloc(knownBytes, 4) : 0;

  ensureMemory(state.memory, cursor);
  const memU8 = new Uint8Array(state.memory.buffer);
  const memI32 = new Int32Array(state.memory.buffer);

  memU8.set(new Uint8Array(templateData.buffer, templateData.byteOffset, templateBytes), templatePtr);
  // zero result region
  memU8.fill(0, resultPtr, resultPtr + resultBytes);

  if (maskBytes > 0) {
    for (let i = 0; i < maskCount; i++) {
      memI32[(maskPtr >> 2) + i * 2] = maskPoints[i][0];
      memI32[(maskPtr >> 2) + i * 2 + 1] = maskPoints[i][1];
    }
  }
  if (dispBytes > 0) {
    memU8.set(
      new Uint8Array(displayedColorsPacked.buffer, displayedColorsPacked.byteOffset, dispBytes),
      dispPtr,
    );
  }
  if (knownBytes > 0) {
    memU8.set(
      new Uint8Array(knownColorsPacked.buffer, knownColorsPacked.byteOffset, knownBytes),
      knownPtr,
    );
  }

  state.filterBitmapPixels(
    templatePtr,
    resultPtr,
    templateWidth,
    templateHeight,
    resultWidth,
    drawMultTemplate,
    drawMultResult,
    drawMultCenter,
    maskPtr,
    maskCount,
    dispPtr,
    displayedColorsPacked.length,
    knownPtr,
    knownColorsPacked.length,
    displayOther ? 1 : 0,
  );

  return new Uint8ClampedArray(memU8.buffer, resultPtr, resultBytes).slice();
};
