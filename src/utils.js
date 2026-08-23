import { archiveTileUrl, decodeArchiveTile } from './archiveTileCodec.js';



/** Sanitizes HTML to display as plain-text.
 * This prevents some Cross Site Scripting (XSS).
 * This is handy when you are displaying user-made data, and you *must* use innerHTML.
 * @param {string} text - The text to sanitize
 * @returns {string} HTML escaped string
 * @since 0.44.2
 * @example
 * const paragraph = document.createElement('p');
 * paragraph.innerHTML = escapeHTML('<u>Foobar.</u>');
 * // Output:
 * // (Does not include the paragraph element)
 * // (Output is not HTML formatted)
 * <p>
 *   "<u>Foobar.</u>"
 * </p>
 */
export function escapeHTML(text) {
  const div = document.createElement('div'); // Creates a div
  div.textContent = text; // Puts the text in a PLAIN-TEXT property
  return div.innerHTML; // Returns the HTML property of the div
}

/** Converts the server tile-pixel coordinate system to the displayed tile-pixel coordinate system.
 * @param {string[]} tile - The tile to convert (as an array like ["12", "124"])
 * @param {string[]} pixel - The pixel to convert (as an array like ["12", "124"])
 * @returns {number[]} [tile, pixel]
 * @since 0.42.4
 * @example
 * console.log(serverTPtoDisplayTP(['12', '123'], ['34', '567'])); // [34, 3567]
 */
export function serverTPtoDisplayTP(tile, pixel) {
  return [((parseInt(tile[0]) % 4) * 1000) + parseInt(pixel[0]), ((parseInt(tile[1]) % 4) * 1000) + parseInt(pixel[1])];
}

/** Negative-Safe Modulo. You can pass negative numbers into this.
 * @param {number} a - The first number
 * @param {number} b - The second number
 * @returns {number} Result
 * @author osuplace
 * @since 0.55.8
 */
export function negativeSafeModulo(a, b) {
  return (a % b + b) % b;
}

let debugLoggingEnabled = false;
export function setDebugLoggingEnabled(value) {
  debugLoggingEnabled = value === true;
}

export function isDebugLoggingEnabled() {
  return debugLoggingEnabled === true;
}

/** Bypasses terser's stripping of console function calls.
 * This is so the non-obfuscated code will contain debugging console calls, but the distributed version won't.
 * However, the distributed version needs to call the console somehow, so this wrapper function is how.
 * This is the same as `console.log()`.
 * @param {...any} args - Arguments to be passed into the `log()` function of the Console
 * @since 0.58.9
 */
export function consoleLog(...args) {
  if (!debugLoggingEnabled) return;
  ((consoleLog) => consoleLog(...args))(console.log);
}

/** Bypasses terser's stripping of console function calls.
 * This is so the non-obfuscated code will contain debugging console calls, but the distributed version won't.
 * However, the distributed version needs to call the console somehow, so this wrapper function is how.
 * This is the same as `console.error()`.
 * @param {...any} args - Arguments to be passed into the `error()` function of the Console
 * @since 0.58.13
 */
export function consoleError(...args) {((consoleError) => consoleError(...args))(console.error);}

/** Bypasses terser's stripping of console function calls.
 * This is so the non-obfuscated code will contain debugging console calls, but the distributed version won't.
 * However, the distributed version needs to call the console somehow, so this wrapper function is how.
 * This is the same as `console.warn()`.
 * @param {...any} args - Arguments to be passed into the `warn()` function of the Console
 * @since 0.58.13
 */
export function consoleWarn(...args) {((consoleWarn) => consoleWarn(...args))(console.warn);}

/** Encodes a number into a custom encoded string.
 * @param {number} number - The number to encode
 * @param {string} encoding - The characters to use when encoding
 * @since 0.65.2
 * @returns {string} Encoded string
 * @example
 * const encode = '012abcABC'; // Base 9
 * console.log(numberToEncoded(0, encode)); // 0
 * console.log(numberToEncoded(5, encode)); // c
 * console.log(numberToEncoded(15, encode)); // 1A
 * console.log(numberToEncoded(12345, encode)); // 1BCaA
 */
export function numberToEncoded(number, encoding) {

  if (number === 0) return encoding[0]; // End quickly if number equals 0. No special calculation needed

  let result = ''; // The encoded string
  const base = encoding.length; // The number of characters used, which determines the base

  // Base conversion algorithm
  while (number > 0) {
    result = encoding[number % base] + result; // Find's the character's encoded value determined by the modulo of the base
    number = Math.floor(number / base); // Divides the number by the base so the next iteration can find the next modulo character
  }

  return result; // The final encoded string
}

