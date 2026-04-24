/** @file Template creation dialogs extracted from the main userscript entrypoint.
 * @since 0.87.39
 */

/**
 * Builds the UI helpers used for palette conversion previews and custom template builders.
 * The factory keeps UI-only state local to this module while reusing the shared rendering
 * helpers that still live in `main.js`.
 *
 * @param {object} deps Shared helpers and constants from `main.js`.
 * @returns {{
 *   openTemplatePaletteConversionPreview: Function,
 *   openRemoteTemplateBuilder: Function,
 *   openRussianFlagTemplateBuilder: Function,
 *   openTextTemplateBuilder: Function,
 * }}
 */
export const createTemplateCreationUi = (deps = {}) => {
  const {
    t: translate = null,
    applyOverlayVarsToFloatingElement,
    normalizeTemplatePaletteConversionOptions,
    templatePaletteConversionDefaults,
    convertTemplateImageFileToPaletteBlob,
    convertImageDataToWplacePalette,
    cleanUpCanvas,
    consoleWarn,
    TEMPLATE_PALETTE_PREVIEW_MAX_DIMENSION,
    ensureTemplateTextWebFontsLoaded,
    clampNumber,
    TEMPLATE_TEXT_MAX_CHARS,
    TEMPLATE_TEXT_FONT_SIZE,
    TEMPLATE_TEXT_FONT_SIZE_MIN,
    TEMPLATE_TEXT_FONT_SIZE_MAX,
    TEMPLATE_TEXT_FONT_DEFAULT_KEY,
    TEMPLATE_TEXT_PREVIEW_ZOOM_MIN,
    TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT,
    TEMPLATE_TEXT_PREVIEW_MAX_TILE_REQUESTS,
    TEMPLATE_TEXT_PREVIEW_MIN_W,
    TEMPLATE_TEXT_PREVIEW_MIN_H,
    TEMPLATE_TEXT_WINDOW_DEFAULT_W,
    TEMPLATE_TEXT_WINDOW_DEFAULT_H,
    TEMPLATE_TEXT_WINDOW_MIN_W,
    TEMPLATE_TEXT_WINDOW_MIN_H,
    TEMPLATE_TILE_SIZE,
    templateTextFontMap,
    templateTextFontOptions,
    resolveTemplateTextColor,
    rgbToKey,
    rgbToCss,
    templateTextPaletteMap,
    templateTextPaletteOptions,
    normalizePreviewTileX,
    normalizePreviewTileY,
    normalizePreviewTilePixel,
    loadPreviewTileImage,
    createTextTemplateBlob,
    TEMPLATE_FLAG_WINDOW_DEFAULT_W,
    TEMPLATE_FLAG_WINDOW_DEFAULT_H,
    TEMPLATE_FLAG_WINDOW_MIN_W,
    TEMPLATE_FLAG_WINDOW_MIN_H,
    TEMPLATE_FLAG_DIMENSION_MIN,
    TEMPLATE_FLAG_DIMENSION_MAX,
    TEMPLATE_FLAG_DEFAULT_W,
    TEMPLATE_FLAG_DEFAULT_H,
    TEMPLATE_FLAG_IGNORE_BACKGROUND_COLOR_COUNT,
    TEMPLATE_FLAG_IGNORE_MODE_ALL_EXCEPT_SELECTED,
    TEMPLATE_FLAG_IGNORE_MODE_ONLY_SELECTED,
    TEMPLATE_FLAG_ORIENTATION_HORIZONTAL,
    TEMPLATE_FLAG_ORIENTATION_VERTICAL,
    TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_LEFT,
    TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT,
    normalizeRussianFlagStyleKey,
    normalizeFlagIgnoreMode,
    normalizeFlagStripeOrientation,
    normalizeFlagVerticalOrder,
    normalizeFlagStripeColorKeys,
    normalizeFlagStripeWeights,
    normalizeFlagTemplateDimension,
    normalizeFlagPointCoords,
    computeFlagTemplateEndFromStartAndSize,
    parseFourCoordsFromAnyText,
    computeFlagTemplateRectFromPoints,
    getRussianFlagStyle,
    resolveTemplatePaletteNameByKey,
    getFlagDefaultStripeColorKeys,
    normalizeTemplatePaletteKey,
    templateRussianFlagStyles,
    TEMPLATE_RUSSIAN_FLAG_DEFAULT_PROTECTED_KEYS,
    buildRussianFlagTemplateImageData,
    buildRussianFlagTemplateName,
    loadLiveRegionImageDataForFlagMask,
    testCanvasSize,
  } = deps;

  let russianFlagTemplateBuilderSession = null;
  let remoteTemplateBuilderSession = null;
  let textTemplateBuilderSession = null;
  const interpolateText = (text, params = {}) => String(text).replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? ''));
  const tt = (key, fallback, params = {}) => {
    const translated = typeof translate === 'function' ? translate(key, params) : '';
    if (translated && translated !== key) {
      return translated;
    }
    return interpolateText(fallback, params);
  };
  const getFlagStyleLabel = (styleOrKey) => {
    const key = typeof styleOrKey === 'string' ? styleOrKey : String(styleOrKey?.key || '').trim();
    if (key === 'tricolor') return tt('dialog.flag.style.tricolor', 'Russian Tricolor');
    if (key === 'imperial') return tt('dialog.flag.style.imperial', 'Russian Imperial');
    return typeof styleOrKey === 'object' && styleOrKey?.name
      ? String(styleOrKey.name)
      : key;
  };
  const getFlagOrientationLabel = (value) => (
    value === TEMPLATE_FLAG_ORIENTATION_VERTICAL
      ? tt('dialog.flag.orientation.vertical', 'Vertical')
      : tt('dialog.flag.orientation.horizontal', 'Horizontal')
  );
  const TEMPLATE_FLAG_PREVIEW_ZOOM_MIN = 1;
  const TEMPLATE_FLAG_PREVIEW_ZOOM_MAX = 12;
  const formatPreviewZoomText = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

  /**
   * Opens a preview dialog that lets the user inspect and tweak palette conversion settings
   * before applying them to a template image.
   *
   * @param {object} options Dialog input and preview metadata.
   * @returns {Promise<{convert: boolean, options: object}>}
   */
  const openTemplatePaletteConversionPreview = async ({
    sourceFile = null,
    otherPixelCount = 0,
    otherColorCount = 0,
    postCreation = false,
    initialOptions = null,
  } = {}) => {
    const safePixelCount = Math.max(0, Number(otherPixelCount) || 0);
    const safeColorCount = Math.max(0, Number(otherColorCount) || 0);
    const pixelText = new Intl.NumberFormat().format(safePixelCount);
    const colorText = new Intl.NumberFormat().format(safeColorCount);
    const defaults = normalizeTemplatePaletteConversionOptions(initialOptions || templatePaletteConversionDefaults);

    let previewImageData = null;
    let previewWidth = 0;
    let previewHeight = 0;
    if (sourceFile) {
      try {
        const sourceBitmap = await createImageBitmap(sourceFile);
        const maxDimension = Math.max(1, Math.max(sourceBitmap.width, sourceBitmap.height));
        const ratio = Math.min(1, TEMPLATE_PALETTE_PREVIEW_MAX_DIMENSION / maxDimension);
        previewWidth = Math.max(1, Math.round(sourceBitmap.width * ratio));
        previewHeight = Math.max(1, Math.round(sourceBitmap.height * ratio));
        const sourceCanvas = new OffscreenCanvas(previewWidth, previewHeight);
        const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
        if (sourceCtx) {
          sourceCtx.clearRect(0, 0, previewWidth, previewHeight);
          sourceCtx.imageSmoothingEnabled = true;
          sourceCtx.drawImage(sourceBitmap, 0, 0, previewWidth, previewHeight);
          previewImageData = sourceCtx.getImageData(0, 0, previewWidth, previewHeight);
        }
        sourceBitmap.close?.();
        cleanUpCanvas(sourceCanvas);
      } catch (error) {
        consoleWarn('Could not render conversion preview image.', error);
      }
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
      backdrop.style.backdropFilter = 'blur(16px) saturate(140%)';
      backdrop.style.webkitBackdropFilter = 'blur(16px) saturate(140%)';
      backdrop.style.zIndex = '10050';

      const panel = document.createElement('section');
      panel.style.width = previewImageData
        ? 'min(900px, calc(100vw - 24px))'
        : 'min(560px, calc(100vw - 24px))';
      panel.style.maxHeight = 'calc(100vh - 24px)';
      panel.style.overflow = 'auto';
      panel.style.background = 'var(--bm-panel-bg, rgba(20, 20, 20, 0.95))';
      panel.style.color = 'var(--bm-fg, #fff)';
      panel.style.border = '1px solid var(--bm-glass-border, var(--bm-border-strong, rgba(255, 255, 255, 0.25)))';
      panel.style.borderRadius = '10px';
      panel.style.boxShadow = 'var(--bm-glass-shadow, 0 10px 30px rgba(0, 0, 0, 0.35)), var(--bm-glass-inner-shadow, inset 0 1px 0 rgba(255, 255, 255, 0))';
      panel.style.backdropFilter = 'blur(var(--bm-glass-blur, 18px)) saturate(var(--bm-glass-saturate, 160%))';
      panel.style.webkitBackdropFilter = 'blur(var(--bm-glass-blur, 18px)) saturate(var(--bm-glass-saturate, 160%))';
      panel.style.padding = '12px';
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.gap = '10px';
      panel.style.pointerEvents = 'auto';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', tt('dialog.palette.ariaLabel', 'Template color conversion preview'));
      applyOverlayVarsToFloatingElement(panel);

      const title = document.createElement('div');
      title.textContent = postCreation
        ? tt('dialog.palette.title.postCreation', 'Template still has "other" pixels')
        : tt('dialog.palette.title.detected', 'Non-palette colors detected');
      title.style.fontWeight = '700';
      title.style.fontSize = '13px';
      panel.appendChild(title);

      const text = document.createElement('div');
      text.style.fontSize = '12px';
      text.style.lineHeight = '1.4';
      text.style.whiteSpace = 'pre-line';
      text.textContent = postCreation
        ? [
            tt(
              'dialog.palette.text.postCreationPixels',
              'The created template has {count} "other" pixels.',
              { count: pixelText }
            ),
            tt('dialog.palette.text.postCreationHint', 'Preview settings below, then convert and recreate.')
          ].join('\n')
        : [
            tt(
              'dialog.palette.text.detectedPixels',
              '{pixelCount} pixels use {colorCount} non-palette colors.',
              {
                pixelCount: pixelText,
                colorCount: colorText,
              }
            ),
            tt('dialog.palette.text.detectedHint', 'Tune conversion settings and preview the result before applying.')
          ].join('\n');
      panel.appendChild(text);

      const controls = document.createElement('div');
      controls.style.display = 'grid';
      controls.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
      controls.style.gap = '10px';
      controls.style.border = '1px solid var(--bm-border, rgba(255, 255, 255, 0.15))';
      controls.style.borderRadius = '8px';
      controls.style.padding = '10px';

      const buildControlLabel = (labelText) => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.flexDirection = 'column';
        label.style.gap = '5px';
        const titleEl = document.createElement('span');
        titleEl.textContent = labelText;
        titleEl.style.fontSize = '11px';
        titleEl.style.opacity = '0.9';
        label.appendChild(titleEl);
        return { label, titleEl };
      };

      const { label: ditherLabel } = buildControlLabel(tt('dialog.palette.control.dithering', 'Dithering'));
      const ditherModeSelect = document.createElement('select');
      ditherModeSelect.innerHTML = [
        `<option value="none">${tt('dialog.palette.option.off', 'Off')}</option>`,
        `<option value="floyd-steinberg">${tt('dialog.palette.option.floydSteinberg', 'Floyd-Steinberg')}</option>`
      ].join('');
      ditherModeSelect.value = defaults.ditherMode;
      ditherLabel.appendChild(ditherModeSelect);
      controls.appendChild(ditherLabel);

      const { label: ditherStrengthLabel, titleEl: ditherStrengthTitle } = buildControlLabel(tt('dialog.palette.control.ditherStrength', 'Dither Strength'));
      const ditherStrengthRange = document.createElement('input');
      ditherStrengthRange.type = 'range';
      ditherStrengthRange.min = '0';
      ditherStrengthRange.max = '100';
      ditherStrengthRange.step = '1';
      ditherStrengthRange.value = String(Math.round(defaults.ditherStrength * 100));
      ditherStrengthLabel.appendChild(ditherStrengthRange);
      controls.appendChild(ditherStrengthLabel);

      const { label: distanceLabel } = buildControlLabel(tt('dialog.palette.control.distance', 'Distance'));
      const distanceSelect = document.createElement('select');
      distanceSelect.innerHTML = [
        `<option value="weighted">${tt('dialog.palette.option.perceptual', 'Perceptual')}</option>`,
        `<option value="euclidean">${tt('dialog.palette.option.rgbEuclidean', 'RGB Euclidean')}</option>`
      ].join('');
      distanceSelect.value = defaults.distanceMode;
      distanceLabel.appendChild(distanceSelect);
      controls.appendChild(distanceLabel);

      const { label: alphaLabel, titleEl: alphaTitle } = buildControlLabel(tt('dialog.palette.control.alphaThreshold', 'Alpha Threshold'));
      const alphaRange = document.createElement('input');
      alphaRange.type = 'range';
      alphaRange.min = '0';
      alphaRange.max = '255';
      alphaRange.step = '1';
      alphaRange.value = String(defaults.alphaThreshold);
      alphaLabel.appendChild(alphaRange);
      controls.appendChild(alphaLabel);

      const { label: antiLabel, titleEl: antiTitle } = buildControlLabel(tt('dialog.palette.control.antiDither', 'Anti-Dither (Smooth)'));
      const antiRange = document.createElement('input');
      antiRange.type = 'range';
      antiRange.min = '0';
      antiRange.max = '100';
      antiRange.step = '1';
      antiRange.value = String(Math.round(defaults.antiDitherStrength * 100));
      antiLabel.appendChild(antiRange);
      controls.appendChild(antiLabel);

      const serpentineWrap = document.createElement('label');
      serpentineWrap.style.display = 'flex';
      serpentineWrap.style.alignItems = 'center';
      serpentineWrap.style.gap = '8px';
      serpentineWrap.style.fontSize = '11px';
      serpentineWrap.style.opacity = '0.9';
      const serpentineCheckbox = document.createElement('input');
      serpentineCheckbox.type = 'checkbox';
      serpentineCheckbox.checked = defaults.serpentine;
      serpentineWrap.appendChild(serpentineCheckbox);
      serpentineWrap.appendChild(document.createTextNode(tt('dialog.palette.control.serpentine', 'Serpentine Dither Scan')));
      controls.appendChild(serpentineWrap);
      panel.appendChild(controls);

      const previewMeta = document.createElement('div');
      previewMeta.style.fontSize = '11px';
      previewMeta.style.opacity = '0.9';
      panel.appendChild(previewMeta);

      let originalCanvas = null;
      let convertedCanvas = null;
      let originalCtx = null;
      let convertedCtx = null;
      if (previewImageData) {
        const previewGrid = document.createElement('div');
        previewGrid.style.display = 'grid';
        previewGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(240px, 1fr))';
        previewGrid.style.gap = '10px';

        const makePreviewBlock = (labelText) => {
          const block = document.createElement('div');
          block.style.display = 'flex';
          block.style.flexDirection = 'column';
          block.style.gap = '6px';
          const blockLabel = document.createElement('div');
          blockLabel.textContent = labelText;
          blockLabel.style.fontSize = '11px';
          blockLabel.style.opacity = '0.9';
          const canvas = document.createElement('canvas');
          canvas.width = previewWidth;
          canvas.height = previewHeight;
          canvas.style.width = '100%';
          canvas.style.maxWidth = `${Math.max(120, previewWidth * 2)}px`;
          canvas.style.imageRendering = 'pixelated';
          canvas.style.border = '1px solid var(--bm-border, rgba(255, 255, 255, 0.2))';
          canvas.style.borderRadius = '6px';
          canvas.style.background = 'rgba(0, 0, 0, 0.15)';
          block.appendChild(blockLabel);
          block.appendChild(canvas);
          return { block, canvas };
        };

        const originalBlock = makePreviewBlock(tt('dialog.palette.preview.original', 'Original'));
        const convertedBlock = makePreviewBlock(tt('dialog.palette.preview.converted', 'Converted Preview'));
        previewGrid.appendChild(originalBlock.block);
        previewGrid.appendChild(convertedBlock.block);
        panel.appendChild(previewGrid);
        originalCanvas = originalBlock.canvas;
        convertedCanvas = convertedBlock.canvas;
        originalCtx = originalCanvas.getContext('2d');
        convertedCtx = convertedCanvas.getContext('2d');
        if (originalCtx) {
          originalCtx.putImageData(previewImageData, 0, 0);
        }
      } else {
        previewMeta.textContent = tt('dialog.palette.preview.unavailableDetails', 'Preview unavailable for this image; settings will still apply.');
      }

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.justifyContent = 'flex-end';
      actions.style.gap = '8px';

      const keepButton = document.createElement('button');
      keepButton.type = 'button';
      keepButton.textContent = postCreation
        ? tt('dialog.palette.button.keepCurrent', 'Keep Current')
        : tt('dialog.palette.button.keepOriginal', 'Keep Original');
      keepButton.style.border = '1px solid var(--bm-border-strong, rgba(255, 255, 255, 0.3))';
      keepButton.style.background = 'transparent';
      keepButton.style.color = 'inherit';
      keepButton.style.padding = '6px 10px';
      keepButton.style.borderRadius = '6px';
      keepButton.style.cursor = 'pointer';

      const downloadButton = document.createElement('button');
      downloadButton.type = 'button';
      downloadButton.textContent = tt('dialog.palette.button.downloadResult', 'Download Result');
      downloadButton.style.border = '1px solid var(--bm-border-strong, rgba(255, 255, 255, 0.3))';
      downloadButton.style.background = 'var(--bm-subtle-bg, rgba(0, 0, 0, 0.2))';
      downloadButton.style.color = 'inherit';
      downloadButton.style.padding = '6px 10px';
      downloadButton.style.borderRadius = '6px';
      downloadButton.style.cursor = 'pointer';
      if (!sourceFile) {
        downloadButton.disabled = true;
        downloadButton.style.opacity = '0.55';
        downloadButton.title = tt('dialog.palette.download.unavailable', 'No source image available to download.');
      } else {
        downloadButton.title = tt('dialog.palette.download.title', 'Download converted PNG with current settings.');
      }

      const convertButton = document.createElement('button');
      convertButton.type = 'button';
      convertButton.textContent = postCreation
        ? tt('dialog.palette.button.convertRecreate', 'Convert & Recreate')
        : tt('dialog.palette.button.apply', 'Apply Conversion');
      convertButton.style.border = '1px solid var(--bm-btn-bg, #8b1e2f)';
      convertButton.style.background = 'var(--bm-btn-bg, #8b1e2f)';
      convertButton.style.color = 'var(--bm-btn-text, #fff)';
      convertButton.style.padding = '6px 10px';
      convertButton.style.borderRadius = '6px';
      convertButton.style.cursor = 'pointer';

      actions.appendChild(keepButton);
      actions.appendChild(downloadButton);
      actions.appendChild(convertButton);
      panel.appendChild(actions);
      backdrop.appendChild(panel);

      const getSelectedOptions = () => normalizeTemplatePaletteConversionOptions({
        ditherMode: ditherModeSelect.value,
        ditherStrength: Number(ditherStrengthRange.value) / 100,
        distanceMode: distanceSelect.value,
        alphaThreshold: Number(alphaRange.value),
        serpentine: serpentineCheckbox.checked,
        antiDitherStrength: Number(antiRange.value) / 100,
      });
      const getDownloadFileName = () => {
        const sourceName = String(sourceFile?.name || 'template');
        const baseName = sourceName.replace(/\.[^/.]+$/, '') || 'template';
        return `${baseName}_wplace_palette.png`;
      };
      let downloadInProgress = false;
      const onDownloadClick = async () => {
        if (!sourceFile || downloadInProgress) return;
        downloadInProgress = true;
        const previousText = downloadButton.textContent;
        downloadButton.textContent = tt('dialog.palette.download.preparing', 'Preparing...');
        downloadButton.disabled = true;
        try {
          const selectedOptions = getSelectedOptions();
          const conversion = await convertTemplateImageFileToPaletteBlob(sourceFile, selectedOptions);
          const url = URL.createObjectURL(conversion.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = getDownloadFileName();
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 60000);
          const convertedPixels = new Intl.NumberFormat().format(Number(conversion?.stats?.convertedPixels) || 0);
          previewMeta.textContent = tt(
            'dialog.palette.download.success',
            'Downloaded converted PNG ({count} pixels changed).',
            { count: convertedPixels }
          );
        } catch (error) {
          consoleWarn('Failed to prepare converted image download.', error);
          previewMeta.textContent = tt('dialog.palette.download.failed', 'Failed to prepare converted image download.');
        } finally {
          downloadInProgress = false;
          downloadButton.textContent = previousText;
          downloadButton.disabled = !sourceFile;
        }
      };

      const updateControlMeta = () => {
        ditherStrengthTitle.textContent = tt(
          'dialog.palette.control.ditherStrengthValue',
          'Dither Strength ({value}%)',
          { value: ditherStrengthRange.value }
        );
        alphaTitle.textContent = tt(
          'dialog.palette.control.alphaThresholdValue',
          'Alpha Threshold ({value})',
          { value: alphaRange.value }
        );
        antiTitle.textContent = tt(
          'dialog.palette.control.antiDitherValue',
          'Anti-Dither (Smooth) ({value}%)',
          { value: antiRange.value }
        );
        const ditheringEnabled = ditherModeSelect.value === 'floyd-steinberg';
        ditherStrengthRange.disabled = !ditheringEnabled;
        serpentineCheckbox.disabled = !ditheringEnabled;
        if (!ditheringEnabled) {
          serpentineWrap.style.opacity = '0.6';
          ditherStrengthLabel.style.opacity = '0.6';
        } else {
          serpentineWrap.style.opacity = '0.9';
          ditherStrengthLabel.style.opacity = '1';
        }
      };

      let renderToken = 0;
      const renderPreview = () => {
        updateControlMeta();
        if (!previewImageData || !convertedCtx) {
          const selected = getSelectedOptions();
          previewMeta.textContent = tt(
            'dialog.palette.preview.summaryNoImage',
            'Dithering: {dither} • Anti-dither: {anti}% • Distance: {distance}',
            {
              dither: selected.ditherMode === 'none'
                ? tt('dialog.palette.option.off', 'Off')
                : tt('dialog.palette.option.floydSteinberg', 'Floyd-Steinberg'),
              anti: Math.round(selected.antiDitherStrength * 100),
              distance: selected.distanceMode === 'weighted'
                ? tt('dialog.palette.option.perceptual', 'Perceptual')
                : tt('dialog.palette.option.rgbEuclidean', 'RGB Euclidean'),
            }
          );
          return;
        }
        const token = ++renderToken;
        const options = getSelectedOptions();
        const workingImageData = new ImageData(
          new Uint8ClampedArray(previewImageData.data),
          previewWidth,
          previewHeight
        );
        const conversion = convertImageDataToWplacePalette(workingImageData, options);
        if (token !== renderToken) return;
        convertedCtx.clearRect(0, 0, previewWidth, previewHeight);
        convertedCtx.putImageData(conversion.imageData, 0, 0);
        const stats = conversion.stats || {};
        const convertedText = new Intl.NumberFormat().format(Number(stats.convertedPixels) || 0);
        const otherText = new Intl.NumberFormat().format(Number(stats.remainingOtherPixels) || 0);
        previewMeta.textContent = tt(
          'dialog.palette.preview.summary',
          'Preview size {width}x{height} • changed: {changed} • remaining other: {other} • anti-dither: {anti}%',
          {
            width: previewWidth,
            height: previewHeight,
            changed: convertedText,
            other: otherText,
            anti: Math.round(options.antiDitherStrength * 100),
          }
        );
      };

      const onInput = () => renderPreview();
      [
        ditherModeSelect,
        ditherStrengthRange,
        distanceSelect,
        alphaRange,
        antiRange,
        serpentineCheckbox,
      ].forEach((control) => control.addEventListener('input', onInput));
      downloadButton.addEventListener('click', onDownloadClick);
      renderPreview();

      let closed = false;
      const cleanup = () => {
        [
          ditherModeSelect,
          ditherStrengthRange,
          distanceSelect,
          alphaRange,
          antiRange,
          serpentineCheckbox,
        ].forEach((control) => control.removeEventListener('input', onInput));
        downloadButton.removeEventListener('click', onDownloadClick);
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
      };
      const close = (applyConversion) => {
        if (closed) return;
        closed = true;
        const selectedOptions = getSelectedOptions();
        cleanup();
        resolve({
          convert: Boolean(applyConversion),
          options: selectedOptions,
        });
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(false);
        }
      };
      keepButton.addEventListener('click', () => close(false));
      convertButton.addEventListener('click', () => close(true));
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
          close(false);
        }
      });
      document.addEventListener('keydown', onKeyDown, true);

      document.body.appendChild(backdrop);
      convertButton.focus();
    });
  };

  /**
   * Opens a small floating window for importing a template by name.
   *
   * @param {object} options Initial builder state.
   * @returns {Promise<{templateName: string}|null>}
   */
  const openRemoteTemplateBuilder = (options = {}) => {
    if (russianFlagTemplateBuilderSession?.close) {
      russianFlagTemplateBuilderSession.close(null);
    }
    if (textTemplateBuilderSession?.close) {
      textTemplateBuilderSession.close(null);
    }
    if (remoteTemplateBuilderSession?.close) {
      remoteTemplateBuilderSession.close(null);
    }

    const normalizeStream = (value) => {
      const text = String(value ?? '').trim().toLowerCase();
      return text || 'root';
    };
    const configuredStreams = (() => {
      const source = Array.isArray(options?.configuredStreams) ? options.configuredStreams : [];
      const unique = [];
      const seen = new Set();
      for (const entry of source) {
        const stream = normalizeStream(entry);
        if (seen.has(stream)) continue;
        seen.add(stream);
        unique.push(stream);
      }
      return unique.length ? unique : ['root'];
    })();
    const initialTemplateName = String(options?.initialTemplateName ?? '').trim();
    const fetchSuggestedNames = typeof options?.fetchSuggestedNames === 'function' ? options.fetchSuggestedNames : null;
    return new Promise((resolve) => {
      const panel = document.createElement('section');
      panel.id = 'bm-remote-template-window';
      panel.className = 'bm-text-template-window';
      panel.style.width = '360px';
      panel.style.height = '232px';
      panel.style.minWidth = '320px';
      panel.style.minHeight = '220px';
      panel.style.right = '20px';
      panel.style.bottom = '20px';

      const head = document.createElement('div');
      head.className = 'bm-text-template-window-head';
      head.title = tt('dialog.common.dragToMove', 'Drag to move');
      const title = document.createElement('span');
      title.className = 'bm-text-template-window-title';
      title.textContent = tt('dialog.remote.title', 'Remote Template');
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'bm-text-template-window-close';
      closeBtn.textContent = '✖';
      closeBtn.title = tt('dialog.common.close', 'Close');
      head.appendChild(title);
      head.appendChild(closeBtn);
      panel.appendChild(head);

      const body = document.createElement('div');
      body.className = 'bm-text-template-window-body';

      const nameGroup = document.createElement('div');
      nameGroup.className = 'bm-text-template-window-control';
      const nameLabel = document.createElement('label');
      nameLabel.className = 'bm-text-template-window-label';
      nameLabel.textContent = tt('dialog.remote.templateName', 'Template Name');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'bm-text-template-window-number';
      nameInput.setAttribute('autocomplete', 'off');
      nameInput.placeholder = tt('dialog.remote.templateNamePlaceholder', 'Enter remote template name...');
      nameInput.value = initialTemplateName;

      const nameInputWrap = document.createElement('div');
      nameInputWrap.className = 'bm-remote-autocomplete-wrap';
      nameInputWrap.appendChild(nameInput);

      const nameDropdown = document.createElement('ul');
      nameDropdown.className = 'bm-remote-autocomplete-list';
      nameInputWrap.appendChild(nameDropdown);

      nameGroup.appendChild(nameLabel);
      nameGroup.appendChild(nameInputWrap);
      body.appendChild(nameGroup);

      const controls = document.createElement('div');
      controls.className = 'bm-text-template-window-controls';

      const configuredGroup = document.createElement('div');
      configuredGroup.className = 'bm-text-template-window-control';
      const configuredLabel = document.createElement('label');
      configuredLabel.className = 'bm-text-template-window-label';
      configuredLabel.textContent = tt('dialog.remote.configuredStreams', 'Configured Streams');
      const configuredMeta = document.createElement('div');
      configuredMeta.className = 'bm-text-template-window-meta';
      configuredMeta.style.border = '1px solid var(--bm-border-strong)';
      configuredMeta.style.borderRadius = '6px';
      configuredMeta.style.padding = '6px 8px';
      configuredMeta.style.background = 'var(--bm-subtle-bg)';
      configuredMeta.style.minHeight = '26px';
      configuredMeta.style.boxSizing = 'border-box';
      configuredMeta.style.display = 'flex';
      configuredMeta.style.alignItems = 'center';
      configuredMeta.textContent = configuredStreams.join(', ');
      configuredGroup.appendChild(configuredLabel);
      configuredGroup.appendChild(configuredMeta);
      controls.appendChild(configuredGroup);
      body.appendChild(controls);

      const info = document.createElement('div');
      info.className = 'bm-text-template-window-meta';
      info.textContent = tt(
        'dialog.remote.info',
        'Imports as a local template. Configured streams are searched in order until the name is found.'
      );
      body.appendChild(info);

      const errorOutput = document.createElement('div');
      errorOutput.className = 'bm-text-template-window-error';
      body.appendChild(errorOutput);

      const actions = document.createElement('div');
      actions.className = 'bm-text-template-window-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = tt('dialog.common.cancel', 'Cancel');
      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.textContent = tt('dialog.remote.import', 'Import');
      actions.appendChild(cancelBtn);
      actions.appendChild(importBtn);
      body.appendChild(actions);
      panel.appendChild(body);

      let closed = false;
      let dragState = null;
      let moveHandler = null;
      let upHandler = null;

      const cleanupDragHandlers = () => {
        if (moveHandler) {
          window.removeEventListener('mousemove', moveHandler);
          moveHandler = null;
        }
        if (upHandler) {
          window.removeEventListener('mouseup', upHandler);
          upHandler = null;
        }
        dragState = null;
      };

      const applyTheme = () => {
        applyOverlayVarsToFloatingElement(panel);
      };
      const handleThemeChanged = () => {
        applyTheme();
      };
      const syncImportState = () => {
        importBtn.disabled = !nameInput.value.trim();
      };

      const close = (result = null) => {
        if (closed) return;
        closed = true;
        cleanupDragHandlers();
        document.removeEventListener('bm-layout-theme-changed', handleThemeChanged);
        window.removeEventListener('keydown', handleKeyDown, true);
        panel.remove();
        if (remoteTemplateBuilderSession?.panel === panel) {
          remoteTemplateBuilderSession = null;
        }
        resolve(result);
      };

      const submit = () => {
        const templateName = String(nameInput.value || '').trim();
        if (!templateName) {
          errorOutput.textContent = tt('dialog.remote.templateNameRequired', 'Template name is required.');
          syncImportState();
          return;
        }
        errorOutput.textContent = '';
        close({
          templateName,
        });
      };

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(null);
          return;
        }
        if (event.key === 'Enter' && event.target !== closeBtn && event.target !== cancelBtn) {
          event.preventDefault();
          submit();
        }
      };

      closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      });
      cancelBtn.addEventListener('click', () => close(null));
      importBtn.addEventListener('click', () => submit());

      head.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        const rect = panel.getBoundingClientRect();
        dragState = {
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top
        };
        moveHandler = (moveEvent) => {
          if (!dragState) return;
          const currentRect = panel.getBoundingClientRect();
          const maxLeft = Math.max(8, window.innerWidth - currentRect.width - 8);
          const maxTop = Math.max(8, window.innerHeight - currentRect.height - 8);
          const left = Math.min(maxLeft, Math.max(8, moveEvent.clientX - dragState.offsetX));
          const top = Math.min(maxTop, Math.max(8, moveEvent.clientY - dragState.offsetY));
          panel.style.left = `${left}px`;
          panel.style.top = `${top}px`;
          panel.style.right = 'auto';
          panel.style.bottom = 'auto';
        };
        upHandler = () => {
          cleanupDragHandlers();
        };
        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
        event.preventDefault();
      });

      document.body.appendChild(panel);
      remoteTemplateBuilderSession = { panel, close };
      applyTheme();
      document.addEventListener('bm-layout-theme-changed', handleThemeChanged);
      window.addEventListener('keydown', handleKeyDown, true);
      syncImportState();
      nameInput.focus();
      nameInput.select();

      let allSuggestedNames = [];
      let activeIndex = -1;

      const closeDropdown = () => {
        nameDropdown.innerHTML = '';
        nameDropdown.classList.remove('bm-remote-autocomplete-list--open');
        activeIndex = -1;
      };

      const renderDropdown = (names) => {
        nameDropdown.innerHTML = '';
        activeIndex = -1;
        if (!names.length) { closeDropdown(); return; }
        names.forEach((name, i) => {
          const li = document.createElement('li');
          li.className = 'bm-remote-autocomplete-item';
          li.textContent = name;
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            nameInput.value = name;
            errorOutput.textContent = '';
            syncImportState();
            closeDropdown();
          });
          nameDropdown.appendChild(li);
        });
        nameDropdown.classList.add('bm-remote-autocomplete-list--open');
      };

      const setActive = (index) => {
        const items = nameDropdown.querySelectorAll('.bm-remote-autocomplete-item');
        items.forEach((el, i) => el.classList.toggle('bm-remote-autocomplete-item--active', i === index));
        activeIndex = index;
        if (index >= 0 && items[index]) items[index].scrollIntoView({ block: 'nearest' });
      };

      const filterAndShow = () => {
        const query = nameInput.value.trim().toLowerCase();
        if (!query) { closeDropdown(); return; }
        const filtered = allSuggestedNames.filter((n) => n.toLowerCase().includes(query));
        renderDropdown(filtered.slice(0, 50));
      };

      nameInput.addEventListener('input', () => {
        errorOutput.textContent = '';
        syncImportState();
        filterAndShow();
      });

      nameInput.addEventListener('focus', () => {
        if (nameInput.value.trim()) filterAndShow();
      });

      nameInput.addEventListener('blur', () => {
        setTimeout(closeDropdown, 120);
      });

      nameInput.addEventListener('keydown', (e) => {
        if (!nameDropdown.classList.contains('bm-remote-autocomplete-list--open')) return;
        const items = nameDropdown.querySelectorAll('.bm-remote-autocomplete-item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive(Math.min(activeIndex + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive(Math.max(activeIndex - 1, 0));
        } else if (e.key === 'Enter' && activeIndex >= 0) {
          e.stopImmediatePropagation();
          nameInput.value = items[activeIndex].textContent;
          syncImportState();
          closeDropdown();
        } else if (e.key === 'Escape') {
          closeDropdown();
        }
      }, true);

      if (fetchSuggestedNames) {
        fetchSuggestedNames().then((names) => {
          if (closed || !Array.isArray(names)) return;
          allSuggestedNames = names;
          if (nameInput.value.trim()) filterAndShow();
        }).catch(() => {});
      }
    });
  };

  /**
   * Opens the custom Russian flag template builder and resolves with the generated file and
   * the metadata needed by the main template creation flow.
   *
   * @param {object} options Initial builder state.
   * @returns {Promise<object|null>}
   */
  const openRussianFlagTemplateBuilder = (options = {}) => {
    if (russianFlagTemplateBuilderSession?.close) {
      russianFlagTemplateBuilderSession.close(null);
    }
    if (remoteTemplateBuilderSession?.close) {
      remoteTemplateBuilderSession.close(null);
    }
    if (textTemplateBuilderSession?.close) {
      textTemplateBuilderSession.close(null);
    }
    const initialStyleKey = normalizeRussianFlagStyleKey(options?.initialStyleKey);
    const initialStripeOrientation = normalizeFlagStripeOrientation(options?.initialStripeOrientation);
    const initialVerticalOrder = normalizeFlagVerticalOrder(options?.initialVerticalOrder);
    const initialStripeColorKeys = normalizeFlagStripeColorKeys(options?.initialStripeColorKeys, initialStyleKey);
    const initialStripeWeights = normalizeFlagStripeWeights(options?.initialStripeWeights);
    const initialIgnoreMode = normalizeFlagIgnoreMode(options?.initialIgnoreMode);
    const initialWidth = normalizeFlagTemplateDimension(options?.initialWidth, TEMPLATE_FLAG_DEFAULT_W);
    const initialHeight = normalizeFlagTemplateDimension(options?.initialHeight, TEMPLATE_FLAG_DEFAULT_H);
    const initialIgnoreArts = Boolean(options?.initialIgnoreArts);
    const initialStartCoords = normalizeFlagPointCoords(options?.startCoords || options?.topLeftCoords) || {
      tx: 0,
      ty: 0,
      px: 0,
      py: 0,
    };
    const initialEndCoords = normalizeFlagPointCoords(options?.endCoords)
      || computeFlagTemplateEndFromStartAndSize(initialStartCoords, initialWidth, initialHeight)
      || initialStartCoords;
    const initialProtectedKeys = new Set(
      (
        Array.isArray(options?.initialProtectedColorKeys) && options.initialProtectedColorKeys.length > 0
          ? options.initialProtectedColorKeys
          : TEMPLATE_RUSSIAN_FLAG_DEFAULT_PROTECTED_KEYS
      )
        .map(normalizeTemplatePaletteKey)
        .filter(Boolean)
    );

    return new Promise((resolve) => {
      const panel = document.createElement('section');
      panel.id = 'bm-flag-template-window';
      panel.className = 'bm-text-template-window bm-flag-template-window';
      panel.style.width = `${TEMPLATE_FLAG_WINDOW_DEFAULT_W}px`;
      panel.style.height = `${TEMPLATE_FLAG_WINDOW_DEFAULT_H}px`;
      panel.style.minWidth = `${TEMPLATE_FLAG_WINDOW_MIN_W}px`;
      panel.style.minHeight = `${TEMPLATE_FLAG_WINDOW_MIN_H}px`;
      panel.style.right = '20px';
      panel.style.bottom = '20px';

      const head = document.createElement('div');
      head.className = 'bm-text-template-window-head';
      head.title = tt('dialog.common.dragToMove', 'Drag to move');
      const title = document.createElement('span');
      title.className = 'bm-text-template-window-title';
      title.textContent = tt('dialog.flag.title', 'Russian Flag Template');
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'bm-text-template-window-close';
      closeBtn.textContent = '✖';
      closeBtn.title = tt('dialog.common.close', 'Close');
      head.appendChild(title);
      head.appendChild(closeBtn);
      panel.appendChild(head);

      const body = document.createElement('div');
      body.className = 'bm-text-template-window-body';

      const controls = document.createElement('div');
      controls.className = 'bm-text-template-window-controls';

      const styleGroup = document.createElement('div');
      styleGroup.className = 'bm-text-template-window-control';
      const styleLabel = document.createElement('label');
      styleLabel.className = 'bm-text-template-window-label';
      styleLabel.textContent = tt('dialog.flag.type', 'Flag Type');
      const styleSelect = document.createElement('select');
      styleSelect.className = 'bm-text-template-window-select';
      templateRussianFlagStyles.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.key;
        option.textContent = getFlagStyleLabel(entry);
        styleSelect.appendChild(option);
      });
      styleSelect.value = initialStyleKey;
      styleGroup.appendChild(styleLabel);
      styleGroup.appendChild(styleSelect);
      controls.appendChild(styleGroup);

      const orientationGroup = document.createElement('div');
      orientationGroup.className = 'bm-text-template-window-control';
      const orientationLabel = document.createElement('label');
      orientationLabel.className = 'bm-text-template-window-label';
      orientationLabel.textContent = tt('dialog.flag.stripes', 'Stripes');
      const orientationSelect = document.createElement('select');
      orientationSelect.className = 'bm-text-template-window-select';
      [
        [TEMPLATE_FLAG_ORIENTATION_HORIZONTAL, getFlagOrientationLabel(TEMPLATE_FLAG_ORIENTATION_HORIZONTAL)],
        [TEMPLATE_FLAG_ORIENTATION_VERTICAL, getFlagOrientationLabel(TEMPLATE_FLAG_ORIENTATION_VERTICAL)],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        orientationSelect.appendChild(option);
      });
      orientationSelect.value = initialStripeOrientation;
      orientationGroup.appendChild(orientationLabel);
      orientationGroup.appendChild(orientationSelect);
      controls.appendChild(orientationGroup);

      const verticalOrderGroup = document.createElement('div');
      verticalOrderGroup.className = 'bm-text-template-window-control';
      const verticalOrderLabel = document.createElement('label');
      verticalOrderLabel.className = 'bm-text-template-window-label';
      verticalOrderLabel.textContent = tt('dialog.flag.verticalRotate', 'Vertical Rotate');
      const verticalOrderSelect = document.createElement('select');
      verticalOrderSelect.className = 'bm-text-template-window-select';
      const verticalOrderOptionFirstLeft = document.createElement('option');
      verticalOrderOptionFirstLeft.value = TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_LEFT;
      const verticalOrderOptionFirstRight = document.createElement('option');
      verticalOrderOptionFirstRight.value = TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT;
      verticalOrderSelect.appendChild(verticalOrderOptionFirstLeft);
      verticalOrderSelect.appendChild(verticalOrderOptionFirstRight);
      verticalOrderSelect.value = initialVerticalOrder;
      verticalOrderGroup.appendChild(verticalOrderLabel);
      verticalOrderGroup.appendChild(verticalOrderSelect);
      controls.appendChild(verticalOrderGroup);

      const sizeGroup = document.createElement('div');
      sizeGroup.className = 'bm-text-template-window-control';
      const sizeLabel = document.createElement('label');
      sizeLabel.className = 'bm-text-template-window-label';
      sizeLabel.textContent = tt(
        'dialog.flag.size',
        'Size (px, {min}-{max})',
        { min: TEMPLATE_FLAG_DIMENSION_MIN, max: TEMPLATE_FLAG_DIMENSION_MAX }
      );
      const sizeRow = document.createElement('div');
      sizeRow.className = 'bm-text-template-window-pair';
      const widthInput = document.createElement('input');
      widthInput.className = 'bm-text-template-window-number';
      widthInput.type = 'number';
      widthInput.min = String(TEMPLATE_FLAG_DIMENSION_MIN);
      widthInput.max = String(TEMPLATE_FLAG_DIMENSION_MAX);
      widthInput.step = '1';
      widthInput.value = String(initialWidth);
      widthInput.placeholder = tt('dialog.flag.width', 'Width');
      const heightInput = document.createElement('input');
      heightInput.className = 'bm-text-template-window-number';
      heightInput.type = 'number';
      heightInput.min = String(TEMPLATE_FLAG_DIMENSION_MIN);
      heightInput.max = String(TEMPLATE_FLAG_DIMENSION_MAX);
      heightInput.step = '1';
      heightInput.value = String(initialHeight);
      heightInput.placeholder = tt('dialog.flag.height', 'Height');
      sizeRow.appendChild(widthInput);
      sizeRow.appendChild(heightInput);
      sizeGroup.appendChild(sizeLabel);
      sizeGroup.appendChild(sizeRow);
      controls.appendChild(sizeGroup);

      const stripeColorGroup = document.createElement('div');
      stripeColorGroup.className = 'bm-text-template-window-control';
      stripeColorGroup.style.gridColumn = '1 / -1';
      const stripeColorLabel = document.createElement('label');
      stripeColorLabel.className = 'bm-text-template-window-label';
      stripeColorLabel.textContent = tt('dialog.flag.stripeColors', 'Stripe Colors');
      const stripeColorRow = document.createElement('div');
      stripeColorRow.style.display = 'grid';
      stripeColorRow.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
      stripeColorRow.style.gap = '6px';
      const stripeColorInputs = [0, 1, 2].map(() => {
        const slot = document.createElement('div');
        slot.className = 'bm-text-template-window-control';
        const slotLabel = document.createElement('label');
        slotLabel.className = 'bm-text-template-window-label';
        const slotSelect = document.createElement('select');
        slotSelect.className = 'bm-text-template-window-select';
        templateTextPaletteOptions.forEach((option) => {
          const optionElement = document.createElement('option');
          optionElement.value = option.key;
          optionElement.textContent = option.name;
          slotSelect.appendChild(optionElement);
        });
        slot.appendChild(slotLabel);
        slot.appendChild(slotSelect);
        stripeColorRow.appendChild(slot);
        return { label: slotLabel, select: slotSelect };
      });
      stripeColorGroup.appendChild(stripeColorLabel);
      stripeColorGroup.appendChild(stripeColorRow);
      controls.appendChild(stripeColorGroup);

      const stripeWeightGroup = document.createElement('div');
      stripeWeightGroup.className = 'bm-text-template-window-control';
      stripeWeightGroup.style.gridColumn = '1 / -1';
      const stripeWeightLabel = document.createElement('label');
      stripeWeightLabel.className = 'bm-text-template-window-label';
      stripeWeightLabel.textContent = tt('dialog.flag.stripeWidths', 'Stripe Widths');
      const stripeWeightRow = document.createElement('div');
      stripeWeightRow.style.display = 'grid';
      stripeWeightRow.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
      stripeWeightRow.style.gap = '6px';
      const stripeWeightInputs = [0, 1, 2].map((index) => {
        const slot = document.createElement('div');
        slot.className = 'bm-text-template-window-control';
        const slotLabel = document.createElement('label');
        slotLabel.className = 'bm-text-template-window-label';
        const slotInput = document.createElement('input');
        slotInput.className = 'bm-text-template-window-number';
        slotInput.type = 'number';
        slotInput.min = '1';
        slotInput.step = '1';
        slotInput.value = String(initialStripeWeights[index] || 1);
        slot.appendChild(slotLabel);
        slot.appendChild(slotInput);
        stripeWeightRow.appendChild(slot);
        return { label: slotLabel, input: slotInput };
      });
      stripeWeightGroup.appendChild(stripeWeightLabel);
      stripeWeightGroup.appendChild(stripeWeightRow);
      controls.appendChild(stripeWeightGroup);

      const pointsGroup = document.createElement('div');
      pointsGroup.className = 'bm-text-template-window-control';
      pointsGroup.style.gridColumn = '1 / -1';
      const pointsLabel = document.createElement('label');
      pointsLabel.className = 'bm-text-template-window-label';
      pointsLabel.textContent = tt('dialog.flag.points', 'Start / End Points (Tl X, Tl Y, Px X, Px Y)');
      pointsGroup.appendChild(pointsLabel);

      const buildPointRow = (labelText, point) => {
        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = 'auto repeat(4, minmax(0, 1fr))';
        row.style.gap = '6px';
        row.style.alignItems = 'center';
        const label = document.createElement('span');
        label.className = 'bm-text-template-window-label';
        label.textContent = labelText;
        label.style.whiteSpace = 'nowrap';
        const txInput = document.createElement('input');
        txInput.className = 'bm-text-template-window-number';
        txInput.type = 'number';
        txInput.step = '1';
        txInput.placeholder = tt('dialog.flag.coords.tx', 'Tl X');
        txInput.value = String(point.tx);
        const tyInput = document.createElement('input');
        tyInput.className = 'bm-text-template-window-number';
        tyInput.type = 'number';
        tyInput.step = '1';
        tyInput.placeholder = tt('dialog.flag.coords.ty', 'Tl Y');
        tyInput.value = String(point.ty);
        const pxInput = document.createElement('input');
        pxInput.className = 'bm-text-template-window-number';
        pxInput.type = 'number';
        pxInput.step = '1';
        pxInput.placeholder = tt('dialog.flag.coords.px', 'Px X');
        pxInput.value = String(point.px);
        const pyInput = document.createElement('input');
        pyInput.className = 'bm-text-template-window-number';
        pyInput.type = 'number';
        pyInput.step = '1';
        pyInput.placeholder = tt('dialog.flag.coords.py', 'Px Y');
        pyInput.value = String(point.py);
        row.appendChild(label);
        row.appendChild(txInput);
        row.appendChild(tyInput);
        row.appendChild(pxInput);
        row.appendChild(pyInput);
        return { row, txInput, tyInput, pxInput, pyInput };
      };

      const startRowInputs = buildPointRow(tt('dialog.flag.start', 'Start'), initialStartCoords);
      const endRowInputs = buildPointRow(tt('dialog.flag.end', 'End'), initialEndCoords);
      pointsGroup.appendChild(startRowInputs.row);
      pointsGroup.appendChild(endRowInputs.row);
      controls.appendChild(pointsGroup);

      const ignoreGroup = document.createElement('div');
      ignoreGroup.className = 'bm-text-template-window-control';
      const ignoreLabel = document.createElement('label');
      ignoreLabel.className = 'bm-text-template-window-label';
      ignoreLabel.textContent = tt('dialog.flag.ignoreArts', 'Ignore existing arts');
      const ignoreToggle = document.createElement('input');
      ignoreToggle.type = 'checkbox';
      ignoreToggle.checked = initialIgnoreArts;
      ignoreToggle.style.alignSelf = 'flex-start';
      ignoreToggle.style.marginTop = '2px';
      const ignoreModeSelect = document.createElement('select');
      ignoreModeSelect.className = 'bm-text-template-window-select';
      [
        [TEMPLATE_FLAG_IGNORE_MODE_ALL_EXCEPT_SELECTED, tt('dialog.flag.ignoreMode.allExceptSelected', 'All art except selected')],
        [TEMPLATE_FLAG_IGNORE_MODE_ONLY_SELECTED, tt('dialog.flag.ignoreMode.onlySelected', 'Only selected colors')],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        ignoreModeSelect.appendChild(option);
      });
      ignoreModeSelect.value = initialIgnoreMode;
      ignoreGroup.appendChild(ignoreLabel);
      ignoreGroup.appendChild(ignoreToggle);
      ignoreGroup.appendChild(ignoreModeSelect);
      controls.appendChild(ignoreGroup);

      const protectedGroup = document.createElement('div');
      protectedGroup.className = 'bm-text-template-window-control';
      const protectedLabel = document.createElement('label');
      protectedLabel.className = 'bm-text-template-window-label';
      protectedLabel.textContent = tt('dialog.flag.protectedColors', 'Colors Not Ignored');
      const protectedTools = document.createElement('div');
      protectedTools.style.display = 'grid';
      protectedTools.style.gridTemplateColumns = '1fr auto auto';
      protectedTools.style.gap = '6px';
      const protectedColorSelect = document.createElement('select');
      protectedColorSelect.className = 'bm-text-template-window-select';
      templateTextPaletteOptions.forEach((option) => {
        const optionElement = document.createElement('option');
        optionElement.value = option.key;
        optionElement.textContent = option.name;
        protectedColorSelect.appendChild(optionElement);
      });
      const addProtectedColorButton = document.createElement('button');
      addProtectedColorButton.type = 'button';
      addProtectedColorButton.textContent = tt('dialog.flag.add', 'Add');
      const resetProtectedColorButton = document.createElement('button');
      resetProtectedColorButton.type = 'button';
      resetProtectedColorButton.textContent = tt('dialog.flag.default', 'Default');
      protectedTools.appendChild(protectedColorSelect);
      protectedTools.appendChild(addProtectedColorButton);
      protectedTools.appendChild(resetProtectedColorButton);
      const protectedList = document.createElement('div');
      protectedList.style.display = 'flex';
      protectedList.style.flexWrap = 'wrap';
      protectedList.style.gap = '6px';
      protectedList.style.maxHeight = '88px';
      protectedList.style.overflow = 'auto';
      protectedList.style.padding = '6px';
      protectedList.style.border = '1px solid var(--bm-border-strong)';
      protectedList.style.borderRadius = '6px';
      protectedList.style.background = 'var(--bm-subtle-bg)';
      protectedGroup.appendChild(protectedLabel);
      protectedGroup.appendChild(protectedTools);
      protectedGroup.appendChild(protectedList);
      controls.appendChild(protectedGroup);

      body.appendChild(controls);

      const previewMeta = document.createElement('div');
      previewMeta.className = 'bm-text-template-window-meta';
      body.appendChild(previewMeta);

      const previewWrap = document.createElement('div');
      previewWrap.className = 'bm-text-template-window-preview bm-flag-template-window-preview';
      const previewCanvas = document.createElement('canvas');
      previewCanvas.className = 'bm-text-template-window-canvas';
      previewWrap.appendChild(previewCanvas);
      body.appendChild(previewWrap);

      const previewControls = document.createElement('div');
      previewControls.className = 'bm-flag-template-window-preview-controls';
      const previewHint = document.createElement('div');
      previewHint.className = 'bm-text-template-window-label';
      previewHint.textContent = tt('dialog.flag.previewHint', 'Wheel to zoom. Drag to pan.');
      const previewZoomTools = document.createElement('div');
      previewZoomTools.className = 'bm-flag-template-window-preview-tools';
      const previewZoomOut = document.createElement('button');
      previewZoomOut.type = 'button';
      previewZoomOut.textContent = '-';
      previewZoomOut.title = tt('dialog.flag.previewZoomOut', 'Zoom out');
      const previewZoomValueLabel = document.createElement('span');
      previewZoomValueLabel.className = 'bm-flag-template-window-preview-zoom-value';
      previewZoomValueLabel.textContent = formatPreviewZoomText(TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT);
      const previewZoomReset = document.createElement('button');
      previewZoomReset.type = 'button';
      previewZoomReset.textContent = tt('dialog.flag.previewZoomReset', 'Reset');
      previewZoomReset.title = tt('dialog.flag.previewZoomResetTitle', 'Reset zoom and pan');
      const previewZoomIn = document.createElement('button');
      previewZoomIn.type = 'button';
      previewZoomIn.textContent = '+';
      previewZoomIn.title = tt('dialog.flag.previewZoomIn', 'Zoom in');
      previewZoomTools.appendChild(previewZoomOut);
      previewZoomTools.appendChild(previewZoomValueLabel);
      previewZoomTools.appendChild(previewZoomReset);
      previewZoomTools.appendChild(previewZoomIn);
      previewControls.appendChild(previewHint);
      previewControls.appendChild(previewZoomTools);
      body.appendChild(previewControls);

      const errorOutput = document.createElement('div');
      errorOutput.className = 'bm-text-template-window-error';
      body.appendChild(errorOutput);

      const actions = document.createElement('div');
      actions.className = 'bm-text-template-window-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = tt('dialog.common.cancel', 'Cancel');
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.textContent = tt('dialog.common.createTemplate', 'Create Template');
      actions.appendChild(cancelBtn);
      actions.appendChild(createBtn);
      body.appendChild(actions);

      panel.appendChild(body);

      let closed = false;
      let dragState = null;
      let moveHandler = null;
      let upHandler = null;
      let resizeObserver = null;
      let previewRenderTimer = null;
      let previewRenderToken = 0;
      let previewViewportRedrawQueued = false;
      let previewRendering = false;
      let createBusy = false;
      let lastRenderResult = null;
      let maskRegionCache = { key: '', value: null };
      const protectedColorKeys = new Set(initialProtectedKeys);
      let stripeColorKeys = initialStripeColorKeys.slice(0, 3);
      let stripeWeights = initialStripeWeights.slice(0, 3);
      let previewZoomValue = TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT;
      let previewPanX = 0;
      let previewPanY = 0;
      let previewHasImage = false;

      const readDimensions = () => {
        const rawWidth = Math.round(Number(widthInput.value));
        const rawHeight = Math.round(Number(heightInput.value));
        const width = Number.isFinite(rawWidth)
          ? Math.max(TEMPLATE_FLAG_DIMENSION_MIN, rawWidth)
          : TEMPLATE_FLAG_DEFAULT_W;
        const height = Number.isFinite(rawHeight)
          ? Math.max(TEMPLATE_FLAG_DIMENSION_MIN, rawHeight)
          : TEMPLATE_FLAG_DEFAULT_H;
        return { width, height };
      };
      const writeDimensions = (width, height) => {
        widthInput.value = String(Math.max(TEMPLATE_FLAG_DIMENSION_MIN, Math.round(Number(width) || TEMPLATE_FLAG_DEFAULT_W)));
        heightInput.value = String(Math.max(TEMPLATE_FLAG_DIMENSION_MIN, Math.round(Number(height) || TEMPLATE_FLAG_DEFAULT_H)));
      };
      const readPointInputs = (inputs) => normalizeFlagPointCoords({
        tx: inputs.txInput.value,
        ty: inputs.tyInput.value,
        px: inputs.pxInput.value,
        py: inputs.pyInput.value,
      });
      const writePointInputs = (inputs, coords) => {
        const normalized = normalizeFlagPointCoords(coords);
        if (!normalized) return null;
        inputs.txInput.value = String(normalized.tx);
        inputs.tyInput.value = String(normalized.ty);
        inputs.pxInput.value = String(normalized.px);
        inputs.pyInput.value = String(normalized.py);
        return normalized;
      };
      const applyPastedCoordsToRow = (event, inputs) => {
        const clipboardText = event?.clipboardData?.getData('text')
          ?? window.clipboardData?.getData('text')
          ?? '';
        const parsed = parseFourCoordsFromAnyText(clipboardText);
        if (!parsed) return false;
        writePointInputs(inputs, parsed);
        syncRectFromPoints({ canonicalize: true });
        queuePreviewRender();
        event.preventDefault();
        return true;
      };
      const syncRectFromPoints = ({ canonicalize = true } = {}) => {
        const start = readPointInputs(startRowInputs);
        const end = readPointInputs(endRowInputs);
        const rect = computeFlagTemplateRectFromPoints(start, end);
        if (!rect) return null;
        if (canonicalize) {
          writePointInputs(startRowInputs, rect.topLeft);
          writePointInputs(endRowInputs, rect.bottomRight);
        }
        writeDimensions(rect.width, rect.height);
        syncOrientationFromRect(rect);
        return rect;
      };
      const syncEndFromStartAndSize = () => {
        const start = readPointInputs(startRowInputs);
        if (!start) return null;
        const { width, height } = readDimensions();
        const end = computeFlagTemplateEndFromStartAndSize(start, width, height);
        if (!end) return null;
        writePointInputs(endRowInputs, end);
        return syncRectFromPoints({ canonicalize: true });
      };
      const getCurrentRect = () => syncRectFromPoints({ canonicalize: true });
      const getIgnoreMode = () => normalizeFlagIgnoreMode(ignoreModeSelect.value);
      const getStripeOrientation = () => normalizeFlagStripeOrientation(orientationSelect.value);
      const getVerticalOrder = () => normalizeFlagVerticalOrder(verticalOrderSelect.value);
      const getSelectedStyle = () => getRussianFlagStyle(styleSelect.value);
      const syncOrientationFromRect = (rect) => {
        if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
        const nextOrientation = rect.height > rect.width
          ? TEMPLATE_FLAG_ORIENTATION_VERTICAL
          : TEMPLATE_FLAG_ORIENTATION_HORIZONTAL;
        if (orientationSelect.value !== nextOrientation) {
          orientationSelect.value = nextOrientation;
          updateStripeControls();
          updateActionState();
        }
        return nextOrientation;
      };
      const setPreviewZoom = (value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
          previewZoomValue = TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT;
          return previewZoomValue;
        }
        previewZoomValue = Math.max(
          TEMPLATE_FLAG_PREVIEW_ZOOM_MIN,
          Math.min(TEMPLATE_FLAG_PREVIEW_ZOOM_MAX, numericValue)
        );
        return previewZoomValue;
      };
      const getPreviewZoom = () => previewZoomValue;
      const clampPreviewPan = (value, maxPan) => clampNumber(value, -maxPan, maxPan, 0);
      const syncStripeColorInputs = () => {
        stripeColorKeys = normalizeFlagStripeColorKeys(stripeColorKeys, styleSelect.value);
        stripeColorInputs.forEach((entry, index) => {
          const key = stripeColorKeys[index];
          if (key && templateTextPaletteMap.has(key)) {
            entry.select.value = key;
          } else if (templateTextPaletteOptions[index]?.key) {
            entry.select.value = templateTextPaletteOptions[index].key;
          }
        });
        return stripeColorKeys;
      };
      const syncStripeWeightInputs = () => {
        stripeWeights = normalizeFlagStripeWeights(stripeWeights);
        stripeWeightInputs.forEach((entry, index) => {
          entry.input.value = String(stripeWeights[index] || 1);
        });
        return stripeWeights;
      };
      const readStripeColorKeysFromInputs = () => {
        stripeColorKeys = normalizeFlagStripeColorKeys(
          stripeColorInputs.map((entry) => entry.select.value),
          styleSelect.value
        );
        return stripeColorKeys;
      };
      const readStripeWeightsFromInputs = () => {
        stripeWeights = normalizeFlagStripeWeights(
          stripeWeightInputs.map((entry) => entry.input.value)
        );
        return syncStripeWeightInputs();
      };
      const getFirstStripeColorName = () => {
        const keys = readStripeColorKeysFromInputs();
        return resolveTemplatePaletteNameByKey(keys[0]) || tt('dialog.flag.firstColor', 'First color');
      };
      const updateStripeColorSlotLabels = () => {
        const orientation = getStripeOrientation();
        const verticalOrder = getVerticalOrder();
        const labels = orientation === TEMPLATE_FLAG_ORIENTATION_VERTICAL
          ? (
            verticalOrder === TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT
              ? [
                  tt('dialog.flag.rightStripe', 'Right stripe'),
                  tt('dialog.flag.middleStripe', 'Middle stripe'),
                  tt('dialog.flag.leftStripe', 'Left stripe'),
                ]
              : [
                  tt('dialog.flag.leftStripe', 'Left stripe'),
                  tt('dialog.flag.middleStripe', 'Middle stripe'),
                  tt('dialog.flag.rightStripe', 'Right stripe'),
                ]
          )
          : [
              tt('dialog.flag.topStripe', 'Top stripe'),
              tt('dialog.flag.middleStripe', 'Middle stripe'),
              tt('dialog.flag.bottomStripe', 'Bottom stripe'),
            ];
        stripeColorInputs.forEach((entry, index) => {
          entry.label.textContent = labels[index] || tt('dialog.flag.stripeNumber', 'Stripe {index}', { index: index + 1 });
        });
        stripeWeightInputs.forEach((entry, index) => {
          entry.label.textContent = labels[index] || tt('dialog.flag.stripeNumber', 'Stripe {index}', { index: index + 1 });
        });
      };
      const updateVerticalOrderLabels = () => {
        const firstColorName = getFirstStripeColorName();
        verticalOrderOptionFirstLeft.textContent = tt('dialog.flag.verticalOrder.left', '{color} left', { color: firstColorName });
        verticalOrderOptionFirstRight.textContent = tt('dialog.flag.verticalOrder.right', '{color} right', { color: firstColorName });
      };
      const updateStripeControls = () => {
        readStripeColorKeysFromInputs();
        readStripeWeightsFromInputs();
        updateVerticalOrderLabels();
        updateStripeColorSlotLabels();
      };
      const updateIgnoreModeLabels = () => {
        const ignoreMode = getIgnoreMode();
        protectedLabel.textContent = ignoreMode === TEMPLATE_FLAG_IGNORE_MODE_ONLY_SELECTED
          ? tt('dialog.flag.selectedColorsIgnored', 'Colors Ignored')
          : tt('dialog.flag.selectedColorsNotIgnored', 'Colors Not Ignored');
      };
      const getProtectedColorKeys = () => [...protectedColorKeys].filter((key) => templateTextPaletteMap.has(key));
      const getMaskCoordsText = (rect = null) => {
        const targetRect = rect || getCurrentRect();
        if (!targetRect?.topLeft || !targetRect?.bottomRight) return tt('dialog.flag.coordsUnavailable', 'Coords unavailable');
        return tt(
          'dialog.flag.coordsSummary',
          'Tl {startTx}, {startTy} • Px {startPx}, {startPy} -> Tl {endTx}, {endTy} • Px {endPx}, {endPy}',
          {
            startTx: targetRect.topLeft.tx,
            startTy: targetRect.topLeft.ty,
            startPx: targetRect.topLeft.px,
            startPy: targetRect.topLeft.py,
            endTx: targetRect.bottomRight.tx,
            endTy: targetRect.bottomRight.ty,
            endPx: targetRect.bottomRight.px,
            endPy: targetRect.bottomRight.py,
          }
        );
      };
      const updateActionState = () => {
        const rect = getCurrentRect();
        const hasCoords = !ignoreToggle.checked || Boolean(rect?.topLeft);
        createBtn.disabled = createBusy || previewRendering || !hasCoords || !rect;
        const disableProtectedControls = createBusy || !ignoreToggle.checked;
        protectedColorSelect.disabled = disableProtectedControls;
        addProtectedColorButton.disabled = disableProtectedControls;
        resetProtectedColorButton.disabled = disableProtectedControls;
        ignoreModeSelect.disabled = disableProtectedControls;
        protectedList.style.opacity = disableProtectedControls ? '0.55' : '1';
        const verticalDisabled = createBusy || getStripeOrientation() !== TEMPLATE_FLAG_ORIENTATION_VERTICAL;
        verticalOrderSelect.disabled = verticalDisabled;
        verticalOrderGroup.style.opacity = verticalDisabled ? '0.55' : '1';
      };
      const getPreviewViewportSize = () => {
        const width = Math.max(TEMPLATE_TEXT_PREVIEW_MIN_W, Math.floor(previewWrap.clientWidth || TEMPLATE_TEXT_PREVIEW_MIN_W));
        const height = Math.max(TEMPLATE_TEXT_PREVIEW_MIN_H, Math.floor(previewWrap.clientHeight || TEMPLATE_TEXT_PREVIEW_MIN_H));
        return { width, height };
      };
      const resizePreviewCanvas = () => {
        const { width, height } = getPreviewViewportSize();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const targetWidth = Math.floor(width * dpr);
        const targetHeight = Math.floor(height * dpr);
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
        imageData,
        zoomLevel = previewZoomValue,
        panX = previewPanX,
        panY = previewPanY
      ) => {
        const imageWidth = Math.max(1, Math.trunc(Number(imageData?.width) || 0));
        const imageHeight = Math.max(1, Math.trunc(Number(imageData?.height) || 0));
        if (imageWidth <= 0 || imageHeight <= 0) return null;
        const fitScale = Math.min(1, width / imageWidth, height / imageHeight);
        const safeFitScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
        const scale = safeFitScale * setPreviewZoom(zoomLevel);
        const drawWidth = imageWidth * scale;
        const drawHeight = imageHeight * scale;
        const maxPanX = Math.max(0, (drawWidth - width) / 2);
        const maxPanY = Math.max(0, (drawHeight - height) / 2);
        const clampedPanX = clampPreviewPan(panX, maxPanX);
        const clampedPanY = clampPreviewPan(panY, maxPanY);
        const baseX = (width - drawWidth) / 2;
        const baseY = (height - drawHeight) / 2;
        return {
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
        const safeZoom = setPreviewZoom(previewZoomValue);
        const canPan = Boolean(layout && (layout.maxPanX > 0.5 || layout.maxPanY > 0.5));
        const isReset = Math.abs(safeZoom - TEMPLATE_FLAG_PREVIEW_ZOOM_MIN) < 0.001
          && Math.abs(previewPanX) < 0.5
          && Math.abs(previewPanY) < 0.5;
        previewZoomValue = safeZoom;
        previewZoomValueLabel.textContent = formatPreviewZoomText(safeZoom);
        previewZoomOut.disabled = !previewHasImage || safeZoom <= TEMPLATE_FLAG_PREVIEW_ZOOM_MIN + 0.001;
        previewZoomIn.disabled = !previewHasImage || safeZoom >= TEMPLATE_FLAG_PREVIEW_ZOOM_MAX - 0.001;
        previewZoomReset.disabled = !previewHasImage || isReset;
        previewWrap.style.cursor = previewHasImage
          ? (dragState ? 'grabbing' : canPan ? 'grab' : 'zoom-in')
          : 'default';
      };
      const drawPreviewPlaceholder = (message = tt('dialog.common.preview', 'Preview')) => {
        previewHasImage = false;
        const { width, height, context } = resizePreviewCanvas();
        if (!context) return;
        context.fillStyle = 'rgba(0, 0, 0, 0.22)';
        context.fillRect(0, 0, width, height);
        context.fillStyle = 'rgba(255, 255, 255, 0.75)';
        context.font = '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(message, width / 2, height / 2);
        syncPreviewControls(null);
      };
      const resetPreviewView = () => {
        previewZoomValue = TEMPLATE_FLAG_PREVIEW_ZOOM_MIN;
        previewPanX = 0;
        previewPanY = 0;
      };
      const setPreviewZoomAroundPoint = (nextZoomLevel, originX = null, originY = null, imageData = null) => {
        const safeZoom = setPreviewZoom(nextZoomLevel);
        if (!previewHasImage || !imageData) {
          previewZoomValue = safeZoom;
          syncPreviewControls(null);
          return;
        }
        const { width, height } = getPreviewViewportSize();
        const currentLayout = computePreviewLayout(width, height, imageData, previewZoomValue, previewPanX, previewPanY);
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
          const nextLayout = computePreviewLayout(width, height, imageData, safeZoom, 0, 0);
          if (nextLayout) {
            nextPanX = originX - nextLayout.baseX - sourceX * nextLayout.scale;
            nextPanY = originY - nextLayout.baseY - sourceY * nextLayout.scale;
          }
        } else if (safeZoom <= TEMPLATE_FLAG_PREVIEW_ZOOM_MIN + 0.001) {
          nextPanX = 0;
          nextPanY = 0;
        }
        previewZoomValue = safeZoom;
        const nextLayout = computePreviewLayout(width, height, imageData, previewZoomValue, nextPanX, nextPanY);
        previewPanX = nextLayout?.panX || 0;
        previewPanY = nextLayout?.panY || 0;
      };
      const drawImageDataPreview = async (imageData, token) => {
        const { width, height, context } = resizePreviewCanvas();
        if (!context) return;
        const checker = 12;
        for (let y = 0; y < height; y += checker) {
          for (let x = 0; x < width; x += checker) {
            const odd = ((x / checker) + (y / checker)) % 2 === 0;
            context.fillStyle = odd ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.12)';
            context.fillRect(x, y, checker, checker);
          }
        }
        const bitmap = await createImageBitmap(imageData);
        if (closed || token !== previewRenderToken) {
          bitmap.close?.();
          return;
        }
        previewHasImage = true;
        const layout = computePreviewLayout(width, height, imageData, previewZoomValue, previewPanX, previewPanY);
        if (!layout) {
          bitmap.close?.();
          drawPreviewPlaceholder();
          return;
        }
        previewPanX = layout.panX;
        previewPanY = layout.panY;
        context.imageSmoothingEnabled = false;
        context.drawImage(bitmap, layout.drawX, layout.drawY, layout.drawWidth, layout.drawHeight);
        bitmap.close?.();
        syncPreviewControls(layout);
      };
      const queuePreviewViewportDraw = () => {
        if (previewViewportRedrawQueued || closed) return;
        previewViewportRedrawQueued = true;
        window.requestAnimationFrame(() => {
          previewViewportRedrawQueued = false;
          if (closed) return;
          if (lastRenderResult?.imageData) {
            void drawImageDataPreview(lastRenderResult.imageData, previewRenderToken);
          } else {
            drawPreviewPlaceholder(tt('dialog.common.previewUnavailable', 'Preview unavailable'));
          }
        });
      };
      const renderProtectedList = () => {
        const sortedKeys = [...protectedColorKeys]
          .filter((key) => templateTextPaletteMap.has(key))
          .sort((a, b) => resolveTemplatePaletteNameByKey(a).localeCompare(resolveTemplatePaletteNameByKey(b)));
        protectedList.innerHTML = '';
        if (!sortedKeys.length) {
          const empty = document.createElement('small');
          empty.style.opacity = '0.85';
          empty.textContent = tt('dialog.flag.noSelectedColors', 'No colors selected.');
          protectedList.appendChild(empty);
        } else {
          sortedKeys.forEach((key) => {
            const option = templateTextPaletteMap.get(key);
            if (!option) return;
            const item = document.createElement('button');
            item.type = 'button';
            item.title = tt('dialog.flag.removeSelectedColor', 'Remove from selected colors');
            item.style.display = 'inline-flex';
            item.style.alignItems = 'center';
            item.style.gap = '5px';
            item.style.border = '1px solid var(--bm-border-strong)';
            item.style.borderRadius = '999px';
            item.style.padding = '2px 7px';
            item.style.background = 'var(--bm-panel-bg)';
            item.style.color = 'var(--bm-fg)';
            item.style.cursor = 'pointer';
            const swatch = document.createElement('span');
            swatch.style.width = '10px';
            swatch.style.height = '10px';
            swatch.style.borderRadius = '50%';
            swatch.style.border = '1px solid rgba(0, 0, 0, 0.35)';
            swatch.style.background = rgbToCss(option.rgb);
            const label = document.createElement('span');
            label.textContent = option.name;
            const remove = document.createElement('span');
            remove.textContent = '✖';
            remove.style.fontSize = '10px';
            remove.style.opacity = '0.7';
            item.appendChild(swatch);
            item.appendChild(label);
            item.appendChild(remove);
            item.addEventListener('click', () => {
              protectedColorKeys.delete(key);
              renderProtectedList();
              queuePreviewRender();
            });
            protectedList.appendChild(item);
          });
        }
        updateActionState();
      };
      const renderPreview = async () => {
        if (closed) return null;
        const token = ++previewRenderToken;
        previewRendering = true;
        updateActionState();
        const style = getSelectedStyle();
        const stripeOrientation = getStripeOrientation();
        const verticalOrder = getVerticalOrder();
        const ignoreMode = getIgnoreMode();
        const stripeKeys = readStripeColorKeysFromInputs();
        const stripeWidthRatios = readStripeWeightsFromInputs();
        errorOutput.textContent = '';
        try {
          const rect = getCurrentRect();
          if (!rect?.topLeft) {
            throw new Error(tt('dialog.flag.invalidPoints', 'Start/end points are invalid.'));
          }
          const width = Math.max(1, Math.trunc(rect.width));
          const height = Math.max(1, Math.trunc(rect.height));
          if (width > TEMPLATE_FLAG_DIMENSION_MAX || height > TEMPLATE_FLAG_DIMENSION_MAX) {
            throw new Error(tt(
              'dialog.flag.sizeTooLarge',
              'Size from points is too large ({width}x{height}). Limit: {limit}px per side.',
              { width, height, limit: TEMPLATE_FLAG_DIMENSION_MAX }
            ));
          }
          if (!testCanvasSize(width, height)) {
            throw new Error(tt(
              'dialog.flag.canvasLimit',
              'Canvas limit exceeded for {width}x{height}.',
              { width, height }
            ));
          }
          let mapRegion = null;
          if (ignoreToggle.checked) {
            const cacheKey = `${rect.topLeft.tx},${rect.topLeft.ty},${rect.topLeft.px},${rect.topLeft.py},${width},${height}`;
            if (maskRegionCache.key === cacheKey && maskRegionCache.value) {
              mapRegion = maskRegionCache.value;
            } else {
              mapRegion = await loadLiveRegionImageDataForFlagMask({
                topLeftCoords: rect.topLeft,
                width,
                height,
              });
              if (closed || token !== previewRenderToken) return null;
              maskRegionCache = { key: cacheKey, value: mapRegion };
            }
          }
          const result = buildRussianFlagTemplateImageData({
            styleKey: style.key,
            width,
            height,
            stripeOrientation,
            verticalOrder,
            stripeColorKeys: stripeKeys,
            stripeWeights: stripeWidthRatios,
            ignoreArts: ignoreToggle.checked,
            ignoreMode,
            ignoreProtectedColorKeys: getProtectedColorKeys(),
            mapRegion,
          });
          if (closed || token !== previewRenderToken) return null;
          await drawImageDataPreview(result.imageData, token);
          if (closed || token !== previewRenderToken) return null;
          const totalPixels = Math.max(1, width * height);
          const ignoredRatio = ignoreToggle.checked
            ? `${((result.ignoredPixelCount / totalPixels) * 100).toFixed(1)}%`
            : '';
          const backgroundNames = result.backgroundEntries
            .slice(0, TEMPLATE_FLAG_IGNORE_BACKGROUND_COLOR_COUNT)
            .map(([key]) => resolveTemplatePaletteNameByKey(normalizeTemplatePaletteKey(key)))
            .filter(Boolean);
          const orientationLabel = getFlagOrientationLabel(result.orientation);
          const firstStripeName = resolveTemplatePaletteNameByKey(result.stripeColorKeys?.[0]) || tt('dialog.flag.firstColor', 'First color');
          const verticalOrderLabel = result.orientation === TEMPLATE_FLAG_ORIENTATION_VERTICAL
            ? tt(
                'dialog.flag.verticalOrderSuffix',
                ' ({color} {side})',
                {
                  color: firstStripeName,
                  side: result.verticalOrder === TEMPLATE_FLAG_VERTICAL_ORDER_FIRST_RIGHT
                    ? tt('dialog.flag.side.right', 'right')
                    : tt('dialog.flag.side.left', 'left'),
                }
              )
            : '';
          const styleLabel = getFlagStyleLabel(style);
          const zoomLabel = formatPreviewZoomText(getPreviewZoom());
          const stripeWidthsLabel = result.stripeWeights.join(':');
          const ignoreModeLabel = result.ignoreMode === TEMPLATE_FLAG_IGNORE_MODE_ONLY_SELECTED
            ? tt('dialog.flag.ignoreMode.onlySelected', 'Only selected colors')
            : tt('dialog.flag.ignoreMode.allExceptSelected', 'All art except selected');
          previewMeta.textContent = ignoreToggle.checked
            ? tt(
                'dialog.flag.preview.summaryIgnored',
                '{style} • {orientation}{verticalOrder} • {width}x{height}px • stripes {stripes} • {ignoreMode} • zoom {zoom} • ignored {ignored} px ({ratio}) • {coords}{background}',
                {
                  style: styleLabel,
                  orientation: orientationLabel,
                  verticalOrder: verticalOrderLabel,
                  width,
                  height,
                  stripes: stripeWidthsLabel,
                  ignoreMode: ignoreModeLabel,
                  zoom: zoomLabel,
                  ignored: result.ignoredPixelCount.toLocaleString(),
                  ratio: ignoredRatio,
                  coords: getMaskCoordsText(rect),
                  background: backgroundNames.length
                    ? tt('dialog.flag.backgroundSuffix', ' • background: {colors}', { colors: backgroundNames.join(', ') })
                    : '',
                }
              )
            : tt(
                'dialog.flag.preview.summary',
                '{style} • {orientation}{verticalOrder} • {width}x{height}px • stripes {stripes} • zoom {zoom} • {coords}',
                {
                  style: styleLabel,
                  orientation: orientationLabel,
                  verticalOrder: verticalOrderLabel,
                  width,
                  height,
                  stripes: stripeWidthsLabel,
                  zoom: zoomLabel,
                  coords: getMaskCoordsText(rect),
                }
              );
          lastRenderResult = {
            ...result,
            rect,
            styleKey: style.key,
            stripeOrientation: result.orientation,
            verticalOrder: result.verticalOrder,
            stripeColorKeys: result.stripeColorKeys,
            stripeWeights: result.stripeWeights,
            ignoreMode: result.ignoreMode,
            protectedColorKeys: getProtectedColorKeys(),
          };
          return lastRenderResult;
        } catch (error) {
          if (!closed && token === previewRenderToken) {
            lastRenderResult = null;
            errorOutput.textContent = error?.message || tt('dialog.flag.preview.failed', 'Failed to render flag preview.');
            drawPreviewPlaceholder(tt('dialog.common.previewUnavailable', 'Preview unavailable'));
            const { width, height } = readDimensions();
            previewMeta.textContent = tt(
              'dialog.flag.preview.fallback',
              '{style} • {width}x{height}px • zoom {zoom}',
              {
                style: getFlagStyleLabel(style),
                width,
                height,
                zoom: formatPreviewZoomText(getPreviewZoom()),
              }
            );
          }
          return null;
        } finally {
          if (!closed && token === previewRenderToken) {
            previewRendering = false;
            updateActionState();
          }
        }
      };
      const queuePreviewRender = () => {
        if (previewRenderTimer) {
          window.clearTimeout(previewRenderTimer);
        }
        previewRenderTimer = window.setTimeout(() => {
          previewRenderTimer = null;
          void renderPreview();
        }, 120);
      };
      const cleanupDragHandlers = () => {
        if (moveHandler) {
          window.removeEventListener('mousemove', moveHandler);
          moveHandler = null;
        }
        if (upHandler) {
          window.removeEventListener('mouseup', upHandler);
          upHandler = null;
        }
        dragState = null;
        syncPreviewControls(lastRenderResult ? computePreviewLayout(
          getPreviewViewportSize().width,
          getPreviewViewportSize().height,
          lastRenderResult.imageData,
          previewZoomValue,
          previewPanX,
          previewPanY
        ) : null);
      };
      const close = (result = null) => {
        if (closed) return;
        closed = true;
        if (previewRenderTimer) {
          window.clearTimeout(previewRenderTimer);
          previewRenderTimer = null;
        }
        previewRenderToken++;
        cleanupDragHandlers();
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }
        document.removeEventListener('bm-layout-theme-changed', handleThemeChanged);
        window.removeEventListener('resize', queuePreviewRender);
        window.removeEventListener('keydown', handleKeyDown, true);
        panel.remove();
        if (russianFlagTemplateBuilderSession?.panel === panel) {
          russianFlagTemplateBuilderSession = null;
        }
        resolve(result);
      };
      const applyTheme = () => {
        applyOverlayVarsToFloatingElement(panel);
      };
      const handleThemeChanged = () => {
        applyTheme();
        queuePreviewRender();
      };
      const handleKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close(null);
      };

      closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      });
      cancelBtn.addEventListener('click', () => close(null));

      addProtectedColorButton.addEventListener('click', () => {
        const key = normalizeTemplatePaletteKey(protectedColorSelect.value);
        if (!key || !templateTextPaletteMap.has(key)) return;
        protectedColorKeys.add(key);
        renderProtectedList();
        queuePreviewRender();
      });
      resetProtectedColorButton.addEventListener('click', () => {
        protectedColorKeys.clear();
        TEMPLATE_RUSSIAN_FLAG_DEFAULT_PROTECTED_KEYS.forEach((key) => {
          const normalized = normalizeTemplatePaletteKey(key);
          if (normalized && templateTextPaletteMap.has(normalized)) {
            protectedColorKeys.add(normalized);
          }
        });
        renderProtectedList();
        queuePreviewRender();
      });

      styleSelect.addEventListener('change', () => {
        stripeColorKeys = getFlagDefaultStripeColorKeys(styleSelect.value);
        syncStripeColorInputs();
        updateStripeControls();
        queuePreviewRender();
      });
      orientationSelect.addEventListener('change', () => {
        updateStripeControls();
        updateActionState();
        queuePreviewRender();
      });
      verticalOrderSelect.addEventListener('change', () => {
        updateStripeControls();
        queuePreviewRender();
      });
      ignoreModeSelect.addEventListener('change', () => {
        updateIgnoreModeLabels();
        updateActionState();
        queuePreviewRender();
      });
      previewZoomOut.addEventListener('click', () => {
        setPreviewZoomAroundPoint(previewZoomValue / 1.2, null, null, lastRenderResult?.imageData || null);
        queuePreviewViewportDraw();
      });
      previewZoomIn.addEventListener('click', () => {
        setPreviewZoomAroundPoint(previewZoomValue * 1.2, null, null, lastRenderResult?.imageData || null);
        queuePreviewViewportDraw();
      });
      previewZoomReset.addEventListener('click', () => {
        resetPreviewView();
        queuePreviewViewportDraw();
      });
      previewWrap.addEventListener('wheel', (event) => {
        if (!previewHasImage || !lastRenderResult?.imageData) return;
        event.preventDefault();
        const factor = event.shiftKey ? 1.35 : 1.15;
        const nextZoom = event.deltaY < 0
          ? previewZoomValue * factor
          : previewZoomValue / factor;
        const bounds = previewWrap.getBoundingClientRect();
        setPreviewZoomAroundPoint(
          nextZoom,
          event.clientX - bounds.left,
          event.clientY - bounds.top,
          lastRenderResult.imageData
        );
        queuePreviewViewportDraw();
      }, { passive: false });
      previewWrap.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || !previewHasImage || !lastRenderResult?.imageData) return;
        const { width, height } = getPreviewViewportSize();
        const layout = computePreviewLayout(width, height, lastRenderResult.imageData, previewZoomValue, previewPanX, previewPanY);
        if (!layout || (layout.maxPanX <= 0.5 && layout.maxPanY <= 0.5)) return;
        event.preventDefault();
        dragState = {
          startX: event.clientX,
          startY: event.clientY,
          panX: previewPanX,
          panY: previewPanY,
        };
        moveHandler = (moveEvent) => {
          if (!dragState) return;
          previewPanX = dragState.panX + (moveEvent.clientX - dragState.startX);
          previewPanY = dragState.panY + (moveEvent.clientY - dragState.startY);
          queuePreviewViewportDraw();
        };
        upHandler = () => {
          cleanupDragHandlers();
        };
        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
        syncPreviewControls(layout);
      });
      stripeColorInputs.forEach((entry, index) => {
        entry.select.addEventListener('change', () => {
          const selected = normalizeTemplatePaletteKey(entry.select.value);
          if (selected && templateTextPaletteMap.has(selected)) {
            stripeColorKeys[index] = selected;
          }
          syncStripeColorInputs();
          updateStripeControls();
          queuePreviewRender();
        });
      });
      stripeWeightInputs.forEach((entry, index) => {
        entry.input.addEventListener('input', () => {
          const nextWeights = stripeWeights.slice(0, 3);
          nextWeights[index] = entry.input.value;
          stripeWeights = normalizeFlagStripeWeights(nextWeights);
          syncStripeWeightInputs();
          queuePreviewRender();
        });
        entry.input.addEventListener('change', () => {
          const nextWeights = stripeWeights.slice(0, 3);
          nextWeights[index] = entry.input.value;
          stripeWeights = normalizeFlagStripeWeights(nextWeights);
          syncStripeWeightInputs();
          queuePreviewRender();
        });
      });
      widthInput.addEventListener('input', () => {
        syncEndFromStartAndSize();
        queuePreviewRender();
      });
      widthInput.addEventListener('change', () => {
        syncEndFromStartAndSize();
        queuePreviewRender();
      });
      heightInput.addEventListener('input', () => {
        syncEndFromStartAndSize();
        queuePreviewRender();
      });
      heightInput.addEventListener('change', () => {
        syncEndFromStartAndSize();
        queuePreviewRender();
      });
      [startRowInputs, endRowInputs].forEach((inputs) => {
        [inputs.txInput, inputs.tyInput, inputs.pxInput, inputs.pyInput].forEach((input) => {
          input.addEventListener('paste', (event) => {
            applyPastedCoordsToRow(event, inputs);
          });
          input.addEventListener('input', () => {
            syncRectFromPoints({ canonicalize: true });
            queuePreviewRender();
          });
          input.addEventListener('change', () => {
            syncRectFromPoints({ canonicalize: true });
            queuePreviewRender();
          });
        });
      });
      ignoreToggle.addEventListener('change', () => {
        updateActionState();
        queuePreviewRender();
      });

      createBtn.addEventListener('click', async () => {
        if (createBusy) return;
        createBusy = true;
        updateActionState();
        errorOutput.textContent = '';
        try {
          const rendered = await renderPreview();
          if (!rendered) {
            throw new Error(tt('dialog.flag.create.prepareFailed', 'Could not prepare flag template image.'));
          }
          let exportCanvas = new OffscreenCanvas(rendered.width, rendered.height);
          const exportContext = exportCanvas.getContext('2d');
          if (!exportContext) {
            cleanUpCanvas(exportCanvas);
            exportCanvas = null;
            throw new Error(tt('dialog.flag.create.exportCanvasFailed', 'Could not initialize export canvas.'));
          }
          exportContext.putImageData(rendered.imageData, 0, 0);
          const blob = await exportCanvas.convertToBlob({ type: 'image/png' });
          cleanUpCanvas(exportCanvas);
          exportCanvas = null;
          const fileName = `russian_flag_${rendered.style.key}_${rendered.width}x${rendered.height}.png`;
          const file = new File([blob], fileName, { type: 'image/png' });
          close({
            file,
            templateName: buildRussianFlagTemplateName({
              styleKey: rendered.style.key,
              width: rendered.width,
              height: rendered.height,
              stripeOrientation: rendered.orientation,
            }),
            styleKey: rendered.style.key,
            stripeOrientation: rendered.orientation,
            verticalOrder: rendered.verticalOrder,
            stripeColorKeys: rendered.stripeColorKeys || [],
            stripeWeights: rendered.stripeWeights || [],
            ignoreMode: rendered.ignoreMode,
            width: rendered.width,
            height: rendered.height,
            ignoreArts: Boolean(ignoreToggle.checked),
            ignoredPixelCount: Number(rendered.ignoredPixelCount) || 0,
            protectedColorKeys: rendered.protectedColorKeys || [],
            createCoords: rendered.rect?.topLeft
              ? [
                  rendered.rect.topLeft.tx,
                  rendered.rect.topLeft.ty,
                  rendered.rect.topLeft.px,
                  rendered.rect.topLeft.py,
                ]
              : null,
          });
        } catch (error) {
          errorOutput.textContent = error?.message || tt('dialog.flag.create.failed', 'Failed to create flag template.');
        } finally {
          if (!closed) {
            createBusy = false;
            updateActionState();
          }
        }
      });

      head.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        const rect = panel.getBoundingClientRect();
        dragState = {
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
        };
        moveHandler = (moveEvent) => {
          if (!dragState) return;
          const currentRect = panel.getBoundingClientRect();
          const maxLeft = Math.max(8, window.innerWidth - currentRect.width - 8);
          const maxTop = Math.max(8, window.innerHeight - currentRect.height - 8);
          const left = Math.min(maxLeft, Math.max(8, moveEvent.clientX - dragState.offsetX));
          const top = Math.min(maxTop, Math.max(8, moveEvent.clientY - dragState.offsetY));
          panel.style.left = `${left}px`;
          panel.style.top = `${top}px`;
          panel.style.right = 'auto';
          panel.style.bottom = 'auto';
        };
        upHandler = () => {
          cleanupDragHandlers();
        };
        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
        event.preventDefault();
      });

      document.body.appendChild(panel);
      russianFlagTemplateBuilderSession = { panel, close };
      applyTheme();
      document.addEventListener('bm-layout-theme-changed', handleThemeChanged);
      window.addEventListener('resize', queuePreviewRender);
      window.addEventListener('keydown', handleKeyDown, true);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => queuePreviewRender());
        resizeObserver.observe(previewWrap);
      }
      resetPreviewView();
      syncStripeColorInputs();
      syncStripeWeightInputs();
      updateStripeControls();
      updateIgnoreModeLabels();
      renderProtectedList();
      syncRectFromPoints({ canonicalize: true });
      updateActionState();
      drawPreviewPlaceholder(tt('dialog.common.loadingPreview', 'Loading preview...'));
      queuePreviewRender();
    });
  };

  /**
   * Opens the text template builder window and resolves with the generated template image blob
   * plus the preview placement metadata selected by the user.
   *
   * @param {object} options Initial builder state.
   * @returns {Promise<object|null>}
   */
  const openTextTemplateBuilder = (options = {}) => {
    ensureTemplateTextWebFontsLoaded();
    if (russianFlagTemplateBuilderSession?.close) {
      russianFlagTemplateBuilderSession.close(null);
    }
    if (remoteTemplateBuilderSession?.close) {
      remoteTemplateBuilderSession.close(null);
    }
    if (textTemplateBuilderSession?.close) {
      textTemplateBuilderSession.close(null);
    }

    const initialText = String(options?.initialText ?? '').slice(0, TEMPLATE_TEXT_MAX_CHARS);
    const initialFontSize = clampNumber(
      options?.initialFontSize,
      TEMPLATE_TEXT_FONT_SIZE_MIN,
      TEMPLATE_TEXT_FONT_SIZE_MAX,
      TEMPLATE_TEXT_FONT_SIZE
    );
    const initialFontKeyOption = String(options?.initialFontKey || '').trim();
    const initialFontKey = templateTextFontMap.has(initialFontKeyOption)
      ? initialFontKeyOption
      : TEMPLATE_TEXT_FONT_DEFAULT_KEY;
    const initialColorRgb = resolveTemplateTextColor(options);
    const initialColorKeyOption = String(options?.initialColorKey || '').trim();
    const initialColorKey = (() => {
      if (templateTextPaletteMap.has(initialColorKeyOption)) return initialColorKeyOption;
      const fromRgb = rgbToKey(initialColorRgb);
      if (templateTextPaletteMap.has(fromRgb)) return fromRgb;
      return templateTextPaletteOptions[0]?.key ?? '0,0,0';
    })();
    const previewTileX = normalizePreviewTileX(options?.previewTileX);
    const previewTileY = normalizePreviewTileY(options?.previewTileY);
    const previewPixelX = normalizePreviewTilePixel(options?.previewPixelX);
    const previewPixelY = normalizePreviewTilePixel(options?.previewPixelY);
    const initialPreviewZoom = (() => {
      const numeric = Number(options?.previewZoom);
      if (!Number.isFinite(numeric)) return TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT;
      return Math.max(TEMPLATE_TEXT_PREVIEW_ZOOM_MIN, numeric);
    })();

    return new Promise((resolve) => {
      const panel = document.createElement('section');
      panel.id = 'bm-text-template-window';
      panel.className = 'bm-text-template-window';
      panel.style.width = `${TEMPLATE_TEXT_WINDOW_DEFAULT_W}px`;
      panel.style.height = `${TEMPLATE_TEXT_WINDOW_DEFAULT_H}px`;
      panel.style.minWidth = `${TEMPLATE_TEXT_WINDOW_MIN_W}px`;
      panel.style.minHeight = `${TEMPLATE_TEXT_WINDOW_MIN_H}px`;
      panel.style.right = '20px';
      panel.style.bottom = '20px';

      const head = document.createElement('div');
      head.className = 'bm-text-template-window-head';
      head.title = tt('dialog.common.dragToMove', 'Drag to move');
      const title = document.createElement('span');
      title.className = 'bm-text-template-window-title';
      title.textContent = tt('dialog.text.title', 'Text Template');
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'bm-text-template-window-close';
      closeBtn.textContent = '✖';
      closeBtn.title = tt('dialog.common.close', 'Close');
      head.appendChild(title);
      head.appendChild(closeBtn);
      panel.appendChild(head);

      const body = document.createElement('div');
      body.className = 'bm-text-template-window-body';

      const textLabel = document.createElement('label');
      textLabel.className = 'bm-text-template-window-label';
      textLabel.textContent = tt('dialog.text.label', 'Text (max {max})', { max: TEMPLATE_TEXT_MAX_CHARS });
      body.appendChild(textLabel);

      const textInput = document.createElement('textarea');
      textInput.className = 'bm-text-template-window-input';
      textInput.maxLength = TEMPLATE_TEXT_MAX_CHARS;
      textInput.placeholder = tt('dialog.text.placeholder', 'Enter template text...');
      textInput.value = initialText;
      body.appendChild(textInput);

      const controlRow = document.createElement('div');
      controlRow.className = 'bm-text-template-window-controls';

      const colorGroup = document.createElement('div');
      colorGroup.className = 'bm-text-template-window-control';
      const colorLabel = document.createElement('label');
      colorLabel.className = 'bm-text-template-window-label';
      colorLabel.textContent = tt('dialog.text.color', 'Color');
      const colorSelect = document.createElement('select');
      colorSelect.className = 'bm-text-template-window-select';
      templateTextPaletteOptions.forEach((option) => {
        const optionElement = document.createElement('option');
        optionElement.value = option.key;
        optionElement.textContent = option.name;
        colorSelect.appendChild(optionElement);
      });
      colorSelect.value = initialColorKey;
      if (!colorSelect.value) {
        colorSelect.value = templateTextPaletteOptions[0]?.key ?? '0,0,0';
      }
      const colorSwatch = document.createElement('span');
      colorSwatch.className = 'bm-text-template-window-swatch';
      colorGroup.appendChild(colorLabel);
      colorGroup.appendChild(colorSelect);
      colorGroup.appendChild(colorSwatch);
      controlRow.appendChild(colorGroup);

      const fontFamilyGroup = document.createElement('div');
      fontFamilyGroup.className = 'bm-text-template-window-control';
      const fontFamilyLabel = document.createElement('label');
      fontFamilyLabel.className = 'bm-text-template-window-label';
      fontFamilyLabel.textContent = tt('dialog.text.font', 'Font');
      const fontFamilySelect = document.createElement('select');
      fontFamilySelect.className = 'bm-text-template-window-select';
      templateTextFontOptions.forEach((option) => {
        const optionElement = document.createElement('option');
        optionElement.value = option.key;
        optionElement.textContent = option.name;
        fontFamilySelect.appendChild(optionElement);
      });
      fontFamilySelect.value = initialFontKey;
      if (!fontFamilySelect.value) {
        fontFamilySelect.value = TEMPLATE_TEXT_FONT_DEFAULT_KEY;
      }
      fontFamilyGroup.appendChild(fontFamilyLabel);
      fontFamilyGroup.appendChild(fontFamilySelect);
      controlRow.appendChild(fontFamilyGroup);

      const fontGroup = document.createElement('div');
      fontGroup.className = 'bm-text-template-window-control';
      const fontLabel = document.createElement('label');
      fontLabel.className = 'bm-text-template-window-label';
      fontLabel.textContent = tt('dialog.text.fontSize', 'Font Size');
      const fontSizeNumber = document.createElement('input');
      fontSizeNumber.className = 'bm-text-template-window-number';
      fontSizeNumber.type = 'number';
      fontSizeNumber.min = String(TEMPLATE_TEXT_FONT_SIZE_MIN);
      fontSizeNumber.max = String(TEMPLATE_TEXT_FONT_SIZE_MAX);
      fontSizeNumber.step = '1';
      fontSizeNumber.value = String(initialFontSize);
      const fontSizeRange = document.createElement('input');
      fontSizeRange.className = 'bm-text-template-window-range';
      fontSizeRange.type = 'range';
      fontSizeRange.min = String(TEMPLATE_TEXT_FONT_SIZE_MIN);
      fontSizeRange.max = String(TEMPLATE_TEXT_FONT_SIZE_MAX);
      fontSizeRange.step = '1';
      fontSizeRange.value = String(initialFontSize);
      fontGroup.appendChild(fontLabel);
      fontGroup.appendChild(fontSizeNumber);
      fontGroup.appendChild(fontSizeRange);
      controlRow.appendChild(fontGroup);

      const positionGroup = document.createElement('div');
      positionGroup.className = 'bm-text-template-window-control';
      const positionLabel = document.createElement('label');
      positionLabel.className = 'bm-text-template-window-label';
      positionLabel.textContent = tt('dialog.text.position', 'Position (Px)');
      const positionRow = document.createElement('div');
      positionRow.className = 'bm-text-template-window-pair';
      const positionXInput = document.createElement('input');
      positionXInput.className = 'bm-text-template-window-number';
      positionXInput.type = 'number';
      positionXInput.min = '0';
      positionXInput.max = String(TEMPLATE_TILE_SIZE - 1);
      positionXInput.step = '1';
      positionXInput.placeholder = tt('dialog.text.positionXPlaceholder', 'Px X');
      positionXInput.value = String(previewPixelX);
      positionXInput.title = tt('dialog.text.positionXTitle', 'Pixel X in tile');
      const positionYInput = document.createElement('input');
      positionYInput.className = 'bm-text-template-window-number';
      positionYInput.type = 'number';
      positionYInput.min = '0';
      positionYInput.max = String(TEMPLATE_TILE_SIZE - 1);
      positionYInput.step = '1';
      positionYInput.placeholder = tt('dialog.text.positionYPlaceholder', 'Px Y');
      positionYInput.value = String(previewPixelY);
      positionYInput.title = tt('dialog.text.positionYTitle', 'Pixel Y in tile');
      positionRow.appendChild(positionXInput);
      positionRow.appendChild(positionYInput);
      positionGroup.appendChild(positionLabel);
      positionGroup.appendChild(positionRow);
      controlRow.appendChild(positionGroup);

      body.appendChild(controlRow);

      const previewMeta = document.createElement('div');
      previewMeta.className = 'bm-text-template-window-meta';
      previewMeta.textContent = tt('dialog.text.enterPreview', 'Enter text to preview.');
      body.appendChild(previewMeta);

      const previewWrap = document.createElement('div');
      previewWrap.className = 'bm-text-template-window-preview';
      const previewCanvas = document.createElement('canvas');
      previewCanvas.className = 'bm-text-template-window-canvas';
      previewWrap.appendChild(previewCanvas);
      body.appendChild(previewWrap);

      const errorOutput = document.createElement('div');
      errorOutput.className = 'bm-text-template-window-error';
      body.appendChild(errorOutput);

      const actions = document.createElement('div');
      actions.className = 'bm-text-template-window-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = tt('dialog.common.cancel', 'Cancel');
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.textContent = tt('dialog.common.createTemplate', 'Create Template');
      createBtn.disabled = true;
      actions.appendChild(cancelBtn);
      actions.appendChild(createBtn);
      body.appendChild(actions);

      panel.appendChild(body);

      let closed = false;
      let dragState = null;
      let moveHandler = null;
      let upHandler = null;
      let resizeObserver = null;
      let renderToken = 0;
      let renderQueued = false;

      const getSelectedColor = () => {
        const key = colorSelect.value;
        const option = templateTextPaletteMap.get(key);
        if (option) return option.rgb.slice();
        return templateTextPaletteOptions[0]?.rgb?.slice() ?? [0, 0, 0];
      };
      const getSelectedFontKey = () => {
        const key = String(fontFamilySelect.value || '').trim();
        if (templateTextFontMap.has(key)) return key;
        return TEMPLATE_TEXT_FONT_DEFAULT_KEY;
      };
      const getSelectedFontSize = () => clampNumber(
        fontSizeNumber.value,
        TEMPLATE_TEXT_FONT_SIZE_MIN,
        TEMPLATE_TEXT_FONT_SIZE_MAX,
        TEMPLATE_TEXT_FONT_SIZE
      );

      const syncColorSwatch = () => {
        const color = getSelectedColor();
        colorSwatch.style.backgroundColor = rgbToCss(color);
        const optionName = templateTextPaletteMap.get(colorSelect.value)?.name;
        colorSwatch.title = optionName ? `${optionName} (${color.join(', ')})` : color.join(', ');
      };

      const syncFontInputs = (value) => {
        const safeValue = clampNumber(
          value,
          TEMPLATE_TEXT_FONT_SIZE_MIN,
          TEMPLATE_TEXT_FONT_SIZE_MAX,
          TEMPLATE_TEXT_FONT_SIZE
        );
        fontSizeNumber.value = String(safeValue);
        fontSizeRange.value = String(safeValue);
        return safeValue;
      };
      let previewZoomValue = initialPreviewZoom;
      const setPreviewZoom = (value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
          previewZoomValue = TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT;
          return previewZoomValue;
        }
        previewZoomValue = Math.max(TEMPLATE_TEXT_PREVIEW_ZOOM_MIN, numericValue);
        return previewZoomValue;
      };
      const getPreviewZoom = () => previewZoomValue;
      const syncPreviewPositionInputs = () => {
        const x = normalizePreviewTilePixel(positionXInput.value);
        const y = normalizePreviewTilePixel(positionYInput.value);
        positionXInput.value = String(x);
        positionYInput.value = String(y);
        return { x, y };
      };
      const getPreviewPosition = () => syncPreviewPositionInputs();
      const getPreviewSummary = () => {
        const { x, y } = getPreviewPosition();
        const zoom = getPreviewZoom();
        return tt(
          'dialog.text.previewSummary',
          'Tile {tileX}, {tileY} • Px {px}, {py} • Zoom {zoom}x',
          {
            tileX: previewTileX,
            tileY: previewTileY,
            px: x,
            py: y,
            zoom: zoom.toFixed(1),
          }
        );
      };

      const resizePreviewCanvas = () => {
        const width = Math.max(TEMPLATE_TEXT_PREVIEW_MIN_W, Math.floor(previewWrap.clientWidth || TEMPLATE_TEXT_PREVIEW_MIN_W));
        const height = Math.max(TEMPLATE_TEXT_PREVIEW_MIN_H, Math.floor(previewWrap.clientHeight || TEMPLATE_TEXT_PREVIEW_MIN_H));
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const targetWidth = Math.floor(width * dpr);
        const targetHeight = Math.floor(height * dpr);
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

      const drawPreviewPlaceholder = () => {
        const { width, height, context } = resizePreviewCanvas();
        if (!context) return;
        context.fillStyle = 'rgba(0, 0, 0, 0.25)';
        context.font = '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(tt('dialog.common.preview', 'Preview'), width / 2, height / 2);
      };
      const computePreviewCropBounds = (previewData, textTileX, textTileY, zoomValue) => {
        const textTileW = Math.max(1, previewData.width);
        const textTileH = Math.max(1, previewData.height);
        const margin = Math.max(20, Math.min(220, Math.round(Math.max(textTileW, textTileH) * 0.75)));
        const baseLeft = textTileX - margin;
        const baseTop = textTileY - margin;
        const baseRight = textTileX + textTileW + margin;
        const baseBottom = textTileY + textTileH + margin;
        const baseWidth = Math.max(1, baseRight - baseLeft);
        const baseHeight = Math.max(1, baseBottom - baseTop);
        const zoom = Number.isFinite(Number(zoomValue)) && Number(zoomValue) > TEMPLATE_TEXT_PREVIEW_ZOOM_MIN
          ? Number(zoomValue)
          : TEMPLATE_TEXT_PREVIEW_ZOOM_DEFAULT;
        const cropWidth = Math.max(textTileW, Math.round(baseWidth / zoom));
        const cropHeight = Math.max(textTileH, Math.round(baseHeight / zoom));
        const centerX = textTileX + textTileW / 2;
        const centerY = textTileY + textTileH / 2;
        const cropLeft = Math.round(centerX - cropWidth / 2);
        const cropTop = Math.round(centerY - cropHeight / 2);
        return { cropLeft, cropTop, cropWidth, cropHeight };
      };
      const getPreviewTileOffsetRange = (cropLeft, cropTop, cropWidth, cropHeight) => {
        const cropRight = cropLeft + cropWidth;
        const cropBottom = cropTop + cropHeight;
        return {
          dxMin: Math.floor(cropLeft / TEMPLATE_TILE_SIZE),
          dxMax: Math.floor((cropRight - 1) / TEMPLATE_TILE_SIZE),
          dyMin: Math.floor(cropTop / TEMPLATE_TILE_SIZE),
          dyMax: Math.floor((cropBottom - 1) / TEMPLATE_TILE_SIZE),
        };
      };
      const drawPreviewTileRegion = (context, width, height, tileSet, previewData, textTileX, textTileY, zoomValue) => {
        const { cropLeft, cropTop, cropWidth, cropHeight } = computePreviewCropBounds(
          previewData,
          textTileX,
          textTileY,
          zoomValue
        );

        const frameX = 0;
        const frameY = 0;
        const frameWidth = Math.max(1, width);
        const frameHeight = Math.max(1, height);
        const scale = Math.max(frameWidth / cropWidth, frameHeight / cropHeight);
        const renderedWidth = cropWidth * scale;
        const renderedHeight = cropHeight * scale;
        const renderX = frameX + (frameWidth - renderedWidth) / 2;
        const renderY = frameY + (frameHeight - renderedHeight) / 2;

        context.clearRect(0, 0, width, height);
        context.fillStyle = 'rgba(0, 0, 0, 0.26)';
        context.fillRect(frameX, frameY, frameWidth, frameHeight);
        context.imageSmoothingEnabled = false;

        const cropRight = cropLeft + cropWidth;
        const cropBottom = cropTop + cropHeight;
        const tileRange = getPreviewTileOffsetRange(cropLeft, cropTop, cropWidth, cropHeight);
        context.save();
        context.beginPath();
        context.rect(frameX, frameY, frameWidth, frameHeight);
        context.clip();
        for (let dy = tileRange.dyMin; dy <= tileRange.dyMax; dy++) {
          for (let dx = tileRange.dxMin; dx <= tileRange.dxMax; dx++) {
            const tileImage = tileSet.get(`${dx},${dy}`);
            if (!tileImage) continue;
            const tileLeft = dx * TEMPLATE_TILE_SIZE;
            const tileTop = dy * TEMPLATE_TILE_SIZE;
            const intersectLeft = Math.max(cropLeft, tileLeft);
            const intersectTop = Math.max(cropTop, tileTop);
            const intersectRight = Math.min(cropRight, tileLeft + TEMPLATE_TILE_SIZE);
            const intersectBottom = Math.min(cropBottom, tileTop + TEMPLATE_TILE_SIZE);
            const intersectWidth = intersectRight - intersectLeft;
            const intersectHeight = intersectBottom - intersectTop;
            if (intersectWidth <= 0 || intersectHeight <= 0) continue;
            const srcX = intersectLeft - tileLeft;
            const srcY = intersectTop - tileTop;
            const dstX = renderX + (intersectLeft - cropLeft) * scale;
            const dstY = renderY + (intersectTop - cropTop) * scale;
            const dstW = Math.max(1, intersectWidth * scale);
            const dstH = Math.max(1, intersectHeight * scale);
            context.drawImage(tileImage, srcX, srcY, intersectWidth, intersectHeight, dstX, dstY, dstW, dstH);
          }
        }
        context.restore();
        return {
          clipX: frameX,
          clipY: frameY,
          clipWidth: frameWidth,
          clipHeight: frameHeight,
          renderX,
          renderY,
          scale,
          cropLeft,
          cropTop,
          cropWidth,
          cropHeight,
        };
      };

      const renderPreview = async () => {
        if (closed) return;
        const token = ++renderToken;
        const text = textInput.value;
        if (!text.trim()) {
          errorOutput.textContent = '';
          previewMeta.textContent = `${getPreviewSummary()} • ${tt('dialog.text.enterPreview', 'Enter text to preview.')}`;
          createBtn.disabled = true;
          drawPreviewPlaceholder();
          return;
        }

        const selectedColor = getSelectedColor();
        const selectedFontSize = getSelectedFontSize();
        let previewData = null;
        try {
          previewData = await createTextTemplateBlob(text, {
            colorRgb: selectedColor,
            fontSize: selectedFontSize,
            fontKey: getSelectedFontKey(),
          });
        } catch (error) {
          if (closed || token !== renderToken) return;
          previewMeta.textContent = `${getPreviewSummary()} • ${tt('dialog.common.previewUnavailable', 'Preview unavailable.')}`;
          errorOutput.textContent = error?.message || tt('dialog.text.previewFailed', 'Failed to render preview.');
          createBtn.disabled = true;
          drawPreviewPlaceholder();
          return;
        }
        if (closed || token !== renderToken) return;

        const { x: currentPreviewPixelX, y: currentPreviewPixelY } = getPreviewPosition();
        const currentPreviewZoom = getPreviewZoom();
        errorOutput.textContent = '';
        createBtn.disabled = false;

        const previewCrop = computePreviewCropBounds(
          previewData,
          currentPreviewPixelX,
          currentPreviewPixelY,
          currentPreviewZoom
        );
        const tileRange = getPreviewTileOffsetRange(
          previewCrop.cropLeft,
          previewCrop.cropTop,
          previewCrop.cropWidth,
          previewCrop.cropHeight
        );
        const requiredTileCount =
          (tileRange.dxMax - tileRange.dxMin + 1) *
          (tileRange.dyMax - tileRange.dyMin + 1);
        const tileSet = new Map();
        let tileUnavailable = false;
        let tilePreviewLimited = false;
        if (requiredTileCount > TEMPLATE_TEXT_PREVIEW_MAX_TILE_REQUESTS) {
          tilePreviewLimited = true;
          try {
            const centerImage = await loadPreviewTileImage(previewTileX, previewTileY);
            if (centerImage) {
              tileSet.set('0,0', centerImage);
            } else {
              tileUnavailable = true;
            }
          } catch (_) {
            tileUnavailable = true;
          }
        } else {
          const tileLoadTasks = [];
          for (let dy = tileRange.dyMin; dy <= tileRange.dyMax; dy++) {
            for (let dx = tileRange.dxMin; dx <= tileRange.dxMax; dx++) {
              tileLoadTasks.push((async () => {
                try {
                  const image = await loadPreviewTileImage(previewTileX + dx, previewTileY + dy);
                  return { dx, dy, image };
                } catch (_) {
                  return { dx, dy, image: null };
                }
              })());
            }
          }
          const tileResults = await Promise.all(tileLoadTasks);
          tileResults.forEach(({ dx, dy, image }) => {
            tileSet.set(`${dx},${dy}`, image || null);
            if (!image) {
              tileUnavailable = true;
            }
          });
        }
        if (closed || token !== renderToken) return;
        previewMeta.textContent = tt(
          'dialog.text.resultSummary',
          '{summary} • Result: {width} x {height}px{suffix}',
          {
            summary: getPreviewSummary(),
            width: previewData.width,
            height: previewData.height,
            suffix: tilePreviewLimited
              ? ` • ${tt('dialog.text.tilePreviewLimited', 'Tile preview limited')}`
              : tileUnavailable
                ? ` • ${tt('dialog.text.tilePreviewUnavailable', 'Tile preview unavailable')}`
                : '',
          }
        );

        const { width, height, context } = resizePreviewCanvas();
        if (!context) return;
        const bitmap = await createImageBitmap(previewData.blob);
        if (closed || token !== renderToken) {
          bitmap.close();
          return;
        }
        const region = drawPreviewTileRegion(
          context,
          width,
          height,
          tileSet,
          previewData,
          currentPreviewPixelX,
          currentPreviewPixelY,
          currentPreviewZoom
        );
        const textDrawX = region.renderX + (currentPreviewPixelX - region.cropLeft) * region.scale;
        const textDrawY = region.renderY + (currentPreviewPixelY - region.cropTop) * region.scale;
        const textDrawW = Math.max(1, Math.round(previewData.width * region.scale));
        const textDrawH = Math.max(1, Math.round(previewData.height * region.scale));
        context.save();
        context.beginPath();
        context.rect(region.clipX, region.clipY, region.clipWidth, region.clipHeight);
        context.clip();
        context.imageSmoothingEnabled = false;
        context.drawImage(bitmap, textDrawX, textDrawY, textDrawW, textDrawH);
        context.restore();
        bitmap.close();
      };

      const queuePreviewRender = () => {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
          renderQueued = false;
          void renderPreview();
        });
      };

      const applyTheme = () => {
        applyOverlayVarsToFloatingElement(panel);
      };
      const handleThemeChanged = () => {
        applyTheme();
        queuePreviewRender();
      };

      const cleanupDragHandlers = () => {
        if (moveHandler) {
          window.removeEventListener('mousemove', moveHandler);
          moveHandler = null;
        }
        if (upHandler) {
          window.removeEventListener('mouseup', upHandler);
          upHandler = null;
        }
        dragState = null;
      };

      const close = (result = null) => {
        if (closed) return;
        closed = true;
        renderToken++;
        cleanupDragHandlers();
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }
        document.removeEventListener('bm-layout-theme-changed', handleThemeChanged);
        window.removeEventListener('resize', queuePreviewRender);
        window.removeEventListener('keydown', handleKeyDown, true);
        panel.remove();
        if (textTemplateBuilderSession?.panel === panel) {
          textTemplateBuilderSession = null;
        }
        resolve(result);
      };

      const handleKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close(null);
      };

      closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      });
      cancelBtn.addEventListener('click', () => close(null));

      createBtn.addEventListener('click', async () => {
        createBtn.disabled = true;
        errorOutput.textContent = '';
        try {
          const { x: resultPreviewPixelX, y: resultPreviewPixelY } = getPreviewPosition();
          const resultPreviewZoom = getPreviewZoom();
          const result = await createTextTemplateBlob(textInput.value, {
            colorRgb: getSelectedColor(),
            fontSize: getSelectedFontSize(),
            fontKey: getSelectedFontKey(),
          });
          close({
            ...result,
            previewTileX,
            previewTileY,
            previewPixelX: resultPreviewPixelX,
            previewPixelY: resultPreviewPixelY,
            previewZoom: resultPreviewZoom,
          });
        } catch (error) {
          errorOutput.textContent = error?.message || tt('dialog.text.createFailed', 'Failed to create text template.');
          queuePreviewRender();
        }
      });

      textInput.addEventListener('input', queuePreviewRender);
      textInput.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          if (!createBtn.disabled) {
            createBtn.click();
          }
        }
      });
      colorSelect.addEventListener('change', () => {
        syncColorSwatch();
        queuePreviewRender();
      });
      fontFamilySelect.addEventListener('change', () => {
        queuePreviewRender();
      });
      fontSizeNumber.addEventListener('input', () => {
        syncFontInputs(fontSizeNumber.value);
        queuePreviewRender();
      });
      fontSizeNumber.addEventListener('change', () => {
        syncFontInputs(fontSizeNumber.value);
        queuePreviewRender();
      });
      fontSizeRange.addEventListener('input', () => {
        syncFontInputs(fontSizeRange.value);
        queuePreviewRender();
      });
      previewWrap.addEventListener('wheel', (event) => {
        event.preventDefault();
        const factor = event.shiftKey ? 1.35 : 1.15;
        const nextZoom = event.deltaY < 0
          ? getPreviewZoom() * factor
          : getPreviewZoom() / factor;
        setPreviewZoom(nextZoom);
        queuePreviewRender();
      }, { passive: false });
      positionXInput.addEventListener('input', () => {
        syncPreviewPositionInputs();
        queuePreviewRender();
      });
      positionXInput.addEventListener('change', () => {
        syncPreviewPositionInputs();
        queuePreviewRender();
      });
      positionYInput.addEventListener('input', () => {
        syncPreviewPositionInputs();
        queuePreviewRender();
      });
      positionYInput.addEventListener('change', () => {
        syncPreviewPositionInputs();
        queuePreviewRender();
      });

      head.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        const rect = panel.getBoundingClientRect();
        dragState = {
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top
        };
        moveHandler = (moveEvent) => {
          if (!dragState) return;
          const currentRect = panel.getBoundingClientRect();
          const maxLeft = Math.max(8, window.innerWidth - currentRect.width - 8);
          const maxTop = Math.max(8, window.innerHeight - currentRect.height - 8);
          const left = Math.min(maxLeft, Math.max(8, moveEvent.clientX - dragState.offsetX));
          const top = Math.min(maxTop, Math.max(8, moveEvent.clientY - dragState.offsetY));
          panel.style.left = `${left}px`;
          panel.style.top = `${top}px`;
          panel.style.right = 'auto';
          panel.style.bottom = 'auto';
        };
        upHandler = () => {
          cleanupDragHandlers();
        };
        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
        event.preventDefault();
      });

      document.body.appendChild(panel);
      textTemplateBuilderSession = { panel, close };
      applyTheme();
      document.addEventListener('bm-layout-theme-changed', handleThemeChanged);
      window.addEventListener('resize', queuePreviewRender);
      window.addEventListener('keydown', handleKeyDown, true);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => queuePreviewRender());
        resizeObserver.observe(previewWrap);
      }

      syncColorSwatch();
      syncFontInputs(initialFontSize);
      setPreviewZoom(initialPreviewZoom);
      syncPreviewPositionInputs();
      queuePreviewRender();
      textInput.focus();
      textInput.select();
    });
  };

  return {
    openTemplatePaletteConversionPreview,
    openRemoteTemplateBuilder,
    openRussianFlagTemplateBuilder,
    openTextTemplateBuilder,
  };
};

export default createTemplateCreationUi;
