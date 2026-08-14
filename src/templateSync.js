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

const DEFAULT_TEMPLATE_STREAM = 'root';
const normalizeRemoteStream = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  return text || DEFAULT_TEMPLATE_STREAM;
};

const safeCall = (fn) => {
  if (typeof fn !== 'function') return;
  try { fn(); } catch (_) {}
};

const normalizeFlag = (value) => value === true || value === 'true' || value === 1 || value === '1';
const SYNC_TIMEOUT_MS = 180000;

const withTimeout = (promise, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error(`${label} timed out after ${SYNC_TIMEOUT_MS}ms`));
  }, SYNC_TIMEOUT_MS);
  promise.then((result) => {
    clearTimeout(timer);
    resolve(result);
  }).catch((err) => {
    clearTimeout(timer);
    reject(err);
  });
});

const getResponseData = (response, label) => {
  if (!response) {
    throw new Error(`${label} failed: empty response`);
  }
  if (response.response !== undefined && response.response !== null) {
    return response.response;
  }
  const text = response.responseText || '';
  if (!text) {
    throw new Error(`${label} failed: empty response body`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} failed: invalid JSON`);
  }
};

export function createTemplateSync({
  name,
  consoleStyle,
  consoleLog,
  consoleWarn,
  gmRequest,
  templateManager,
  templateSyncBaseUrl,
  templateUpdatePollMs = 30000,
  remoteFlagsRefreshMs = 60000,
  buildTemplateFilterList,
  autoSyncOnStatus,
  autoSyncOnError,
  autoSyncSyncToggleList,
  autoSyncBuildTemplateFilterList,
  autoSyncBuildColorFilterList,
} = {}) {
  const logSync = (message, options = {}) => {
    const { level = 'log', statusHandler = autoSyncOnStatus, err = null } = options;
    const fullMessage = `Template Sync: ${message}`;
    if (level === 'warn') {
      consoleWarn(`%c${name}%c: ${fullMessage}`, consoleStyle, '', err ?? '');
    } else {
      consoleLog(`%c${name}%c: ${fullMessage}`, consoleStyle, '');
    }
    if (typeof statusHandler === 'function') {
      try { statusHandler(fullMessage); } catch (_) {}
    }
  };
  const gmRequestWithTimeout = (url, responseType, label) =>
    withTimeout(gmRequest(url, responseType), label ?? `Request ${url}`);
  const assertResponseOk = (response, label) => {
    const status = response?.status;
    if (Number.isFinite(status) && status >= 400) {
      throw new Error(`${label} failed with HTTP ${status}`);
    }
    if (!response) {
      throw new Error(`${label} failed: empty response`);
    }
  };
  const getConfiguredStreams = () => {
    const streams = typeof templateManager?.getTemplateSyncStreams === 'function'
      ? templateManager.getTemplateSyncStreams()
      : null;
    if (!Array.isArray(streams) || streams.length === 0) {
      return [DEFAULT_TEMPLATE_STREAM];
    }
    const uniqueStreams = [];
    const seen = new Set();
    for (const entry of streams) {
      const stream = normalizeRemoteStream(entry);
      if (seen.has(stream)) continue;
      seen.add(stream);
      uniqueStreams.push(stream);
    }
    return uniqueStreams.length ? uniqueStreams : [DEFAULT_TEMPLATE_STREAM];
  };
  const buildStreamUrl = (pathname, stream = DEFAULT_TEMPLATE_STREAM) => {
    const url = new URL(`${templateSyncBaseUrl}${pathname}`);
    url.searchParams.set('stream', normalizeRemoteStream(stream));
    return url.toString();
  };
  const hasTrackedRemoteTemplates = () => (
    (templateManager?.templatesArray ?? []).some((template) => {
      const store = template?.storageKey
        ? templateManager?.templatesJSON?.templates?.[template.storageKey]
        : null;
      return template?.isRemote === true || store?.remote === true;
    })
  );
  const shouldPollTemplateUpdates = () => (
    hasTrackedRemoteTemplates()
    || (templateManager?.isTemplateAutoSyncEnabled?.() ?? false)
  );
  const getTemplateListUrl = (stream) => buildStreamUrl('/templates', stream);
  const getTemplateMetaUrl = (templateName, stream) => buildStreamUrl(`/templates/${encodeURIComponent(templateName)}`, stream);
  const getTemplateImageUrl = (templateName, stream) => buildStreamUrl(`/templates/${encodeURIComponent(templateName)}/image`, stream);
  const getRemoteTemplateStream = (template, store = null) => normalizeRemoteStream(
    template?.remoteStream ?? store?.remoteStream
  );
  const parseTemplateEntry = (entry, fallbackStream = DEFAULT_TEMPLATE_STREAM) => {
    const entryMeta = typeof entry === 'object' && entry !== null ? entry : null;
    const templateName = typeof entry === 'string' ? entry : entry?.['name'];
    const remoteStream = normalizeRemoteStream(entryMeta?.['stream'] ?? fallbackStream);
    return { entryMeta, templateName, remoteStream };
  };
  const isSameRemoteTemplate = (template, templateName, remoteStream) => {
    if (!template || !templateName) return false;
    const store = template.storageKey
      ? templateManager.templatesJSON?.templates?.[template.storageKey]
      : null;
    const isRemote = template.isRemote === true || store?.remote === true;
    if (!isRemote) return false;
    if (getRemoteTemplateStream(template, store) !== normalizeRemoteStream(remoteStream)) return false;
    return template.displayName === templateName || template.remoteName === templateName;
  };
  const findRemoteTemplateByIdentity = (templateName, remoteStream) => (
    (templateManager.templatesArray ?? []).find((template) => isSameRemoteTemplate(template, templateName, remoteStream))
  );
  const fetchTemplateListForStream = async (stream, label = 'Template list') => {
    const normalizedStream = normalizeRemoteStream(stream);
    const labelWithStream = `${label} (${normalizedStream})`;
    const response = await gmRequestWithTimeout(
      getTemplateListUrl(normalizedStream),
      'json',
      labelWithStream
    );
    assertResponseOk(response, labelWithStream);
    const data = getResponseData(response, labelWithStream) ?? {};
    const templateItems = Array.isArray(data)
      ? data
      : (Array.isArray(data?.['templates']) ? data['templates'] : []);
    return {
      stream: normalizedStream,
      templateItems: Array.isArray(templateItems) ? templateItems : [],
    };
  };

  /** Templates added by name can resolve through /templates/<name> while being absent from the
   * stream listing, so the listing-driven update check never sees them. Collect them so they can
   * be polled by name instead.
   * @param {Set<string>} listedKeys - `stream:name` keys already covered by a stream listing.
   */
  const collectUnlistedManualTemplates = (listedKeys) => (
    (templateManager.templatesArray ?? []).reduce((accumulator, template) => {
      if (!template) return accumulator;
      const store = template.storageKey
        ? templateManager.templatesJSON?.templates?.[template.storageKey]
        : null;
      const isRemote = template.isRemote === true || store?.remote === true;
      if (!isRemote) return accumulator;
      if (!(template.remoteManual === true || store?.remoteManual === true)) return accumulator;
      const templateName = template.remoteName || template.displayName || store?.remoteName || store?.name;
      if (!templateName) return accumulator;
      const stream = getRemoteTemplateStream(template, store);
      if (listedKeys.has(`${stream}:${templateName}`)) return accumulator;
      accumulator.push({ template, store, templateName, stream });
      return accumulator;
    }, [])
  );

  /** Reads a manual template's meta and shapes it like a stream-listing entry, so the regular
   * timestamp comparison and sync path can consume it unchanged. Returns null when unavailable.
   */
  const fetchManualTemplateEntry = async ({ templateName, stream }) => {
    const label = `Template meta "${templateName}" (${stream})`;
    try {
      const response = await gmRequestWithTimeout(getTemplateMetaUrl(templateName, stream), 'json', label);
      assertResponseOk(response, label);
      const meta = getResponseData(response, label) ?? {};
      if (meta?.['deleted'] === true) return null;
      return {
        'name': templateName,
        'stream': stream,
        'updated_at': meta?.['updated_at'] ?? null,
        'image_updated_at': meta?.['image_updated_at'] ?? meta?.['updated_at'] ?? null,
        'order': meta?.['order'] ?? null,
        'to_top': meta?.['to_top'] ?? false,
        'highlighted': meta?.['highlighted'] ?? false,
      };
    } catch (err) {
      logSync(`Failed to read meta for manual template "${templateName}" (${stream}).`, { level: 'warn', err });
      return null;
    }
  };

  const waitForImport = async () => {
    if (!templateManager?.importPromise) return;
    try {
      await templateManager.importPromise;
    } catch (_) {}
  };
  const dedupeRemoteTemplatesOnce = async () => {};

  const parseCoordsValue = (value) => {
    const parts = Array.isArray(value)
      ? value
      : String(value ?? '').split(',');
    if (parts.length !== 4) return null;
    const coords = parts.map((part) => Number(String(part).trim()));
    return coords.some((n) => !Number.isFinite(n)) ? null : coords;
  };

  /** Names already examined for adoption, so a rejected candidate isn't re-fetched every poll. */
  const legacyAdoptionChecked = new Set();

  /** Older builds added templates by name as detached local copies, invisible to the update poll.
   * When a server entry matches such a copy by name *and* coords, adopt it as a tracked remote
   * template so the author's later edits reach it. The coords check keeps a user's own local
   * artwork that happens to share a name from being hijacked.
   */
  const adoptLegacyLocalTemplates = async (templateItems, stream = DEFAULT_TEMPLATE_STREAM) => {
    if (!Array.isArray(templateItems) || templateItems.length === 0) return 0;
    const normalizedStream = normalizeRemoteStream(stream);
    const localCandidates = (templateManager.templatesArray ?? []).filter((template) => {
      if (!template) return false;
      const store = template.storageKey
        ? templateManager.templatesJSON?.templates?.[template.storageKey]
        : null;
      if (template.isRemote === true || store?.remote === true) return false;
      if (store?.timeArchiveMeta) return false;
      return true;
    });
    if (localCandidates.length === 0) return 0;

    const serverEntries = new Map();
    for (const entry of templateItems) {
      const { entryMeta, templateName, remoteStream } = parseTemplateEntry(entry, normalizedStream);
      if (!templateName) continue;
      if (entryMeta?.['deleted'] === true) continue;
      if (remoteStream !== normalizedStream) continue;
      serverEntries.set(templateName, entryMeta);
    }
    if (serverEntries.size === 0) return 0;

    let adopted = 0;
    for (const template of localCandidates) {
      const store = template.storageKey
        ? templateManager.templatesJSON?.templates?.[template.storageKey]
        : null;
      const templateName = template.displayName ?? store?.name ?? null;
      if (!templateName || !serverEntries.has(templateName)) continue;
      const checkKey = `${normalizedStream}:${templateName}`;
      if (legacyAdoptionChecked.has(checkKey)) continue;
      legacyAdoptionChecked.add(checkKey);

      let meta = null;
      try {
        const label = `Template meta "${templateName}" (${normalizedStream})`;
        const response = await gmRequestWithTimeout(getTemplateMetaUrl(templateName, normalizedStream), 'json', label);
        assertResponseOk(response, label);
        meta = getResponseData(response, label) ?? {};
      } catch (err) {
        // Leave the copy alone and allow a retry on a later poll.
        legacyAdoptionChecked.delete(checkKey);
        logSync(`Could not check legacy template "${templateName}" for adoption.`, { level: 'warn', err });
        continue;
      }

      const remoteCoords = parseCoordsValue(meta?.['coords']);
      const localCoords = parseCoordsValue(template.coords ?? store?.coords);
      if (!remoteCoords || !localCoords || remoteCoords.some((n, i) => n !== localCoords[i])) {
        continue;
      }

      const entryMeta = serverEntries.get(templateName);
      template.isRemote = true;
      template.remoteName = templateName;
      template.remoteManual = true;
      template.remoteStream = normalizedStream;
      template.remoteCoords = remoteCoords;
      // Left null on purpose: the update check then sees the template as stale and pulls the
      // current image on the next sync.
      template.remoteUpdatedAt = null;
      template.remoteImageUpdatedAt = null;
      template.remoteFlagsCheckedAt = null;
      template.remoteFlagsAppliedAt = null;
      template.remoteToTop = normalizeFlag(meta?.['to_top'] ?? entryMeta?.['to_top']);
      template.remoteToTopAt = meta?.['to_top_at'] ?? null;
      template.remoteHighlighted = normalizeFlag(meta?.['highlighted'] ?? entryMeta?.['highlighted']);
      template.remoteHighlightedAt = meta?.['highlighted_at'] ?? null;
      template.remoteOrder = normalizeRemoteOrder(meta?.['order'] ?? entryMeta?.['order']);
      if (store) {
        store.remote = true;
        store.remoteName = template.remoteName;
        store.remoteManual = true;
        store.remoteStream = template.remoteStream;
        store.remoteCoords = template.remoteCoords;
        store.remoteUpdatedAt = null;
        store.remoteImageUpdatedAt = null;
        store.remoteFlagsCheckedAt = null;
        store.remoteFlagsAppliedAt = null;
        store.remoteToTop = template.remoteToTop;
        store.remoteToTopAt = template.remoteToTopAt;
        store.remoteHighlighted = template.remoteHighlighted;
        store.remoteHighlightedAt = template.remoteHighlightedAt;
        store.remoteOrder = template.remoteOrder;
      }
      adopted += 1;
      logSync(`Adopted local template "${templateName}" (${normalizedStream}) for remote updates.`);
    }

    if (adopted > 0) {
      await templateManager.storeTemplates();
      templateManager.requestListRebuild?.();
    }
    return adopted;
  };
  let templateUpdatePollId = null;
  let templateUpdatePollInFlight = false;
  let templateUpdatePendingCount = 0;
  let templateFlagSyncInFlight = false;
  let autoSyncPromptKey = null;
  let autoSyncInFlight = false;
  // Serialization for template import. syncTemplateByName decides whether a template already exists
  // locally, then awaits several network round trips before creating it — so two overlapping syncs
  // (auto-update poll + manual sync button) both see "missing" and both create it. These keep any
  // two imports of the same template, and any two full server syncs, from ever overlapping.
  let serverSyncChain = Promise.resolve();
  const inFlightTemplateImports = new Map();

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

  const pruneMissingRemoteTemplates = async (templateItems, stream = DEFAULT_TEMPLATE_STREAM) => {
    if (!Array.isArray(templateItems)) return;
    const normalizedStream = normalizeRemoteStream(stream);
    const serverNames = new Set(
      templateItems
        .map(entry => {
          const { entryMeta, templateName, remoteStream } = parseTemplateEntry(entry, normalizedStream);
          if (entryMeta?.['deleted'] === true) return null;
          if (remoteStream !== normalizedStream) return null;
          return templateName;
        })
        .filter(name => name)
    );
    const missing = (templateManager.templatesArray ?? []).filter(template => {
      if (!template) return false;
      const store = templateManager.templatesJSON?.templates?.[template.storageKey];
      const isRemote = template.isRemote === true || store?.remote === true;
      if (!isRemote) return false;
      if (template.remoteManual === true || store?.remoteManual === true) return false;
      if (getRemoteTemplateStream(template, store) !== normalizedStream) return false;
      const templateName = template.remoteName || template.displayName;
      return !!templateName && !serverNames.has(templateName);
    });
    if (missing.length) {
      logSync(`Pruning ${missing.length} remote template${missing.length === 1 ? '' : 's'} missing from server list...`);
    }
    for (const template of missing) {
      const templateName = template.remoteName || template.displayName || template.storageKey;
      consoleLog(
        `%c${name}%c: Remote template "%s" missing from server list. Deleting local copy.`,
        consoleStyle,
        '',
        templateName
      );
      await templateManager.deleteTemplate(template.storageKey, {
        deferPersist: true,
        deferListRebuild: true,
        suppressStatus: true,
      });
    }
    if (missing.length) {
      await templateManager.storeTemplates();
      templateManager.requestListRebuild?.();
    }
  };

  const syncRemoteTemplateFlags = async (templateItems, stream = DEFAULT_TEMPLATE_STREAM) => {
    if (templateFlagSyncInFlight) return;
    if (!Array.isArray(templateItems) || templateItems.length === 0) return;
    const normalizedStream = normalizeRemoteStream(stream);
    templateFlagSyncInFlight = true;
    try {
      logSync('Syncing remote template flags...');
      let anyChanged = false;
      for (const entry of templateItems) {
        const { entryMeta, templateName, remoteStream } = parseTemplateEntry(entry, normalizedStream);
        if (entryMeta?.['deleted'] === true) { continue; }
        if (!templateName) { continue; }
        const existingTemplate = findRemoteTemplateByIdentity(templateName, remoteStream);
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
              templateName,
              reason
            );
          }
          const metaResponse = await gmRequestWithTimeout(
            getTemplateMetaUrl(templateName, remoteStream),
            "json",
            `Template meta "${templateName}" (${remoteStream})`
          );
          return getResponseData(metaResponse, `Template meta "${templateName}" (${remoteStream})`) ?? {};
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
        logSync('Remote template flags updated.');
      }
    } catch (_) {
      logSync('Remote template flag sync failed.', { level: 'warn', err: _ });
    } finally {
      templateFlagSyncInFlight = false;
    }
  };

  const checkTemplateUpdates = async () => {
    if (templateUpdatePollInFlight) return;
    if (!shouldPollTemplateUpdates()) {
      if (templateUpdatePendingCount !== 0) {
        resetTemplateUpdateBadge();
      }
      return;
    }
    templateUpdatePollInFlight = true;
    try {
      logSync('Checking server for template updates...');
      await waitForImport();
      await dedupeRemoteTemplatesOnce();
      let changedCount = 0;
      const promptPieces = [];
      // Same as syncTemplatesFromServer: overlap the per-stream listing requests, then process
      // the results in order since the handlers below mutate shared template state.
      const polledListings = await Promise.all(
        getConfiguredStreams().map(async (stream) => ({
          stream,
          templateItems: (await fetchTemplateListForStream(stream, 'Template list (poll)'))?.templateItems,
        }))
      );
      const listedKeys = new Set();
      const entriesToCheck = [];
      for (const { stream, templateItems } of polledListings) {
        await adoptLegacyLocalTemplates(templateItems, stream);
        await syncRemoteTemplateFlags(templateItems, stream);
        await pruneMissingRemoteTemplates(templateItems, stream);
        for (const entry of templateItems) {
          const parsed = parseTemplateEntry(entry, stream);
          if (parsed.templateName) {
            listedKeys.add(`${parsed.remoteStream}:${parsed.templateName}`);
          }
          entriesToCheck.push(parsed);
        }
      }
      // Manually added templates may be missing from the listing while still resolving by name;
      // poll those individually so their updates aren't invisible here.
      for (const manual of collectUnlistedManualTemplates(listedKeys)) {
        const entry = await fetchManualTemplateEntry(manual);
        if (entry) {
          entriesToCheck.push(parseTemplateEntry(entry, manual.stream));
        }
      }
      {
        for (const parsed of entriesToCheck) {
          const { entryMeta, templateName, remoteStream } = parsed;
          const updatedAt = entryMeta?.['updated_at'] ?? null;
          const imageUpdatedAt = entryMeta?.['image_updated_at'] ?? null;
          const isDeleted = entryMeta?.['deleted'] === true;
          if (!templateName) { continue; }
          if (isDeleted) { continue; }
          const existingTemplate = findRemoteTemplateByIdentity(templateName, remoteStream);
          const existingStore = existingTemplate?.storageKey
            ? templateManager.templatesJSON?.templates?.[existingTemplate.storageKey]
            : null;
          const existingUpdatedAt =
            existingStore?.remoteUpdatedAt ??
            existingTemplate?.remoteUpdatedAt ??
            null;
          const existingImageUpdatedAt =
            existingStore?.remoteImageUpdatedAt ??
            existingTemplate?.remoteImageUpdatedAt ??
            existingUpdatedAt ??
            null;
          const flagsAppliedAt =
            existingStore?.remoteFlagsAppliedAt ??
            existingTemplate?.remoteFlagsAppliedAt ??
            null;
          const normalizedUpdatedAt = normalizeUpdatedAt(updatedAt);
          const normalizedExistingUpdatedAt = normalizeUpdatedAt(existingUpdatedAt);
          const normalizedImageUpdatedAt = normalizeUpdatedAt(imageUpdatedAt ?? updatedAt);
          const normalizedExistingImageUpdatedAt = normalizeUpdatedAt(existingImageUpdatedAt);
          const normalizedFlagsAppliedAt = normalizeUpdatedAt(flagsAppliedAt);
          const imageChanged = !!normalizedImageUpdatedAt && normalizedImageUpdatedAt !== normalizedExistingImageUpdatedAt;
          if (normalizedUpdatedAt && normalizedFlagsAppliedAt && normalizedUpdatedAt === normalizedFlagsAppliedAt && !imageChanged) {
            continue;
          }
          const isMissingLocal = !existingTemplate;
          const isChanged = isMissingLocal
            || imageChanged
            || (normalizedUpdatedAt && normalizedUpdatedAt !== normalizedExistingUpdatedAt);
          if (isChanged) {
            promptPieces.push(`${remoteStream}:${templateName}::${normalizedUpdatedAt ?? 'missing'}::${normalizedImageUpdatedAt ?? 'missing'}`);
            const updateReasons = [];
            if (isMissingLocal) { updateReasons.push('missing-local'); }
            if (normalizedUpdatedAt && normalizedUpdatedAt !== normalizedExistingUpdatedAt) { updateReasons.push('updated_at-changed'); }
            if (imageChanged) { updateReasons.push('image_updated_at-changed'); }
            const reasonText = updateReasons.length ? updateReasons.join(', ') : 'unknown';
            consoleLog(
              `%c${name}%c: Template update flagged for "%s" (stream: %s, reason: %s). updated_at=%s, local_updated_at=%s, image_updated_at=%s, local_image_updated_at=%s, flags_applied_at=%s`,
              consoleStyle,
              '',
              templateName,
              remoteStream,
              reasonText,
              updatedAt,
              existingUpdatedAt,
              imageUpdatedAt,
              existingImageUpdatedAt,
              flagsAppliedAt
            );
            changedCount += 1;
          }
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
      if (changedCount !== templateUpdatePendingCount) {
        templateUpdatePendingCount = changedCount;
        setTemplateUpdateBadge(changedCount);
      }
      logSync(`Template update check finished. Pending updates: ${changedCount}.`);
    } catch (err) {
      logSync('Template update check failed.', { level: 'warn', err });
    } finally {
      templateUpdatePollInFlight = false;
    }
  };

  const startTemplateUpdatePolling = () => {
    if (templateUpdatePollId) return;
    templateUpdatePollId = setInterval(checkTemplateUpdates, templateUpdatePollMs);
    checkTemplateUpdates();
  };

  const stopTemplateUpdatePolling = () => {
    if (templateUpdatePollId) {
      clearInterval(templateUpdatePollId);
      templateUpdatePollId = null;
    }
    templateUpdatePollInFlight = false;
    resetTemplateUpdateBadge();
  };

  const resetTemplateUpdateBadge = () => {
    templateUpdatePendingCount = 0;
    setTemplateUpdateBadge(0);
  };

  const readTemplatePayloadFromStream = async ({
    templateName,
    remoteStream = DEFAULT_TEMPLATE_STREAM,
    entryMeta = null,
    statusHandler,
  } = {}) => {
    const trimmedName = String(templateName ?? '').trim();
    if (!trimmedName) {
      throw new Error('Template name is required.');
    }
    const normalizedStream = normalizeRemoteStream(entryMeta?.['stream'] ?? remoteStream);
    const updatedAt = entryMeta?.['updated_at'] ?? null;
    const imageUpdatedAt = entryMeta?.['image_updated_at'] ?? null;
    const listOrder = normalizeRemoteOrder(entryMeta?.['order']);

    // Meta and image are independent — the image URL only needs the name and stream — so fire
    // both and let them overlap instead of paying two serial round trips per template.
    logSync(`Fetching template meta and image for "${trimmedName}" from stream "${normalizedStream}"...`, { statusHandler });
    const metaRequest = gmRequestWithTimeout(
      getTemplateMetaUrl(trimmedName, normalizedStream),
      "json",
      `Template meta "${trimmedName}" (${normalizedStream})`
    );
    const imageRequest = gmRequestWithTimeout(
      getTemplateImageUrl(trimmedName, normalizedStream),
      "blob",
      `Template image "${trimmedName}" (${normalizedStream})`
    );
    // The meta checks below can throw before the image is awaited; without this the in-flight
    // image request would surface as an unhandled rejection.
    imageRequest.catch(() => {});

    const metaResponse = await metaRequest;
    assertResponseOk(metaResponse, `Template meta "${trimmedName}" (${normalizedStream})`);
    const meta = getResponseData(metaResponse, `Template meta "${trimmedName}" (${normalizedStream})`) ?? {};
    const coords = Array.isArray(meta?.['coords']) ? meta['coords'].map(Number) : null;
    if (!coords || coords.length !== 4 || coords.some((n) => !Number.isFinite(n))) {
      throw new Error(`Skipped "${trimmedName}": invalid coords.`);
    }
    const metaUpdatedAt = meta?.['updated_at'] ?? null;
    const metaImageUpdatedAt = meta?.['image_updated_at'] ?? imageUpdatedAt ?? null;
    const toTop = normalizeFlag(meta?.['to_top'] ?? entryMeta?.['to_top']);
    const toTopAt = meta?.['to_top_at'] ?? null;
    const highlighted = normalizeFlag(meta?.['highlighted'] ?? entryMeta?.['highlighted']);
    const highlightedAt = meta?.['highlighted_at'] ?? null;
    const metaOrder = normalizeRemoteOrder(meta?.['order']);
    const order = metaOrder !== null ? metaOrder : listOrder;

    const imageResponse = await imageRequest;
    assertResponseOk(imageResponse, `Template image "${trimmedName}" (${normalizedStream})`);
    const imageBlob = imageResponse.response;
    if (!imageBlob) {
      throw new Error(`Template image "${trimmedName}" failed: empty blob`);
    }
    const file = new File([imageBlob], `${trimmedName}.png`, { type: imageBlob?.type || "image/png" });

    return {
      trimmedName,
      normalizedStream,
      file,
      coords,
      updatedAt: updatedAt || metaUpdatedAt,
      imageUpdatedAt: imageUpdatedAt || metaImageUpdatedAt || updatedAt || metaUpdatedAt,
      toTop,
      toTopAt,
      highlighted,
      highlightedAt,
      order,
    };
  };

  const runSyncTemplateByName = async ({
    templateName,
    entryMeta = null,
    remoteStream = DEFAULT_TEMPLATE_STREAM,
    onStatus,
    onError,
    defaultEnabled = true,
    remoteManual = false,
    syncToggleList,
    buildTemplateFilterList: buildTemplateFilterListOverride,
    buildColorFilterList: buildColorFilterListOverride,
    force = true,
    refreshUi = true,
    replaceExistingMatches = false,
  } = {}) => {
    const statusHandler = typeof onStatus === 'function' ? onStatus : autoSyncOnStatus;
    const trimmedName = String(templateName ?? '').trim();
    if (!trimmedName) {
      const errorMessage = 'Template name is required.';
      if (typeof onError === 'function') {
        onError(errorMessage);
      }
      throw new Error(errorMessage);
    }
    try {
      const normalizedStream = normalizeRemoteStream(entryMeta?.['stream'] ?? remoteStream);
      const updatedAt = entryMeta?.['updated_at'] ?? null;
      const imageUpdatedAt = entryMeta?.['image_updated_at'] ?? null;
      const listOrder = normalizeRemoteOrder(entryMeta?.['order']);
      const matchingTemplates = (templateManager.templatesArray ?? []).filter(t => {
        if (!t) return false;
        const sameName = t.displayName === trimmedName || t.remoteName === trimmedName;
        if (!sameName) return false;
        const store = t.storageKey
          ? templateManager.templatesJSON?.templates?.[t.storageKey]
          : null;
        const isRemote = t.isRemote === true || store?.remote === true;
        if (!isRemote) return sameName;
        return getRemoteTemplateStream(t, store) === normalizedStream;
      });
      const matchingRemoteTemplates = matchingTemplates.filter(t => {
        const store = t.storageKey
          ? templateManager.templatesJSON?.templates?.[t.storageKey]
          : null;
        if (!(t.isRemote === true || store?.remote === true)) return false;
        return getRemoteTemplateStream(t, store) === normalizedStream;
      });
      const preferredTemplate =
        matchingRemoteTemplates.find(t => t.enabled) ??
        matchingRemoteTemplates[0] ??
        matchingTemplates[0];
      const existingStore = preferredTemplate?.storageKey
        ? templateManager.templatesJSON?.templates?.[preferredTemplate.storageKey]
        : null;
      const existingPalette = preferredTemplate?.colorPalette ? { ...preferredTemplate.colorPalette } : null;
      const existingRemoteManual = preferredTemplate?.remoteManual === true || existingStore?.remoteManual === true;
      const existingEnabled = matchingRemoteTemplates.length
        ? matchingRemoteTemplates.some(t => t.enabled)
        : (preferredTemplate?.enabled ?? existingStore?.enabled ?? defaultEnabled);
      const existingUpdatedAt =
        existingStore?.remoteUpdatedAt ??
        preferredTemplate?.remoteUpdatedAt ??
        null;
      const existingImageUpdatedAt =
        existingStore?.remoteImageUpdatedAt ??
        preferredTemplate?.remoteImageUpdatedAt ??
        existingUpdatedAt ??
        null;
      const flagsAppliedAt =
        existingStore?.remoteFlagsAppliedAt ??
        preferredTemplate?.remoteFlagsAppliedAt ??
        null;
      const normalizedExistingUpdatedAt = normalizeUpdatedAt(existingUpdatedAt);
      const normalizedUpdatedAt = normalizeUpdatedAt(updatedAt);
      const normalizedExistingImageUpdatedAt = normalizeUpdatedAt(existingImageUpdatedAt);
      const normalizedImageUpdatedAt = normalizeUpdatedAt(imageUpdatedAt ?? updatedAt);
      const normalizedFlagsAppliedAt = normalizeUpdatedAt(flagsAppliedAt);
      const imageChanged = !!normalizedImageUpdatedAt && normalizedImageUpdatedAt !== normalizedExistingImageUpdatedAt;
      const updatedChanged = !!normalizedUpdatedAt && normalizedUpdatedAt !== normalizedExistingUpdatedAt;
      const flagsOnlyAlreadyApplied = updatedChanged
        && !!normalizedFlagsAppliedAt
        && normalizedUpdatedAt === normalizedFlagsAppliedAt;
      const existingOtherCount = Number(
        preferredTemplate?.colorPalette?.other?.count
        ?? existingStore?.palette?.other?.count
        ?? 0
      );
      // Old remote templates may contain non-palette "other" colors due browser decode variance.
      // Rebuild once even without remote image timestamp changes to normalize them.
      const needsPaletteRebuild = existingOtherCount > 0;
      if (!force && !imageChanged && (!updatedChanged || flagsOnlyAlreadyApplied) && !needsPaletteRebuild) {
        return null;
      }
      const payload = await readTemplatePayloadFromStream({
        templateName: trimmedName,
        remoteStream: normalizedStream,
        entryMeta,
        statusHandler,
      });
      const created = await templateManager.createTemplate(
        payload.file,
        trimmedName,
        payload.coords,
        {
          convertToPalette: true,
          normalizeSamplesToPalette: true,
          remote: true,
          remoteName: trimmedName,
          remoteManual: remoteManual || existingRemoteManual,
          remoteStream: normalizedStream,
          remoteCoords: payload.coords,
          remoteUpdatedAt: payload.updatedAt,
          remoteImageUpdatedAt: payload.imageUpdatedAt,
          remoteToTop: payload.toTop,
          remoteToTopAt: payload.toTopAt,
          remoteHighlighted: payload.highlighted,
          remoteHighlightedAt: payload.highlightedAt,
          remoteOrder: payload.order,
          enabled: preferredTemplate ? existingEnabled : defaultEnabled,
          deferPersist: true,
          deferListRebuild: true,
          deferOverlayRefresh: true,
          suppressStatus: true,
        }
      );
      const createdStore = created?.storageKey
        ? templateManager.templatesJSON?.templates?.[created.storageKey]
        : null;
      if (created && existingPalette) {
        Object.entries(existingPalette).forEach(([rgb, metaValue]) => {
          if (created.colorPalette?.[rgb]) {
            created.colorPalette[rgb].enabled = !!metaValue?.enabled;
          }
        });
        if (createdStore) {
          createdStore.palette = created.colorPalette;
        }
      }

      const templatesToReplace = replaceExistingMatches ? matchingTemplates : matchingRemoteTemplates;
      for (const template of templatesToReplace) {
        if (template?.storageKey) {
          await templateManager.deleteTemplate(template.storageKey, {
            deferPersist: true,
            deferListRebuild: true,
            suppressStatus: true,
          });
        }
      }
      if (refreshUi) {
        await templateManager.storeTemplates();
        safeCall(syncToggleList);
        templateManager.createOverlayOnMapVisibleOnly(created?.sortID ?? null);
        safeCall(buildTemplateFilterListOverride ?? buildTemplateFilterList);
        safeCall(buildColorFilterListOverride ?? autoSyncBuildColorFilterList);
        resetTemplateUpdateBadge();
        checkTemplateUpdates();
      }
      return created;
    } catch (err) {
      logSync(`Failed to sync template "${trimmedName}".`, { level: 'warn', err, statusHandler });
      const errorMessage = err?.message
        ? `Failed to sync template "${trimmedName}": ${err.message}`
        : `Failed to sync template "${trimmedName}".`;
      if (typeof onError === 'function') {
        onError(errorMessage);
      }
      throw err;
    }
  };

  /** Serializing wrapper: one import per (stream, name) at a time.
   * Concurrent callers await the in-flight import instead of starting a second one, which is what
   * produced duplicate templates when the auto-update poll and a manual sync overlapped.
   */
  const syncTemplateByName = async (options = {}) => {
    const trimmedName = String(options?.templateName ?? '').trim();
    if (!trimmedName) return runSyncTemplateByName(options);
    const normalizedStream = normalizeRemoteStream(
      options?.entryMeta?.['stream'] ?? options?.remoteStream ?? DEFAULT_TEMPLATE_STREAM
    );
    const key = `${normalizedStream}:${trimmedName}`;
    const pending = inFlightTemplateImports.get(key);
    if (pending) {
      // Await the in-flight import, then re-run so this caller's own options (force, UI refresh,
      // replaceExistingMatches) still apply — by then the existence check sees the imported copy.
      try { await pending; } catch (_) {}
    }
    const run = runSyncTemplateByName(options);
    inFlightTemplateImports.set(key, run);
    try {
      return await run;
    } finally {
      if (inFlightTemplateImports.get(key) === run) inFlightTemplateImports.delete(key);
    }
  };

  /** Every local template whose name matches, regardless of stream or remote/local origin. */
  const findLocalTemplatesByName = (trimmedName) => (
    (templateManager.templatesArray ?? []).filter((template) => {
      if (!template) return false;
      const store = template.storageKey
        ? templateManager.templatesJSON?.templates?.[template.storageKey]
        : null;
      return (
        template.displayName === trimmedName
        || template.remoteName === trimmedName
        || store?.name === trimmedName
        || store?.remoteName === trimmedName
      );
    })
  );

  const importTemplateByName = async ({
    templateName,
    onStatus,
    onError,
    defaultEnabled = true,
    syncToggleList,
    buildTemplateFilterList: buildTemplateFilterListOverride,
    buildColorFilterList: buildColorFilterListOverride,
    refreshUi = true,
    syncExisting = false,
    remoteManual = false,
    replaceExistingMatches = false,
    onExisting,
  } = {}) => {
    const statusHandler = typeof onStatus === 'function' ? onStatus : autoSyncOnStatus;
    const trimmedName = String(templateName ?? '').trim();
    if (!trimmedName) {
      const errorMessage = 'Template name is required.';
      if (typeof onError === 'function') {
        onError(errorMessage);
      }
      throw new Error(errorMessage);
    }
    try {
      let payload = null;
      const streams = getConfiguredStreams();
      // A template with this name may already exist locally — possibly imported from a different
      // stream. Never create a second copy: update the existing one in place and warn the caller.
      const existingMatches = findLocalTemplatesByName(trimmedName);
      const existingRemoteMatch = existingMatches.find((template) => {
        const store = template?.storageKey
          ? templateManager.templatesJSON?.templates?.[template.storageKey]
          : null;
        return template?.isRemote === true || store?.remote === true;
      }) ?? null;
      if (existingMatches.length > 0) {
        replaceExistingMatches = true;
        // Always re-sync as a tracked remote template: a tracked copy must stay tracked, and a
        // detached local copy (added by an older build) has to become tracked so the author's
        // later edits on the bot reach it through the update poll.
        syncExisting = true;
        const warning = existingRemoteMatch
          ? `Template "${trimmedName}" already exists — updating the existing remote template instead of creating a new one.`
          : `Template "${trimmedName}" already exists — updating the existing local copy and tracking it for remote updates.`;
        logSync(warning, { statusHandler });
        if (typeof onExisting === 'function') {
          try { onExisting({ warning, templates: existingMatches, isRemote: !!existingRemoteMatch }); } catch (_) {}
        }
      }
      if (syncExisting) {
        let syncedTemplate = null;
        let syncedStream = null;
        // Try the stream the existing copy came from first so a same-named template in another
        // stream can't hijack it.
        const existingStream = existingRemoteMatch
          ? getRemoteTemplateStream(
            existingRemoteMatch,
            existingRemoteMatch.storageKey
              ? templateManager.templatesJSON?.templates?.[existingRemoteMatch.storageKey]
              : null
          )
          : null;
        const syncStreams = existingStream
          ? [existingStream, ...streams.filter((stream) => normalizeRemoteStream(stream) !== existingStream)]
          : streams;
        for (const stream of syncStreams) {
          try {
            syncedTemplate = await syncTemplateByName({
              templateName: trimmedName,
              remoteStream: stream,
              onStatus,
              onError,
              defaultEnabled,
              remoteManual,
              syncToggleList,
              buildTemplateFilterList: buildTemplateFilterListOverride,
              buildColorFilterList: buildColorFilterListOverride,
              force: true,
              refreshUi,
              replaceExistingMatches,
            });
            syncedStream = stream;
            break;
          } catch (err) {
            if (/HTTP 404/.test(String(err?.message || ''))) {
              continue;
            }
            throw err;
          }
        }
        if (!syncedTemplate) {
          throw new Error(`Template "${trimmedName}" was not found in configured streams: ${streams.join(', ')}.`);
        }
        if (typeof statusHandler === 'function') {
          statusHandler(`Synced "${trimmedName}" from stream "${syncedStream}" as a tracked template.`);
        }
        return syncedTemplate;
      }
      for (const stream of streams) {
        try {
          payload = await readTemplatePayloadFromStream({
            templateName: trimmedName,
            remoteStream: stream,
            statusHandler,
          });
          break;
        } catch (err) {
          if (/HTTP 404/.test(String(err?.message || ''))) {
            continue;
          }
          throw err;
        }
      }
      if (!payload) {
        throw new Error(`Template "${trimmedName}" was not found in configured streams: ${streams.join(', ')}.`);
      }

      const matchingTemplates = replaceExistingMatches ? findLocalTemplatesByName(trimmedName) : [];
      const preferredTemplate = matchingTemplates.find((template) => template?.enabled) ?? matchingTemplates[0] ?? null;
      const preferredStore = preferredTemplate?.storageKey
        ? templateManager.templatesJSON?.templates?.[preferredTemplate.storageKey]
        : null;
      const existingPalette = preferredTemplate?.colorPalette ? { ...preferredTemplate.colorPalette } : null;
      const nextEnabled = preferredTemplate?.enabled ?? preferredStore?.enabled ?? defaultEnabled;

      const created = await templateManager.createTemplate(
        payload.file,
        trimmedName,
        payload.coords,
        {
          convertToPalette: true,
          normalizeSamplesToPalette: true,
          enabled: nextEnabled,
        }
      );
      if (created && existingPalette) {
        Object.entries(existingPalette).forEach(([rgb, metaValue]) => {
          if (created.colorPalette?.[rgb]) {
            created.colorPalette[rgb].enabled = !!metaValue?.enabled;
          }
        });
        const createdStore = created?.storageKey
          ? templateManager.templatesJSON?.templates?.[created.storageKey]
          : null;
        if (createdStore) {
          createdStore.palette = created.colorPalette;
        }
      }
      for (const template of matchingTemplates) {
        if (template?.storageKey) {
          await templateManager.deleteTemplate(template.storageKey, {
            deferPersist: true,
            deferListRebuild: true,
            suppressStatus: true,
          });
        }
      }
      if (refreshUi) {
        if (matchingTemplates.length > 0) {
          await templateManager.storeTemplates();
        }
        safeCall(syncToggleList);
        safeCall(buildTemplateFilterListOverride ?? buildTemplateFilterList);
        safeCall(buildColorFilterListOverride ?? autoSyncBuildColorFilterList);
      }
      if (typeof statusHandler === 'function') {
        statusHandler(
          matchingTemplates.length > 0
            ? `Updated existing template "${trimmedName}" from stream "${payload.normalizedStream}".`
            : `Imported "${trimmedName}" from stream "${payload.normalizedStream}" as a local template.`
        );
      }
      return created;
    } catch (err) {
      logSync(`Failed to import template "${trimmedName}" by name.`, { level: 'warn', err, statusHandler });
      const errorMessage = err?.message
        ? `Failed to import template "${trimmedName}": ${err.message}`
        : `Failed to import template "${trimmedName}".`;
      if (typeof onError === 'function') {
        onError(errorMessage);
      }
      throw err;
    }
  };

  const runSyncTemplatesFromServer = async ({
    onStatus,
    onError,
    syncToggleList,
    buildTemplateFilterList: buildTemplateFilterListOverride,
    buildColorFilterList: buildColorFilterListOverride,
  } = {}) => {
    const statusHandler = typeof onStatus === 'function' ? onStatus : autoSyncOnStatus;
    try {
      logSync('Starting template sync...', { statusHandler });
      await waitForImport();
      await dedupeRemoteTemplatesOnce();
      if (typeof statusHandler === 'function') statusHandler('Syncing templates from server...');
      const streams = getConfiguredStreams();
      let importedCount = 0;
      let hasServerTemplates = false;
      // Stream listings don't depend on each other — fetch them together rather than one
      // round trip after another. Template creation below stays sequential because it mutates
      // shared manager state (sortID allocation, templatesArray).
      const streamListings = await Promise.all(
        streams.map(async (stream) => ({
          stream,
          templateItems: (await fetchTemplateListForStream(stream, 'Template list'))?.templateItems,
        }))
      );
      const listedKeys = new Set();
      for (const { stream, templateItems } of streamListings) {
        if (!Array.isArray(templateItems) || templateItems.length === 0) {
          continue;
        }
        hasServerTemplates = true;
        await adoptLegacyLocalTemplates(templateItems, stream);
        for (const entry of templateItems) {
          const { entryMeta, templateName, remoteStream } = parseTemplateEntry(entry, stream);
          if (!templateName) { continue; }
          listedKeys.add(`${remoteStream}:${templateName}`);
          if (entryMeta?.['deleted'] === true) { continue; }
          const created = await syncTemplateByName({
            templateName,
            entryMeta,
            remoteStream,
            onStatus: statusHandler,
            defaultEnabled: false,
            remoteManual: false,
            force: false,
            refreshUi: false,
          });
          if (created) {
            importedCount += 1;
          }
        }
      }
      // Templates added by name may not appear in any listing, so refresh them from their meta.
      for (const manual of collectUnlistedManualTemplates(listedKeys)) {
        const entryMeta = await fetchManualTemplateEntry(manual);
        if (!entryMeta) { continue; }
        hasServerTemplates = true;
        const created = await syncTemplateByName({
          templateName: manual.templateName,
          entryMeta,
          remoteStream: manual.stream,
          onStatus: statusHandler,
          defaultEnabled: false,
          remoteManual: true,
          force: false,
          refreshUi: false,
        });
        if (created) {
          importedCount += 1;
        }
      }
      if (!hasServerTemplates) {
        if (typeof statusHandler === 'function') statusHandler('No server templates found.');
        logSync('No server templates found.', { statusHandler });
        return 0;
      }
      if (importedCount > 0) {
        await templateManager.storeTemplates();
        safeCall(syncToggleList);
        templateManager.createOverlayOnMapVisibleOnly();
        safeCall(buildTemplateFilterListOverride ?? buildTemplateFilterList);
        safeCall(buildColorFilterListOverride ?? autoSyncBuildColorFilterList);
      }
      if (typeof statusHandler === 'function') {
        statusHandler(`Synced ${importedCount} template${importedCount === 1 ? '' : 's'}.`);
      }
      logSync(`Sync finished. Imported ${importedCount} template${importedCount === 1 ? '' : 's'}.`, { statusHandler });
      resetTemplateUpdateBadge();
      checkTemplateUpdates();
      return importedCount;
    } catch (err) {
      logSync('Failed to sync server templates.', { level: 'warn', err, statusHandler });
      const errorMessage = err?.message
        ? `Failed to sync server templates: ${err.message}`
        : 'Failed to sync server templates.';
      if (typeof onError === 'function') {
        onError(errorMessage);
      }
      throw err;
    }
  };

  /** Serializing wrapper: full server syncs run one at a time.
   * Chained rather than dropped, so a manual sync clicked mid-auto-sync still runs (and still
   * reports its own status) — it just waits its turn, by which point there is nothing left to
   * import and it finishes immediately.
   */
  const syncTemplatesFromServer = async (options = {}) => {
    const run = serverSyncChain.then(
      () => runSyncTemplatesFromServer(options),
      () => runSyncTemplatesFromServer(options)
    );
    // Keep the chain alive regardless of this run's outcome; the caller still sees the rejection.
    serverSyncChain = run.catch(() => {});
    return run;
  };

  const fetchRemoteTemplateNames = async () => {
    const url = `${templateSyncBaseUrl}/templates?stream=all`;
    const response = await gmRequestWithTimeout(url, 'json', 'Autocomplete');
    assertResponseOk(response, 'Autocomplete');
    const data = getResponseData(response, 'Autocomplete') ?? {};
    const items = Array.isArray(data) ? data : (Array.isArray(data?.['templates']) ? data['templates'] : []);
    return items
      .map((entry) => parseTemplateEntry(entry, DEFAULT_TEMPLATE_STREAM).templateName)
      .filter((name) => !!name);
  };

  /** Lists every remote template together with the stream it lives in.
   * `fetchRemoteTemplateNames` drops the stream, which callers need to fetch the image.
   * @returns {Promise<Array<{name: string, stream: string}>>} The remote template entries.
   */
  const fetchRemoteTemplateEntries = async () => {
    const url = `${templateSyncBaseUrl}/templates?stream=all`;
    const response = await gmRequestWithTimeout(url, 'json', 'Template entries');
    assertResponseOk(response, 'Template entries');
    const data = getResponseData(response, 'Template entries') ?? {};
    const items = Array.isArray(data) ? data : (Array.isArray(data?.['templates']) ? data['templates'] : []);
    const entries = [];
    for (const item of items) {
      const { templateName, remoteStream } = parseTemplateEntry(item, DEFAULT_TEMPLATE_STREAM);
      if (templateName) entries.push({ name: templateName, stream: remoteStream });
    }
    return entries;
  };

  /** Downloads a remote template's image without registering it as a map template.
   * @param {string} templateName - The remote template name.
   * @param {string} [remoteStream] - The stream the template lives in.
   * @returns {Promise<File>} The template image as a PNG file.
   */
  const fetchRemoteTemplateFile = async (templateName, remoteStream = DEFAULT_TEMPLATE_STREAM) => {
    const trimmedName = String(templateName ?? '').trim();
    if (!trimmedName) throw new Error('Template name is required.');
    const normalizedStream = normalizeRemoteStream(remoteStream);
    const label = `Template image "${trimmedName}" (${normalizedStream})`;
    const response = await gmRequestWithTimeout(
      getTemplateImageUrl(trimmedName, normalizedStream),
      'blob',
      label
    );
    assertResponseOk(response, label);
    const imageBlob = response.response;
    if (!imageBlob) throw new Error(`${label} failed: empty blob`);
    return new File([imageBlob], `${trimmedName}.png`, { type: imageBlob?.type || 'image/png' });
  };

  return {
    checkTemplateUpdates,
    importTemplateByName,
    fetchRemoteTemplateNames,
    fetchRemoteTemplateEntries,
    fetchRemoteTemplateFile,
    startTemplateUpdatePolling,
    stopTemplateUpdatePolling,
    resetTemplateUpdateBadge,
    syncTemplateByName,
    syncTemplatesFromServer
  };
}

