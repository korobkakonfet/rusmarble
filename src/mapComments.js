import { coordsTileCoordsToGeoCoords, doAfterMapFound } from './utilsMaptiler.js';

const WORLD_TILE_SIZE = 1000;
const WORLD_TILE_COUNT = 2048;
const WORLD_PIXEL_SIZE = WORLD_TILE_SIZE * WORLD_TILE_COUNT;
const MAX_LATITUDE = 85.05112878;
const COMMENT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_VISIBLE_MARKERS = 300;
const DEFAULT_MAX_COMMENTS = Number.POSITIVE_INFINITY;
const VIEWPORT_MARGIN_PX = 20;
const URL_REGEX = /https?:\/\/[^\s)]+/gi;
const LOCATION_ALIAS_REGEX = /\bwplace@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?/i;
const DEBUG_STATE_ATTR = 'bm-map-comments-state';

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapModulo(value, modulo) {
  const normalized = value % modulo;
  return normalized < 0 ? normalized + modulo : normalized;
}

function normalizeLng(lng) {
  return wrapModulo(lng + 180, 360) - 180;
}

function parseTimestamp(payload) {
  const raw = payload?.['ts']
    ?? payload?.['timestamp']
    ?? payload?.['created_at']
    ?? payload?.['createdAt']
    ?? Date.now();
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeMessageId(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeUserName(payload) {
  const fallback = payload?.['user']
    ?? payload?.['username']
    ?? payload?.['name']
    ?? payload?.['Lt']
    ?? 'anon';
  const text = String(fallback ?? '').trim();
  return text || 'anon';
}

function clipText(value, maxLen) {
  const text = String(value ?? '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function extractKeyedNumber(text, keys) {
  const pattern = new RegExp(`\\b(?:${keys.join('|')})\\b\\s*(?:[:=]\\s*|\\s+)(-?\\d+(?:\\.\\d+)?)`, 'i');
  const match = pattern.exec(text);
  if (!match) return null;
  return toFiniteNumber(match[1]);
}

function parseLocationFromGeo(lat, lng, zoom, format) {
  return {
    format,
    lat: clamp(lat, -MAX_LATITUDE, MAX_LATITUDE),
    lng: normalizeLng(lng),
    zoom: Number.isFinite(zoom) ? zoom : null
  };
}

function parseLocationFromTilePixel(tileX, tileY, pixelX, pixelY, zoom, format) {
  const safeTileX = wrapModulo(Math.trunc(tileX), WORLD_TILE_COUNT);
  const safeTileY = clamp(Math.trunc(tileY), 0, WORLD_TILE_COUNT - 1);
  const safePixelX = wrapModulo(Math.trunc(pixelX), WORLD_TILE_SIZE);
  const safePixelY = wrapModulo(Math.trunc(pixelY), WORLD_TILE_SIZE);
  const [lat, lng] = coordsTileCoordsToGeoCoords(
    [safeTileX, safeTileY],
    [safePixelX, safePixelY],
    true
  );
  return {
    format,
    lat,
    lng,
    zoom: Number.isFinite(zoom) ? zoom : null,
    tileX: safeTileX,
    tileY: safeTileY,
    pixelX: safePixelX,
    pixelY: safePixelY
  };
}

function parseLocationFromAbsoluteXY(x, y, zoom) {
  const safeX = wrapModulo(Math.trunc(x), WORLD_PIXEL_SIZE);
  const safeY = clamp(Math.trunc(y), 0, WORLD_PIXEL_SIZE - 1);
  const tileX = Math.floor(safeX / WORLD_TILE_SIZE);
  const tileY = Math.floor(safeY / WORLD_TILE_SIZE);
  const pixelX = safeX % WORLD_TILE_SIZE;
  const pixelY = safeY % WORLD_TILE_SIZE;
  const location = parseLocationFromTilePixel(tileX, tileY, pixelX, pixelY, zoom, 'xy');
  return {
    ...location,
    x: safeX,
    y: safeY
  };
}

function parseLocationFromUrl(token) {
  try {
    const parsed = new URL(token);
    const lat = toFiniteNumber(parsed.searchParams.get('lat'));
    const lng = toFiniteNumber(parsed.searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const zoom = toFiniteNumber(parsed.searchParams.get('zoom'));
    return parseLocationFromGeo(lat, lng, zoom, 'url');
  } catch (_) {
    return null;
  }
}

function parseLocationFromAlias(text) {
  const aliasMatch = LOCATION_ALIAS_REGEX.exec(text);
  if (!aliasMatch) return null;
  const lat = toFiniteNumber(aliasMatch[1]);
  const lng = toFiniteNumber(aliasMatch[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const zoom = toFiniteNumber(aliasMatch[3]);
  return parseLocationFromGeo(lat, lng, zoom, 'wplace_alias');
}

export function extractMapLocationFromChatText(rawText) {
  const text = String(rawText ?? '');
  if (!text) return null;
  const textTrimmed = text.trim();

  for (const token of text.match(URL_REGEX) ?? []) {
    const fromUrl = parseLocationFromUrl(token);
    if (fromUrl) return fromUrl;
  }

  const fromAlias = parseLocationFromAlias(text);
  if (fromAlias) return fromAlias;

  const zoom = extractKeyedNumber(text, ['z', 'zoom']);
  const tileX = extractKeyedNumber(text, ['tx', 'tilex', 'tile_x']);
  const tileY = extractKeyedNumber(text, ['ty', 'tiley', 'tile_y']);
  const pixelX = extractKeyedNumber(text, ['px', 'pixelx', 'pixel_x', 'offsetx', 'ox']);
  const pixelY = extractKeyedNumber(text, ['py', 'pixely', 'pixel_y', 'offsety', 'oy']);
  if (
    Number.isFinite(tileX) &&
    Number.isFinite(tileY) &&
    Number.isFinite(pixelX) &&
    Number.isFinite(pixelY)
  ) {
    return parseLocationFromTilePixel(tileX, tileY, pixelX, pixelY, zoom, 'tile_pixel_keyed');
  }

  const displayTilePixel = /\bTl\s*X\s*:\s*([012]?\d{1,3})\s*,\s*Tl\s*Y\s*:\s*([012]?\d{1,3})\s*,\s*Px\s*X\s*:\s*(\d{1,3})\s*,\s*Px\s*Y\s*:\s*(\d{1,3})\b/i.exec(text);
  if (displayTilePixel) {
    return parseLocationFromTilePixel(
      Number(displayTilePixel[1]),
      Number(displayTilePixel[2]),
      Number(displayTilePixel[3]),
      Number(displayTilePixel[4]),
      zoom,
      'tile_pixel_display'
    );
  }

  const rawTilePixel = /^([012]?\d{1,3})\s*[, ]\s*([012]?\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[, ]\s*(-?\d+(?:\.\d+)?))?$/.exec(textTrimmed);
  if (rawTilePixel) {
    return parseLocationFromTilePixel(
      Number(rawTilePixel[1]),
      Number(rawTilePixel[2]),
      Number(rawTilePixel[3]),
      Number(rawTilePixel[4]),
      toFiniteNumber(rawTilePixel[5]) ?? zoom,
      'tile_pixel_raw'
    );
  }

  const x = extractKeyedNumber(text, ['x', 'coordx', 'mapx']);
  const y = extractKeyedNumber(text, ['y', 'coordy', 'mapy']);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return parseLocationFromAbsoluteXY(x, y, zoom);
  }

  return null;
}

export function stripLocationTokensFromCommentText(rawText) {
  let text = String(rawText ?? '');
  if (!text) return '';

  text = text.replace(URL_REGEX, ' ');
  text = text.replace(LOCATION_ALIAS_REGEX, ' ');
  text = text.replace(/\b(?:tx|ty|px|py|tilex|tiley|pixelx|pixely|offsetx|offsety|zoom|z)\s*[:=]\s*-?\d+(?:\.\d+)?/gi, ' ');
  text = text.replace(/\bTl\s*X\s*:\s*[012]?\d{1,3}\s*,\s*Tl\s*Y\s*:\s*[012]?\d{1,3}\s*,\s*Px\s*X\s*:\s*\d{1,3}\s*,\s*Px\s*Y\s*:\s*\d{1,3}\b/gi, ' ');
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();

  if (/^([012]?\d{1,3})\s*[, ]\s*([012]?\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[, ]\s*(-?\d+(?:\.\d+)?))?$/.test(text)) {
    return '';
  }

  return text;
}

function isTimestampExpired(timestampMs, now = Date.now()) {
  return Number.isFinite(timestampMs) && (now - timestampMs) > COMMENT_TTL_MS;
}

function isLngInRange(lng, west, east) {
  if (!Number.isFinite(lng) || !Number.isFinite(west) || !Number.isFinite(east)) return false;
  if (west <= east) return lng >= west && lng <= east;
  return lng >= west || lng <= east;
}

function isLatInRange(lat, south, north) {
  if (!Number.isFinite(lat) || !Number.isFinite(south) || !Number.isFinite(north)) return false;
  return lat >= south && lat <= north;
}

class MapCommentManagerImpl {
  constructor(options = {}) {
    this.maxComments = Number.isFinite(options.maxComments) && options.maxComments > 0
      ? Math.floor(options.maxComments)
      : DEFAULT_MAX_COMMENTS;
    this.maxVisibleMarkers = Number.isFinite(options.maxVisibleMarkers) && options.maxVisibleMarkers > 0
      ? Math.floor(options.maxVisibleMarkers)
      : DEFAULT_MAX_VISIBLE_MARKERS;

    this.comments = new Map();
    this.markers = new Map();
    this.visibleCount = 0;
    this.selectedCommentId = null;
    this.hoveredCommentId = null;
    this.popupHovered = false;
    this.hoverCloseTimerId = null;
    this.commentsVisible = true;
    this.renderPending = false;
    this.destroyed = false;
    this.mapReadyPollId = null;

    this.map = null;
    this.layer = null;
    this.popup = null;
    this.popupAuthor = null;
    this.popupTime = null;
    this.popupBody = null;
    this.themeObserver = null;

    this.handleMapChanged = this.handleMapChanged.bind(this);
    this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);

    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    doAfterMapFound(() => this.tryAttachMap());
    this.mapReadyPollId = window.setInterval(() => this.tryAttachMap(), 2500);
    this.tryAttachMap();
  }

  tryAttachMap() {
    if (this.destroyed || this.map) return;
    const map = this.resolveMapInstance();
    if (!map) return;
    this.map = map;
    this.bindMapEvents();
    this.ensureLayer();
    this.scheduleRender();
    if (this.mapReadyPollId) {
      clearInterval(this.mapReadyPollId);
      this.mapReadyPollId = null;
    }
  }

  resolveMapInstance() {
    const direct = document.head?.['__bmmap'];
    if (direct && typeof direct['project'] === 'function') return direct;
    const myLocationButton = document.querySelector('.right-3>button');
    const fallback = myLocationButton?.['__click']?.[3]?.['v'];
    if (fallback && typeof fallback['project'] === 'function') return fallback;
    return null;
  }

  bindMapEvents() {
    if (!this.map || typeof this.map['on'] !== 'function') return;
    ['move', 'zoom', 'resize', 'moveend', 'zoomend'].forEach((eventName) => {
      this.map['on'](eventName, this.handleMapChanged);
    });
  }

  unbindMapEvents() {
    if (!this.map || typeof this.map['off'] !== 'function') return;
    ['move', 'zoom', 'resize', 'moveend', 'zoomend'].forEach((eventName) => {
      this.map['off'](eventName, this.handleMapChanged);
    });
  }

  ensureLayer() {
    if (!this.map || this.layer) return;
    const mapContainer =
      this.map['getCanvasContainer']?.() ||
      this.map['getContainer']?.() ||
      document.querySelector('#map');
    if (!mapContainer) return;

    this.layer = document.createElement('div');
    this.layer.className = 'bm-map-comment-layer';
    this.layer.setAttribute('data-map-comment-layer', '1');
    this.layer.setAttribute('data-map-comments-visible', this.commentsVisible ? '1' : '0');
    mapContainer.appendChild(this.layer);

    this.popup = document.createElement('div');
    this.popup.className = 'bm-map-comment-popup';
    this.popup.style.display = 'none';
    this.popup.addEventListener('mouseenter', () => {
      this.popupHovered = true;
      this.clearHoverCloseTimer();
    });
    this.popup.addEventListener('mouseleave', () => {
      this.popupHovered = false;
      this.scheduleHoverClose();
    });

    const head = document.createElement('div');
    head.className = 'bm-map-comment-popup-head';

    this.popupAuthor = document.createElement('span');
    this.popupAuthor.className = 'bm-map-comment-popup-author';

    this.popupTime = document.createElement('span');
    this.popupTime.className = 'bm-map-comment-popup-time';

    head.appendChild(this.popupAuthor);
    head.appendChild(this.popupTime);

    this.popupBody = document.createElement('div');
    this.popupBody.className = 'bm-map-comment-popup-body';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bm-map-comment-popup-close';
    close.textContent = 'x';
    close.title = 'Close';
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hoveredCommentId = null;
      this.popupHovered = false;
      this.clearHoverCloseTimer();
      this.selectedCommentId = null;
      this.scheduleRender();
    });

    this.popup.appendChild(close);
    this.popup.appendChild(head);
    this.popup.appendChild(this.popupBody);
    this.layer.appendChild(this.popup);

    this.syncThemeFromOverlay();
    this.installThemeObserver();
  }

  handleDocumentPointerDown(event) {
    if (!this.selectedCommentId) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('.bm-map-comment-popup') || target.closest('.bm-map-comment-marker')) {
      return;
    }
    this.hoveredCommentId = null;
    this.popupHovered = false;
    this.clearHoverCloseTimer();
    this.selectedCommentId = null;
    this.scheduleRender();
  }

  handleMapChanged() {
    this.scheduleRender();
  }

  syncThemeFromOverlay() {
    if (!this.layer) return;
    const overlayRoot = document.getElementById('bm-overlay');
    if (!overlayRoot) return;
    const computed = getComputedStyle(overlayRoot);
    const panelBg = computed.getPropertyValue('--bm-panel-bg').trim();
    const fg = computed.getPropertyValue('--bm-fg').trim();
    const muted = computed.getPropertyValue('--bm-muted').trim();
    const btn = computed.getPropertyValue('--bm-btn-bg').trim();
    const btnHover = computed.getPropertyValue('--bm-btn-hover').trim();
    const btnActive = computed.getPropertyValue('--bm-btn-active').trim();
    const borderStrong = computed.getPropertyValue('--bm-border-strong').trim();
    const subtleBg = computed.getPropertyValue('--bm-subtle-bg').trim();

    if (panelBg) this.layer.style.setProperty('--bm-comment-bg', panelBg);
    if (fg) this.layer.style.setProperty('--bm-comment-color', fg);
    if (muted) this.layer.style.setProperty('--bm-comment-text-subtle', muted);
    if (btn) this.layer.style.setProperty('--bm-comment-toggle-bg', btn);
    if (btnHover) this.layer.style.setProperty('--bm-comment-toggle-bg-hover', btnHover);
    if (btnActive) this.layer.style.setProperty('--bm-comment-toggle-bg-off', btnActive);
    if (subtleBg) this.layer.style.setProperty('--bm-comment-close-bg', subtleBg);
    if (borderStrong) this.layer.style.setProperty('--bm-comment-close-bg-hover', borderStrong);
  }

  installThemeObserver() {
    if (this.themeObserver || !this.layer) return;
    const overlayRoot = document.getElementById('bm-overlay');
    if (!overlayRoot) return;
    this.themeObserver = new MutationObserver(() => this.syncThemeFromOverlay());
    this.themeObserver.observe(overlayRoot, {
      attributes: true,
      attributeFilter: ['data-layout-theme', 'data-wplace-theme', 'style']
    });
    document.addEventListener('bm-layout-theme-changed', () => this.syncThemeFromOverlay());
  }

  clearHoverCloseTimer() {
    if (!this.hoverCloseTimerId) return;
    clearTimeout(this.hoverCloseTimerId);
    this.hoverCloseTimerId = null;
  }

  scheduleHoverClose(delayMs = 120) {
    this.clearHoverCloseTimer();
    this.hoverCloseTimerId = setTimeout(() => {
      this.hoverCloseTimerId = null;
      if (this.popupHovered || this.hoveredCommentId) return;
      if (!this.selectedCommentId) return;
      this.selectedCommentId = null;
      this.scheduleRender();
    }, delayMs);
  }

  clearRenderedMarkers() {
    for (const marker of this.markers.values()) {
      marker.remove();
    }
    this.markers.clear();
    this.visibleCount = 0;
  }

  setCommentsVisible(visible) {
    const next = Boolean(visible);
    if (this.commentsVisible === next) return;
    this.commentsVisible = next;
    if (this.layer) {
      this.layer.setAttribute('data-map-comments-visible', this.commentsVisible ? '1' : '0');
    }
    if (!next) {
      this.hoveredCommentId = null;
      this.popupHovered = false;
      this.clearHoverCloseTimer();
      this.selectedCommentId = null;
      this.hidePopup();
      this.clearRenderedMarkers();
    }
    this.scheduleRender();
  }

  upsertFromChatPayload(payload) {
    if (this.destroyed || !payload) return null;

    const location = extractMapLocationFromChatText(payload['text']);
    if (!location) return null;

    const timestampMs = parseTimestamp(payload);
    if (isTimestampExpired(timestampMs)) return null;

    const messageId = normalizeMessageId(payload['id'])
      || `${normalizeUserName(payload)}:${timestampMs}:${String(payload['text'] ?? '')}`;
    const text = String(payload['text'] ?? '');
    const strippedText = stripLocationTokensFromCommentText(text);
    const commentText = strippedText || '(location)';

    const nextComment = {
      id: messageId,
      user: normalizeUserName(payload),
      text,
      textDisplay: commentText,
      timestampMs,
      timestampText: new Date(timestampMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }),
      location
    };

    this.comments.set(messageId, nextComment);
    this.pruneByLimit();
    this.pruneExpired();
    this.scheduleRender();
    return nextComment;
  }

  removeByMessageId(messageId) {
    const key = normalizeMessageId(messageId);
    if (!key) return;
    this.comments.delete(key);
    const marker = this.markers.get(key);
    if (marker) {
      marker.remove();
      this.markers.delete(key);
    }
    if (this.selectedCommentId === key) {
      this.selectedCommentId = null;
    }
    this.scheduleRender();
  }

  pruneByLimit() {
    if (!Number.isFinite(this.maxComments)) return;
    const overflow = this.comments.size - this.maxComments;
    if (overflow <= 0) return;
    const oldest = [...this.comments.values()]
      .sort((a, b) => a.timestampMs - b.timestampMs)
      .slice(0, overflow);
    oldest.forEach((comment) => {
      this.comments.delete(comment.id);
      const marker = this.markers.get(comment.id);
      if (marker) {
        marker.remove();
        this.markers.delete(comment.id);
      }
      if (this.selectedCommentId === comment.id) {
        this.selectedCommentId = null;
      }
    });
  }

  pruneExpired() {
    const now = Date.now();
    for (const comment of this.comments.values()) {
      if (!isTimestampExpired(comment.timestampMs, now)) continue;
      this.comments.delete(comment.id);
      const marker = this.markers.get(comment.id);
      if (marker) {
        marker.remove();
        this.markers.delete(comment.id);
      }
      if (this.selectedCommentId === comment.id) {
        this.selectedCommentId = null;
      }
    }
  }

  scheduleRender() {
    if (this.destroyed || this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.render();
    });
  }

  getBoundsContext() {
    if (!this.map) return null;
    const bounds = this.map['getBounds']?.();
    if (!bounds) return null;
    const sw = bounds['getSouthWest'] ? bounds['getSouthWest']() : bounds?.['_sw'];
    const ne = bounds['getNorthEast'] ? bounds['getNorthEast']() : bounds?.['_ne'];
    if (!sw || !ne) return null;

    const canvas = this.map['getCanvas']?.();
    const width = canvas?.['clientWidth'] ?? this.layer?.['clientWidth'] ?? 0;
    const height = canvas?.['clientHeight'] ?? this.layer?.['clientHeight'] ?? 0;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    const worldSize = this.map?.['transform']?.['worldSize'];
    return {
      west: sw['lng'],
      east: ne['lng'],
      south: sw['lat'],
      north: ne['lat'],
      width,
      height,
      worldSize: Number.isFinite(worldSize) ? worldSize : null
    };
  }

  isVisibleInBounds(comment, context) {
    return isLatInRange(comment.location.lat, context.south, context.north)
      && isLngInRange(comment.location.lng, context.west, context.east);
  }

  projectToPoint(comment, context) {
    if (!this.map || typeof this.map['project'] !== 'function') return null;
    const projected = this.map['project']([comment.location.lng, comment.location.lat]);
    if (!projected) return null;
    let x = Number(projected['x']);
    const y = Number(projected['y']);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    if (Number.isFinite(context.worldSize) && context.worldSize > 0) {
      while (x < -VIEWPORT_MARGIN_PX) x += context.worldSize;
      while (x > context.width + VIEWPORT_MARGIN_PX) x -= context.worldSize;
    }
    return { x, y };
  }

  createMarker(comment) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'bm-map-comment-marker';
    marker.setAttribute('data-map-comment-marker', '1');
    marker.dataset.commentId = comment.id;
    marker.addEventListener('mouseenter', () => {
      if (!this.commentsVisible) return;
      this.hoveredCommentId = comment.id;
      this.clearHoverCloseTimer();
      this.selectedCommentId = comment.id;
      this.scheduleRender();
    });
    marker.addEventListener('mouseleave', () => {
      if (this.hoveredCommentId === comment.id) {
        this.hoveredCommentId = null;
      }
      this.scheduleHoverClose();
    });
    marker.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.commentsVisible) return;
      this.hoveredCommentId = comment.id;
      this.clearHoverCloseTimer();
      this.selectedCommentId = comment.id;
      this.scheduleRender();
    });
    this.layer.appendChild(marker);
    this.markers.set(comment.id, marker);
    return marker;
  }

  renderPopup(comment, point, context) {
    if (!this.popup || !this.popupAuthor || !this.popupTime || !this.popupBody) return;

    this.popupAuthor.textContent = comment.user;
    this.popupTime.textContent = comment.timestampText;
    this.popupBody.textContent = comment.textDisplay;
    this.popup.style.display = 'block';

    let x = point.x;
    const y = point.y;
    this.popup.style.left = `${Math.round(x)}px`;
    this.popup.style.top = `${Math.round(y)}px`;

    const popupWidth = this.popup.offsetWidth || 0;
    if (popupWidth > 0) {
      const minX = popupWidth / 2 + 8;
      const maxX = context.width - popupWidth / 2 - 8;
      x = clamp(x, minX, maxX);
      this.popup.style.left = `${Math.round(x)}px`;
    }
  }

  hidePopup() {
    if (!this.popup) return;
    this.popupHovered = false;
    this.popup.style.display = 'none';
  }

  render() {
    if (this.destroyed || !this.map) return;
    this.ensureLayer();
    if (!this.layer) return;
    this.syncThemeFromOverlay();

    if (!this.commentsVisible) {
      this.hidePopup();
      this.clearRenderedMarkers();
      this.layer.setAttribute(DEBUG_STATE_ATTR, JSON.stringify({
        total: this.comments.size,
        visible: 0,
        enabled: false
      }));
      return;
    }

    this.pruneExpired();
    const context = this.getBoundsContext();
    if (!context) {
      this.hidePopup();
      return;
    }

    const visibleEntries = [];
    for (const comment of this.comments.values()) {
      if (!this.isVisibleInBounds(comment, context)) continue;
      const point = this.projectToPoint(comment, context);
      if (!point) continue;
      if (
        point.x < -VIEWPORT_MARGIN_PX ||
        point.x > context.width + VIEWPORT_MARGIN_PX ||
        point.y < -VIEWPORT_MARGIN_PX ||
        point.y > context.height + VIEWPORT_MARGIN_PX
      ) {
        continue;
      }
      visibleEntries.push({ comment, point });
    }

    visibleEntries.sort((a, b) => a.comment.timestampMs - b.comment.timestampMs);
    if (visibleEntries.length > this.maxVisibleMarkers) {
      visibleEntries.splice(0, visibleEntries.length - this.maxVisibleMarkers);
    }

    const visibleIds = new Set();
    visibleEntries.forEach(({ comment, point }, index) => {
      visibleIds.add(comment.id);
      const marker = this.markers.get(comment.id) || this.createMarker(comment);
      marker.dataset.commentId = comment.id;
      marker.style.display = '';
      marker.style.pointerEvents = 'auto';
      marker.style.left = `${Math.round(point.x)}px`;
      marker.style.top = `${Math.round(point.y)}px`;
      marker.style.zIndex = String(1000 + index);
      marker.textContent = clipText(comment.textDisplay, 46);
      marker.title = `${comment.user} • ${comment.timestampText}\n${comment.textDisplay}`;
    });

    for (const [id, marker] of this.markers.entries()) {
      if (visibleIds.has(id)) continue;
      marker.remove();
      this.markers.delete(id);
    }

    this.visibleCount = visibleIds.size;
    if (this.selectedCommentId) {
      const selected = this.comments.get(this.selectedCommentId);
      if (!selected) {
        this.selectedCommentId = null;
        this.hidePopup();
      } else {
        const point = this.projectToPoint(selected, context);
        if (!point || !visibleIds.has(selected.id)) {
          this.hidePopup();
        } else {
          this.renderPopup(selected, point, context);
          const selectedMarker = this.markers.get(selected.id);
          if (selectedMarker) {
            selectedMarker.style.display = 'none';
            selectedMarker.style.pointerEvents = 'none';
          }
          this.hoveredCommentId = null;
          if (!this.popupHovered) {
            this.scheduleHoverClose(200);
          }
        }
      }
    } else {
      this.hidePopup();
    }

    this.layer.setAttribute(DEBUG_STATE_ATTR, JSON.stringify({
      total: this.comments.size,
      visible: this.visibleCount
    }));
  }

  getState() {
    const preview = [...this.comments.values()]
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 200)
      .map((item) => ({
        id: item.id,
        user: item.user,
        text: item.textDisplay,
        timestampMs: item.timestampMs,
        lat: item.location.lat,
        lng: item.location.lng,
        format: item.location.format
      }));
    return {
      hasMap: Boolean(this.map),
      hasLayer: Boolean(this.layer),
      enabled: this.commentsVisible,
      totalComments: this.comments.size,
      visibleComments: this.visibleCount,
      selectedCommentId: this.selectedCommentId,
      comments: preview
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearHoverCloseTimer();
    this.hoveredCommentId = null;
    this.popupHovered = false;
    if (this.themeObserver) {
      try { this.themeObserver.disconnect(); } catch (_) {}
      this.themeObserver = null;
    }
    if (this.mapReadyPollId) {
      clearInterval(this.mapReadyPollId);
      this.mapReadyPollId = null;
    }
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    this.unbindMapEvents();
    for (const marker of this.markers.values()) {
      marker.remove();
    }
    this.markers.clear();
    this.comments.clear();
    if (this.popup) {
      this.popup.remove();
    }
    this.popup = null;
    this.popupAuthor = null;
    this.popupTime = null;
    this.popupBody = null;
    if (this.layer) {
      this.layer.remove();
    }
    this.layer = null;
    this.map = null;
    this.selectedCommentId = null;
  }
}

