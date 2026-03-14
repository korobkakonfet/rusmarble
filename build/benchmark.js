import { performance } from 'node:perf_hooks';
import {
  buildMaskRowSpans,
  inspectSourceImagePalette,
  createPaletteStatsAccumulator,
  finalizePaletteStatsAccumulator,
  buildChunkSampleDataFromSource,
  encodeChunkSampleData,
  decodeChunkSampleBuffer,
  collectTemplateProgressFromSamples,
  mergeTemplateExampleReservoir,
  findNearestUnpaintedSamplePixel,
  renderSampleDataToImage,
} from '../src/templateChunkUtils.js';
import { colorpalette, rgbToMeta } from '../src/utils.js';

const TEMPLATE_TILE_SIZE = 1000;
const MAP_WORLD_WIDTH_PX = 2048 * TEMPLATE_TILE_SIZE;
const IMAGE_WIDTH = 1024;
const IMAGE_HEIGHT = 1024;
const CHUNK_SOURCE_X = 196;
const CHUNK_SOURCE_Y = 228;
const CHUNK_WIDTH = 360;
const CHUNK_HEIGHT = 280;
const TILE_X = 321;
const TILE_Y = 654;
const OFFSET_X = 137;
const OFFSET_Y = 183;
const EXAMPLE_LIMIT = 32;
const CROSS_DRAW_SIZE = 5;
const HOT_LOG_SIM_ITERATIONS = 50000;

function createRng(seed = 0x1badf00d) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function getBenchmarkPalette() {
  const unique = [];
  const seen = new Set();
  for (const color of colorpalette) {
    if (!Array.isArray(color?.rgb) || color.id === 0) continue;
    const key = color.rgb.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(color.rgb.slice(0, 3));
    if (unique.length >= 20) break;
  }
  return unique;
}

function buildSourceImageData() {
  const rng = createRng(0x5eed1234);
  const palette = getBenchmarkPalette();
  const data = new Uint8ClampedArray(IMAGE_WIDTH * IMAGE_HEIGHT * 4);
  for (let index = 0; index < IMAGE_WIDTH * IMAGE_HEIGHT; index++) {
    const offset = index * 4;
    const roll = rng();
    if (roll < 0.12) {
      data[offset + 3] = 0;
      continue;
    }
    if (roll < 0.15) {
      data[offset] = 222;
      data[offset + 1] = 250;
      data[offset + 2] = 206;
      data[offset + 3] = 255;
      continue;
    }
    const color = palette[Math.floor(rng() * palette.length)];
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = 255;
  }
  return data;
}

function buildTilePixels(sampleData) {
  const tilePixels = new Uint8ClampedArray(TEMPLATE_TILE_SIZE * TEMPLATE_TILE_SIZE * 4);
  for (let index = 0; index < tilePixels.length; index += 4) {
    tilePixels[index] = 24;
    tilePixels[index + 1] = 28;
    tilePixels[index + 2] = 36;
    tilePixels[index + 3] = 255;
  }

  for (let index = 0; index < sampleData.count; index++) {
    const pixelX = OFFSET_X + sampleData.x[index];
    const pixelY = OFFSET_Y + sampleData.y[index];
    if (pixelX < 0 || pixelX >= TEMPLATE_TILE_SIZE || pixelY < 0 || pixelY >= TEMPLATE_TILE_SIZE) continue;
    const tileIndex = (pixelY * TEMPLATE_TILE_SIZE + pixelX) * 4;
    const mode = index % 8;
    if (mode === 0) {
      tilePixels[tileIndex + 3] = 0;
      continue;
    }
    if (mode === 1) {
      tilePixels[tileIndex] = (sampleData.r[index] + 41) & 0xff;
      tilePixels[tileIndex + 1] = (sampleData.g[index] + 67) & 0xff;
      tilePixels[tileIndex + 2] = (sampleData.b[index] + 89) & 0xff;
      tilePixels[tileIndex + 3] = 255;
      continue;
    }
    if (mode === 2) {
      tilePixels[tileIndex] = Math.min(255, sampleData.r[index] + 1);
      tilePixels[tileIndex + 1] = Math.max(0, sampleData.g[index] - 1);
      tilePixels[tileIndex + 2] = Math.min(255, sampleData.b[index] + 2);
      tilePixels[tileIndex + 3] = 255;
      continue;
    }
    tilePixels[tileIndex] = sampleData.r[index];
    tilePixels[tileIndex + 1] = sampleData.g[index];
    tilePixels[tileIndex + 2] = sampleData.b[index];
    tilePixels[tileIndex + 3] = 255;
  }

  return tilePixels;
}

