/** @file Time-archive template dialogs and point-capture flow.
 * @since 0.87.39
 */

import { makePanelDraggable, makePointerPannable, registerFloatingPanel } from './utils.js';
import { coordsTileCoordsToGeoCoords, getMapCanvasElement, projectGeoToScreen } from './utilsMaptiler.js';

/**
 * Creates the time-archive template UI helpers while keeping their internal modal state
 * encapsulated outside of `main.js`.
 *
 * @param {object} deps Shared helpers and runtime services from `main.js`.
 * @returns {{
 *   openArchiveTemplateBuilder: Function,
 *   startArchiveTemplatePointCapture: Function,
 *   cancelArchiveTemplatePointCapture: Function,
 *   handleArchiveTemplatePointCapture: Function,
 *   isArchiveTemplatePointCaptureActive: Function,
 * }}
 */
export const createArchiveTemplateUi = (deps = {}) => {
  const {
    t: translate = null,
    overlayMain,
    templateManager,
    applyOverlayVarsToFloatingElement,
    getTemplateTimeArchiveMeta,
    normalizeArchiveTemplateBaseUrl,
    normalizeTimeArchiveMeta,
    normalizeTilePixelCoords,
    formatTilePixelCoords,
    calculateTopLeftAndSize,
    TEMPLATE_TILE_SIZE,
    MAP_WORLD_WIDTH_PX,
    TEMPLATE_ARCHIVE_BASE_URL,
    TEMPLATE_ARCHIVE_PREVIEW_MAX_DIMENSION,
    TEMPLATE_ARCHIVE_PREVIEW_MAX_TILE_REQUESTS,
    TEMPLATE_ARCHIVE_PREVIEW_DOWNLOAD_CONCURRENCY,
    gmRequest,
    downloadTile,
    testCanvasSize,
    cleanUpCanvas,
    consoleWarn,
    downloadTemplateImageBlob,
  } = deps;

  const archiveTemplateVersionCache = new Map();
  const ARCHIVE_REGION_PIXEL_BASE_URL = 'https://backend.wplace.live/s0/pixel';
  const archiveTemplatePointCaptureState = {
    active: false,
    points: [],
    overlayInstance: null,
    lastCoordsKey: '',
    lastCoordsAt: 0,
  };
  let archiveTemplateWindowSession = null;
  const ARCHIVE_TEMPLATE_CAPTURE_HINT_ID = 'bm-archive-template-capture-hint';
  const interpolateText = (text, params = {}) => String(text).replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? ''));
  const tt = (key, fallback, params = {}) => {
    const translated = typeof translate === 'function' ? translate(key, params) : '';
    if (translated && translated !== key) {
      return translated;
    }
    return interpolateText(fallback, params);
  };

  const parseJsonResponse = (response, fallback = {}) => {
    const emptyFallback = fallback ?? {};
    if (!response) return emptyFallback;
    const raw = response.response ?? response.responseText;
    if (raw && typeof raw === 'object') {
      return raw;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return emptyFallback;
      try {
        return JSON.parse(trimmed);
      } catch (_) {
        return emptyFallback;
      }
    }
    return emptyFallback;
  };

  const clampNumber = (value, min, max, fallback = min) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  };

  const formatArchiveNameDate = (value, fallback = '') => {
    const text = String(value || '').trim();
    if (!text) return String(fallback || '').trim();
    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
    if (isoMatch) return isoMatch[1];
    const slashMatch = text.match(/^(\d{4}\/\d{2}\/\d{2})(?:[T\s].*)?$/);
    if (slashMatch) return slashMatch[1];
    const localeMatch = text.match(/^(\d{2}[./-]\d{2}[./-]\d{4})(?:[T\s].*)?$/);
    if (localeMatch) return localeMatch[1];
    const timeIndex = text.search(/\b\d{1,2}:\d{2}\b/);
    if (timeIndex > 0) {
      return text.slice(0, timeIndex).replace(/[,\s]+$/, '');
    }
    return text;
  };

  const buildLegacyArchiveTemplateName = ({ archiveDate = '', archiveVersion = '' } = {}) => {
    const label = String(archiveDate || archiveVersion || '').trim();
    return label ? `Archive ${label}` : 'Archive';
  };

  const buildArchiveCenterFallbackLabel = (coords) => {
    const normalized = normalizeTilePixelCoords(coords);
    if (!normalized) return 'Unknown Region';
    const [tx, ty, px, py] = normalized;
    return `Tile ${tx},${ty} Pixel ${px},${py}`;
  };

  const buildArchiveTemplateName = ({ regionName = '', centerCoords = null } = {}) => {
    return String(regionName || '').trim() || buildArchiveCenterFallbackLabel(centerCoords);
  };

  const getArchiveRectCenterCoords = (rect) => {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
      return null;
    }
    const centerX = ((rect.left + Math.floor((rect.width - 1) / 2)) % MAP_WORLD_WIDTH_PX + MAP_WORLD_WIDTH_PX) % MAP_WORLD_WIDTH_PX;
    const centerY = rect.top + Math.floor((rect.height - 1) / 2);
    const tx = Math.floor(centerX / TEMPLATE_TILE_SIZE);
    const ty = Math.floor(centerY / TEMPLATE_TILE_SIZE);
    const px = centerX % TEMPLATE_TILE_SIZE;
    const py = centerY % TEMPLATE_TILE_SIZE;
    return [tx, ty, px, py];
  };

  const fetchArchiveRegionName = async (coords) => {
    const normalized = normalizeTilePixelCoords(coords);
    if (!normalized) return '';
    const [tx, ty, px, py] = normalized;
    const url = `${ARCHIVE_REGION_PIXEL_BASE_URL}/${encodeURIComponent(tx)}/${encodeURIComponent(ty)}?x=${encodeURIComponent(px)}&y=${encodeURIComponent(py)}`;
    const response = await gmRequest(url, 'json');
    const data = parseJsonResponse(response, {});
    const regionName = String(data?.region?.name || '').trim();
    const regionNumber = String(data?.region?.number || '').trim();
    return [regionName, regionNumber].filter(Boolean).join(' ').trim();
  };

  const fetchArchiveTemplateVersions = async (rawBaseUrl = TEMPLATE_ARCHIVE_BASE_URL, force = false) => {
    const baseUrl = normalizeArchiveTemplateBaseUrl(rawBaseUrl);
    if (!force && archiveTemplateVersionCache.has(baseUrl)) {
      return archiveTemplateVersionCache.get(baseUrl);
    }
    const response = await gmRequest(`${baseUrl}/`, 'text');
    const status = Number(response?.status);
    if (status < 200 || status >= 300) {
      throw new Error(`Archive index request failed (${status}).`);
    }
    const html = String(response?.responseText || response?.response || '');
    const listMatch = html.match(/const\s+WPLACE_VERSIONS\s*=\s*\[([\s\S]*?)\];/);
    if (!listMatch) {
      throw new Error(tt('dialog.archive.error.versionListMissing', 'Archive version list was not found.'));
    }
    const versions = [];
    const entryRegex = /\{[^{}]*version:\s*['"]([^'"]+)['"][^{}]*date:\s*['"]([^'"]*)['"][^{}]*\}/g;
    let match;
    while ((match = entryRegex.exec(listMatch[1])) !== null) {
      const version = String(match[1] || '').trim();
      const date = String(match[2] || '').trim();
      if (!version) continue;
      versions.push({ version, date });
    }
    if (!versions.length) {
      throw new Error(tt('dialog.archive.error.versionListEmpty', 'Archive version list is empty.'));
    }
    archiveTemplateVersionCache.set(baseUrl, versions);
    return versions;
  };

  const buildArchiveTemplateRectFromPoints = (pointA, pointB) => {
    const first = normalizeTilePixelCoords(pointA);
    const second = normalizeTilePixelCoords(pointB);
    if (!first || !second) return null;
    const [[left, top], [width, height]] = calculateTopLeftAndSize(
      [[first[0], first[1]], [first[2], first[3]]],
      [[second[0], second[1]], [second[2], second[3]]]
    );
    const tx1 = Math.floor(left / TEMPLATE_TILE_SIZE);
    const ty1 = Math.floor(top / TEMPLATE_TILE_SIZE);
    const px1 = left % TEMPLATE_TILE_SIZE;
    const py1 = top % TEMPLATE_TILE_SIZE;
    const maxX = left + width - 1;
    const maxY = top + height - 1;
    const tx2 = Math.floor(maxX / TEMPLATE_TILE_SIZE);
    const ty2 = Math.floor(maxY / TEMPLATE_TILE_SIZE);
    const tileWidth = tx2 - tx1 + 1;
    const tileHeight = ty2 - ty1 + 1;
    const safeMaxX = ((maxX % MAP_WORLD_WIDTH_PX) + MAP_WORLD_WIDTH_PX) % MAP_WORLD_WIDTH_PX;
    const displayTx2 = Math.floor(safeMaxX / TEMPLATE_TILE_SIZE);
    const displayPx2 = safeMaxX % TEMPLATE_TILE_SIZE;
    const displayPy2 = ((maxY % TEMPLATE_TILE_SIZE) + TEMPLATE_TILE_SIZE) % TEMPLATE_TILE_SIZE;
    return {
      left,
      top,
      width,
      height,
      tx1,
      ty1,
      px1,
      py1,
      tx2,
      ty2,
      tileWidth,
      tileHeight,
      tileCount: tileWidth * tileHeight,
      displayBottomRight: [displayTx2, ty2, displayPx2, displayPy2],
    };
  };

  const iterateArchiveTemplateTiles = async (rect, options = {}) => {
    const archiveVersion = String(options?.archiveVersion || '').trim();
    const archiveBaseUrl = normalizeArchiveTemplateBaseUrl(options?.archiveBaseUrl);
    const requestedConcurrency = Math.trunc(Number(options?.concurrency) || 1);
    const concurrency = Math.max(1, Math.min(16, requestedConcurrency));
    if (!archiveVersion) {
      throw new Error(tt('dialog.archive.error.versionRequired', 'Archive version is required.'));
    }
    if (!rect || !Number.isFinite(rect.tx1) || !Number.isFinite(rect.ty1) || !Number.isFinite(rect.tx2) || !Number.isFinite(rect.ty2)) {
      throw new Error(tt('dialog.archive.error.selectionInvalid', 'Archive selection is invalid.'));
    }
    const onTile = typeof options?.onTile === 'function' ? options.onTile : null;
    const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
    const tileTasks = [];
    for (let ty = rect.ty1; ty <= rect.ty2; ty++) {
      for (let tx = rect.tx1; tx <= rect.tx2; tx++) {
        tileTasks.push({ tx, ty });
      }
    }
    if (!tileTasks.length) return;
    let taskCursor = 0;
    let completed = 0;
    const runWorker = async () => {
      while (true) {
        const index = taskCursor++;
        if (index >= tileTasks.length) return;
        const { tx, ty } = tileTasks[index];
        const image = await downloadTile(tx % 2048, ty, {
          source: 'archive',
          archiveBaseUrl,
          archiveVersion,
        });
        if (onTile) {
          await onTile({ image, tx, ty });
        }
        completed++;
        if (onProgress) {
          onProgress(completed, rect.tileCount);
        }
      }
    };
    const workerCount = Math.min(concurrency, tileTasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  };

  /** `2025-08-09T22` (hour 22, UTC) -> `2025-08-09 22:00 UTC`; plain dates pass through. */
  const formatArchiveVersionLabel = (entry) => {
    const date = String(entry?.date || '').trim();
    const hourMatch = date.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2})(?::(\d{2}))?/);
    if (hourMatch) return `${hourMatch[1]} ${hourMatch[2].padStart(2, '0')}:${hourMatch[3] || '00'} UTC`;
    return date || String(entry?.version || '').trim();
  };

  /** Absolute world pixel -> [tileX, tileY, pixelX, pixelY]. */
  const worldPointToCoords = (x, y) => {
    const wrappedX = ((x % MAP_WORLD_WIDTH_PX) + MAP_WORLD_WIDTH_PX) % MAP_WORLD_WIDTH_PX;
    return [
      Math.floor(wrappedX / TEMPLATE_TILE_SIZE),
      Math.floor(y / TEMPLATE_TILE_SIZE),
      wrappedX % TEMPLATE_TILE_SIZE,
      y % TEMPLATE_TILE_SIZE,
    ];
  };

  /** Selection rectangle from world edges (right/bottom exclusive). */
  const buildArchiveTemplateRectFromEdges = ({ left, top, right, bottom }) => buildArchiveTemplateRectFromPoints(
    worldPointToCoords(left, top),
    worldPointToCoords(right - 1, bottom - 1)
  );

  /** Map-canvas (CSS px) position of an absolute world pixel corner. */
  const projectWorldPoint = (x, y) => {
    // Tile [0, 0] plus an absolute pixel offset: the conversion only ever sums the two.
    const geo = coordsTileCoordsToGeoCoords([0, 0], [x, y], false);
    return projectGeoToScreen(geo[0], geo[1]);
  };

  // Map previews never need more than about a screen's worth of pixels.
  const ARCHIVE_MAP_PREVIEW_MAX_DIMENSION = Math.min(2048, TEMPLATE_ARCHIVE_PREVIEW_MAX_DIMENSION);
  // Decoded versions kept around for scrubbing back and forth.
  const ARCHIVE_PREVIEW_MEMORY_BUDGET = 192 * 1024 * 1024;
  const ARCHIVE_PREVIEW_MAX_ENTRIES = 24;
  const ARCHIVE_PREVIEW_PREFETCH_RADIUS = 3;
  const ARCHIVE_SCRUB_LOAD_DELAY_MS = 120;
  const ARCHIVE_HANDLES = [
    ['nw', -1, -1, 'nwse-resize'],
    ['n', 0, -1, 'ns-resize'],
    ['ne', 1, -1, 'nesw-resize'],
    ['e', 1, 0, 'ew-resize'],
    ['se', 1, 1, 'nwse-resize'],
    ['s', 0, 1, 'ns-resize'],
    ['sw', -1, 1, 'nesw-resize'],
    ['w', -1, 0, 'ew-resize'],
  ];

  /**
   * Opens the time machine for a selected rectangular region: the selection is drawn on the map
   * with the archive snapshot inside it and resize handles around it, next to a compact panel to
   * pick the date and create the template.
   *
   * @param {object} options Selected points and optional update target.
   * @returns {Promise<object|null>}
   */
  const openArchiveTemplateBuilder = ({ firstPoint, secondPoint, overlayInstance = null, targetTemplate = null } = {}) => {
    const activeOverlay = overlayInstance || overlayMain;
    const initialRect = buildArchiveTemplateRectFromPoints(firstPoint, secondPoint);
    if (!initialRect) {
      activeOverlay?.handleDisplayError(tt('dialog.archive.range.invalid', 'Could not read the selected archive range.'));
      return Promise.resolve(null);
    }
    const targetTemplateMeta = getTemplateTimeArchiveMeta(targetTemplate);
    const targetTemplateName = String(targetTemplate?.displayName || '').trim();
    const targetTemplateStorageKey = String(targetTemplate?.storageKey || '').trim();
    const isUpdateMode = Boolean(targetTemplateStorageKey);
    if (archiveTemplateWindowSession?.close) {
      archiveTemplateWindowSession.close(null);
    }
    const archiveBaseUrl = normalizeArchiveTemplateBaseUrl(TEMPLATE_ARCHIVE_BASE_URL);
    const archiveHost = (() => {
      try { return new URL(archiveBaseUrl).host; } catch (_) { return archiveBaseUrl; }
    })();
    const numberFmt = new Intl.NumberFormat();

    return new Promise((resolve) => {
      /* ---- selection state ------------------------------------------------ */

      let rect = initialRect;
      /** Live world edges; differ from `rect` only while a handle is being dragged. */
      let edges = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
      let previewTiles = [];
      let previewDims = null;
      let previewSupported = false;
      let supportsCreate = false;
      let maxPreviewEntries = 2;
      const applyRectDerivedState = () => {
        previewTiles = [];
        for (let ty = rect.ty1; ty <= rect.ty2; ty++) {
          for (let tx = rect.tx1; tx <= rect.tx2; tx++) {
            previewTiles.push({ tx, ty });
          }
        }
        const scale = Math.min(1, ARCHIVE_MAP_PREVIEW_MAX_DIMENSION / Math.max(rect.width, rect.height));
        previewDims = {
          scale,
          width: Math.max(1, Math.round(rect.width * scale)),
          height: Math.max(1, Math.round(rect.height * scale)),
        };
        previewSupported = rect.tileCount <= TEMPLATE_ARCHIVE_PREVIEW_MAX_TILE_REQUESTS;
        try {
          supportsCreate = testCanvasSize(rect.width, rect.height);
        } catch (_) {
          supportsCreate = false;
        }
        const entryBytes = previewDims.width * previewDims.height * 4;
        maxPreviewEntries = Math.max(2, Math.min(ARCHIVE_PREVIEW_MAX_ENTRIES, Math.floor(ARCHIVE_PREVIEW_MEMORY_BUDGET / entryBytes)));
      };
      applyRectDerivedState();

      let closed = false;
      let busy = false;
      let dragging = false;
      let loadingVersions = false;
      let archiveVersions = [];
      let selectedIndex = -1;
      let selectedVersionValue = String(targetTemplateMeta?.archiveVersion || '').trim();
      let frameRaf = 0;
      let scrubTimer = 0;
      let prefetching = false;
      let lastFrameBox = '';
      let lastImageBox = '';
      let frameScreenWidth = 0;
      let statusMessage = '';
      let statusIsError = false;
      const cleanups = [];

      /* ---- on-map frame ------------------------------------------------------ */

      const frame = document.createElement('div');
      frame.className = 'bm-archive-frame';
      frame.style.display = 'none';
      const frameImage = document.createElement('canvas');
      frameImage.className = 'bm-archive-frame-image';
      frameImage.width = 0;
      frameImage.height = 0;
      // Clips the snapshot to the selection while the handles stick out past its edge.
      const frameClip = document.createElement('div');
      frameClip.className = 'bm-archive-frame-clip';
      frameClip.appendChild(frameImage);
      frame.appendChild(frameClip);
      const frameBadge = document.createElement('div');
      frameBadge.className = 'bm-archive-frame-badge';
      frame.appendChild(frameBadge);
      /** World edges of what `frameImage` currently shows; kept while a new version loads. */
      let shownImageEdges = null;
      let shownVersion = '';

      /* ---- panel ------------------------------------------------------------- */

      const panel = document.createElement('section');
      panel.className = 'bm-archive-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', tt('dialog.archive.ariaLabel', 'Time archive template builder'));

      const header = document.createElement('div');
      header.className = 'bm-archive-panel-header';
      header.title = tt('dialog.common.dragToMove', 'Drag to move');
      const title = document.createElement('strong');
      title.className = 'bm-archive-panel-title';
      title.textContent = isUpdateMode
        ? tt('dialog.archive.title.update', 'Time machine: update template')
        : tt('dialog.archive.title.create', 'Time machine');
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'bm-archive-icon-btn';
      // Icons are SVG and texts plain ASCII: custom UI fonts (theme editor) remap symbols such as
      // × to unrelated letters.
      closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      closeBtn.title = tt('dialog.common.close', 'Close');
      closeBtn.setAttribute('aria-label', closeBtn.title);
      header.append(title, closeBtn);

      const dateRow = document.createElement('div');
      dateRow.className = 'bm-archive-date-row';
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'bm-archive-icon-btn';
      prevBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';
      prevBtn.title = tt('dialog.archive.prev', 'Earlier');
      prevBtn.setAttribute('aria-label', prevBtn.title);
      const dateSelect = document.createElement('select');
      dateSelect.className = 'bm-archive-date-select';
      dateSelect.setAttribute('aria-label', tt('dialog.archive.date', 'Date'));
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'bm-archive-icon-btn';
      nextBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
      nextBtn.title = tt('dialog.archive.next', 'Later');
      nextBtn.setAttribute('aria-label', nextBtn.title);
      dateRow.append(prevBtn, dateSelect, nextBtn);

      const timeline = document.createElement('input');
      timeline.type = 'range';
      timeline.className = 'bm-archive-timeline';
      timeline.min = '0';
      timeline.max = '0';
      timeline.step = '1';
      timeline.value = '0';
      timeline.setAttribute('aria-label', tt('dialog.archive.timeline', 'Timeline'));

      const summary = document.createElement('div');
      summary.className = 'bm-archive-summary';
      const status = document.createElement('div');
      status.className = 'bm-archive-status';

      const progress = document.createElement('progress');
      progress.className = 'bm-archive-progress';
      progress.max = 1;
      progress.value = 0;
      progress.hidden = true;

      const actions = document.createElement('div');
      actions.className = 'bm-archive-actions';
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'bm-archive-create-btn';
      createBtn.textContent = isUpdateMode
        ? tt('dialog.archive.button.update', 'Update template')
        : tt('dialog.common.createTemplate', 'Create Template');
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'bm-archive-icon-btn bm-archive-download-btn';
      downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>';
      downloadBtn.title = isUpdateMode
        ? tt('dialog.archive.button.updateDownload', 'Update and download the PNG')
        : tt('dialog.archive.button.createDownload', 'Create and download the PNG');
      downloadBtn.setAttribute('aria-label', downloadBtn.title);
      actions.append(createBtn, downloadBtn);

      const footer = document.createElement('div');
      footer.className = 'bm-archive-footer';
      const footerText = document.createElement('span');
      const archiveLink = document.createElement('a');
      archiveLink.href = archiveBaseUrl;
      archiveLink.target = '_blank';
      archiveLink.rel = 'noopener noreferrer';
      archiveLink.textContent = archiveHost;
      footerText.append(`${tt('dialog.archive.footer.source', 'Archive')}: `, archiveLink, ` · ${tt('dialog.archive.footer.utc', 'UTC time')}`);
      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'bm-archive-link-btn';
      refreshBtn.textContent = '↻';
      refreshBtn.title = tt('dialog.archive.refresh', 'Reload dates');
      refreshBtn.setAttribute('aria-label', refreshBtn.title);
      footer.append(footerText, refreshBtn);

      panel.append(header, dateRow, timeline, summary, status, progress, actions, footer);

      /* ---- text ------------------------------------------------------------- */

      const setStatus = (message = '', isError = false) => {
        statusMessage = String(message || '');
        statusIsError = isError;
        status.textContent = statusMessage;
        status.hidden = !statusMessage;
        status.classList.toggle('bm-archive-status-error', isError);
      };

      const getSelectedEntry = () => (selectedIndex >= 0 ? archiveVersions[selectedIndex] || null : null);

      const countColoredPixels = (entry) => {
        if (entry.coloredPixels !== null) return entry.coloredPixels;
        let count = 0;
        try {
          const data = entry.context.getImageData(0, 0, entry.width, entry.height).data;
          for (let index = 3; index < data.length; index += 4) {
            if (data[index] !== 0) count++;
          }
        } catch (_) {
          return null;
        }
        entry.coloredPixels = entry.scale < 1 ? Math.round(count / (entry.scale * entry.scale)) : count;
        return entry.coloredPixels;
      };

      const updateSummary = () => {
        const width = edges.right - edges.left;
        const height = edges.bottom - edges.top;
        const parts = [tt('dialog.archive.summary.size', '{width} x {height} px', {
          width: numberFmt.format(width),
          height: numberFmt.format(height),
        })];
        const entry = !dragging && selectedVersionValue ? previewEntries.get(selectedVersionValue) : null;
        if (entry?.status === 'ready') {
          const colored = countColoredPixels(entry);
          if (colored !== null) {
            parts.push(tt(entry.scale < 1 ? 'dialog.archive.summary.coloredApprox' : 'dialog.archive.summary.colored',
              entry.scale < 1 ? '~{count} colored pixels' : '{count} colored pixels',
              { count: numberFmt.format(colored) }));
          }
        }
        summary.textContent = parts.join(' · ');
        frameBadge.textContent = parts[0];
      };

      const updatePreviewStatus = () => {
        if (busy) return;
        if (loadingVersions) {
          setStatus(tt('dialog.archive.status.loadingVersions', 'Loading archive dates...'));
          return;
        }
        if (!archiveVersions.length) return; // the load error stays up
        if (!supportsCreate) {
          setStatus(tt('dialog.archive.status.selectionTooLarge', 'Selection {width} x {height} is too large for this browser.', {
            width: numberFmt.format(rect.width),
            height: numberFmt.format(rect.height),
          }), true);
          return;
        }
        if (!previewSupported) {
          setStatus(tt('dialog.archive.preview.skippedStatus', 'No preview for areas over {limit} tiles; the template can still be created.', {
            limit: numberFmt.format(TEMPLATE_ARCHIVE_PREVIEW_MAX_TILE_REQUESTS),
          }));
          return;
        }
        const entry = selectedVersionValue ? previewEntries.get(selectedVersionValue) : null;
        if (!entry || entry.status === 'loading') {
          setStatus(tt('dialog.archive.preview.loadingProgress', 'Loading snapshot... {done} / {total} tiles', {
            done: numberFmt.format(entry?.completedTiles || 0),
            total: numberFmt.format(previewTiles.length),
          }));
          return;
        }
        if (entry.status === 'error') {
          setStatus(tt('dialog.archive.preview.failedStatus', 'Could not load this snapshot: {error}', {
            error: entry.error?.message || entry.error,
          }), true);
          return;
        }
        setStatus(entry.failedTiles > 0
          ? tt('dialog.archive.preview.partial', '{count} tiles of this snapshot are missing from the archive.', {
            count: numberFmt.format(entry.failedTiles),
          })
          : '');
      };

      const updateActionState = () => {
        const hasVersion = Boolean(getSelectedEntry()?.version);
        closeBtn.disabled = busy;
        const navDisabled = busy || loadingVersions || !archiveVersions.length;
        dateSelect.disabled = navDisabled;
        timeline.disabled = navDisabled;
        prevBtn.disabled = navDisabled || selectedIndex <= 0;
        nextBtn.disabled = navDisabled || selectedIndex >= archiveVersions.length - 1;
        refreshBtn.disabled = busy || loadingVersions;
        createBtn.disabled = busy || dragging || !hasVersion || !supportsCreate;
        downloadBtn.disabled = createBtn.disabled;
        frame.classList.toggle('bm-archive-frame-busy', busy);
      };

      /* ---- snapshot previews ------------------------------------------------ */

      /** Decoded previews by version, least recently used first. */
      const previewEntries = new Map();

      const releasePreviewEntry = (entry) => {
        entry.cancelled = true;
        if (entry.canvas) cleanUpCanvas(entry.canvas);
        entry.canvas = null;
        entry.context = null;
      };

      const resetPreviewEntries = () => {
        previewEntries.forEach(releasePreviewEntry);
        previewEntries.clear();
        prefetching = false;
      };

      const evictPreviewEntries = () => {
        for (const [version, entry] of previewEntries) {
          if (previewEntries.size <= maxPreviewEntries) break;
          if (version === selectedVersionValue) continue;
          previewEntries.delete(version);
          releasePreviewEntry(entry);
        }
      };

      const drawTileIntoEntry = (entry, tx, ty, image) => {
        if (!entry.context) return;
        const entryRect = entry.rect;
        const tileLeft = tx * TEMPLATE_TILE_SIZE;
        const tileTop = ty * TEMPLATE_TILE_SIZE;
        const intersectLeft = Math.max(entryRect.left, tileLeft);
        const intersectTop = Math.max(entryRect.top, tileTop);
        const intersectRight = Math.min(entryRect.left + entryRect.width, tileLeft + TEMPLATE_TILE_SIZE);
        const intersectBottom = Math.min(entryRect.top + entryRect.height, tileTop + TEMPLATE_TILE_SIZE);
        const intersectWidth = intersectRight - intersectLeft;
        const intersectHeight = intersectBottom - intersectTop;
        if (intersectWidth <= 0 || intersectHeight <= 0) return;
        const smooth = entry.scale < 1;
        entry.context.imageSmoothingEnabled = smooth;
        if (smooth) entry.context.imageSmoothingQuality = 'high';
        entry.context.drawImage(
          image,
          intersectLeft - tileLeft,
          intersectTop - tileTop,
          intersectWidth,
          intersectHeight,
          (intersectLeft - entryRect.left) * entry.scale,
          (intersectTop - entryRect.top) * entry.scale,
          intersectWidth * entry.scale,
          intersectHeight * entry.scale
        );
      };

      /** Puts a preview on the map frame. A version still loading only replaces the picture when
       * nothing else covers this area yet, so scrubbing never blinks to an empty frame. */
      const showPreviewEntry = (entry) => {
        if (!entry?.canvas || closed) return;
        const sameArea = shownImageEdges
          && shownImageEdges.left === edgesOfRect(entry.rect).left
          && shownImageEdges.top === edgesOfRect(entry.rect).top
          && shownImageEdges.right === edgesOfRect(entry.rect).right
          && shownImageEdges.bottom === edgesOfRect(entry.rect).bottom;
        if (entry.status !== 'ready' && shownVersion !== entry.version && sameArea) return;
        if (entry.completedTiles <= 0) return;
        if (frameImage.width !== entry.width || frameImage.height !== entry.height) {
          frameImage.width = entry.width;
          frameImage.height = entry.height;
        }
        const context = frameImage.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, entry.width, entry.height);
        context.drawImage(entry.canvas, 0, 0);
        shownImageEdges = edgesOfRect(entry.rect);
        shownVersion = entry.version;
        lastImageBox = '';
        positionFrame();
      };

      const onPreviewEntryProgress = (entry) => {
        if (closed || entry.cancelled) return;
        if (entry.version === selectedVersionValue) {
          showPreviewEntry(entry);
          updatePreviewStatus();
          if (entry.status !== 'loading') updateSummary();
        }
        if (entry.status !== 'loading') schedulePrefetch();
      };

      const fillPreviewEntry = async (entry) => {
        let cursor = 0;
        const concurrency = Math.max(1, Math.min(16, Math.trunc(Number(TEMPLATE_ARCHIVE_PREVIEW_DOWNLOAD_CONCURRENCY) || 6)));
        const worker = async () => {
          while (cursor < entry.tiles.length) {
            if (entry.cancelled || closed) return;
            const { tx, ty } = entry.tiles[cursor++];
            try {
              const image = await downloadTile(tx % 2048, ty, {
                source: 'archive',
                archiveBaseUrl,
                archiveVersion: entry.version,
              });
              if (entry.cancelled || closed) return;
              drawTileIntoEntry(entry, tx, ty, image);
            } catch (error) {
              if (entry.cancelled || closed) return;
              entry.failedTiles++;
              entry.error = error;
            }
            entry.completedTiles++;
            onPreviewEntryProgress(entry);
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, entry.tiles.length) }, () => worker()));
        if (entry.cancelled || closed) return;
        entry.status = entry.failedTiles >= entry.totalTiles ? 'error' : 'ready';
        onPreviewEntryProgress(entry);
      };

      const ensurePreviewEntry = (version) => {
        const existing = previewEntries.get(version);
        if (existing) {
          previewEntries.delete(version);
          previewEntries.set(version, existing);
          return existing;
        }
        const entry = {
          version,
          rect,
          tiles: previewTiles,
          width: previewDims.width,
          height: previewDims.height,
          scale: previewDims.scale,
          canvas: null,
          context: null,
          totalTiles: previewTiles.length,
          completedTiles: 0,
          failedTiles: 0,
          status: 'loading',
          error: null,
          coloredPixels: null,
          cancelled: false,
          done: null,
        };
        try {
          entry.canvas = new OffscreenCanvas(entry.width, entry.height);
          entry.context = entry.canvas.getContext('2d');
          if (!entry.context) throw new Error(tt('dialog.archive.error.previewCanvas', 'Could not initialize preview canvas.'));
        } catch (error) {
          entry.status = 'error';
          entry.error = error;
          entry.done = Promise.resolve();
          previewEntries.set(version, entry);
          return entry;
        }
        previewEntries.set(version, entry);
        evictPreviewEntries();
        entry.done = fillPreviewEntry(entry).catch((error) => {
          entry.status = 'error';
          entry.error = error;
          onPreviewEntryProgress(entry);
        });
        return entry;
      };

      /** Once the selected snapshot is in, decode its neighbours one at a time for scrubbing. */
      const schedulePrefetch = () => {
        if (prefetching || busy || closed || dragging || !previewSupported || selectedIndex < 0) return;
        const selected = previewEntries.get(selectedVersionValue);
        if (!selected || selected.status === 'loading') return;
        const radius = Math.min(ARCHIVE_PREVIEW_PREFETCH_RADIUS, Math.floor((maxPreviewEntries - 1) / 2));
        for (let distance = 1; distance <= radius; distance++) {
          for (const index of [selectedIndex + distance, selectedIndex - distance]) {
            const version = String(archiveVersions[index]?.version || '').trim();
            if (!version || previewEntries.has(version)) continue;
            prefetching = true;
            const entry = ensurePreviewEntry(version);
            const generationRect = rect;
            entry.done.finally(() => {
              if (generationRect !== rect) return; // reset by a resize; its own prefetch restarts
              prefetching = false;
              schedulePrefetch();
            });
            return;
          }
        }
      };

      const requestSelectedPreview = () => {
        updateSummary();
        if (!selectedVersionValue || !previewSupported || !supportsCreate) {
          updatePreviewStatus();
          return;
        }
        const entry = ensurePreviewEntry(selectedVersionValue);
        showPreviewEntry(entry);
        updatePreviewStatus();
        schedulePrefetch();
      };

      /* ---- frame tracking --------------------------------------------------- */

      function edgesOfRect(target) {
        return { left: target.left, top: target.top, right: target.left + target.width, bottom: target.top + target.height };
      }

      /** Glues the frame to the selection while the map pans or zooms. Polled per frame: nothing
       * here exposes the map's own move events. */
      function positionFrame() {
        const topLeft = projectWorldPoint(edges.left, edges.top);
        const bottomRight = projectWorldPoint(edges.right, edges.bottom);
        const canvasRect = getMapCanvasElement()?.getBoundingClientRect();
        const width = bottomRight && topLeft ? bottomRight.x - topLeft.x : NaN;
        const height = bottomRight && topLeft ? bottomRight.y - topLeft.y : NaN;
        if (!canvasRect || !(width > 0) || !(height > 0)) {
          if (lastFrameBox !== 'hidden') {
            frame.style.display = 'none';
            lastFrameBox = 'hidden';
          }
          return;
        }
        frameScreenWidth = width;
        const box = `${canvasRect.left + topLeft.x}|${canvasRect.top + topLeft.y}|${width}|${height}`;
        if (box !== lastFrameBox) {
          lastFrameBox = box;
          frame.style.display = '';
          frame.style.left = `${canvasRect.left + topLeft.x}px`;
          frame.style.top = `${canvasRect.top + topLeft.y}px`;
          frame.style.width = `${width}px`;
          frame.style.height = `${height}px`;
          // Tiny selections at low zoom would hide their own handles.
          frame.classList.toggle('bm-archive-frame-small', width < 36 || height < 36);
        }
        // The shown snapshot keeps its own world position, so while a handle is dragged (or a new
        // size is loading) it stays put on the map instead of stretching with the frame.
        const spanX = edges.right - edges.left;
        const spanY = edges.bottom - edges.top;
        const imageBox = shownImageEdges
          ? [
            ((shownImageEdges.left - edges.left) / spanX) * 100,
            ((shownImageEdges.top - edges.top) / spanY) * 100,
            ((shownImageEdges.right - shownImageEdges.left) / spanX) * 100,
            ((shownImageEdges.bottom - shownImageEdges.top) / spanY) * 100,
          ].map(value => value.toFixed(4)).join('|')
          : 'none';
        if (imageBox !== lastImageBox) {
          lastImageBox = imageBox;
          if (shownImageEdges) {
            const [left, top, width, height] = imageBox.split('|');
            frameImage.style.display = '';
            frameImage.style.left = `${left}%`;
            frameImage.style.top = `${top}%`;
            frameImage.style.width = `${width}%`;
            frameImage.style.height = `${height}%`;
          } else {
            frameImage.style.display = 'none';
          }
        }
      }

      const trackFrame = () => {
        if (closed) return;
        positionFrame();
        frameRaf = requestAnimationFrame(trackFrame);
      };

      /* ---- resize handles --------------------------------------------------- */

      const commitEdges = () => {
        const nextRect = buildArchiveTemplateRectFromEdges(edges);
        if (!nextRect) {
          edges = edgesOfRect(rect);
          return;
        }
        if (nextRect.left === rect.left && nextRect.top === rect.top
          && nextRect.width === rect.width && nextRect.height === rect.height) {
          return;
        }
        rect = nextRect;
        edges = edgesOfRect(rect);
        resetPreviewEntries();
        applyRectDerivedState();
        requestSelectedPreview();
        updateActionState();
      };

      /** Drags the selection's edges: one side per axis for a handle (hx/hy -1 or 1 picks the
       * left/top or right/bottom edge, 0 leaves that axis alone), or the whole box for `move`. */
      const attachEdgeDrag = (element, hx, hy, move = false) => {
        cleanups.push(makePointerPannable(element, {
          onStart: () => {
            if (busy || !(frameScreenWidth > 0)) return null;
            const scale = frameScreenWidth / (edges.right - edges.left);
            if (!(scale > 0)) return null;
            dragging = true;
            frame.classList.add('bm-archive-frame-dragging');
            updateActionState();
            return { start: { ...edges }, scale };
          },
          onMove: (dx, dy, context) => {
            const { start, scale } = context;
            const deltaX = Math.round(dx / scale);
            const deltaY = Math.round(dy / scale);
            const next = { ...start };
            if (move) {
              const width = start.right - start.left;
              const height = start.bottom - start.top;
              next.left = clampNumber(start.left + deltaX, 0, MAP_WORLD_WIDTH_PX - width);
              next.top = clampNumber(start.top + deltaY, 0, MAP_WORLD_WIDTH_PX - height);
              next.right = next.left + width;
              next.bottom = next.top + height;
            } else {
              if (hx < 0) next.left = clampNumber(start.left + deltaX, 0, start.right - 1);
              if (hx > 0) next.right = clampNumber(start.right + deltaX, start.left + 1, MAP_WORLD_WIDTH_PX);
              if (hy < 0) next.top = clampNumber(start.top + deltaY, 0, start.bottom - 1);
              if (hy > 0) next.bottom = clampNumber(start.bottom + deltaY, start.top + 1, MAP_WORLD_WIDTH_PX);
            }
            edges = next;
            positionFrame();
            updateSummary();
          },
          onEnd: () => {
            dragging = false;
            frame.classList.remove('bm-archive-frame-dragging');
            commitEdges();
            updateSummary();
            updateActionState();
          },
        }));
      };

      // The zone itself moves the selection. It sits on top of the map, so the wheel would stop
      // zooming over it; hand wheel events on to the map canvas instead.
      const moveArea = document.createElement('div');
      moveArea.className = 'bm-archive-move-area';
      frame.appendChild(moveArea);
      attachEdgeDrag(moveArea, 0, 0, true);
      const forwardWheel = (event) => {
        const mapCanvas = getMapCanvasElement();
        if (!mapCanvas) return;
        event.preventDefault();
        mapCanvas.dispatchEvent(new WheelEvent('wheel', event));
      };
      moveArea.addEventListener('wheel', forwardWheel, { passive: false });
      cleanups.push(() => moveArea.removeEventListener('wheel', forwardWheel));

      ARCHIVE_HANDLES.forEach(([name, hx, hy, cursor]) => {
        const handle = document.createElement('div');
        handle.className = 'bm-archive-handle';
        handle.dataset.rmHandle = name;
        handle.style.left = `${(hx + 1) * 50}%`;
        handle.style.top = `${(hy + 1) * 50}%`;
        handle.style.cursor = cursor;
        frame.appendChild(handle);
        attachEdgeDrag(handle, hx, hy);
      });

      /* ---- date selection --------------------------------------------------- */

      const selectVersionIndex = (index, { immediate = true } = {}) => {
        if (!archiveVersions.length) return;
        const safeIndex = Math.max(0, Math.min(archiveVersions.length - 1, Math.trunc(Number(index) || 0)));
        selectedIndex = safeIndex;
        selectedVersionValue = String(archiveVersions[safeIndex]?.version || '').trim();
        if (dateSelect.value !== String(safeIndex)) dateSelect.value = String(safeIndex);
        if (timeline.value !== String(safeIndex)) timeline.value = String(safeIndex);
        updateActionState();
        clearTimeout(scrubTimer);
        if (immediate) {
          requestSelectedPreview();
        } else {
          // Dragging the slider passes through many dates; only decode where it settles.
          updateSummary();
          scrubTimer = setTimeout(requestSelectedPreview, ARCHIVE_SCRUB_LOAD_DELAY_MS);
        }
      };

      const populateVersions = (versions) => {
        archiveVersions = Array.isArray(versions) ? versions.slice() : [];
        dateSelect.textContent = '';
        archiveVersions.forEach((entry, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = formatArchiveVersionLabel(entry);
          dateSelect.appendChild(option);
        });
        timeline.max = String(Math.max(0, archiveVersions.length - 1));
        if (!archiveVersions.length) {
          selectedIndex = -1;
          return;
        }
        const preferred = String(selectedVersionValue || '').trim();
        const found = preferred
          ? archiveVersions.findIndex(entry => String(entry?.version || '').trim() === preferred)
          : -1;
        selectVersionIndex(found >= 0 ? found : archiveVersions.length - 1);
      };

      const loadVersions = async (force = false) => {
        loadingVersions = true;
        updateActionState();
        updatePreviewStatus();
        try {
          const versions = await fetchArchiveTemplateVersions(archiveBaseUrl, force);
          if (closed) return;
          loadingVersions = false;
          populateVersions(versions);
        } catch (error) {
          if (closed) return;
          loadingVersions = false;
          archiveVersions = [];
          selectedIndex = -1;
          dateSelect.textContent = '';
          setStatus(tt('dialog.archive.status.failedVersions', 'Failed to load archive dates: {error}', {
            error: error?.message || error,
          }), true);
        } finally {
          loadingVersions = false;
          if (!closed) updateActionState();
        }
      };

      /* ---- create ----------------------------------------------------------- */

      const setProgress = (done = 0, total = 0) => {
        progress.max = Math.max(1, Number(total) || 1);
        progress.value = Math.max(0, Math.min(progress.max, Number(done) || 0));
        progress.hidden = false;
      };

      const createArchiveTemplate = async (downloadAfterCreate = false) => {
        const selectedEntry = getSelectedEntry();
        const archiveVersion = String(selectedEntry?.version || '').trim();
        const selectedVersionDate = String(selectedEntry?.date || '').trim();
        if (!archiveVersion) {
          setStatus(tt('dialog.archive.status.selectDateFirst', 'Select an archive date first.'), true);
          return;
        }
        if (!supportsCreate) {
          setStatus(tt('dialog.archive.status.tooLarge', 'Selection is too large for this browser to build a template image.'), true);
          return;
        }
        const buildRect = rect;
        busy = true;
        clearTimeout(scrubTimer);
        updateActionState();
        setStatus(tt('dialog.archive.status.building', 'Building the snapshot ({tiles} tiles)...', {
          tiles: numberFmt.format(buildRect.tileCount),
        }));
        setProgress(0, buildRect.tileCount);
        const centerCoords = getArchiveRectCenterCoords(buildRect);
        const regionNamePromise = fetchArchiveRegionName(centerCoords).catch((error) => {
          consoleWarn('Failed to resolve archive region name for template.', error);
          return '';
        });
        let resultCanvas = new OffscreenCanvas(buildRect.width, buildRect.height);
        try {
          const context = resultCanvas.getContext('2d');
          if (!context) {
            throw new Error(tt('dialog.archive.error.templateCanvas', 'Failed to initialize template canvas.'));
          }
          context.imageSmoothingEnabled = false;
          context.clearRect(0, 0, buildRect.width, buildRect.height);
          await iterateArchiveTemplateTiles(buildRect, {
            archiveVersion,
            archiveBaseUrl,
            concurrency: TEMPLATE_ARCHIVE_PREVIEW_DOWNLOAD_CONCURRENCY,
            onProgress: (done, total) => setProgress(done, total),
            onTile: ({ image, tx, ty }) => {
              context.drawImage(
                image,
                tx * TEMPLATE_TILE_SIZE - buildRect.left,
                ty * TEMPLATE_TILE_SIZE - buildRect.top
              );
            },
          });
          const blob = await resultCanvas.convertToBlob({ type: 'image/png' });
          const archiveNameDate = formatArchiveNameDate(selectedVersionDate, archiveVersion);
          const sourceTag = (archiveNameDate || archiveVersion).replace(/[^a-z0-9._-]+/gi, '_');
          const fileName = `archive_${sourceTag}_${buildRect.tx1}_${buildRect.ty1}_${buildRect.px1}_${buildRect.py1}.png`;
          const file = new File([blob], fileName, { type: 'image/png' });
          const regionName = await regionNamePromise;
          const autoTemplateName = buildArchiveTemplateName({ regionName, centerCoords });
          const previousAutoTemplateName = buildArchiveTemplateName({
            regionName: String(targetTemplateMeta?.regionName || '').trim(),
            centerCoords,
          });
          const previousLegacyTemplateName = buildLegacyArchiveTemplateName({
            archiveDate: targetTemplateMeta?.archiveDate,
            archiveVersion: targetTemplateMeta?.archiveVersion,
          });
          const normalizedTargetTemplateName = String(targetTemplateName || '').trim();
          const shouldUseAutoTemplateName =
            !normalizedTargetTemplateName
            || normalizedTargetTemplateName === previousAutoTemplateName
            || normalizedTargetTemplateName === previousLegacyTemplateName;
          const templateName = shouldUseAutoTemplateName ? autoTemplateName : normalizedTargetTemplateName;
          const timeArchiveMeta = normalizeTimeArchiveMeta({
            source: 'time-archive',
            archiveBaseUrl,
            archiveVersion,
            archiveDate: selectedVersionDate,
            regionName,
            width: buildRect.width,
            height: buildRect.height,
          });
          const createdTemplate = await templateManager.createTemplate(
            file,
            templateName,
            [buildRect.tx1, buildRect.ty1, buildRect.px1, buildRect.py1],
            {
              enabled: targetTemplate ? (targetTemplate.enabled || targetTemplate.autoDisabled === true) : true,
              timeArchiveMeta,
            }
          );
          if (isUpdateMode && targetTemplateStorageKey && targetTemplateStorageKey !== createdTemplate?.storageKey) {
            try {
              await templateManager.deleteTemplate(targetTemplateStorageKey);
            } catch (_) {}
          }
          const shouldDownloadAfterCreate = downloadAfterCreate && typeof downloadTemplateImageBlob === 'function';
          let downloadResult = null;
          let downloadError = null;
          if (downloadAfterCreate && !shouldDownloadAfterCreate) {
            downloadError = new Error(tt('dialog.archive.downloadHelperUnavailable', 'Template image download helper is unavailable.'));
          } else if (shouldDownloadAfterCreate) {
            try {
              downloadResult = await downloadTemplateImageBlob(blob, templateName);
            } catch (error) {
              downloadError = error;
              consoleWarn('Failed to download archive template image after creation.', error);
            }
          }
          if (downloadError) {
            activeOverlay?.handleDisplayError(
              tt('dialog.archive.overlay.downloadFailed', 'Template created, but download failed: {error}', {
                error: downloadError?.message || downloadError,
              })
            );
          } else {
            activeOverlay?.handleDisplayStatus(
              shouldDownloadAfterCreate
                ? (
                  isUpdateMode
                    ? tt('dialog.archive.overlay.updatedDownloaded', 'Updated "{name}" and downloaded {file}.', {
                      name: templateName,
                      file: downloadResult?.fileName || tt('dialog.archive.image', 'image'),
                    })
                    : tt('dialog.archive.overlay.createdDownloaded', 'Archive template created from {name} and image downloaded.', {
                      name: templateName,
                    })
                )
                : (
                  isUpdateMode
                    ? tt('dialog.archive.overlay.updated', 'Updated "{name}" to archive {archive}.', {
                      name: templateName,
                      archive: selectedVersionDate || archiveVersion,
                    })
                    : tt('dialog.archive.overlay.created', 'Archive template created from {name}.', {
                      name: templateName,
                    })
                )
            );
          }
          close({
            created: true,
            updated: isUpdateMode,
            storageKey: createdTemplate?.storageKey || '',
            archiveVersion,
            archiveDate: selectedVersionDate,
            downloaded: Boolean(downloadResult),
            downloadFileName: downloadResult?.fileName || '',
          });
        } catch (error) {
          consoleWarn('Failed to create archive template from selected range.', error);
          busy = false;
          setStatus(tt('dialog.archive.status.createFailed', 'Template creation failed: {error}', {
            error: error?.message || error,
          }), true);
        } finally {
          cleanUpCanvas(resultCanvas);
          resultCanvas = null;
          if (!closed) {
            busy = false;
            progress.hidden = true;
            updateActionState();
            schedulePrefetch();
          }
        }
      };

      /* ---- lifecycle -------------------------------------------------------- */

      const close = (result = null) => {
        if (closed) return;
        closed = true;
        cancelAnimationFrame(frameRaf);
        clearTimeout(scrubTimer);
        resetPreviewEntries();
        cleanups.forEach(cleanup => {
          try { cleanup(); } catch (_) {}
        });
        document.removeEventListener('keydown', onKeyDown, true);
        frame.remove();
        panel.remove();
        frameImage.width = 0;
        frameImage.height = 0;
        if (archiveTemplateWindowSession?.panel === panel) {
          archiveTemplateWindowSession = null;
        }
        resolve(result);
      };

      const onKeyDown = (event) => {
        if (event.key !== 'Escape' || busy) return;
        event.preventDefault();
        close(null);
      };

      closeBtn.addEventListener('click', () => {
        if (!busy) close(null);
      });
      prevBtn.addEventListener('click', () => selectVersionIndex(selectedIndex - 1));
      nextBtn.addEventListener('click', () => selectVersionIndex(selectedIndex + 1));
      dateSelect.addEventListener('change', () => selectVersionIndex(dateSelect.value));
      timeline.addEventListener('input', () => selectVersionIndex(timeline.value, { immediate: false }));
      timeline.addEventListener('change', () => selectVersionIndex(timeline.value));
      refreshBtn.addEventListener('click', () => {
        void loadVersions(true);
      });
      createBtn.addEventListener('click', () => {
        void createArchiveTemplate(false);
      });
      downloadBtn.addEventListener('click', () => {
        void createArchiveTemplate(true);
      });

      applyOverlayVarsToFloatingElement(panel);
      applyOverlayVarsToFloatingElement(frame);
      document.body.append(frame, panel);
      // Top centre to start with, then wherever the user drags it.
      const panelWidth = panel.getBoundingClientRect().width;
      panel.style.left = `${Math.max(8, Math.round((window.innerWidth - panelWidth) / 2))}px`;
      panel.style.top = '12px';
      cleanups.push(registerFloatingPanel(panel));
      cleanups.push(makePanelDraggable(header, panel));
      archiveTemplateWindowSession = { panel, close };
      document.addEventListener('keydown', onKeyDown, true);

      setStatus('');
      updateSummary();
      updateActionState();
      trackFrame();
      void loadVersions(false);
    });
  };

  const removeArchiveTemplatePointCaptureHint = () => {
    const hint = document.getElementById(ARCHIVE_TEMPLATE_CAPTURE_HINT_ID);
    if (hint) {
      hint.remove();
    }
  };

  const ensureArchiveTemplatePointCaptureHint = () => {
    let hint = document.getElementById(ARCHIVE_TEMPLATE_CAPTURE_HINT_ID);
    if (hint) return hint;
    hint = document.createElement('div');
    hint.id = ARCHIVE_TEMPLATE_CAPTURE_HINT_ID;
    hint.style.position = 'fixed';
    hint.style.top = '14px';
    hint.style.left = '50%';
    hint.style.transform = 'translateX(-50%)';
    hint.style.zIndex = '10070';
    hint.style.pointerEvents = 'auto';
    hint.style.minWidth = '300px';
    hint.style.maxWidth = 'min(92vw, 520px)';
    hint.style.padding = '10px 12px';
    hint.style.borderRadius = '10px';
    hint.style.border = '1px solid var(--bm-border-strong, rgba(255, 255, 255, 0.26))';
    hint.style.background = 'var(--bm-bg, rgba(18, 18, 18, 0.95))';
    hint.style.color = 'var(--bm-fg, #fff)';
    hint.style.boxShadow = '0 10px 26px rgba(0, 0, 0, 0.4)';
    hint.style.display = 'flex';
    hint.style.flexDirection = 'column';
    hint.style.gap = '6px';
    hint.style.fontSize = '12px';
    hint.style.lineHeight = '1.35';
    applyOverlayVarsToFloatingElement(hint);

    const headingRow = document.createElement('div');
    headingRow.style.display = 'flex';
    headingRow.style.alignItems = 'center';
    headingRow.style.gap = '8px';
    const title = document.createElement('strong');
    title.dataset.role = 'title';
    title.textContent = tt('dialog.archive.capture.title', 'Time-archive capture');
    title.style.fontSize = '12px';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = tt('dialog.common.cancel', 'Cancel');
    closeBtn.style.marginLeft = 'auto';
    closeBtn.style.border = '1px solid var(--bm-border, rgba(255, 255, 255, 0.22))';
    closeBtn.style.borderRadius = '6px';
    closeBtn.style.background = 'var(--bm-btn-bg, rgba(255, 255, 255, 0.12))';
    closeBtn.style.color = 'var(--bm-btn-text, #fff)';
    closeBtn.style.padding = '1px 8px';
    closeBtn.addEventListener('click', () => {
      cancelArchiveTemplatePointCapture(tt('dialog.archive.capture.cancelled', 'Time-archive point capture cancelled.'));
    });
    headingRow.appendChild(title);
    headingRow.appendChild(closeBtn);
    hint.appendChild(headingRow);

    const body = document.createElement('div');
    body.dataset.role = 'body';
    body.style.whiteSpace = 'pre-line';
    body.textContent = tt('dialog.archive.capture.clickTwoPoints', 'Click two points on the map.');
    hint.appendChild(body);

    const tip = document.createElement('div');
    tip.style.fontSize = '11px';
    tip.style.color = 'var(--bm-muted)';
    tip.textContent = tt('dialog.archive.capture.tip', 'Tip: press Esc to cancel capture.');
    hint.appendChild(tip);

    document.body.appendChild(hint);
    return hint;
  };

  const updateArchiveTemplatePointCaptureHint = () => {
    if (!archiveTemplatePointCaptureState.active) {
      removeArchiveTemplatePointCaptureHint();
      return;
    }
    const hint = ensureArchiveTemplatePointCaptureHint();
    applyOverlayVarsToFloatingElement(hint);
    const title = hint.querySelector('[data-role="title"]');
    const body = hint.querySelector('[data-role="body"]');
    const pointCount = archiveTemplatePointCaptureState.points.length;
    if (title) {
      title.textContent = pointCount > 0
        ? tt('dialog.archive.capture.titleStep2', 'Time-archive capture (2/2)')
        : tt('dialog.archive.capture.titleStep1', 'Time-archive capture (1/2)');
    }
    if (body) {
      if (pointCount > 0) {
        const firstText = formatTilePixelCoords(archiveTemplatePointCaptureState.points[0]);
        body.textContent = tt(
          'dialog.archive.capture.firstSaved',
          'First point saved:\n{coords}\nNow click the second point on the map (opposite corner).',
          { coords: firstText }
        );
      } else {
        body.textContent = tt(
          'dialog.archive.capture.firstPrompt',
          'Click the first point on the map.\nUsually start with the top-left corner.'
        );
      }
    }
  };

  const cancelArchiveTemplatePointCapture = (message = '') => {
    const activeOverlay = archiveTemplatePointCaptureState.overlayInstance || overlayMain;
    archiveTemplatePointCaptureState.active = false;
    archiveTemplatePointCaptureState.points = [];
    archiveTemplatePointCaptureState.overlayInstance = null;
    archiveTemplatePointCaptureState.lastCoordsKey = '';
    archiveTemplatePointCaptureState.lastCoordsAt = 0;
    removeArchiveTemplatePointCaptureHint();
    if (message) {
      activeOverlay?.handleDisplayStatus(message);
    }
  };

  /**
   * Starts the two-click capture flow used to define the archive selection rectangle.
   *
   * @param {?object} overlayInstance Overlay used for status messaging.
   */
  const startArchiveTemplatePointCapture = (overlayInstance = null) => {
    const activeOverlay = overlayInstance || overlayMain;
    if (archiveTemplateWindowSession?.close) {
      archiveTemplateWindowSession.close(null);
    }
    archiveTemplatePointCaptureState.active = true;
    archiveTemplatePointCaptureState.points = [];
    archiveTemplatePointCaptureState.overlayInstance = activeOverlay;
    archiveTemplatePointCaptureState.lastCoordsKey = '';
    archiveTemplatePointCaptureState.lastCoordsAt = 0;
    updateArchiveTemplatePointCaptureHint();
    activeOverlay?.handleDisplayStatus(
      tt(
        'dialog.archive.capture.mode',
        'Time-archive template mode: click first point on the map, then click second point.'
      )
    );
  };

  /**
   * Consumes coordinate updates from the main overlay and turns them into archive-capture steps
   * when the capture mode is active.
   *
   * @param {*} rawCoords Raw tile/pixel coordinates emitted by the main overlay.
   */
  const handleArchiveTemplatePointCapture = (rawCoords) => {
    if (!archiveTemplatePointCaptureState.active) return;
    const coords = normalizeTilePixelCoords(rawCoords);
    if (!coords) return;
    const key = coords.join(',');
    const now = Date.now();
    if (
      key === archiveTemplatePointCaptureState.lastCoordsKey &&
      now - archiveTemplatePointCaptureState.lastCoordsAt < 250
    ) {
      return;
    }
    archiveTemplatePointCaptureState.lastCoordsKey = key;
    archiveTemplatePointCaptureState.lastCoordsAt = now;
    const activeOverlay = archiveTemplatePointCaptureState.overlayInstance || overlayMain;
    archiveTemplatePointCaptureState.points.push(coords);
    updateArchiveTemplatePointCaptureHint();
    if (archiveTemplatePointCaptureState.points.length === 1) {
      activeOverlay?.handleDisplayStatus(
        tt('dialog.archive.capture.firstCaptured', 'First point captured: {coords}. Click the second point.', {
          coords: formatTilePixelCoords(coords),
        })
      );
      return;
    }
    const [firstPoint, secondPoint] = archiveTemplatePointCaptureState.points;
    cancelArchiveTemplatePointCapture('');
    activeOverlay?.handleDisplayStatus(
      tt('dialog.archive.capture.secondCaptured', 'Second point captured: {coords}. Opening archive template window...', {
        coords: formatTilePixelCoords(secondPoint),
      })
    );
    void openArchiveTemplateBuilder({ firstPoint, secondPoint, overlayInstance: activeOverlay }).catch((error) => {
      consoleWarn('Failed to open archive template builder window.', error);
      activeOverlay?.handleDisplayError(tt('dialog.archive.capture.openFailed', 'Could not open archive template window.'));
    });
  };

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!archiveTemplatePointCaptureState.active) return;
    event.preventDefault();
    cancelArchiveTemplatePointCapture(tt('dialog.archive.capture.cancelled', 'Time-archive point capture cancelled.'));
  });

  return {
    openArchiveTemplateBuilder,
    startArchiveTemplatePointCapture,
    cancelArchiveTemplatePointCapture,
    handleArchiveTemplatePointCapture,
    isArchiveTemplatePointCaptureActive: () => archiveTemplatePointCaptureState.active,
  };
};

export default createArchiveTemplateUi;
