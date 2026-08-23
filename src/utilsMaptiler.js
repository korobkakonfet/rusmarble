import { consoleLog, consoleError, consoleWarn } from "./utils.js";
import { profiler } from './profiler.js';
import { archiveTileUrl, decodeArchiveTile } from './archiveTileCodec.js';

let suppressForcedTileRefresh = false;
let hoverGhostLayerAdded = false;

export function setForcedTileRefreshSuppressed(value) {
  suppressForcedTileRefresh = Boolean(value);
}

export function isMapTilerLoaded() {
  if (isMapFound) return true;
  const myLocationButton = document.querySelector(".right-3>button");
  if ( myLocationButton === null ) {
    return false;
  }
  if (myLocationButton["__click"] !== undefined) {
    isMapFound = (
      typeof myLocationButton["__click"] === "object" && // not a function yet
      myLocationButton["__click"][3] !== undefined &&
      myLocationButton["__click"][3]["v"] !== undefined &&
      myLocationButton["__click"][3]["v"]["addSource"] !== undefined
    ) || document.head["__bmmap"] !== undefined;
  } else {
    const injector = () => {
      const script = document.currentScript;
      if (document.head["__bmmap"]) {
        script.setAttribute('bm-result', 'true');
        return;
      }
      try {
        const mapAddSource = document.querySelector(".right-3>button")["__click"][3]["v"]["addSource"];
        if (mapAddSource !== undefined) {
          script.setAttribute('bm-result', 'true');
        } else {
          script.setAttribute('bm-result', 'false');
        }
      } catch (e) {
        if (e instanceof TypeError) {
          script.setAttribute('bm-result', 'false');
        }
      }
    }
    const script = document.createElement('script');
    script.textContent = `(${injector})();`;
    document.documentElement?.appendChild(script);
    const result = script.getAttribute('bm-result') === 'true';
    script.remove();
    isMapFound = result;
  }
  if (isMapFound) {
    mapFoundHandlers.forEach(handler => handler());
  }
  return isMapFound;
}

/** Returns true only when the map is found AND its style has finished loading.
 * Safe to call even before the map object is found.
 */
export function isMapStyleLoaded() {
  if (!isMapTilerLoaded()) return false;
  try {
    return controlMapTiler(map => map['isStyleLoaded']?.() ?? true) === true;
  } catch (_) {
    return false;
  }
}

/** Wplace like breaking things
 * @since 0.85.43
 * @deprecated Not in use since 0.86.1
 */
export function isWplaceDoingBadThing() {
  const myLocationButton = document.querySelector(".right-3>button");
  if ( myLocationButton === null ) {
    return false;
  }
  if (myLocationButton["__click"] !== undefined) {
    return (
      typeof myLocationButton["__click"] !== "object"
    ) && document.head["__bmmap"] === undefined;
  } else {
    const injector = () => {
      const script = document.currentScript;
      if (document.head["__bmmap"]) {
        script.setAttribute('bm-result', 'false');
        return;
      }
      try {
        const myLocationButton = document.querySelector(".right-3>button");
        if (myLocationButton !== undefined && myLocationButton["__click"] !== "object") {
          script.setAttribute('bm-result', 'true');
        } else {
          script.setAttribute('bm-result', 'false');
        }
      } catch (e) {
        if (e instanceof TypeError) {
          script.setAttribute('bm-result', 'false');
        }
      }
    }
    const script = document.createElement('script');
    script.textContent = `(${injector})();`;
    document.documentElement?.appendChild(script);
    const result = script.getAttribute('bm-result') === 'true';
    script.remove();
    return result;
  }
}

/** Remove Template from Maptiler's Source
 * @since 0.85.27
 */
function controlMapTiler(func, ...args) {
  if (!isMapTilerLoaded()) {
    doAfterMapFound(() => controlMapTiler(func, ...args));
    return;
  };
  // Check the cached map handle before touching the DOM. This function runs once per tile on
  // the render path, and the querySelector below is pure overhead once __bmmap is populated.
  if (document.head["__bmmap"]) {
    const map = document.head["__bmmap"];
    return func(map, ...args);
  }
  const myLocationButton = document.querySelector(".right-3>button");
  if ( myLocationButton !== null ) {
    if (myLocationButton["__click"]) {
      const map = myLocationButton["__click"][3]["v"];
      return func(map, ...args);
    } else {
      const getMap = () => {
          return document.head["__bmmap"] || document.querySelector(".right-3>button")["__click"][3]["v"];
      };
      const injector = result => {
          const script = document.currentScript;
          script.setAttribute('bm-result', JSON.stringify(result ?? null));
      }
      const passArgs = args.map(arg => JSON.stringify(arg)).join(',');
      const script = document.createElement('script');
      script.textContent = `(${injector})((${func})((${getMap})(), ${passArgs}));`;
      document.documentElement?.appendChild(script);
      const result = JSON.parse(script.getAttribute('bm-result'));
      script.remove();
      return result;
    }
  } else {
    throw new Error("Could not find the \"My location\" button.");
  }
}


/** Get coordinates from the map center
 * @returns {number[]} [latitude, longitude]
 * @since 0.85.20
 */
export function getCenterGeoCoords() {
  return controlMapTiler(map => {
    const center = map["transform"]["center"];
    return [center['lat'], center['lng']];
  })
}

/** Get the displacement in pixels per wplace pixel
 * @returns {number}
 * @since 0.85.37
 */
export function getPixelPerWplacePixel() {
  return controlMapTiler(map => {
    // scale: 1 means (tileSize = 512) pixel on canvas covers the full longitude (i.e. 2048000 wplace pixels)
    return map["transform"]["tileSize"] * map["transform"]["scale"] / 2048000;
  });
}

/** Whether the map camera is currently animating (pan, zoom or rotate).
 * Readings of the camera centre and scale are only meaningful while it is still.
 * @returns {boolean}
 * @since 0.90.0
 */
export function isMapMoving() {
  try {
    return controlMapTiler(map => Boolean(
      map["isMoving"]?.() || map["isZooming"]?.() || map["isRotating"]?.()
    )) === true;
  } catch (_) {
    return false;
  }
}

/** Get the current map bounds.
 * @returns {{sw: number[], ne: number[]} | null}
 * @since 0.90.0
 */
export function getMapBounds() {
  return controlMapTiler(map => {
    const bounds = map["getBounds"]?.();
    if (!bounds) return null;
    const sw = bounds.getSouthWest ? bounds.getSouthWest() : bounds._sw;
    const ne = bounds.getNorthEast ? bounds.getNorthEast() : bounds._ne;
    if (!sw || !ne) return null;
    return { sw: [sw.lat, sw.lng], ne: [ne.lat, ne.lng] };
  });
}
/** Project geographic coordinates to screen (CSS) pixels of the map canvas.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{x: number, y: number} | null}
 * @since 0.90.1
 */
export function projectGeoToScreen(latitude, longitude) {
  try {
    return controlMapTiler((map, lat, lng) => {
      const point = map["project"]?.([lng, lat]);
      if (!point) return null;
      return { x: point.x, y: point.y };
    }, latitude, longitude);
  } catch (_) {
    return null;
  }
}

