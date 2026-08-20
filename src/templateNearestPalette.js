/**
 * Exact O(1) nearest-colour lookup for a fixed palette.
 *
 * The naive lookup is a linear scan over the whole palette per pixel, which dominates both palette
 * conversion and template sampling on any image that is not already palettised. This module
 * replaces the scan with a precomputed RGB cube whose cells are *proven* unambiguous, so the answer
 * is bit-identical to the scan rather than merely close.
 *
 * For an axis-aligned box the weighted squared distance to a palette entry is separable, so both
 * the minimum and the maximum distance over the whole box are exact and cheap. A cell resolves to
 * entry `i` only when `maxDistance(i) < minDistance(j)` for every other entry `j` -- strict, so no
 * point in the box can tie with or beat `i`, and the scan's lowest-index tie-break is preserved by
 * construction. Cells that straddle a Voronoi boundary fail the test and fall back to the scan.
 *
 * Exactness is not assumed: build/benchmark.js verifies each lookup against its scan across the
 * full 2^24 colour space.
 */

// A cell that could not be proven stores `count` -- one past the last valid index -- so the
// resolved test is a single unsigned compare and no sentinel value is wasted.
/**
 * Build the lookup cube for one palette and metric. `bits` is the number of high bits kept per
 * channel, so each cell spans `1 << (8 - bits)` values per axis.
 *
 * Returns `{ cube, candidates }`. A non-negative `cube[cell]` is the proven answer for every colour
 * in that cell. A negative value encodes `-(offset + 1)` into `candidates`, where the cell's entry
 * is a length followed by that many palette indices in ascending order -- the only entries that can
 * possibly win anywhere in the cell. Scanning that short list reproduces the full scan exactly,
 * including its lowest-index tie-break, because every excluded entry is strictly farther than the
 * best candidate at every point of the cell.
 */
export const buildNearestColorCube = (palette, weightR, weightG, weightB, bits) => {
  const { r: paletteR, g: paletteG, b: paletteB, count } = palette;
  const cellsPerAxis = 1 << bits;
  const cellSize = 1 << (8 - bits);
  const cells = cellsPerAxis * cellsPerAxis * cellsPerAxis;
  const cube = new Int32Array(cells);

  // Per-axis min/max squared deviation from every entry to every slab, computed once per axis
  // rather than once per cell. Turns the build from O(cells * palette) distance evaluations into
  // three O(cellsPerAxis * palette) tables plus adds.
  const buildAxisTables = (channel) => {
    const minTable = new Float64Array(cellsPerAxis * count);
    const maxTable = new Float64Array(cellsPerAxis * count);
    for (let cell = 0; cell < cellsPerAxis; cell++) {
      const low = cell * cellSize;
      const high = low + cellSize - 1;
      const rowBase = cell * count;
      for (let index = 0; index < count; index++) {
        const value = channel[index];
        const deltaLow = value - low;
        const deltaHigh = value - high;
        const squaredLow = deltaLow * deltaLow;
        const squaredHigh = deltaHigh * deltaHigh;
        minTable[rowBase + index] = value < low ? squaredLow : (value > high ? squaredHigh : 0);
        maxTable[rowBase + index] = squaredLow > squaredHigh ? squaredLow : squaredHigh;
      }
    }
    return { minTable, maxTable };
  };

  const axisR = buildAxisTables(paletteR);
  const axisG = buildAxisTables(paletteG);
  const axisB = buildAxisTables(paletteB);

  const minDistances = new Float64Array(count);
  const candidateChunks = [];
  let candidateLength = 0;

  for (let cellR = 0; cellR < cellsPerAxis; cellR++) {
    const baseR = cellR * count;
    for (let cellG = 0; cellG < cellsPerAxis; cellG++) {
      const baseG = cellG * count;
      for (let cellB = 0; cellB < cellsPerAxis; cellB++) {
        const baseB = cellB * count;

        // Candidate is the entry with the smallest possible distance anywhere in the cell; the
        // runner-up's smallest possible distance bounds every other entry from below.
        let bestIndex = 0;
        let bestMin = Infinity;
        let secondMin = Infinity;
        for (let index = 0; index < count; index++) {
          const distance = axisR.minTable[baseR + index] * weightR
            + axisG.minTable[baseG + index] * weightG
            + axisB.minTable[baseB + index] * weightB;
          minDistances[index] = distance;
          if (distance < bestMin) {
            secondMin = bestMin;
            bestMin = distance;
            bestIndex = index;
          } else if (distance < secondMin) {
            secondMin = distance;
          }
        }

        const bestMax = axisR.maxTable[baseR + bestIndex] * weightR
          + axisG.maxTable[baseG + bestIndex] * weightG
          + axisB.maxTable[baseB + bestIndex] * weightB;

        const cell = (cellR * cellsPerAxis + cellG) * cellsPerAxis + cellB;
        if (bestMax < secondMin) {
          cube[cell] = bestIndex;
          continue;
        }

        // Anything whose best case is worse than the leader's worst case can never win here.
        const chunk = [0];
        for (let index = 0; index < count; index++) {
          if (minDistances[index] <= bestMax) chunk.push(index);
        }
        chunk[0] = chunk.length - 1;
        cube[cell] = -(candidateLength + 1);
        candidateLength += chunk.length;
        candidateChunks.push(chunk);
      }
    }
  }

  const candidates = new Uint16Array(candidateLength);
  let write = 0;
  for (let i = 0; i < candidateChunks.length; i++) {
    const chunk = candidateChunks[i];
    for (let j = 0; j < chunk.length; j++) candidates[write++] = chunk[j];
  }
  return { cube, candidates };
};

