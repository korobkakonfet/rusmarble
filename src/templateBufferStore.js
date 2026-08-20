/** @file IndexedDB store for template tile/sample buffers.
 *
 * These buffers used to live in GM storage. Tampermonkey moves GM storage over Chrome's
 * extension messaging channel, which caps a message at 64MiB — and it is the *total* across a
 * script's values that hits the ceiling, not any single key. Once a user accumulated enough
 * large templates, the whole script stopped loading with
 * "Unchecked runtime.lastError: Message exceeded maximum allowed size of 64MiB",
 * and no amount of per-key chunking helped because the aggregate was the problem.
 *
 * IndexedDB is same-origin page storage: nothing crosses the extension channel, so that ceiling
 * does not apply. It also structured-clones `Uint8Array` natively, which removes two costs that
 * the GM path could not avoid:
 *   - base64, which inflated every buffer by ~33%
 *   - JSON.stringify/parse over megabytes, plus the gzip pass added to fight the size cap
 * Storing raw bytes is both smaller and much faster, which is why persisting no longer needs a
 * worker round trip.
 *
 * Small metadata (bmTemplates, bmUserSettings, coords) stays in GM storage: it is well under any
 * limit and benefits from Tampermonkey's cross-tab sync.
 *
 * @since 0.87.80
 */

const DB_NAME = 'RusMarbleTemplates';
const DB_VERSION = 1;
const STORE_NAME = 'templateBuffers';

let dbPromise = null;
let persistRequested = false;

/** Asks the browser to exempt this origin's storage from routine eviction.
 *
 * This matters most on mobile. Extension storage (where these buffers used to live) is never
 * evicted; IndexedDB is — WebKit clears it for origins not visited in about a week, and both iOS
 * and Android evict under storage pressure. Without this, leaving the site alone long enough
 * loses the tile buffers while the metadata in GM storage survives, which presents as templates
 * that exist but render nothing.
 *
 * Best-effort by design: browsers may grant, deny, or not implement it, and a denial is not an
 * error worth surfacing — it just means eviction stays possible.
 * @returns {Promise<boolean>} whether storage is persistent
 */
export async function requestPersistentStorage() {
  if (persistRequested) return true;
  persistRequested = true;
  try {
    if (!navigator?.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch (_) {
    return false;
  }
}

/** Reports how much of the origin's storage quota is in use, when the browser exposes it. */
export async function estimateStorageQuota() {
  try {
    if (!navigator?.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return {
      usage,
      quota,
      usageMiB: Number.isFinite(usage) ? (usage / 1048576).toFixed(2) : null,
      quotaMiB: Number.isFinite(quota) ? (quota / 1048576).toFixed(2) : null,
      persisted: (await navigator.storage.persisted?.()) ?? false,
    };
  } catch (_) {
    return null;
  }
}

/** True when this realm can use IndexedDB at all (private modes can disable it). */
export const canUseTemplateBufferDb = () => typeof indexedDB !== 'undefined' && !!indexedDB;

/** Opens (and upgrades) the database, memoizing the connection.
 * A failed open resets the memo so a later call can retry rather than caching the failure.
 */
function openDb() {
  if (!canUseTemplateBufferDb()) return Promise.reject(new Error('IndexedDB unavailable.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'storageKey' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Fire-and-forget: never block opening the DB on the permission result.
      void requestPersistentStorage();
      // A version change from another tab invalidates this handle; drop it so the next call
      // reopens instead of using a connection that is about to be force-closed.
      db.onversionchange = () => { try { db.close(); } catch (_) {} dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Failed to open template buffer DB.'));
    request.onblocked = () => reject(new Error('Template buffer DB open blocked by another tab.'));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

/** Runs one transaction and resolves when it commits.
 * Resolving on `transaction.oncomplete` rather than on the request matters for writes: the
 * request succeeds before the data is durable, and the pagehide flush needs the commit.
 */
function runTransaction(mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE_NAME, mode);
    } catch (error) {
      reject(error);
      return;
    }
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try {
      result = work(store);
    } catch (error) {
      try { transaction.abort(); } catch (_) {}
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(typeof result?.getResult === 'function' ? result.getResult() : result);
    transaction.onerror = () => reject(transaction.error || new Error('Template buffer transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Template buffer transaction aborted.'));
  }));
}

/** Wraps an IDBRequest so runTransaction can hand back its result after the commit. */
const requestResult = (request) => ({ getResult: () => request.result });

/** Reads one template's buffers. Returns null when absent.
 * @returns {Promise<{tiles:object, samples:object}|null>}
 */
export async function readTemplateBuffers(storageKey) {
  const record = await runTransaction('readonly', (store) => requestResult(store.get(storageKey)));
  if (!record || typeof record !== 'object') return null;
  return {
    tiles: (record.tiles && typeof record.tiles === 'object') ? record.tiles : {},
    samples: (record.samples && typeof record.samples === 'object') ? record.samples : {},
  };
}

/** Writes one template's buffers, replacing whatever was there.
 * `tiles`/`samples` are plain objects of tileKey -> Uint8Array; they are stored as-is, so no
 * base64 or JSON encoding happens anywhere on this path.
 */
export async function writeTemplateBuffers(storageKey, { tiles = {}, samples = {} } = {}) {
  let bytes = 0;
  for (const source of [tiles, samples]) {
    for (const value of Object.values(source)) {
      if (value instanceof Uint8Array) bytes += value.length;
      else if (typeof value === 'string') bytes += value.length;
    }
  }
  await runTransaction('readwrite', (store) => {
    store.put({ storageKey, tiles, samples, bytes, updatedAt: Date.now() });
  });
  return bytes;
}

/** Removes one template's buffers. */
export async function deleteTemplateBuffers(storageKey) {
  await runTransaction('readwrite', (store) => { store.delete(storageKey); });
}

/** Every storageKey currently held. */
export async function listTemplateBufferKeys() {
  const keys = await runTransaction('readonly', (store) => requestResult(store.getAllKeys()));
  return Array.isArray(keys) ? keys : [];
}

/** Per-template byte totals, for the storage report. */
export async function reportTemplateBufferBytes() {
  const records = await runTransaction('readonly', (store) => requestResult(store.getAll()));
  const rows = [];
  for (const record of (Array.isArray(records) ? records : [])) {
    let bytes = Number(record?.bytes);
    if (!Number.isFinite(bytes)) {
      bytes = 0;
      for (const source of [record?.tiles, record?.samples]) {
        for (const value of Object.values(source || {})) {
          if (value instanceof Uint8Array) bytes += value.length;
          else if (typeof value === 'string') bytes += value.length;
        }
      }
    }
    rows.push({ storageKey: record.storageKey, bytes, updatedAt: record?.updatedAt ?? null });
  }
  return rows;
}
