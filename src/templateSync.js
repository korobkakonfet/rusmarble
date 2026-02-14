const normalizeUpdatedAt = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `n:${value}` : null;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    return `n:${Number(text)}`;
  }
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return `n:${parsed}`;
  }
  return `s:${text}`;
};

export const normalizeRemoteOrder = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const safeCall = (fn) => {
  if (typeof fn !== 'function') return;
  try { fn(); } catch (_) {}
};

const normalizeFlag = (value) => value === true || value === 'true' || value === 1 || value === '1';

export function createTemplateSync({
  name,
  consoleStyle,
  consoleLog,
  consoleWarn,
  gmRequest,
  templateManager,
  templateSyncBaseUrl,
  templateUpdatePollMs = 5000,
  remoteFlagsRefreshMs = 60000,
  buildTemplateFilterList,
  autoSyncOnStatus,
  autoSyncOnError,
  autoSyncSyncToggleList,
  autoSyncBuildTemplateFilterList,
  autoSyncBuildColorFilterList,
} = {}) {
  const waitForImport = async () => {
    if (!templateManager?.importPromise) return;
    try {
      await templateManager.importPromise;
    } catch (_) {}
  };
  const dedupeRemoteTemplatesOnce = async () => {};
  let templateUpdatePollId = null;
  let templateUpdatePollInFlight = false;
  let templateUpdatePendingCount = 0;
  let templateFlagSyncInFlight = false;
  let autoSyncPromptKey = null;
  let autoSyncInFlight = false;

  const setTemplateUpdateBadge = (count) => {
    const badge = document.getElementById('bm-sync-templates-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  };

  const pruneMissingRemoteTemplates = async (templateItems) => {
    if (!Array.isArray(templateItems)) return;
    const serverNames = new Set(
      templateItems
        .map(entry => {
          if (typeof entry === 'string') return entry;
          if (entry?.['deleted'] === true) return null;
          return entry?.['name'];
        })
        .filter(name => name)
    );
    const missing = (templateManager.templatesArray ?? []).filter(template => {
      if (!template) return false;
      const store = templateManager.templatesJSON?.templates?.[template.storageKey];
      const isRemote = template.isRemote === true || store?.remote === true;
      if (!isRemote) return false;
      const templateName = template.remoteName || template.displayName;
      return !!templateName && !serverNames.has(templateName);
    });
    for (const template of missing) {
      const templateName = template.remoteName || template.displayName || template.storageKey;
      consoleLog(
        `%c${name}%c: Remote template "%s" missing from server list. Deleting local copy.`,
        consoleStyle,
        '',
        templateName
      );
      await templateManager.deleteTemplate(template.storageKey);
    }
  };

  const syncRemoteTemplateFlags = async (templateItems) => {
    if (templateFlagSyncInFlight) return;
    if (!Array.isArray(templateItems) || templateItems.length === 0) return;
    templateFlagSyncInFlight = true;
    try {
      let anyChanged = false;
      for (const entry of templateItems) {
        const entryMeta = typeof entry === "object" && entry !== null ? entry : null;
        const name = typeof entry === "string" ? entry : entry?.['name'];
        if (entryMeta?.['deleted'] === true) { continue; }
        if (!name) { continue; }
        const existingTemplate = (templateManager.templatesArray ?? []).find(t => {
          if (!t) return false;
          const sameName = t.displayName === name || t.remoteName === name;
          return sameName;
        });
        if (!existingTemplate) { continue; }
        const store = templateManager.templatesJSON?.templates?.[existingTemplate.storageKey];
        const isRemote = existingTemplate.isRemote === true || store?.remote === true;
        if (!isRemote) { continue; }
        const storedRemoteCoords = Array.isArray(store?.remoteCoords)
          ? store.remoteCoords
          : (Array.isArray(existingTemplate.remoteCoords) ? existingTemplate.remoteCoords : null);

        const entryUpdatedAt = entryMeta?.['updated_at'] ?? null;
        const prevFlagsCheckedAt =
          store?.remoteFlagsCheckedAt ??
          existingTemplate.remoteFlagsCheckedAt ??
          null;
        const normalizedEntryUpdatedAt = normalizeUpdatedAt(entryUpdatedAt);
        const normalizedPrevFlagsCheckedAt = normalizeUpdatedAt(prevFlagsCheckedAt);

        const fetchMeta = async (reason) => {
          if (reason) {
            consoleLog(
              `%c${name}%c: Fetching template meta for "%s" (reason: %s)`,
              consoleStyle,
              '',
              name,
              reason
            );
          }
          const safeName = encodeURIComponent(name);
          const metaResponse = await gmRequest(`${templateSyncBaseUrl}/templates/${safeName}`, "json");
          return metaResponse.response ?? JSON.parse(metaResponse.responseText || "{}");
        };

        const entryHasMeta = !!entryMeta && (
          entryMeta?.['to_top'] !== undefined ||
          entryMeta?.['to_top_at'] !== undefined ||
          entryMeta?.['highlighted'] !== undefined ||
          entryMeta?.['highlighted_at'] !== undefined ||
          entryMeta?.['order'] !== undefined
        );
        const lastFlagsCheckedMs =
          store?.remoteFlagsCheckedAtLocal ??
          existingTemplate.remoteFlagsCheckedAtLocal ??
          0;
        const shouldThrottle = !entryHasMeta
          && lastFlagsCheckedMs
          && (Date.now() - lastFlagsCheckedMs) < remoteFlagsRefreshMs;
        if (shouldThrottle) {
          continue;
        }
        if (!entryHasMeta && normalizedEntryUpdatedAt && normalizedPrevFlagsCheckedAt && normalizedEntryUpdatedAt === normalizedPrevFlagsCheckedAt) {
          continue;
        }
        let meta = entryHasMeta ? entryMeta : await fetchMeta('list entry missing flags/coords');
        let metaFetched = !entryHasMeta;

        const prevToTop = existingTemplate.remoteToTop ?? store?.remoteToTop ?? false;
        const prevToTopAt = existingTemplate.remoteToTopAt ?? store?.remoteToTopAt ?? null;
        const prevHighlighted = existingTemplate.remoteHighlighted ?? store?.remoteHighlighted ?? false;
        const prevHighlightedAt = existingTemplate.remoteHighlightedAt ?? store?.remoteHighlightedAt ?? null;
        const prevOrder = normalizeRemoteOrder(
          Number.isFinite(existingTemplate.remoteOrder) ? existingTemplate.remoteOrder : store?.remoteOrder
        );

        const readMeta = (metaValue) => {
          const hasToTop = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, 'to_top');
          const hasToTopAt = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, 'to_top_at');
          const hasHighlighted = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, 'highlighted');
          const hasHighlightedAt = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, 'highlighted_at');
          const hasOrder = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, 'order');
          const nextToTop = hasToTop ? normalizeFlag(metaValue['to_top']) : prevToTop;
          const nextToTopAt = hasToTopAt ? metaValue['to_top_at'] ?? null : (hasToTop ? null : prevToTopAt);
          const nextHighlighted = hasHighlighted ? normalizeFlag(metaValue['highlighted']) : prevHighlighted;
          const nextHighlightedAt = hasHighlightedAt ? metaValue['highlighted_at'] ?? null : (hasHighlighted ? null : prevHighlightedAt);
          const nextUpdatedAt = metaValue?.['updated_at'] ?? entryMeta?.['updated_at'] ?? null;
          const nextOrder = hasOrder ? normalizeRemoteOrder(metaValue?.['order']) : prevOrder;
          const coordsMeta = Array.isArray(metaValue?.['coords']) ? metaValue['coords'].map(Number) : null;
          return { nextToTop, nextToTopAt, nextHighlighted, nextHighlightedAt, nextUpdatedAt, nextOrder, coordsMeta };
        };

        let {
          nextToTop,
          nextToTopAt,
          nextHighlighted,
          nextHighlightedAt,
          nextUpdatedAt,
          nextOrder,
          coordsMeta
        } = readMeta(meta);
        if (!coordsMeta && Array.isArray(storedRemoteCoords) && storedRemoteCoords.length === 4) {
          coordsMeta = storedRemoteCoords.map(Number);
        }

        let flagsChanged =
          prevToTop !== nextToTop ||
          prevToTopAt !== nextToTopAt ||
          prevHighlighted !== nextHighlighted ||
          prevHighlightedAt !== nextHighlightedAt ||
          prevOrder !== nextOrder;

        if (flagsChanged && nextUpdatedAt && !coordsMeta && !metaFetched) {
          meta = await fetchMeta('flags changed; coords missing in list meta');
          metaFetched = true;
          ({
            nextToTop,
            nextToTopAt,
            nextHighlighted,
            nextHighlightedAt,
            nextUpdatedAt,
            nextOrder,
            coordsMeta
          } = readMeta(meta));
          flagsChanged =
            prevToTop !== nextToTop ||
            prevToTopAt !== nextToTopAt ||
            prevHighlighted !== nextHighlighted ||
            prevHighlightedAt !== nextHighlightedAt ||
            prevOrder !== nextOrder;
        }

        if (Array.isArray(coordsMeta) && coordsMeta.length === 4) {
          const normalizedCoords = coordsMeta.map(Number);
          const prevRemoteCoords = Array.isArray(existingTemplate.remoteCoords)
            ? existingTemplate.remoteCoords
            : (Array.isArray(store?.remoteCoords) ? store.remoteCoords : null);
          const coordsChanged = !prevRemoteCoords
            || prevRemoteCoords.length !== 4
            || prevRemoteCoords.some((value, index) => Number(value) !== normalizedCoords[index]);
          if (coordsChanged) {
            existingTemplate.remoteCoords = normalizedCoords;
            if (store) {
              store.remoteCoords = normalizedCoords;
            }
            anyChanged = true;
          }
        }

        if (!flagsChanged) { continue; }

        const coordsMatch = !!coordsMeta
          && coordsMeta.length === 4
          && Array.isArray(existingTemplate.coords)
          && existingTemplate.coords.length === 4
          && coordsMeta.every((value, index) => Number(value) === Number(existingTemplate.coords[index]));

        existingTemplate.remoteToTop = nextToTop;
        existingTemplate.remoteToTopAt = nextToTopAt;
        existingTemplate.remoteHighlighted = nextHighlighted;
        existingTemplate.remoteHighlightedAt = nextHighlightedAt;
        existingTemplate.remoteOrder = nextOrder;
        if (flagsChanged && nextUpdatedAt && (coordsMatch || !coordsMeta)) {
          existingTemplate.remoteFlagsAppliedAt = nextUpdatedAt;
          if (store) {
            store.remoteFlagsAppliedAt = nextUpdatedAt;
          }
        }
        if (nextUpdatedAt && (!coordsMeta || coordsMatch)) {
          if (prevFlagsCheckedAt !== nextUpdatedAt) {
            existingTemplate.remoteFlagsCheckedAt = nextUpdatedAt;
            if (store) {
              store.remoteFlagsCheckedAt = nextUpdatedAt;
            }
            anyChanged = true;
          }
        }
        if (metaFetched) {
          const flagsCheckNow = Date.now();
          existingTemplate.remoteFlagsCheckedAtLocal = flagsCheckNow;
          if (store) {
            store.remoteFlagsCheckedAtLocal = flagsCheckNow;
          }
          anyChanged = true;
        }
        if (store) {
          store.remoteToTop = nextToTop;
          store.remoteToTopAt = nextToTopAt;
          store.remoteHighlighted = nextHighlighted;
          store.remoteHighlightedAt = nextHighlightedAt;
          store.remoteOrder = nextOrder;
        }
        if (flagsChanged) {
          anyChanged = true;
        }
      }
      if (anyChanged) {
        await templateManager.storeTemplates();
        safeCall(buildTemplateFilterList);
      }
    } catch (_) {
      // Ignore polling errors to avoid noisy UI
    } finally {
      templateFlagSyncInFlight = false;
    }
  };

  const checkTemplateUpdates = async () => {
    if (templateUpdatePollInFlight) return;
    templateUpdatePollInFlight = true;
    try {
      await waitForImport();
      await dedupeRemoteTemplatesOnce();
      const listResponse = await gmRequest(`${templateSyncBaseUrl}/templates`, "json");
      const listData = listResponse.response ?? JSON.parse(listResponse.responseText || "{}");
      const templateItems = Array.isArray(listData)
        ? listData
        : (Array.isArray(listData?.['templates']) ? listData['templates'] : []);
      await syncRemoteTemplateFlags(templateItems);
      await pruneMissingRemoteTemplates(templateItems);
      let changedCount = 0;
      if (Array.isArray(templateItems)) {
        const promptPieces = [];
        for (const entry of templateItems) {
          const entryMeta = typeof entry === "object" && entry !== null ? entry : null;
          const templateName = typeof entry === "string" ? entry : entry?.['name'];
          const updatedAt = entryMeta?.['updated_at'] ?? null;
          const isDeleted = entryMeta?.['deleted'] === true;
          if (!templateName) { continue; }
          if (isDeleted) { continue; }
          const existingTemplate = (templateManager.templatesArray ?? []).find(t => {
            if (!t) return false;
            return t.displayName === templateName || t.remoteName === templateName;
          });
          const existingUpdatedAt =
            templateManager.templatesJSON?.templates?.[existingTemplate?.storageKey]?.remoteUpdatedAt ??
            existingTemplate?.remoteUpdatedAt ??
            null;
          const flagsAppliedAt =
            templateManager.templatesJSON?.templates?.[existingTemplate?.storageKey]?.remoteFlagsAppliedAt ??
            existingTemplate?.remoteFlagsAppliedAt ??
            null;
          const normalizedUpdatedAt = normalizeUpdatedAt(updatedAt);
          const normalizedExistingUpdatedAt = normalizeUpdatedAt(existingUpdatedAt);
          const normalizedFlagsAppliedAt = normalizeUpdatedAt(flagsAppliedAt);
          if (normalizedUpdatedAt && normalizedFlagsAppliedAt && normalizedUpdatedAt === normalizedFlagsAppliedAt) {
            continue;
          }
          const isMissingLocal = !existingTemplate;
          const isChanged = isMissingLocal || (normalizedUpdatedAt && normalizedUpdatedAt !== normalizedExistingUpdatedAt);
          if (isChanged) {
            promptPieces.push(`${templateName}::${normalizedUpdatedAt ?? 'missing'}`);
            const updateReasons = [];
            if (isMissingLocal) { updateReasons.push('missing-local'); }
            if (normalizedUpdatedAt && normalizedUpdatedAt !== normalizedExistingUpdatedAt) { updateReasons.push('updated_at-changed'); }
            const reasonText = updateReasons.length ? updateReasons.join(', ') : 'unknown';
            console.log(
              `%c${name}%c: Template update flagged for "%s" (reason: %s). updated_at=%s, local_updated_at=%s, flags_applied_at=%s`,
              consoleStyle,
              '',
              templateName,
              reasonText,
              updatedAt,
              existingUpdatedAt,
              flagsAppliedAt
            );
            changedCount += 1;
          }
        }
        const nextPromptKey = promptPieces.length ? promptPieces.join('|') : null;
        const autoSyncEnabled = templateManager?.isTemplateAutoSyncEnabled?.() ?? false;
        if (
          autoSyncEnabled &&
          nextPromptKey &&
          nextPromptKey !== autoSyncPromptKey &&
          !autoSyncInFlight
        ) {
          autoSyncPromptKey = nextPromptKey;
          autoSyncInFlight = true;
          try {
            await syncTemplatesFromServer({
              onStatus: autoSyncOnStatus,
              onError: autoSyncOnError,
              syncToggleList: autoSyncSyncToggleList,
              buildTemplateFilterList: autoSyncBuildTemplateFilterList,
              buildColorFilterList: autoSyncBuildColorFilterList,
            });
          } finally {
            autoSyncInFlight = false;
          }
        }
      }
      if (changedCount !== templateUpdatePendingCount) {
        templateUpdatePendingCount = changedCount;
        setTemplateUpdateBadge(changedCount);
      }
    } catch (err) {
      // Ignore polling errors to avoid noisy UI
    } finally {
      templateUpdatePollInFlight = false;
    }
  };

  const startTemplateUpdatePolling = () => {
    if (templateUpdatePollId) return;
    templateUpdatePollId = setInterval(checkTemplateUpdates, templateUpdatePollMs);
    checkTemplateUpdates();
  };

  const resetTemplateUpdateBadge = () => {
    templateUpdatePendingCount = 0;
    setTemplateUpdateBadge(0);
  };

  const syncTemplatesFromServer = async ({
    onStatus,
    onError,
    syncToggleList,
    buildTemplateFilterList: buildTemplateFilterListOverride,
    buildColorFilterList: buildColorFilterListOverride,
  } = {}) => {
    try {
      await waitForImport();
      await dedupeRemoteTemplatesOnce();
      const assertResponseOk = (response, label) => {
        const status = response?.status;
        if (Number.isFinite(status) && status >= 400) {
          throw new Error(`${label} failed with HTTP ${status}`);
        }
        if (!response) {
          throw new Error(`${label} failed: empty response`);
        }
      };
      if (typeof onStatus === 'function') onStatus('Syncing templates from server...');
      const listResponse = await gmRequest(`${templateSyncBaseUrl}/templates`, "json");
      assertResponseOk(listResponse, 'Template list');
      const listData = listResponse.response ?? JSON.parse(listResponse.responseText || "{}");
      const templateItems = Array.isArray(listData)
        ? listData
        : (Array.isArray(listData?.['templates']) ? listData['templates'] : []);
      if (!Array.isArray(templateItems) || templateItems.length === 0) {
        if (typeof onStatus === 'function') onStatus('No server templates found.');
        return 0;
      }
      let importedCount = 0;
      for (const entry of templateItems) {
        const entryMeta = typeof entry === "object" && entry !== null ? entry : null;
        const name = typeof entry === "string" ? entry : entry?.['name'];
        const updatedAt = entryMeta?.['updated_at'] ?? null;
        const listOrder = normalizeRemoteOrder(entryMeta?.['order']);
        if (entryMeta?.['deleted'] === true) { continue; }
        if (!name) { continue; }
        const safeName = encodeURIComponent(name);
        const matchingTemplates = (templateManager.templatesArray ?? []).filter(t => {
          if (!t) return false;
          return t.displayName === name || t.remoteName === name;
        });
        const matchingRemoteTemplates = matchingTemplates.filter(t => {
          const store = t.storageKey
            ? templateManager.templatesJSON?.templates?.[t.storageKey]
            : null;
          return t.isRemote === true || store?.remote === true;
        });
        const preferredTemplate =
          matchingRemoteTemplates.find(t => t.enabled) ??
          matchingRemoteTemplates[0] ??
          matchingTemplates[0];
        const existingStore = preferredTemplate?.storageKey
          ? templateManager.templatesJSON?.templates?.[preferredTemplate.storageKey]
          : null;
        const existingPalette = preferredTemplate?.colorPalette ? { ...preferredTemplate.colorPalette } : null;
        const existingEnabled = matchingRemoteTemplates.length
          ? matchingRemoteTemplates.some(t => t.enabled)
          : (preferredTemplate?.enabled ?? existingStore?.enabled ?? false);
        const existingUpdatedAt =
          templateManager.templatesJSON?.templates?.[preferredTemplate?.storageKey]?.remoteUpdatedAt ??
          preferredTemplate?.remoteUpdatedAt ??
          null;
        const normalizedExistingUpdatedAt = normalizeUpdatedAt(existingUpdatedAt);
        const normalizedUpdatedAt = normalizeUpdatedAt(updatedAt);
        if (normalizedExistingUpdatedAt && normalizedUpdatedAt && normalizedExistingUpdatedAt === normalizedUpdatedAt) {
          continue;
        }
        const metaResponse = await gmRequest(`${templateSyncBaseUrl}/templates/${safeName}`, "json");
        assertResponseOk(metaResponse, `Template meta "${name}"`);
        const meta = metaResponse.response ?? JSON.parse(metaResponse.responseText || "{}");
        const coords = Array.isArray(meta?.['coords']) ? meta['coords'].map(Number) : null;
        if (!coords || coords.length !== 4 || coords.some(n => !Number.isFinite(n))) {
          if (typeof onStatus === 'function') onStatus(`Skipped "${name}": invalid coords.`);
          continue;
        }
        const metaUpdatedAt = meta?.['updated_at'] ?? null;
        const toTop = normalizeFlag(meta?.['to_top'] ?? entryMeta?.['to_top']);
        const toTopAt = meta?.['to_top_at'] ?? null;
        const highlighted = normalizeFlag(meta?.['highlighted'] ?? entryMeta?.['highlighted']);
        const highlightedAt = meta?.['highlighted_at'] ?? null;
        const metaOrder = normalizeRemoteOrder(meta?.['order']);
        const order = metaOrder !== null ? metaOrder : listOrder;
        for (const template of matchingRemoteTemplates) {
          if (template?.storageKey) {
            await templateManager.deleteTemplate(template.storageKey);
          }
        }
        const imageResponse = await gmRequest(`${templateSyncBaseUrl}/templates/${safeName}/image`, "blob");
        assertResponseOk(imageResponse, `Template image "${name}"`);
        const imageBlob = imageResponse.response;
        if (!imageBlob) {
          throw new Error(`Template image "${name}" failed: empty blob`);
        }
        const file = new File([imageBlob], `${name}.png`, { type: imageBlob?.type || "image/png" });
        const created = await templateManager.createTemplate(
          file,
          name,
          coords,
          templateManager.getAnchor(),
          {
            remote: true,
            remoteName: name,
            remoteCoords: coords,
            remoteUpdatedAt: updatedAt || metaUpdatedAt,
            remoteToTop: toTop,
            remoteToTopAt: toTopAt,
            remoteHighlighted: highlighted,
            remoteHighlightedAt: highlightedAt,
            remoteOrder: order,
            enabled: preferredTemplate ? existingEnabled : false
          }
        );
        if (created) {
          if (existingPalette) {
            Object.entries(existingPalette).forEach(([rgb, metaValue]) => {
              if (created.colorPalette?.[rgb]) {
                created.colorPalette[rgb].enabled = !!metaValue?.enabled;
              }
            });
          }
        }
        importedCount += 1;
      }
      safeCall(syncToggleList);
      templateManager.createOverlayOnMap();
      safeCall(buildTemplateFilterListOverride ?? buildTemplateFilterList);
      safeCall(buildColorFilterListOverride);
      if (typeof onStatus === 'function') {
        onStatus(`Synced ${importedCount} template${importedCount === 1 ? '' : 's'}.`);
      }
      resetTemplateUpdateBadge();
      checkTemplateUpdates();
      return importedCount;
    } catch (err) {
      consoleWarn(`%c${name}%c: Failed to sync server templates`, consoleStyle, '', err);
      const errorMessage = err?.message
        ? `Failed to sync server templates: ${err.message}`
        : 'Failed to sync server templates.';
      if (typeof onError === 'function') {
        onError(errorMessage);
      }
      throw err;
    }
  };

  return {
    checkTemplateUpdates,
    startTemplateUpdatePolling,
    resetTemplateUpdateBadge,
    syncTemplatesFromServer
  };
}