/** Converts a Uint8 array to base64 using the browser's built-in binary to ASCII function
 * @param {Uint8Array} uint8 - The Uint8Array to convert
 * @returns {Uint8Array} The base64 encoded Uint8Array
 * @since 0.72.9
 */
export function uint8ToBase64(uint8) {
  if (!(uint8 instanceof Uint8Array) || uint8.length === 0) {
    return '';
  }
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength).toString('base64');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks = [];
  let chunk = '';
  let index = 0;
  const flushChunk = () => {
    if (chunk) {
      chunks.push(chunk);
      chunk = '';
    }
  };
  while (index + 2 < uint8.length) {
    const value = (uint8[index] << 16) | (uint8[index + 1] << 8) | uint8[index + 2];
    chunk += alphabet[(value >> 18) & 63]
      + alphabet[(value >> 12) & 63]
      + alphabet[(value >> 6) & 63]
      + alphabet[value & 63];
    index += 3;
    if (chunk.length >= 16384) {
      flushChunk();
    }
  }
  const remaining = uint8.length - index;
  if (remaining === 1) {
    const value = uint8[index];
    chunk += alphabet[(value >> 2) & 63]
      + alphabet[(value & 3) << 4]
      + '==';
  } else if (remaining === 2) {
    const value = (uint8[index] << 8) | uint8[index + 1];
    chunk += alphabet[(value >> 10) & 63]
      + alphabet[(value >> 4) & 63]
      + alphabet[(value & 15) << 2]
      + '=';
  }
  flushChunk();
  return chunks.join('');
}

/** Decodes a base 64 encoded Uint8 array using the browser's built-in ASCII to binary function
 * @param {Uint8Array} base64 - The base 64 encoded Uint8Array to convert
 * @returns {Uint8Array} The decoded Uint8Array
 * @since 0.72.9
 */
export function base64ToUint8(base64) {
  const binary = atob(base64); // ASCII to Binary
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return array;
}

/** Marker prefix for a gzip-compressed, base64-wrapped template buffer payload.
 * Shared so the worker (which writes it) and templateManager (which reads it) cannot drift.
 * @since 0.87.80
 */
export const TEMPLATE_BUFFER_GZIP_PREFIX = 'GZ1:';

/** True when this realm exposes the native compression streams. Available on workers too. */
export const canCompressTemplateBuffers = () => (
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
);

/** gzip a string and wrap it in base64 so it can ride the JSON-only GM storage channel.
 * Returns null when unavailable or on failure, so callers fall back to the plain JSON.
 * @since 0.87.80
 */
export async function compressTemplateBufferPayload(json) {
  if (!canCompressTemplateBuffers()) return null;
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return TEMPLATE_BUFFER_GZIP_PREFIX + uint8ToBase64(bytes);
  } catch (_) {
    return null;
  }
}

/** Returns the coordinate input fields
 * @returns {Element[]} The 4 coordinate Inputs
 * @since 0.74.0
 */
export function selectAllCoordinateInputs(document) {
  const coords = [];

  coords.push(document.querySelector('#bm-input-tx'));
  coords.push(document.querySelector('#bm-input-ty'));
  coords.push(document.querySelector('#bm-input-px'));
  coords.push(document.querySelector('#bm-input-py'));

  return coords;
}

/** The color palette used by wplace.live
 * @since 0.78.0
 * @examples
 * import utils from 'src/utils.js';
 * console.log(utils[5]?.name); // "White"
 * console.log(utils[5]?.rgb); // [255, 255, 255]
 */
