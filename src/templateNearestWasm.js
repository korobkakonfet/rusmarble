import { findNearestUnpaintedWasmBytes } from './generated/findNearestUnpaintedWasmBytes.js';

const WASM_PAGE_BYTES = 64 * 1024;
const WASM_RESULT_BYTES = 24;
const MAP_WORLD_WIDTH_PX = 2048 * 1000;

let wasmNearestState = null;

if (
  typeof WebAssembly !== 'undefined'
  && findNearestUnpaintedWasmBytes instanceof Uint8Array
  && findNearestUnpaintedWasmBytes.length > 0
) {
  WebAssembly.instantiate(findNearestUnpaintedWasmBytes, {}).then(({ instance }) => {
    const findNearest = instance.exports?.find_nearest;
    const memory = instance.exports?.memory;
    if (memory instanceof WebAssembly.Memory && typeof findNearest === 'function') {
      wasmNearestState = { memory, findNearest };
    }
  }).catch(() => {});
}

const getNearestWasmState = () => wasmNearestState;

const align = (value, alignment) => ((value + alignment - 1) & ~(alignment - 1));
const ensureMemoryCapacity = (memory, requiredBytes) => {
  const currentBytes = memory.buffer.byteLength;
  if (requiredBytes <= currentBytes) return;
  const growPages = Math.ceil((requiredBytes - currentBytes) / WASM_PAGE_BYTES);
  memory.grow(growPages);
};

export function isTemplateNearestWasmAvailable() {
  return getNearestWasmState() !== null;
}

export function findNearestUnpaintedPixelWithWasm({
  sampleData,
  liveTilePixels,
  tileSize,
  offsetX,
  offsetY,
  tileX,
  tileY,
  originPoint,
  excludedCoords = null,
  allowedPackedColors,
  colorMatchDelta,
} = {}) {
  const state = getNearestWasmState();
  if (!state) return null;
  if (
    !sampleData
    || !(liveTilePixels instanceof Uint8ClampedArray)
    || !(sampleData.x instanceof Uint16Array)
    || !(sampleData.y instanceof Uint16Array)
    || !(sampleData.r instanceof Uint8Array)
    || !(sampleData.g instanceof Uint8Array)
    || !(sampleData.b instanceof Uint8Array)
    || !(sampleData.a instanceof Uint8Array)
    || !(sampleData.flags instanceof Uint8Array)
    || !(allowedPackedColors instanceof Uint32Array)
  ) {
    return null;
  }

  let cursor = 0;
  const alloc = (bytes, alignment = 1) => {
    cursor = align(cursor, alignment);
    const ptr = cursor;
    cursor += bytes;
    return ptr;
  };

  const sampleCount = sampleData.count | 0;
  const xPtr = alloc(sampleData.x.byteLength, 2);
  const yPtr = alloc(sampleData.y.byteLength, 2);
  const rPtr = alloc(sampleData.r.byteLength);
  const gPtr = alloc(sampleData.g.byteLength);
  const bPtr = alloc(sampleData.b.byteLength);
  const aPtr = alloc(sampleData.a.byteLength);
  const flagsPtr = alloc(sampleData.flags.byteLength);
  const liveTilePtr = alloc(liveTilePixels.byteLength);
  const allowedColorPtr = alloc(allowedPackedColors.byteLength, 4);
  const resultPtr = alloc(WASM_RESULT_BYTES, 8);

  ensureMemoryCapacity(state.memory, cursor);
  const memoryU8 = new Uint8Array(state.memory.buffer);
  const memoryI32 = new Int32Array(state.memory.buffer);
  const memoryF64 = new Float64Array(state.memory.buffer);

  memoryU8.set(new Uint8Array(sampleData.x.buffer, sampleData.x.byteOffset, sampleData.x.byteLength), xPtr);
  memoryU8.set(new Uint8Array(sampleData.y.buffer, sampleData.y.byteOffset, sampleData.y.byteLength), yPtr);
  memoryU8.set(sampleData.r, rPtr);
  memoryU8.set(sampleData.g, gPtr);
  memoryU8.set(sampleData.b, bPtr);
  memoryU8.set(sampleData.a, aPtr);
  memoryU8.set(sampleData.flags, flagsPtr);
  memoryU8.set(liveTilePixels, liveTilePtr);
  memoryU8.set(new Uint8Array(allowedPackedColors.buffer, allowedPackedColors.byteOffset, allowedPackedColors.byteLength), allowedColorPtr);

  state.findNearest(
    sampleCount,
    xPtr,
    yPtr,
    rPtr,
    gPtr,
    bPtr,
    aPtr,
    flagsPtr,
    liveTilePtr,
    tileSize,
    offsetX,
    offsetY,
    Math.trunc(originPoint?.x || 0),
    Math.trunc(originPoint?.y || 0),
    tileX,
    tileY,
    MAP_WORLD_WIDTH_PX,
    colorMatchDelta,
    Number.isFinite(excludedCoords?.[2]) ? excludedCoords[2] : -1,
    Number.isFinite(excludedCoords?.[3]) ? excludedCoords[3] : -1,
    allowedColorPtr,
    allowedPackedColors.length,
    resultPtr
  );

  const found = memoryI32[resultPtr >> 2];
  if (!found) return null;
  return {
    pixelX: memoryI32[(resultPtr + 4) >> 2],
    pixelY: memoryI32[(resultPtr + 8) >> 2],
    distanceSq: memoryF64[(resultPtr + 16) >> 3],
  };
}