function installDebugApi(api) {
  try {
    window['__bmMapComments'] = api;
  } catch (_) {}
}

function createFallbackApi(reason, parseOnly = false) {
  return {
    'upsertFromChatPayload': () => null,
    'removeByMessageId': () => {},
    'parse': (text) => extractMapLocationFromChatText(text),
    'setVisible': () => {},
    'isVisible': () => false,
    'getState': () => ({
      hasMap: false,
      hasLayer: false,
      enabled: false,
      totalComments: 0,
      visibleComments: 0,
      selectedCommentId: null,
      comments: [],
      disabled: true,
      parseOnly,
      reason: String(reason ?? 'unknown')
    }),
    'destroy': () => {}
  };
}

export function createMapCommentManager(options = {}) {
  let manager = null;
  try {
    manager = new MapCommentManagerImpl(options);
  } catch (error) {
    const fallbackApi = createFallbackApi(error?.message || error, false);
    installDebugApi(fallbackApi);
    return fallbackApi;
  }
  const api = {
    'upsertFromChatPayload': (payload) => manager.upsertFromChatPayload(payload),
    'removeByMessageId': (messageId) => manager.removeByMessageId(messageId),
    'parse': (text) => extractMapLocationFromChatText(text),
    'setVisible': (visible) => manager.setCommentsVisible(visible),
    'isVisible': () => manager.commentsVisible,
    'getState': () => manager.getState(),
    'destroy': () => manager.destroy()
  };

  installDebugApi(api);
  return api;
}