export const colorpalette = [
  { "id": 0,  "premium": false, "name": "Transparent",   "rgb": [0, 0, 0] },
  { "id": 1,  "premium": false, "name": "Black",         "rgb": [0, 0, 0] },
  { "id": 2,  "premium": false, "name": "Dark Gray",     "rgb": [60, 60, 60] },
  { "id": 3,  "premium": false, "name": "Gray",          "rgb": [120, 120, 120] },
  { "id": 4,  "premium": false, "name": "Light Gray",    "rgb": [210, 210, 210] },
  { "id": 5,  "premium": false, "name": "White",         "rgb": [255, 255, 255] },
  { "id": 6,  "premium": false, "name": "Deep Red",      "rgb": [96, 0, 24] },
  { "id": 7,  "premium": false, "name": "Red",           "rgb": [237, 28, 36] },
  { "id": 8,  "premium": false, "name": "Orange",        "rgb": [255, 127, 39] },
  { "id": 9,  "premium": false, "name": "Gold",          "rgb": [246, 170, 9] },
  { "id": 10, "premium": false, "name": "Yellow",        "rgb": [249, 221, 59] },
  { "id": 11, "premium": false, "name": "Light Yellow",  "rgb": [255, 250, 188] },
  { "id": 12, "premium": false, "name": "Dark Green",    "rgb": [14, 185, 104] },
  { "id": 13, "premium": false, "name": "Green",         "rgb": [19, 230, 123] },
  { "id": 14, "premium": false, "name": "Light Green",   "rgb": [135, 255, 94] },
  { "id": 15, "premium": false, "name": "Dark Teal",     "rgb": [12, 129, 110] },
  { "id": 16, "premium": false, "name": "Teal",          "rgb": [16, 174, 166] },
  { "id": 17, "premium": false, "name": "Light Teal",    "rgb": [19, 225, 190] },
  { "id": 18, "premium": false, "name": "Dark Blue",     "rgb": [40, 80, 158] },
  { "id": 19, "premium": false, "name": "Blue",          "rgb": [64, 147, 228] },
  { "id": 20, "premium": false, "name": "Cyan",          "rgb": [96, 247, 242] },
  { "id": 21, "premium": false, "name": "Indigo",        "rgb": [107, 80, 246] },
  { "id": 22, "premium": false, "name": "Light Indigo",  "rgb": [153, 177, 251] },
  { "id": 23, "premium": false, "name": "Dark Purple",   "rgb": [120, 12, 153] },
  { "id": 24, "premium": false, "name": "Purple",        "rgb": [170, 56, 185] },
  { "id": 25, "premium": false, "name": "Light Purple",  "rgb": [224, 159, 249] },
  { "id": 26, "premium": false, "name": "Dark Pink",     "rgb": [203, 0, 122] },
  { "id": 27, "premium": false, "name": "Pink",          "rgb": [236, 31, 128] },
  { "id": 28, "premium": false, "name": "Light Pink",    "rgb": [243, 141, 169] },
  { "id": 29, "premium": false, "name": "Dark Brown",    "rgb": [104, 70, 52] },
  { "id": 30, "premium": false, "name": "Brown",         "rgb": [149, 104, 42] },
  { "id": 31, "premium": false, "name": "Beige",         "rgb": [248, 178, 119] },
  { "id": 32, "premium": true,  "name": "Medium Gray",   "rgb": [170, 170, 170] },
  { "id": 33, "premium": true,  "name": "Dark Red",      "rgb": [165, 14, 30] },
  { "id": 34, "premium": true,  "name": "Light Red",     "rgb": [250, 128, 114] },
  { "id": 35, "premium": true,  "name": "Dark Orange",   "rgb": [228, 92, 26] },
  { "id": 36, "premium": true,  "name": "Light Tan",     "rgb": [214, 181, 148] },
  { "id": 37, "premium": true,  "name": "Dark Goldenrod","rgb": [156, 132, 49] },
  { "id": 38, "premium": true,  "name": "Goldenrod",     "rgb": [197, 173, 49] },
  { "id": 39, "premium": true,  "name": "Light Goldenrod","rgb": [232, 212, 95] },
  { "id": 40, "premium": true,  "name": "Dark Olive",    "rgb": [74, 107, 58] },
  { "id": 41, "premium": true,  "name": "Olive",         "rgb": [90, 148, 74] },
  { "id": 42, "premium": true,  "name": "Light Olive",   "rgb": [132, 197, 115] },
  { "id": 43, "premium": true,  "name": "Dark Cyan",     "rgb": [15, 121, 159] },
  { "id": 44, "premium": true,  "name": "Light Cyan",    "rgb": [187, 250, 242] },
  { "id": 45, "premium": true,  "name": "Light Blue",    "rgb": [125, 199, 255] },
  { "id": 46, "premium": true,  "name": "Dark Indigo",   "rgb": [77, 49, 184] },
  { "id": 47, "premium": true,  "name": "Dark Slate Blue","rgb": [74, 66, 132] },
  { "id": 48, "premium": true,  "name": "Slate Blue",    "rgb": [122, 113, 196] },
  { "id": 49, "premium": true,  "name": "Light Slate Blue","rgb": [181, 174, 241] },
  { "id": 50, "premium": true,  "name": "Light Brown",   "rgb": [219, 164, 99] },
  { "id": 51, "premium": true,  "name": "Dark Beige",    "rgb": [209, 128, 81] },
  { "id": 52, "premium": true,  "name": "Light Beige",   "rgb": [255, 197, 165] },
  { "id": 53, "premium": true,  "name": "Dark Peach",    "rgb": [155, 82, 73] },
  { "id": 54, "premium": true,  "name": "Peach",         "rgb": [209, 128, 120] },
  { "id": 55, "premium": true,  "name": "Light Peach",   "rgb": [250, 182, 164] },
  { "id": 56, "premium": true,  "name": "Dark Tan",      "rgb": [123, 99, 82] },
  { "id": 57, "premium": true,  "name": "Tan",           "rgb": [156, 132, 107] },
  { "id": 58, "premium": true,  "name": "Dark Slate",    "rgb": [51, 57, 65] },
  { "id": 59, "premium": true,  "name": "Slate",         "rgb": [109, 117, 141] },
  { "id": 60, "premium": true,  "name": "Light Slate",   "rgb": [179, 185, 209] },
  { "id": 61, "premium": true,  "name": "Dark Stone",    "rgb": [109, 100, 63] },
  { "id": 62, "premium": true,  "name": "Stone",         "rgb": [148, 140, 107] },
  { "id": 63, "premium": true,  "name": "Light Stone",   "rgb": [205, 197, 158] }
];
// All entries include fixed id (index-based) and premium flag by design.