/** Unproject a point given in map-canvas (CSS) pixels back to geographic coordinates.
 * @param {number} x
 * @param {number} y
 * @returns {number[] | null} [latitude, longitude]
 * @since 0.90.1
 */
export function unprojectScreenToGeo(x, y) {
  try {
    return controlMapTiler((map, px, py) => {
      const lngLat = map["unproject"]?.([px, py]);
      if (!lngLat) return null;
      return [lngLat.lat, lngLat.lng];
    }, x, y);
  } catch (_) {
    return null;
  }
}

/** Get the map canvas element, when the map is available.
 * @returns {HTMLCanvasElement | null}
 * @since 0.90.1
 */
export function getMapCanvasElement() {
  return document.querySelector('canvas.maplibregl-canvas')
    ?? document.querySelector('.maplibregl-canvas')
    ?? null;
}

export var bmCanvas = {

}; // sourceID => coords

let cachedMaxGpuTextureSize = null;

/** Largest square texture this GPU/driver will accept, used to decide how big a merged overlay
 * canvas may get before it has to be split into per-tile sources.
 * @returns {number} MAX_TEXTURE_SIZE in pixels, or a conservative 4096 if it cannot be probed.
 * @since 0.87.79
 */
export function getMaxGpuTextureSize() {
  if (cachedMaxGpuTextureSize !== null) return cachedMaxGpuTextureSize;
  let size = 4096; // WebGL's guaranteed floor — safe if every probe below fails
  try {
    // Prefer MapLibre's own canvas: whatever context it already holds is the one our merged
    // canvas will actually be uploaded into. getContext() returns the existing context when the
    // type matches and null when it does not, hence trying both.
    const mapCanvas = getMapCanvasElement();
    let gl = null;
    try { gl = mapCanvas?.getContext('webgl2') ?? mapCanvas?.getContext('webgl') ?? null; } catch (_) {}
    if (!gl) {
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      gl = probe.getContext('webgl2') ?? probe.getContext('webgl') ?? null;
    }
    const reported = gl?.getParameter?.(gl.MAX_TEXTURE_SIZE);
    if (Number.isFinite(reported) && reported >= 4096) size = reported;
  } catch (_) {}
  cachedMaxGpuTextureSize = size;
  return size;
}

function resolveCanvasSourceSize(source) {
  if (!source || typeof source !== 'object') return null;
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    return [source.width, source.height];
  }
  const width = Number(source.width ?? source.videoWidth ?? source.naturalWidth);
  const height = Number(source.height ?? source.videoHeight ?? source.naturalHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  return [Math.max(1, Math.trunc(width)), Math.max(1, Math.trunc(height))];
}

function ensureTemplateCanvasElement(sourceID, width, height) {
  let canvas = document.getElementById(sourceID);
  if (!(canvas instanceof HTMLCanvasElement)) {
    canvas = document.createElement("canvas");
    canvas.id = sourceID;
    canvas.style.display = "none";
    document.body.appendChild(canvas);
  }
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

async function syncTemplateCanvasSource(targetCanvas, source) {
  const size = resolveCanvasSourceSize(source);
  if (!size) {
    throw new Error("Unsupported template canvas source.");
  }
  const [width, height] = size;
  const canvas = ensureTemplateCanvasElement(targetCanvas.id, width, height);
  // No willReadFrequently: this canvas is only ever written to, then read by MapLibre as a
  // texture. Asking for a CPU-backed surface here forces a readback + re-upload on every map
  // repaint, which is exactly the wrong trade for a canvas source.
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not initialize template source canvas context.");
  }
  context.imageSmoothingEnabled = false;
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    // putImageData used to go straight in here, and profiling on Firefox measured it at ~51ms
    // per tile against ~11ms for a drawImage of a *larger* merged surface — it forces the
    // accelerated canvas backend to sync rather than blitting. Staging through an ImageBitmap
    // turns the upload into a GPU-side blit and moves the decode off the main thread.
    // Timed as two separate rows on purpose. An awaited call measured with measureAsync reports
    // wall-clock, which includes event-loop scheduling and off-thread work — that is not
    // comparable to the synchronous putImageData figure it replaced. Only :bitmapBlit is
    // main-thread blocking time, so that is the row to compare against the old ~51ms baseline.
    // :bitmapDecode is mostly off-thread wait and inflates wall-clock without causing jank.
    let bitmap = null;
    try {
      bitmap = await profiler.measureAsync('canvasUpload:bitmapDecode', () => createImageBitmap(source));
    } catch (_) {
      // Some hardened/anti-fingerprinting builds refuse createImageBitmap on raw ImageData.
      profiler.measure('canvasUpload:putImageDataFallback', () => context.putImageData(source, 0, 0));
      return canvas;
    }
    profiler.measure('canvasUpload:bitmapBlit', () => {
      // drawImage does not clear what it covers the way putImageData does, and a partially
      // transparent template would otherwise composite over the previous frame's pixels.
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0);
    });
    bitmap.close?.();
  } else {
    profiler.measure('canvasUpload:drawImage', () => {
      context.clearRect(0, 0, width, height);
      context.drawImage(source, 0, 0);
    });
  }
  return canvas;
}

/** add Template to Maptiler's Source
 * @since 0.85.27
 */
