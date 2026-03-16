/** ApiManager class for handling API requests, responses, and interactions.
 * Note: Fetch spying is done in main.js, not here.
 * @class ApiManager
 * @since 0.11.1
 */

import TemplateManager from "./templateManager.js";
import { consoleError, escapeHTML, numberToEncoded, serverTPtoDisplayTP, cleanUpCanvas, copyToClipboard, getOverlayCoords, areOverlayCoordsFilledAndValid, calculateTopLeftAndSize, downloadTile, testCanvasSize, consoleLog, lineBitmap, getCurrentColor, colorpalette, midPointDistance, circleBitmap } from "./utils.js";
import { coordsTileCoordsToGeoCoords, overrideRandom } from "./utilsMaptiler.js";

const EASTER_EGG_USER_ID = 11728406;
const EASTER_EGG_WAVE_FIRST_DELAY_MS = 2000;
const EASTER_EGG_WAVE_PAUSE_BEFORE_LOOP_MS = 3000;
const EASTER_EGG_WAVE_STEP_DURATION_MS = 1800;
const EASTER_EGG_WAVE_STAGGER_MS = 90;
const TEMPLATE_DOWNLOAD_SOURCE_LIVE = 'live';
const TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE = 'archive';
const ARCHIVE_TEMPLATE_BASE_URL = 'https://wplace.eralyon.net';
const ARCHIVE_REGION_PIXEL_BASE_URL = 'https://backend.wplace.live/s0/pixel';
const TEMPLATE_TILE_SIZE = 1000;
const MAP_WORLD_WIDTH_PX = 2048 * TEMPLATE_TILE_SIZE;

const buildArchiveCenterCoords = (left, top, width, height) => {
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  const centerX = ((left + Math.floor((width - 1) / 2)) % MAP_WORLD_WIDTH_PX + MAP_WORLD_WIDTH_PX) % MAP_WORLD_WIDTH_PX;
  const centerY = top + Math.floor((height - 1) / 2);
  return {
    tx: Math.floor(centerX / TEMPLATE_TILE_SIZE),
    ty: Math.floor(centerY / TEMPLATE_TILE_SIZE),
    px: centerX % TEMPLATE_TILE_SIZE,
    py: centerY % TEMPLATE_TILE_SIZE,
  };
};

const buildArchiveRegionFallbackLabel = (centerCoords) => {
  if (!centerCoords) return 'Unknown Region';
  return `Tile ${centerCoords.tx},${centerCoords.ty} Pixel ${centerCoords.px},${centerCoords.py}`;
};

const parseArchiveRegionResponse = (response) => {
  const raw = response?.response ?? response?.responseText;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return {};
    }
  }
  return {};
};