// This actually should have the exact same keys as rgbToMeta
// export const allowedColorsSet = new Set(
//   colorpalette
//     .filter(color => (color?.name || '').toLowerCase() !== 'transparent' && Array.isArray(color?.rgb))
//     .map(color => `${color.rgb[0]},${color.rgb[1]},${color.rgb[2]}`)
// );

export const rgbToMeta = new Map(
  colorpalette
    .filter(color => Array.isArray(color?.rgb))
    .map(color => [ `${color.rgb[0]},${color.rgb[1]},${color.rgb[2]}`, { id: color.id, premium: !!color.premium, name: color.name } ])
); // Notice that transparent (0) is overriden by black (1) here

// Ensure template #deface marker is treated as allowed (maps to Transparent color)
const defaceKey = '222,250,206';
// allowedColorsSet.add(defaceKey);
// Map #deface to Transparent meta for UI naming and ID continuity
try {
  const transparent = colorpalette.find(color => (color?.name || '').toLowerCase() === 'transparent');
  if (transparent && Array.isArray(transparent.rgb)) {
    rgbToMeta.set(defaceKey, { id: transparent.id, premium: !!transparent.premium, name: transparent.name });
  }
} catch (ignored) {}

// Map other key to Other meta for UI naming and ID continuity
const keyOther = 'other';
// allowedColorsSet.add(keyOther); // Special "other" key for non-palette colors
try {
  rgbToMeta.set(keyOther, { id: 'other', premium: false, name: 'Other' });
} catch (ignored) {}

/** Create an ImageBitmap from a canvas, blob, or ImageData source.
 * @param {CanvasImageSource|Blob|ImageData} source
 * @returns {Promise<ImageBitmap>}
 */
export async function createBitmapPreservingPixels(source) {
  // Prefer raw pixel decode path to avoid browser-specific color-space conversion differences
  // (notably between Chromium variants on wide-gamut / color-managed systems).
  try {
    return await createImageBitmap(source, {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
      imageOrientation: 'none',
    });
  } catch (_) {
    return createImageBitmap(source);
  }
}

/** Releases the canvas content to free up memory.
 * @since 0.85.5
 */
export function cleanUpCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
  if (canvas.constructor === HTMLCanvasElement) canvas.remove(); // not for OffscreenCanvas
  canvas = null;
}

/**
 * A browser helper function to find the gadget exposed in the DOM tree
 * @since 0.85.9
 * @deprecated only for demo purpose
 */
function findGadget(condition, depth=10) {
  const seen = new Set();
  const allElements = [...document.querySelectorAll("*")];
  function search(parent, path, element, maxDepth) {
    if (condition(element)) {
      return [element, parent, path];
    }
    if (maxDepth === 0) {
      return null;
    }
    if (element && typeof element === "object") {
      if (Array.isArray(element)) {
        for (const [index, value] of Object.entries(element)) {
          if (seen.has(value)) continue;
          seen.add(value);
          const searchResult = search(parent, path + "[" + index + "]", value, maxDepth - 1);
          if (searchResult !== null) return searchResult;
        }
      } else {
        for (const [key, value] of Object.entries(element)) {
          if (seen.has(value)) continue;
          seen.add(value);
          const searchResult = search(parent, path + "." + key, value, maxDepth - 1);
          if (searchResult !== null) return searchResult;
        }
      }
    }
    return null;
  }
  for (const element of allElements) {
    const searchResult = search(element, "$0.__click", element.__click, depth);
    if (searchResult !== null) return searchResult;
  }
  return null;
}

/** Get raw coordinates from the BM overlay
 * @since 0.85.28
 */
function getOverlayCoordsRaw() {
  const tx = document.querySelector('#bm-input-tx')?.value || '';
  const ty = document.querySelector('#bm-input-ty')?.value || '';
  const px = document.querySelector('#bm-input-px')?.value || '';
  const py = document.querySelector('#bm-input-py')?.value || '';
  return [[tx, ty], [px, py]];
}