export async function addTemplateCanvas(sortID, tileName, templateSize, source, usage) {
  // templateSize is for coordinate calculation only
  const tileCoords = tileName.split(',').map(Number);
  const [tileWidth, tileHeight] = templateSize;
  const geoCoords1 = coordsTileCoordsToGeoCoords(
    [tileCoords[0], tileCoords[1]],
    [tileCoords[2], tileCoords[3]],
    false
  );
  const geoCoords2 = coordsTileCoordsToGeoCoords(
    [tileCoords[0], tileCoords[1]],
    [tileCoords[2] + tileWidth, tileCoords[3] + tileHeight],
    false
  );
  if (!bmCanvas[usage]) {
    bmCanvas[usage] = {};
  };
  let prefix = "BM"; // avoid that mangleSelectors
  const sourceID = `${prefix}-${usage}-${tileName}-${sortID}`; // tileName before sortID so startsWith() works
  bmCanvas[usage][sourceID] = [geoCoords1, geoCoords2];
  await syncTemplateCanvasSource({ id: sourceID }, source);

  return controlMapTiler((map, sourceID, geoCoords1, geoCoords2, usage, bmCanvas) => {
    document.head["__bmCanvas"] = bmCanvas; // sync bmCanvas to document

    // Fast path: source + layer already registered. Canvas content was already updated by
    // syncTemplateCanvasSource above, and the refresh below re-uploads it, so no remove/re-add
    // cycle is needed.
    if (map["getSource"](sourceID) && map["getLayer"](sourceID)) {
      // Fix ordering if layer ended up below pixel-art-layer (e.g. after wplace setStyle calls)
      const currentLayers = map["getLayersOrder"]?.() ?? [];
      const artIdx = currentLayers.indexOf("pixel-art-layer");
      const thisIdx = currentLayers.indexOf(sourceID);
      if (artIdx >= 0 && thisIdx < artIdx) {
        const hoverLayerName2 = "pixel-hover";
        const fixNextLayer = currentLayers.find(l => (
          (usage === "overlay" && l.startsWith("BM-error-")) ||
          l === hoverLayerName2 + "-ghost"
        ));
        map["moveLayer"](sourceID, fixNextLayer);
      }
      // animate:false means MapLibre uploads the canvas texture once and never again, so a
      // content update has to be pushed by hand. pause() runs prepare() while _playing is still
      // true, which re-uploads exactly once instead of once per frame.
      const canvasSource = map["getSource"](sourceID);
      if (canvasSource && typeof canvasSource["play"] === "function") {
        canvasSource["play"]();
        canvasSource["pause"]();
      }
      map["triggerRepaint"]?.();
      return;
    }

    // Slow path: first-time registration (or partially torn-down state).
    if (map["getLayer"](sourceID)) {
      map["removeLayer"](sourceID);
    };
    if (map["getSource"](sourceID)) {
      map["removeSource"](sourceID);
    };
    map["addSource"](sourceID, {
      "type": "canvas",
      // animate:false — without it MapLibre re-uploads this canvas to a GPU texture on
      // *every* frame and keeps the map in a permanent render loop. Firefox has no zero-copy
      // canvas->texture path, so that cost is what makes large templates crawl there. Content
      // updates are pushed explicitly via the play()/pause() refresh below.
      "animate": false,
      "canvas": sourceID,
      "coordinates": [
        [ geoCoords1[1], geoCoords1[0] ],
        [ geoCoords2[1], geoCoords1[0] ],
        [ geoCoords2[1], geoCoords2[0] ],
        [ geoCoords1[1], geoCoords2[0] ],
      ],
    });
    // Find the insertion point before calling addLayer so we can use beforeId
    // and skip a separate moveLayer call.
    const hoverLayerName = "pixel-hover";
    const allLayers = map["getLayersOrder"]();
    const nextLayer = allLayers.find(layer => (
      (usage === "overlay" && layer.startsWith("bm-error-")) ||
      layer === hoverLayerName + "-ghost"
    ));
    map["addLayer"]({
      "id": sourceID,
      "source": sourceID,
      "type": "raster",
      "paint": {
          "raster-resampling": "nearest",
          "raster-opacity": 1
      }
    }, nextLayer);
    // add ghost layer once per session to prevent wplace inserting paint-preview
    // and paint-crosshair right before the hover layer
    if (!hoverGhostLayerAdded) {
      if (!map["getLayer"](hoverLayerName + "-ghost")) {
        map["addLayer"]({
          "id": hoverLayerName + "-ghost",
          "type": "raster",
          "source": hoverLayerName,
          "paint": {
              "raster-resampling": "nearest",
              "raster-opacity": 0.4
          }
        });
      }
      hoverGhostLayerAdded = true;
    } else {
      const currentLayers = map["getLayersOrder"]();
      if (currentLayers && currentLayers.length && currentLayers[currentLayers.length - 1] !== hoverLayerName + "-ghost") {
        map["moveLayer"](hoverLayerName + "-ghost");
      }
    }
  }, sourceID, geoCoords1, geoCoords2, usage, bmCanvas);
}

/** Register a single canvas covering the full template extent (one MapTiler source+layer per template).
 * coords = [tileX, tileY, offsetX, offsetY] of the template's top-left pixel.
 * size = [width, height] in template pixels (before drawMultResult scaling).
 * source can be OffscreenCanvas or ImageBitmap.
 */
export async function addTemplateFullCanvas(sortID, coords, [width, height], source, usage) {
  const geoCoords1 = coordsTileCoordsToGeoCoords([coords[0], coords[1]], [coords[2], coords[3]], false);
  const geoCoords2 = coordsTileCoordsToGeoCoords([coords[0], coords[1]], [coords[2] + width, coords[3] + height], false);
  if (!bmCanvas[usage]) bmCanvas[usage] = {};
  let prefix = "BM";
  const sourceID = `${prefix}-${usage}-full-${sortID}`;
  bmCanvas[usage][sourceID] = [geoCoords1, geoCoords2];
  await syncTemplateCanvasSource({ id: sourceID }, source);
  return controlMapTiler((map, sourceID, geoCoords1, geoCoords2, usage, bmCanvas) => {
    document.head["__bmCanvas"] = bmCanvas;
    if (map["getSource"](sourceID) && map["getLayer"](sourceID)) {
      const currentLayers = map["getLayersOrder"]?.() ?? [];
      const artIdx = currentLayers.indexOf("pixel-art-layer");
      const thisIdx = currentLayers.indexOf(sourceID);
      if (artIdx >= 0 && thisIdx < artIdx) {
        const hoverLayerName2 = "pixel-hover";
        const fixNextLayer = currentLayers.find(l => (
          (usage === "overlay" && l.startsWith("BM-error-")) ||
          l === hoverLayerName2 + "-ghost"
        ));
        map["moveLayer"](sourceID, fixNextLayer);
      }
      // animate:false means MapLibre uploads the canvas texture once and never again, so a
      // content update has to be pushed by hand. pause() runs prepare() while _playing is still
      // true, which re-uploads exactly once instead of once per frame.
      const canvasSource = map["getSource"](sourceID);
      if (canvasSource && typeof canvasSource["play"] === "function") {
        canvasSource["play"]();
        canvasSource["pause"]();
      }
      map["triggerRepaint"]?.();
      return;
    }
    if (map["getLayer"](sourceID)) map["removeLayer"](sourceID);
    if (map["getSource"](sourceID)) map["removeSource"](sourceID);
    const hoverLayerName = "pixel-hover";
    const allLayers = map["getLayersOrder"]();
    const nextLayer = allLayers.find(layer => (
      (usage === "overlay" && layer.startsWith("bm-error-")) ||
      layer === hoverLayerName + "-ghost"
    ));
    map["addSource"](sourceID, {
      "type": "canvas",
      // animate:false — without it MapLibre re-uploads this canvas to a GPU texture on
      // *every* frame and keeps the map in a permanent render loop. Firefox has no zero-copy
      // canvas->texture path, so that cost is what makes large templates crawl there. Content
      // updates are pushed explicitly via the play()/pause() refresh below.
      "animate": false,
      "canvas": sourceID,
      "coordinates": [
        [geoCoords1[1], geoCoords1[0]],
        [geoCoords2[1], geoCoords1[0]],
        [geoCoords2[1], geoCoords2[0]],
        [geoCoords1[1], geoCoords2[0]],
      ],
    });
    map["addLayer"]({
      "id": sourceID,
      "source": sourceID,
      "type": "raster",
      "paint": { "raster-resampling": "nearest", "raster-opacity": 1 },
    }, nextLayer);
    if (!hoverGhostLayerAdded) {
      if (!map["getLayer"](hoverLayerName + "-ghost")) {
        map["addLayer"]({
          "id": hoverLayerName + "-ghost",
          "type": "raster",
          "source": hoverLayerName,
          "paint": { "raster-resampling": "nearest", "raster-opacity": 0.4 },
        });
      }
      hoverGhostLayerAdded = true;
    }
  }, sourceID, geoCoords1, geoCoords2, usage, bmCanvas);
}

