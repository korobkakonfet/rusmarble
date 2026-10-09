/** ApiManager class for handling API requests, responses, and interactions.
 * Note: Fetch spying is done in main.js, not here.
 * @class ApiManager
 * @since 0.11.1
 */

import TemplateManager from "./templateManager.js";
import { consoleError, escapeHTML, numberToEncoded, serverTPtoDisplayTP, cleanUpCanvas, copyToClipboard, downloadTile, consoleLog } from "./utils.js";
import { coordsTileCoordsToGeoCoords, overrideRandom, getZoom } from "./utilsMaptiler.js";
import { createParticleCanvas } from "./particleCanvas.js";

const EASTER_EGG_WAVE_FIRST_DELAY_MS = 2000;
const EASTER_EGG_WAVE_PAUSE_BEFORE_LOOP_MS = 3000;
const EASTER_EGG_WAVE_STEP_DURATION_MS = 1800;
const EASTER_EGG_WAVE_STAGGER_MS = 90;
const EASTER_EGG_BURST_PARTICLES = 120;
const EASTER_EGG_LOOP_BURST_PARTICLES = 40;
const EASTER_EGG_BURST_GLYPHS = ['✦', '★', '♥', '👑'];
/** Shared by every card and the editor preview; only one effects run plays at a time anyway. */
const particleCanvas = createParticleCanvas();

/** Pre-draws the confetti/firework sprites for these configs while the browser is idle, so
 * the first open of a profile doesn't pay for it.
 * @param {object[]} configs Normalized effects configs. */
