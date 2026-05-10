import { collectProgressWasmBytes } from './generated/collectProgressWasmBytes.js';

const WASM_PAGE_BYTES = 64 * 1024;

let wasmState = null;

if (
  typeof WebAssembly !== 'undefined'
  && collectProgressWasmBytes instanceof Uint8Array
  && collectProgressWasmBytes.length > 0
) {
  WebAssembly.instantiate(collectProgressWasmBytes, {}).then(({ instance }) => {
    const collectProgress = instance.exports?.collect_progress;
    const memory = instance.exports?.memory;
    if (memory instanceof WebAssembly.Memory && typeof collectProgress === 'function') {
      wasmState = { memory, collectProgress };
    }
  }).catch(() => {});
}

const getWasmState = () => wasmState;

const align = (value, alignment) => ((value + alignment - 1) & ~(alignment - 1));
const ensureMemory = (memory, requiredBytes) => {
  const current = memory.buffer.byteLength;
  if (requiredBytes > current) {
    memory.grow(Math.ceil((requiredBytes - current) / WASM_PAGE_BYTES));
  }
};

export const isCollectProgressWasmAvailable = () => getWasmState() !== null;

export const collectProgressWithWasm = ({
  sampleData,
  tilePixels,
  tileSize,
  offsetX,
  offsetY,
  palettePackedColors,   // Uint32Array of packed RGB for each palette color
  paletteRgb,            // { r: Uint8Array, g: Uint8Array, b: Uint8Array }
  paletteCount,          // number of known paintable colors (palettePackedColors.length)
  colorMatchDelta,
  templateEnabled,
  errorDataPtr0 = null,  // Uint8ClampedArray for error map, or null
  errorWidth = 0,
  errorMapOnlyEnabled = false,
  displayedColorsPacked = null, // Uint32Array of allowed packed colors for error filtering
  displayOther = true,
} = {}) => {
  const state = getWasmState();
  if (!state) return null;
  if (
    !sampleData
    || !(tilePixels instanceof Uint8ClampedArray)
    || !(sampleData.x instanceof Uint16Array)
    || !(sampleData.y instanceof Uint16Array)
    || !(sampleData.r instanceof Uint8Array)
    || !(sampleData.g instanceof Uint8Array)
    || !(sampleData.b instanceof Uint8Array)
    || !(sampleData.a instanceof Uint8Array)
    || !(sampleData.flags instanceof Uint8Array)
    || !(palettePackedColors instanceof Uint32Array)
    || !paletteRgb
  ) {
    return null;
  }

  const sampleCount = sampleData.count | 0;
  const slotCount = paletteCount + 1; // +1 for OTHER slot
  const resultBytes = 12 + slotCount * 12; // 3 totals + 3 arrays of slotCount i32s
  const errorDataBytes = errorDataPtr0 instanceof Uint8ClampedArray ? errorDataPtr0.byteLength : 0;
  const dispColorsBytes = displayedColorsPacked instanceof Uint32Array ? displayedColorsPacked.byteLength : 0;

  let cursor = 0;
  const alloc = (bytes, alignment = 1) => {
    cursor = align(cursor, alignment);
    const ptr = cursor;
    cursor += bytes;
    return ptr;
  };

  const xPtr = alloc(sampleData.x.byteLength, 2);
  const yPtr = alloc(sampleData.y.byteLength, 2);
  const rPtr = alloc(sampleData.r.byteLength);
  const gPtr = alloc(sampleData.g.byteLength);
  const bPtr = alloc(sampleData.b.byteLength);
  const aPtr = alloc(sampleData.a.byteLength);
  const flagsPtr = alloc(sampleData.flags.byteLength);
  const liveTilePtr = alloc(tilePixels.byteLength, 4);
  const palPackedPtr = alloc(palettePackedColors.byteLength, 4);
  const palRPtr = alloc(paletteCount);
  const palGPtr = alloc(paletteCount);
  const palBPtr = alloc(paletteCount);
  const dispColorsPtr = dispColorsBytes > 0 ? alloc(dispColorsBytes, 4) : 0;
  const errorDataWasmPtr = errorDataBytes > 0 ? alloc(errorDataBytes, 4) : 0;
  const resultPtr = alloc(resultBytes, 4);
  const missingMaskPtr = alloc(sampleCount);

  ensureMemory(state.memory, cursor);

  const memU8 = new Uint8Array(state.memory.buffer);
  const memI32 = new Int32Array(state.memory.buffer);

  memU8.set(new Uint8Array(sampleData.x.buffer, sampleData.x.byteOffset, sampleData.x.byteLength), xPtr);
  memU8.set(new Uint8Array(sampleData.y.buffer, sampleData.y.byteOffset, sampleData.y.byteLength), yPtr);
  memU8.set(sampleData.r, rPtr);
  memU8.set(sampleData.g, gPtr);
  memU8.set(sampleData.b, bPtr);
  memU8.set(sampleData.a, aPtr);
  memU8.set(sampleData.flags, flagsPtr);
  memU8.set(tilePixels, liveTilePtr);
  memU8.set(new Uint8Array(palettePackedColors.buffer, palettePackedColors.byteOffset, palettePackedColors.byteLength), palPackedPtr);
  memU8.set(paletteRgb.r, palRPtr);
  memU8.set(paletteRgb.g, palGPtr);
  memU8.set(paletteRgb.b, palBPtr);
  if (dispColorsBytes > 0) {
    memU8.set(
      new Uint8Array(displayedColorsPacked.buffer, displayedColorsPacked.byteOffset, displayedColorsPacked.byteLength),
      dispColorsPtr,
    );
  }
  // pre-zero result area and missingMask
  memU8.fill(0, resultPtr, resultPtr + resultBytes);
  memU8.fill(0, missingMaskPtr, missingMaskPtr + sampleCount);

  state.collectProgress(
    sampleCount,
    xPtr, yPtr, rPtr, gPtr, bPtr, aPtr, flagsPtr,
    liveTilePtr, tileSize, offsetX, offsetY,
    palPackedPtr, palRPtr, palGPtr, palBPtr, paletteCount,
    colorMatchDelta,
    templateEnabled ? 1 : 0,
    errorDataWasmPtr,
    errorWidth,
    errorMapOnlyEnabled ? 1 : 0,
    dispColorsPtr,
    displayedColorsPacked instanceof Uint32Array ? displayedColorsPacked.length : 0,
    displayOther ? 1 : 0,
    resultPtr,
    missingMaskPtr,
  );

  const r32base = resultPtr >> 2;
  const paintedCount = memI32[r32base];
  const wrongCount = memI32[r32base + 1];
  const requiredCount = memI32[r32base + 2];

  const paintedByIndex = new Int32Array(memI32.buffer, resultPtr + 12, slotCount);
  const paintedAndEnabledByIndex = new Int32Array(memI32.buffer, resultPtr + 12 + slotCount * 4, slotCount);
  const missingByIndex = new Int32Array(memI32.buffer, resultPtr + 12 + slotCount * 8, slotCount);
  const missingMask = memU8.slice(missingMaskPtr, missingMaskPtr + sampleCount);

  // Copy error map back out if needed
  if (errorDataPtr0 instanceof Uint8ClampedArray && errorDataWasmPtr !== 0) {
    errorDataPtr0.set(new Uint8ClampedArray(memU8.buffer, errorDataWasmPtr, errorDataBytes));
  }

  return {
    paintedCount,
    wrongCount,
    requiredCount,
    paintedByIndex: Int32Array.from(paintedByIndex),
    paintedAndEnabledByIndex: Int32Array.from(paintedAndEnabledByIndex),
    missingByIndex: Int32Array.from(missingByIndex),
    missingMask,
  };
};
