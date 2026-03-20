import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { inspectSourceImagePalette } from '../src/templateChunkUtils.js';
import {
  convertImageDataToWplacePalette,
  normalizeTemplatePaletteConversionOptions,
  templatePaletteConversionDefaults,
} from '../src/Template.js';
import { rgbToMeta } from '../src/utils.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const paethPredictor = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

const parsePng = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a valid PNG file.');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > buffer.length) {
      throw new Error('Corrupted PNG chunk stream.');
    }

    const chunkData = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData.readUInt8(8);
      colorType = chunkData.readUInt8(9);
      interlace = chunkData.readUInt8(12);
    } else if (type === 'IDAT') {
      idat.push(chunkData);
    } else if (type === 'IEND') {
      break;
    }

    offset = crcEnd;
  }

  if (!width || !height) {
    throw new Error('PNG missing IHDR.');
  }
  if (!idat.length) {
    throw new Error('PNG missing IDAT payload.');
  }
  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth: ${bitDepth}. Only 8-bit is supported by this test.`);
  }
  if (interlace !== 0) {
    throw new Error('Unsupported interlaced PNG. Only non-interlaced PNG is supported by this test.');
  }
  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`Unsupported PNG color type: ${colorType}. Only RGBA (6) and RGB (2) are supported by this test.`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const expectedMin = (stride + 1) * height;
  if (inflated.length < expectedMin) {
    throw new Error(`PNG decompressed payload is truncated: ${inflated.length} < ${expectedMin}.`);
  }

  const raw = Buffer.allocUnsafe(stride * height);
  let readOffset = 0;
  let prevRow = Buffer.alloc(stride, 0);
  for (let y = 0; y < height; y++) {
    const filterType = inflated.readUInt8(readOffset);
    const filtered = inflated.subarray(readOffset + 1, readOffset + 1 + stride);
    const row = raw.subarray(y * stride, (y + 1) * stride);

    if (filterType === 0) {
      filtered.copy(row);
    } else if (filterType === 1) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
        row[x] = (filtered[x] + left) & 255;
      }
    } else if (filterType === 2) {
      for (let x = 0; x < stride; x++) {
        row[x] = (filtered[x] + prevRow[x]) & 255;
      }
    } else if (filterType === 3) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
        const up = prevRow[x];
        row[x] = (filtered[x] + ((left + up) >> 1)) & 255;
      }
    } else if (filterType === 4) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
        const up = prevRow[x];
        const upLeft = x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;
        row[x] = (filtered[x] + paethPredictor(left, up, upLeft)) & 255;
      }
    } else {
      throw new Error(`Unsupported PNG scanline filter: ${filterType}.`);
    }

    prevRow = row;
    readOffset += stride + 1;
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  if (colorType === 6) {
    rgba.set(raw);
  } else {
    for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
      rgba[j] = raw[i];
      rgba[j + 1] = raw[i + 1];
      rgba[j + 2] = raw[i + 2];
      rgba[j + 3] = 255;
    }
  }

  return { width, height, rgba };
};

const summarizePalette = (paletteMap, limit = 20) => {
  const entries = [...paletteMap.entries()]
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .slice(0, limit);
  return entries.map(([key, count]) => {
    const meta = rgbToMeta.get(key);
    const name = meta?.name || key;
    return `${name}: ${count}`;
  });
};

const main = () => {
  const targetPath = process.argv[2] || 'files/ruswplace.png';
  const absolutePath = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`PNG not found: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  const { width, height, rgba } = parsePng(buffer);
  const before = inspectSourceImagePalette(rgba, width, height);
  const beforeOther = Number(before.paletteMap.get('other') || 0);

  const convertedInput = {
    width,
    height,
    data: new Uint8ClampedArray(rgba),
  };
  const options = normalizeTemplatePaletteConversionOptions(templatePaletteConversionDefaults);
  const converted = convertImageDataToWplacePalette(convertedInput, options);
  const after = inspectSourceImagePalette(converted.imageData.data, width, height);
  const afterOther = Number(after.paletteMap.get('other') || 0);

  console.log(`PNG: ${absolutePath}`);
  console.log(`Size: ${width}x${height}`);
  console.log('');
  console.log(`Before conversion -> required=${before.required}, deface=${before.deface}, other=${beforeOther}`);
  console.log(`After conversion  -> required=${after.required}, deface=${after.deface}, other=${afterOther}`);
  console.log(`Converter stats   -> nonPalettePixels=${converted.stats.nonPalettePixels}, convertedPixels=${converted.stats.convertedPixels}, remainingOtherPixels=${converted.stats.remainingOtherPixels}`);
  console.log('');
  console.log('Top colors (after conversion):');
  for (const line of summarizePalette(after.paletteMap)) {
    console.log(`- ${line}`);
  }

  if (Number(converted.stats.remainingOtherPixels || 0) !== afterOther) {
    throw new Error(`Mismatch: remainingOtherPixels(${converted.stats.remainingOtherPixels}) !== inspected other(${afterOther}).`);
  }
  if (afterOther > 0) {
    throw new Error(`Test failed: image still contains ${afterOther} "other" pixels after conversion.`);
  }
};

main();
