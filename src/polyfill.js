// Cap the number of Web Workers spawned across the app (MapLibre tile workers,
// template pixel worker pool, etc.). Both read navigator.hardwareConcurrency to
// size their pools, so clamping it here limits total concurrent workers.
const MAX_WEB_WORKERS = 6;
try {
  const actual = Number(navigator.hardwareConcurrency) || MAX_WEB_WORKERS;
  const capped = Math.max(1, Math.min(MAX_WEB_WORKERS, actual));
  if (capped !== actual) {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      get() { return capped; }
    });
  }
} catch (_) { /* navigator.hardwareConcurrency not overridable; ignore */ }

if (!window.OffscreenCanvas) {
  window.OffscreenCanvas = function (width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.convertToBlob = function ({ type, quality } = {}) {
      return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error("toBlob() returned null"));
        }, type, quality);
      });
    }
    return canvas;
  }
}

if (!Array.prototype.extend) {
  // Just like .push(...x)
  Array.prototype.extend = function (elements) {
    elements.forEach(element => this.push(element));
  }
}