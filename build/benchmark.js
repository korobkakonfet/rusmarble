import { performance } from 'node:perf_hooks';
import {
  buildMaskRowSpans,
  inspectSourceImagePalette,
  getPaletteKeyForRgb,
  createPaletteStatsAccumulator,
  finalizePaletteStatsAccumulator,
  buildChunkSampleDataFromSource,
  encodeChunkSampleBytes,
  encodeChunkSampleData,
  decodeChunkSampleBuffer,
  collectTemplateProgressFromSamples,
  addTemplateExampleToReservoir,
  mergeTemplateExampleReservoir,
  findNearestUnpaintedSamplePixel,
  renderSampleDataToImage,
} from '../src/templateChunkUtils.js';
import { convertImageDataToWplacePalette } from '../src/Template.js';
import { colorpalette, rgbToMeta, uint8ToBase64, base64ToUint8 } from '../src/utils.js';
import { createTemplateSampleExtractorWithWasm, isTemplateSampleExtractWasmAvailable } from '../src/templateSampleExtractWasm.js';
import { filterBitmapPixelsWithWasm, isFilterBitmapPixelsWasmAvailable } from '../src/templateFilterWasm.js';

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
const TEMPLATE_OTHER_COLOR_KEY = 'other';
const IMAGE_DATA_LITTLE_ENDIAN = (() => {
  const buffer = new ArrayBuffer(4);
  new Uint32Array(buffer)[0] = 0x0a0b0c0d;
  return new Uint8Array(buffer)[0] === 0x0d;
})();
const KNOWN_PALETTE_PACKED_COLORS = (() => {
  const packed = new Set();
  for (const colorKey of rgbToMeta.keys()) {
    if (colorKey === TEMPLATE_OTHER_COLOR_KEY) continue;
    const colorPacked = parseRgbKeyToPackedInt(colorKey);
    if (colorPacked !== null) {
      packed.add(colorPacked);
    }
  }
  return packed;
})();
const WASM_NEAREST_WAT = `
(module
  (memory (export "memory") 256)
  (func (export "find_nearest")
    (param $sampleCount i32)
    (param $xPtr i32)
    (param $yPtr i32)
    (param $rPtr i32)
    (param $gPtr i32)
    (param $bPtr i32)
    (param $aPtr i32)
    (param $flagsPtr i32)
    (param $liveTilePtr i32)
    (param $tileSize i32)
    (param $offsetX i32)
    (param $offsetY i32)
    (param $originWorldX i32)
    (param $originWorldY i32)
    (param $tileX i32)
    (param $tileY i32)
    (param $worldWidth i32)
    (param $colorMatchDelta i32)
    (param $excludedPixelX i32)
    (param $excludedPixelY i32)
    (param $allowedColorPtr i32)
    (param $allowedColorCount i32)
    (param $resultPtr i32)
    (local $index i32)
    (local $pixelX i32)
    (local $pixelY i32)
    (local $templateR i32)
    (local $templateG i32)
    (local $templateB i32)
    (local $liveR i32)
    (local $liveG i32)
    (local $liveB i32)
    (local $liveA i32)
    (local $tileIndex i32)
    (local $packedTemplateColor i32)
    (local $allowedIndex i32)
    (local $isAllowedColor i32)
    (local $tempDiff i32)
    (local $deltaR i32)
    (local $deltaG i32)
    (local $deltaB i32)
    (local $targetWorldX i32)
    (local $targetWorldY i32)
    (local $wrappedDx i32)
    (local $dy i32)
    (local $distance f64)
    (local $bestDistance f64)
    (local $bestPixelX i32)
    (local $bestPixelY i32)
    (local $found i32)

    (local.set $index (i32.const 0))
    (local.set $bestDistance (f64.const 1e300))
    (local.set $bestPixelX (i32.const 0))
    (local.set $bestPixelY (i32.const 0))
    (local.set $found (i32.const 0))

    (block $scanEnd
      (loop $scanLoop
        (br_if $scanEnd (i32.ge_u (local.get $index) (local.get $sampleCount)))
        (block $scanContinue

        ;; Skip transparent/deface pixels.
        (br_if $scanContinue
          (i32.lt_u
            (i32.load8_u (i32.add (local.get $aPtr) (local.get $index)))
            (i32.const 64)
          )
        )
        (br_if $scanContinue
          (i32.ne
            (i32.and
              (i32.load8_u (i32.add (local.get $flagsPtr) (local.get $index)))
              (i32.const 1)
            )
            (i32.const 0)
          )
        )

        ;; pixelX = offsetX + x[index], pixelY = offsetY + y[index]
        (local.set $pixelX
          (i32.add
            (local.get $offsetX)
            (i32.load16_u
              (i32.add
                (local.get $xPtr)
                (i32.shl (local.get $index) (i32.const 1))
              )
            )
          )
        )
        (local.set $pixelY
          (i32.add
            (local.get $offsetY)
            (i32.load16_u
              (i32.add
                (local.get $yPtr)
                (i32.shl (local.get $index) (i32.const 1))
              )
            )
          )
        )

        ;; Bounds check.
        (br_if $scanContinue
          (i32.or
            (i32.lt_s (local.get $pixelX) (i32.const 0))
            (i32.or
              (i32.ge_s (local.get $pixelX) (local.get $tileSize))
              (i32.or
                (i32.lt_s (local.get $pixelY) (i32.const 0))
                (i32.ge_s (local.get $pixelY) (local.get $tileSize))
              )
            )
          )
        )

        ;; Load template color.
        (local.set $templateR (i32.load8_u (i32.add (local.get $rPtr) (local.get $index))))
        (local.set $templateG (i32.load8_u (i32.add (local.get $gPtr) (local.get $index))))
        (local.set $templateB (i32.load8_u (i32.add (local.get $bPtr) (local.get $index))))

        ;; packedTemplateColor = (r << 16) | (g << 8) | b
        (local.set $packedTemplateColor
          (i32.or
            (i32.or
              (i32.shl (local.get $templateR) (i32.const 16))
              (i32.shl (local.get $templateG) (i32.const 8))
            )
            (local.get $templateB)
          )
        )

        ;; Allowed color lookup (small linear scan).
        (local.set $isAllowedColor (i32.const 0))
        (local.set $allowedIndex (i32.const 0))
        (block $allowedEnd
          (loop $allowedLoop
            (br_if $allowedEnd (i32.ge_u (local.get $allowedIndex) (local.get $allowedColorCount)))
            (if
              (i32.eq
                (i32.load
                  (i32.add
                    (local.get $allowedColorPtr)
                    (i32.shl (local.get $allowedIndex) (i32.const 2))
                  )
                )
                (local.get $packedTemplateColor)
              )
              (then
                (local.set $isAllowedColor (i32.const 1))
                (br $allowedEnd)
              )
            )
            (local.set $allowedIndex (i32.add (local.get $allowedIndex) (i32.const 1)))
            (br $allowedLoop)
          )
        )
        (br_if $scanContinue (i32.eqz (local.get $isAllowedColor)))

        ;; Live tile pixel load.
        (local.set $tileIndex
          (i32.add
            (local.get $liveTilePtr)
            (i32.shl
              (i32.add
                (i32.mul (local.get $pixelY) (local.get $tileSize))
                (local.get $pixelX)
              )
              (i32.const 2)
            )
          )
        )
        (local.set $liveA (i32.load8_u (i32.add (local.get $tileIndex) (i32.const 3))))
        (local.set $liveR (i32.load8_u (local.get $tileIndex)))
        (local.set $liveG (i32.load8_u (i32.add (local.get $tileIndex) (i32.const 1))))
        (local.set $liveB (i32.load8_u (i32.add (local.get $tileIndex) (i32.const 2))))

        ;; Skip painted pixels (exact match or close match).
        (if
          (i32.ge_u (local.get $liveA) (i32.const 64))
          (then
            (if
              (i32.and
                (i32.and
                  (i32.eq (local.get $liveR) (local.get $templateR))
                  (i32.eq (local.get $liveG) (local.get $templateG))
                )
                (i32.eq (local.get $liveB) (local.get $templateB))
              )
              (then (br $scanContinue))
            )

            (local.set $tempDiff (i32.sub (local.get $liveR) (local.get $templateR)))
            (if
              (i32.lt_s (local.get $tempDiff) (i32.const 0))
              (then (local.set $tempDiff (i32.sub (i32.const 0) (local.get $tempDiff))))
            )
            (local.set $deltaR (local.get $tempDiff))

            (local.set $tempDiff (i32.sub (local.get $liveG) (local.get $templateG)))
            (if
              (i32.lt_s (local.get $tempDiff) (i32.const 0))
              (then (local.set $tempDiff (i32.sub (i32.const 0) (local.get $tempDiff))))
            )
            (local.set $deltaG (local.get $tempDiff))

            (local.set $tempDiff (i32.sub (local.get $liveB) (local.get $templateB)))
            (if
              (i32.lt_s (local.get $tempDiff) (i32.const 0))
              (then (local.set $tempDiff (i32.sub (i32.const 0) (local.get $tempDiff))))
            )
            (local.set $deltaB (local.get $tempDiff))

            (if
              (i32.and
                (i32.and
                  (i32.le_u (local.get $deltaR) (local.get $colorMatchDelta))
                  (i32.le_u (local.get $deltaG) (local.get $colorMatchDelta))
                )
                (i32.le_u (local.get $deltaB) (local.get $colorMatchDelta))
              )
              (then (br $scanContinue))
            )
          )
        )

        ;; Excluded coords check (same tile implied by invocation).
        (br_if $scanContinue
          (i32.and
            (i32.eq (local.get $pixelX) (local.get $excludedPixelX))
            (i32.eq (local.get $pixelY) (local.get $excludedPixelY))
          )
        )

        ;; targetWorldX/Y
        (local.set $targetWorldX
          (i32.add
            (i32.mul (local.get $tileX) (local.get $tileSize))
            (local.get $pixelX)
          )
        )
        (local.set $targetWorldY
          (i32.add
            (i32.mul (local.get $tileY) (local.get $tileSize))
            (local.get $pixelY)
          )
        )

        ;; wrappedDx = ((dx % worldWidth) + worldWidth) % worldWidth
        (local.set $wrappedDx
          (i32.sub (local.get $targetWorldX) (local.get $originWorldX))
        )
        (local.set $wrappedDx
          (i32.rem_s
            (i32.add
              (i32.rem_s (local.get $wrappedDx) (local.get $worldWidth))
              (local.get $worldWidth)
            )
            (local.get $worldWidth)
          )
        )
        (if
          (i32.gt_s
            (local.get $wrappedDx)
            (i32.div_s (local.get $worldWidth) (i32.const 2))
          )
          (then
            (local.set $wrappedDx
              (i32.sub (local.get $wrappedDx) (local.get $worldWidth))
            )
          )
        )
        (local.set $dy (i32.sub (local.get $targetWorldY) (local.get $originWorldY)))

        ;; distance = wrappedDx^2 + dy^2
        (local.set $distance
          (f64.add
            (f64.mul
              (f64.convert_i32_s (local.get $wrappedDx))
              (f64.convert_i32_s (local.get $wrappedDx))
            )
            (f64.mul
              (f64.convert_i32_s (local.get $dy))
              (f64.convert_i32_s (local.get $dy))
            )
          )
        )

        (if
          (f64.lt (local.get $distance) (local.get $bestDistance))
          (then
            (local.set $bestDistance (local.get $distance))
            (local.set $bestPixelX (local.get $pixelX))
            (local.set $bestPixelY (local.get $pixelY))
            (local.set $found (i32.const 1))
          )
        )
        )
        (local.set $index (i32.add (local.get $index) (i32.const 1)))
        (br $scanLoop)
      )
    )

    ;; result layout:
    ;; 0: found (i32)
    ;; 4: bestPixelX (i32)
    ;; 8: bestPixelY (i32)
    ;; 16: bestDistance (f64)
    (i32.store (local.get $resultPtr) (local.get $found))
    (i32.store (i32.add (local.get $resultPtr) (i32.const 4)) (local.get $bestPixelX))
    (i32.store (i32.add (local.get $resultPtr) (i32.const 8)) (local.get $bestPixelY))
    (f64.store (i32.add (local.get $resultPtr) (i32.const 16)) (local.get $bestDistance))
  )
)
`;

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