/** Register a styledata listener that re-adds any bmCanvas sources/layers after a style change.
 * Must be called once after the map is found (via doAfterMapFound).
 * Without this, wplace's map.setStyle() calls during initialization wipe custom overlay layers.
 */
export function registerBmCanvasRestoreOnStyleChange() {
  if (!isMapTilerLoaded()) {
    doAfterMapFound(registerBmCanvasRestoreOnStyleChange);
    return;
  }
  controlMapTiler((map, bmCanvas) => {
    document.head["__bmCanvas"] = bmCanvas;
    const handlerName = "bmCanvasRestore";
    const existing = (map["_listeners"]?.["styledata"] ?? []).find(l => l.name === handlerName);
    if (existing) return;
    const bmCanvasRestore = () => {
      const canvas = document.head["__bmCanvas"];
      if (!canvas) return;
      const hoverLayerName = "pixel-hover";
      ["overlay", "error"].forEach(usage => {
        if (!canvas[usage]) return;
        let prefix = "BM";
        const layers = map["getLayersOrder"]?.() ?? [];
        const nextLayer = layers.find(layer => (
          (usage === "overlay" && layer.startsWith(prefix + "-error-")) ||
          layer === hoverLayerName + "-ghost"
        ));
        const layerOrder = map["getLayersOrder"]?.() ?? [];
        const artLayerIdx = layerOrder.indexOf("pixel-art-layer");
        // Disabled templates keep their layers mounted at opacity 0; restoring them at 1 would make
        // a disabled template's crosses reappear on every style change.
        const hiddenSortIDs = document.head["__bmHiddenSortIDs"];
        const isHidden = (sourceID) => {
          if (!hiddenSortIDs || usage !== "overlay") return false;
          const sortID = sourceID.slice(sourceID.lastIndexOf("-") + 1);
          return hiddenSortIDs.has(sortID);
        };
        Object.entries(canvas[usage]).forEach(([sourceID, [geoCoords1, geoCoords2]]) => {
          const restoredOpacity = isHidden(sourceID) ? 0 : 1;
          if (!map["getSource"](sourceID)) {
            map["addSource"](sourceID, {
              "type": "canvas",
      // animate:false — without it MapLibre re-uploads this canvas to a GPU texture on
      // *every* frame and keeps the map in a permanent render loop. Firefox has no zero-copy
      // canvas->texture path, so that cost is what makes large templates crawl there. Content
      // updates are pushed explicitly via the play()/pause() refresh below.
      "animate": false,
              "canvas": sourceID,
              "coordinates": [
                [geoCoords1[1], geoCoords1[0]],
                [geoCoords2[1], geoCoords1[0]],
                [geoCoords2[1], geoCoords2[0]],
                [geoCoords1[1], geoCoords2[0]],
              ],
            });
          }
          if (!map["getLayer"](sourceID)) {
            map["addLayer"]({
              "id": sourceID,
              "type": "raster",
              "source": sourceID,
              "paint": { "raster-resampling": "nearest", "raster-opacity": restoredOpacity },
            }, nextLayer);
          } else if (artLayerIdx >= 0) {
            // Layer exists but may be below pixel-art-layer — fix ordering
            const currentOrder = map["getLayersOrder"]?.() ?? [];
            const thisIdx = currentOrder.indexOf(sourceID);
            const currentArtIdx = currentOrder.indexOf("pixel-art-layer");
            if (currentArtIdx >= 0 && thisIdx < currentArtIdx) {
              map["moveLayer"](sourceID, nextLayer);
            }
          }
        });
      });
    };
    bmCanvasRestore.name = handlerName;
    map["on"]("styledata", bmCanvasRestore);
  }, bmCanvas);
}


/** remove layers from a specified template from Maptiler's Source
 * @param {string?} usage
 * @param {string?} sortID
 * @since 0.86.1
 */
export function removeLayer(usage = null, sortID = null) {
  // sourceID = null: remove all
  const matchSuffix = sortID ? "-" + sortID : "";
  const toRemove = [];
  const removeUsages = usage ? [usage] : ["overlay", "error"];
  removeUsages.forEach(usage => {
    Object.keys(bmCanvas[usage] ?? {}).forEach(sourceID => {
      if (sourceID.endsWith(matchSuffix)) {
        delete bmCanvas[usage][sourceID];
        toRemove.push(sourceID);
      }
    });
  })
  return controlMapTiler((map, toRemove, bmCanvas) => {
    document.head["__bmCanvas"] = bmCanvas; // sync bmCanvas to document
    toRemove.forEach(sourceID => {
      if (map["getLayer"](sourceID)) {
        map["removeLayer"](sourceID);
      };
      if (map["getSource"](sourceID)) {
        map["removeSource"](sourceID);
      };
      const canvas = document.getElementById(sourceID);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas.remove();
      };
    })
  }, toRemove, bmCanvas);
}

export function setUsageLayersOpacity(usage, opacity) {
  const sourceIDs = Object.keys(bmCanvas[usage] ?? {});
  if (!sourceIDs.length) return;
  controlMapTiler((map, sourceIDs, opacity) => {
    sourceIDs.forEach(sourceID => {
      if (map['getLayer'](sourceID)) {
        map['setPaintProperty'](sourceID, 'raster-opacity', opacity);
      }
    });
  }, sourceIDs, opacity);
}

/** Set opacity for all overlay layers belonging to a specific template sortID.
 * Used to show/hide a template without removing and re-registering its layers.
 */
export function setTemplateSortIDLayersOpacity(sortID, opacity) {
  const suffix = `-${sortID}`;
  // Record which templates are hidden so the styledata restore can re-create their layers at the
  // right opacity. Disabling never removes layers, so without this a style change re-adds a
  // disabled template's layers at the hardcoded opacity 1 and its crosses reappear.
  // On document.head because the restore callback is serialized into the page context.
  try {
    const hidden = document.head['__bmHiddenSortIDs'] instanceof Set
      ? document.head['__bmHiddenSortIDs']
      : new Set();
    if (opacity === 0) hidden.add(String(sortID)); else hidden.delete(String(sortID));
    document.head['__bmHiddenSortIDs'] = hidden;
  } catch (_) {}
  // matches both per-tile IDs (BM-overlay-tileKey-sortID) and full-canvas IDs (BM-overlay-full-sortID)
  const sourceIDs = Object.keys(bmCanvas['overlay'] ?? {}).filter(id => id.endsWith(suffix));
  if (!sourceIDs.length) return;
  controlMapTiler((map, sourceIDs, opacity) => {
    sourceIDs.forEach(sourceID => {
      if (map['getLayer'](sourceID)) {
        map['setPaintProperty'](sourceID, 'raster-opacity', opacity);
      }
    });
  }, sourceIDs, opacity);
}