// 5 bits/channel measured best overall: a 32k-cell cube plus its candidate lists is ~230KB and
// builds in well under 50ms, while a 6-bit cube costs 1.4MB and 300ms to buy roughly 15% more
// throughput. Boundary cells hold ~2.5 candidates on average, so the short scan is nearly free.
export const NEAREST_COLOR_CUBE_BITS = 5;

/**
 * Build a `(r, g, b) => paletteIndex` closure. The metric and palette layout are baked in, so the
 * caller pays for neither inside its pixel loop.
 *
 * `palette` is `{ r, g, b, count }` of parallel channel arrays; index order defines the tie-break,
 * matching the scan it replaces.
 */
export const createExactNearestLookup = (palette, options = {}) => {
  const weightR = Number.isFinite(options.weightR) ? options.weightR : 1;
  const weightG = Number.isFinite(options.weightG) ? options.weightG : 1;
  const weightB = Number.isFinite(options.weightB) ? options.weightB : 1;
  const bits = Number.isFinite(options.bits) ? options.bits : NEAREST_COLOR_CUBE_BITS;
  const shift = 8 - bits;
  const axis = 1 << bits;
  const { r: paletteR, g: paletteG, b: paletteB, count } = palette;
  const { cube, candidates } = buildNearestColorCube(palette, weightR, weightG, weightB, bits);

  /** The algorithm this replaces, kept so the equivalence benchmark has something to diff against. */
  const scan = (r, g, b) => {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < count; index++) {
      const dr = r - paletteR[index];
      const dg = g - paletteG[index];
      const db = b - paletteB[index];
      const distance = dr * dr * weightR + dg * dg * weightG + db * db * weightB;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
        if (distance === 0) break;
      }
    }
    return bestIndex;
  };

  const lookup = (r, g, b) => {
    const entry = cube[(((r >> shift) * axis) + (g >> shift)) * axis + (b >> shift)];
    if (entry >= 0) return entry;

    // Boundary cell: scan only the handful of entries that can win here, in index order.
    let offset = -entry - 1;
    const end = offset + candidates[offset];
    let bestIndex = 0;
    let bestDistance = Infinity;
    while (offset < end) {
      const index = candidates[++offset];
      const dr = r - paletteR[index];
      const dg = g - paletteG[index];
      const db = b - paletteB[index];
      const distance = dr * dr * weightR + dg * dg * weightG + db * db * weightB;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  };

  lookup.scan = scan;
  return lookup;
};

/** Diagnostics for the benchmark: what fraction of cells the cube proves outright. */
export const measureNearestColorCubeCoverage = (palette, weightR, weightG, weightB, bits) => {
  const { cube, candidates } = buildNearestColorCube(palette, weightR, weightG, weightB, bits);
  let resolved = 0;
  let candidateCells = 0;
  let candidateTotal = 0;
  for (let index = 0; index < cube.length; index++) {
    if (cube[index] >= 0) { resolved++; continue; }
    candidateCells++;
    candidateTotal += candidates[-cube[index] - 1];
  }
  return {
    cells: cube.length,
    resolved,
    ratio: resolved / cube.length,
    bytes: cube.byteLength + candidates.byteLength,
    meanCandidates: candidateCells ? candidateTotal / candidateCells : 0,
  };
};