function pickNonPaletteColor(rng) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const red = Math.floor(rng() * 256);
    const green = Math.floor(rng() * 256);
    const blue = Math.floor(rng() * 256);
    if (!rgbToMeta.has(`${red},${green},${blue}`)) {
      return [red, green, blue];
    }
  }
  return [1, 2, 3];
}

function buildNonPaletteSourceImageData() {
  const rng = createRng(0x5eed5678);
  const palette = getBenchmarkPalette();
  const data = new Uint8ClampedArray(IMAGE_WIDTH * IMAGE_HEIGHT * 4);
  for (let index = 0; index < IMAGE_WIDTH * IMAGE_HEIGHT; index++) {
    const offset = index * 4;
    const roll = rng();
    if (roll < 0.08) {
      data[offset + 3] = 0;
      continue;
    }
    if (roll < 0.1) {
      data[offset] = 222;
      data[offset + 1] = 250;
      data[offset + 2] = 206;
      data[offset + 3] = 255;
      continue;
    }
    if (roll < 0.3) {
      const color = palette[Math.floor(rng() * palette.length)];
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
      continue;
    }
    const [red, green, blue] = pickNonPaletteColor(rng);
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  return data;
}

function cloneImageDataFixture(sourceData, width, height) {
  return {
    data: new Uint8ClampedArray(sourceData),
    width,
    height,
  };
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

function buildDisplayedColorPackedContext(displayedColorSet) {
  const displayedColorPackedSet = new Set();
  let displayOtherColor = false;
  for (const colorKey of displayedColorSet) {
    if (colorKey === TEMPLATE_OTHER_COLOR_KEY) {
      displayOtherColor = true;
      continue;
    }
    const packedColor = parseRgbKeyToPackedInt(colorKey);
    if (packedColor !== null) {
      displayedColorPackedSet.add(packedColor);
    }
  }
  return { displayedColorPackedSet, displayOtherColor };
}

function buildFullMaskPoints(size) {
  const points = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      points.push([x, y]);
    }
  }
  return points;
}

function pickUnknownRgbColor() {
  for (let red = 0; red < 256; red += 17) {
    for (let green = 0; green < 256; green += 23) {
      for (let blue = 0; blue < 256; blue += 31) {
        const colorKey = `${red},${green},${blue}`;
        if (!rgbToMeta.has(colorKey)) {
          return [red, green, blue];
        }
      }
    }
  }
  return [1, 2, 3];
}