function buildDisplayedColorSet(sampleData) {
  const displayed = new Set();
  for (let index = 0; index < sampleData.count; index++) {
    const colorKey = `${sampleData.r[index]},${sampleData.g[index]},${sampleData.b[index]}`;
    if (rgbToMeta.has(colorKey)) {
      displayed.add(colorKey);
    }
  }
  return displayed;
}

function computeWrappedWorldDeltaX(currentWorldX, targetWorldX) {
  const delta = targetWorldX - currentWorldX;
  if (!Number.isFinite(delta)) return delta;
  const wrapped = ((delta % MAP_WORLD_WIDTH_PX) + MAP_WORLD_WIDTH_PX) % MAP_WORLD_WIDTH_PX;
  return wrapped > MAP_WORLD_WIDTH_PX / 2 ? wrapped - MAP_WORLD_WIDTH_PX : wrapped;
}

function getTilePixelDistanceSq(originPoint, rawCoords) {
  if (!originPoint || !Array.isArray(rawCoords) || rawCoords.length < 4) return Infinity;
  const targetWorldX = rawCoords[0] * TEMPLATE_TILE_SIZE + rawCoords[2];
  const targetWorldY = rawCoords[1] * TEMPLATE_TILE_SIZE + rawCoords[3];
  const dx = computeWrappedWorldDeltaX(originPoint.x, targetWorldX);
  const dy = targetWorldY - originPoint.y;
  return dx * dx + dy * dy;
}

function createReservoirExamples(sampleData, count = 512) {
  const examples = [];
  for (let index = 0; index < sampleData.count && examples.length < count; index++) {
    if (sampleData.a[index] < 64 || sampleData.flags[index] !== 0) continue;
    examples.push([
      [TILE_X, TILE_Y],
      [OFFSET_X + sampleData.x[index], OFFSET_Y + sampleData.y[index]],
    ]);
  }
  return examples;
}

function buildDefaultCrossMaskPoints(size) {
  const center = (size - 1) >> 1;
  const points = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onCross = x === center || y === center;
      const inBand = (
        x >= center - 1
        && x <= center + 1
        && y >= center - 1
        && y <= center + 1
      );
      if (onCross && inBand) {
        points.push([x, y]);
      }
    }
  }
  return points;
}

function renderSampleDataToImageSlow({
  sampleData,
  imageData,
  resultWidth,
  drawSize,
  maskPoints,
  includeDefaceCheckerboard = false,
}) {
  const data = imageData.data;
  for (let index = 0; index < sampleData.count; index++) {
    const alpha = sampleData.a[index];
    if (alpha < 1) continue;
    const baseX = sampleData.x[index] * drawSize;
    const baseY = sampleData.y[index] * drawSize;
    const isDeface = sampleData.flags[index] === 1;
    if (isDeface) {
      if (!includeDefaceCheckerboard) continue;
      for (let offsetY = 0; offsetY < drawSize; offsetY++) {
        for (let offsetX = 0; offsetX < drawSize; offsetX++) {
          const pixelIndex = ((baseY + offsetY) * resultWidth + (baseX + offsetX)) * 4;
          const checkerValue = ((offsetX + offsetY) % 2 === 0) ? 0 : 255;
          data[pixelIndex] = checkerValue;
          data[pixelIndex + 1] = checkerValue;
          data[pixelIndex + 2] = checkerValue;
          data[pixelIndex + 3] = 32;
        }
      }
      continue;
    }
    for (const [offsetX, offsetY] of maskPoints) {
      const pixelIndex = ((baseY + offsetY) * resultWidth + (baseX + offsetX)) * 4;
      data[pixelIndex] = sampleData.r[index];
      data[pixelIndex + 1] = sampleData.g[index];
      data[pixelIndex + 2] = sampleData.b[index];
      data[pixelIndex + 3] = alpha;
    }
  }
  return imageData;
}