/** Get coordinates from the BM overlay
 * @since 0.85.20
 */
export function getOverlayCoords() {
  const rawCoords = getOverlayCoordsRaw();
  const tx = Number(rawCoords[0][0]);
  const ty = Number(rawCoords[0][1]);
  const px = Number(rawCoords[1][0]);
  const py = Number(rawCoords[1][1]);
  return [[tx, ty], [px, py]];
}


/** Available sorting options
 * @since 0.85.23
 * @examples
 * The function parameter is (rgb, enabled count, painted enabled count)
 */
export const sortByOptions = {
  "total": ([rgb, paintedCount, totalCount]) => totalCount,
  "painted": ([rgb, paintedCount, totalCount]) => paintedCount,
  "remaining": ([rgb, paintedCount, totalCount]) => totalCount - paintedCount,
  "painted%": ([rgb, paintedCount, totalCount]) => paintedCount / (totalCount === 0 ? 1 : totalCount),
  "hue": ([rgb, paintedCount, totalCount]) => {
    if (rgb === "other") return 361; // Force After All Colors
    if (rgb === "#deface") return -1; // Force Before All Colors
    const [r, g, b] = rgb.split(',').map(Number);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (delta === 0) return 361 + r; // Grayscale: Force After All Colors
    if (max === r) {
      return ((((g - b) / delta) + 6) % 6) * 60;
    } else if (max === g) {
      return (((b - r) / delta) + 2) * 60;
    } else {
      return (((r - g) / delta) + 4) * 60;
    }
  },
  "luminance": ([rgb, paintedCount, totalCount]) => {
    if (rgb === "other") return 2; // Force After All Colors
    if (rgb === "#deface") return 0; // Force Before All Colors
    const [r, g, b] = rgb.split(',').map(Number);
    return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255; // Range: 0-1
  },
}

/** Copy the specified text to Clipboard
 * @param {string} text
 * @since 0.85.28
 */
export function copyToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text);
  } else {
    var temp = document.createElement("textArea");
    temp.innerHTML = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
  }
}

/** Calculate the top left and size of the image to export
 * The dimensions are inclusive (e.g. 11 for x: [0, 10])
 * @since 0.85.28
 */
export function calculateTopLeftAndSize(coords1, coords2) {
  const xs = [
    (coords1[0][0] % 2048) * 1000 + (coords1[1][0] % 1000),
    (coords2[0][0] % 2048) * 1000 + (coords2[1][0] % 1000),
  ];
  const ys = [
    (coords1[0][1] % 2048) * 1000 + (coords1[1][1] % 1000),
    (coords2[0][1] % 2048) * 1000 + (coords2[1][1] % 1000),
  ];
  const top = Math.min(ys[0], ys[1]);
  const height = Math.abs(ys[0] - ys[1]) + 1;
  const rawWidth = Math.abs(xs[0] - xs[1]) + 1;
  const earthWrap = rawWidth * 2 > 2048 * 1000;
  const left = earthWrap ? Math.max(xs[0], xs[1]) : Math.min(xs[0], xs[1]);
  const width = earthWrap ? (2048 * 1000 - rawWidth + 2) : rawWidth;
  return [[left, top], [width, height]];
}

/** Test if the browser support canvas size of the specified dimensions
 * @param {number} width
 * @param {number} height
 * @since 0.85.28
 */
export function testCanvasSize(width, height) {
  // Check if the browser support canvas size of the specified dimensions
  let canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillRect(width - 1, height - 1, 1, 1);
  const result = context.getImageData(width - 1, height - 1, 1, 1).data[3] !== 0;
  // Release canvas
  cleanUpCanvas(canvas);
  canvas = null;
  return result;
}

/** Test if the browser uses anti-fingerprinting mechanisms
 * @since 0.85.43
 */
export function testAntiFingerprint() {
  // Check if the browser support canvas size of the specified dimensions
  const testSize = 100;
  let canvas = new OffscreenCanvas(testSize, testSize);
  const context = canvas.getContext('2d');
  context.fillStyle = "rgba(255, 255, 255, 1)";
  context.fillRect(0, 0, testSize, testSize);
  const imageData = context.getImageData(0, 0, testSize, testSize);
  const result = imageData.data.some(e => e !== 255);
  // Release canvas
  cleanUpCanvas(canvas);
  canvas = null;
  return result;
}

/** Fetch the tile image
 * @param {number} tx
 * @param {number} ty
 * @param {{ source?: "live" | "archive", archiveBaseUrl?: string, archiveVersion?: string, liveBaseUrl?: string }} options
 * @since 0.85.28
 */
