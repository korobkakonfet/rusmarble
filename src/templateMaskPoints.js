/** @file Sub-pixel mask shapes shared by the map overlay and the HQ overlay.
 *
 * A template pixel is drawn enlarged by a factor (3, 9 or 11) and only some of
 * the sub-pixels are painted, so the artwork underneath stays visible. Both
 * renderers must agree on those shapes, hence this module.
 * @since 0.87.71
 */

/** Draw size (enlargement factor) used by a display mode.
 * @param {string} mode - Display mode (`dot`, `cross`, `cross-z-9`, `cross-z-11`, `fill`).
 * @param {number} [fill=3] - Draw size used by `cross`/`fill`.
 * @returns {number} The enlargement factor.
 */
export function getMaskDrawSize(mode, fill = 3) {
  if (mode === 'dot') return 3;
  if (mode === 'cross-z-11') return 11;
  if (mode === 'cross-z-9') return 9;
  return fill;
}

/** Returns the sub-pixels to paint for a display mode.
 * @param {string} mode - Display mode (`dot`, `cross`, `cross-z-9`, `cross-z-11`, `fill`).
 * @param {number} size - The mask size (draw size).
 * @returns {Array<Array<number>>} `[x, y]` offsets inside the enlarged pixel.
 */
export function getTemplateMaskPoints(mode, size) {
  if (mode === 'dot') {
    const center = (size - 1) >> 1;
    return [[center, center]];
  }
  if (mode === 'fill') {
    const points = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        points.push([x, y]);
      }
    }
    return points;
  }
  if (mode.startsWith('cross-z')) {
    const points = [];
    const inset = Math.max(1, Math.floor(size / 5));
    const min = inset;
    const max = size - 1 - inset;
    if (min > max) {
      const center = (size - 1) >> 1;
      return [[center, center]];
    }
    const bandSize = max - min + 1;
    const edgeThickness = Math.min(bandSize, bandSize >= 5 ? 2 : 1);
    const diagThickness = Math.min(bandSize, bandSize >= 5 ? 3 : 2);
    for (let y = min; y <= max; y++) {
      for (let x = min; x <= max; x++) {
        const isTop = y >= min && y <= min + edgeThickness - 1;
        const isBottom = y <= max && y >= max - edgeThickness + 1;
        let isDiagonal = false;
        const diag = min + max - y;
        const offsetStart = -Math.floor(diagThickness / 2);
        const offsetEnd = Math.ceil(diagThickness / 2) - 1;
        for (let offset = offsetStart; offset <= offsetEnd; offset++) {
          if (x === diag + offset) {
            isDiagonal = true;
            break;
          }
        }
        if (isTop || isBottom || isDiagonal) {
          points.push([x, y]);
        }
      }
    }
    return points;
  }
  // 'cross' mode — replicates Template.customMask.
  const points = [];
  const center = (size - 1) >> 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onAxis = (x % size === center || y % size === center);
      const nearCenter = (
        x % size >= center - 1 && x % size <= center + 1 &&
        y % size >= center - 1 && y % size <= center + 1
      );
      if (onAxis && nearCenter) points.push([x, y]);
    }
  }
  return points;
}