function buildOverlayTransportSourceBuffer(width, height) {
  const rng = createRng(0x42424242);
  const buffer = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < buffer.length; index += 4) {
    buffer[index] = Math.floor(rng() * 256);
    buffer[index + 1] = Math.floor(rng() * 256);
    buffer[index + 2] = Math.floor(rng() * 256);
    buffer[index + 3] = 255;
  }
  return buffer;
}

function overlayTransportLegacySim(sourceBuffer) {
  const stagedBytes = sourceBuffer.slice();
  const decodedBytes = new Uint8ClampedArray(stagedBytes);
  const target = new Uint8ClampedArray(decodedBytes.length);
  target.set(decodedBytes);
  return target[0] + target[1] + target[2] + target[target.length - 1];
}

function overlayTransportDirectSim(sourceBuffer) {
  const target = new Uint8ClampedArray(sourceBuffer.length);
  target.set(sourceBuffer);
  return target[0] + target[1] + target[2] + target[target.length - 1];
}

function hotPathLoggingLegacySim() {
  let checksum = 0;
  for (let index = 0; index < HOT_LOG_SIM_ITERATIONS; index++) {
    const pixelX = index % 1000;
    const pixelY = (index * 7) % 1000;
    const drawSizeX = 100 + (index % 17);
    const drawSizeY = 100 + (index % 19);
    const logA = `Handling tile chunk 0123,0456,${String(pixelX).padStart(3, '0')},${String(pixelY).padStart(3, '0')}... ${index % 97} ms`;
    const logB = `Draw Size X: ${drawSizeX}\nDraw Size Y: ${drawSizeY}`;
    checksum += logA.length + logB.length;
  }
  return checksum;
}

function hotPathLoggingGuardedOffSim() {
  let checksum = 0;
  const enabled = false;
  for (let index = 0; index < HOT_LOG_SIM_ITERATIONS; index++) {
    if (enabled) {
      const pixelX = index % 1000;
      const pixelY = (index * 7) % 1000;
      const drawSizeX = 100 + (index % 17);
      const drawSizeY = 100 + (index % 19);
      const logA = `Handling tile chunk 0123,0456,${String(pixelX).padStart(3, '0')},${String(pixelY).padStart(3, '0')}... ${index % 97} ms`;
      const logB = `Draw Size X: ${drawSizeX}\nDraw Size Y: ${drawSizeY}`;
      checksum += logA.length + logB.length;
    }
    checksum += index & 1;
  }
  return checksum;
}

function makeReservoirRng(seed) {
  const rng = createRng(seed);
  return () => rng();
}

function formatMs(value) {
  return `${value.toFixed(3)} ms`;
}

function formatOps(totalMs, iterations) {
  if (totalMs <= 0) return 'inf';
  return (iterations * 1000 / totalMs).toFixed(1);
}

function summarizeTimes(samples) {
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  const avgMs = totalMs / samples.length;
  return {
    totalMs,
    avgMs,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
  };
}

function runBenchmark(name, iterations, fn, warmup = 2) {
  let checksum = 0;
  for (let index = 0; index < warmup; index++) {
    checksum = (checksum + Number(fn()) + index) >>> 0;
  }
  const samples = [];
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    checksum = (checksum + Number(fn()) + index) >>> 0;
    samples.push(performance.now() - start);
  }
  return {
    name,
    iterations,
    checksum,
    ...summarizeTimes(samples),
  };
}