const ARCHIVE_TILE_ZOOM = 11;
const ARCHIVE_TILE_BASE_URL = 'https://wplace.eralyon.net';
const LIVE_TILE_BASE_URL = 'https://backend.wplace.live/files/s0/tiles';

const normalizeBaseUrl = (rawUrl, fallbackUrl) => {
  const fallback = String(fallbackUrl || '').trim();
  const value = String(rawUrl ?? '').trim();
  if (!value) return fallback;
  return value.replace(/\/+$/, '');
};

const gmFetchBlob = (url) => new Promise((resolve, reject) => {
  if (typeof GM_xmlhttpRequest !== 'function') {
    reject(new Error('GM_xmlhttpRequest is unavailable for archive tile download.'));
    return;
  }
  GM_xmlhttpRequest({
    method: 'GET',
    url,
    responseType: 'blob',
    onload: (response) => {
      const status = Number(response?.status);
      if (status === 404) {
        resolve(null);
        return;
      }
      if (status < 200 || status >= 300) {
        reject(new Error(`Request failed (${status}) for ${url}`));
        return;
      }
      const blob = response?.response;
      if (!blob) {
        reject(new Error(`Empty response body for ${url}`));
        return;
      }
      resolve(blob);
    },
    onerror: (error) => {
      reject(new Error(`Network error for ${url}: ${error?.message || error}`));
    }
  });
});

const blobToImage = (blob) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(img);
  };
  img.onerror = (error) => {
    URL.revokeObjectURL(objectUrl);
    reject(error);
  };
  img.src = objectUrl;
});

const downloadLiveTile = (tx, ty, options = {}) => {
  const liveBaseUrl = normalizeBaseUrl(options?.liveBaseUrl, LIVE_TILE_BASE_URL);
  const remoteURL = `${liveBaseUrl}/${tx % 2048}/${ty}.png`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      resolve(img);
    };
    img.onerror = function(error) {
      reject(error);
    };
    img.src = remoteURL;
  });
};

/** Pull one archive tile and reconstruct it for the requested version.
 *
 * The archive serves a zstd bundle per week per tile rather than a PNG per version;
 * `decodeArchiveTile` rebuilds the requested frame from it. See archiveTileCodec.js.
 */
const downloadArchiveTile = async (tx, ty, options = {}) => {
  const archiveBaseUrl = normalizeBaseUrl(options?.archiveBaseUrl, ARCHIVE_TILE_BASE_URL);
  const version = String(options?.archiveVersion ?? '').trim();
  if (!version) {
    throw new Error('Archive version is required.');
  }
  const safeTx = ((Number(tx) % 2048) + 2048) % 2048;
  const safeTy = Number(ty);
  if (!Number.isFinite(safeTy)) {
    throw new Error('Archive tile Y coordinate is invalid.');
  }
  const containerUrl = archiveTileUrl(archiveBaseUrl, version, ARCHIVE_TILE_ZOOM, safeTx, safeTy);
  const blob = await gmFetchBlob(containerUrl);
  if (!blob) {
    throw new Error(`Archive tile not found at ${containerUrl}`);
  }
  const png = await decodeArchiveTile(version, await blob.arrayBuffer());
  return blobToImage(new Blob([png], { type: 'image/png' }));
};

export function downloadTile(tx, ty, options = {}) {
  const source = String(options?.source || 'live').toLowerCase();
  if (source === 'archive') {
    return downloadArchiveTile(tx, ty, options);
  }
  return downloadLiveTile(tx, ty, options);
}

/** Get the currently selected color
 * @return {number}
 * @since 0.85.37
 */
export function getCurrentColor() {
  const currentColor = Number(localStorage.getItem("selected-color")) ?? 0;
  if (isNaN(currentColor) || !isFinite(currentColor) || currentColor < 0 || currentColor >= 64) return 0;
  return currentColor;
}

/** Do an async sleep to prevent UI blocking
 * @param {number} delay
 * @since 0.85.43
 * @deprecated currently does not feel the need to use so
 */
export function sleep(delay = 0) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

/* ------------------------------------------------------------------------- *
 * Mobile layout detection
 *
 * The script has to work on phones as well as desktops. Rather than sprinkling
 * `window.innerWidth` checks around, everything keys off a single flag that is
 * mirrored onto `<html data-bm-mobile="1">` so CSS and JS always agree.
 * ------------------------------------------------------------------------- */

/** Media query that decides whether the mobile layout is active.
 * Mirrors the `@media` condition used in overlay.css - keep the two in sync.
 * @since 0.87.70
 */
export const MOBILE_LAYOUT_MEDIA = '(max-width: 640px), (pointer: coarse)';

let mobileLayoutQuery = null;
let mobileLayoutActive = false;
const mobileLayoutListeners = new Set();