function buildTemplateColorFilterFixture(sampleData, {
  drawMultTemplate = 3,
  drawMultResult = 7,
} = {}) {
  const templateWidth = Math.max(1, sampleData.width * drawMultTemplate);
  const templateHeight = Math.max(1, sampleData.height * drawMultTemplate);
  const templateData = new Uint8ClampedArray(templateWidth * templateHeight * 4);
  const drawMultCenterTemplate = (drawMultTemplate - 1) >> 1;
  const unknownRgb = pickUnknownRgbColor();
  for (let index = 0; index < sampleData.count; index++) {
    const xt = sampleData.x[index] * drawMultTemplate + drawMultCenterTemplate;
    const yt = sampleData.y[index] * drawMultTemplate + drawMultCenterTemplate;
    if (xt < 0 || yt < 0 || xt >= templateWidth || yt >= templateHeight) continue;
    const pixelIndex = (yt * templateWidth + xt) * 4;
    if ((index % 21) === 0) {
      templateData[pixelIndex + 3] = 0;
      continue;
    }
    if ((index % 11) === 0) {
      templateData[pixelIndex] = unknownRgb[0];
      templateData[pixelIndex + 1] = unknownRgb[1];
      templateData[pixelIndex + 2] = unknownRgb[2];
      templateData[pixelIndex + 3] = 255;
      continue;
    }
    templateData[pixelIndex] = sampleData.r[index];
    templateData[pixelIndex + 1] = sampleData.g[index];
    templateData[pixelIndex + 2] = sampleData.b[index];
    templateData[pixelIndex + 3] = sampleData.a[index] >= 1 ? sampleData.a[index] : 255;
  }
  const resultWidth = Math.max(1, sampleData.width * drawMultResult);
  const resultHeight = Math.max(1, sampleData.height * drawMultResult);
  const maskPoints = buildFullMaskPoints(drawMultResult);
  return {
    templateData,
    templateWidth,
    templateHeight,
    drawMultTemplate,
    drawMultResult,
    drawMultCenterTemplate,
    resultWidth,
    resultHeight,
    maskPoints,
  };
}

function templateColorFilterLegacyLoop({
  templateData,
  templateWidth,
  templateHeight,
  drawMultTemplate,
  drawMultResult,
  drawMultCenterTemplate,
  resultWidth,
  resultHeight,
  maskPoints,
  displayedColorSet,
}) {
  const imageData = new Uint8ClampedArray(resultWidth * resultHeight * 4);
  for (const [offsetX, offsetY] of maskPoints) {
    for (
      let yt = drawMultCenterTemplate, yr = offsetY;
      yt < templateHeight;
      yt += drawMultTemplate, yr += drawMultResult
    ) {
      for (
        let xt = drawMultCenterTemplate, xr = offsetX;
        xt < templateWidth;
        xt += drawMultTemplate, xr += drawMultResult
      ) {
        const templatePixelCenter = (yt * templateWidth + xt) * 4;
        const red = templateData[templatePixelCenter];
        const green = templateData[templatePixelCenter + 1];
        const blue = templateData[templatePixelCenter + 2];
        const alpha = templateData[templatePixelCenter + 3];
        if (alpha < 1) continue;
        const colorKey = `${red},${green},${blue}`;
        const normalizedKey = rgbToMeta.has(colorKey) ? colorKey : TEMPLATE_OTHER_COLOR_KEY;
        if (!displayedColorSet.has(normalizedKey)) continue;
        const realPixelCenter = (yr * resultWidth + xr) * 4;
        imageData[realPixelCenter] = red;
        imageData[realPixelCenter + 1] = green;
        imageData[realPixelCenter + 2] = blue;
        imageData[realPixelCenter + 3] = alpha;
      }
    }
  }
  return imageData[0] + imageData[1] + imageData[2] + imageData[3] + imageData[imageData.length - 1];
}

function templateColorFilterPackedLoop({
  templateData,
  templateWidth,
  templateHeight,
  drawMultTemplate,
  drawMultResult,
  drawMultCenterTemplate,
  resultWidth,
  resultHeight,
  maskPoints,
  displayedColorPackedSet,
  displayOtherColor,
}) {
  const imageData = new Uint8ClampedArray(resultWidth * resultHeight * 4);
  const drawMultTemplateStepBytes = drawMultTemplate << 2;
  const drawMultResultStepBytes = drawMultResult << 2;
  const templateRowStepBytes = templateWidth << 2;
  const resultRowStepBytes = resultWidth << 2;
  const shouldCheckUnknownColors = displayOtherColor === true;
  for (const [offsetX, offsetY] of maskPoints) {
    for (
      let yt = drawMultCenterTemplate, yr = offsetY;
      yt < templateHeight;
      yt += drawMultTemplate, yr += drawMultResult
    ) {
      const templateRowBase = yt * templateRowStepBytes;
      const resultRowBase = yr * resultRowStepBytes;
      for (
        let xt = drawMultCenterTemplate, xr = offsetX,
          templatePixelCenter = templateRowBase + (xt << 2),
          realPixelCenter = resultRowBase + (xr << 2);
        xt < templateWidth;
        xt += drawMultTemplate, xr += drawMultResult,
          templatePixelCenter += drawMultTemplateStepBytes,
          realPixelCenter += drawMultResultStepBytes
      ) {
        const red = templateData[templatePixelCenter];
        const green = templateData[templatePixelCenter + 1];
        const blue = templateData[templatePixelCenter + 2];
        const alpha = templateData[templatePixelCenter + 3];
        if (alpha < 1) continue;
        const packedColor = ((red << 16) | (green << 8) | blue) >>> 0;
        if (
          !displayedColorPackedSet.has(packedColor)
          && (!shouldCheckUnknownColors || KNOWN_PALETTE_PACKED_COLORS.has(packedColor))
        ) {
          continue;
        }
        imageData[realPixelCenter] = red;
        imageData[realPixelCenter + 1] = green;
        imageData[realPixelCenter + 2] = blue;
        imageData[realPixelCenter + 3] = alpha;
      }
    }
  }
  return imageData[0] + imageData[1] + imageData[2] + imageData[3] + imageData[imageData.length - 1];
}

function parseRgbKeyToPackedInt(key) {
  const parts = String(key).split(',');
  if (parts.length !== 3) return null;
  const red = Number(parts[0]);
  const green = Number(parts[1]);
  const blue = Number(parts[2]);
  if (![red, green, blue].every(Number.isInteger)) return null;
  if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255) return null;
  return ((red << 16) | (green << 8) | blue) >>> 0;
}

function collectAllowedPackedColors(displayedColorSet) {
  const packedColors = [];
  for (const colorKey of displayedColorSet) {
    const meta = rgbToMeta.get(colorKey);
    if (typeof meta?.id !== 'number' || meta.id <= 0) continue;
    const packed = parseRgbKeyToPackedInt(colorKey);
    if (packed === null) continue;
    packedColors.push(packed);
  }
  return Uint32Array.from(new Set(packedColors));
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

function createNearestPaletteNormalizer() {
  const palette = getBenchmarkPalette();
  const cache = new Map();
  return (r, g, b, a) => {
    const packed = ((r << 16) | (g << 8) | b) >>> 0;
    const cached = cache.get(packed);
    if (cached) {
      return {
        r: cached[0],
        g: cached[1],
        b: cached[2],
        a,
      };
    }
    let best = palette[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < palette.length; index++) {
      const color = palette[index];
      const dr = color[0] - r;
      const dg = color[1] - g;
      const db = color[2] - b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        best = color;
        bestDistance = distance;
        if (distance === 0) break;
      }
    }
    if (cache.size < 16384) {
      cache.set(packed, best);
    }
    return {
      r: best[0],
      g: best[1],
      b: best[2],
      a,
    };
  };
}

function runTemplateChunkCreationPipeline({
  sourceData,
  sampleNormalizer = null,
  includeStats = true,
  drawSize = CROSS_DRAW_SIZE,
  maskPoints,
  maskRowSpans,
}) {
  const accumulator = includeStats ? createPaletteStatsAccumulator() : null;
  const sampleData = buildChunkSampleDataFromSource(
    sourceData,
    IMAGE_WIDTH,
    CHUNK_SOURCE_X,
    CHUNK_SOURCE_Y,
    CHUNK_WIDTH,
    CHUNK_HEIGHT,
    accumulator,
    sampleNormalizer
  );
  const resultWidth = sampleData.width * drawSize;
  const resultHeight = sampleData.height * drawSize;
  const image = { data: new Uint8ClampedArray(resultWidth * resultHeight * 4) };
  renderSampleDataToImage({
    sampleData,
    imageData: image,
    resultWidth,
    drawSize,
    maskPoints,
    maskRowSpans,
    includeDefaceCheckerboard: true,
  });
  const encoded = encodeChunkSampleBytes(sampleData);
  const stats = accumulator ? finalizePaletteStatsAccumulator(accumulator) : null;
  return (
    sampleData.count
    + encoded.byteLength
    + image.data[0]
    + image.data[1]
    + image.data[2]
    + image.data[image.data.length - 1]
    + (stats?.required || 0)
    + (stats?.deface || 0)
  );
}