const fetchArchiveRegionLabel = async (centerCoords) => {
  if (!centerCoords) return '';
  const url = `${ARCHIVE_REGION_PIXEL_BASE_URL}/${encodeURIComponent(centerCoords.tx)}/${encodeURIComponent(centerCoords.ty)}?x=${encodeURIComponent(centerCoords.px)}&y=${encodeURIComponent(centerCoords.py)}`;
  consoleLog('Archive region request', { url, centerCoords });
  const data = await new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      reject(new Error('GM_xmlhttpRequest is unavailable.'));
      return;
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      responseType: 'json',
      onload: (response) => {
        const status = Number(response?.status);
        const parsed = parseArchiveRegionResponse(response);
        consoleLog('Archive region response', { url, status, data: parsed });
        if (status < 200 || status >= 300) {
          reject(new Error(`Archive region request failed (${status}).`));
          return;
        }
        resolve(parsed);
      },
      onerror: (error) => {
        consoleLog('Archive region request error', { url, error });
        reject(error);
      },
    });
  });
  const regionName = String(data?.region?.name || '').trim();
  const regionNumber = String(data?.region?.number || '').trim();
  return [regionName, regionNumber].filter(Boolean).join(' ').trim();
};

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
    this.eventClaimed = null;
    this.lastFetchedTime = null;
    this.eventData = null;
    this.eventDataURL = null;
    this.onCoordsUpdated = null;
    this.displayCoordsRetryTimeout = null;
    this.templateDownloadSource = TEMPLATE_DOWNLOAD_SOURCE_LIVE;
    this.templateArchiveVersionValue = '';
    this.templateArchiveVersionCache = new Map();
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
    if (allianceOrRankingButton !== undefined && logoutButton !== undefined) {
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
        });
        this.lastFetchedTime = currentTime;
      }
    }
  }

  #applyUserData(dataJSON, fetchTime) {
    if (dataJSON === null) return;
    const nextLevelPixels = Math.ceil(Math.pow(Math.floor(dataJSON['level']) * Math.pow(30, 0.65), (1/0.65)) - dataJSON['pixelsPainted']); // Calculates pixels to the next level

    console.log(dataJSON['id']);
    if (!!dataJSON['id'] || dataJSON['id'] === 0) {
      console.log(numberToEncoded(
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
      nextLevelElement.textContent = Math.floor(dataJSON['level']) + 1;
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

    const selectors = [
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
    for (const selector of selectors) {
      const closeButton = document.querySelector(selector);
      if (closeButton) return closeButton;
    }

    const candidates = Array.from(
      document.querySelectorAll('.rounded-t-box button.btn-circle, dialog.modal button.btn-circle, dialog button.btn-circle, .modal button.btn-circle')
    );
    const scoredCandidates = candidates
      .map(button => {
        const label = [
          button.getAttribute('aria-label') || '',
          button.title || '',
          button.textContent || ''
        ].join(' ');
        const root = this.getPixelInfoRoot(button);
        let score = 0;
        if (/close/i.test(label)) score += 12;
        if (this.#isVisibleElement(button)) score += 4;
        if (root && this.#hasPixelInfoContent(root)) score += 3;
        if (button.parentElement?.lastElementChild === button) score += 1;
        return { button, score };
      })
      .sort((left, right) => right.score - left.score);
    return scoredCandidates.find(candidate => candidate.score > 0)?.button || candidates[0] || null;
  }

  /** Get the root element of the current pixel info panel.
   *
   * @param {HTMLElement | null} closeButton
   * @returns {HTMLElement | null}
   * @since 0.87.32
   */
  getPixelInfoRoot(closeButton = this.getCloseButton()) {
    if (!closeButton) return null;
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
    const text2 = `(${geoCoords[0].toFixed(5)}, ${geoCoords[1].toFixed(5)})`;
    const text1Display = `Tl ${coordsTile[0]}, ${coordsTile[1]} | Px ${coordsPixel[0]}, ${coordsPixel[1]}`;
    const text2Display = `${geoCoords[0].toFixed(5)}, ${geoCoords[1].toFixed(5)}`;

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
  
    const coordRow = this.getDisplayCoordsAnchor(closeButton, infoRoot);
    if (!coordRow) {
      this.#scheduleDisplayCoordsRetry(retryCount);
      return;
    }
    const coordPattern = /\b\d{1,7}\s*,\s*\d{1,7}\b/;
    const isLikelyHeaderFallback =
      coordRow === closeButton.parentElement &&
      !coordPattern.test(coordRow.textContent || '');
    if (isLikelyHeaderFallback) {
      this.#scheduleDisplayCoordsRetry(retryCount);
      return;
    }
    clearTimeout(this.displayCoordsRetryTimeout);
    this.displayCoordsRetryTimeout = null;
    if (!displayCoordsContainer) {
      displayCoordsContainer = document.createElement('div');
      displayCoordsContainer.id = 'bm-display-coords-container';
      displayCoordsContainer.style = 'width: 100%; margin: 4px 0 2px; padding: 0 12px; box-sizing: border-box; line-height: 1.15; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; text-align: left;';
      coordRow.insertAdjacentElement('beforebegin', displayCoordsContainer);
    } else if (displayCoordsContainer.nextElementSibling !== coordRow) {
      coordRow.insertAdjacentElement('beforebegin', displayCoordsContainer);
    }

    displayCoordsContainer.textContent = '';

    const displayCoords1 = document.createElement('span');
    displayCoords1.id = 'bm-display-coords1';
    displayCoords1.style = 'display: block; max-width: 100%; white-space: nowrap;';
    displayCoords1.className = 'bm-display-coords-clickable text-base-content/70 text-xs';
    displayCoords1.textContent = text1Display;
    displayCoords1.dataset.text = text1;

    const displayCoords2 = document.createElement('span');
    displayCoords2.id = 'bm-display-coords2';
    displayCoords2.style = 'display: block; max-width: 100%; white-space: nowrap;';
    displayCoords2.className = 'bm-display-coords-clickable text-base-content/70 text-xs';
    displayCoords2.textContent = text2Display;
    displayCoords2.dataset.text = text2;

    displayCoordsContainer.append(displayCoords1, displayCoords2);
    attachCopyHandler(displayCoords1);
    attachCopyHandler(displayCoords2);

    this.updatePixelInfoAllianceBackground();
    this.#maybeTriggerEasterEgg();
    this.updateAddLineTemplateButton();
    this.updateAddCircleTemplateButton();
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
    const allianceButton = Array.from(infoRoot.querySelectorAll('button'))
      .find(button => {
        if (!button.classList.contains('btn')) return false;
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
      allianceButton.classList.add('bm-ruspixel-flag-text');
    }
  }

  #maybeTriggerEasterEgg() {
    const closeButton = this.getCloseButton();
    if (!closeButton) return;
    const infoRoot = this.getPixelInfoRoot(closeButton);
    if (!infoRoot) return;
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
    };
    const clearWave = () => {
      Array.from(infoRoot.querySelectorAll('[data-bm-easter-egg-wave-original]')).forEach(target => {
        const originalText = target.getAttribute('data-bm-easter-egg-wave-original');
        if (originalText !== null) {
          target.textContent = originalText;
        }
        target.removeAttribute('data-bm-easter-egg-wave-original');
        const animations = target.__bmEasterEggWaveAnimations;
        if (Array.isArray(animations)) {
          animations.forEach(animation => {
            try {
              animation.cancel();
            } catch {}
          });
        }
        target.__bmEasterEggWaveAnimations = null;
      });
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
        const originalText = target.textContent || '';
        if (!/\S/.test(originalText)) return;
        target.setAttribute('data-bm-easter-egg-wave-original', originalText);
        target.textContent = '';
        const animations = [];
        Array.from(originalText).forEach(character => {
          const waveChar = document.createElement('span');
          waveChar.textContent = character === ' ' ? '\u00A0' : character;
          waveChar.style.display = 'inline-block';
          waveChar.style.willChange = 'transform';
          target.appendChild(waveChar);
          if (typeof waveChar.animate === 'function') {
            const delay = waveIndex * EASTER_EGG_WAVE_STAGGER_MS;
            const animation = waveChar.animate(
              [
                { transform: 'translateY(0)' },
                { transform: 'translateY(-4px)' },
                { transform: 'translateY(0)' }
              ],
              {
                duration: EASTER_EGG_WAVE_STEP_DURATION_MS,
                easing: 'ease-in-out',
                iterations,
                delay
              }
            );
            animations.push(animation);
            if (delay > maxDelay) {
              maxDelay = delay;
            }
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
          [
            { transform: 'scale(1)', textShadow: 'none' },
            {
              transform: 'scale(1.12)',
              textShadow: '0 0 14px rgba(255, 235, 180, 0.9), 0 0 24px rgba(255, 180, 120, 0.6)'
            },
            { transform: 'scale(1)', textShadow: 'none' }
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
    const elements = Array.from(infoRoot.querySelectorAll('*'));
    const targetUserIDs = new Set([EASTER_EGG_USER_ID]);
    const extractTargetUserID = (text) => {
      const match = String(text || '').match(/#\s*(\d{4,})\b/);
      if (!match) return null;
      const userID = Number(match[1]);
      return targetUserIDs.has(userID) ? userID : null;
    };
    const exactIdTexts = new Set(Array.from(targetUserIDs, userID => `#${userID}`));
    const targetElement =
      elements.find(element => exactIdTexts.has((element.textContent || '').trim())) ||
      elements.find(element => !element.children.length && extractTargetUserID(element.textContent || '') !== null) ||
      elements.find(element => extractTargetUserID(element.textContent || '') !== null) ||
      null;
    if (!targetElement) return;
    const matchedUserID = extractTargetUserID(targetElement.textContent || '');
    if (matchedUserID === null) return;
    const idPattern = new RegExp(`#\\s*${matchedUserID}\\b`);
    const animTarget =
      targetElement.closest('.inline-flex.items-baseline') ||
      targetElement.closest('.flex.gap-1\\.5') ||
      targetElement.closest('.m-1.flex.w-full.items-start.gap-2') ||
      targetElement.closest('.flex.items-center.gap-2') ||
      targetElement.closest('.flex.h-10.items-center.justify-between')?.querySelector('.flex.items-center.gap-2') ||
      targetElement;
    this.easterEggCloseButton = closeButton;
    this.easterEggCloseHandler = () => {
      clearFlowTimeouts();
      clearWave();
      clearCloseHandler();
    };
    closeButton.addEventListener('click', this.easterEggCloseHandler, { once: true });
    runPulse(animTarget);
    const runOneWaveWithPause = (waveTargets) => {
      const waveDuration = applyWave(waveTargets, { iterations: 1 });
      this.easterEggWaveLoopStartTimeout = setTimeout(() => {
        runOneWaveWithPause(waveTargets);
      }, waveDuration + EASTER_EGG_WAVE_PAUSE_BEFORE_LOOP_MS);
    };
    this.easterEggWaveStartTimeout = setTimeout(() => {
      const waveTargets = getWaveTargets(targetElement, idPattern);
      if (!waveTargets.length) return;
      runOneWaveWithPause(waveTargets);
    }, 1450 + EASTER_EGG_WAVE_FIRST_DELAY_MS);
  }

  /** Update the texts and related functions shown on the pixel info overlay
   * 
   * @since 0.86.13
  */
  updateAddLineTemplateButton() {
    // Find the button container for the "Add Line Template" button
    if (this.templateManager.isLineTemplateButtonShown()) {
      let btnLineTemplate = document.getElementById('bm-create-line-template');
      const that = this;
      if (!btnLineTemplate) {
        const buttonContainer = this.getPaintButtonContainer();
        if (!buttonContainer) return;
        btnLineTemplate = document.createElement('span');
        btnLineTemplate.id = 'bm-create-line-template';
        btnLineTemplate.textContent = "+ Line";
        btnLineTemplate.className = buttonContainer.querySelector("button").className; // Copy from an existing button
        btnLineTemplate.classList.add("btn-soft"); // not the primary button
        buttonContainer.appendChild(btnLineTemplate);
        btnLineTemplate.addEventListener('click', function () {
          if (!areOverlayCoordsFilledAndValid()) {
            alert(`Some coordinates textboxes are empty or invalid!`);
            return;
          };
          if (that.coordsTilePixel.length !== 4) {
            alert(`Coordinates are malformed! Did you try clicking on the canvas first?`);
            return;
          };
          const overlayCoords = getOverlayCoords();
          const coordsTile = [ that.coordsTilePixel[0], that.coordsTilePixel[1] ];
          const coordsPixel = [ that.coordsTilePixel[2], that.coordsTilePixel[3] ];
          const [[left, top], [width, height]] = calculateTopLeftAndSize(
            [coordsTile, coordsPixel],
            overlayCoords
          );
          const defaultDrawMult = that.templateManager.drawMult;
          if (!testCanvasSize(width * defaultDrawMult, height * defaultDrawMult)) {
            alert(`The line is too large for the browser to handle.`);
            return;
          }
          const x0 = (coordsTile[0] % 2048) * 1000 + (coordsPixel[0] % 1000);
          const y0 = (coordsTile[1] % 2048) * 1000 + (coordsPixel[1] % 1000);
          const isTopLeft = ((x0 == left) ^ (y0 == top)) == 0;
          const currentColor = getCurrentColor();
          const currentColorInfo = colorpalette[currentColor];
          const {
            imageData, offsetX, offsetY
          } = isTopLeft ? lineBitmap(
            [left, top], [left + width - 1, top + height - 1], currentColorInfo.rgb
          ) : lineBitmap(
            [left, top + height - 1], [left + width - 1, top], currentColorInfo.rgb
          );
          const tx1 = Math.floor(left / 1000);
          const ty1 = Math.floor(top / 1000);
          const px1 = left % 1000;
          const py1 = top % 1000;
          that.templateManager.createTemplate(
            imageData,
            `${currentColorInfo?.name ?? 'Unknown Color'} Line`,
            [tx1, ty1, px1, py1],
            "lt",
          )
        });
      }
    }
  }

  /** Update the texts and related functions shown on the pixel info overlay
   * 
   * @since 0.86.16
  */
  updateAddCircleTemplateButton() {
    // Find the button container for the "Add Line Template" button
    if (this.templateManager.isLineTemplateButtonShown()) {
      let btnCircleTemplate = document.getElementById('bm-create-circle-template');
      const that = this;
      if (!btnCircleTemplate) {
        const buttonContainer = this.getPaintButtonContainer();
        if (!buttonContainer) return;
        btnCircleTemplate = document.createElement('span');
        btnCircleTemplate.id = 'bm-create-circle-template';
        btnCircleTemplate.textContent = "+ Circle";
        btnCircleTemplate.className = buttonContainer.querySelector("button").className; // Copy from an existing button
        btnCircleTemplate.classList.add("btn-soft"); // not the primary button
        buttonContainer.appendChild(btnCircleTemplate);
        btnCircleTemplate.addEventListener('click', function () {
          if (!areOverlayCoordsFilledAndValid()) {
            alert(`Some coordinates textboxes are empty or invalid!`);
            return;
          };
          if (that.coordsTilePixel.length !== 4) {
            alert(`Coordinates are malformed! Did you try clicking on the canvas first?`);
            return;
          };
          const overlayCoords = getOverlayCoords();
          const coordsTile = [ that.coordsTilePixel[0], that.coordsTilePixel[1] ];
          const coordsPixel = [ that.coordsTilePixel[2], that.coordsTilePixel[3] ];
          const [[left, top], [width, height]] = calculateTopLeftAndSize(
            [coordsTile, coordsPixel],
            overlayCoords
          );
          const {d, y} = midPointDistance([0, 0], [width - 1,  height - 1]);
          const diameter = y * 2 + 1;
          const defaultDrawMult = that.templateManager.drawMult;
          if (!testCanvasSize(diameter * defaultDrawMult, diameter * defaultDrawMult)) {
            alert(`The line is too large for the browser to handle.`);
            return;
          }
          const x0 = (overlayCoords[0][0] % 2048) * 1000 + (overlayCoords[1][0] % 1000);
          const y0 = (overlayCoords[0][1] % 2048) * 1000 + (overlayCoords[1][1] % 1000);
          const x1 = (coordsTile[0] % 2048) * 1000 + (coordsPixel[0] % 1000);
          const y1 = (coordsTile[1] % 2048) * 1000 + (coordsPixel[1] % 1000);
          const currentColor = getCurrentColor();
          const currentColorInfo = colorpalette[currentColor];
          const {
            imageData, offsetX, offsetY
          } = circleBitmap(
            [x0, y0], [x1, y1], currentColorInfo.rgb
          );

          const tx1 = Math.floor(offsetX / 1000);
          const ty1 = Math.floor(offsetY / 1000);
          const px1 = offsetX % 1000;
          const py1 = offsetY % 1000;
          that.templateManager.createTemplate(
            imageData,
            `${currentColorInfo?.name ?? 'Unknown Color'} Circle`,
            [tx1, ty1, px1, py1],
            "lt",
          )
        });
      }
    }
  }

  #normalizeArchiveTemplateBaseUrl(rawUrl = ARCHIVE_TEMPLATE_BASE_URL) {
    const fallback = String(ARCHIVE_TEMPLATE_BASE_URL || '').trim();
    const value = String(rawUrl ?? '').trim();
    return (value || fallback).replace(/\/+$/, '');
  }

  async #fetchArchiveTemplateVersions(rawBaseUrl = ARCHIVE_TEMPLATE_BASE_URL, force = false) {
    const baseUrl = this.#normalizeArchiveTemplateBaseUrl(rawBaseUrl);
    if (!force && this.templateArchiveVersionCache.has(baseUrl)) {
      return this.templateArchiveVersionCache.get(baseUrl);
    }
    if (typeof GM_xmlhttpRequest !== 'function') {
      throw new Error('GM_xmlhttpRequest is unavailable.');
    }
    const html = await new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${baseUrl}/`,
        responseType: 'text',
        onload: (response) => {
          const status = Number(response?.status);
          if (status < 200 || status >= 300) {
            reject(new Error(`Archive index request failed (${status}).`));
            return;
          }
          resolve(String(response?.responseText || response?.response || ''));
        },
        onerror: (error) => reject(new Error(`Archive index request failed: ${error?.message || error}`))
      });
    });
    const listMatch = html.match(/const\s+WPLACE_VERSIONS\s*=\s*\[([\s\S]*?)\];/);
    if (!listMatch) {
      throw new Error('Archive version list was not found.');
    }
    const versionEntries = [];
    const entryRegex = /\{[^{}]*version:\s*['"]([^'"]+)['"][^{}]*date:\s*['"]([^'"]*)['"][^{}]*\}/g;
    let match;
    while ((match = entryRegex.exec(listMatch[1])) !== null) {
      versionEntries.push({
        version: String(match[1] || '').trim(),
        date: String(match[2] || '').trim()
      });
    }
    if (!versionEntries.length) {
      throw new Error('Archive version list is empty.');
    }
    this.templateArchiveVersionCache.set(baseUrl, versionEntries);
    return versionEntries;
  }

  #populateArchiveVersionSelect(selectElement, versions, preferredVersion = '') {
    if (!selectElement) return;
    selectElement.textContent = '';
    versions.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.version;
      option.textContent = `${entry.date || entry.version} (${entry.version})`;
      option.dataset.date = entry.date || '';
      selectElement.appendChild(option);
    });
    const desiredVersion = String(preferredVersion || this.templateArchiveVersionValue || '').trim();
    let selectedVersion = desiredVersion;
    if (!selectedVersion || !versions.some((entry) => entry.version === selectedVersion)) {
      selectedVersion = versions[versions.length - 1]?.version || versions[0]?.version || '';
    }
    selectElement.value = selectedVersion;
    this.templateArchiveVersionValue = selectedVersion;
  }

  /** Update the download button in share dialog
   * 
   * @since 0.85.28
  */
  updateDownloadButton() {
    if (this.coordsTilePixel.length !== 4) return;
    const coordsTile = [ this.coordsTilePixel[0], this.coordsTilePixel[1] ];
    const coordsPixel = [ this.coordsTilePixel[2], this.coordsTilePixel[3] ];
    const models = document.querySelectorAll('dialog.modal > div');
    const archiveBaseUrl = this.#normalizeArchiveTemplateBaseUrl(ARCHIVE_TEMPLATE_BASE_URL);
    for (const element of models) {
      if (element.querySelector('input[readonly]') === null) continue;
      let downloadBtn = document.querySelector('#bm-download-coords');
      let createTemplateBtn = document.querySelector('#bm-create-template-from-download');
      let downloadBtnDim = document.querySelector('#bm-download-coords-dim');
      let progress = document.querySelector('#bm-download-progress');
      let progressText = document.querySelector('#bm-download-progress-text');
      let sourceSelect = document.querySelector('#bm-download-source');
      let archiveControls = document.querySelector('#bm-download-archive-controls');
      let archiveVersionSelect = document.querySelector('#bm-download-archive-version');
      let archiveRefreshBtn = document.querySelector('#bm-download-archive-refresh');
      let archiveStatus = document.querySelector('#bm-download-archive-status');
      if (!downloadBtn) {
        const container = document.createElement('div');
        element.appendChild(container);

        const h3 = document.createElement('h3');
        h3.innerText = 'Download as Template';
        h3.className = "mb-1 mt-5 flex items-center gap-1 text-xl font-semibold";
        container.appendChild(h3);

        const instruction = document.createElement('div');
        instruction.className = `bg-base-200 border-base-content/10 rounded-xl border-2 p-3`;
        instruction.style.fontSize = "small";
        instruction.innerText = [
          'Instruction to mark the rectangular range for downloading:',
          '1. Pick the first reference point (e.g. the Top Left Corner) and use the "Pin" icon to record the coordinates.',
          '2. Pick the second reference point, i.e. the opposite corner (e.g. the Bottom Right Corner), and click the "Share" button.'
        ].join("\n");
        container.appendChild(instruction);

        const sourceRow = document.createElement('div');
        sourceRow.style.display = 'flex';
        sourceRow.style.gap = '8px';
        sourceRow.style.alignItems = 'center';
        sourceRow.style.marginTop = '8px';
        const sourceLabel = document.createElement('label');
        sourceLabel.textContent = 'Source:';
        sourceLabel.htmlFor = 'bm-download-source';
        sourceLabel.style.fontSize = 'small';
        sourceSelect = document.createElement('select');
        sourceSelect.id = 'bm-download-source';
        sourceSelect.className = 'select select-sm';
        sourceSelect.style.minWidth = '14ch';
        [
          [TEMPLATE_DOWNLOAD_SOURCE_LIVE, 'Live'],
          [TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE, 'Archive Time']
        ].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          sourceSelect.appendChild(option);
        });
        const sourceDefault = this.templateDownloadSource === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
          ? TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
          : TEMPLATE_DOWNLOAD_SOURCE_LIVE;
        sourceSelect.value = sourceDefault;
        sourceRow.appendChild(sourceLabel);
        sourceRow.appendChild(sourceSelect);
        container.appendChild(sourceRow);

        archiveControls = document.createElement('div');
        archiveControls.id = 'bm-download-archive-controls';
        archiveControls.style.display = 'none';
        archiveControls.style.marginTop = '6px';
        archiveControls.style.fontSize = 'small';
        const archiveVersionRow = document.createElement('div');
        archiveVersionRow.style.display = 'flex';
        archiveVersionRow.style.alignItems = 'center';
        archiveVersionRow.style.gap = '6px';
        const archiveVersionLabel = document.createElement('label');
        archiveVersionLabel.htmlFor = 'bm-download-archive-version';
        archiveVersionLabel.textContent = 'Version:';
        archiveVersionSelect = document.createElement('select');
        archiveVersionSelect.id = 'bm-download-archive-version';
        archiveVersionSelect.className = 'select select-sm';
        archiveVersionSelect.style.flex = '1';
        const archiveDefaultOption = document.createElement('option');
        archiveDefaultOption.value = '';
        archiveDefaultOption.textContent = 'Loading...';
        archiveVersionSelect.appendChild(archiveDefaultOption);
        archiveRefreshBtn = document.createElement('button');
        archiveRefreshBtn.id = 'bm-download-archive-refresh';
        archiveRefreshBtn.type = 'button';
        archiveRefreshBtn.className = 'btn btn-sm btn-soft';
        archiveRefreshBtn.textContent = 'Refresh';
        archiveVersionRow.appendChild(archiveVersionLabel);
        archiveVersionRow.appendChild(archiveVersionSelect);
        archiveVersionRow.appendChild(archiveRefreshBtn);
        archiveControls.appendChild(archiveVersionRow);
        archiveStatus = document.createElement('span');
        archiveStatus.id = 'bm-download-archive-status';
        archiveStatus.style.display = 'inline-block';
        archiveStatus.style.marginTop = '4px';
        archiveStatus.textContent = `Provider: ${archiveBaseUrl}`;
        archiveControls.appendChild(archiveStatus);
        container.appendChild(archiveControls);

        downloadBtnDim = document.createElement('span');
        downloadBtnDim.id = 'bm-download-coords-dim';
        downloadBtnDim.style.fontSize = "small";
        container.appendChild(downloadBtnDim);

        container.appendChild(document.createElement('br'));

        const btnContainer = document.createElement('div');
        btnContainer.className = "mt-3 flex items-end justify-end gap-2";

        progress = document.createElement('progress');
        progress.id = 'bm-download-progress';
        progress.max = '100';
        progress.value = '0';
        progress.hidden = true;
        btnContainer.appendChild(progress);

        progressText = document.createElement('span');
        progressText.id = 'bm-download-progress-text';
        progressText.hidden = true;
        progressText.textContent = '0 / 0';
        btnContainer.appendChild(progressText);

        createTemplateBtn = document.createElement('button');
        createTemplateBtn.id = 'bm-create-template-from-download';
        createTemplateBtn.className = 'btn btn-soft';
        createTemplateBtn.appendChild(document.createTextNode('Create Template'));
        btnContainer.appendChild(createTemplateBtn);

        downloadBtn = document.createElement('button');
        downloadBtn.id = 'bm-download-coords';
        downloadBtn.className = 'btn btn-primary';

        const svg = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('viewBox', '0 -960 960 960');
        svg.setAttribute('fill', 'currentColor');
        svg.setAttribute('class', 'size-5');
        const path = document.createElementNS("http://www.w3.org/2000/svg", 'path');
        path.setAttribute('d', "M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z");
        svg.appendChild(path);
        downloadBtn.appendChild(svg);
        downloadBtn.appendChild(document.createTextNode(' Download'));
        btnContainer.appendChild(downloadBtn);
        container.appendChild(btnContainer);

        const that = this;
        let archiveListLoading = false;
        const setBusyState = (busy) => {
          downloadBtn.disabled = busy;
          createTemplateBtn.disabled = busy;
          sourceSelect.disabled = busy;
          archiveVersionSelect.disabled = busy || archiveListLoading;
          archiveRefreshBtn.disabled = busy || archiveListLoading;
        };
        const loadArchiveVersions = async (force = false) => {
          archiveListLoading = true;
          archiveVersionSelect.disabled = true;
          archiveRefreshBtn.disabled = true;
          archiveStatus.textContent = 'Loading archive versions...';
          const preferred = archiveVersionSelect.value || that.templateArchiveVersionValue;
          try {
            const versions = await that.#fetchArchiveTemplateVersions(archiveBaseUrl, force);
            that.#populateArchiveVersionSelect(archiveVersionSelect, versions, preferred);
            archiveStatus.textContent = `Loaded ${versions.length} versions from ${archiveBaseUrl}`;
          } catch (error) {
            consoleError('Failed loading archive versions', error);
            archiveVersionSelect.textContent = '';
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Failed to load versions';
            archiveVersionSelect.appendChild(option);
            archiveStatus.textContent = 'Could not load archive versions. Click refresh to retry.';
          } finally {
            archiveListLoading = false;
            archiveVersionSelect.disabled = false;
            archiveRefreshBtn.disabled = false;
            that.updateDownloadButton();
          }
        };
        const getSelectedSource = () =>
          sourceSelect.value === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
            ? TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
            : TEMPLATE_DOWNLOAD_SOURCE_LIVE;
        const buildSnapshot = async () => {
          const selectedSource = getSelectedSource();
          const selectedArchiveOption = archiveVersionSelect.selectedOptions?.[0] || null;
          const archiveVersion = selectedArchiveOption?.value || '';
          const archiveDate = selectedArchiveOption?.dataset?.date || '';
          if (selectedSource === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE && !archiveVersion) {
            throw new Error('Select an archive version first.');
          }
          if (!areOverlayCoordsFilledAndValid()) {
            throw new Error('Some coordinates textboxes are empty or invalid.');
          }
          const currentCoordsTile = [ that.coordsTilePixel[0], that.coordsTilePixel[1] ];
          const currentCoordsPixel = [ that.coordsTilePixel[2], that.coordsTilePixel[3] ];
          const overlayCoords = getOverlayCoords();
          const [[left, top], [width, height]] = calculateTopLeftAndSize(
            [currentCoordsTile, currentCoordsPixel],
            overlayCoords
          );
          const tx1 = Math.floor(left / 1000);
          const ty1 = Math.floor(top / 1000);
          const px1 = left % 1000;
          const py1 = top % 1000;
          const tx2 = Math.floor((left + width - 1) / 1000);
          const ty2 = Math.floor((top + height - 1) / 1000);
          const tw = tx2 - tx1 + 1;
          const th = ty2 - ty1 + 1;
          const centerCoords = selectedSource === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
            ? buildArchiveCenterCoords(left, top, width, height)
            : null;
          progress.max = tw * th;
          progress.value = 0;
          progress.hidden = false;
          progressText.textContent = `0 / ${progress.max}`;
          progressText.hidden = false;
          let resultCanvas = new OffscreenCanvas(width, height);
          try {
            const context = resultCanvas.getContext('2d');
            if (!context) {
              throw new Error('Failed to initialize export canvas context.');
            }
            context.clearRect(0, 0, width, height);
            for (let ty = ty1; ty <= ty2; ty++) {
              for (let tx = tx1; tx <= tx2; tx++) {
                const image = await downloadTile(tx % 2048, ty, {
                  source: selectedSource,
                  archiveBaseUrl: archiveBaseUrl,
                  archiveVersion: archiveVersion
                });
                context.drawImage(
                  image,
                  tx * 1000 - left,
                  ty * 1000 - top
                );
                progress.value++;
                progressText.textContent = `${progress.value} / ${progress.max}`;
              }
            }
            const blob = await resultCanvas.convertToBlob({ type: "image/png" });
            let archiveRegionLabel = '';
            if (selectedSource === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE) {
              try {
                archiveRegionLabel = await fetchArchiveRegionLabel(centerCoords);
              } catch (error) {
                consoleError('Failed to resolve archive region label', error);
              }
            }
            return {
              blob,
              width,
              height,
              tx1,
              ty1,
              px1,
              py1,
              source: selectedSource,
              archiveVersion,
              archiveDate,
              archiveRegionLabel,
            };
          } finally {
            progress.hidden = true;
            progressText.hidden = true;
            cleanUpCanvas(resultCanvas);
            resultCanvas = null;
          }
        };
        const runWithBusyState = async (callback) => {
          setBusyState(true);
          try {
            await callback();
          } finally {
            setBusyState(false);
            that.updateDownloadButton();
          }
        };

        sourceSelect.addEventListener('change', () => {
          that.templateDownloadSource = getSelectedSource();
          if (that.templateDownloadSource === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE && !archiveVersionSelect.options.length) {
            void loadArchiveVersions(false);
          } else if (
            that.templateDownloadSource === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE &&
            archiveVersionSelect.options.length &&
            !archiveVersionSelect.value
          ) {
            void loadArchiveVersions(false);
          } else {
            that.updateDownloadButton();
          }
        });
        archiveVersionSelect.addEventListener('change', () => {
          that.templateArchiveVersionValue = archiveVersionSelect.value || '';
          that.updateDownloadButton();
        });
        archiveRefreshBtn.addEventListener('click', () => {
          void loadArchiveVersions(true);
        });
        downloadBtn.addEventListener('click', async () => {
          await runWithBusyState(async () => {
            try {
              const snapshot = await buildSnapshot();
              const sourceTag = snapshot.source === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
                ? `archive_${(snapshot.archiveVersion || 'unknown').replace(/[^a-z0-9._-]+/gi, '-')}`
                : 'live';
              const downloadName = `template_${sourceTag}_${snapshot.tx1}_${snapshot.ty1}_${snapshot.px1}_${snapshot.py1}_${new Date().toISOString()}.png`;
              const link = document.createElement('a');
              link.href = URL.createObjectURL(snapshot.blob, { type: 'image/png' });
              link.setAttribute('download', downloadName);
              link.click();
              URL.revokeObjectURL(link.href);
            } catch (error) {
              alert(`Download Failed!`);
              consoleError('Template download failed', error);
            }
          });
        });
        createTemplateBtn.addEventListener('click', async () => {
          await runWithBusyState(async () => {
            try {
              const snapshot = await buildSnapshot();
              const sourceLabel = snapshot.source === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
                ? (snapshot.archiveRegionLabel || buildArchiveRegionFallbackLabel(
                  buildArchiveCenterCoords(
                    snapshot.tx1 * TEMPLATE_TILE_SIZE + snapshot.px1,
                    snapshot.ty1 * TEMPLATE_TILE_SIZE + snapshot.py1,
                    snapshot.width,
                    snapshot.height
                  )
                ))
                : 'Live Snapshot';
              const fileName = `${sourceLabel.replace(/[^a-z0-9._-]+/gi, '_')}_${snapshot.tx1}_${snapshot.ty1}_${snapshot.px1}_${snapshot.py1}.png`;
              const file = new File([snapshot.blob], fileName, { type: 'image/png' });
              const createOptions = snapshot.source === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
                ? {
                  timeArchiveMeta: {
                    source: 'time-archive',
                    archiveBaseUrl,
                    archiveVersion: snapshot.archiveVersion,
                    archiveDate: snapshot.archiveDate,
                    regionName: sourceLabel,
                    width: snapshot.width,
                    height: snapshot.height,
                  }
                }
                : undefined;
              await that.templateManager.createTemplate(
                file,
                sourceLabel,
                [snapshot.tx1, snapshot.ty1, snapshot.px1, snapshot.py1],
                'lt',
                createOptions
              );
            } catch (error) {
              alert(`Template creation failed!`);
              consoleError('Template creation from snapshot failed', error);
            }
          });
        });
        if (sourceDefault === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE) {
          void loadArchiveVersions(false);
        }
      }

      const selectedSource = sourceSelect?.value === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
        ? TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE
        : TEMPLATE_DOWNLOAD_SOURCE_LIVE;
      this.templateDownloadSource = selectedSource;
      if (archiveControls) {
        archiveControls.style.display = selectedSource === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE ? '' : 'none';
      }

      const buttonLines = [];
      let canRun = true;
      if (areOverlayCoordsFilledAndValid()) {
        const overlayCoords = getOverlayCoords();
        const [[left, top], [width, height]] = calculateTopLeftAndSize(
          [coordsTile, coordsPixel],
          overlayCoords
        );
        const tx1 = Math.floor(left / 1000);
        const ty1 = Math.floor(top / 1000);
        const px1 = left % 1000;
        const py1 = top % 1000;
        const right = (left + width - 1) % (2048 * 1000);
        const bottom = top + height - 1;
        const tx2 = Math.floor(right / 1000);
        const ty2 = Math.floor(bottom / 1000);
        const px2 = right % 1000;
        const py2 = bottom % 1000;
        buttonLines.push(`Top Left: (Tl X: ${tx1}, Tl Y: ${ty1}, Px X: ${px1}, Px Y: ${py1})`);
        buttonLines.push(`Bottom Right: (Tl X: ${tx2}, Tl Y: ${ty2}, Px X: ${px2}, Px Y: ${py2})`);
        buttonLines.push(`Image Size: ${width}×${height}`);
        if (!testCanvasSize(width, height)) {
          canRun = false;
          buttonLines.push(`Too large for the browser to export.`);
        }
      } else {
        canRun = false;
        buttonLines.push(`Some coordinates textboxes are empty or invalid.`);
      }
      if (selectedSource === TEMPLATE_DOWNLOAD_SOURCE_ARCHIVE) {
        const selectedOption = archiveVersionSelect?.selectedOptions?.[0] || null;
        const archiveVersion = selectedOption?.value || '';
        const archiveDate = selectedOption?.dataset?.date || '';
        if (archiveVersion) {
          this.templateArchiveVersionValue = archiveVersion;
          buttonLines.push(`Archive Version: ${archiveDate || archiveVersion} (${archiveVersion})`);
        } else {
          canRun = false;
          buttonLines.push('Archive version not loaded yet. Click "Refresh".');
        }
      } else {
        buttonLines.push('Source: Live map');
      }

      if (downloadBtn) {
        downloadBtn.disabled = !canRun;
      }
      if (createTemplateBtn) {
        createTemplateBtn.disabled = !canRun;
      }
      if (downloadBtnDim) {
        downloadBtnDim.innerText = buttonLines.join('\n');
      }
    }
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

      console.log(`%cRus Marble%c: Recieved message about "%s"`, 'color: cornflowerblue;', '', endpointText);

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
          this.updateDownloadButton();
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
          
          const blobData = data['blobData'];
          const tileKey = tileCoordsTile[0].toString().padStart(4, '0') + ',' + tileCoordsTile[1].toString().padStart(4, '0');
          const lastModified = data["lastModified"];
          // We need the list of enabled colors to generate the unpainted list
          const fullKey = this.templateManager.getTileCacheKey(tileCoordsTile);
          const errorMap = +this.templateManager.isErrorMapShown();

          const fullKeyChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["fullKey"] !== fullKey;
          const lastModifiedChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["lastModified"] !== lastModified;
          const errorMapChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["errorMap"] !== errorMap;
          console.log(this.tileCache[tileKey]);
          console.log(fullKey, lastModified, errorMap);
          console.log(fullKeyChanged, lastModifiedChanged, errorMapChanged);
          if (!fullKeyChanged && !lastModifiedChanged && !errorMapChanged) {
            console.log(`Unchanged tile: "${tileKey}"`);
          } else {
            const involvedTemplates = this.templateManager.getInvolvedTemplates(tileCoordsTile);
            if ( involvedTemplates.length > 0 && (
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

        case 'claimed': // Claimed # in event
          this.eventClaimed = dataJSON['claimed']??[];
          this.templateManager.requestEventRebuild();
          break;

        case 'locations':
          // Event item locations (e.g. https://backend.wplace.live/event/christmas/locations)
          // This endpoint still works without the claimed key if not logged in
          // The endpoint also seems to be called after claiming
          this.eventClaimed = dataJSON.filter(entry => (
            entry?.['claimed'] ?? false
          )).map((entry, index) => (entry.id ?? index));
          this.eventData = dataJSON;
          this.eventDataURL = data['endpoint'];
          this.templateManager.requestEventRebuild();
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