function getMobileLayoutQuery() {
  if (mobileLayoutQuery === null && typeof window?.matchMedia === 'function') {
    mobileLayoutQuery = window.matchMedia(MOBILE_LAYOUT_MEDIA);
  }
  return mobileLayoutQuery;
}

/** Whether the UI should use the touch/small-screen layout.
 * @returns {boolean} True when the mobile layout is active
 * @since 0.87.70
 */
export function isMobileLayout() {
  const query = getMobileLayoutQuery();
  return query ? query.matches : mobileLayoutActive;
}

/** Whether the primary pointer is coarse (finger) rather than fine (mouse).
 * Used for interaction decisions (tap targets, hover fallbacks) that should not
 * follow a merely narrow desktop window.
 * @returns {boolean} True on touch-primary devices
 * @since 0.87.70
 */
export function isCoarsePointer() {
  return typeof window?.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** Subscribes to mobile-layout changes (rotation, resize, devtools emulation).
 * @param {(isMobile: boolean) => void} callback - Called whenever the mode flips
 * @returns {() => void} Unsubscribe function
 * @since 0.87.70
 */
export function onMobileLayoutChange(callback) {
  if (typeof callback !== 'function') {return () => {};}
  mobileLayoutListeners.add(callback);
  return () => {mobileLayoutListeners.delete(callback);};
}

/** Starts mirroring the mobile-layout flag onto the document element.
 * Safe to call more than once; only the first call installs listeners.
 * @since 0.87.70
 */
export function initMobileLayout() {
  const query = getMobileLayoutQuery();
  const apply = () => {
    const next = query ? query.matches : false;
    const changed = next !== mobileLayoutActive;
    mobileLayoutActive = next;
    const root = document.documentElement;
    if (root) {
      if (next) {
        root.setAttribute('data-bm-mobile', '1');
      } else {
        root.removeAttribute('data-bm-mobile');
      }
    }
    if (changed) {
      for (const listener of mobileLayoutListeners) {
        try {
          listener(next);
        } catch (error) {
          consoleWarn('Mobile layout listener failed', error);
        }
      }
    }
  };

  apply();

  if (!query || initMobileLayout.installed) {return;}
  initMobileLayout.installed = true;
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', apply);
  } else if (typeof query.addListener === 'function') {
    query.addListener(apply); // Safari < 14
  }
}

/* ------------------------------------------------------------------------- *
 * Pointer-based dragging
 *
 * Pointer Events cover mouse, touch and pen in a single code path, so every
 * floating panel uses these helpers instead of hand-rolled mousedown/mousemove
 * pairs (which silently did nothing on phones).
 * ------------------------------------------------------------------------- */

/** Default gap kept between a floating panel and the viewport edge. */
const PANEL_VIEWPORT_MARGIN = 8;

const floatingPanels = new Set();
let floatingPanelWatchInstalled = false;

/** Pulls a floating panel back inside the viewport.
 * Panels are positioned with inline `left`/`top`, so a panel dragged to the
 * right edge in landscape ends up off-screen after rotating to portrait.
 * @param {HTMLElement} panel - The panel to clamp
 * @param {number} [margin] - Minimum gap from the viewport edge
 * @since 0.87.70
 */
export function clampPanelIntoViewport(panel, margin = PANEL_VIEWPORT_MARGIN) {
  if (!panel || !panel.isConnected) {return;}
  // Panels laid out entirely by CSS (the mobile sheets) have no inline position to fix.
  if (!panel.style.left && !panel.style.top) {return;}
  const rect = panel.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {return;} // Hidden
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  const left = Math.min(maxLeft, Math.max(margin, rect.left));
  const top = Math.min(maxTop, Math.max(margin, rect.top));
  if (Math.abs(left - rect.left) > 0.5) {panel.style.left = `${left}px`;}
  if (Math.abs(top - rect.top) > 0.5) {panel.style.top = `${top}px`;}
}

/** Registers a floating panel so it is re-clamped on resize/rotation.
 * @param {HTMLElement} panel - The panel to track
 * @param {number} [margin] - Minimum gap from the viewport edge
 * @returns {() => void} Unregister function
 * @since 0.87.70
 */
export function registerFloatingPanel(panel, margin = PANEL_VIEWPORT_MARGIN) {
  if (!panel) {return () => {};}
  const entry = {panel, margin};
  floatingPanels.add(entry);

  if (!floatingPanelWatchInstalled) {
    floatingPanelWatchInstalled = true;
    const reclamp = () => {
      for (const item of Array.from(floatingPanels)) {
        if (!item.panel.isConnected) {
          floatingPanels.delete(item); // Panel was closed; stop tracking it
          continue;
        }
        clampPanelIntoViewport(item.panel, item.margin);
      }
    };
    window.addEventListener('resize', reclamp);
    window.addEventListener('orientationchange', () => {
      // Mobile browsers report stale dimensions immediately after rotation.
      window.setTimeout(reclamp, 150);
    });
  }

  return () => {floatingPanels.delete(entry);};
}