function measureTemplateCreationSimulation({
  sourceData,
  sampleNormalizer = null,
  drawSize = CROSS_DRAW_SIZE,
  maskPoints,
  maskRowSpans,
  startPixelX = OFFSET_X,
  startPixelY = OFFSET_Y,
  renderTiles = true,
  sampleExtractor = null,
  persistEncodedSamples = true,
}) {
  const accumulator = createPaletteStatsAccumulator();
  const stageTotals = {
    sampleMs: 0,
    renderMs: 0,
    encodeMs: 0,
    finalizeMs: 0,
  };
  let checksum = 0;
  let chunkCount = 0;
  const totalStart = performance.now();

  for (let pixelY = startPixelY; pixelY < IMAGE_HEIGHT + startPixelY;) {
    const drawSizeY = Math.min(
      TEMPLATE_TILE_SIZE - (pixelY % TEMPLATE_TILE_SIZE),
      IMAGE_HEIGHT + startPixelY - pixelY
    );
    for (let pixelX = startPixelX; pixelX < IMAGE_WIDTH + startPixelX;) {
      const drawSizeX = Math.min(
        TEMPLATE_TILE_SIZE - (pixelX % TEMPLATE_TILE_SIZE),
        IMAGE_WIDTH + startPixelX - pixelX
      );
      const sourceX = pixelX - startPixelX;
      const sourceY = pixelY - startPixelY;

      const sampleStart = performance.now();
      const sampleResult = sampleExtractor
        ? sampleExtractor({
          sourceX,
          sourceY,
          chunkWidth: drawSizeX,
          chunkHeight: drawSizeY,
          includeStats: !!accumulator,
        })
        : {
          sampleData: buildChunkSampleDataFromSource(
            sourceData,
            IMAGE_WIDTH,
            sourceX,
            sourceY,
            drawSizeX,
            drawSizeY,
            accumulator,
            sampleNormalizer
          ),
          stats: null,
        };
      const sampleData = sampleResult.sampleData;
      if (sampleResult.stats && accumulator) {
        accumulator.required += sampleResult.stats.required || 0;
        accumulator.deface += sampleResult.stats.deface || 0;
        if (sampleResult.stats.hasOther) {
          accumulator.hasOther = true;
        }
        accumulator.paletteCounts = accumulator.paletteCounts || Object.create(null);
        for (const [key, count] of Object.entries(sampleResult.stats.paletteCounts || {})) {
          accumulator.paletteCounts[key] = (accumulator.paletteCounts[key] || 0) + (count || 0);
        }
        accumulator.paletteCountsByIndex = null;
        accumulator.seenPaletteOrder = null;
      }
      stageTotals.sampleMs += performance.now() - sampleStart;

      let image = null;
      if (renderTiles) {
        const resultWidth = sampleData.width * drawSize;
        const resultHeight = sampleData.height * drawSize;
        image = { data: new Uint8ClampedArray(resultWidth * resultHeight * 4) };

        const renderStart = performance.now();
        renderSampleDataToImage({
          sampleData,
          imageData: image,
          resultWidth,
          drawSize,
          maskPoints,
          maskRowSpans,
          includeDefaceCheckerboard: true,
        });
        stageTotals.renderMs += performance.now() - renderStart;
      }

      let encoded = null;
      if (persistEncodedSamples) {
        const encodeStart = performance.now();
        encoded = encodeChunkSampleBytes(sampleData);
        stageTotals.encodeMs += performance.now() - encodeStart;
      }

      checksum = (
        checksum
        + sampleData.count
        + (encoded?.byteLength || 0)
        + (image?.data?.[0] || 0)
        + (image?.data?.[1] || 0)
        + (image?.data?.[2] || 0)
        + (image?.data?.[image.data.length - 1] || 0)
      ) >>> 0;
      chunkCount++;
      pixelX += drawSizeX;
    }
    pixelY += drawSizeY;
  }

  const finalizeStart = performance.now();
  const stats = finalizePaletteStatsAccumulator(accumulator);
  stageTotals.finalizeMs += performance.now() - finalizeStart;
  checksum = (
    checksum
    + (stats?.required || 0)
    + (stats?.deface || 0)
    + (stats?.paletteMap?.size || 0)
  ) >>> 0;

  const totalMs = performance.now() - totalStart;
  return {
    checksum,
    chunkCount,
    totalMs,
    sampleMs: stageTotals.sampleMs,
    renderMs: stageTotals.renderMs,
    encodeMs: stageTotals.encodeMs,
    finalizeMs: stageTotals.finalizeMs,
    otherMs: Math.max(
      0,
      totalMs
      - stageTotals.sampleMs
      - stageTotals.renderMs
      - stageTotals.encodeMs
      - stageTotals.finalizeMs
    ),
  };
}

function runTemplateCreationBreakdownBenchmark(name, iterations, options, warmup = 1) {
  let checksum = 0;
  let chunkCount = 0;
  for (let index = 0; index < warmup; index++) {
    const result = measureTemplateCreationSimulation(options);
    checksum = (checksum + (result?.checksum || 0) + index) >>> 0;
  }
  const totals = {
    totalMs: 0,
    sampleMs: 0,
    renderMs: 0,
    encodeMs: 0,
    finalizeMs: 0,
    otherMs: 0,
  };
  for (let index = 0; index < iterations; index++) {
    const result = measureTemplateCreationSimulation(options);
    checksum = (checksum + (result?.checksum || 0) + index) >>> 0;
    chunkCount = result.chunkCount;
    totals.totalMs += result.totalMs;
    totals.sampleMs += result.sampleMs;
    totals.renderMs += result.renderMs;
    totals.encodeMs += result.encodeMs;
    totals.finalizeMs += result.finalizeMs;
    totals.otherMs += result.otherMs;
  }
  return {
    name,
    iterations,
    chunkCount,
    checksum,
    totalMs: totals.totalMs / iterations,
    sampleMs: totals.sampleMs / iterations,
    renderMs: totals.renderMs / iterations,
    encodeMs: totals.encodeMs / iterations,
    finalizeMs: totals.finalizeMs / iterations,
    otherMs: totals.otherMs / iterations,
  };
}

function encodeChunkSampleDataLegacy(sampleData) {
  const width = Math.max(0, Math.trunc(Number(sampleData?.width) || 0));
  const height = Math.max(0, Math.trunc(Number(sampleData?.height) || 0));
  const count = Math.max(0, Math.trunc(Number(sampleData?.count) || 0));
  const recordBytes = 9;
  const headerBytes = 8;
  const buffer = new ArrayBuffer(headerBytes + count * recordBytes);
  const view = new DataView(buffer);
  view.setUint16(0, width, true);
  view.setUint16(2, height, true);
  view.setUint32(4, count, true);
  let offset = headerBytes;
  for (let index = 0; index < count; index++) {
    view.setUint16(offset, sampleData.x[index], true);
    view.setUint16(offset + 2, sampleData.y[index], true);
    view.setUint8(offset + 4, sampleData.flags[index] || 0);
    view.setUint8(offset + 5, sampleData.r[index] || 0);
    view.setUint8(offset + 6, sampleData.g[index] || 0);
    view.setUint8(offset + 7, sampleData.b[index] || 0);
    view.setUint8(offset + 8, sampleData.a[index] || 0);
    offset += recordBytes;
  }
  return uint8ToBase64(new Uint8Array(buffer));
}