export function removeTemplateCanvasSources(sourceIDs, usage = "overlay") {
  const safeSourceIDs = Array.isArray(sourceIDs)
    ? sourceIDs.filter((sourceID) => typeof sourceID === 'string' && sourceID)
    : [];
  if (!safeSourceIDs.length) return;

  safeSourceIDs.forEach((sourceID) => {
    if (bmCanvas[usage]?.[sourceID] !== undefined) {
      delete bmCanvas[usage][sourceID];
    }
  });

  return controlMapTiler((map, sourceIDs, bmCanvas) => {
    document.head["__bmCanvas"] = bmCanvas;
    sourceIDs.forEach((sourceID) => {
      if (map["getLayer"](sourceID)) {
        map["removeLayer"](sourceID);
      }
      if (map["getSource"](sourceID)) {
        map["removeSource"](sourceID);
      }
      const canvas = document.getElementById(sourceID);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas.remove();
      }
    });
  }, safeSourceIDs, bmCanvas);
}

export function getMountedTemplateCanvasSourceIDs(usage = "overlay", sourceIDs = null) {
  const safeSourceIDs = Array.isArray(sourceIDs)
    ? sourceIDs.filter((sourceID) => typeof sourceID === 'string' && sourceID)
    : Object.keys(bmCanvas[usage] ?? {});
  if (!safeSourceIDs.length) return [];

  try {
    return controlMapTiler((map, sourceIDs) => {
      return sourceIDs.filter((sourceID) => {
        const canvas = document.getElementById(sourceID);
        return !!canvas && !!map["getSource"](sourceID) && !!map["getLayer"](sourceID);
      });
    }, safeSourceIDs) ?? [];
  } catch (_) {
    return safeSourceIDs.filter((sourceID) => document.getElementById(sourceID));
  }
}

/** Try to force the on-screen tiles to be refreshed
 * @since 0.85.37
 */
export function forceRefreshTiles() {
  if (suppressForcedTileRefresh) {
    return;
  }
  profiler.start('forceRefreshTiles');
  try {
    return controlMapTiler(map => {
      return map["refreshTiles"]("pixel-art-layer");
    });
  } catch (ignored) {
  } finally {
    profiler.end('forceRefreshTiles');
  }
}

/** The theme list used by wplace.live
 * Format: themeName: [label, darkUI, skin]
 *
 * `darkUI` must be a value wplace itself accepts. Its theme store validates the
 * stored value with `theme !== "dark" && theme !== "custom-winter" -> "custom-winter"`
 * and re-writes `data-theme` on <html>, so any other value we set there is thrown
 * away and the site UI falls back to the light theme.
 *
 * `skin` is our own extra flavour, applied as `data-rm-theme` (an attribute wplace
 * never touches) so overlay.css can restyle on top of a valid wplace theme.
 * @since 0.85.40
 */
export const themeList = {
  "liberty": ["Liberty (Default)", "custom-winter"],
  "bright": ["Bright", "custom-winter"],
  "positron": ["Positron", "custom-winter"],
  "dark": ["Dark", "dark"],
  "fiord": ["Fiord (Dark)", "dark"],
  "halloween": ["Fiord (Halloween)", "dark", "halloween"],
};

/** Override the map theme
 * @since 0.85.40
 */