/** Whether a pointerdown landed on a control and so must not start a drag.
 * @param {PointerEvent} event - The pointer event
 * @returns {boolean} True when the target is interactive
 */
function isInteractiveTarget(event) {
  if (!(event.target instanceof Element)) {return false;}
  return !!event.target.closest('button, input, select, textarea, a, [contenteditable="true"]');
}

/** Makes a floating panel draggable by a handle, using Pointer Events.
 *
 * Replaces the mousedown/mousemove/mouseup trio that used to be duplicated at
 * every call site. Pointer capture keeps the drag alive when the finger leaves
 * the handle, so no document-level listeners are needed.
 *
 * @param {HTMLElement} handle - The element the user grabs (usually the header)
 * @param {HTMLElement} panel - The element that moves
 * @param {Object} [options] - Options
 * @param {number} [options.margin] - Minimum gap from the viewport edge
 * @param {() => boolean} [options.enabled] - Return false to ignore a drag attempt
 * @param {(moved: boolean) => void} [options.onEnd] - Called when the drag finishes
 * @returns {() => void} Teardown function that removes all listeners
 * @since 0.87.70
 */
export function makePanelDraggable(handle, panel, options = {}) {
  if (!handle || !panel) {return () => {};}
  const margin = options.margin ?? PANEL_VIEWPORT_MARGIN;
  let dragState = null;

  // Without this the browser claims the gesture for scrolling/zooming the map
  // before the first pointermove ever reaches us.
  handle.style.touchAction = 'none';

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {return;}
    if (typeof options.enabled === 'function' && !options.enabled()) {return;}
    if (isInteractiveTarget(event)) {return;}
    const rect = panel.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (_) { /* Capture is best-effort */ }
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {return;}
    if (!dragState.moved) {
      const dx = Math.abs(event.clientX - dragState.startX);
      const dy = Math.abs(event.clientY - dragState.startY);
      if (dx > 3 || dy > 3) {dragState.moved = true;}
    }
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.min(maxLeft, Math.max(margin, event.clientX - dragState.offsetX));
    const top = Math.min(maxTop, Math.max(margin, event.clientY - dragState.offsetY));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    event.preventDefault();
  };

  const onPointerEnd = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {return;}
    const moved = dragState.moved;
    try {
      handle.releasePointerCapture(dragState.pointerId);
    } catch (_) { /* Already released */ }
    dragState = null;
    options.onEnd?.(moved);
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerEnd);
  handle.addEventListener('pointercancel', onPointerEnd);

  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerEnd);
    handle.removeEventListener('pointercancel', onPointerEnd);
    dragState = null;
  };
}

/** Makes an element pannable by dragging, using Pointer Events.
 *
 * Used for the zoomable template previews, where the caller owns the pan state
 * and only needs the offset from the drag origin.
 *
 * @param {HTMLElement} element - The element to pan
 * @param {Object} options - Options
 * @param {(event: PointerEvent) => (Object|false|null)} options.onStart - Return falsy to reject the drag; the value is handed back to onMove/onEnd
 * @param {(dx: number, dy: number, context: Object) => void} options.onMove - Called with the offset from the drag origin
 * @param {(context: Object) => void} [options.onEnd] - Called when the drag finishes
 * @param {string} [options.touchAction] - Override the `touch-action` applied to the element
 * @returns {() => void} Teardown function that removes all listeners
 * @since 0.87.70
 */
export function makePointerPannable(element, options) {
  if (!element || typeof options?.onStart !== 'function') {return () => {};}
  let dragState = null;

  // Panning is this element's purpose, so take the gesture away from scrolling.
  element.style.touchAction = options.touchAction ?? 'none';

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {return;}
    const context = options.onStart(event);
    if (!context) {return;}
    dragState = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, context};
    try {
      element.setPointerCapture(event.pointerId);
    } catch (_) { /* Capture is best-effort */ }
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {return;}
    options.onMove(event.clientX - dragState.startX, event.clientY - dragState.startY, dragState.context);
    event.preventDefault();
  };

  const onPointerEnd = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {return;}
    const context = dragState.context;
    try {
      element.releasePointerCapture(dragState.pointerId);
    } catch (_) { /* Already released */ }
    dragState = null;
    options.onEnd?.(context);
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerEnd);
  element.addEventListener('pointercancel', onPointerEnd);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerEnd);
    element.removeEventListener('pointercancel', onPointerEnd);
    dragState = null;
  };
}