export function prewarmPixelEffects(configs) {
  const colors = new Set();
  const glowColors = new Set();
  configs.forEach(config => {
    if (config?.confetti) config.confettiColors.forEach(color => colors.add(color));
    if (config?.fireworks) config.fireworkColors.forEach(color => glowColors.add(color));
  });
  if (!colors.size && !glowColors.size) return;
  const run = () => particleCanvas.prewarm({ colors: [...colors], glyphs: EASTER_EGG_BURST_GLYPHS, glowColors: [...glowColors] });
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
const EASTER_EGG_FIREWORK_ROCKETS = 3;
const EASTER_EGG_FIREWORK_SPARKS = 30;
/** Click-to-explode on the name: minimum gap between clicks and the most effect layers allowed
 * on screen at once, so spam-clicking can't pile up thousands of particles. */
const EASTER_EGG_CLICK_COOLDOWN_MS = 250;
/** One full turn of the spinning border, per `borderSpeed`. */
const EASTER_EGG_BORDER_SPIN_MS = { slow: 5200, normal: 2800, fast: 1300 };
const EASTER_EGG_SPARKLE_COUNT = 7;
const EASTER_EGG_BADGE_SIZE_PX = { small: 14, medium: 20, large: 28 };
const EASTER_EGG_AMBIENT_COUNT = 12;
/** Ambient particle kinds: glyphs, direction, sideways sway (px), fall/rise time (ms), size (px). */
const EASTER_EGG_AMBIENT = {
  snow: { glyphs: ['❄', '•', '✻'], up: false, sway: 12, time: [5000, 8000], size: [7, 12] },
  hearts: { glyphs: ['♥'], up: true, sway: 9, time: [3800, 6000], size: [8, 13] },
  bubbles: { glyphs: ['○', '◦', '°'], up: true, sway: 7, time: [3200, 5200], size: [8, 14] },
  embers: { glyphs: ['•', '·'], up: true, sway: 5, time: [2200, 3800], size: [5, 9], glow: true },
  stars: { glyphs: ['✦', '✧', '⋆'], up: false, sway: 16, time: [7000, 11000], size: [7, 12], glow: true },
};
/** Name animations: keyframes + timing, all transform-only except shimmer/glitch (handled below). */
const EASTER_EGG_NAME_ANIMATIONS = {
  float: [
    [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }],
    { duration: 2600, easing: 'ease-in-out' },
  ],
  heartbeat: [
    [
      { transform: 'scale(1)', offset: 0 },
      { transform: 'scale(1.12)', offset: 0.14 },
      { transform: 'scale(1)', offset: 0.28 },
      { transform: 'scale(1.08)', offset: 0.42 },
      { transform: 'scale(1)', offset: 0.7 },
      { transform: 'scale(1)', offset: 1 },
    ],
    { duration: 1400, easing: 'ease-in-out' },
  ],
  jelly: [
    [
      { transform: 'scale(1, 1)', offset: 0 },
      { transform: 'scale(1.15, .85)', offset: 0.3 },
      { transform: 'scale(.9, 1.1)', offset: 0.45 },
      { transform: 'scale(1.05, .95)', offset: 0.6 },
      { transform: 'scale(1, 1)', offset: 0.75 },
      { transform: 'scale(1, 1)', offset: 1 },
    ],
    { duration: 1800 },
  ],
  // Still most of the time, then a short burst of jitter with red/cyan split.
  glitch: [
    [
      { transform: 'translate(0, 0)', textShadow: 'none', offset: 0 },
      { transform: 'translate(0, 0)', textShadow: 'none', offset: 0.86 },
      { transform: 'translate(-2px, 1px) skewX(-8deg)', textShadow: '2px 0 #ff2a55, -2px 0 #2af5ff', offset: 0.88 },
      { transform: 'translate(2px, -1px)', textShadow: '-2px 0 #ff2a55, 2px 0 #2af5ff', offset: 0.91 },
      { transform: 'translate(-1px, 0) skewX(6deg)', textShadow: '1px 0 #ff2a55, -1px 0 #2af5ff', offset: 0.94 },
      { transform: 'translate(0, 0)', textShadow: 'none', offset: 0.97 },
      { transform: 'translate(0, 0)', textShadow: 'none', offset: 1 },
    ],
    { duration: 2800, easing: 'steps(1, end)' },
  ],
};
const EASTER_EGG_CARD_ENTRANCES = {
  pop: [[{ transform: 'scale(.85)', opacity: 0 }, { transform: 'scale(1.04)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 480, easing: 'ease-out' }],
  slide: [[{ transform: 'translateY(18px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' }],
  flip: [
    [
      { transform: 'perspective(700px) rotateX(-80deg)', transformOrigin: '50% 0', opacity: 0 },
      { transform: 'perspective(700px) rotateX(12deg)', transformOrigin: '50% 0', opacity: 1, offset: 0.65 },
      { transform: 'perspective(700px) rotateX(0deg)', transformOrigin: '50% 0', opacity: 1 },
    ],
    { duration: 650, easing: 'ease-out' },
  ],
};
const EASTER_EGG_CARD_TINT_ALPHA = { subtle: 0.14, strong: 0.3 };
const EASTER_EGG_NAME_FONTS = {
  bold: { fontWeight: '800' },
  italic: { fontStyle: 'italic' },
  mono: { fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace' },
  serif: { fontFamily: 'Georgia, "Times New Roman", serif' },
  rounded: { fontFamily: '"Comic Sans MS", "Trebuchet MS", "Segoe Print", cursive' },
};
const EASTER_EGG_MAX_PARTICLES = 600;

/** Start of the SVG path wplace uses for its pixel "X" close icon. Language-independent, unlike
 * the button's aria-label. */
export const WPLACE_CLOSE_ICON_PATH_PREFIX = 'M7 19H5v-2h2v2Z';

/** Whether a button shows wplace's close icon. */
export function isWplaceCloseIcon(button) {
  return !!button?.querySelector?.(`path[d^="${WPLACE_CLOSE_ICON_PATH_PREFIX}"]`);
}

export default class ApiManager {

  /** Constructor for ApiManager class
   * @param {TemplateManager} templateManager 
   * @since 0.11.34
   */
  constructor(templateManager) {
    this.templateManager = templateManager;
    this.disableAll = false; // Should the entire userscript be disabled?
    this.coordsTilePixel = []; // Contains the last detected tile/pixel coordinate pair requested
    this.templateCoordsTilePixel = []; // Contains the last "enabled" template coords
    this.lastMe = null;
    this.lastMeUpdated = null;
    this.chargeInterval = null;
    this.tileCache = {};
    this.lastFetchedTime = null;
    this.onCoordsUpdated = null;
    this.displayCoordsRetryTimeout = null;
  }

  getCurrentCharges() {
    if (this.lastMe === null) {
      this.#askServerForMe();
      return 0;
    }
    const charges = this.lastMe["charges"];
    const currentTime = Date.now();
    const timeDiff = currentTime - this.lastMeUpdated;
    const chargesDelta = timeDiff / charges["cooldownMs"];
    const currentCharges = charges["count"] + chargesDelta;
    const trueMax = charges["count"] > charges["max"] ? charges["count"] : charges["max"];
    if (currentCharges > trueMax) {
      return trueMax;
    }
    return currentCharges;
  }

  getFullRemainingTimeMs() {
    const currentCharges = this.getCurrentCharges();
    const charges = this.lastMe?.["charges"] ?? ({ "max": 0, "cooldownMs": 30000 });
    if (currentCharges >= charges["max"]) {
      return 0;
    }
    return (charges["max"] - currentCharges) * charges["cooldownMs"];
  }

  getFullRemainingTimeFormatted() {
    return this.getTimeFormatted(this.getFullRemainingTimeMs());
  }

  getSuspendTimeMs() {
    const timeoutUntil = new Date(this.lastMe?.["timeoutUntil"] ?? 0).getTime();
    return Math.max(0, timeoutUntil - Date.now());
  }

  isSuspended() {
    return this.getSuspendTimeMs() > 0;
  }

  getSuspendTimeFormatted() {
    return this.getTimeFormatted(this.getSuspendTimeMs());
  }

  getTimeFormatted(remainingTimeMs, includeSeconds = true) {
    if (remainingTimeMs <= 0) {
      return includeSeconds ? "00:00" : "00";
    }
    const remainingTimeSeconds = Math.floor(remainingTimeMs / 1000);
    const hours = Math.floor(remainingTimeSeconds / 3600);
    const minutes = (Math.floor((remainingTimeSeconds % 3600) / 60)).toString().padStart(2, '0');
    const seconds = (remainingTimeSeconds % 60).toString().padStart(2, '0');
    // if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    // if (minutes > 0) return `${minutes}m ${seconds}s`
    // return `${seconds}s`;
    if (!includeSeconds) {
      if (hours > 0) return `${hours}:${minutes}`;
      return `${minutes}`;
    }
    if (hours > 0) return `${hours}:${minutes}:${seconds}`;
    return `${minutes}:${seconds}`;
  }

  #setUpTimeout() {
    this.#updateCharges();
    this.chargeInterval = setInterval(() => {
      this.#updateCharges();
    }, 1000);
  }

  #updateCharges() {
    // Can check https://wplace.live/_app/immutable/chunks/OJISNkFj.js for the real implementation
    if (this.lastMe === null) {
      this.#askServerForMe();
      return;
    }
    const charges = this.lastMe["charges"];
    const currentCharges = Math.floor(this.getCurrentCharges());
    const maxCharges = charges["max"];
    const currentChargesStr = new Intl.NumberFormat().format(currentCharges);
    const maxChargesStr = new Intl.NumberFormat().format(maxCharges);

    const container = document.getElementById('bm-user-charges');
    const countdownElement = container?.querySelector('[data-role="countdown"]');
    const countElement = container?.querySelector('[data-role="charge-count"]');

    if (container && countdownElement && countElement) {
      countdownElement.textContent = this.getFullRemainingTimeFormatted();
      countElement.textContent = `(${currentChargesStr} / ${maxChargesStr})`;
    };

    const suspendContainer = document.getElementById('bm-user-suspend');
    const suspendCountdownElement = suspendContainer?.querySelector('[data-role="suspend-countdown"]');
    const suspendReasonContainer = document.getElementById('bm-user-suspend-reason');
    const suspendReasonElement = document.getElementById('bm-suspend-reason');

    if (suspendContainer && suspendCountdownElement && suspendReasonContainer && suspendReasonElement) {
      const isSuspended = this.isSuspended();
      suspendContainer.style.display = isSuspended ? "" : "none";
      suspendReasonContainer.style.display = isSuspended ? "" : "none";
      if (isSuspended) {
        suspendCountdownElement.textContent = this.getSuspendTimeFormatted();
        suspendReasonElement.textContent = (this.lastMe["suspensionReason"] ?? "Unknown").split("-").map(word => {
          return word.charAt(0).toUpperCase() + word.slice(1); // charAt(0) returns empty string for empty string
        }).join(" ");
      }
    };
  }

  #askServerForMe() {
    const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
    const logoutButton = document.querySelector(".relative>.dropdown>.dropdown-content>section>button.btn");
    if (allianceOrRankingButton !== null && logoutButton !== null) {
      // logged in and not in painting mode
      // knock at the @me endpoint (only once per 10 seconds)
      const currentTime = Date.now();
      if (this.lastFetchedTime === null || currentTime - this.lastFetchedTime > 10000) { // 10 seconds
        // fetch here is not intercepted (or can be if it is run as a bookmarklet)
        fetch("https://backend.wplace.live/me", {
          "credentials": "include",
        }).then((response) => {
          return response.json();
        }).then((dataJSON) => {
          // If the game can not retrieve the userdata...
          if (dataJSON['status'] && dataJSON['status']?.toString()[0] != '2') {
            // The server is probably down (NOT a 2xx status)
            return;
          }
          consoleLog("Fetched user data", dataJSON);
          this.#applyUserData(dataJSON, Date.now());
        }).catch(() => {});
        this.lastFetchedTime = currentTime;
      }
    }
  }

  #resolveNextLevelPixels(dataJSON) {
    const sanitize = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      return Math.max(0, Math.ceil(numeric));
    };

    const directCandidates = [
      dataJSON?.nextLevelPixels,
      dataJSON?.pixelsToNextLevel,
      dataJSON?.nextLevelPixelsLeft,
      dataJSON?.nextLevel?.pixels,
      dataJSON?.nextLevel?.pixelsLeft,
      dataJSON?.progress?.pixelsToNextLevel,
      dataJSON?.stats?.pixelsToNextLevel,
      dataJSON?.levelProgress?.remaining,
      dataJSON?.levelProgress?.remainingPixels,
    ];
    for (const candidate of directCandidates) {
      const resolved = sanitize(candidate);
      if (resolved !== null) return resolved;
    }

    const currentLevel = Number(dataJSON?.level);
    const pixelsPainted = Number(dataJSON?.pixelsPainted);
    if (!Number.isFinite(currentLevel) || !Number.isFinite(pixelsPainted)) {
      return 0;
    }

    // Legacy fallback approximation used before 0.87.45.
    // Keep this for compatibility when backend does not expose remaining pixels directly.
    const threshold = Math.pow(Math.floor(currentLevel) * Math.pow(30, 0.65), (1 / 0.65));
    if (!Number.isFinite(threshold)) {
      return 0;
    }
    return Math.max(0, Math.ceil(threshold - pixelsPainted));
  }

  #applyUserData(dataJSON, fetchTime) {
    if (dataJSON === null) return;
    const nextLevelPixels = this.#resolveNextLevelPixels(dataJSON);

    consoleLog(dataJSON['id']);
    if (!!dataJSON['id'] || dataJSON['id'] === 0) {
      consoleLog(numberToEncoded(
        dataJSON['id'],
        '!#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~'
      ));
    }
    this.templateManager.userID = dataJSON['id'];
    // For debugging
    // dataJSON["suspensionReason"] = "inappropriate-content";
    // dataJSON["timeoutUntil"] = "2026-01-01T00:00:00Z";
    this.lastMe = dataJSON;
    this.lastMeUpdated = fetchTime;

    this.templateManager.updateExtraColorsBitmap(dataJSON['extraColorsBitmap'] ?? 0);
    // Check if all colors are unlocked, and if so, remove the option to hide locked colors
    const unlockedColorsElement = document.getElementById('bm-checkbox-colors-unlocked')?.parentElement;
    if (unlockedColorsElement) {
      unlockedColorsElement.style.display = this.templateManager.extraColorsBitmap === -1 ? 'none' : '';
    }
    
    const userNameElement = document.getElementById('bm-user-name');
    if (userNameElement) {
      userNameElement.textContent = dataJSON['name'];
    }
    const userDropletsElement = document.getElementById('bm-user-droplets');
    if (userDropletsElement) {
      userDropletsElement.textContent = new Intl.NumberFormat().format(dataJSON['droplets']);
    }
    // Updates the text content of the next level field
    const nextPixelElement = document.getElementById('bm-user-nextpixel');
    const nextPixelPluralElement = document.getElementById('bm-user-nextpixel-plural');
    if (nextPixelElement && nextPixelPluralElement) {
      nextPixelElement.textContent = new Intl.NumberFormat().format(nextLevelPixels);
      nextPixelPluralElement.textContent = typeof window.getBlueMarbleNextPixelPlural === 'function'
        ? window.getBlueMarbleNextPixelPlural(nextLevelPixels)
        : (nextLevelPixels == 1 ? '' : 's');
    }
    const nextLevelElement = document.getElementById('bm-user-nextlevel');
    if (nextLevelElement) {
      const level = Number(dataJSON?.level);
      nextLevelElement.textContent = Number.isFinite(level)
        ? Math.floor(level) + 1
        : 1;
    }
  }

  /** Get the close button inside the pixel info view for anchoring
   * 
   * @since 0.87.4
  */
  #isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  #hasPixelInfoContent(element) {
    if (!(element instanceof HTMLElement)) return false;
    const text = element.textContent || '';
    return /\bpaint\b/i.test(text) || /\bshare\b/i.test(text) || /\b#\s*\d+\b/.test(text);
  }

  getCloseButton() {
    /*
    Old .gap-2 UI:
    (Y) Pixel: 1337, 337 ([Flag] Region #No)      (x)
            < Coords to be added here
    Painted by: (Icon) Username #ID (Alliance) (:)
    ( Paint ) ( Favorite ) ( Share ) < Shape buttons to be added here
    Button Class List: btn btn-primary btn-soft

    New .gap-2 UI:
    (Icon) Username #ID  (Alliance)               (:)
    -------------------------------------------------
    (Y) 1337, 337 ([Flag] Region #No)             (x)
            < Coords to be added here
    ( Paint ) ( Favorite ) ( Share ) < Shape buttons to be added here
    Button Class List: btn btn-sm btn-primary btn-soft
    */

    // Oct 2026 UI: the panel is a floating `.game-panel-surface` card holding `.selected-pixel`,
    // with no `.rounded-t-box`/dialog around it and a `btn-square` (not `btn-circle`) close button.
    // The aria-label is localized ("Закрыть" in Russian), so the new card's close button is also
    // matched by its icon: wplace's pixel "X" path, which is the same in every language.
    const selectors = [
      `.selected-pixel button:has(path[d^="${WPLACE_CLOSE_ICON_PATH_PREFIX}"])`,
      '.selected-pixel button[aria-label="Close"]',
      '.rounded-t-box button[aria-label="Close"]',
      'dialog.modal button[aria-label="Close"]',
      'dialog button[aria-label="Close"]',
      '.modal button[aria-label="Close"]',
      '.rounded-t-box .flex.items-center.justify-end.gap-1 > button.btn-circle[aria-label="Close"]',
      '.flex.items-center.justify-between.px-3.pb-1\\.5 button.btn-circle[aria-label="Close"]',
      '.flex.h-10.items-center.justify-between.px-3.pb-1\\.5 button.btn-circle[aria-label="Close"]',
      '.flex.gap-1\\.5.px-3 > button.btn-circle[aria-label="Close"]',
      '.flex.gap-2.px-3 > button.btn-circle[aria-label="Close"]'
    ];
    const prioritizedCandidates = selectors.flatMap((selector, selectorIndex) => (
      Array.from(document.querySelectorAll(selector))
        .filter(button => button instanceof HTMLElement)
        .map(button => ({ button, selectorIndex }))
    ));
    const genericCandidates = Array.from(
      document.querySelectorAll('.rounded-t-box button.btn-circle, dialog.modal button.btn-circle, dialog button.btn-circle, .modal button.btn-circle')
    )
      .filter(button => button instanceof HTMLElement)
      .map(button => ({ button, selectorIndex: selectors.length }));
    const seenButtons = new Set();
    const candidates = [...prioritizedCandidates, ...genericCandidates]
      .filter(({ button }) => {
        if (seenButtons.has(button)) return false;
        seenButtons.add(button);
        return true;
      });
    const scoredCandidates = candidates
      .map(({ button, selectorIndex }) => {
        const label = [
          button.getAttribute('aria-label') || '',
          button.title || '',
          button.textContent || ''
        ].join(' ');
        const root = this.getPixelInfoRoot(button);
        let score = 0;
        if (/close/i.test(label) || isWplaceCloseIcon(button)) score += 12;
        if (this.#isVisibleElement(button)) score += 4;
        if (root && this.#hasPixelInfoContent(root)) score += 3;
        if (button.parentElement?.lastElementChild === button) score += 1;
        score += Math.max(0, selectors.length - selectorIndex);
        return { button, score };
      })
      .sort((left, right) => right.score - left.score);
    return scoredCandidates.find(candidate => candidate.score > 0)?.button || candidates[0]?.button || null;
  }

  /** Get the root element of the current pixel info panel.
   *
   * @param {HTMLElement | null} closeButton
   * @returns {HTMLElement | null}
   * @since 0.87.32
   */
  getPixelInfoRoot(closeButton = this.getCloseButton()) {
    if (!closeButton) return null;
    const selectedPixel = closeButton.closest('.selected-pixel');
    if (selectedPixel) return selectedPixel.closest('.game-panel-surface') || selectedPixel;
    const roundedBox = closeButton.closest('.rounded-t-box');
    if (roundedBox) return roundedBox;
    const dialog = closeButton.closest('dialog.modal, dialog');
    if (dialog) return dialog.firstElementChild || dialog;
    const modal = closeButton.closest('.modal');
    if (modal) return modal.firstElementChild || modal;
    return closeButton.parentElement;
  }

  /** Get the row after which coordinate text should be inserted.
   *
   * @param {HTMLElement | null} closeButton
   * @param {HTMLElement | null} infoRoot
   * @returns {HTMLElement | null}
   * @since 0.87.32
   */
  getDisplayCoordsAnchor(closeButton = this.getCloseButton(), infoRoot = this.getPixelInfoRoot(closeButton)) {
    if (!closeButton || !infoRoot) return closeButton?.parentElement || null;
    const compactCoordPattern = /\b\d{1,7}\s*,\s*\d{1,7}\b/;
    const locationButton = Array.from(infoRoot.querySelectorAll('button'))
      .find(button =>
        compactCoordPattern.test(button.textContent || '')
        && !button.closest('#bm-display-coords-container')
      );
    const locationRowCandidates = [
      locationButton?.closest('.mt-auto.flex.w-full.justify-between'),
      locationButton?.closest('.mt-2.flex.w-full.justify-between'),
      locationButton?.closest('div.flex.w-full.justify-between'),
      locationButton?.closest('.flex.items-center.gap-1\\.5')?.parentElement,
      locationButton?.closest('.flex.items-center.gap-1\\.5'),
      locationButton?.parentElement
    ];
    const locationRow = locationRowCandidates.find(row => row instanceof HTMLElement && infoRoot.contains(row));
    if (locationRow && infoRoot.contains(locationRow)) return locationRow;
    return closeButton.parentElement?.nextElementSibling || closeButton.parentElement;
  }

  #scheduleDisplayCoordsRetry(retryCount) {
    if (retryCount >= 12) return;
    clearTimeout(this.displayCoordsRetryTimeout);
    this.displayCoordsRetryTimeout = setTimeout(() => {
      this.updateDisplayCoords(retryCount + 1);
    }, 70);
  }

  /** Get the container containing the three button, namely Paint, Favorite, and Share, for anchoring
   * 
   * @since 0.87.4
  */
  getPaintButtonContainer() {
    const anchorElement = this.getCloseButton();
    if (!anchorElement) return;
    const infoRoot = this.getPixelInfoRoot(anchorElement);
    if (infoRoot) {
      const actionRows = Array.from(infoRoot.querySelectorAll('div'))
        .filter(row => {
          const directButtons = Array.from(row.querySelectorAll(':scope > button'));
          if (!directButtons.length) return false;
          const hasPaintButton = directButtons.some(button => /\bpaint\b/i.test(button.textContent || button.getAttribute('aria-label') || ''));
          const hasPrimaryAction = directButtons.some(button =>
            button.classList.contains('btn-primary') && button.classList.contains('btn-sm')
          );
          return hasPaintButton || hasPrimaryAction;
        });
      const visibleActionRow = actionRows.find(row => row.offsetParent !== null);
      if (visibleActionRow) return visibleActionRow;
      if (actionRows.length) return actionRows[0];
    }
    // Legacy fallback:
    // .parentElement: The row containing the pixel
    // .parentElement: The whole container
    // .lastElementChild: The button container
    return anchorElement.parentElement?.parentElement?.lastElementChild;
  }

  /** Put the coords container just above the card's location row, creating it if needed.
   *
   * @param {HTMLElement} closeButton
   * @param {HTMLElement} infoRoot
   * @param {HTMLElement | null} displayCoordsContainer - the existing container, if any
   * @returns {HTMLElement | null} the placed container, or null while the location row isn't rendered yet
   */
  #placeDisplayCoordsContainer(closeButton, infoRoot, displayCoordsContainer) {
    const coordRow = this.getDisplayCoordsAnchor(closeButton, infoRoot);
    if (!coordRow) return null;
    const coordPattern = /\b\d{1,7}\s*,\s*\d{1,7}\b/;
    const isLikelyHeaderFallback =
      coordRow === closeButton.parentElement &&
      !coordPattern.test(coordRow.textContent || '');
    if (isLikelyHeaderFallback) return null;
    if (!displayCoordsContainer) {
      displayCoordsContainer = document.createElement('div');
      displayCoordsContainer.id = 'bm-display-coords-container';
      displayCoordsContainer.style = 'width: 100%; margin: 4px 0 2px; padding: 0 12px; box-sizing: border-box; line-height: 1.15; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; text-align: left;';
      coordRow.insertAdjacentElement('beforebegin', displayCoordsContainer);
      // The new card's location row sits in an already-padded column next to the avatar.
      if (coordRow.closest('.selected-pixel')) {
        displayCoordsContainer.style.padding = '0';
        displayCoordsContainer.style.margin = '6px 0 0';
      }
    } else if (displayCoordsContainer.nextElementSibling !== coordRow) {
      coordRow.insertAdjacentElement('beforebegin', displayCoordsContainer);
    }
    return displayCoordsContainer;
  }

  /** Reserve the coords row as soon as wplace renders a pixel-info card.
   * The pixel data only reaches us through an async postMessage, after wplace has already
   * painted the card, so adding the row then made the whole card jump by its height. A
   * MutationObserver callback runs before the next paint, so an empty row of the same height
   * goes in first and `updateDisplayCoords` just fills it.
   */
  #observePixelInfoCards() {
    if (this.pixelInfoCardObserver) return;
    const reserve = () => {
      const card = document.querySelector('.selected-pixel');
      if (!card) return;
      const existing = document.getElementById('bm-display-coords-container');
      if (existing && card.contains(existing)) return;
      const closeButton = card.querySelector(`button:has(path[d^="${WPLACE_CLOSE_ICON_PATH_PREFIX}"]), button[aria-label="Close"]`);
      if (!(closeButton instanceof HTMLElement)) return;
      const infoRoot = this.getPixelInfoRoot(closeButton);
      if (!infoRoot) return;
      const container = this.#placeDisplayCoordsContainer(closeButton, infoRoot, null);
      if (!container) return;
      // Same text classes as the real coords, so the placeholder takes exactly their height.
      const placeholder = document.createElement('span');
      placeholder.className = 'text-xs';
      placeholder.style = 'display: block; visibility: hidden;';
      placeholder.textContent = ' ';
      container.append(placeholder);
    };
    this.pixelInfoCardObserver = new MutationObserver(reserve);
    this.pixelInfoCardObserver.observe(document.documentElement, { childList: true, subtree: true });
    reserve();
  }

  /** Update the texts and related functions shown on the pixel info overlay
   * 
   * @since 0.85.28
  */
  updateDisplayCoords(retryCount = 0) {
    const coordsTile = [ this.coordsTilePixel[0], this.coordsTilePixel[1] ];
    const coordsPixel = [ this.coordsTilePixel[2], this.coordsTilePixel[3] ];
    const closeButton = this.getCloseButton();
    const infoRoot = this.getPixelInfoRoot(closeButton);
    if (!closeButton || !infoRoot) return;

    document.querySelectorAll('#bm-display-coords-container, #bm-display-coords1, #bm-display-coords2, #bm-display-coords-br')
      .forEach(element => {
        if (!infoRoot.contains(element)) {
          element.remove();
        }
      });

    let displayCoordsContainer = infoRoot.querySelector('#bm-display-coords-container');
    const displayCoords1Copy = infoRoot.querySelector('#bm-display-coords1-copy');
    const displayCoords2Copy = infoRoot.querySelector('#bm-display-coords2-copy');

    if (displayCoords1Copy) displayCoords1Copy.remove();
    if (displayCoords2Copy) displayCoords2Copy.remove();

    // Find the additional pixel coords span
    const geoCoords = coordsTileCoordsToGeoCoords(coordsTile, coordsPixel);
    const text1 = `(Tl X: ${coordsTile[0]}, Tl Y: ${coordsTile[1]}, Px X: ${coordsPixel[0]}, Px Y: ${coordsPixel[1]})`;
    const text1Display = `Tl ${coordsTile[0]}, ${coordsTile[1]} | Px ${coordsPixel[0]}, ${coordsPixel[1]}`;

    const showCopiedToast = (anchor, message = 'Copied!') => {
      const parent = anchor.parentElement;
      if (!parent) return;
      const existing = parent.querySelector('.bm-display-coords-toast');
      if (existing) existing.remove();
      if (window.getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      const toast = document.createElement('span');
      toast.className = 'bm-display-coords-toast';
      toast.textContent = message;
      toast.style.left = `${anchor.offsetLeft + anchor.offsetWidth + 8}px`;
      toast.style.top = `${anchor.offsetTop}px`;
      parent.appendChild(toast);
      const maxLeft = Math.max(0, parent.clientWidth - toast.offsetWidth);
      const currentLeft = parseFloat(toast.style.left) || 0;
      if (currentLeft > maxLeft) {
        const fallbackLeft = Math.max(0, anchor.offsetLeft - toast.offsetWidth - 8);
        toast.style.left = `${fallbackLeft}px`;
      }
      setTimeout(() => toast.remove(), 1200);
    };

    const attachCopyHandler = (element) => {
      if (!element) return;
      element.addEventListener('click', () => {
        const content = element.dataset.text || '';
        if (!content) return;
        copyToClipboard(content);
        showCopiedToast(element);
      });
    };
  
    displayCoordsContainer = this.#placeDisplayCoordsContainer(closeButton, infoRoot, displayCoordsContainer);
    if (!displayCoordsContainer) {
      this.#scheduleDisplayCoordsRetry(retryCount);
      return;
    }
    clearTimeout(this.displayCoordsRetryTimeout);
    this.displayCoordsRetryTimeout = null;

    displayCoordsContainer.textContent = '';

    const displayCoordsRow = document.createElement('div');
    displayCoordsRow.id = 'bm-display-coords-row';
    displayCoordsRow.style = 'display: flex; align-items: center; gap: 4px; max-width: 100%;';

    const displayCoords1 = document.createElement('span');
    displayCoords1.id = 'bm-display-coords1';
    displayCoords1.style = 'display: block; max-width: 100%; white-space: nowrap;';
    displayCoords1.className = 'bm-display-coords-clickable text-base-content/70 text-xs';
    displayCoords1.textContent = text1Display;
    displayCoords1.dataset.text = text1;

    // Same text classes as the coords themselves, so the icon inherits their size and color.
    const displayCoordsLink = document.createElement('span');
    displayCoordsLink.id = 'bm-display-coords-link';
    displayCoordsLink.className = 'bm-display-coords-clickable bm-display-coords-link text-base-content/70 text-xs';
    displayCoordsLink.title = 'Copy link to this place';
    displayCoordsLink.setAttribute('role', 'button');
    // Follow the map's current zoom so the link reopens the view the user is actually looking at.
    const buildPlaceLink = () => {
      const currentZoom = getZoom();
      const zoom = Number.isFinite(currentZoom) ? Math.round(currentZoom * 100) / 100 : 16;
      return `https://wplace.live/?lat=${geoCoords[0]}&lng=${geoCoords[1]}&zoom=${zoom}`;
    };
    displayCoordsLink.dataset.text = buildPlaceLink();
    // Registered before the copy handler, so the zoom is re-read at click time rather than being
    // frozen at whatever it was when the pixel info opened.
    displayCoordsLink.addEventListener('click', () => {
      displayCoordsLink.dataset.text = buildPlaceLink();
    });
    displayCoordsLink.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>';

    displayCoordsRow.append(displayCoords1, displayCoordsLink);
    displayCoordsContainer.append(displayCoordsRow);
    attachCopyHandler(displayCoords1);
    attachCopyHandler(displayCoordsLink);

    this.updatePixelInfoAllianceBackground();
    this.#maybeTriggerEasterEgg();
  }

  #isRuspixelAllianceText(text) {
    const normalized = String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/g, '');
    if (!normalized) return false;
    return (
      normalized.includes('ruspixel') ||
      normalized.includes('ruspixe') ||
      normalized.includes('руспиксель') ||
      normalized.includes('руспиксел') ||
      normalized.includes('руспикс')
    );
  }

  /** Updates the pixel info window background when the painter alliance is Ruspixel.
   *
   * @since 0.87.6
  */
  updatePixelInfoAllianceBackground() {
    const closeButton = this.getCloseButton();
    const infoRoot = this.getPixelInfoRoot(closeButton);
    const infoCard =
      closeButton?.closest('.selected-pixel')?.closest('.game-panel-surface') ||
      closeButton?.closest('.rounded-t-box') ||
      infoRoot?.querySelector('.rounded-t-box') ||
      infoRoot;

    if (this.templateManager?.isRuspixelFlagEnabled && !this.templateManager.isRuspixelFlagEnabled()) {
      if (infoCard) {
        infoCard.classList.remove('bm-ruspixel-flag');
      }
      if (infoRoot) {
        infoRoot.querySelectorAll('.bm-ruspixel-flag-text').forEach(el => el.classList.remove('bm-ruspixel-flag-text'));
      }
      return;
    }
    if (!closeButton) return;
    if (!infoRoot) return;
    if (!infoCard) return;
    // The new card shows the alliance as a plain chip `<div>` rather than a `.btn`.
    const allianceButton = Array.from(infoRoot.querySelectorAll('button, .selected-pixel div.h-6'))
      .find(button => {
        if (button.tagName === 'BUTTON' && !button.classList.contains('btn')) return false;
        if (button.classList.contains('btn-circle')) return false;
        const possibleText = [
          button.textContent || '',
          button.getAttribute('data-tip') || '',
          button.title || ''
        ].join(' ');
        return this.#isRuspixelAllianceText(possibleText);
      });
    const isRuspixel = !!allianceButton;
    infoCard.classList.toggle('bm-ruspixel-flag', isRuspixel);
    infoRoot.querySelectorAll('.bm-ruspixel-flag-text').forEach(el => el.classList.remove('bm-ruspixel-flag-text'));
    if (isRuspixel) {
      // The tricolour text is painted with `background-clip: text`, which takes over the element's
      // background. On the button itself that wiped wplace's own chip/bevel look (both UIs), so the
      // label's text node is wrapped in a span that carries the effect instead. Svelte keeps updating
      // the same text node, so a reused panel just shows the new name in an unstyled span.
      let label = allianceButton.querySelector(':scope > span[data-rm-alliance-label]');
      if (!label) {
        const textNode = Array.from(allianceButton.childNodes)
          .find(node => node.nodeType === Node.TEXT_NODE && this.#isRuspixelAllianceText(node.textContent || ''));
        if (textNode) {
          label = document.createElement('span');
          label.dataset.rmAllianceLabel = '1';
          textNode.replaceWith(label);
          label.appendChild(textNode);
        }
      }
      (label || allianceButton).classList.add('bm-ruspixel-flag-text');
    }
  }

  #maybeTriggerEasterEgg() {
    const closeButton = this.getCloseButton();
    if (!closeButton) return;
    const infoRoot = this.getPixelInfoRoot(closeButton);
    if (!infoRoot) return;
    this.#watchPixelInfo(infoRoot);
    this.easterEggPainterKey = this.#currentPainterKey(infoRoot);
    this.#runPixelEffects(infoRoot, closeButton, (userId) => this.getPixelEffects?.(userId));
  }

  /** The painter ID currently shown on a card ('' while none is shown). */
  #currentPainterKey(root) {
    return (root.textContent || '').match(/#\s*(\d{4,})\b/)?.[1] || '';
  }

  /** wplace fills in (or swaps) the painter a moment after the pixel request this hooks into,
   * and reuses the same card for the next pixel. So while a card is open, watch it and re-run
   * the effects whenever the painter shown changes. Our own DOM edits (wave letters, motto,
   * typewriter) don't change the painter, so they never re-trigger. */
  #watchPixelInfo(root) {
    if (this.easterEggObservedRoot === root) return;
    this.easterEggObserver?.disconnect();
    this.easterEggObservedRoot = root;
    let scheduled = false;
    // Changes made by the effects themselves (motto, typewriter, wave letters) are tagged
    // `data-rm-fx` and skipped, so they don't wake the alliance check for nothing.
    const isOwnMutation = (record) => {
      const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (element?.closest?.('[data-rm-fx]')) return true;
      if (record.type !== 'childList') return false;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return nodes.length > 0 && nodes.every(node => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-rm-fx'));
    };
    const observer = new MutationObserver((records) => {
      if (records.every(isOwnMutation)) return;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (!root.isConnected) {
          observer.disconnect();
          if (this.easterEggObserver === observer) {
            this.easterEggObserver = null;
            this.easterEggObservedRoot = null;
          }
          return;
        }
        // The alliance chip can also arrive late, so keep the Ruspixel flag in sync here too.
        // The card tint is layered over the flag background, so it is re-applied when the flag flips.
        const hasFlag = () => root.classList.contains('bm-ruspixel-flag') || !!root.querySelector('.bm-ruspixel-flag');
        const flagBefore = hasFlag();
        this.updatePixelInfoAllianceBackground();
        const flagChanged = hasFlag() !== flagBefore;
        if (flagChanged || this.#currentPainterKey(root) !== this.easterEggPainterKey) this.#maybeTriggerEasterEgg();
      });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    this.easterEggObserver = observer;
  }

  /** Called when the effects list (re)loads: a card that opened before it arrived gets its
   * effects now. A card already playing is left alone. */
  refreshPixelEffects() {
    if (!this.easterEggStop && this.easterEggObservedRoot?.isConnected) this.#maybeTriggerEasterEgg();
  }

  /** Plays `config` on a mock pixel-info card (the effects editor's preview). The card must
   * contain the "#<id>" text like wplace's does. Stop it with `stopPixelEffects`.
   * @param {HTMLElement} card
   * @param {object} config Normalized effects config (pixelEffects.js).
   */
  previewPixelEffects(card, config) {
    this.#runPixelEffects(card, null, () => config);
    this.easterEggIsPreview = true;
  }

  /** Stops the preview, but leaves a real pixel-info card that started playing since alone. */
  stopPixelEffectsPreview() {
    if (this.easterEggIsPreview) this.stopPixelEffects();
  }

  /** Stops whatever effects are playing (real pixel info or preview) and restores the text. */
  stopPixelEffects() {
    this.easterEggStop?.();
    this.easterEggStop = null;
  }

  #runPixelEffects(infoRoot, closeButton, resolveConfig) {
    // Only one card plays at a time; the previous run cleans up its own card.
    this.stopPixelEffects();
    this.easterEggIsPreview = false;
    /** The painter's effects config (see pixelEffects.js), set once the painter is known. */
    let fx = null;
    /** Everything read from the page's styles, gathered in one pass before any effect writes a
     * style. Interleaving reads and writes made the browser recalculate styles several times in
     * the first frame. */
    let measured = {};
    const clearFlowTimeouts = () => {
      clearTimeout(this.easterEggPulseTimeout);
      clearTimeout(this.easterEggWaveTimeout); // legacy timer name (compat)
      clearTimeout(this.easterEggWaveStartTimeout);
      clearTimeout(this.easterEggWaveStopTimeout); // legacy timer name (compat)
      clearTimeout(this.easterEggWaveLoopStartTimeout);
    };
    const clearCloseHandler = () => {
      if (this.easterEggCloseButton && this.easterEggCloseHandler) {
        this.easterEggCloseButton.removeEventListener('click', this.easterEggCloseHandler);
      }
      this.easterEggCloseButton = null;
      this.easterEggCloseHandler = null;
      if (this.easterEggClickTarget && this.easterEggClickHandler) {
        this.easterEggClickTarget.removeEventListener('click', this.easterEggClickHandler);
        this.easterEggClickTarget.style.cursor = this.easterEggClickPrevCursor || '';
      }
      this.easterEggClickTarget = null;
      this.easterEggClickHandler = null;
    };
    /** Undoes the name colouring: puts back the exact style attribute wplace had. */
    const clearNameStyle = () => {
      // Newest first, so an element styled twice ends up with its original style.
      (this.easterEggStyleRestores || []).slice().reverse().forEach(restore => restore());
      this.easterEggStyleRestores = [];
    };
    /** Gradient or glowing name text. Only inline styles on wplace's own element, restored on stop. */
    /** Remembers an element's exact style attribute so stop() can put it back. */
    const saveStyle = (element) => {
      const previous = element.getAttribute('style');
      this.easterEggStyleRestores = this.easterEggStyleRestores || [];
      this.easterEggStyleRestores.push(() => {
        if (previous === null) element.removeAttribute('style');
        else element.setAttribute('style', previous);
      });
    };
    const glowShadow = () => `0 0 6px ${fx.nameColors[0]}, 0 0 14px ${fx.nameColors[0]}99`;
    const applyNameStyle = (element) => {
      const font = EASTER_EGG_NAME_FONTS[fx.nameFont];
      if (!element || (fx.nameStyle === 'none' && !font)) return;
      saveStyle(element);
      if (font) Object.assign(element.style, font);
      if (fx.nameStyle === 'none') return;
      const colors = fx.nameColors;
      if (fx.nameStyle === 'glow') {
        element.style.textShadow = glowShadow();
        return;
      }
      if (colors.length === 1) {
        element.style.color = colors[0];
        return;
      }
      // background-clip:text also covers the per-letter spans the wave adds inside it.
      element.style.backgroundImage = `linear-gradient(90deg, ${colors.join(', ')})`;
      element.style.webkitBackgroundClip = 'text';
      element.style.backgroundClip = 'text';
      element.style.webkitTextFillColor = 'transparent';
      element.style.color = 'transparent';
    };
    /** A translucent wash over wplace's card background (the text stays readable). */
    const applyCardTint = (card) => {
      const alpha = EASTER_EGG_CARD_TINT_ALPHA[fx.cardTint];
      if (!card || !alpha) return;
      saveStyle(card);
      const [from, to = from] = fx.cardColors;
      const tint = `linear-gradient(135deg, ${withAlpha(from, alpha)}, ${withAlpha(to, alpha)})`;
      // Layer the tint on top of the card's current background instead of replacing it: the
      // Ruspixel flag and wplace's pixel-UI frame are background layers too, and the flag rule is
      // `!important`, which used to win over a plain inline tint (or the tint wiped the flag).
      // Every background list gets one matching entry prepended so the existing layers keep
      // their own size/position/clip.
      const layer = (property, value) => {
        const current = measured.cardBackground?.[property] || '';
        card.style.setProperty(property, current && current !== 'none' ? `${value}, ${current}` : value, 'important');
      };
      const hadImages = (measured.cardBackground?.['background-image'] || 'none') !== 'none';
      layer('background-image', tint);
      if (hadImages) {
        layer('background-size', '100% 100%');
        layer('background-position', '0% 0%');
        layer('background-repeat', 'no-repeat');
        layer('background-clip', 'padding-box');
        layer('background-origin', 'padding-box');
      }
    };
    /** The owner's motto as one tiny plain-text line under the name. wplace nests the name in
     * horizontal flex rows (name | More/Close buttons), so climb to the first ancestor whose
     * parent stacks its children vertically and insert after that, never beside the name. */
    const findMottoRow = (nameAnchor) => {
      let row = nameAnchor;
      while (row.parentElement && row.parentElement !== infoRoot) {
        const parentStyle = getComputedStyle(row.parentElement);
        const stacksVertically = !parentStyle.display.includes('flex') || parentStyle.flexDirection.startsWith('column');
        if (stacksVertically) break;
        row = row.parentElement;
      }
      return row;
    };
    const showMotto = (row) => {
      if (!row?.parentNode || !fx.motto) return;
      const motto = document.createElement('div');
      motto.setAttribute('data-rm-fx', '');
      motto.textContent = `“${fx.motto}”`;
      motto.style.cssText = 'font-size:10px;line-height:1.3;font-style:italic;opacity:.7;margin:1px 0 0;'
        + 'max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      row.after(motto);
      onStop(() => motto.remove());
      if (prefersReducedMotion) return;
      if (fx.mottoAnimation === 'typewriter') {
        const full = motto.textContent;
        motto.textContent = '';
        const chars = Array.from(full);
        chars.forEach((_, index) => later(() => { motto.textContent = chars.slice(0, index + 1).join(''); }, 350 + index * 55));
      } else if (fx.mottoAnimation === 'fade') {
        motto.animate?.(
          [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 0.7, transform: 'translateY(0)' }],
          { duration: 700, delay: 250, easing: 'ease-out', fill: 'backwards' }
        );
      }
    };
    /** Undoable: registers a cleanup that stop() runs. */
    const onStop = (cleanup) => {
      this.easterEggStyleRestores = this.easterEggStyleRestores || [];
      this.easterEggStyleRestores.push(cleanup);
    };
    /** A looping animation on the name itself (on top of the per-letter wave, which moves the
     * letters inside it). Transforms need a box, so an inline name becomes inline-block. */
    const applyNameAnimation = (element) => {
      if (!element || prefersReducedMotion || fx.nameAnimation === 'none' || typeof element.animate !== 'function') return;
      if (measured.nameDisplay === 'inline') {
        saveStyle(element);
        element.style.display = 'inline-block';
      }
      if (fx.nameAnimation === 'shimmer') {
        saveStyle(element);
        // A light band sweeping through the text. Uses the gradient colours when the name has a
        // gradient, otherwise the name's own colour.
        const base = fx.nameStyle === 'gradient' && fx.nameColors.length > 1
          ? null
          : (fx.nameStyle === 'none' ? measured.nameColor : fx.nameColors[0]);
        const stops = base
          ? `${base} 35%, #ffffff 50%, ${base} 65%`
          : `${fx.nameColors.join(', ')}, #ffffff, ${fx.nameColors.join(', ')}`;
        element.style.backgroundImage = `linear-gradient(110deg, ${stops})`;
        element.style.backgroundSize = '250% 100%';
        element.style.webkitBackgroundClip = 'text';
        element.style.backgroundClip = 'text';
        element.style.webkitTextFillColor = 'transparent';
        const shimmer = element.animate(
          [{ backgroundPosition: '100% 0' }, { backgroundPosition: '-50% 0' }],
          { duration: 2600, iterations: Infinity, easing: 'ease-in-out' }
        );
        onStop(() => shimmer.cancel());
        return;
      }
      const preset = EASTER_EGG_NAME_ANIMATIONS[fx.nameAnimation];
      if (!preset) return;
      // Glitch's calm frames return to the name's own shadow (e.g. the glow), not to none.
      const baseShadow = fx.nameStyle === 'glow' ? glowShadow() : (measured.nameShadow || 'none');
      const frames = preset[0].map(frame => (frame.textShadow === 'none' ? { ...frame, textShadow: baseShadow } : frame));
      const animation = element.animate(frames, { ...preset[1], iterations: Infinity });
      onStop(() => animation.cancel());
    };
    /** One-off entrance of the whole card when it opens. */
    const playCardEntrance = (card) => {
      const preset = EASTER_EGG_CARD_ENTRANCES[fx.cardEntrance];
      if (!card || !preset || prefersReducedMotion || typeof card.animate !== 'function') return;
      const animation = card.animate(preset[0], preset[1]);
      onStop(() => animation.cancel());
    };
    const clearBursts = () => {
      (this.easterEggTimers || []).forEach(timer => clearTimeout(timer));
      this.easterEggTimers = [];
      if (this.easterEggDecorFrame) cancelAnimationFrame(this.easterEggDecorFrame);
      this.easterEggDecorFrame = 0;
      this.easterEggDecorCleanup?.();
      this.easterEggDecorCleanup = null;
      (this.easterEggBursts || []).forEach(layer => layer.remove());
      this.easterEggBursts = [];
      particleCanvas.clear();
    };
    const prefersReducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    /** `#rrggbb` (already validated) + alpha -> `rgba(...)`. */
    const withAlpha = (hex, alpha) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    };
    const randomColor = () => pick(fx.confettiColors);
    const later = (callback, ms) => {
      this.easterEggTimers = this.easterEggTimers || [];
      const timer = setTimeout(() => {
        this.easterEggTimers = (this.easterEggTimers || []).filter(item => item !== timer);
        callback();
      }, ms);
      this.easterEggTimers.push(timer);
    };
    /** A fixed, click-through layer on <body>. Everything here uses inline styles only, so Svelte
     * re-renders and the CSS mangler can't touch it. `lifetimeMs` auto-removes it.
     * `contain:strict` keeps its layout/paint isolated from the page, and every moving part is
     * animated with transform/opacity only, so the work stays on the compositor. */
    const createLayer = (lifetimeMs) => {
      const layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;contain:strict;';
      document.body.appendChild(layer);
      this.easterEggBursts = this.easterEggBursts || [];
      this.easterEggBursts.push(layer);
      if (lifetimeMs) {
        later(() => {
          layer.remove();
          this.easterEggBursts = (this.easterEggBursts || []).filter(item => item !== layer);
        }, lifetimeMs);
      }
      return layer;
    };
    /** Rockets climb out of the top of the card and each one pops into a ring of single-colour
     * pixel sparks that sag under gravity. Drawn on the shared particle canvas. */
    const launchFireworks = (anchor) => {
      if (prefersReducedMotion || !anchor?.isConnected) return;
      const rect = anchor.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const rockets = Math.max(EASTER_EGG_FIREWORK_ROCKETS, fx.fireworkColors.length);
      for (let r = 0; r < rockets; r++) {
        const startX = rect.left + rect.width * (0.15 + Math.random() * 0.7);
        const startY = rect.top;
        const peakX = startX + (Math.random() - 0.5) * 120;
        const peakY = Math.max(30, startY - 140 - Math.random() * 140);
        const color = fx.fireworkColors[r % fx.fireworkColors.length];
        particleCanvas.add({
          sprite: particleCanvas.pixel('#fff8d0', 4, color),
          x: startX,
          y: startY,
          dx: peakX - startX,
          dy: peakY - startY,
          life: 650 + Math.random() * 250,
          delay: r * 380 + Math.random() * 120,
          fadeFrom: 1,
          ease: 'out2',
          onDone: () => {
            if (document.hidden) return;
            for (let i = 0; i < EASTER_EGG_FIREWORK_SPARKS; i++) {
              const angle = (i / EASTER_EGG_FIREWORK_SPARKS) * Math.PI * 2 + Math.random() * 0.15;
              const speed = 70 + Math.random() * 35;
              particleCanvas.add({
                sprite: particleCanvas.pixel(color, 4 + Math.round(Math.random() * 2), color),
                x: peakX,
                y: peakY,
                dx: Math.cos(angle) * speed,
                dy: Math.sin(angle) * speed,
                gravity: 60,
                life: 1100 + Math.random() * 500,
                fadeFrom: 0.55,
                ease: 'out3', // fast pop, then hang in the air
              });
            }
          },
        });
      }
    };
    /** A ring that spins around the card, a badge that drops onto the name and sparkles around
     * it. All live on a layer that follows the card every frame and goes once the card is gone. */
    const showDecor = (card, nameAnchor) => {
      if (!card?.isConnected || (!fx.border && !fx.crown && !fx.sparkles && fx.ambient === 'none')) return;
      const layer = createLayer(0);
      const ringWidth = fx.borderWidth;
      const radius = measured.radius || '12px';
      // Positioned/sized by `follow`. The glow is a static box-shadow on its own element: a CSS
      // filter here would be re-rendered every frame because the spinner inside it keeps moving.
      const glow = document.createElement('div');
      glow.style.cssText = `position:absolute;left:0;top:0;opacity:0;border-radius:${radius};`;
      const halo = document.createElement('div');
      const haloColor = fx.haloColors[0];
      halo.style.cssText = `position:absolute;inset:0;border-radius:${radius};box-shadow:0 0 8px 1px ${withAlpha(haloColor, 0.75)},0 0 18px 2px ${withAlpha(haloColor, 0.4)};`;
      const ring = document.createElement('div');
      ring.style.cssText = `position:absolute;inset:0;padding:${ringWidth}px;overflow:hidden;border-radius:${radius};`
        + '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;'
        + 'mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);';
      // Only as big as the card's diagonal (it just has to cover the ring while rotating).
      const spinner = document.createElement('div');
      spinner.style.cssText = 'position:absolute;left:50%;top:50%;will-change:transform;'
        + `background:conic-gradient(${[...fx.borderColors, fx.borderColors[0]].join(',')});`;
      ring.appendChild(spinner);
      glow.append(halo, ring);
      layer.appendChild(glow);
      glow.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 600, fill: 'forwards' });
      if (!fx.border) {
        glow.style.display = 'none';
      } else if (!prefersReducedMotion) {
        spinner.animate?.([{ transform: 'translate(-50%, -50%) rotate(0deg)' }, { transform: 'translate(-50%, -50%) rotate(360deg)' }], { duration: EASTER_EGG_BORDER_SPIN_MS[fx.borderSpeed] || 2800, iterations: Infinity });
      } else {
        spinner.style.transform = 'translate(-50%, -50%)';
      }

      const crown = document.createElement('div');
      crown.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;';
      const crownGlyph = document.createElement('div');
      crownGlyph.textContent = fx.badge;
      crownGlyph.style.cssText = `position:absolute;left:0;bottom:0;font-size:${EASTER_EGG_BADGE_SIZE_PX[fx.badgeSize] || 20}px;line-height:1;transform-origin:50% 100%;filter:drop-shadow(0 0 4px rgba(255,215,0,.9));`;
      crown.appendChild(crownGlyph);
      layer.appendChild(crown);
      if (!fx.crown) {
        crown.style.display = 'none';
      } else if (prefersReducedMotion) {
        crownGlyph.style.transform = 'translateX(-50%) rotate(-14deg)';
      } else {
        crownGlyph.animate?.(
          [
            { transform: 'translate(-50%, -60px) rotate(-40deg)', opacity: 0, offset: 0 },
            { transform: 'translate(-50%, 0) rotate(-14deg)', opacity: 1, offset: 0.55, easing: 'ease-out' },
            { transform: 'translate(-50%, -12px) rotate(-8deg)', offset: 0.75, easing: 'ease-in' },
            { transform: 'translate(-50%, 0) rotate(-14deg)', opacity: 1, offset: 1 }
          ],
          { duration: 900, delay: 300, easing: 'ease-in', fill: 'backwards' }
        ).finished?.then(() => {
          const idle = {
            wobble: [
              [
                { transform: 'translateX(-50%) rotate(-14deg)' },
                { transform: 'translateX(-50%) rotate(-6deg) translateY(-2px)' },
                { transform: 'translateX(-50%) rotate(-14deg)' }
              ],
              { duration: 1600, easing: 'ease-in-out' }
            ],
            bounce: [
              [
                { transform: 'translateX(-50%) rotate(-14deg) translateY(0)', easing: 'ease-out' },
                { transform: 'translateX(-50%) rotate(-14deg) translateY(-7px)', easing: 'ease-in' },
                { transform: 'translateX(-50%) rotate(-14deg) translateY(0)' }
              ],
              { duration: 900 }
            ],
            spin: [
              [
                { transform: 'translateX(-50%) translateY(-4px) rotate(-14deg)' },
                { transform: 'translateX(-50%) translateY(-4px) rotate(346deg)' }
              ],
              { duration: 2400, easing: 'linear' }
            ],
          }[fx.badgeAnimation];
          if (!idle) return;
          if (fx.badgeAnimation === 'spin') crownGlyph.style.transformOrigin = '50% 55%';
          crownGlyph.animate(idle[0], { ...idle[1], iterations: Infinity });
        }).catch(() => {});
        crownGlyph.style.transform = 'translateX(-50%) rotate(-14deg)';
      }

      // Twinkling stars scattered around the name. The box is sized to the name in `follow`,
      // the stars are placed in % of it, so they need no per-frame work of their own.
      const sparkleBox = document.createElement('div');
      sparkleBox.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;';
      if (fx.sparkles) {
        for (let i = 0; i < EASTER_EGG_SPARKLE_COUNT; i++) {
          const star = document.createElement('div');
          const color = pick(fx.sparkleColors);
          // Around the edges of the name, never on top of the letters themselves.
          const side = i % 4;
          const along = Math.random() * 100;
          const [x, y] = side === 0 ? [along, -45 - Math.random() * 25]
            : side === 1 ? [along, 115 + Math.random() * 25]
              : side === 2 ? [-12 - Math.random() * 10, Math.random() * 100]
                : [108 + Math.random() * 10, Math.random() * 100];
          star.textContent = '✦';
          star.style.cssText = `position:absolute;left:${x.toFixed(0)}%;top:${y.toFixed(0)}%;font-size:${Math.round(8 + Math.random() * 6)}px;line-height:1;`
            + `color:${color};text-shadow:0 0 5px ${color};opacity:0;`;
          sparkleBox.appendChild(star);
          if (prefersReducedMotion) {
            star.style.opacity = '0.8';
          } else {
            star.animate?.(
              [
                { opacity: 0, transform: 'translate(-50%, -50%) scale(.3) rotate(0deg)' },
                { opacity: 1, transform: 'translate(-50%, -50%) scale(1) rotate(45deg)' },
                { opacity: 0, transform: 'translate(-50%, -50%) scale(.3) rotate(90deg)' }
              ],
              { duration: 1300 + Math.random() * 900, delay: Math.random() * 1500, iterations: Infinity, easing: 'ease-in-out' }
            );
          }
        }
        layer.appendChild(sparkleBox);
      }

      // Ambient particles drifting across the card, clipped to it. Each particle sits in a
      // full-height column, and the column is what moves: translateY(100%) of the column is the
      // card's height, so the whole thing stays compositor-only without measuring anything.
      const ambient = EASTER_EGG_AMBIENT[fx.ambient];
      const ambientBox = document.createElement('div');
      ambientBox.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;border-radius:${radius};`;
      if (ambient && !prefersReducedMotion) {
        for (let i = 0; i < EASTER_EGG_AMBIENT_COUNT; i++) {
          const column = document.createElement('div');
          column.style.cssText = `position:absolute;top:0;left:${(4 + Math.random() * 92).toFixed(1)}%;width:0;height:100%;`;
          const glyph = document.createElement('div');
          const color = pick(fx.ambientColors);
          const size = ambient.size[0] + Math.random() * (ambient.size[1] - ambient.size[0]);
          glyph.textContent = pick(ambient.glyphs);
          glyph.style.cssText = `position:absolute;left:0;top:0;font-size:${size.toFixed(0)}px;line-height:1;color:${color};`
            + (ambient.glow ? `text-shadow:0 0 5px ${color};` : '');
          column.appendChild(glyph);
          ambientBox.appendChild(column);
          const time = ambient.time[0] + Math.random() * (ambient.time[1] - ambient.time[0]);
          const [from, to] = ambient.up ? ['105%', '-10%'] : ['-10%', '105%'];
          column.animate?.(
            [
              { transform: `translateY(${from})`, opacity: 0 },
              { opacity: 0.85, offset: 0.15 },
              { opacity: 0.85, offset: 0.8 },
              { transform: `translateY(${to})`, opacity: 0 }
            ],
            // Negative delay: start mid-flight so the card isn't empty for the first seconds.
            { duration: time, delay: -Math.random() * time, iterations: Infinity, easing: 'linear' }
          );
          glyph.animate?.(
            [{ transform: `translateX(${-ambient.sway}px)` }, { transform: `translateX(${ambient.sway}px)` }],
            { duration: 1400 + Math.random() * 1400, delay: -Math.random() * 2000, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }
          );
        }
        layer.appendChild(ambientBox);
      }

      // Reads two rects per check and only touches styles when the card actually moved or
      // resized (size changes are the only writes that cause layout, and `contain:strict` keeps
      // that inside this layer). The card almost never moves, so checking every frame is only
      // done while something can be moving: the first moments (entrance, badge drop), after a
      // resize/scroll/click, or always when the name itself is animated. Otherwise a slow poll.
      const ALWAYS_TRACK = fx.nameAnimation !== 'none' && (fx.crown || fx.sparkles);
      let trackUntil = performance.now() + 1500;
      let pollTimer = 0;
      const wake = () => {
        trackUntil = Math.max(trackUntil, performance.now() + 700);
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = 0;
          this.easterEggDecorFrame = requestAnimationFrame(follow);
        }
      };
      this.easterEggDecorWake = wake;
      const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(wake) : null;
      resizeObserver?.observe(card);
      if (nameAnchor && nameAnchor !== card) resizeObserver?.observe(nameAnchor);
      window.addEventListener('resize', wake);
      window.addEventListener('scroll', wake, true);
      this.easterEggDecorCleanup = () => {
        clearTimeout(pollTimer);
        pollTimer = 0;
        resizeObserver?.disconnect();
        window.removeEventListener('resize', wake);
        window.removeEventListener('scroll', wake, true);
        if (this.easterEggDecorWake === wake) this.easterEggDecorWake = null;
      };
      let lastPos = '';
      let lastSize = '';
      let lastCrown = '';
      let lastSparkle = '';
      let hidden = false;
      const follow = () => {
        pollTimer = 0;
        if (!card.isConnected) {
          layer.remove();
          this.easterEggDecorFrame = 0;
          this.easterEggDecorCleanup?.();
          return;
        }
        const cardRect = card.getBoundingClientRect();
        const isHidden = !cardRect.width || !cardRect.height;
        if (isHidden !== hidden) {
          hidden = isHidden;
          // display:none also stops the infinite spin/wobble from being rendered.
          layer.style.display = hidden ? 'none' : '';
        }
        if (!hidden) {
          const size = `${Math.round(cardRect.width)}x${Math.round(cardRect.height)}`;
          if (size !== lastSize) {
            lastSize = size;
            glow.style.width = `${cardRect.width + ringWidth * 2}px`;
            glow.style.height = `${cardRect.height + ringWidth * 2}px`;
            const diagonal = Math.ceil(Math.hypot(cardRect.width, cardRect.height)) + ringWidth * 2 + 4;
            spinner.style.width = `${diagonal}px`;
            spinner.style.height = `${diagonal}px`;
            ambientBox.style.width = `${cardRect.width}px`;
            ambientBox.style.height = `${cardRect.height}px`;
          }
          const pos = `translate(${(cardRect.left - ringWidth).toFixed(1)}px, ${(cardRect.top - ringWidth).toFixed(1)}px)`;
          if (pos !== lastPos) {
            lastPos = pos;
            glow.style.transform = pos;
            ambientBox.style.transform = `translate(${cardRect.left.toFixed(1)}px, ${cardRect.top.toFixed(1)}px)`;
          }
          const nameRect = (nameAnchor?.isConnected ? nameAnchor : card).getBoundingClientRect();
          // Sits on the top edge of the name, over its first or last letters.
          const crownX = fx.badgePosition === 'end' ? nameRect.right - 8 : nameRect.left + 10;
          const crownPos = `translate(${crownX.toFixed(1)}px, ${(nameRect.top + 3).toFixed(1)}px)`;
          if (crownPos !== lastCrown) {
            lastCrown = crownPos;
            crown.style.transform = crownPos;
          }
          if (fx.sparkles) {
            const sparkleKey = `${nameRect.left.toFixed(1)},${nameRect.top.toFixed(1)},${Math.round(nameRect.width)}x${Math.round(nameRect.height)}`;
            if (sparkleKey !== lastSparkle) {
              lastSparkle = sparkleKey;
              sparkleBox.style.transform = `translate(${nameRect.left.toFixed(1)}px, ${nameRect.top.toFixed(1)}px)`;
              sparkleBox.style.width = `${Math.round(nameRect.width)}px`;
              sparkleBox.style.height = `${Math.round(nameRect.height)}px`;
            }
          }
        }
        if (ALWAYS_TRACK || performance.now() < trackUntil) {
          this.easterEggDecorFrame = requestAnimationFrame(follow);
        } else {
          this.easterEggDecorFrame = 0;
          pollTimer = setTimeout(follow, 400);
        }
      };
      follow();
    };
    /** Fires pixel confetti (palette squares + a few glyphs) out of the anchor's centre, on the
     * shared particle canvas (see particleCanvas.js for why not DOM elements). */
    const spawnBurst = (anchor, count) => {
      if (prefersReducedMotion || !anchor?.isConnected) return;
      const rect = anchor.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;
      for (let i = 0; i < count; i++) {
        const color = randomColor();
        const sprite = Math.random() < 0.22
          ? particleCanvas.glyph(pick(EASTER_EGG_BURST_GLYPHS), color, 12 + Math.random() * 10)
          : particleCanvas.pixel(color, 4 + Math.random() * 5);
        // Mostly-upward cone, then gravity pulls everything down past the start point.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
        const speed = 90 + Math.random() * 170;
        particleCanvas.add({
          sprite,
          x: originX,
          y: originY,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          gravity: 260 + Math.random() * 120,
          spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720),
          life: 1300 + Math.random() * 900,
          delay: Math.random() * 120,
          scaleFrom: 0.2,
          scaleTo: 0.8,
          scaleSpeed: 6,
          ease: 'out2',
        });
      }
    };
    /** Puts a waved element back: drops the letter spans and returns wplace's own text nodes. */
    const unwrapWave = (target) => {
      (target.__bmEasterEggWaveAnimations || []).forEach(animation => {
        try {
          animation.cancel();
        } catch {}
      });
      target.__bmEasterEggWaveAnimations = null;
      const holder = target.__bmEasterEggWaveHolder;
      if (holder) {
        Array.from(target.querySelectorAll(':scope > [data-rm-wave-char]')).forEach(node => node.remove());
        if (holder.parentNode === target) holder.replaceWith(...holder.childNodes);
      } else {
        const originalText = target.getAttribute('data-bm-easter-egg-wave-original');
        if (originalText !== null) target.textContent = originalText;
      }
      target.__bmEasterEggWaveHolder = null;
      target.removeAttribute('data-bm-easter-egg-wave-original');
    };
    const clearWave = () => {
      Array.from(infoRoot.querySelectorAll('[data-bm-easter-egg-wave-original]')).forEach(unwrapWave);
    };
    const getWaveTargets = (targetElement, idPattern) => {
      const container =
        targetElement.closest('.inline-flex.items-baseline') ||
        targetElement.closest('.flex.gap-1\\.5')?.querySelector('.inline-flex.items-baseline') ||
        targetElement.closest('.m-1.flex.w-full.items-start.gap-2')?.querySelector('.inline-flex.items-baseline') ||
        targetElement.closest('.flex.flex-wrap.items-center.gap-1')?.querySelector('.inline-flex.items-baseline') ||
        targetElement.closest('.flex.h-10.items-center.justify-between')?.querySelector('.inline-flex.items-baseline') ||
        targetElement.parentElement;
      if (!container) return [];
      const leaves = Array.from(container.querySelectorAll('*'))
        .filter(element => !element.children.length && /\S/.test(element.textContent || ''));
      const textLeaves = leaves.length ? leaves : (/\S/.test(container.textContent || '') ? [container] : []);
      const idElement =
        textLeaves.find(element => idPattern.test(element.textContent || '')) ||
        targetElement;
      const nameElement =
        textLeaves.find(element => element !== idElement && !/#\s*\d+\b/.test(element.textContent || '')) ||
        textLeaves.find(element => element !== idElement) ||
        null;
      return Array.from(new Set([nameElement, idElement].filter(Boolean)));
    };
    const applyWave = (targetElements, { iterations = Infinity } = {}) => {
      let waveIndex = 0;
      let maxDelay = 0;
      targetElements.forEach(target => {
        let chars;
        const existingHolder = target.__bmEasterEggWaveHolder;
        if (existingHolder?.parentNode === target
          && existingHolder.textContent === target.getAttribute('data-bm-easter-egg-wave-original')) {
          // Same text as last loop: keep the letter spans and just replay their animations,
          // instead of tearing the DOM down and rebuilding it every few seconds.
          (target.__bmEasterEggWaveAnimations || []).forEach(animation => {
            try {
              animation.cancel();
            } catch {}
          });
          chars = Array.from(target.querySelectorAll(':scope > [data-rm-wave-char]'));
        } else {
          if (target.hasAttribute('data-bm-easter-egg-wave-original')) unwrapWave(target);
          const originalText = target.textContent || '';
          if (!/\S/.test(originalText)) return;
          target.setAttribute('data-bm-easter-egg-wave-original', originalText);
          // wplace (Svelte) keeps a reference to its text node and updates it in place when another
          // pixel opens. Replacing it would freeze the name, so it is parked, hidden, inside the
          // element instead; its updates still land in the DOM and the observer sees them.
          const holder = document.createElement('span');
          holder.style.display = 'none';
          Array.from(target.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .forEach(node => holder.appendChild(node));
          target.appendChild(holder);
          target.__bmEasterEggWaveHolder = holder;
          const fragment = document.createDocumentFragment();
          chars = Array.from(originalText, character => {
            const waveChar = document.createElement('span');
            waveChar.setAttribute('data-rm-wave-char', '');
            waveChar.setAttribute('data-rm-fx', '');
            waveChar.textContent = character === ' ' ? '\u00A0' : character;
            waveChar.style.display = 'inline-block';
            fragment.appendChild(waveChar);
            return waveChar;
          });
          target.appendChild(fragment);
        }
        const animations = [];
        chars.forEach(waveChar => {
          if (typeof waveChar.animate === 'function') {
            const delay = waveIndex * EASTER_EGG_WAVE_STAGGER_MS;
            animations.push(waveChar.animate(
              [
                { transform: 'translateY(0)' },
                { transform: 'translateY(-4px)' },
                { transform: 'translateY(0)' }
              ],
              { duration: EASTER_EGG_WAVE_STEP_DURATION_MS, easing: 'ease-in-out', iterations, delay }
            ));
            if (delay > maxDelay) maxDelay = delay;
          }
          waveIndex += 1;
        });
        target.__bmEasterEggWaveAnimations = animations;
        waveIndex += 2;
      });
      return EASTER_EGG_WAVE_STEP_DURATION_MS + maxDelay;
    };
    const runPulse = (animTarget) => {
      if (typeof animTarget.animate === 'function') {
        animTarget.__bmEasterEggPulseAnimation?.cancel();
        animTarget.__bmEasterEggPulseAnimation = animTarget.animate(
          // Transform only. A filter (or the old text-shadow glow) on this element forces the
          // name and every animated wave letter inside it to be re-rendered each frame.
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.14)' },
            { transform: 'scale(1)' }
          ],
          { duration: 1400, easing: 'ease-in-out', iterations: 1 }
        );
        this.easterEggPulseTimeout = setTimeout(() => {
          const pulseAnimation = animTarget.__bmEasterEggPulseAnimation;
          if (!pulseAnimation) return;
          try {
            pulseAnimation.cancel();
          } catch {}
          animTarget.__bmEasterEggPulseAnimation = null;
        }, 1450);
        return;
      }
      animTarget.classList.remove('bm-easter-egg');
      void animTarget.offsetWidth;
      animTarget.classList.add('bm-easter-egg');
      this.easterEggPulseTimeout = setTimeout(() => animTarget.classList.remove('bm-easter-egg'), 1400);
    };
    clearFlowTimeouts();
    clearCloseHandler();
    clearWave();
    clearBursts();
    // The painter's "#123456" ID. Whoever it is, their effects come from the shared config
    // (built-in defaults cover a few accounts until they save their own).
    const idRegex = /#\s*(\d{4,})\b/;
    let matchedUserID = null;
    // Only an element's own text nodes count, so the innermost element holding the ID wins.
    const ownText = (element) => Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('');
    const allElements = Array.from(infoRoot.querySelectorAll('*'));
    const matchesPainter = (text) => {
      const match = text.match(idRegex);
      if (!match) return false;
      const config = resolveConfig(Number(match[1]));
      if (!config) return false;
      matchedUserID = Number(match[1]);
      fx = config;
      return true;
    };
    const targetElement =
      allElements.find(element => matchesPainter(ownText(element))) ||
      // "#" and the digits in separate elements: take the deepest element whose text has both.
      allElements.findLast?.(element => matchesPainter(element.textContent || '')) ||
      null;
    if (!targetElement || !fx) return;
    const anyEffect = fx.pulse || fx.wave || fx.confetti || fx.fireworks || fx.crown || fx.border || fx.clickExplode
      || fx.sparkles || fx.nameStyle !== 'none' || fx.nameFont !== 'default' || fx.cardTint !== 'off' || !!fx.motto
      || fx.nameAnimation !== 'none' || fx.cardEntrance !== 'none' || fx.ambient !== 'none';
    if (!anyEffect) return;
    const idPattern = new RegExp(`#\\s*${matchedUserID}\\b`);
    const animTarget =
      targetElement.closest('.inline-flex.items-baseline') ||
      targetElement.closest('.flex.gap-1\\.5') ||
      targetElement.closest('.m-1.flex.w-full.items-start.gap-2') ||
      targetElement.closest('.flex.items-center.gap-2') ||
      targetElement.closest('.flex.h-10.items-center.justify-between')?.querySelector('.flex.items-center.gap-2') ||
      targetElement;
    this.easterEggStop = () => {
      clearFlowTimeouts();
      clearWave();
      clearBursts();
      clearNameStyle();
      clearCloseHandler();
    };
    if (closeButton) {
      this.easterEggCloseButton = closeButton;
      this.easterEggCloseHandler = () => this.stopPixelEffects();
      closeButton.addEventListener('click', this.easterEggCloseHandler, { once: true });
    }
    const nameElement = getWaveTargets(targetElement, idPattern)[0] || null;
    // Read phase: one style pass for everything the effects need...
    const cardStyle = getComputedStyle(infoRoot);
    const nameStyle = nameElement ? getComputedStyle(nameElement) : null;
    measured = {
      radius: cardStyle.borderRadius,
      cardBackground: Object.fromEntries(
        ['background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip', 'background-origin']
          .map(property => [property, cardStyle.getPropertyValue(property).trim()])
      ),
      nameDisplay: nameStyle?.display,
      nameColor: nameStyle?.color,
      nameShadow: nameStyle?.textShadow,
      mottoRow: fx.motto ? findMottoRow(animTarget) : null,
    };
    if (fx.confetti) spawnBurst(animTarget, EASTER_EGG_BURST_PARTICLES); // reads the layout once
    // ...then the write phase.
    if (fx.pulse) runPulse(animTarget);
    playCardEntrance(infoRoot);
    applyNameStyle(nameElement);
    applyNameAnimation(nameElement);
    applyCardTint(infoRoot);
    showMotto(measured.mottoRow);
    showDecor(infoRoot, nameElement || animTarget);
    if (fx.fireworks) later(() => launchFireworks(infoRoot), 500);
    if (fx.clickExplode && (fx.pulse || fx.confetti || fx.fireworks)) {
      // Clicking the name/ID fires it all again.
      let lastClickAt = 0;
      this.easterEggClickTarget = animTarget;
      this.easterEggClickPrevCursor = animTarget.style.cursor;
      animTarget.style.cursor = 'pointer';
      this.easterEggClickHandler = () => {
        const now = performance.now();
        if (now - lastClickAt < EASTER_EGG_CLICK_COOLDOWN_MS) return;
        if (particleCanvas.count >= EASTER_EGG_MAX_PARTICLES) return;
        lastClickAt = now;
        this.easterEggDecorWake?.();
        if (fx.pulse) {
          clearTimeout(this.easterEggPulseTimeout);
          runPulse(animTarget);
        }
        if (fx.confetti) spawnBurst(animTarget, EASTER_EGG_BURST_PARTICLES);
        if (fx.fireworks) launchFireworks(infoRoot);
      };
      animTarget.addEventListener('click', this.easterEggClickHandler);
    }
    if (!fx.wave && !fx.confetti && !fx.fireworks) return;
    // Repeats while the card is open: the letter wave (if on), plus a smaller confetti burst and
    // another salute. Without the wave, the repeat just runs on a fixed beat.
    const runLoop = (waveTargets) => {
      const waveDuration = fx.wave && waveTargets.length
        ? applyWave(waveTargets, { iterations: 1 })
        : EASTER_EGG_WAVE_STEP_DURATION_MS;
      if (!document.hidden) {
        if (fx.confetti) spawnBurst(animTarget, EASTER_EGG_LOOP_BURST_PARTICLES);
        if (fx.fireworks) launchFireworks(infoRoot);
      }
      this.easterEggWaveLoopStartTimeout = setTimeout(() => {
        runLoop(waveTargets);
      }, waveDuration + EASTER_EGG_WAVE_PAUSE_BEFORE_LOOP_MS);
    };
    this.easterEggWaveStartTimeout = setTimeout(() => {
      runLoop(fx.wave ? getWaveTargets(targetElement, idPattern) : []);
    }, 1450 + EASTER_EGG_WAVE_FIRST_DELAY_MS);
  }

  /** Determines if the spontaneously received response is something we want.
   * Otherwise, we can ignore it.
   * Note: Due to aggressive compression, make your calls like `data['jsonData']['name']` instead of `data.jsonData.name`
   * 
   * @param {Overlay} overlay - The Overlay class instance
   * @since 0.11.1
  */
  spontaneousResponseListener(overlay) {

    this.#setUpTimeout();
    this.#observePixelInfoCards();

    // Triggers whenever a message is sent
    window.addEventListener('message', async (event) => {

      const data = event.data; // The data of the message
      const dataJSON = data['jsonData']; // The JSON response, if any

      // Kills itself if the message was not intended for Blue Marble
      if (!(data && data['source'] === 'blue-marble')) {return;}

      // Kills itself if the message has no endpoint (intended for Blue Marble, but not this function)
      if (!data['endpoint']) {return;}

      // Trims endpoint to the second to last non-number, non-null directoy.
      // E.g. "wplace.live/api/pixel/0/0?payload" -> "pixel"
      // E.g. "wplace.live/api/files/s0/tiles/0/0/0.png" -> "tiles"
      const endpointText = data['endpoint']?.split('?')[0].split('/').filter(s => s && isNaN(Number(s))).filter(s => s && !s.includes('.')).pop();

      consoleLog(`%cRus Marble%c: Recieved message about "%s"`, 'color: cornflowerblue;', '', endpointText);

      // Each case is something that Rus Marble can use from the fetch.
      // For instance, if the fetch was for "me", we can update the overlay stats
      switch (endpointText) {

        case 'me': // Request to retrieve user data

          // If the game can not retrieve the userdata...
          if (dataJSON['status'] && dataJSON['status']?.toString()[0] != '2') {
            // The server is probably down (NOT a 2xx status)
            
            if (!(dataJSON['fallback'] ?? false)) {
              overlay.handleDisplayError(`You are not logged in!\nCould not fetch userdata.`);
            }
            return; // Kills itself before attempting to display null userdata
          }

          this.#applyUserData(dataJSON, Date.now());
          break;

        case 'pixel': // Request to retrieve pixel data (or when submitting a pixel)
          const coordsTile = data['endpoint'].split('?')[0].split('/').filter(s => s && !isNaN(Number(s))).map(s => Number(s)); // Retrieves the tile coords as [x, y]
          if ((data['jsonData'] ?? {})["painted"] !== undefined) { // POST request
            if (!coordsTile.length) {
              return; // Kills itself
            }
            // Force remove the tile from the cache since Last-Modified updates not at the same time as pixel submissions
            const tileKey = coordsTile[0].toString().padStart(4, '0') + ',' + coordsTile[1].toString().padStart(4, '0');
            if (this.tileCache[tileKey]) {
              delete this.tileCache[tileKey];
            }
            break;
          }
          const payloadExtractor = new URLSearchParams(data['endpoint'].split('?')[1]); // Declares a new payload deconstructor and passes in the fetch request payload
          const coordsPixel = [
            +payloadExtractor.get('x'),
            +payloadExtractor.get('y')
          ]; // Retrieves the deconstructed pixel coords from the payload
          
          // Don't save the coords if there are previous coords that could be used
          if (this.coordsTilePixel.length && (!coordsTile.length || !coordsPixel.length)) {
            overlay.handleDisplayError(`Coordinates are malformed!\nDid you try clicking the canvas first?`);
            return; // Kills itself
          }

          // Fix boundary cases
          if (coordsTile[0] < 0 && coordsPixel[0] < 0) {
            // Probably some JS rounding issues
            // i.e. x is negative, it returns floor(x / 2048) and (x % 2048), which are both negative
            coordsTile[0] += 2048;
            coordsPixel[0] += 1000;
          } else if (coordsTile[0] >= 2048) {
            coordsTile[0] -= 2048;
          }
          
          this.coordsTilePixel = [...coordsTile, ...coordsPixel]; // Combines the two arrays such that [x, y, x, y]
          this.updateDisplayCoords();
          try {
            if (typeof this.onCoordsUpdated === 'function') {
              this.onCoordsUpdated([...this.coordsTilePixel]);
            }
          } catch (_) {}
          break;
        
        case 'tiles':

          // Runs only if the tile has the template
          let tileCoordsTile = data['endpoint'].split('/');
          tileCoordsTile = [parseInt(tileCoordsTile[tileCoordsTile.length - 2]), parseInt(tileCoordsTile[tileCoordsTile.length - 1].replace('.png', ''))];
          const involvedTemplates = this.templateManager.getInvolvedTemplates(tileCoordsTile);

          const blobData = data['blobData'];
          if (involvedTemplates.length === 0) {
            break;
          }

          const tileKey = tileCoordsTile[0].toString().padStart(4, '0') + ',' + tileCoordsTile[1].toString().padStart(4, '0');
          const lastModified = data["lastModified"];
          // Hand the page's own copy to the overlay: re-fetching this URL goes through the browser
          // cache and wplace's service worker, which serve the pre-erase tile for a while.
          this.templateManager.setLatestTileBlob?.(tileKey, blobData, lastModified);
          // We need the list of enabled colors to generate the unpainted list
          const fullKey = this.templateManager.getTileCacheKey(tileCoordsTile);
          const errorMap = +this.templateManager.isErrorMapShown();

          const fullKeyChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["fullKey"] !== fullKey;
          const lastModifiedChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["lastModified"] !== lastModified;
          const errorMapChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["errorMap"] !== errorMap;
          consoleLog(this.tileCache[tileKey]);
          consoleLog(fullKey, lastModified, errorMap);
          consoleLog(fullKeyChanged, lastModifiedChanged, errorMapChanged);
          if (!fullKeyChanged && !lastModifiedChanged && !errorMapChanged) {
            consoleLog(`Unchanged tile: "${tileKey}"`);
          } else {
            if ((
              fullKeyChanged ||
              lastModifiedChanged ||
              (errorMapChanged && errorMap) // error map toggled on
            )) {
              await this.templateManager.countTemplateStatus(blobData, tileCoordsTile);
            }
            this.tileCache[tileKey] = { lastModified, fullKey, errorMap };
          }

          // no more need to respond
          break;

        case 'random': // Request to teleport to random location
          const blobUUID_ = data['blobID'];
          
          const overrideCoords = overrideRandom["data"];
          const jsonData = overrideCoords === null ? (
            dataJSON // remain unchanged
          ) : (
            {
              "pixel": {
                "x": overrideCoords[1][0],
                "y": overrideCoords[1][1],
              },
              "tile": {
                "x": overrideCoords[0][0],
                "y": overrideCoords[0][1],
              }
            }
          );
          overrideRandom["data"] = null;

          window.postMessage({
            source: 'blue-marble',
            blobID: blobUUID_,
            blobData: JSON.stringify(jsonData),
            blink: data['blink']
          });
          break;

        case 'robots': // Request to retrieve what script types are allowed
          this.disableAll = dataJSON['userscript']?.toString().toLowerCase() == 'false'; // Disables Rus Marble if site owner wants userscripts disabled
          break;

        // some interesting endpoints:
        // https://backend.wplace.live/me/pixels-painted-today
        // {"paintedToday":value}
      }
    });
  }
}

