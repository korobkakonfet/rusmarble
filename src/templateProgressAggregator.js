import { mergeTemplateExampleReservoir } from './templateChunkUtils.js';

/** Per-colour row of the combined progress snapshot.
 * `examplesEnabled` is built on first access, for this colour only: the lists only need to know
 * whether a colour has examples (`exampleCount`), and the actual coordinates are wanted only when
 * someone clicks a swatch or jumps to a pixel.
 */
class ColorProgressEntry {
  constructor(aggregator, colorKey, painted, paintedAndEnabled, missing, exampleCount) {
    this._aggregator = aggregator;
    this._colorKey = colorKey;
    this._examples = null;
    this.painted = painted;
    this.paintedAndEnabled = paintedAndEnabled;
    this.missing = missing;
    this.exampleCount = exampleCount;
  }

  get examplesEnabled() {
    if (this._examples === null) {
      this._examples = this._aggregator ? this._aggregator.getColorExamples(this._colorKey) : [];
    }
    return this._examples;
  }

  set examplesEnabled(value) {
    this._examples = Array.isArray(value) ? value : [];
    this.exampleCount = this._examples.length;
  }
}

/** Keeps per-tile progress stats and the running totals derived from them.
 *
 * Replacing a tile's stats subtracts the old ones and adds the new ones, so totals stay O(colors)
 * to read. Example reservoirs are not maintained incrementally: reservoir sampling can't be undone,
 * and the old approach of marking every colour of a re-scanned tile dirty meant almost every tile
 * refresh forced a rebuild across all tiles on the next UI refresh. Instead only a count of
 * examples per colour is kept, and a colour's reservoir is built from the tiles on demand.
 * @since 0.87.104
 */
export class TemplateProgressAggregator {
  constructor({ getExampleLimit = () => 32, randomFn = Math.random } = {}) {
    this.getExampleLimit = getExampleLimit;
    this.randomFn = randomFn;
    this.tiles = new Map();                    // tile prefix -> {painted, required, wrong, palette, template}
    this.palette = Object.create(null);        // colorKey -> {painted, paintedAndEnabled, missing, exampleItems}
    this.template = Object.create(null);       // storageKey -> {painted, palette: {colorKey: count}}
    this.version = 0;                          // bumped on every change to tiles
    this._examplesCache = new Map();           // colorKey -> {version, examples}
  }

  has(key) { return this.tiles.has(key); }
  get(key) { return this.tiles.get(key); }
  get size() { return this.tiles.size; }

  set(key, stats) {
    const old = this.tiles.get(key);
    if (old) this._apply(old, -1);
    this.tiles.set(key, stats);
    if (stats) this._apply(stats, +1);
    this.version++;
  }

  delete(key) {
    const old = this.tiles.get(key);
    if (old) this._apply(old, -1);
    const existed = this.tiles.delete(key);
    if (existed) this.version++;
    return existed;
  }

  _apply(stats, sign) {
    const palette = stats.palette;
    if (palette) {
      for (const colorKey in palette) {
        const entry = palette[colorKey];
        if (!entry) continue;
        let slot = this.palette[colorKey];
        if (!slot) {
          slot = { painted: 0, paintedAndEnabled: 0, missing: 0, exampleItems: 0 };
          this.palette[colorKey] = slot;
        }
        slot.painted += sign * (entry.painted || 0);
        slot.paintedAndEnabled += sign * (entry.paintedAndEnabled || 0);
        slot.missing += sign * (entry.missing || 0);
        const examples = entry.examplesEnabled;
        if (Array.isArray(examples) && examples.length > 0) {
          slot.exampleItems += sign * examples.length;
        }
      }
    }
    const template = stats.template;
    if (template) {
      for (const storageKey in template) {
        const entry = template[storageKey];
        if (!entry) continue;
        let slot = this.template[storageKey];
        if (!slot) {
          slot = { painted: 0, palette: Object.create(null) };
          this.template[storageKey] = slot;
        }
        slot.painted += sign * (entry.painted || 0);
        const pal = entry.palette;
        if (pal) {
          for (const colorKey in pal) {
            slot.palette[colorKey] = (slot.palette[colorKey] || 0) + sign * (Number(pal[colorKey]) || 0);
          }
        }
      }
    }
  }

  /** Size the colour's reservoir would have: every tile contributes its examples, capped at the limit. */
  getExampleCount(colorKey) {
    const items = this.palette[colorKey]?.exampleItems || 0;
    return Math.max(0, Math.min(this.getExampleLimit(), items));
  }

  /** Reservoir sample of this colour's examples across all tiles; cached until any tile changes. */
  getColorExamples(colorKey) {
    const cached = this._examplesCache.get(colorKey);
    if (cached && cached.version === this.version) return cached.examples;
    const target = { examplesEnabled: [], _exampleSeenCount: 0 };
    if ((this.palette[colorKey]?.exampleItems || 0) > 0) {
      const exampleMax = this.getExampleLimit();
      for (const stats of this.tiles.values()) {
        const content = stats?.palette?.[colorKey];
        if (content?.examplesEnabled?.length) {
          mergeTemplateExampleReservoir(target, content.examplesEnabled, exampleMax, this.randomFn);
        }
      }
    }
    this._examplesCache.set(colorKey, { version: this.version, examples: target.examplesEnabled });
    return target.examplesEnabled;
  }

  /** Combined per-colour progress, O(colors). */
  buildCombinedProgress() {
    const combined = {};
    for (const colorKey in this.palette) {
      const slot = this.palette[colorKey];
      combined[colorKey] = new ColorProgressEntry(
        this,
        colorKey,
        Math.max(0, slot.painted),
        Math.max(0, slot.paintedAndEnabled),
        Math.max(0, slot.missing),
        this.getExampleCount(colorKey),
      );
    }
    return combined;
  }

  /** An empty row for a colour no tile has reported yet. */
  createEmptyEntry(colorKey) {
    return new ColorProgressEntry(this, colorKey, 0, 0, 0, 0);
  }
}
