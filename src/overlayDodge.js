/** @file Moves the main overlay aside when a wplace panel (profile dropdown, modal, ...)
 * would be covered by it. The overlay is nudged horizontally with the CSS `translate`
 * property, which stays independent from the `transform` used by the drag handler.
 * @since 0.87.79
 */

const PANEL_SELECTOR = '.dropdown-content, .modal-box';
const GAP = 12; // Space kept between the overlay and the panel
const EDGE = 8; // Minimum distance kept from the viewport edge

let overlayEl = null;
let currentShift = 0;

/** Reads the horizontal offset the overlay is painted with right now.
 * The `translate` property is animated by the overlay transition, so the value
 * we last asked for is not necessarily the value currently on screen - and the
 * measurements below have to be corrected with the painted one.
 * @param {HTMLElement} el
 * @returns {number} Pixels
 */
function paintedShift(el) {
  const value = window.getComputedStyle(el).translate;
  if (!value || value === 'none') {return 0;}
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Is the element actually painted on screen?
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {return false;}
  if (Number(style.opacity) < 0.05) {return false;}
  if (style.pointerEvents === 'none') {return false;} // Closed daisyUI dropdowns
  return true;
}

/** Applies (or clears) the horizontal offset of the overlay
 * @param {number} shift - Pixels to move the overlay by (negative = left)
 */
function applyShift(shift) {
  if (Math.abs(shift - currentShift) < 1) {return;}
  currentShift = shift;
  overlayEl.style.translate = shift ? `${shift}px 0` : '';
}

/** Recomputes how far the overlay has to move to clear every open panel */
function update() {
  overlayEl = document.getElementById('bm-overlay');
  if (!overlayEl) {return;}

  // While dragging, the user is in control: never fight them
  if (document.querySelector('#bm-bar-drag.dragging')) {
    applyShift(0);
    return;
  }

  const rect = overlayEl.getBoundingClientRect();
  // Undo the offset we applied ourselves to get the overlay's resting position.
  // Mid-transition this differs from `currentShift`, hence the painted value.
  const painted = paintedShift(overlayEl);
  const base = {
    left: rect.left - painted,
    right: rect.right - painted,
    top: rect.top,
    bottom: rect.bottom
  };

  let shift = 0;

  for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
    if (overlayEl.contains(panel) || panel.closest('#bm-overlay')) {continue;}
    if (!isVisible(panel)) {continue;}

    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width < 1 || panelRect.height < 1) {continue;}

    // No vertical overlap means no collision
    if (panelRect.bottom <= base.top || panelRect.top >= base.bottom) {continue;}
    // No horizontal overlap means no collision
    if (panelRect.right <= base.left || panelRect.left >= base.right) {continue;}

    shift = Math.min(shift, Math.round(panelRect.left - GAP - base.right));
  }

  if (shift < 0) {
    // Never push the overlay off the left edge of the screen
    shift = Math.max(shift, EDGE - base.left);
    if (shift > 0) {shift = 0;}
  }

  applyShift(shift);
}

/** Starts watching for panels that the overlay would cover
 * @since 0.87.79
 */
export function initOverlayDodge() {
  let queued = false;
  const schedule = () => {
    if (queued) {return;}
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
    // Panels open/close with a transition, so re-check once they settled
    setTimeout(update, 150);
    setTimeout(update, 400);
  };

  // The drag handler measures the overlay position on pointerdown, so our offset
  // has to be gone *before* it does that - a queued update would be too late and
  // would make the overlay jump sideways as soon as the drag starts.
  window.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('#bm-bar-drag')) {return;}
    const el = document.getElementById('bm-overlay');
    if (!el || !currentShift) {return;}
    const transition = el.style.transition;
    el.style.transition = 'none'; // The offset has to be gone instantly, not animated
    overlayEl = el;
    applyShift(0);
    el.getBoundingClientRect(); // Forces a synchronous reflow
    el.style.transition = transition;
  }, true);

  for (const type of ['focusin', 'focusout', 'pointerdown', 'pointerup', 'keyup', 'resize']) {
    window.addEventListener(type, schedule, true);
  }

  schedule();
}