function printResults(results, fixture) {
  console.log('Template Performance Benchmark');
  console.log(`Fixture: source ${IMAGE_WIDTH}x${IMAGE_HEIGHT}, chunk ${CHUNK_WIDTH}x${CHUNK_HEIGHT}, sampled pixels ${fixture.sampleData.count}`);
  console.log('');
  const header = [
    'Benchmark'.padEnd(36),
    'Iterations'.padStart(10),
    'Average'.padStart(14),
    'Min'.padStart(14),
    'Max'.padStart(14),
    'Ops/s'.padStart(12),
    'Checksum'.padStart(12),
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const result of results) {
    console.log([
      result.name.padEnd(36),
      String(result.iterations).padStart(10),
      formatMs(result.avgMs).padStart(14),
      formatMs(result.minMs).padStart(14),
      formatMs(result.maxMs).padStart(14),
      formatOps(result.totalMs, result.iterations).padStart(12),
      String(result.checksum >>> 0).padStart(12),
    ].join(' '));
  }
}

function main() {
  const sourceData = buildSourceImageData();
  const sampleData = buildChunkSampleDataFromSource(
    sourceData,
    IMAGE_WIDTH,
    CHUNK_SOURCE_X,
    CHUNK_SOURCE_Y,
    CHUNK_WIDTH,
    CHUNK_HEIGHT
  );
  const encodedSample = encodeChunkSampleData(sampleData);
  const tilePixels = buildTilePixels(sampleData);
  const displayedColorSet = buildDisplayedColorSet(sampleData);
  const tileCoords = [TILE_X, TILE_Y];
  const examplePool = createReservoirExamples(sampleData);
  const crossMaskPoints = buildDefaultCrossMaskPoints(CROSS_DRAW_SIZE);
  const crossMaskRowSpans = buildMaskRowSpans(crossMaskPoints, CROSS_DRAW_SIZE);
  const crossResultWidth = sampleData.width * CROSS_DRAW_SIZE;
  const crossResultHeight = sampleData.height * CROSS_DRAW_SIZE;
  const overlayTransportSource = buildOverlayTransportSourceBuffer(crossResultWidth, crossResultHeight);
  const originPoint = {
    x: TILE_X * TEMPLATE_TILE_SIZE + 500,
    y: TILE_Y * TEMPLATE_TILE_SIZE + 500,
  };
  const excludedCoordsKey = `${TILE_X},${TILE_Y},500,500`;

  const results = [
    runBenchmark('inspectSourceImagePalette', 8, () => {
      const result = inspectSourceImagePalette(sourceData, IMAGE_WIDTH, IMAGE_HEIGHT);
      return result.required + result.deface + result.paletteMap.size;
    }),
    runBenchmark('buildChunkSampleDataFromSource', 20, () => {
      const result = buildChunkSampleDataFromSource(
        sourceData,
        IMAGE_WIDTH,
        CHUNK_SOURCE_X,
        CHUNK_SOURCE_Y,
        CHUNK_WIDTH,
        CHUNK_HEIGHT
      );
      return result.count + result.width + result.height;
    }),
    runBenchmark('buildChunkSampleDataFromSource+stats', 20, () => {
      const accumulator = createPaletteStatsAccumulator();
      const result = buildChunkSampleDataFromSource(
        sourceData,
        IMAGE_WIDTH,
        CHUNK_SOURCE_X,
        CHUNK_SOURCE_Y,
        CHUNK_WIDTH,
        CHUNK_HEIGHT,
        accumulator
      );
      const stats = finalizePaletteStatsAccumulator(accumulator);
      return result.count + stats.required + stats.deface + stats.paletteMap.size;
    }),
    runBenchmark('encodeChunkSampleData', 24, () => {
      const result = encodeChunkSampleData(sampleData);
      return result.length;
    }),
    runBenchmark('decodeChunkSampleBuffer', 24, () => {
      const result = decodeChunkSampleBuffer(encodedSample);
      return (result?.count || 0) + (result?.width || 0) + (result?.height || 0);
    }),
    runBenchmark('collectTemplateProgressFromSamples', 16, () => {
      const paletteStats = {};
      const templateStats = {};
      const errorData = new Uint8ClampedArray(sampleData.width * sampleData.height * 4);
      const result = collectTemplateProgressFromSamples({
        sampleData,
        tilePixels,
        tileSize: TEMPLATE_TILE_SIZE,
        offsetX: OFFSET_X,
        offsetY: OFFSET_Y,
        tileCoords,
        templateEnabled: true,
        templateKey: 'bench-template',
        paletteStats,
        templateStats,
        exampleMax: EXAMPLE_LIMIT,
        errorMapOnlyEnabledColors: true,
        displayedColors: displayedColorSet,
        errorData,
        errorWidth: sampleData.width,
        randomFn: makeReservoirRng(0xabc00001),
      });
      const exampleCount = Object.values(paletteStats).reduce(
        (sum, entry) => sum + (entry?.examplesEnabled?.length || 0),
        0
      );
      return result.paintedCount + result.wrongCount + result.requiredCount + exampleCount + Object.keys(templateStats).length;
    }),
    runBenchmark('mergeTemplateExampleReservoir', 2000, () => {
      const target = { examplesEnabled: [] };
      mergeTemplateExampleReservoir(target, examplePool, EXAMPLE_LIMIT, makeReservoirRng(0xabc00002));
      let checksum = target.examplesEnabled.length;
      for (const example of target.examplesEnabled) {
        checksum += example[1][0] + example[1][1];
      }
      return checksum;
    }),
    runBenchmark('findNearestUnpaintedSamplePixel', 24, () => {
      const result = findNearestUnpaintedSamplePixel({
        sampleData,
        liveTilePixels: tilePixels,
        tileSize: TEMPLATE_TILE_SIZE,
        offsetX: OFFSET_X,
        offsetY: OFFSET_Y,
        tileX: TILE_X,
        tileY: TILE_Y,
        originPoint,
        displayedColorSet,
        excludedCoordsKey,
        templateName: 'Benchmark Template',
        distanceSqFn: getTilePixelDistanceSq,
      });
      return (result?.distanceSq || 0) + (result?.coords?.[2] || 0) + (result?.coords?.[3] || 0);
    }),
    runBenchmark('renderSampleDataToImageSlow', 10, () => {
      const image = { data: new Uint8ClampedArray(crossResultWidth * crossResultHeight * 4) };
      renderSampleDataToImageSlow({
        sampleData,
        imageData: image,
        resultWidth: crossResultWidth,
        drawSize: CROSS_DRAW_SIZE,
        maskPoints: crossMaskPoints,
        includeDefaceCheckerboard: true,
      });
      return image.data[0] + image.data[1] + image.data[2] + image.data[3] + image.data[image.data.length - 1];
    }),
    runBenchmark('renderSampleDataToImage', 10, () => {
      const image = { data: new Uint8ClampedArray(crossResultWidth * crossResultHeight * 4) };
      renderSampleDataToImage({
        sampleData,
        imageData: image,
        resultWidth: crossResultWidth,
        drawSize: CROSS_DRAW_SIZE,
        maskPoints: crossMaskPoints,
        maskRowSpans: crossMaskRowSpans,
        includeDefaceCheckerboard: true,
      });
      return image.data[0] + image.data[1] + image.data[2] + image.data[3] + image.data[image.data.length - 1];
    }),
    runBenchmark('overlayTransportLegacySim', 10, () => (
      overlayTransportLegacySim(overlayTransportSource)
    )),
    runBenchmark('overlayTransportDirectSim', 10, () => (
      overlayTransportDirectSim(overlayTransportSource)
    )),
    runBenchmark('hotPathLoggingLegacySim', 12, () => (
      hotPathLoggingLegacySim()
    )),
    runBenchmark('hotPathLoggingGuardedOffSim', 12, () => (
      hotPathLoggingGuardedOffSim()
    )),
  ];

  printResults(results, { sampleData });
}

main();
