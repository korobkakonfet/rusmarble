/** Keeps decoded chunk samples resident in the template workers between tile scans.
 *
 * Every tile scan used to re-encode each chunk's samples on the main thread, transfer them, and
 * decode (and palette-snap) them again in the worker, although the samples of a chunk rarely
 * change. Scans of a tile are now pinned to one worker (templateWorkerManager.getSlotForKey), which
 * keeps the decoded samples in a byte-capped LRU; the main thread remembers what it has sent where
 * and ships bytes only when the worker doesn't have them.
 * @since 0.87.104
 */

/** Approximate retained size of decoded samples: x,y (2 bytes each) + flags,r,g,b,a (1 each). */
export const getSampleDataBytes = (sampleData) => Math.max(0, Number(sampleData?.count) | 0) * 9;

// ── main thread ──────────────────────────────────────────────────────────────────────────────

// Samples objects are replaced, never edited in place, when a chunk changes (re-extraction,
// position edit, sync), so object identity is a safe cache key. WeakMap: no retention.
const residentSampleIds = new WeakMap();
let nextResidentSampleId = 1;

export const getResidentSampleId = (sampleData) => {
  if (!sampleData || typeof sampleData !== 'object') return 0;
  let id = residentSampleIds.get(sampleData);
  if (!id) {
    id = nextResidentSampleId++;
    residentSampleIds.set(sampleData, id);
  }
  return id;
};

/** What the main thread believes each worker slot holds. Only a hint: a stale "yes" costs one
 * retry with bytes, which the worker reports back as missing.
 */
export class SampleResidencyHints {
  constructor() {
    this.bySlot = new Map(); // slot -> Set<sampleId>
    this.poolEpoch = null;
  }

  /** Forget everything when the worker pool was recreated. */
  syncPoolEpoch(poolEpoch) {
    if (this.poolEpoch !== poolEpoch) {
      this.bySlot.clear();
      this.poolEpoch = poolEpoch;
    }
  }

  has(slot, sampleId) {
    return this.bySlot.get(slot)?.has(sampleId) === true;
  }

  add(slot, sampleId) {
    let set = this.bySlot.get(slot);
    if (!set) {
      set = new Set();
      this.bySlot.set(slot, set);
    }
    set.add(sampleId);
  }

  removeAll(slot, sampleIds) {
    const set = this.bySlot.get(slot);
    if (!set || !Array.isArray(sampleIds)) return;
    for (const sampleId of sampleIds) set.delete(sampleId);
  }
}

// ── worker ───────────────────────────────────────────────────────────────────────────────────

/** Byte-capped LRU of decoded samples, keyed by resident sample id. */
export class WorkerSampleCache {
  constructor(maxBytes) {
    this.maxBytes = Math.max(0, Number(maxBytes) || 0);
    this.entries = new Map(); // sampleId -> sampleData, in LRU order (oldest first)
    this.bytes = 0;
  }

  get(sampleId) {
    const sampleData = this.entries.get(sampleId);
    if (sampleData === undefined) return null;
    this.entries.delete(sampleId);
    this.entries.set(sampleId, sampleData);
    return sampleData;
  }

  /** Stores samples and returns the ids evicted to make room (possibly including this one, if it
   * alone is larger than the cap).
   */
  set(sampleId, sampleData) {
    const evicted = [];
    const previous = this.entries.get(sampleId);
    if (previous !== undefined) {
      this.bytes -= getSampleDataBytes(previous);
      this.entries.delete(sampleId);
    }
    const size = getSampleDataBytes(sampleData);
    if (size > this.maxBytes) {
      evicted.push(sampleId);
      return evicted;
    }
    this.entries.set(sampleId, sampleData);
    this.bytes += size;
    for (const [oldId, oldData] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      if (oldId === sampleId) continue;
      this.entries.delete(oldId);
      this.bytes -= getSampleDataBytes(oldData);
      evicted.push(oldId);
    }
    return evicted;
  }
}