export function setTheme(themeName) {
  if (!themeList[themeName]) return;
  const dataTheme = themeList[themeName][1];
  const skin = themeList[themeName][2];
  document.documentElement.dataset["theme"] = dataTheme;
  if (skin) {
    document.documentElement.dataset["rmTheme"] = skin;
  } else {
    delete document.documentElement.dataset["rmTheme"];
  }
  return controlMapTiler((map, themeName, bmCanvas) => {
    document.head["__bmCanvas"] = bmCanvas; // sync bmCanvas to document
    // The default pixel-hover styledata callback only triggers once that we cannot reset
    // May try to somehow get the current source / layer as reference, but that is also not reliable enough.
    const artLayerName = "pixel-art-layer";
    const hoverLayerName = "pixel-hover";
    let hoverLayerSource = map["getSource"](hoverLayerName); // prevent recreation
    const restoreLayers = async () => { // one problem: pixel-hover may has a lower order than pixel-art-layer, need to make sure pixel-art-layer exists before recreating pixel-hover
      if (!map["getSource"](artLayerName)) {
        map["addSource"](artLayerName, {
          "type": "raster",
          "tiles": ['https://backend.wplace.live/files/s0/tiles/{x}/{y}.png'],
          "minzoom": 11,
          "maxzoom": 11,
          "tileSize": window.innerWidth > 640 ? 550 : 400
        });
      };
      if (!map["getLayer"](artLayerName)) {
        map["addLayer"]({
          "id": artLayerName,
          "type": "raster",
          "source": artLayerName,
          "paint": {
              "raster-resampling": "nearest",
              "raster-opacity": 1
          }
        });
      };
      if (!map["getSource"](hoverLayerName)) {
        if (hoverLayerSource) { 
          map["addSource"](hoverLayerName, {
            "type": "canvas",
      // animate:false — without it MapLibre re-uploads this canvas to a GPU texture on
      // *every* frame and keeps the map in a permanent render loop. Firefox has no zero-copy
      // canvas->texture path, so that cost is what makes large templates crawl there. Content
      // updates are pushed explicitly via the play()/pause() refresh below.
      "animate": false,
            "canvas": hoverLayerSource.canvas,
            "coordinates": hoverLayerSource.coordinates
          });
        } else {
          const hoverCanvas = document.createElement("canvas");
          const hoverImg = document.createElement("img");
          hoverImg.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAAAAACoWZBhAAAAAXNSR0IArs4c6QAAACpJREFUeNpj+AsEZ86ASIa/DAwMZ84ACRDzDBigMs/AARITq1oUwxBWAADaREUdDMswKwAAAABJRU5ErkJggg==";
          await new Promise(resolve => hoverImg.addEventListener("load", () => resolve(hoverImg)));
          hoverCanvas.width = hoverImg.naturalWidth,
          hoverCanvas.height = hoverImg.naturalHeight;
          const hoverContext = hoverCanvas.getContext("2d");
          hoverContext.drawImage(hoverImg, 0, 0);
          const epsilon = 1e-5;
          const bounds = [
            [0, 0],
            [epsilon, 0],
            [epsilon, -epsilon],
            [0, -epsilon]
          ];
          
          hoverLayerSource = {
            "type": "canvas",
      // animate:false — without it MapLibre re-uploads this canvas to a GPU texture on
      // *every* frame and keeps the map in a permanent render loop. Firefox has no zero-copy
      // canvas->texture path, so that cost is what makes large templates crawl there. Content
      // updates are pushed explicitly via the play()/pause() refresh below.
      "animate": false,
            "canvas": hoverCanvas,
            "coordinates": bounds
          };
          map["addSource"](hoverLayerName, hoverLayerSource);
        };
      };
      if (!map["getLayer"](hoverLayerName)) {
        map["addLayer"]({
          "id": hoverLayerName,
          "type": "raster",
          "source": hoverLayerName,
          "paint": {
              "raster-resampling": "nearest",
              "raster-opacity": 0.4
          }
        });
      } else {
        // check layer order
        let prefix = "BM"; // avoid that mangleSelectors
        const layers = map["getLayersOrder"]();
        const nextLayer = layers.find(layer => (
          layer.startsWith(prefix + "-overlay-") ||
          layer.startsWith(prefix + "-error-") ||
          layer === hoverLayerName + "-ghost"
        ));
        const thisIndex = layers.indexOf(hoverLayerName);
        const nextIndex = nextLayer === undefined ? layers.length : layers.indexOf(nextLayer);
        if (thisIndex + 1 !== nextIndex) {
          consoleLog("moveLayer", hoverLayerName, nextLayer);
          map["moveLayer"](hoverLayerName, nextLayer);
        }
      };
      // add ghost layer to prevent wplace inserting paint-preview and paint-crosshair right before the hover layer
      if (!map["getLayer"](hoverLayerName + "-ghost")) {
        map["addLayer"]({
          "id": hoverLayerName + "-ghost",
          "type": "raster",
          "source": hoverLayerName,
          "paint": {
              "raster-resampling": "nearest",
              "raster-opacity": 0.4
          }
        });
      } else {
        const layers = map["getLayersOrder"]();
        if (layers && layers.length && layers[layers.length - 1] !== hoverLayerName + "-ghost") {
          consoleLog("moveLayer", hoverLayerName + "-ghost");
          map["moveLayer"](hoverLayerName + "-ghost"); // move to top
        }
      }
      // fix layer order:
      // art-layer -> preview -> crosshair -> hover -> bm-overlay -> bm-error -> hover-ghost
      const bmCanvas = document.head["__bmCanvas"];
      if (bmCanvas) {
        ["overlay", "error"].forEach(usage => {
          if (bmCanvas[usage]) {
            let prefix = "BM"; // avoid that mangleSelectors
            const layers = map["getLayersOrder"]();
            const nextLayer = layers.find(layer => (
              (usage === "overlay" && layer.startsWith(prefix + "-error-")) ||
              layer === hoverLayerName + "-ghost"
            ));
            consoleLog("nextLayer", nextLayer);
            Object.entries(bmCanvas[usage]).forEach(([sourceID, [geoCoords1, geoCoords2]]) => {
              if (!map["getSource"](sourceID)) {
                map["addSource"](sourceID, {
                  "type": "canvas",
      // animate:false — without it MapLibre re-uploads this canvas to a GPU texture on
      // *every* frame and keeps the map in a permanent render loop. Firefox has no zero-copy
      // canvas->texture path, so that cost is what makes large templates crawl there. Content
      // updates are pushed explicitly via the play()/pause() refresh below.
      "animate": false,
                  "canvas": sourceID,
                  "coordinates": [
                    [ geoCoords1[1], geoCoords1[0] ],
                    [ geoCoords2[1], geoCoords1[0] ],
                    [ geoCoords2[1], geoCoords2[0] ],
                    [ geoCoords1[1], geoCoords2[0] ],
                  ],
                });
              };
              consoleLog("layers", layers.slice(-5));
              if (!map["getLayer"](sourceID)) {
                map["addLayer"]({
                  "id": sourceID,
                  "type": "raster",
                  "source": sourceID,
                  "paint": {
                      "raster-resampling": "nearest",
                      "raster-opacity": 1
                  }
                });
                // Notice that moveLayer itself also fires pixeldata event from _layerOrderChanged
                consoleLog("moveLayer", sourceID, nextLayer);
                map["moveLayer"](sourceID, nextLayer);
              } else {
                // check index order — move if above ghost OR below pixel-art-layer
                const currentLayers2 = map["getLayersOrder"]?.() ?? [];
                const thisIndex = currentLayers2.indexOf(sourceID);
                const nextIndex = nextLayer === undefined ? currentLayers2.length : currentLayers2.indexOf(nextLayer);
                const artIndex = currentLayers2.indexOf(artLayerName);
                const belowArt = artIndex >= 0 && thisIndex < artIndex;
                const aboveGhost = thisIndex > nextIndex;
                if (belowArt || aboveGhost) {
                  consoleLog("moveLayer", sourceID, nextLayer);
                  map["moveLayer"](sourceID, nextLayer);
                }
              };
            })
          };
        })
      }
    }
    const restoreLayersName = "restoreLayers";
    const existingRestoreLayers = (map["_listeners"]["styledata"] ?? []).find(listener => listener.name === restoreLayersName);
    if (!existingRestoreLayers) { // only need to register once
      // map.once would not work, since there may be race condition stealing the event before pixel-data is removed
      restoreLayers.name = restoreLayersName;
      map["on"]("styledata", restoreLayers);
    };
    const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
    if (!allianceOrRankingButton) {
      // don't change style during drawing
      const closeButton = document.querySelector(".gap-1+.btn-circle");
      if (closeButton) {
        closeButton.click();
      }
    }
    map["setStyle"]("https://maps.wplace.live/styles/" + themeName, {});
    return null;
  }, themeName === "halloween" ? "fiord" : themeName, bmCanvas);
}

export var overrideRandom = {
  "data": null
}; // The coordinates to override teleportation

/** Teleport user to coordinate
 * @param {*} lat - latitude
 * @param {*} lng - longitude
 * @param {{ revealPixelInfo?: boolean }?} options
 * @since 0.85.9
 */
export async function teleportToGeoCoords(lat, lng, options = null) {
  let smooth = false;
  const revealPixelInfo = options?.revealPixelInfo !== false;

  if (isMapTilerLoaded()) {
    const funcName = smooth ? "flyTo" : "jumpTo";
    controlMapTiler((map, lat, lng, funcName) => {
      map[funcName]({'center': [lng, lat], 'zoom': 16});
    }, lat, lng, funcName);
    const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
    if (revealPixelInfo && allianceOrRankingButton) {
      // not in painting mode, click on center to show pixel info
      const canvas = document.querySelector("canvas.maplibregl-canvas");
      const ev = new MouseEvent("click", {
        "bubbles": true, "cancelable": true,
        "clientX": canvas.offsetWidth / 2,
        "clientY": canvas.offsetHeight / 2,
        "button": 0
      });
      canvas.dispatchEvent(ev);
    }
  } else {
    const randomTeleportBtn = document.querySelector(".mb-2>.btn-ghost");
    if (randomTeleportBtn !== undefined) {
      // Notice that it teleports to the .0 point instead of .5 (center) of the pixel, so we do not need to add an extra 0.5
      overrideRandom["data"] = coordsGeoCoordsToTileCoords(lat, lng, false);
      randomTeleportBtn.click();
    } else {
      // The final resort
      const url = `https://wplace.live/?lat=${lat}&lng=${lng}&zoom=16`;
      window.location.href = url;
    }
  }
}


