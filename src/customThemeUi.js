/** @file The custom layout theme editor window.
 * @since 0.87.76
 */

import { makePanelDraggable, registerFloatingPanel } from './utils.js';
import {
  CUSTOM_THEME_GROUPS,
  CUSTOM_THEME_TOKENS,
  buildCustomThemeCssVars,
  customThemeColorToCss,
  decodeCustomThemeCode,
  encodeCustomThemeCode,
  getDefaultCustomTheme,
  joinCustomThemeColor,
  normalizeCustomTheme,
  splitCustomThemeColor,
} from './customTheme.js';

/**
 * Builds the custom theme editor.
 *
 * @param {object} deps Shared helpers from `main.js`.
 * @param {Function} deps.t Translator, `(key, fallback) => string`.
 * @param {Function} deps.applyOverlayVarsToFloatingElement Copies `--bm-*` onto a floating panel.
 * @param {Function} deps.previewCustomTheme Applies a whole palette live, without persisting it.
 * @param {Function} deps.previewCustomThemeToken Applies one token live; the hot path while dragging.
 * @param {Function} deps.getCustomTheme Returns the stored palette.
 * @param {Function} deps.getCustomThemeApplyToSite Returns whether wplace's own UI is restyled.
 * @param {Function} deps.saveCustomTheme Persists a palette and the site flag (async).
 * @returns {{openCustomThemeEditor: Function, closeCustomThemeEditor: Function}}
 */