function decodeChunkSampleBufferLegacy(bufferValue) {
  if (bufferValue === undefined || bufferValue === null) return null;
  const bytes = typeof bufferValue === 'string' ? base64ToUint8(bufferValue) : bufferValue;
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  const count = view.getUint32(4, true);
  const expectedLength = 8 + count * 9;
  if (bytes.length < expectedLength) {
    return null;
  }
  const sampleData = {
    width,
    height,
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
  let offset = 8;
  for (let index = 0; index < count; index++) {
    sampleData.x[index] = view.getUint16(offset, true);
    sampleData.y[index] = view.getUint16(offset + 2, true);
    sampleData.flags[index] = view.getUint8(offset + 4);
    sampleData.r[index] = view.getUint8(offset + 5);
    sampleData.g[index] = view.getUint8(offset + 6);
    sampleData.b[index] = view.getUint8(offset + 7);
    sampleData.a[index] = view.getUint8(offset + 8);
    offset += 9;
  }
  return sampleData;
}

function inspectSourceImagePaletteLegacy(sourceData, width, height) {
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
    if (r === 222 && g === 250 && b === 206) {
      deface++;
      continue;
    }
    const key = getPaletteKeyForRgb(r, g, b);
    required++;
    paletteCounts[key] = (paletteCounts[key] || 0) + 1;
  }
  const paletteMap = new Map(Object.entries(paletteCounts));
  return { required, deface, paletteMap };
}

function createPaletteStatsAccumulatorLegacy() {
  return {
    required: 0,
    deface: 0,
    hasOther: false,
    paletteCounts: Object.create(null),
  };
}

