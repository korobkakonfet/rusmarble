/** @file Time-archive template dialogs and point-capture flow.
 * @since 0.87.39
 */

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
  } = deps;

  const archiveTemplateVersionCache = new Map();
  const ARCHIVE_REGION_PIXEL_BASE_URL = 'https://backend.wplace.live/s0/pixel';
  const ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MIN = 1;
  const ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MAX = 12;
  const archiveTemplatePointCaptureState = {
    active: false,
    points: [],
    overlayInstance: null,
    lastCoordsKey: '',
    lastCoordsAt: 0,
  };
  let archiveTemplateWindowSession = null;
  const ARCHIVE_TEMPLATE_CAPTURE_HINT_ID = 'bm-archive-template-capture-hint';

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
      throw new Error('Archive version list was not found.');
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
      throw new Error('Archive version list is empty.');
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
      throw new Error('Archive version is required.');
    }
    if (!rect || !Number.isFinite(rect.tx1) || !Number.isFinite(rect.ty1) || !Number.isFinite(rect.tx2) || !Number.isFinite(rect.ty2)) {
      throw new Error('Archive selection is invalid.');
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

  /**
   * Opens the archive template builder for a selected rectangular region.
   *
   * @param {object} options Selected points and optional update target.
   * @returns {Promise<object|null>}
   */
  const openArchiveTemplateBuilder = ({ firstPoint, secondPoint, overlayInstance = null, targetTemplate = null } = {}) => {
    const activeOverlay = overlayInstance || overlayMain;
    const rect = buildArchiveTemplateRectFromPoints(firstPoint, secondPoint);
    if (!rect) {
      activeOverlay?.handleDisplayError('Could not read the selected archive range.');
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
    const numberFmt = new Intl.NumberFormat();
    let supportsCreate = false;
    try {
      supportsCreate = testCanvasSize(rect.width, rect.height);
    } catch (_) {
      supportsCreate = false;
    }

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.style.position = 'fixed';
      backdrop.style.left = '0';
      backdrop.style.top = '0';
      backdrop.style.right = '0';
      backdrop.style.bottom = '0';
      backdrop.style.display = 'flex';
      backdrop.style.alignItems = 'center';
      backdrop.style.justifyContent = 'center';
      backdrop.style.padding = '12px';
      backdrop.style.background = 'rgba(0, 0, 0, 0.45)';
      backdrop.style.zIndex = '10055';

      const panel = document.createElement('section');
      panel.style.width = 'min(760px, calc(100vw - 24px))';
      panel.style.maxHeight = 'calc(100vh - 24px)';
      panel.style.overflow = 'auto';
      panel.style.background = 'var(--bm-bg, rgba(20, 20, 20, 0.95))';
      panel.style.color = 'var(--bm-fg, #fff)';
      panel.style.border = '1px solid var(--bm-border-strong, rgba(255, 255, 255, 0.25))';
      panel.style.borderRadius = '10px';
      panel.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.35)';
      panel.style.padding = '12px';
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.gap = '10px';
      panel.style.pointerEvents = 'auto';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Time archive template builder');
      applyOverlayVarsToFloatingElement(panel);

      const headingRow = document.createElement('div');
      headingRow.style.display = 'flex';
      headingRow.style.alignItems = 'center';
      headingRow.style.gap = '8px';
      const title = document.createElement('strong');
      title.style.fontSize = '13px';
      title.textContent = isUpdateMode ? 'Time-Archive Template Update' : 'Time-Archive Template';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '✖';
      closeBtn.style.marginLeft = 'auto';
      headingRow.appendChild(title);
      headingRow.appendChild(closeBtn);
      panel.appendChild(headingRow);

      const rangeInfo = document.createElement('div');
      rangeInfo.style.whiteSpace = 'pre-line';
      rangeInfo.style.fontSize = '12px';
      rangeInfo.style.lineHeight = '1.35';
      const [brTx, brTy, brPx, brPy] = rect.displayBottomRight;
      rangeInfo.textContent = [
        `Top Left: Tl X ${rect.tx1}, Tl Y ${rect.ty1}, Px X ${rect.px1}, Px Y ${rect.py1}`,
        `Bottom Right: Tl X ${brTx}, Tl Y ${brTy}, Px X ${brPx}, Px Y ${brPy}`,
        `Size: ${numberFmt.format(rect.width)} x ${numberFmt.format(rect.height)} px`,
        `Tiles: ${numberFmt.format(rect.tileCount)} (${numberFmt.format(rect.tileWidth)} x ${numberFmt.format(rect.tileHeight)})`,
        `Provider: ${archiveBaseUrl}`,
      ].join('\n');
      panel.appendChild(rangeInfo);

      const controls = document.createElement('div');
      controls.style.display = 'grid';
      controls.style.gridTemplateColumns = 'auto minmax(220px, 1fr) auto auto';
      controls.style.gap = '8px';
      controls.style.alignItems = 'center';
      const versionLabel = document.createElement('label');
      versionLabel.textContent = 'Date';
      const versionRange = document.createElement('input');
      versionRange.type = 'range';
      versionRange.min = '0';
      versionRange.max = '0';
      versionRange.step = '1';
      versionRange.value = '0';
      versionRange.style.width = '100%';
      versionRange.style.margin = '0';
      versionRange.disabled = true;
      const versionValue = document.createElement('span');
      versionValue.style.fontSize = '12px';
      versionValue.style.fontVariantNumeric = 'tabular-nums';
      versionValue.style.whiteSpace = 'nowrap';
      versionValue.textContent = 'Loading...';
      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.textContent = 'Refresh';
      controls.appendChild(versionLabel);
      controls.appendChild(versionRange);
      controls.appendChild(versionValue);
      controls.appendChild(refreshBtn);
      panel.appendChild(controls);

      const versionMeta = document.createElement('div');
      versionMeta.style.fontSize = '11px';
      versionMeta.style.color = 'var(--bm-muted)';
      panel.appendChild(versionMeta);

      const statusOutput = document.createElement('div');
      statusOutput.style.fontSize = '11px';
      statusOutput.style.color = 'var(--bm-muted)';
      panel.appendChild(statusOutput);

      const previewWrap = document.createElement('div');
      previewWrap.style.position = 'relative';
      previewWrap.style.display = 'flex';
      previewWrap.style.justifyContent = 'center';
      previewWrap.style.alignItems = 'center';
      previewWrap.style.width = '100%';
      previewWrap.style.height = '320px';
      previewWrap.style.minHeight = '170px';
      previewWrap.style.overflow = 'hidden';
      previewWrap.style.border = '1px solid var(--bm-border-strong, rgba(255, 255, 255, 0.25))';
      previewWrap.style.borderRadius = '8px';
      previewWrap.style.background = 'var(--bm-subtle-bg, rgba(255, 255, 255, 0.04))';
      const previewCanvas = document.createElement('canvas');
      previewCanvas.style.display = 'block';
      previewCanvas.style.width = '100%';
      previewCanvas.style.height = '100%';
      previewCanvas.style.background = 'rgba(0, 0, 0, 0.2)';
      previewWrap.appendChild(previewCanvas);
      panel.appendChild(previewWrap);

      const previewControls = document.createElement('div');
      previewControls.style.display = 'flex';
      previewControls.style.alignItems = 'center';
      previewControls.style.justifyContent = 'space-between';
      previewControls.style.flexWrap = 'wrap';
      previewControls.style.gap = '8px';
      const previewHint = document.createElement('div');
      previewHint.style.fontSize = '11px';
      previewHint.style.color = 'var(--bm-muted)';
      previewHint.textContent = 'Wheel to zoom. Drag to pan.';
      const previewZoomControls = document.createElement('div');
      previewZoomControls.style.display = 'inline-flex';
      previewZoomControls.style.alignItems = 'center';
      previewZoomControls.style.gap = '6px';
      const zoomOutBtn = document.createElement('button');
      zoomOutBtn.type = 'button';
      zoomOutBtn.textContent = '-';
      zoomOutBtn.title = 'Zoom out';
      const zoomValue = document.createElement('span');
      zoomValue.style.minWidth = '52px';
      zoomValue.style.fontSize = '11px';
      zoomValue.style.textAlign = 'center';
      zoomValue.style.fontVariantNumeric = 'tabular-nums';
      zoomValue.textContent = '100%';
      const zoomResetBtn = document.createElement('button');
      zoomResetBtn.type = 'button';
      zoomResetBtn.textContent = 'Reset';
      zoomResetBtn.title = 'Reset zoom and pan';
      const zoomInBtn = document.createElement('button');
      zoomInBtn.type = 'button';
      zoomInBtn.textContent = '+';
      zoomInBtn.title = 'Zoom in';
      previewZoomControls.appendChild(zoomOutBtn);
      previewZoomControls.appendChild(zoomValue);
      previewZoomControls.appendChild(zoomResetBtn);
      previewZoomControls.appendChild(zoomInBtn);
      previewControls.appendChild(previewHint);
      previewControls.appendChild(previewZoomControls);
      panel.appendChild(previewControls);

      const progress = document.createElement('progress');
      progress.max = 1;
      progress.value = 0;
      progress.hidden = true;
      panel.appendChild(progress);

      const progressText = document.createElement('div');
      progressText.style.fontSize = '11px';
      progressText.style.color = 'var(--bm-muted)';
      progressText.hidden = true;
      panel.appendChild(progressText);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.justifyContent = 'flex-end';
      actions.style.gap = '8px';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.textContent = isUpdateMode ? 'Update Template' : 'Create Template';
      actions.appendChild(cancelBtn);
      actions.appendChild(createBtn);
      panel.appendChild(actions);
      backdrop.appendChild(panel);

      let closed = false;
      let busy = false;
      let loadingVersions = false;
      let previewResizeObserver = null;
      let previewRedrawQueued = false;
      let previewDragState = null;
      let previewDragMoveHandler = null;
      let previewDragUpHandler = null;
      let archiveVersions = [];
      let selectedVersionValue = String(targetTemplateMeta?.archiveVersion || '').trim();
      let selectedVersionDate = '';
      let selectedVersionLabel = '';
      let previewZoomLevel = ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MIN;
      let previewPanX = 0;
      let previewPanY = 0;
      let previewHasImage = false;
      let previewPlaceholderMessage = 'Loading preview...';
      let previewPrefetchGeneration = 0;
      let previewPrefetchSuspended = false;
      let previewPrefetchWaiters = [];
      const previewImageCanvas = document.createElement('canvas');
      const previewEntries = new Map();
      const previewTileCoords = [];
      const previewSupported = rect.tileCount <= TEMPLATE_ARCHIVE_PREVIEW_MAX_TILE_REQUESTS;
      const previewPrefetchConcurrency = Math.max(
        1,
        Math.min(16, Math.trunc(Number(TEMPLATE_ARCHIVE_PREVIEW_DOWNLOAD_CONCURRENCY) || 10))
      );
      for (let ty = rect.ty1; ty <= rect.ty2; ty++) {
        for (let tx = rect.tx1; tx <= rect.tx2; tx++) {
          previewTileCoords.push({ tx, ty });
        }
      }
      const previewDimensions = (() => {
        const scale = Math.min(1, TEMPLATE_ARCHIVE_PREVIEW_MAX_DIMENSION / Math.max(rect.width, rect.height));
        return {
          scale,
          width: Math.max(1, Math.round(rect.width * scale)),
          height: Math.max(1, Math.round(rect.height * scale)),
        };
      })();

      const setStatus = (message, isError = false) => {
        statusOutput.textContent = message;
        statusOutput.style.color = isError ? 'var(--bm-danger)' : 'var(--bm-muted)';
      };
      const setProgress = (done = 0, total = 0, label = '') => {
        const safeTotal = Math.max(1, Number(total) || 1);
        const safeDone = Math.max(0, Math.min(safeTotal, Number(done) || 0));
        progress.max = safeTotal;
        progress.value = safeDone;
        progress.hidden = false;
        progressText.hidden = false;
        progressText.textContent = `${label}${safeDone} / ${safeTotal}`;
      };
      const clearProgress = () => {
        progress.hidden = true;
        progressText.hidden = true;
        progress.max = 1;
        progress.value = 0;
        progressText.textContent = '';
      };
      const canOverwriteStatusWithPreview = () => {
        const currentStatus = String(statusOutput.textContent || '').trim();
        if (!currentStatus) return true;
        return /^Loading archive versions|^Loaded \d+ archive versions|^Loading preview|^Preview ready|^Preview failed|^Preview skipped/.test(currentStatus);
      };
      const setPreviewStatus = (message, isError = false, force = false) => {
        if (!force && (busy || !canOverwriteStatusWithPreview())) return;
        setStatus(message, isError);
      };
      const clampPreviewZoom = (value) => clampNumber(
        value,
        ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MIN,
        ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MAX,
        ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MIN
      );
      const getPreviewViewportSize = () => ({
        width: Math.max(1, Math.floor(previewWrap.clientWidth || 320)),
        height: Math.max(1, Math.floor(previewWrap.clientHeight || 180)),
      });
      const resizePreviewCanvas = () => {
        const { width, height } = getPreviewViewportSize();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const targetWidth = Math.max(1, Math.floor(width * dpr));
        const targetHeight = Math.max(1, Math.floor(height * dpr));
        if (previewCanvas.width !== targetWidth || previewCanvas.height !== targetHeight) {
          previewCanvas.width = targetWidth;
          previewCanvas.height = targetHeight;
        }
        previewCanvas.style.width = `${width}px`;
        previewCanvas.style.height = `${height}px`;
        const context = previewCanvas.getContext('2d');
        if (context) {
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          context.clearRect(0, 0, width, height);
        }
        return { width, height, context };
      };
      const computePreviewLayout = (
        width,
        height,
        zoomLevel = previewZoomLevel,
        panX = previewPanX,
        panY = previewPanY
      ) => {
        const imageWidth = Math.max(1, Math.trunc(Number(previewImageCanvas.width) || 0));
        const imageHeight = Math.max(1, Math.trunc(Number(previewImageCanvas.height) || 0));
        if (!previewHasImage || imageWidth <= 0 || imageHeight <= 0) return null;
        const fitScale = Math.min(1, width / imageWidth, height / imageHeight);
        const safeFitScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
        const scale = safeFitScale * clampPreviewZoom(zoomLevel);
        const drawWidth = imageWidth * scale;
        const drawHeight = imageHeight * scale;
        const maxPanX = Math.max(0, (drawWidth - width) / 2);
        const maxPanY = Math.max(0, (drawHeight - height) / 2);
        const clampedPanX = clampNumber(panX, -maxPanX, maxPanX, 0);
        const clampedPanY = clampNumber(panY, -maxPanY, maxPanY, 0);
        const baseX = (width - drawWidth) / 2;
        const baseY = (height - drawHeight) / 2;
        return {
          width,
          height,
          scale,
          drawWidth,
          drawHeight,
          baseX,
          baseY,
          drawX: baseX + clampedPanX,
          drawY: baseY + clampedPanY,
          panX: clampedPanX,
          panY: clampedPanY,
          maxPanX,
          maxPanY,
        };
      };
      const syncPreviewControls = (layout = null) => {
        const hasPreview = previewHasImage && previewImageCanvas.width > 0 && previewImageCanvas.height > 0;
        const safeZoom = clampPreviewZoom(previewZoomLevel);
        const renderLayout = layout || (() => {
          const { width, height } = getPreviewViewportSize();
          return computePreviewLayout(width, height);
        })();
        const canPan = Boolean(renderLayout && (renderLayout.maxPanX > 0.5 || renderLayout.maxPanY > 0.5));
        const isReset = Math.abs(safeZoom - ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MIN) < 0.001
          && Math.abs(previewPanX) < 0.5
          && Math.abs(previewPanY) < 0.5;
        previewZoomLevel = safeZoom;
        zoomValue.textContent = `${Math.round(safeZoom * 100)}%`;
        zoomOutBtn.disabled = !hasPreview || safeZoom <= ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MIN + 0.001;
        zoomInBtn.disabled = !hasPreview || safeZoom >= ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MAX - 0.001;
        zoomResetBtn.disabled = !hasPreview || isReset;
        previewWrap.style.cursor = hasPreview
          ? (previewDragState ? 'grabbing' : canPan ? 'grab' : 'zoom-in')
          : 'default';
      };
      const drawPreviewViewport = () => {
        const { width, height, context } = resizePreviewCanvas();
        if (!context) return;
        context.fillStyle = 'rgba(0, 0, 0, 0.35)';
        context.fillRect(0, 0, width, height);
        const layout = computePreviewLayout(width, height);
        if (!layout) {
          context.fillStyle = 'rgba(255, 255, 255, 0.78)';
          context.font = '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(previewPlaceholderMessage, width / 2, height / 2);
          syncPreviewControls(null);
          return;
        }
        previewPanX = layout.panX;
        previewPanY = layout.panY;
        context.imageSmoothingEnabled = false;
        context.drawImage(previewImageCanvas, layout.drawX, layout.drawY, layout.drawWidth, layout.drawHeight);
        syncPreviewControls(layout);
      };
      const queuePreviewViewportDraw = () => {
        if (previewRedrawQueued || closed) return;
        previewRedrawQueued = true;
        requestAnimationFrame(() => {
          previewRedrawQueued = false;
          if (closed) return;
          drawPreviewViewport();
        });
      };
      const drawPreviewPlaceholder = (message = 'Preview unavailable') => {
        previewHasImage = false;
        previewPlaceholderMessage = String(message || 'Preview unavailable');
        previewImageCanvas.width = 0;
        previewImageCanvas.height = 0;
        queuePreviewViewportDraw();
      };
      const resetPreviewView = () => {
        previewZoomLevel = ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MIN;
        previewPanX = 0;
        previewPanY = 0;
        queuePreviewViewportDraw();
      };
      const setPreviewZoom = (nextZoomLevel, originX = null, originY = null) => {
        const safeZoom = clampPreviewZoom(nextZoomLevel);
        if (!previewHasImage) {
          previewZoomLevel = safeZoom;
          syncPreviewControls(null);
          return;
        }
        const { width, height } = getPreviewViewportSize();
        const currentLayout = computePreviewLayout(width, height);
        let nextPanX = previewPanX;
        let nextPanY = previewPanY;
        if (
          currentLayout
          && Number.isFinite(originX)
          && Number.isFinite(originY)
          && currentLayout.scale > 0
        ) {
          const sourceX = (originX - currentLayout.drawX) / currentLayout.scale;
          const sourceY = (originY - currentLayout.drawY) / currentLayout.scale;
          const nextLayout = computePreviewLayout(width, height, safeZoom, 0, 0);
          if (nextLayout) {
            nextPanX = originX - nextLayout.baseX - sourceX * nextLayout.scale;
            nextPanY = originY - nextLayout.baseY - sourceY * nextLayout.scale;
          }
        } else if (safeZoom <= ARCHIVE_TEMPLATE_PREVIEW_ZOOM_MIN + 0.001) {
          nextPanX = 0;
          nextPanY = 0;
        }
        previewZoomLevel = safeZoom;
        const clampedLayout = computePreviewLayout(width, height, previewZoomLevel, nextPanX, nextPanY);
        previewPanX = clampedLayout?.panX || 0;
        previewPanY = clampedLayout?.panY || 0;
        queuePreviewViewportDraw();
      };
      const cleanupPreviewDragHandlers = () => {
        if (previewDragMoveHandler) {
          window.removeEventListener('mousemove', previewDragMoveHandler);
          previewDragMoveHandler = null;
        }
        if (previewDragUpHandler) {
          window.removeEventListener('mouseup', previewDragUpHandler);
          previewDragUpHandler = null;
        }
        previewDragState = null;
        syncPreviewControls();
      };
      const getSelectedVersionEntry = () => {
        if (!archiveVersions.length) return null;
        const index = Math.max(
          0,
          Math.min(archiveVersions.length - 1, Math.trunc(Number(versionRange.value) || 0))
        );
        return archiveVersions[index] || null;
      };
      const getPreviewStats = () => {
        let ready = 0;
        let failed = 0;
        for (const entry of previewEntries.values()) {
          if (entry.status === 'ready') {
            ready++;
          } else if (entry.status === 'error') {
            failed++;
          }
        }
        return {
          ready,
          failed,
          total: archiveVersions.length,
        };
      };
      const syncVersionMetaText = () => {
        const parts = [];
        if (selectedVersionValue) {
          parts.push(`Version: ${selectedVersionValue}`);
        }
        if (previewSupported && archiveVersions.length) {
          const stats = getPreviewStats();
          parts.push(`Prefetched: ${stats.ready}/${stats.total}`);
          if (stats.failed > 0) {
            parts.push(`Errors: ${stats.failed}`);
          }
        }
        versionMeta.textContent = parts.join(' | ');
      };
      const syncSelectedVersionFromTimeline = () => {
        const selected = getSelectedVersionEntry();
        if (!selected) {
          selectedVersionValue = '';
          selectedVersionDate = '';
          selectedVersionLabel = '';
          versionValue.textContent = 'No date';
          syncVersionMetaText();
          return null;
        }
        selectedVersionValue = String(selected.version || '').trim();
        selectedVersionDate = String(selected.date || '').trim();
        selectedVersionLabel = `${selectedVersionDate || selectedVersionValue} (${selectedVersionValue})`;
        versionValue.textContent = selectedVersionDate || selectedVersionValue;
        syncVersionMetaText();
        return selected;
      };
      const populateVersionTimeline = (versions, preferredVersion = '') => {
        archiveVersions = Array.isArray(versions) ? versions.slice() : [];
        if (!archiveVersions.length) {
          versionRange.min = '0';
          versionRange.max = '0';
          versionRange.step = '1';
          versionRange.value = '0';
          versionRange.disabled = true;
          syncSelectedVersionFromTimeline();
          return;
        }
        versionRange.min = '0';
        versionRange.max = String(archiveVersions.length - 1);
        versionRange.step = '1';
        versionRange.disabled = false;
        let selectedIndex = archiveVersions.length - 1;
        const preferred = String(preferredVersion || selectedVersionValue || '').trim();
        if (preferred) {
          const found = archiveVersions.findIndex((entry) => String(entry?.version || '').trim() === preferred);
          if (found >= 0) {
            selectedIndex = found;
          }
        }
        versionRange.value = String(selectedIndex);
        syncSelectedVersionFromTimeline();
      };
      const wakePreviewWorkers = () => {
        if (!previewPrefetchWaiters.length) return;
        const waiters = previewPrefetchWaiters;
        previewPrefetchWaiters = [];
        waiters.forEach((resolve) => resolve());
      };
      const waitForPreviewWork = () => new Promise((resolve) => {
        previewPrefetchWaiters.push(resolve);
      });
      const releasePreviewEntry = (entry) => {
        if (!entry?.canvas) return;
        cleanUpCanvas(entry.canvas);
        entry.canvas = null;
        entry.context = null;
      };
      const resetPreviewEntries = () => {
        previewPrefetchGeneration++;
        const staleEntries = Array.from(previewEntries.values());
        previewEntries.clear();
        staleEntries.forEach((entry) => releasePreviewEntry(entry));
        wakePreviewWorkers();
        syncVersionMetaText();
      };
      const createPreviewEntry = (versionEntry) => {
        const version = String(versionEntry?.version || '').trim();
        const date = String(versionEntry?.date || '').trim();
        let canvas = null;
        let context = null;
        let error = null;
        try {
          canvas = new OffscreenCanvas(previewDimensions.width, previewDimensions.height);
          context = canvas.getContext('2d');
          if (!context) {
            throw new Error('Could not initialize preview canvas.');
          }
          context.imageSmoothingEnabled = false;
          context.clearRect(0, 0, previewDimensions.width, previewDimensions.height);
        } catch (creationError) {
          error = creationError;
          if (canvas) {
            cleanUpCanvas(canvas);
            canvas = null;
          }
          context = null;
        }
        return {
          version,
          date,
          canvas,
          context,
          width: previewDimensions.width,
          height: previewDimensions.height,
          scale: previewDimensions.scale,
          totalTiles: previewTileCoords.length,
          completedTiles: 0,
          nextTaskIndex: 0,
          activeTasks: 0,
          status: error ? 'error' : 'idle',
          error,
        };
      };
      const buildPreviewPriorityOrder = () => {
        if (!archiveVersions.length) return [];
        let selectedIndex = archiveVersions.length - 1;
        if (selectedVersionValue) {
          const matchIndex = archiveVersions.findIndex((entry) => String(entry?.version || '').trim() === selectedVersionValue);
          if (matchIndex >= 0) {
            selectedIndex = matchIndex;
          }
        }
        const orderedVersions = [];
        for (let distance = 0; distance < archiveVersions.length; distance++) {
          const leftIndex = selectedIndex - distance;
          const rightIndex = selectedIndex + distance;
          if (leftIndex >= 0) {
            const leftVersion = String(archiveVersions[leftIndex]?.version || '').trim();
            if (leftVersion) {
              orderedVersions.push(leftVersion);
            }
          }
          if (distance > 0 && rightIndex < archiveVersions.length) {
            const rightVersion = String(archiveVersions[rightIndex]?.version || '').trim();
            if (rightVersion) {
              orderedVersions.push(rightVersion);
            }
          }
        }
        return orderedVersions;
      };
      const getActivePreviewVersionEntries = () => {
        const entries = [];
        for (const version of buildPreviewPriorityOrder()) {
          const entry = previewEntries.get(version);
          if (!entry || entry.status === 'error' || entry.nextTaskIndex >= entry.totalTiles) {
            continue;
          }
          entries.push(entry);
          if (entries.length >= previewPrefetchConcurrency) {
            break;
          }
        }
        return entries;
      };
      const copyPreviewEntryToCanvas = (entry) => {
        if (!entry?.canvas || !entry?.context || entry.completedTiles <= 0) {
          return false;
        }
        previewImageCanvas.width = entry.width;
        previewImageCanvas.height = entry.height;
        const context = previewImageCanvas.getContext('2d');
        if (!context) {
          drawPreviewPlaceholder('Preview unavailable');
          return false;
        }
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, entry.width, entry.height);
        context.drawImage(entry.canvas, 0, 0);
        previewHasImage = true;
        previewPlaceholderMessage = 'Loading preview...';
        queuePreviewViewportDraw();
        return true;
      };
      const updateSelectedPreviewFromCache = (forceStatus = false) => {
        syncVersionMetaText();
        if (!selectedVersionValue) {
          drawPreviewPlaceholder('No archive date available');
          updateActionState();
          return;
        }
        if (!previewSupported) {
          drawPreviewPlaceholder('Preview skipped for large range');
          setPreviewStatus(
            `Preview skipped (${numberFmt.format(rect.tileCount)} tiles > ${numberFmt.format(TEMPLATE_ARCHIVE_PREVIEW_MAX_TILE_REQUESTS)} limit). You can still create the template.`,
            false,
            forceStatus
          );
          updateActionState();
          return;
        }
        const entry = previewEntries.get(selectedVersionValue) || null;
        if (!entry) {
          drawPreviewPlaceholder('Loading preview...');
          setPreviewStatus(`Loading preview for ${selectedVersionLabel || selectedVersionValue}...`, false, forceStatus);
          updateActionState();
          return;
        }
        if (entry.status === 'error') {
          drawPreviewPlaceholder('Preview failed');
          setPreviewStatus(
            `Preview failed for ${selectedVersionLabel || selectedVersionValue}: ${entry.error?.message || entry.error}`,
            true,
            forceStatus
          );
          updateActionState();
          return;
        }
        if (!copyPreviewEntryToCanvas(entry)) {
          drawPreviewPlaceholder('Loading preview...');
        }
        if (entry.status === 'ready') {
          setPreviewStatus(
            `Preview ready: ${numberFmt.format(entry.width)} x ${numberFmt.format(entry.height)} px`,
            false,
            forceStatus
          );
        } else {
          setPreviewStatus(
            `Loading preview for ${selectedVersionLabel || selectedVersionValue}... ${numberFmt.format(entry.completedTiles)} / ${numberFmt.format(entry.totalTiles)} tiles`,
            false,
            forceStatus
          );
        }
        updateActionState();
      };
      const drawPreviewTileIntoEntry = (entry, tx, ty, image) => {
        if (!entry?.context) return;
        const tileLeft = tx * TEMPLATE_TILE_SIZE;
        const tileTop = ty * TEMPLATE_TILE_SIZE;
        const intersectLeft = Math.max(rect.left, tileLeft);
        const intersectTop = Math.max(rect.top, tileTop);
        const intersectRight = Math.min(rect.left + rect.width, tileLeft + TEMPLATE_TILE_SIZE);
        const intersectBottom = Math.min(rect.top + rect.height, tileTop + TEMPLATE_TILE_SIZE);
        const intersectWidth = intersectRight - intersectLeft;
        const intersectHeight = intersectBottom - intersectTop;
        if (intersectWidth <= 0 || intersectHeight <= 0) return;
        const srcX = intersectLeft - tileLeft;
        const srcY = intersectTop - tileTop;
        const dstX = (intersectLeft - rect.left) * entry.scale;
        const dstY = (intersectTop - rect.top) * entry.scale;
        const dstWidth = intersectWidth * entry.scale;
        const dstHeight = intersectHeight * entry.scale;
        entry.context.drawImage(
          image,
          srcX,
          srcY,
          intersectWidth,
          intersectHeight,
          dstX,
          dstY,
          dstWidth,
          dstHeight
        );
      };
      const pickNextPreviewTask = () => {
        if (closed || previewPrefetchSuspended || !previewSupported) return null;
        const activeEntries = getActivePreviewVersionEntries();
        for (const entry of activeEntries) {
          if (entry.activeTasks > 0 || entry.nextTaskIndex >= entry.totalTiles) {
            continue;
          }
          const task = previewTileCoords[entry.nextTaskIndex];
          if (!task) {
            entry.nextTaskIndex = entry.totalTiles;
            continue;
          }
          entry.nextTaskIndex++;
          entry.activeTasks = 1;
          if (entry.status === 'idle') {
            entry.status = 'loading';
          }
          return { entry, task };
        }
        return null;
      };
      const runPreviewWorker = async (generation) => {
        while (!closed && generation === previewPrefetchGeneration) {
          const nextTask = pickNextPreviewTask();
          if (!nextTask) {
            await waitForPreviewWork();
            continue;
          }
          const { entry, task } = nextTask;
          try {
            const image = await downloadTile(task.tx % 2048, task.ty, {
              source: 'archive',
              archiveBaseUrl,
              archiveVersion: entry.version,
            });
            if (closed || generation !== previewPrefetchGeneration) return;
            drawPreviewTileIntoEntry(entry, task.tx, task.ty, image);
            entry.completedTiles++;
            entry.activeTasks = Math.max(0, entry.activeTasks - 1);
            if (entry.completedTiles >= entry.totalTiles) {
              entry.status = 'ready';
            }
          } catch (error) {
            if (closed || generation !== previewPrefetchGeneration) return;
            entry.activeTasks = Math.max(0, entry.activeTasks - 1);
            entry.status = 'error';
            entry.error = error;
            entry.nextTaskIndex = entry.totalTiles;
          } finally {
            if (closed || generation !== previewPrefetchGeneration) return;
            if (!busy && entry.version === selectedVersionValue) {
              updateSelectedPreviewFromCache(false);
            } else {
              syncVersionMetaText();
            }
            wakePreviewWorkers();
          }
        }
      };
      const startPreviewPrefetch = () => {
        resetPreviewEntries();
        if (!previewSupported || !archiveVersions.length || !previewTileCoords.length) {
          updateSelectedPreviewFromCache(true);
          return;
        }
        archiveVersions.forEach((versionEntry) => {
          const entry = createPreviewEntry(versionEntry);
          previewEntries.set(entry.version, entry);
        });
        syncVersionMetaText();
        const generation = previewPrefetchGeneration;
        const workerCount = Math.max(1, Math.min(previewPrefetchConcurrency, archiveVersions.length));
        for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
          void runPreviewWorker(generation);
        }
        updateSelectedPreviewFromCache(true);
        wakePreviewWorkers();
      };
      const handleSelectedVersionChange = (forceStatus = false) => {
        syncSelectedVersionFromTimeline();
        updateSelectedPreviewFromCache(forceStatus);
        wakePreviewWorkers();
      };
      const updateActionState = () => {
        const hasVersion = Boolean(getSelectedVersionEntry()?.version);
        closeBtn.disabled = busy;
        cancelBtn.disabled = busy;
        versionRange.disabled = busy || loadingVersions || !archiveVersions.length;
        refreshBtn.disabled = busy || loadingVersions;
        createBtn.disabled = busy || !hasVersion || !supportsCreate;
      };
      const close = (result = null) => {
        if (closed) return;
        closed = true;
        resetPreviewEntries();
        cleanupPreviewDragHandlers();
        if (previewResizeObserver) {
          previewResizeObserver.disconnect();
          previewResizeObserver = null;
        }
        window.removeEventListener('resize', queuePreviewViewportDraw);
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
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

      const loadVersions = async (force = false) => {
        loadingVersions = true;
        updateActionState();
        setStatus('Loading archive versions...');
        try {
          const versions = await fetchArchiveTemplateVersions(archiveBaseUrl, force);
          const preferred = String(selectedVersionValue || '').trim();
          populateVersionTimeline(versions, preferred);
          setStatus(`Loaded ${numberFmt.format(versions.length)} archive versions.`);
          startPreviewPrefetch();
        } catch (error) {
          resetPreviewEntries();
          archiveVersions = [];
          selectedVersionValue = '';
          selectedVersionDate = '';
          selectedVersionLabel = '';
          versionRange.min = '0';
          versionRange.max = '0';
          versionRange.step = '1';
          versionRange.value = '0';
          versionRange.disabled = true;
          versionValue.textContent = 'Unavailable';
          syncVersionMetaText();
          drawPreviewPlaceholder('No versions loaded');
          setStatus(`Failed to load archive versions: ${error?.message || error}`, true);
        } finally {
          loadingVersions = false;
          updateActionState();
        }
      };

      const createArchiveTemplate = async () => {
        const selectedEntry = syncSelectedVersionFromTimeline();
        const archiveVersion = String(selectedEntry?.version || '').trim();
        if (!archiveVersion) {
          setStatus('Select an archive date first.', true);
          return;
        }
        if (!supportsCreate) {
          setStatus('Selection is too large for this browser to build a template image.', true);
          return;
        }
        previewPrefetchSuspended = true;
        wakePreviewWorkers();
        busy = true;
        updateActionState();
        setStatus(`Building archive snapshot (${numberFmt.format(rect.tileCount)} tiles)...`);
        setProgress(0, rect.tileCount, 'Create: ');
        const centerCoords = getArchiveRectCenterCoords(rect);
        const regionNamePromise = fetchArchiveRegionName(centerCoords).catch((error) => {
          consoleWarn('Failed to resolve archive region name for template.', error);
          return '';
        });
        let resultCanvas = new OffscreenCanvas(rect.width, rect.height);
        try {
          const context = resultCanvas.getContext('2d');
          if (!context) {
            throw new Error('Failed to initialize template canvas.');
          }
          context.imageSmoothingEnabled = false;
          context.clearRect(0, 0, rect.width, rect.height);
          await iterateArchiveTemplateTiles(rect, {
            archiveVersion,
            archiveBaseUrl,
            onProgress: (done, total) => setProgress(done, total, 'Create: '),
            onTile: ({ image, tx, ty }) => {
              context.drawImage(
                image,
                tx * TEMPLATE_TILE_SIZE - rect.left,
                ty * TEMPLATE_TILE_SIZE - rect.top
              );
            },
          });
          const blob = await resultCanvas.convertToBlob({ type: 'image/png' });
          const archiveNameDate = formatArchiveNameDate(selectedVersionDate, archiveVersion);
          const sourceTag = (archiveNameDate || archiveVersion).replace(/[^a-z0-9._-]+/gi, '_');
          const fileName = `archive_${sourceTag}_${rect.tx1}_${rect.ty1}_${rect.px1}_${rect.py1}.png`;
          const file = new File([blob], fileName, { type: 'image/png' });
          const regionName = await regionNamePromise;
          const autoTemplateName = buildArchiveTemplateName({
            regionName,
            centerCoords,
          });
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
            width: rect.width,
            height: rect.height,
          });
          const createdTemplate = await templateManager.createTemplate(
            file,
            templateName,
            [rect.tx1, rect.ty1, rect.px1, rect.py1],
            'lt',
            {
              enabled: targetTemplate?.enabled ?? true,
              timeArchiveMeta,
            }
          );
          if (isUpdateMode && targetTemplateStorageKey && targetTemplateStorageKey !== createdTemplate?.storageKey) {
            try {
              await templateManager.deleteTemplate(targetTemplateStorageKey);
            } catch (_) {}
          }
          activeOverlay?.handleDisplayStatus(
            isUpdateMode
              ? `Updated "${templateName}" to archive ${selectedVersionDate || archiveVersion}.`
              : `Archive template created from ${templateName}.`
          );
          close({
            created: true,
            updated: isUpdateMode,
            storageKey: createdTemplate?.storageKey || '',
            archiveVersion,
            archiveDate: selectedVersionDate,
          });
        } catch (error) {
          consoleWarn('Failed to create archive template from selected range.', error);
          setStatus(`Template creation failed: ${error?.message || error}`, true);
        } finally {
          cleanUpCanvas(resultCanvas);
          resultCanvas = null;
          if (!closed) {
            clearProgress();
            previewPrefetchSuspended = false;
            busy = false;
            updateActionState();
            syncVersionMetaText();
            wakePreviewWorkers();
          }
        }
      };

      closeBtn.addEventListener('click', () => {
        if (!busy) close(null);
      });
      cancelBtn.addEventListener('click', () => {
        if (!busy) close(null);
      });
      refreshBtn.addEventListener('click', () => {
        void loadVersions(true);
      });
      zoomOutBtn.addEventListener('click', () => {
        setPreviewZoom(previewZoomLevel / 1.2);
      });
      zoomInBtn.addEventListener('click', () => {
        setPreviewZoom(previewZoomLevel * 1.2);
      });
      zoomResetBtn.addEventListener('click', () => {
        resetPreviewView();
      });
      versionRange.addEventListener('input', () => {
        handleSelectedVersionChange(true);
      });
      versionRange.addEventListener('change', () => {
        handleSelectedVersionChange(true);
      });
      createBtn.addEventListener('click', () => {
        void createArchiveTemplate();
      });
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop && !busy) {
          close(null);
        }
      });
      previewWrap.addEventListener('wheel', (event) => {
        if (!previewHasImage) return;
        event.preventDefault();
        const factor = event.shiftKey ? 1.35 : 1.15;
        const nextZoom = event.deltaY < 0
          ? previewZoomLevel * factor
          : previewZoomLevel / factor;
        const bounds = previewWrap.getBoundingClientRect();
        setPreviewZoom(nextZoom, event.clientX - bounds.left, event.clientY - bounds.top);
      }, { passive: false });
      previewWrap.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || !previewHasImage) return;
        const { width, height } = getPreviewViewportSize();
        const layout = computePreviewLayout(width, height);
        if (!layout || (layout.maxPanX <= 0.5 && layout.maxPanY <= 0.5)) return;
        event.preventDefault();
        previewDragState = {
          startX: event.clientX,
          startY: event.clientY,
          panX: previewPanX,
          panY: previewPanY,
        };
        previewDragMoveHandler = (moveEvent) => {
          if (!previewDragState) return;
          previewPanX = previewDragState.panX + (moveEvent.clientX - previewDragState.startX);
          previewPanY = previewDragState.panY + (moveEvent.clientY - previewDragState.startY);
          queuePreviewViewportDraw();
        };
        previewDragUpHandler = () => {
          cleanupPreviewDragHandlers();
        };
        window.addEventListener('mousemove', previewDragMoveHandler);
        window.addEventListener('mouseup', previewDragUpHandler);
        syncPreviewControls(layout);
      });

      document.body.appendChild(backdrop);
      archiveTemplateWindowSession = { panel, close };
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('resize', queuePreviewViewportDraw);
      if (typeof ResizeObserver === 'function') {
        previewResizeObserver = new ResizeObserver(() => queuePreviewViewportDraw());
        previewResizeObserver.observe(previewWrap);
      }

      if (!supportsCreate) {
        setStatus(
          `Selection ${numberFmt.format(rect.width)} x ${numberFmt.format(rect.height)} is too large for template creation in this browser.`,
          true
        );
        drawPreviewPlaceholder('Selection too large for create');
      } else {
        setStatus('Loading archive versions...');
        drawPreviewPlaceholder('Loading preview...');
      }
      updateActionState();
      syncPreviewControls();
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
    title.textContent = 'Time-archive capture';
    title.style.fontSize = '12px';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Cancel';
    closeBtn.style.marginLeft = 'auto';
    closeBtn.style.border = '1px solid var(--bm-border, rgba(255, 255, 255, 0.22))';
    closeBtn.style.borderRadius = '6px';
    closeBtn.style.background = 'var(--bm-btn-bg, rgba(255, 255, 255, 0.12))';
    closeBtn.style.color = 'var(--bm-btn-text, #fff)';
    closeBtn.style.padding = '1px 8px';
    closeBtn.addEventListener('click', () => {
      cancelArchiveTemplatePointCapture('Time-archive point capture cancelled.');
    });
    headingRow.appendChild(title);
    headingRow.appendChild(closeBtn);
    hint.appendChild(headingRow);

    const body = document.createElement('div');
    body.dataset.role = 'body';
    body.style.whiteSpace = 'pre-line';
    body.textContent = 'Click two points on the map.';
    hint.appendChild(body);

    const tip = document.createElement('div');
    tip.style.fontSize = '11px';
    tip.style.color = 'var(--bm-muted)';
    tip.textContent = 'Tip: press Esc to cancel capture.';
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
      title.textContent = pointCount > 0 ? 'Time-archive capture (2/2)' : 'Time-archive capture (1/2)';
    }
    if (body) {
      if (pointCount > 0) {
        const firstText = formatTilePixelCoords(archiveTemplatePointCaptureState.points[0]);
        body.textContent = `First point saved:\n${firstText}\nNow click the second point on the map (opposite corner).`;
      } else {
        body.textContent = 'Click the first point on the map.\nUsually start with the top-left corner.';
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
    activeOverlay?.handleDisplayStatus('Time-archive template mode: click first point on the map, then click second point.');
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
      activeOverlay?.handleDisplayStatus(`First point captured: ${formatTilePixelCoords(coords)}. Click the second point.`);
      return;
    }
    const [firstPoint, secondPoint] = archiveTemplatePointCaptureState.points;
    cancelArchiveTemplatePointCapture('');
    activeOverlay?.handleDisplayStatus(`Second point captured: ${formatTilePixelCoords(secondPoint)}. Opening archive template window...`);
    void openArchiveTemplateBuilder({ firstPoint, secondPoint, overlayInstance: activeOverlay }).catch((error) => {
      consoleWarn('Failed to open archive template builder window.', error);
      activeOverlay?.handleDisplayError('Could not open archive template window.');
    });
  };

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!archiveTemplatePointCaptureState.active) return;
    event.preventDefault();
    cancelArchiveTemplatePointCapture('Time-archive point capture cancelled.');
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