/** Teleport user to coordinate
 * @param {number[]} coordsTile
 * @param {number[]} coordsPixel
 * @param {{ revealPixelInfo?: boolean }?} options
 * @since 0.85.9
 */
export async function teleportToTileCoords(coordsTile, coordsPixel, options = null) {
  const geoCoords = coordsTileCoordsToGeoCoords(coordsTile, coordsPixel);
  await teleportToGeoCoords(geoCoords[0], geoCoords[1], options);
}

/** Returns the real World coordinates
 * @param {number[]} coordsTile
 * @param {number[]} coordsPixel
 * @param {boolean} center
 * @returns {number[]} [latitude, longitude]
 * @since 0.85.4
 */
export function coordsTileCoordsToGeoCoords(coordsTile, coordsPixel, center = true) {
  const offset = center ? 0.5 : 0;
  const relX = (coordsTile[0] * 1000 + coordsPixel[0] + offset) / (2048 * 1000); // Relative X
  const relY = 1 - (coordsTile[1] * 1000 + coordsPixel[1] + offset) / (2048 * 1000); // Relative Y
  return [
    360 * Math.atan(Math.exp((relY * 2 - 1) * Math.PI)) / Math.PI - 90,
    relX * 360 - 180
  ];
}

/** Returns the tile World coordinates
 * @param {number} latitude
 * @param {number} longitude
 * @param {boolean} truncate
 * @returns {number[][]} [coordsTile, coordsPixel]
 * @since 0.85.4
 */
export function coordsGeoCoordsToTileCoords(latitude, longitude, truncate = true) {
  const relX = (longitude + 180) / 360;
  const relY = (Math.log(Math.tan((90 + latitude) * Math.PI / 360)) / Math.PI + 1) / 2;
  const tileX = relX * 2048 * 1000;
  const tileY = (1 - relY) * 2048 * 1000;
  const coordsPixel = truncate ? [
    Math.floor(tileX % 1000),
    Math.floor(tileY % 1000)
  ] : [
    tileX % 1000,
    tileY % 1000
  ]
  return [
    [
      Math.floor(tileX / 1000),
      Math.floor(tileY / 1000)
    ], coordsPixel
  ];
}

/** Click the zoom in button
 * @since 0.85.43
 * @deprecated only for demo purpose
 */
export function zoomIn() {
  document.querySelectorAll(".gap-1>.btn[title]")[0].click();
}

/** Click the zoom out button
 * @since 0.85.43
 * @deprecated only for demo purpose
 */
export function zoomOut() {
  document.querySelectorAll(".gap-1>.btn[title]")[1].click();
}

/** Get the displacement in pixels per wplace pixel
 * @param {number} zoom
 * @since 0.86.10
 */
export function setZoom(zoom) {
  return controlMapTiler((map, zoom) => {
    return map["setZoom"](zoom);
  }, zoom);
}

/** Reads the map's current zoom level.
 * @returns {number|null} the zoom level, or null if the map is unavailable
 * @since 0.87.71
 */
export function getZoom() {
  try {
    const zoom = controlMapTiler(map => map["getZoom"]());
    return Number.isFinite(zoom) ? zoom : null;
  } catch (_) {
    return null;
  }
}

var isMapFound = false;
var mapFoundHandlers = [];

/** Set up function to be called when map is found
 * @since 0.86.1
 */
export function doAfterMapFound(func) {
  if (isMapFound) return func();
  mapFoundHandlers.push(func);
}

/** Pan the map by a given offset
 * @param {number[]} offset - The offset to pan the map by, in pixels.
 * @since 0.86.5
 */
export function panMap(offset) {
  controlMapTiler((map, offset) => {
    map["panBy"](offset, {
      "duration": 0
    });
  }, offset);
}


const ARCHIVE_BACKGROUND_LAYER_ID = 'bm-archive-background';
const ARCHIVE_PROTOCOL = 'wpa'; // custom MapLibre protocol — not prefixed bm- to avoid CSS mangler
let archiveProtocolRegistered = false;
let archiveBgRestoreRegistered = false;
/** Last source tile URL applied, so the styledata handler can rebuild the layer after
 * wplace replaces the map style. Null while the background is disabled.
 * @since 0.87.71
 */
let archiveBgActiveTileUrl = null;
/** The archive serves a standard z0-11 XYZ pyramid with 512px tiles (same config the
 * wplace.eralyon.net viewer itself uses), unlike wplace's own single-zoom art layer.
 * @since 0.87.70
 */
const ARCHIVE_MAX_ZOOM = 11;
/** Above this map zoom the live canvas is what matters, so the archive layer stops drawing
 * entirely — MapLibre renders a layer only while `zoom < maxzoom`. Below it wplace shows no
 * live canvas at all, which is where the archive background is actually useful.
 * @since 0.87.71
 */
const ARCHIVE_BACKGROUND_LAYER_MAX_ZOOM = 10.603287908412021;
const ARCHIVE_TILE_SIZE = 512;

/** Fetch one tile through GM_xmlhttpRequest, resolving to null on any non-200 / failure.
 * @since 0.87.70
 */
function fetchArchiveTileBuffer(url) {
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      responseType: 'arraybuffer',
      onload: (response) => {
        const ok = response.status >= 200 && response.status < 300 && response.response?.byteLength;
        resolve(ok ? response.response : null);
      },
      onerror: () => resolve(null),
      ontimeout: () => resolve(null),
    });
  });
}

/** The archive has no z10 pyramid level — the viewer rejects those requests outright
 * rather than letting MapLibre retry them.
 * @since 0.87.81
 */
const ARCHIVE_MISSING_ZOOM = 10;

/** Resolve one archive tile, as PNG bytes.
 *
 * Used by both tile paths: the MapLibre protocol handler (when `addProtocol` is reachable)
 * and the GM_xmlhttpRequest proxy in main.js that serves the plain-https fallback. The
 * incoming URL still looks like `.../tiles/<version>/<z>/<x>/<y>.png` — that is the shape
 * the map source and the fetch hooks are keyed on — but no such file exists any more, so
 * it is only an address here: the bytes come from the weekly `.zst` bundle and are decoded
 * for `<version>` locally.
 * @since 0.87.70
 */
export async function loadArchiveTile(url) {
  const match = url.match(/^(https?:\/\/[^/]+)\/tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png/);
  if (!match) throw new Error(`unrecognized archive tile url: ${url}`);
  const [, origin, version, z, x, y] = match;
  if (Number(z) === ARCHIVE_MISSING_ZOOM) throw new Error('archive stores no z10 tiles');

  const container = await fetchArchiveTileBuffer(archiveTileUrl(origin, version, z, x, y));
  if (!container) throw new Error('archive tile unavailable');
  return await decodeArchiveTile(version, container);
}

/** Resolve the layer the archive background must be inserted before, so it renders *above*
 * wplace's live canvas but still below BlueMarble's own template/error overlays and the hover
 * layer. At low zoom `pixel-art-layer` is absent entirely — there the archive is simply drawn
 * under the BM overlays, or on top if none exist yet.
 * @since 0.87.71
 */