export const createCustomThemeUi = (deps = {}) => {
  const {
    t: translate = null,
    applyOverlayVarsToFloatingElement,
    previewCustomTheme,
    previewCustomThemeToken,
    getCustomTheme,
    getCustomThemeApplyToSite,
    saveCustomTheme,
  } = deps;

  const tt = (key, fallback) => {
    const value = typeof translate === 'function' ? translate(key) : null;
    return (value && value !== key) ? value : fallback;
  };

  let session = null;

  const closeCustomThemeEditor = () => { session?.close?.(); };

  /** Opens the editor. Re-opening while already open just focuses the panel. */
  const openCustomThemeEditor = () => {
    if (session?.panel?.isConnected) {
      session.panel.style.zIndex = '9600';
      return session.promise;
    }

    return new Promise((resolve) => {
      /** The palette being edited. Committed to settings only on Save. */
      let working = normalizeCustomTheme(getCustomTheme?.());
      /** Snapshot used to restore the overlay if the user cancels. */
      const original = normalizeCustomTheme(getCustomTheme?.());
      let applyToSite = !!getCustomThemeApplyToSite?.();
      const originalApplyToSite = applyToSite;

      const panel = document.createElement('section');
      panel.id = 'bm-custom-theme-window';
      panel.className = 'bm-text-template-window bm-custom-theme-window';
      panel.style.width = '400px';
      panel.style.right = '20px';
      panel.style.bottom = '20px';

      const head = document.createElement('div');
      head.className = 'bm-text-template-window-head';
      head.title = tt('dialog.common.dragToMove', 'Drag to move');
      const title = document.createElement('span');
      title.className = 'bm-text-template-window-title';
      title.textContent = tt('customTheme.title', 'Customize Theme');
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'bm-text-template-window-close';
      closeBtn.textContent = '✖';
      closeBtn.title = tt('dialog.common.close', 'Close');
      head.appendChild(title);
      head.appendChild(closeBtn);
      panel.appendChild(head);

      const body = document.createElement('div');
      body.className = 'bm-text-template-window-body bm-custom-theme-body';

      /** Re-renders every row from `working`, used after import/reset. */
      const rowSyncers = [];
      const syncRows = () => { rowSyncers.forEach((sync) => sync()); };

      /** Full re-apply. Only for bulk changes (open, import, reset, site toggle). */
      const preview = () => {
        // `extraTarget` writes straight to the editor panel, avoiding the
        // getComputedStyle sweep `applyOverlayVarsToFloatingElement` would do.
        previewCustomTheme?.(working, { extraTarget: panel, applyToSite });
        syncSampleVars();
      };

      /* Colour inputs fire on every pointer move. Coalesce them to one write per
       * frame and touch only the token that actually changed - see
       * `previewCustomThemeToken` in main.js for why the full pass is too slow. */
      let pendingToken = null;
      let rafHandle = 0;
      const flushToken = () => {
        rafHandle = 0;
        if (!pendingToken) return;
        previewCustomThemeToken?.(pendingToken, working[pendingToken.key], panel, applyToSite);
        syncSampleVars(pendingToken);
        pendingToken = null;
      };
      const previewToken = (token) => {
        pendingToken = token;
        if (rafHandle) return;
        rafHandle = requestAnimationFrame(flushToken);
      };
      const cancelPendingPreview = () => {
        if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = 0; }
        pendingToken = null;
      };

      /* ---- colour rows ---------------------------------------------------- */

      const scroll = document.createElement('div');
      scroll.className = 'bm-custom-theme-scroll';

      /** Sections gated behind the "restyle wplace UI" toggle. */
      const siteSections = [];
      /** Shared container the per-token wplace examples render into. */
      let sampleHost = null;

      /** Copies the working wplace tokens onto the sample container. */
      const syncSampleVars = (token = null) => {
        if (!sampleHost) return;
        const tokens = token ? [token] : CUSTOM_THEME_TOKENS;
        for (const entry of tokens) {
          if (!entry.siteVar) continue;
          sampleHost.style.setProperty(entry.siteVar, customThemeColorToCss(working[entry.key]));
        }
      };

      /** Renders the example widget for a token into the shared container. */
      const showSample = (token) => {
        if (!sampleHost || !token?.example) return;
        const { kind, classes } = token.example;
        sampleHost.textContent = '';
        sampleHost.hidden = false;

        const caption = document.createElement('div');
        caption.className = 'bm-custom-theme-sample-caption';
        caption.textContent = tt(token.labelKey, token.labelFallback);
        sampleHost.appendChild(caption);

        // The stage paints itself with the working base surface so the widget
        // sits on a wplace-coloured background rather than on our overlay, which
        // is what it will actually look like on the site.
        const stage = document.createElement('div');
        stage.className = 'bm-custom-theme-sample-stage';
        stage.style.backgroundColor = 'var(--color-base-100)';
        stage.style.color = 'var(--color-base-content)';

        let sample;
        if (kind === 'chip' || kind === 'badge') {
          sample = document.createElement('span');
          sample.className = classes + ' bm-custom-theme-sample-chip';
          sample.textContent = tt('customTheme.sampleText', 'Sample');
        } else if (kind === 'alert') {
          sample = document.createElement('div');
          sample.className = classes;
          const text = document.createElement('span');
          text.textContent = tt('customTheme.sampleAlert', 'Example message');
          sample.appendChild(text);
        } else if (kind === 'card') {
          sample = document.createElement('div');
          sample.className = classes + ' bm-custom-theme-sample-card';
          sample.textContent = tt('customTheme.sampleCard', 'Example panel text');
        } else {
          sample = document.createElement('span');
          sample.className = classes;
          sample.textContent = tt('customTheme.samplePaint', 'Paint');
        }

        stage.appendChild(sample);
        sampleHost.appendChild(stage);
        syncSampleVars();
      };

      for (const group of CUSTOM_THEME_GROUPS) {
        const section = document.createElement('div');
        section.className = 'bm-custom-theme-group';
        if (group.site) { siteSections.push(section); }

        const groupTitle = document.createElement('div');
        groupTitle.className = 'bm-custom-theme-group-title';
        groupTitle.textContent = tt(group.labelKey, group.labelFallback);
        section.appendChild(groupTitle);

        if (group.site) {
          const toggleRow = document.createElement('label');
          toggleRow.className = 'bm-custom-theme-site-toggle';
          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.checked = applyToSite;
          const toggleText = document.createElement('span');
          toggleText.textContent = tt('customTheme.applyToSite', 'Restyle the wplace UI too');
          toggleRow.appendChild(toggle);
          toggleRow.appendChild(toggleText);
          section.appendChild(toggleRow);

          /* Live sample of the real wplace widget a token drives.
           *
           * The samples are built from wplace's own daisyUI classes, so they are
           * literally the same components the site renders. They carry the
           * working `--color-*` values inline, which means the examples preview
           * the edited palette even while "Restyle the wplace UI too" is off.
           *
           * Samples use span/div rather than <button>, because our own
           * `#bm-custom-theme-window button` rule would otherwise outrank
           * daisyUI's `.btn` and repaint the sample with overlay colors.
           */
          sampleHost = document.createElement('div');
          sampleHost.className = 'bm-custom-theme-sample';
          sampleHost.hidden = true;
          section.appendChild(sampleHost);

          const syncSiteRows = () => {
            for (const siteSection of siteSections) {
              siteSection.classList.toggle('bm-custom-theme-group--off', !applyToSite);
            }
          };
          toggle.addEventListener('change', () => {
            applyToSite = toggle.checked;
            syncSiteRows();
            cancelPendingPreview();
            preview(); // full pass: turning it off must also clear the site vars
          });
          rowSyncers.push(syncSiteRows);
        }

        for (const token of group.tokens) {
          const row = document.createElement('div');
          row.className = 'bm-custom-theme-row';

          const label = document.createElement('label');
          label.className = 'bm-custom-theme-row-label';
          label.textContent = tt(token.labelKey, token.labelFallback);

          const swatch = document.createElement('input');
          swatch.type = 'color';
          swatch.className = 'bm-custom-theme-swatch';
          swatch.title = tt('customTheme.pickColor', 'Pick a color');

          const alpha = document.createElement('input');
          alpha.type = 'range';
          alpha.min = '0';
          alpha.max = '100';
          alpha.step = '1';
          alpha.className = 'bm-custom-theme-alpha';
          alpha.title = tt('customTheme.opacity', 'Opacity');

          const hexInput = document.createElement('input');
          hexInput.type = 'text';
          hexInput.className = 'bm-custom-theme-hex';
          hexInput.spellcheck = false;
          hexInput.setAttribute('autocomplete', 'off');
          hexInput.title = tt('customTheme.hex', 'Hex value (#rrggbb or #rrggbbaa)');

          const sync = () => {
            const { hex, alpha: alphaValue } = splitCustomThemeColor(working[token.key]);
            swatch.value = hex;
            alpha.value = String(Math.round(alphaValue * 100));
            if (document.activeElement !== hexInput) { hexInput.value = working[token.key]; }
          };
          rowSyncers.push(sync);

          const onPick = () => {
            working[token.key] = joinCustomThemeColor(swatch.value, Number(alpha.value) / 100);
            hexInput.value = working[token.key];
            previewToken(token);
          };
          swatch.addEventListener('input', onPick);
          alpha.addEventListener('input', onPick);
          // `change` rather than `input` so a half-typed hex doesn't fight the field.
          hexInput.addEventListener('change', () => {
            working[token.key] = joinCustomThemeColor(hexInput.value, splitCustomThemeColor(hexInput.value).alpha);
            sync();
            previewToken(token);
          });

          row.appendChild(label);
          row.appendChild(swatch);
          row.appendChild(alpha);
          row.appendChild(hexInput);

          if (token.example) {
            const exampleBtn = document.createElement('span');
            exampleBtn.className = 'bm-custom-theme-example';
            exampleBtn.setAttribute('role', 'button');
            exampleBtn.tabIndex = 0;
            exampleBtn.textContent = tt('customTheme.example', 'example');
            exampleBtn.title = tt('customTheme.exampleTitle', 'Show where wplace uses this color');
            const activate = () => showSample(token);
            exampleBtn.addEventListener('click', activate);
            exampleBtn.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
            });
            row.appendChild(exampleBtn);
          } else {
            row.appendChild(document.createElement('span'));
          }

          section.appendChild(row);
        }

        scroll.appendChild(section);
      }

      body.appendChild(scroll);

      /* ---- share code ----------------------------------------------------- */

      const shareGroup = document.createElement('div');
      shareGroup.className = 'bm-custom-theme-share';

      const shareLabel = document.createElement('div');
      shareLabel.className = 'bm-custom-theme-group-title';
      shareLabel.textContent = tt('customTheme.share', 'Share Code');
      shareGroup.appendChild(shareLabel);

      const shareInput = document.createElement('textarea');
      shareInput.className = 'bm-custom-theme-code';
      shareInput.rows = 2;
      shareInput.spellcheck = false;
      shareInput.setAttribute('autocomplete', 'off');
      shareInput.placeholder = tt('customTheme.codePlaceholder', 'Paste a theme code here, then press Import.');
      shareGroup.appendChild(shareInput);

      const shareActions = document.createElement('div');
      shareActions.className = 'bm-custom-theme-share-actions';

      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.textContent = tt('customTheme.copyCode', 'Copy Code');

      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.textContent = tt('customTheme.importCode', 'Import');

      shareActions.appendChild(exportBtn);
      shareActions.appendChild(importBtn);
      shareGroup.appendChild(shareActions);

      const status = document.createElement('div');
      status.className = 'bm-text-template-window-meta bm-custom-theme-status';
      shareGroup.appendChild(status);

      body.appendChild(shareGroup);

      const setStatus = (message, isError = false) => {
        status.textContent = message;
        status.classList.toggle('bm-custom-theme-status--error', !!isError);
      };

      exportBtn.addEventListener('click', async () => {
        const code = encodeCustomThemeCode(working, '', applyToSite);
        shareInput.value = code;
        shareInput.focus();
        shareInput.select();
        try {
          await navigator.clipboard.writeText(code);
          setStatus(tt('customTheme.copied', 'Theme code copied to clipboard.'));
        } catch (_) {
          // Clipboard access can be denied; the code is selected for manual copy.
          setStatus(tt('customTheme.copyManual', 'Theme code ready - press Ctrl+C to copy.'));
        }
      });

      importBtn.addEventListener('click', () => {
        const decoded = decodeCustomThemeCode(shareInput.value);
        if (!decoded) {
          setStatus(tt('customTheme.importFailed', 'That is not a valid theme code.'), true);
          return;
        }
        working = decoded.colors;
        applyToSite = decoded.applyToSite;
        cancelPendingPreview();
        syncRows();
        preview();
        setStatus(decoded.name
          ? tt('customTheme.importedNamed', 'Imported theme: {name}').replace('{name}', decoded.name)
          : tt('customTheme.imported', 'Theme code imported. Press Save to keep it.'));
      });

      /* ---- actions -------------------------------------------------------- */

      const actions = document.createElement('div');
      actions.className = 'bm-text-template-window-actions';

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.textContent = tt('customTheme.reset', 'Reset');

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = tt('dialog.common.cancel', 'Cancel');

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = tt('customTheme.save', 'Save');

      actions.appendChild(resetBtn);
      actions.appendChild(cancelBtn);
      actions.appendChild(saveBtn);
      body.appendChild(actions);
      panel.appendChild(body);

      let closed = false;
      let detachDrag = null;

      const close = (result = null) => {
        if (closed) return;
        closed = true;
        cancelPendingPreview();
        detachDrag?.();
        detachDrag = null;
        document.removeEventListener('bm-layout-theme-changed', handleThemeChanged);
        window.removeEventListener('keydown', handleKeyDown, true);
        panel.remove();
        if (session?.panel === panel) { session = null; }
        resolve(result);
      };

      const cancel = () => {
        // Drop the live preview and restore what was stored when we opened.
        cancelPendingPreview();
        previewCustomTheme?.(original, { applyToSite: originalApplyToSite });
        close(null);
      };

      const handleThemeChanged = () => { applyOverlayVarsToFloatingElement?.(panel); };

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      };

      resetBtn.addEventListener('click', () => {
        working = getDefaultCustomTheme();
        cancelPendingPreview();
        syncRows();
        preview();
        setStatus(tt('customTheme.resetDone', 'Reset to the default palette.'));
      });

      cancelBtn.addEventListener('click', () => cancel());
      closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      });

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          await saveCustomTheme?.(working, applyToSite);
          close({ colors: working });
        } catch (error) {
          saveBtn.disabled = false;
          setStatus(tt('customTheme.saveFailed', 'Failed to save the theme.'), true);
        }
      });

      detachDrag = makePanelDraggable(head, panel);

      document.body.appendChild(panel);
      registerFloatingPanel(panel);
      syncRows();
      preview();
      document.addEventListener('bm-layout-theme-changed', handleThemeChanged);
      window.addEventListener('keydown', handleKeyDown, true);

      session = { panel, close: cancel, promise: null };
    });
  };

  return { openCustomThemeEditor, closeCustomThemeEditor, buildCustomThemeCssVars };
};
