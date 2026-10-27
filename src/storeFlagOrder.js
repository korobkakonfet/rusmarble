/** @file Store → Flags: shows every flag at once as a compact grid, with the flags RusMarble
 * users buy most at the front. The collapsed grid only renders the first few flags, so the
 * site's "Show more" is clicked once and its toggle is then hidden; the small card layout and
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
  const toggle = section.querySelector(TOGGLE_SELECTOR);
  if (!toggle) {return;}
  section.setAttribute('data-rm-flags-expanded', ''); // Once per section: never loops on the toggle
  if (section.querySelectorAll(CARD_SELECTOR).length < COLLAPSED_MAX_CARDS) {toggle.click();}
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
