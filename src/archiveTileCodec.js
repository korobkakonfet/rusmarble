/** Archive tile decoding.
 *
 * wplace.eralyon.net stopped serving one PNG per archive version. It now ships one
 * zstd container per ISO-ish *week* per tile — `/tiles/{week}/{z}/{x}/{y}.zst`, where
 * `week = floor(version / 168)` — holding that week's base snapshot plus the hourly
 * deltas. The exact frame is reconstructed client-side by the site's own Rust/WASM
 * decoder, so there is no longer any URL that returns a ready-to-draw image.
 *
 * We reuse that decoder rather than reimplementing the container format: the glue is
 * vendored (`src/vendor/wimageWasm.js`) so nothing has to be eval'd at runtime, and the
 * ~280KB binary is pulled once per page load through GM_xmlhttpRequest (the archive
 * origin sends no CORS headers) instead of being baked into the userscript.
 *
 * @since 0.87.81
 */

import { initSync, get_image, init_panic_hook } from './vendor/wimageWasm.js';

/** Hours per archive bundle. Archive versions count hours since 2025-01-01. */
const ARCHIVE_WEEK_HOURS = 7 * 24;
const ARCHIVE_WASM_URL = 'https://wplace.eralyon.net/assets/wimage_wasm_bg.wasm';

/** Bundle that holds `version`. Versions outside a bundle's range still decode — the
 * decoder clamps to the nearest stored frame — so the caller must get this right.
 * @param {number|string} version
 * @returns {number}
 */
export function archiveVersionToWeek(version) {
  return Math.floor(Number(version) / ARCHIVE_WEEK_HOURS);
}

/** Build the container URL for one tile of one archive version.
 * @param {string} baseUrl - Archive origin, no trailing slash.
 * @param {number|string} version
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function archiveTileUrl(baseUrl, version, z, x, y) {
  return `${baseUrl}/tiles/${archiveVersionToWeek(version)}/${z}/${x}/${y}.zst`;
}

let wasmReady = null;

/** Fetch + instantiate the decoder once. Concurrent callers share the same promise, and
 * a failure clears it so a later tile can retry rather than poisoning the feature.
 * @returns {Promise<void>}
 */
function ensureArchiveWasm() {
  if (wasmReady) return wasmReady;
  wasmReady = new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      reject(new Error('GM_xmlhttpRequest is unavailable for the archive tile decoder.'));
      return;
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url: ARCHIVE_WASM_URL,
      responseType: 'arraybuffer',
      onload: (response) => {
        const status = Number(response?.status);
        const bytes = response?.response;
        if (status < 200 || status >= 300 || !bytes?.byteLength) {
          reject(new Error(`Archive decoder download failed (${status}).`));
          return;
        }
        try {
          initSync({ module: bytes });
          init_panic_hook();
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      onerror: (error) => reject(new Error(`Archive decoder download error: ${error?.message || error}`)),
      ontimeout: () => reject(new Error('Archive decoder download timed out.')),
    });
  }).catch((error) => {
    // Clear the memo so a later tile can retry instead of the first failure being permanent.
    // Callers (loadArchiveTile / downloadArchiveTile) surface the error themselves.
    wasmReady = null;
    throw error;
  });
  return wasmReady;
}

/** Reconstruct one archive tile as PNG bytes.
 * @param {number|string} version - Archive version (hours since 2025-01-01).
 * @param {ArrayBuffer|Uint8Array} container - Body of the `.zst` bundle for that tile.
 * @returns {Promise<ArrayBuffer>} PNG bytes.
 */
export async function decodeArchiveTile(version, container) {
  await ensureArchiveWasm();
  const bytes = container instanceof Uint8Array ? container : new Uint8Array(container);
  const png = get_image(Number(version), bytes);
  // `get_image` already returns a fresh copy, but its buffer may be a view into a larger
  // allocation — slice so the result is transferable across postMessage.
  return png.buffer.byteLength === png.byteLength
    ? png.buffer
    : png.slice().buffer;
}
