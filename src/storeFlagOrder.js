/** @file Store → Flags: shows every flag at once as a compact grid, with the flags RusMarble
 * users buy most at the front. The collapsed grid only renders the first few flags; once the
 * user expands it with the site's "Show more", that toggle is hidden. The small card layout and
 * the favourites' `order` live in overlay.css. The Svelte-owned DOM is only tagged with a data
 * attribute, never moved.
 * @since 0.87.132
 */

const SECTION_SELECTOR = 'section[data-game-link="store/flags"]';
const CARD_SELECTOR = '[data-game-link^="store/flags/flag-"]';
const TOGGLE_SELECTOR = '.mt-4.flex.justify-center > button';
const COLLAPSED_MAX_CARDS = 20; // Fewer rendered cards than this = the site's collapsed view

/** @param {HTMLElement} section */
function processSection(section) {
  if (section.hasAttribute('data-rm-flags-expanded')) {return;}
  if (!section.querySelector(TOGGLE_SELECTOR)) {return;}
  // The attribute hides the site's toggle (overlay.css), so it is set only once every flag is
  // rendered, i.e. after the user's own press. The toggle is never pressed for them.
  if (section.querySelectorAll(CARD_SELECTOR).length >= COLLAPSED_MAX_CARDS) {
    section.setAttribute('data-rm-flags-expanded', '');
  }
}

let scheduled = false;
let started = false;
function scan() {
  scheduled = false;
  document.querySelectorAll(SECTION_SELECTOR).forEach(processSection);
}

/** Starts watching for the Store modal. */
export function initStoreFlagOrder() {
  if (started) {return;}
  started = true;
  new MutationObserver(() => {
    if (scheduled) {return;}
    scheduled = true;
    requestAnimationFrame(scan);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
}