function packRgbaForBenchmark(r, g, b, a) {
  return IMAGE_DATA_LITTLE_ENDIAN
    ? (((a << 24) | (b << 16) | (g << 8) | r) >>> 0)
    : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

function renderSampleDataToImageLegacy({
  sampleData,
  imageData,
  resultWidth,
  drawSize,
  maskPoints = null,
  maskRowSpans,
  displayedColorSet = null,
  includeDefaceCheckerboard = false,
}) {
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
  const checkerDark = packRgbaForBenchmark(0, 0, 0, 32);
  const checkerLight = packRgbaForBenchmark(255, 255, 255, 32);

  for (let index = 0; index < sampleData.count; index++) {
    const alpha = sampleData.a[index];
    if (alpha < 1) continue;
    const baseX = sampleData.x[index] * safeDrawSize;
    const baseY = sampleData.y[index] * safeDrawSize;
    const red = sampleData.r[index];
    const green = sampleData.g[index];
    const blue = sampleData.b[index];
    const isDefacePixel = (sampleData.flags[index] & 1) === 1;

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

    const packedColor = packRgbaForBenchmark(red, green, blue, alpha);
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
}

function collectTemplateProgressFromSamplesLegacy({
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
}) {
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
    const isDefacePixel = (sampleData.flags[index] & 1) === 1;
    if (templateAlpha < 64 || isDefacePixel) {
      continue;
    }

    requiredCount++;
    const templateProgress = ensureTemplateProgress();
    const colorKey = getPaletteKeyForRgb(templateRed, templateGreen, templateBlue);
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

async function createNearestWasmRunner({
  sampleData,
  tilePixels,
  displayedColorSet,
  tileX,
  tileY,
  tileSize,
  offsetX,
  offsetY,
  originPoint,
  excludedCoordsKey,
  colorMatchDelta = 3,
  copyInputsPerRun = false,
}) {
  const wabtFactory = (await import('wabt')).default;
  const wabt = await wabtFactory();
  const parsed = wabt.parseWat('nearest_unpainted.wat', WASM_NEAREST_WAT);
  const { buffer } = parsed.toBinary({ log: false, write_debug_names: false });
  const { instance } = await WebAssembly.instantiate(buffer, {});
  const { memory, find_nearest: findNearest } = instance.exports;
  const memoryU8 = new Uint8Array(memory.buffer);
  const memoryI32 = new Int32Array(memory.buffer);
  const memoryF64 = new Float64Array(memory.buffer);

  let cursor = 0;
  const align = (value, size) => ((value + size - 1) & ~(size - 1));
  const alloc = (bytes, alignment = 1) => {
    cursor = align(cursor, alignment);
    const ptr = cursor;
    cursor += bytes;
    if (cursor > memoryU8.length) {
      throw new Error(`WASM memory exhausted at ${cursor} bytes (capacity ${memoryU8.length}).`);
    }
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
  const liveTilePtr = alloc(tilePixels.byteLength);
  const allowedPackedColors = collectAllowedPackedColors(displayedColorSet);
  const allowedColorPtr = alloc(allowedPackedColors.byteLength, 4);
  const resultPtr = alloc(24, 8);

  memoryU8.set(new Uint8Array(sampleData.x.buffer, sampleData.x.byteOffset, sampleData.x.byteLength), xPtr);
  memoryU8.set(new Uint8Array(sampleData.y.buffer, sampleData.y.byteOffset, sampleData.y.byteLength), yPtr);
  memoryU8.set(sampleData.r, rPtr);
  memoryU8.set(sampleData.g, gPtr);
  memoryU8.set(sampleData.b, bPtr);
  memoryU8.set(sampleData.a, aPtr);
  memoryU8.set(sampleData.flags, flagsPtr);
  memoryU8.set(tilePixels, liveTilePtr);
  memoryU8.set(new Uint8Array(allowedPackedColors.buffer), allowedColorPtr);

  const excludedParts = String(excludedCoordsKey).split(',').map((value) => Number(value));
  const excludedPixelX = Number.isFinite(excludedParts?.[2]) ? excludedParts[2] : -1;
  const excludedPixelY = Number.isFinite(excludedParts?.[3]) ? excludedParts[3] : -1;

  const worldWidth = MAP_WORLD_WIDTH_PX;
  const originWorldX = Math.trunc(originPoint?.x || 0);
  const originWorldY = Math.trunc(originPoint?.y || 0);

  return () => {
    if (copyInputsPerRun) {
      memoryU8.set(new Uint8Array(sampleData.x.buffer, sampleData.x.byteOffset, sampleData.x.byteLength), xPtr);
      memoryU8.set(new Uint8Array(sampleData.y.buffer, sampleData.y.byteOffset, sampleData.y.byteLength), yPtr);
      memoryU8.set(sampleData.r, rPtr);
      memoryU8.set(sampleData.g, gPtr);
      memoryU8.set(sampleData.b, bPtr);
      memoryU8.set(sampleData.a, aPtr);
      memoryU8.set(sampleData.flags, flagsPtr);
      memoryU8.set(tilePixels, liveTilePtr);
    }
    findNearest(
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
      originWorldX,
      originWorldY,
      tileX,
      tileY,
      worldWidth,
      colorMatchDelta,
      excludedPixelX,
      excludedPixelY,
      allowedColorPtr,
      allowedPackedColors.length,
      resultPtr
    );
    const found = memoryI32[resultPtr >> 2];
    if (!found) return 0;
    const pixelX = memoryI32[(resultPtr + 4) >> 2];
    const pixelY = memoryI32[(resultPtr + 8) >> 2];
    const distanceSq = memoryF64[(resultPtr + 16) >> 3];
    return Math.round(distanceSq) + pixelX + pixelY;
  };
}

function printResults(results, fixture) {
  console.log('Template Performance Benchmark');
  console.log(`Fixture: source ${IMAGE_WIDTH}x${IMAGE_HEIGHT}, chunk ${CHUNK_WIDTH}x${CHUNK_HEIGHT}, sampled pixels ${fixture.sampleData.count}`);
  console.log('Scope: pure template creation/checking helpers plus optional WASM for nearest-pixel scan.');
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

function printTemplateCreationBreakdown(breakdowns) {
  if (!Array.isArray(breakdowns) || breakdowns.length === 0) {
    return;
  }
  console.log('');
  console.log('Template Creation Breakdown');
  for (const breakdown of breakdowns) {
    console.log(
      `${breakdown.name}: avg ${formatMs(breakdown.totalMs)} across ${breakdown.chunkCount} chunk(s) per iteration`
    );
    const stages = [
      ['sample', breakdown.sampleMs],
      ['render', breakdown.renderMs],
      ['encode', breakdown.encodeMs],
      ['finalize', breakdown.finalizeMs],
      ['other', breakdown.otherMs],
    ].sort((a, b) => b[1] - a[1]);
    for (const [label, value] of stages) {
      const share = breakdown.totalMs > 0 ? ((value / breakdown.totalMs) * 100).toFixed(1) : '0.0';
      console.log(`  ${label.padEnd(8)} ${formatMs(value).padStart(12)} ${share.padStart(6)}%`);
    }
    console.log(`  checksum ${String(breakdown.checksum >>> 0)}`);
  }
}

// Simulate getOverallPerColorProgress over a large tileProgress map.
// Compares the old O(tiles × colors × examples) scan vs the new O(colors) running-totals path.
function buildTileProgressAggregationBenchmarks(sampleData, tilePixels) {
  const TILE_COUNT = 500;
  const COLORS_PER_TILE = 12;
  const EXAMPLES_PER_COLOR = 32;
  const rng = createRng(0xab000001);

  const mockPaletteKeys = Array.from({ length: COLORS_PER_TILE }, (_, i) => `${(i * 4) & 255},${(i * 7) & 255},${(i * 13) & 255}`);

  // Build a mock tileProgress Map identical to what templateManager holds.
  const tileProgress = new Map();
  for (let t = 0; t < TILE_COUNT; t++) {
    const palette = {};
    for (const colorKey of mockPaletteKeys) {
      const examplesEnabled = Array.from({ length: EXAMPLES_PER_COLOR }, (_, j) => (
        [[t, j], [Math.floor(rng() * 1000), Math.floor(rng() * 1000)]]
      ));
      palette[colorKey] = {
        painted: Math.floor(rng() * 1000),
        paintedAndEnabled: Math.floor(rng() * 1000),
        missing: Math.floor(rng() * 1000),
        examplesEnabled,
      };
    }
    tileProgress.set(`${String(t).padStart(4, '0')},${String(t).padStart(4, '0')}`, {
      painted: 500, required: 700, wrong: 50, palette, template: {},
    });
  }

  // Old approach: full O(tiles × colors × examples) scan on every call.
  const mergeLegacy = (tileProgress, exampleMax) => {
    const combinedProgress = {};
    for (const stats of tileProgress.values()) {
      for (const [colorKey, content] of Object.entries(stats.palette)) {
        if (combinedProgress[colorKey] === undefined) {
          combinedProgress[colorKey] = {
            painted: content.painted,
            paintedAndEnabled: content.paintedAndEnabled,
            missing: content.missing,
            examplesEnabled: [],
            _exampleSeenCount: 0,
          };
        } else {
          combinedProgress[colorKey].painted += content.painted;
          combinedProgress[colorKey].paintedAndEnabled += content.paintedAndEnabled;
          combinedProgress[colorKey].missing += content.missing;
        }
        for (const ex of content.examplesEnabled) {
          const target = combinedProgress[colorKey];
          target._exampleSeenCount++;
          if (target.examplesEnabled.length < exampleMax) {
            target.examplesEnabled.push(ex);
          } else if (Math.random() * target._exampleSeenCount < exampleMax) {
            target.examplesEnabled[Math.floor(Math.random() * exampleMax)] = ex;
          }
        }
      }
    }
    for (const v of Object.values(combinedProgress)) delete v._exampleSeenCount;
    return combinedProgress;
  };

  // New approach: running totals precomputed, examples rebuilt only when dirty.
  // Simulate the incremental state.
  const runningPalette = {};
  for (const stats of tileProgress.values()) {
    for (const [colorKey, entry] of Object.entries(stats.palette)) {
      if (!runningPalette[colorKey]) runningPalette[colorKey] = { painted: 0, paintedAndEnabled: 0, missing: 0 };
      runningPalette[colorKey].painted += entry.painted;
      runningPalette[colorKey].paintedAndEnabled += entry.paintedAndEnabled;
      runningPalette[colorKey].missing += entry.missing;
    }
  }

  const mergeFast = (runningPalette, tileProgress, exampleMax, examplesDirty, cachedExamples) => {
    const combinedProgress = {};
    for (const colorKey in runningPalette) {
      const slot = runningPalette[colorKey];
      combinedProgress[colorKey] = {
        painted: Math.max(0, slot.painted),
        paintedAndEnabled: Math.max(0, slot.paintedAndEnabled),
        missing: Math.max(0, slot.missing),
        examplesEnabled: [],
      };
    }
    if (examplesDirty) {
      for (const key in combinedProgress) combinedProgress[key]._exampleSeenCount = 0;
      for (const stats of tileProgress.values()) {
        for (const colorKey in stats.palette) {
          const content = stats.palette[colorKey];
          if (!content?.examplesEnabled?.length) continue;
          const entry = combinedProgress[colorKey];
          if (!entry) continue;
          for (const ex of content.examplesEnabled) {
            entry._exampleSeenCount++;
            if (entry.examplesEnabled.length < exampleMax) {
              entry.examplesEnabled.push(ex);
            } else if (Math.random() * entry._exampleSeenCount < exampleMax) {
              entry.examplesEnabled[Math.floor(Math.random() * exampleMax)] = ex;
            }
          }
        }
      }
      for (const key in combinedProgress) delete combinedProgress[key]._exampleSeenCount;
    } else if (cachedExamples) {
      for (const colorKey in cachedExamples) {
        if (combinedProgress[colorKey]) combinedProgress[colorKey].examplesEnabled = cachedExamples[colorKey]?.examplesEnabled ?? [];
      }
    }
    return combinedProgress;
  };

  const EXAMPLE_MAX = 32;
  const cachedExamples = mergeFast(runningPalette, tileProgress, EXAMPLE_MAX, true, null);
  let checksum = 0;
  const summarize = (cp) => {
    let s = 0;
    for (const v of Object.values(cp)) s += v.painted + v.missing + v.examplesEnabled.length;
    return s;
  };

  return [
    runBenchmark(`getOverallPerColorProgress(legacy,${TILE_COUNT}tiles)`, 50, () => {
      const cp = mergeLegacy(tileProgress, EXAMPLE_MAX);
      checksum = summarize(cp);
      return checksum;
    }),
    runBenchmark(`getOverallPerColorProgress(fast,dirty,${TILE_COUNT}tiles)`, 50, () => {
      const cp = mergeFast(runningPalette, tileProgress, EXAMPLE_MAX, true, null);
      checksum = summarize(cp);
      return checksum;
    }),
    runBenchmark(`getOverallPerColorProgress(fast,cached,${TILE_COUNT}tiles)`, 50, () => {
      const cp = mergeFast(runningPalette, tileProgress, EXAMPLE_MAX, false, cachedExamples);
      checksum = summarize(cp);
      return checksum;
    }),
  ];
}

async function main() {
  const sourceData = buildSourceImageData();
  const nonPaletteSourceData = buildNonPaletteSourceImageData();
  const sampleNormalizer = createNearestPaletteNormalizer();
  const sampleData = buildChunkSampleDataFromSource(
    sourceData,
    IMAGE_WIDTH,
    CHUNK_SOURCE_X,
    CHUNK_SOURCE_Y,
    CHUNK_WIDTH,
    CHUNK_HEIGHT
  );
  const encodedSample = encodeChunkSampleData(sampleData);
  const encodedSampleBytes = encodeChunkSampleBytes(sampleData);
  const tilePixels = buildTilePixels(sampleData);
  const displayedColorSet = buildDisplayedColorSet(sampleData);
  const tileCoords = [TILE_X, TILE_Y];
  const examplePool = createReservoirExamples(sampleData);
  const crossMaskPoints = buildDefaultCrossMaskPoints(CROSS_DRAW_SIZE);
  const fullMaskPoints = buildFullMaskPoints(CROSS_DRAW_SIZE);
  const crossMaskRowSpans = buildMaskRowSpans(crossMaskPoints, CROSS_DRAW_SIZE);
  const fullMaskRowSpans = buildMaskRowSpans(fullMaskPoints, CROSS_DRAW_SIZE);
  const crossResultWidth = sampleData.width * CROSS_DRAW_SIZE;
  const crossResultHeight = sampleData.height * CROSS_DRAW_SIZE;
  const colorFilterFixture = buildTemplateColorFilterFixture(sampleData);
  const displayedColorSubset = (() => {
    const subset = new Set();
    let index = 0;
    for (const colorKey of displayedColorSet) {
      if ((index % 4) !== 0) {
        subset.add(colorKey);
      }
      index++;
    }
    return subset;
  })();
  const displayedColorSubsetWithOther = new Set(displayedColorSubset);
  displayedColorSubsetWithOther.add(TEMPLATE_OTHER_COLOR_KEY);
  const displayedPackedNoOther = buildDisplayedColorPackedContext(displayedColorSubset);
  const displayedPackedWithOther = buildDisplayedColorPackedContext(displayedColorSubsetWithOther);
  const overlayTransportSource = buildOverlayTransportSourceBuffer(crossResultWidth, crossResultHeight);
  const wasmSampleExtractor = isTemplateSampleExtractWasmAvailable()
    ? createTemplateSampleExtractorWithWasm({
      sourceData,
      imageWidth: IMAGE_WIDTH,
    })
    : null;
  const originPoint = {
    x: TILE_X * TEMPLATE_TILE_SIZE + 500,
    y: TILE_Y * TEMPLATE_TILE_SIZE + 500,
  };
  const excludedCoordsKey = `${TILE_X},${TILE_Y},500,500`;
  let wasmNearestRunner = null;
  let wasmNearestRunnerCopy = null;
  try {
    wasmNearestRunner = await createNearestWasmRunner({
      sampleData,
      tilePixels,
      displayedColorSet,
      tileX: TILE_X,
      tileY: TILE_Y,
      tileSize: TEMPLATE_TILE_SIZE,
      offsetX: OFFSET_X,
      offsetY: OFFSET_Y,
      originPoint,
      excludedCoordsKey,
    });
    wasmNearestRunnerCopy = await createNearestWasmRunner({
      sampleData,
      tilePixels,
      displayedColorSet,
      tileX: TILE_X,
      tileY: TILE_Y,
      tileSize: TEMPLATE_TILE_SIZE,
      offsetX: OFFSET_X,
      offsetY: OFFSET_Y,
      originPoint,
      excludedCoordsKey,
      copyInputsPerRun: true,
    });
  } catch (error) {
    console.warn('WASM benchmark path disabled (install optional dependency `wabt` to enable).', error?.message || error);
  }

  const results = [
    runBenchmark('buildMaskRowSpans(cross-mask)', 5000, () => {
      const spans = buildMaskRowSpans(crossMaskPoints, CROSS_DRAW_SIZE);
      return spans.length + spans[0].length;
    }),
    runBenchmark('buildMaskRowSpans(full-mask)', 5000, () => {
      const spans = buildMaskRowSpans(fullMaskPoints, CROSS_DRAW_SIZE);
      return spans.length + spans[0].length;
    }),
    runBenchmark('inspectSourceImagePalette', 8, () => {
      const result = inspectSourceImagePalette(sourceData, IMAGE_WIDTH, IMAGE_HEIGHT);
      return result.required + result.deface + result.paletteMap.size;
    }),
    runBenchmark('inspectSourceImagePalette(legacy)', 8, () => {
      const result = inspectSourceImagePaletteLegacy(sourceData, IMAGE_WIDTH, IMAGE_HEIGHT);
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
    runBenchmark('buildChunkSampleDataFromSource+stats(legacyAcc)', 20, () => {
      const accumulator = createPaletteStatsAccumulatorLegacy();
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
    ...(typeof wasmSampleExtractor === 'function' ? [runBenchmark('buildChunkSampleDataFromSource+stats(wasm)', 20, () => {
      const result = wasmSampleExtractor({
        sourceX: CHUNK_SOURCE_X,
        sourceY: CHUNK_SOURCE_Y,
        chunkWidth: CHUNK_WIDTH,
        chunkHeight: CHUNK_HEIGHT,
        includeStats: true,
      });
      const stats = result?.stats || {};
      const paletteSize = Object.keys(stats.paletteCounts || {}).length;
      return (result?.sampleData?.count || 0) + (stats.required || 0) + (stats.deface || 0) + paletteSize;
    })] : []),
    runBenchmark('buildChunkSampleDataFromSource+normalizer', 16, () => {
      const accumulator = createPaletteStatsAccumulator();
      const result = buildChunkSampleDataFromSource(
        nonPaletteSourceData,
        IMAGE_WIDTH,
        CHUNK_SOURCE_X,
        CHUNK_SOURCE_Y,
        CHUNK_WIDTH,
        CHUNK_HEIGHT,
        accumulator,
        sampleNormalizer
      );
      const stats = finalizePaletteStatsAccumulator(accumulator);
      return result.count + stats.required + stats.deface + stats.paletteMap.size;
    }),
    runBenchmark('convertImageDataToWplacePalette(noop/js)', 6, () => {
      const fixture = cloneImageDataFixture(sourceData, IMAGE_WIDTH, IMAGE_HEIGHT);
      const result = convertImageDataToWplacePalette(fixture, {
        ditherMode: 'none',
        ditherStrength: 0,
        antiDitherStrength: 0,
        useWasm: false,
      });
      return result.stats.convertedPixels + result.stats.remainingOtherPixels + fixture.data[0];
    }),
    runBenchmark('convertImageDataToWplacePalette(noop/wasm)', 6, () => {
      const fixture = cloneImageDataFixture(sourceData, IMAGE_WIDTH, IMAGE_HEIGHT);
      const result = convertImageDataToWplacePalette(fixture, {
        ditherMode: 'none',
        ditherStrength: 0,
        antiDitherStrength: 0,
        useWasm: true,
      });
      return result.stats.convertedPixels + result.stats.remainingOtherPixels + fixture.data[0];
    }),
    runBenchmark('convertImageDataToWplacePalette(map/js)', 6, () => {
      const fixture = cloneImageDataFixture(nonPaletteSourceData, IMAGE_WIDTH, IMAGE_HEIGHT);
      const result = convertImageDataToWplacePalette(fixture, {
        ditherMode: 'none',
        ditherStrength: 0,
        antiDitherStrength: 0,
        useWasm: false,
      });
      return result.stats.convertedPixels + result.stats.remainingOtherPixels + fixture.data[0];
    }),
    runBenchmark('convertImageDataToWplacePalette(map/wasm)', 6, () => {
      const fixture = cloneImageDataFixture(nonPaletteSourceData, IMAGE_WIDTH, IMAGE_HEIGHT);
      const result = convertImageDataToWplacePalette(fixture, {
        ditherMode: 'none',
        ditherStrength: 0,
        antiDitherStrength: 0,
        useWasm: true,
      });
      return result.stats.convertedPixels + result.stats.remainingOtherPixels + fixture.data[0];
    }),
    runBenchmark('convertImageDataToWplacePalette(dither)', 4, () => {
      const fixture = cloneImageDataFixture(nonPaletteSourceData, IMAGE_WIDTH, IMAGE_HEIGHT);
      const result = convertImageDataToWplacePalette(fixture, {
        ditherMode: 'floyd-steinberg',
        ditherStrength: 1,
        antiDitherStrength: 0.5,
        useWasm: false,
      });
      return result.stats.convertedPixels + result.stats.remainingOtherPixels + fixture.data[0];
    }),
    runBenchmark('encodeChunkSampleBytes', 24, () => {
      const result = encodeChunkSampleBytes(sampleData);
      return result.byteLength;
    }),
    runBenchmark('uint8ToBase64(chunkSampleBytes)', 24, () => {
      const result = uint8ToBase64(encodedSampleBytes);
      return result.length;
    }),
    runBenchmark('encodeChunkSampleData', 24, () => {
      const result = encodeChunkSampleData(sampleData);
      return result.length;
    }),
    runBenchmark('encodeChunkSampleData(legacy)', 24, () => {
      const result = encodeChunkSampleDataLegacy(sampleData);
      return result.length;
    }),
    runBenchmark('decodeChunkSampleBuffer', 24, () => {
      const result = decodeChunkSampleBuffer(encodedSample);
      return (result?.count || 0) + (result?.width || 0) + (result?.height || 0);
    }),
    runBenchmark('decodeChunkSampleBuffer(legacy)', 24, () => {
      const result = decodeChunkSampleBufferLegacy(encodedSample);
      return (result?.count || 0) + (result?.width || 0) + (result?.height || 0);
    }),
    runBenchmark('collectTemplateProgressFromSamples(WASM)', 16, () => {
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
        useWasm: true,
      });
      const exampleCount = Object.values(paletteStats).reduce(
        (sum, entry) => sum + (entry?.examplesEnabled?.length || 0),
        0
      );
      return result.paintedCount + result.wrongCount + result.requiredCount + exampleCount + Object.keys(templateStats).length;
    }),
    runBenchmark('collectTemplateProgressFromSamples(JS)', 16, () => {
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
        useWasm: false,
      });
      const exampleCount = Object.values(paletteStats).reduce(
        (sum, entry) => sum + (entry?.examplesEnabled?.length || 0),
        0
      );
      return result.paintedCount + result.wrongCount + result.requiredCount + exampleCount + Object.keys(templateStats).length;
    }),
    runBenchmark('collectTemplateProgressFromSamples(legacy)', 16, () => {
      const paletteStats = {};
      const templateStats = {};
      const errorData = new Uint8ClampedArray(sampleData.width * sampleData.height * 4);
      const result = collectTemplateProgressFromSamplesLegacy({
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
        useWasm: false,
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
    runBenchmark('renderSampleDataToImage(legacy)', 10, () => {
      const image = { data: new Uint8ClampedArray(crossResultWidth * crossResultHeight * 4) };
      renderSampleDataToImageLegacy({
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
    runBenchmark('templateChunkCreatePipeline', 12, () => (
      runTemplateChunkCreationPipeline({
        sourceData,
        maskPoints: crossMaskPoints,
        maskRowSpans: crossMaskRowSpans,
      })
    )),
    runBenchmark('templateChunkCreatePipeline+normalizer', 10, () => (
      runTemplateChunkCreationPipeline({
        sourceData: nonPaletteSourceData,
        sampleNormalizer,
        maskPoints: crossMaskPoints,
        maskRowSpans: crossMaskRowSpans,
      })
    )),
    runBenchmark('templateChunkCreatePipeline(full-mask)', 8, () => (
      runTemplateChunkCreationPipeline({
        sourceData,
        maskPoints: fullMaskPoints,
        maskRowSpans: fullMaskRowSpans,
      })
    )),
    runBenchmark('templateColorFilterLoop(legacy)', 6, () => (
      templateColorFilterLegacyLoop({
        ...colorFilterFixture,
        displayedColorSet: displayedColorSubset,
      })
    )),
    runBenchmark('templateColorFilterLoop(packed)', 6, () => (
      templateColorFilterPackedLoop({
        ...colorFilterFixture,
        ...displayedPackedNoOther,
      })
    )),
    runBenchmark('templateColorFilterLoop+other(legacy)', 6, () => (
      templateColorFilterLegacyLoop({
        ...colorFilterFixture,
        displayedColorSet: displayedColorSubsetWithOther,
      })
    )),
    runBenchmark('templateColorFilterLoop+other(packed)', 6, () => (
      templateColorFilterPackedLoop({
        ...colorFilterFixture,
        ...displayedPackedWithOther,
      })
    )),
    ...(isFilterBitmapPixelsWasmAvailable() ? [
      runBenchmark('filterBitmapPixels(WASM,no-other)', 6, () => {
        const knownSorted = Uint32Array.from(KNOWN_PALETTE_PACKED_COLORS).sort();
        const dispSorted = Uint32Array.from(displayedPackedNoOther.displayedColorPackedSet).sort();
        const result = filterBitmapPixelsWithWasm({
          ...colorFilterFixture,
          drawMultCenter: colorFilterFixture.drawMultCenterTemplate,
          displayedColorsPacked: dispSorted,
          knownColorsPacked: knownSorted,
          displayOther: false,
        });
        return result ? result[0] + result[result.length - 1] : 0;
      }),
      runBenchmark('filterBitmapPixels(WASM,with-other)', 6, () => {
        const knownSorted = Uint32Array.from(KNOWN_PALETTE_PACKED_COLORS).sort();
        const dispSorted = Uint32Array.from(displayedPackedWithOther.displayedColorPackedSet).sort();
        const result = filterBitmapPixelsWithWasm({
          ...colorFilterFixture,
          drawMultCenter: colorFilterFixture.drawMultCenterTemplate,
          displayedColorsPacked: dispSorted,
          knownColorsPacked: knownSorted,
          displayOther: true,
        });
        return result ? result[0] + result[result.length - 1] : 0;
      }),
    ] : []),
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
    ...buildTileProgressAggregationBenchmarks(sampleData, tilePixels),
  ];
  if (typeof wasmNearestRunner === 'function') {
    results.splice(8, 0, runBenchmark('findNearestUnpaintedSamplePixel(WASM)', 24, () => (
      wasmNearestRunner()
    )));
  }
  if (typeof wasmNearestRunnerCopy === 'function') {
    const insertIndex = typeof wasmNearestRunner === 'function' ? 9 : 8;
    results.splice(insertIndex, 0, runBenchmark('findNearestUnpaintedSamplePixel(WASM+copy)', 24, () => (
      wasmNearestRunnerCopy()
    )));
  }

  const templateCreationBreakdowns = [
    runTemplateCreationBreakdownBenchmark('templateCreateTilesSim(local)', 8, {
      sourceData,
      maskPoints: crossMaskPoints,
      maskRowSpans: crossMaskRowSpans,
      renderTiles: false,
      persistEncodedSamples: false,
    }),
    runTemplateCreationBreakdownBenchmark('templateCreateTilesSim(local+normalizer)', 6, {
      sourceData: nonPaletteSourceData,
      sampleNormalizer,
      maskPoints: crossMaskPoints,
      maskRowSpans: crossMaskRowSpans,
      renderTiles: false,
      persistEncodedSamples: false,
    }),
    runTemplateCreationBreakdownBenchmark('templateCreateTilesSim(remote-bitmap)', 6, {
      sourceData,
      maskPoints: crossMaskPoints,
      maskRowSpans: crossMaskRowSpans,
      renderTiles: true,
      persistEncodedSamples: false,
    }),
    ...(typeof wasmSampleExtractor === 'function' ? [runTemplateCreationBreakdownBenchmark('templateCreateTilesSim(local+wasmExtract)', 6, {
      sourceData,
      maskPoints: crossMaskPoints,
      maskRowSpans: crossMaskRowSpans,
      renderTiles: false,
      sampleExtractor: wasmSampleExtractor,
    })] : []),
  ];

  printResults(results, { sampleData });
  printTemplateCreationBreakdown(templateCreationBreakdowns);
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exitCode = 1;
});