function findArchiveBgBeforeLayer(map) {
  const layers = map['getLayersOrder']?.() ?? [];
  const isAboveArchive = (layer) => layer.startsWith('BM-') || layer.startsWith('pixel-hover');
  const artIdx = layers.indexOf('pixel-art-layer');
  const searchFrom = artIdx >= 0 ? artIdx + 1 : 0;
  return layers.slice(searchFrom).find(isAboveArchive);
}

/** (Re)create the archive source + layer for a tile URL. Recreates rather than calling
 * `setTiles` when the URL changed, because `setTiles` leaves already-rendered tiles of the
 * previous archive version on screen.
 * @since 0.87.71
 */
function addArchiveBgLayer(map, sourceTileUrl) {
  const id = ARCHIVE_BACKGROUND_LAYER_ID;
  const existing = map['getSource'](id);
  const urlChanged = existing && existing['tiles']?.[0] !== sourceTileUrl;

  if (!existing || urlChanged) {
    if (existing) {
      if (map['getLayer'](id)) map['removeLayer'](id);
      map['removeSource'](id);
    }
    map['addSource'](id, {
      'type': 'raster',
      'tiles': [sourceTileUrl],
      'minzoom': 0,
      'maxzoom': ARCHIVE_MAX_ZOOM,
      'tileSize': ARCHIVE_TILE_SIZE,
    });
  }

  const beforeLayer = findArchiveBgBeforeLayer(map);
  if (!map['getLayer'](id)) {
    map['addLayer']({
      'id': id,
      'type': 'raster',
      'source': id,
      'minzoom': 0,
      'maxzoom': ARCHIVE_BACKGROUND_LAYER_MAX_ZOOM,
      'paint': {
        'raster-resampling': 'nearest',
        'raster-opacity': 1,
      },
    }, beforeLayer);
  } else {
    // A layer that survived a style rebuild may predate the zoom cap — reassert it.
    map['setLayerZoomRange']?.(id, 0, ARCHIVE_BACKGROUND_LAYER_MAX_ZOOM);
    // Layer survived but may have drifted below pixel-art-layer after a style rebuild.
    const order = map['getLayersOrder']?.() ?? [];
    const artIdx = order.indexOf('pixel-art-layer');
    if (artIdx >= 0 && order.indexOf(id) < artIdx) map['moveLayer'](id, beforeLayer);
  }
  map['setLayoutProperty'](id, 'visibility', 'visible');
}

/** wplace rebuilds the map style (dropping every custom source/layer) on theme and locale
 * changes; mirror the bmCanvas restore handler so the archive background comes back.
 * @since 0.87.71
 */
function registerArchiveBgRestoreOnStyleChange(map) {
  if (archiveBgRestoreRegistered) return;
  archiveBgRestoreRegistered = true;
  map['on']('styledata', () => {
    if (!archiveBgActiveTileUrl) return;
    try {
      addArchiveBgLayer(map, archiveBgActiveTileUrl);
    } catch (err) {
      consoleWarn('[archive bg] restore after style change failed:', err?.message || err);
    }
  });
}

/**
 * Apply the archive background raster layer directly to an already-resolved map instance.
 * The caller is responsible for obtaining the map (e.g. via resolveTemplateOverlayMapInstance).
 * @param {object} map - MapLibre Map instance
 * @param {string|null} tileUrl - Tile URL template, or null to hide.
 * @since 0.87.57
 */
export function applyArchiveBgLayerToMap(map, tileUrl) {
  const id = ARCHIVE_BACKGROUND_LAYER_ID;
  try {
    if (!tileUrl) {
      archiveBgActiveTileUrl = null;
      if (map['getLayer'](id)) map['setLayoutProperty'](id, 'visibility', 'none');
      return;
    }

    // Register custom MapLibre protocol once — handles tile fetches directly via GM_xmlhttpRequest,
    // bypassing CORS and avoiding the fetch-override/message-passing chain entirely.
    if (!archiveProtocolRegistered) {
      const MapClass = Object.getPrototypeOf(map).constructor;
      if (typeof MapClass['addProtocol'] === 'function') {
        MapClass['addProtocol'](ARCHIVE_PROTOCOL, (params, callback) => {
          const url = params.url.replace(ARCHIVE_PROTOCOL + '://', 'https://');
          loadArchiveTile(url).then(
            (buffer) => callback(null, buffer, null, null),
            (err) => callback(err instanceof Error ? err : new Error(String(err)))
          );
          return { cancel: () => {} };
        });
        archiveProtocolRegistered = true;
      } else {
        consoleWarn('[archive bg] addProtocol not found on MapClass — falling back to https tiles');
      }
    }

    // Convert tile URL to use custom protocol if registered, otherwise use https directly
    const sourceTileUrl = archiveProtocolRegistered
      ? tileUrl.replace('https://', ARCHIVE_PROTOCOL + '://')
      : tileUrl;

    archiveBgActiveTileUrl = sourceTileUrl;
    registerArchiveBgRestoreOnStyleChange(map);
    addArchiveBgLayer(map, sourceTileUrl);
  } catch (err) {
    consoleError('[archive bg] ERROR:', err?.message || err);
  }
}

/** Reports the live state of the archive background layer for console diagnostics.
 * Answers the question the code alone cannot: was the layer actually created, is it visible,
 * and is the current zoom inside the range where MapLibre will draw it.
 * @since 0.87.71
 */
export function getArchiveBgDiag() {
  const id = ARCHIVE_BACKGROUND_LAYER_ID;
  try {
    return controlMapTiler((map) => {
      const layer = map['getLayer'](id);
      const source = map['getSource'](id);
      const zoom = map['getZoom']?.();
      const order = map['getLayersOrder']?.() ?? [];
      let visibility = null;
      try { visibility = map['getLayoutProperty']?.(id, 'visibility'); } catch (_) {}
      return {
        activeTileUrl: archiveBgActiveTileUrl,
        protocolRegistered: archiveProtocolRegistered,
        sourceExists: !!source,
        sourceTiles: source?.['tiles']?.[0] ?? null,
        layerExists: !!layer,
        visibility,
        layerMinZoom: layer?.['minzoom'] ?? null,
        layerMaxZoom: layer?.['maxzoom'] ?? null,
        currentZoom: zoom,
        drawnAtCurrentZoom: !!layer && Number.isFinite(zoom)
          && zoom >= (layer['minzoom'] ?? 0) && zoom < (layer['maxzoom'] ?? Infinity),
        layerIndex: order.indexOf(id),
        pixelArtIndex: order.indexOf('pixel-art-layer'),
      };
    }) ?? null;
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

/** Check the current tileSize
 * @since 0.86.15
 */
export function getCurrentTileSize() {
  var tileSize = controlMapTiler((map) => {
    var source = map["getSource"]("pixel-art-layer");
    if (!source) return;
    return source["tileSize"];
  });
  // fallback
  if (tileSize === null) {
    return window.innerWidth > 640 ? 550 : 400;
  }
  return tileSize;
}



