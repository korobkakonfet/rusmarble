/** @file The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */
import "./polyfill.js";
import Overlay from './Overlay.js';
// import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { buildUserSettingsSection } from './userSettings.js';
import { createTemplateSync, normalizeRemoteOrder } from './templateSync.js';
import { consoleLog, consoleWarn, selectAllCoordinateInputs, rgbToMeta, getOverlayCoords, sortByOptions, getCurrentColor } from './utils.js';
import { getCenterGeoCoords, getPixelPerWplacePixel, forceRefreshTiles, removeLayer, themeList, setTheme, isMapTilerLoaded, teleportToTileCoords, teleportToGeoCoords, coordsTileCoordsToGeoCoords, coordsGeoCoordsToTileCoords, doAfterMapFound, panMap, setZoom, getCurrentTileSize} from './utilsMaptiler.js';
// import { getCenterGeoCoords, addTemplate } from './utilsMaptiler.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs
const CSS_BM_File = typeof __CSS_BM_FILE__ !== 'undefined' && __CSS_BM_FILE__
  ? __CSS_BM_FILE__
  : "http://localhost:8000/dist/RusMarble.user.css";
const TEMPLATE_SYNC_BASE_URL = typeof __TEMPLATE_SYNC_BASE_URL__ !== 'undefined' && __TEMPLATE_SYNC_BASE_URL__
  ? __TEMPLATE_SYNC_BASE_URL__
  : "http://localhost:8003";
const CHAT_WS_URL = typeof __CHAT_WS_URL__ !== 'undefined' && __CHAT_WS_URL__
  ? __CHAT_WS_URL__
  : `${TEMPLATE_SYNC_BASE_URL.replace(/^http(s?):\/\//, (_, secure) => (secure ? 'wss://' : 'ws://'))}/ws/chat`;
const TEMPLATE_UPDATE_POLL_MS = 5000;
const REMOTE_FLAGS_REFRESH_MS = 60000;
const NOTIFICATION_POLL_MS = 3000;
const NOTIFICATION_ROTATE_MS = 10000;
const CHAT_MAX_USER_LEN = 12;
const CHAT_MAX_TEXT_LEN = 100;
let chatSocket = null;
let chatInitialized = false;
const layoutThemeOptions = {
  "classic": "Classic",
  "white": "White",
  "pink": "Pink",
  "blue": "Blue",
  "black": "Black",
  "mint": "Mint",
  "imperial": "Russian Imperial",
  "tricolor": "Russian Tricolor"
};
const templateDisplayOptions = {
  "cross": "Cross",
  "fill": "Fill",
  "cross-z-9": "Cross (Z, 9x9)",
  "cross-z-11": "Cross (Z, 11x11)",
  "dot": "Dot (Original)"
};

const normalizeLayoutTheme = (value) => {
  const key = String(value ?? '').toLowerCase();
  return layoutThemeOptions[key] ? key : 'classic';
};

const normalizeTemplateDisplay = (value) => {
  const key = String(value ?? '').toLowerCase();
  return templateDisplayOptions[key] ? key : 'cross';
};

const normalizeFlag = (value) => value === true || value === 'true' || value === 1 || value === '1';
const isWplaceDarkTheme = () => {
  const theme = String(document.documentElement?.dataset?.theme ?? '').toLowerCase();
  return theme === 'dark' || theme === 'halloween';
};
const applyWplaceThemeState = () => {
  const mode = isWplaceDarkTheme() ? 'dark' : 'light';
  const overlay = document.getElementById('bm-overlay');
  if (overlay) {
    overlay.dataset.wplaceTheme = mode;
  }
  const notificationContainer = document.getElementById('bm-notification-container');
  if (notificationContainer) {
    notificationContainer.dataset.wplaceTheme = mode;
  }
};
const observeWplaceTheme = () => {
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'data-theme')) {
      applyWplaceThemeState();
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  applyWplaceThemeState();
};

const waitForBody = () => {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  });
};

const applyLayoutTheme = (value) => {
  const overlay = document.getElementById('bm-overlay');
  if (!overlay) return;
  overlay.dataset.layoutTheme = normalizeLayoutTheme(value);
  applyWplaceThemeState();
  const notificationContainer = document.getElementById('bm-notification-container');
  if (notificationContainer) {
    notificationContainer.dataset.layoutTheme = normalizeLayoutTheme(value);
  }
};

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
    const script = document.createElement('script');
    script.setAttribute('bm-name', name); // Passes in the name value
    script.setAttribute('bm-cStyle', consoleStyle); // Passes in the console style value
    script.textContent = `(${callback})();`;
    // script.textContent = `setTimeout(${callback}, 1000);`; // For debugging the case when there is delay when starting the script
    document.documentElement?.appendChild(script);
    script.remove();
}

function gmRequest(url, responseType = "json") {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url,
      responseType,
      onload: (response) => resolve(response),
      onerror: (err) => reject(err)
    });
  });
}

let notificationPollId = null;
let notificationRotateId = null;
let notificationQueue = [];
let notificationCurrent = null;
const NOTIFICATION_SHOWN_STORAGE_KEY = 'bmNotificationShownIds';
const NOTIFICATION_SHOWN_MAX = 500;
const notificationShownIds = new Set();
let notificationShownList = [];
let notificationShownInitPromise = null;
let overlayBuildInFlight = false;

function loadNotificationShownIds() {
  if (notificationShownInitPromise) return notificationShownInitPromise;
  notificationShownInitPromise = GM.getValue(NOTIFICATION_SHOWN_STORAGE_KEY, '[]')
    .then((raw) => {
      let list = [];
      try {
        list = Array.isArray(raw) ? raw : JSON.parse(raw ?? '[]');
      } catch (_) {
        list = [];
      }
      if (!Array.isArray(list)) return;
      notificationShownList = list
        .map((id) => normalizeNotificationId(id))
        .filter((id) => id);
      notificationShownList.forEach((id) => notificationShownIds.add(id));
    })
    .catch(() => {});
  return notificationShownInitPromise;
}

function persistNotificationShownIds() {
  if (notificationShownList.length > NOTIFICATION_SHOWN_MAX) {
    notificationShownList = notificationShownList.slice(-NOTIFICATION_SHOWN_MAX);
  }
  try {
    GM.setValue(NOTIFICATION_SHOWN_STORAGE_KEY, JSON.stringify(notificationShownList));
  } catch (_) {}
}

function normalizeNotificationId(id) {
  return id === undefined || id === null ? null : String(id);
}

function trackNotificationShown(id) {
  const normalized = normalizeNotificationId(id);
  if (!normalized) return;
  if (notificationShownIds.has(normalized)) return;
  notificationShownIds.add(normalized);
  notificationShownList.push(normalized);
  persistNotificationShownIds();
}

function appendLinkedText(target, rawText, options = {}) {
  const { enableTeleport = false, shortenWplace = true } = options;
  const text = String(rawText ?? '');
  target.textContent = '';
  const urlRegex = /https?:\/\/[^\s)]+/g;
  let lastIndex = 0;
  let hasMatch = false;
  for (const match of text.matchAll(urlRegex)) {
    hasMatch = true;
    const matchText = match[0];
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      target.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
    }
    const link = document.createElement('a');
    let linkLabel = matchText;
    let parsedCoords = null;
    try {
      const parsed = new URL(matchText);
      if (shortenWplace && parsed.hostname.endsWith('wplace.live')) {
        const lat = Number(parsed.searchParams.get('lat'));
        const lng = Number(parsed.searchParams.get('lng'));
        const zoom = Number(parsed.searchParams.get('zoom'));
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          parsedCoords = {
            lat,
            lng,
            zoom: Number.isFinite(zoom) ? zoom : null
          };
          const shortLat = lat.toFixed(3);
          const shortLng = lng.toFixed(3);
          linkLabel = `wplace@${shortLat},${shortLng}`;
        }
      }
    } catch (_) {}
    link.href = matchText;
    link.textContent = linkLabel;
    link.title = matchText;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (enableTeleport && parsedCoords) {
      link.dataset.lat = String(parsedCoords.lat);
      link.dataset.lng = String(parsedCoords.lng);
      if (Number.isFinite(parsedCoords.zoom)) {
        link.dataset.zoom = String(parsedCoords.zoom);
      }
      link.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
          return;
        }
        event.preventDefault();
        const lat = Number(link.dataset.lat);
        const lng = Number(link.dataset.lng);
        const zoom = Number(link.dataset.zoom);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        doAfterMapFound(async () => {
          await teleportToGeoCoords(lat, lng);
          if (Number.isFinite(zoom)) {
            setZoom(zoom);
          }
        });
      });
    }
    target.appendChild(link);
    lastIndex = matchIndex + matchText.length;
  }
  if (!hasMatch) {
    target.textContent = text;
    return;
  }
  if (lastIndex < text.length) {
    target.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function ensureNotificationContainer() {
  let container = document.getElementById('bm-notification-container');
  if (container) return container;
  container = document.createElement('div');
  container.id = 'bm-notification-container';
  container.style.display = 'none';
  container.dataset.layoutTheme = normalizeLayoutTheme(templateManager?.getLayoutTheme?.());
  const card = document.createElement('div');
  card.id = 'bm-notification';
  const close = document.createElement('button');
  close.id = 'bm-notification-close';
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Dismiss notification';
  close.addEventListener('click', () => {
    notificationCurrent = null;
    if (notificationQueue.length) {
      showNextNotification();
    } else {
      hideNotification();
      stopNotificationRotation();
    }
  });
  const text = document.createElement('span');
  text.id = 'bm-notification-text';
  const meta = document.createElement('span');
  meta.id = 'bm-notification-meta';
  card.appendChild(close);
  card.appendChild(text);
  card.appendChild(meta);
  container.appendChild(card);
  document.body?.appendChild(container);
  return container;
}

function renderNotification(notification) {
  const container = ensureNotificationContainer();
  const textEl = container.querySelector('#bm-notification-text');
  const metaEl = container.querySelector('#bm-notification-meta');
  if (!textEl || !metaEl) return;
  appendLinkedText(textEl, notification?.text ?? '', { enableTeleport: true, shortenWplace: true });
  const createdBy = notification?.created_by ? String(notification.created_by) : '';
  const createdAtRaw = notification?.created_at ? String(notification.created_at) : '';
  let createdAt = '';
  if (createdAtRaw) {
    const parsed = new Date(createdAtRaw);
    if (!Number.isNaN(parsed.getTime())) {
      createdAt = parsed.toLocaleString();
    }
  }
  const metaParts = [];
  if (createdBy) metaParts.push(`by ${createdBy}`);
  if (createdAt) metaParts.push(createdAt);
  if (metaParts.length > 0) {
    metaEl.textContent = metaParts.join(' • ');
    metaEl.style.display = 'block';
  } else {
    metaEl.textContent = '';
    metaEl.style.display = 'none';
  }
  container.style.display = 'flex';
}

function hideNotification() {
  const container = document.getElementById('bm-notification-container');
  if (container) {
    container.style.display = 'none';
  }
}

function showNextNotification() {
  if (!notificationQueue.length) {
    notificationCurrent = null;
    hideNotification();
    stopNotificationRotation();
    return;
  }
  const current = notificationQueue.shift();
  notificationCurrent = current;
  trackNotificationShown(current?.id);
  renderNotification(current);
}

function startNotificationRotation() {
  if (notificationRotateId) return;
  notificationRotateId = setInterval(showNextNotification, NOTIFICATION_ROTATE_MS);
  showNextNotification();
}

function stopNotificationRotation() {
  if (notificationRotateId) {
    clearInterval(notificationRotateId);
    notificationRotateId = null;
  }
}

async function fetchNotifications() {
  try {
    const response = await gmRequest(`${TEMPLATE_SYNC_BASE_URL}/notifications`, "json");
    const data = response.response ?? JSON.parse(response.responseText || "{}");
    const list = Array.isArray(data?.notifications) ? data.notifications : [];
    const cleaned = list.filter(item => item && item.text && item.id !== undefined && item.id !== null);
    const queuedIds = new Set(
      notificationQueue
        .map(item => normalizeNotificationId(item?.id))
        .filter(id => id)
    );
    const currentId = normalizeNotificationId(notificationCurrent?.id);
    let added = 0;
    for (const item of cleaned) {
      const id = normalizeNotificationId(item.id);
      if (!id) continue;
      if (id === currentId) continue;
      if (notificationShownIds.has(id)) continue;
      if (queuedIds.has(id)) continue;
      notificationQueue.push(item);
      queuedIds.add(id);
      added += 1;
    }
    if (notificationQueue.length) {
      startNotificationRotation();
      if (!notificationCurrent && added > 0) {
        showNextNotification();
      }
    } else if (!notificationCurrent) {
      hideNotification();
      stopNotificationRotation();
    }
  } catch (_) {
    // Ignore polling errors to avoid noisy UI
  }
}

function startNotificationPolling() {
  if (notificationPollId) return;
  loadNotificationShownIds()
    .finally(() => {
      if (notificationPollId) return;
      notificationPollId = setInterval(fetchNotifications, NOTIFICATION_POLL_MS);
      fetchNotifications();
    });
}

function initChat() {
  const statusTextEl = document.getElementById('bm-chat-status-text');
  const messagesEl = document.getElementById('bm-chat-messages');
  const userInput = document.getElementById('bm-chat-user');
  const modCodeInput = document.getElementById('bm-chat-modcode');
  const textInput = document.getElementById('bm-chat-text');
  const replyBar = document.getElementById('bm-chat-reply');
  const replyLabel = document.getElementById('bm-chat-reply-label');
  const replyText = document.getElementById('bm-chat-reply-text');
  const replyClear = document.getElementById('bm-chat-reply-clear');
  const modTools = document.getElementById('bm-chat-mod-tools');
  const banTypeSelect = document.getElementById('bm-chat-ban-type');
  const banTargetInput = document.getElementById('bm-chat-ban-target');
  const chatDetails = document.getElementById('bm-contain-chat');
  if (!chatDetails) return;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let replyToId = null;
  const messageCache = new Map();
  const pendingReplies = [];
  const PENDING_REPLY_WINDOW_MS = 30000;

  if (!messagesEl || !textInput) return;
  if (modCodeInput) {
    modCodeInput.style.display = 'none';
  }
  // keep status row visible for connection indicator

  const chatSummary = chatDetails?.querySelector('summary');
  let chatFloatToggleBtn = null;
  let isChatFloating = false;
  let dragState = null;
  let floatingResizeObserver = null;
  let floatingExpandedWidth = '360px';
  let floatingExpandedHeight = '420px';
  const CHAT_FLOAT_ICON = '⧉';
  const CHAT_DOCK_ICON = '⇱';
  const originalChatParent = chatDetails.parentElement;
  const originalChatNextSibling = chatDetails.nextElementSibling;
  const overlayRoot = document.getElementById('bm-overlay');
  const floatingVarNames = [];

  const applyFloatingThemeVars = () => {
    if (!overlayRoot) return;
    const computed = getComputedStyle(overlayRoot);
    for (let i = 0; i < computed.length; i++) {
      const propName = computed[i];
      if (!propName || !propName.startsWith('--bm-')) continue;
      const propValue = computed.getPropertyValue(propName);
      if (!propValue) continue;
      chatDetails.style.setProperty(propName, propValue);
      floatingVarNames.push(propName);
    }
  };

  const clearFloatingThemeVars = () => {
    while (floatingVarNames.length) {
      const propName = floatingVarNames.pop();
      chatDetails.style.removeProperty(propName);
    }
  };
  if (chatSummary) {
    chatSummary.classList.add('bm-chat-summary');
    if (!chatSummary.querySelector('.bm-chat-status-light')) {
      const light = document.createElement('span');
      light.className = 'bm-chat-status-light';
      light.title = 'Chat status';
      chatSummary.appendChild(light);
    }
    chatFloatToggleBtn = document.createElement('button');
    chatFloatToggleBtn.type = 'button';
    chatFloatToggleBtn.className = 'bm-chat-float-toggle';
    chatFloatToggleBtn.textContent = CHAT_FLOAT_ICON;
    chatFloatToggleBtn.setAttribute('aria-label', 'Float chat');
    chatFloatToggleBtn.title = 'Open chat in floating window';
    const statusLight = chatSummary.querySelector('.bm-chat-status-light');
    if (statusLight) {
      chatSummary.insertBefore(chatFloatToggleBtn, statusLight);
    } else {
      chatSummary.appendChild(chatFloatToggleBtn);
    }
  }

  const outerHeight = (element) => {
    if (!element) return 0;
    const computed = getComputedStyle(element);
    if (computed.display === 'none') return 0;
    const marginTop = parseFloat(computed.marginTop) || 0;
    const marginBottom = parseFloat(computed.marginBottom) || 0;
    return element.offsetHeight + marginTop + marginBottom;
  };

  const updateFloatingMessagesHeight = () => {
    if (!isChatFloating) return;
    if (!chatDetails?.open) return;
    const chatComputed = getComputedStyle(chatDetails);
    const paddingTop = parseFloat(chatComputed.paddingTop) || 0;
    const paddingBottom = parseFloat(chatComputed.paddingBottom) || 0;
    const totalHeight = chatDetails.clientHeight;
    const occupied =
      outerHeight(chatSummary) +
      outerHeight(modTools) +
      outerHeight(replyBar) +
      outerHeight(document.getElementById('bm-chat-input-row')) +
      paddingTop +
      paddingBottom;
    const nextHeight = Math.max(80, Math.floor(totalHeight - occupied - 6));
    messagesEl.style.height = `${nextHeight}px`;
  };

  const syncFloatingCollapsedState = () => {
    if (!chatDetails) return;
    if (!isChatFloating) {
      chatDetails.classList.remove('bm-chat-floating-collapsed');
      return;
    }
    if (chatDetails.open) {
      chatDetails.classList.remove('bm-chat-floating-collapsed');
      chatDetails.style.width = floatingExpandedWidth;
      chatDetails.style.height = floatingExpandedHeight;
      updateFloatingMessagesHeight();
      return;
    }
    const rect = chatDetails.getBoundingClientRect();
    if (rect.width > 0) floatingExpandedWidth = `${Math.round(rect.width)}px`;
    if (rect.height > 0) floatingExpandedHeight = `${Math.round(rect.height)}px`;
    chatDetails.classList.add('bm-chat-floating-collapsed');
    chatDetails.style.width = '220px';
    chatDetails.style.height = 'auto';
    messagesEl.style.height = '';
  };

  const setChatFloating = (enabled) => {
    isChatFloating = Boolean(enabled);
    chatDetails.classList.toggle('bm-chat-floating', isChatFloating);
    if (chatFloatToggleBtn) {
      chatFloatToggleBtn.textContent = isChatFloating ? CHAT_DOCK_ICON : CHAT_FLOAT_ICON;
      chatFloatToggleBtn.setAttribute('aria-label', isChatFloating ? 'Dock chat' : 'Float chat');
      chatFloatToggleBtn.title = isChatFloating ? 'Return chat to main layout' : 'Open chat in floating window';
    }
    if (isChatFloating) {
      if (chatDetails.parentElement !== document.body) {
        document.body.appendChild(chatDetails);
      }
      clearFloatingThemeVars();
      applyFloatingThemeVars();
      chatDetails.open = true;
      if (!chatDetails.style.width) chatDetails.style.width = floatingExpandedWidth;
      if (!chatDetails.style.height || chatDetails.style.height === 'auto') chatDetails.style.height = floatingExpandedHeight;
      if (!chatDetails.style.left && !chatDetails.style.right) chatDetails.style.right = '20px';
      if (!chatDetails.style.top && !chatDetails.style.bottom) chatDetails.style.bottom = '20px';
      syncFloatingCollapsedState();
      updateFloatingMessagesHeight();
      if (!floatingResizeObserver) {
        floatingResizeObserver = new ResizeObserver(() => updateFloatingMessagesHeight());
      }
      floatingResizeObserver.observe(chatDetails);
    } else {
      if (floatingResizeObserver) {
        floatingResizeObserver.disconnect();
      }
      if (originalChatParent) {
        if (originalChatNextSibling && originalChatNextSibling.parentElement === originalChatParent) {
          originalChatParent.insertBefore(chatDetails, originalChatNextSibling);
        } else {
          originalChatParent.appendChild(chatDetails);
        }
      }
      clearFloatingThemeVars();
      chatDetails.classList.remove('bm-chat-floating-collapsed');
      chatDetails.style.left = '';
      chatDetails.style.top = '';
      chatDetails.style.right = '';
      chatDetails.style.bottom = '';
      chatDetails.style.width = '';
      chatDetails.style.height = '';
      messagesEl.style.height = '';
    }
  };

  if (chatFloatToggleBtn) {
    chatFloatToggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setChatFloating(!isChatFloating);
    });
  }

  if (chatSummary) {
    chatSummary.addEventListener('mousedown', (event) => {
      if (!isChatFloating) return;
      if (event.button !== 0) return;
      if (chatFloatToggleBtn && chatFloatToggleBtn.contains(event.target)) return;
      const rect = chatDetails.getBoundingClientRect();
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false
      };
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event) => {
      if (!dragState || !isChatFloating) return;
      const dx = Math.abs(event.clientX - dragState.startX);
      const dy = Math.abs(event.clientY - dragState.startY);
      if (!dragState.moved && (dx > 3 || dy > 3)) {
        dragState.moved = true;
      }
      const rect = chatDetails.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      const left = Math.min(maxLeft, Math.max(8, event.clientX - dragState.offsetX));
      const top = Math.min(maxTop, Math.max(8, event.clientY - dragState.offsetY));
      chatDetails.style.left = `${left}px`;
      chatDetails.style.top = `${top}px`;
      chatDetails.style.right = 'auto';
      chatDetails.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!dragState) return;
      if (dragState.moved) {
        const blockClick = (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          chatSummary.removeEventListener('click', blockClick, true);
        };
        chatSummary.addEventListener('click', blockClick, true);
      }
      dragState = null;
    });
  }

  chatDetails?.addEventListener('toggle', () => {
    syncFloatingCollapsedState();
  });

  window.addEventListener('resize', () => updateFloatingMessagesHeight());

  const setStatus = (text) => {
    if (statusTextEl) {
      statusTextEl.textContent = `Status: ${text}`;
    }
    if (!chatDetails) return;
    const lowered = String(text || '').toLowerCase();
    let nextState = null;
    if (lowered.includes('connecting') || lowered.includes('reconnecting')) {
      nextState = 'connecting';
    } else if (lowered.includes('disconnected')) {
      nextState = 'error';
    } else if (lowered === 'connected') {
      nextState = 'connected';
    } else if (lowered === 'error') {
      nextState = 'error';
    }
    if (!nextState) return;
    chatDetails.classList.remove('bm-chat-state-connected', 'bm-chat-state-connecting', 'bm-chat-state-error');
    if (nextState === 'connecting') {
      chatDetails.classList.add('bm-chat-state-connecting');
    } else if (nextState === 'connected') {
      chatDetails.classList.add('bm-chat-state-connected');
    } else {
      chatDetails.classList.add('bm-chat-state-error');
    }
    updateFloatingMessagesHeight();
  };

  const getModCode = () => modCodeInput?.value?.trim() || '';
  const getUserName = () => normalizeUser(userInput?.value || document.getElementById('bm-user-name')?.textContent);
  const getDeviceId = () => {
    try {
      return localStorage.getItem('device_id') || '';
    } catch (_) {
      return '';
    }
  };
  const getAuthToken = () => {
    try {
      return localStorage.getItem('auth_token') || '';
    } catch (_) {
      return '';
    }
  };
  const clipText = (value, max = 120) => {
    const text = String(value ?? '');
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
  };
  const normalizeUser = (value) => {
    const name = String(value ?? '').trim().slice(0, CHAT_MAX_USER_LEN);
    return name || 'anon';
  };
  const prunePendingReplies = (now = Date.now()) => {
    while (pendingReplies.length && now - pendingReplies[0].ts > PENDING_REPLY_WINDOW_MS) {
      pendingReplies.shift();
    }
  };
  const queuePendingReply = (user, text, replyId) => {
    pendingReplies.push({
      user: normalizeUser(user),
      text: String(text ?? ''),
      replyToId: String(replyId),
      ts: Date.now()
    });
  };
  const applyPendingReply = (payload) => {
    if (payload?.reply_to !== undefined && payload?.reply_to !== null && payload?.reply_to !== '') return;
    const user = normalizeUser(payload?.user);
    const text = String(payload?.text ?? '');
    const now = Date.now();
    prunePendingReplies(now);
    const index = pendingReplies.findIndex((entry) => entry.user === user && entry.text === text);
    if (index === -1) return;
    payload.reply_to = pendingReplies[index].replyToId;
    pendingReplies.splice(index, 1);
  };

  const clearReply = () => {
    replyToId = null;
    if (replyBar) replyBar.style.display = 'none';
    updateFloatingMessagesHeight();
  };

  const setReplyTo = (id) => {
    if (id === undefined || id === null || id === '') return;
    replyToId = String(id);
    const cached = messageCache.get(replyToId);
    if (replyBar) {
      replyBar.style.display = '';
    }
    if (replyLabel) {
      replyLabel.textContent = cached?.user ? `Replying to ${cached.user}` : `Replying to #${replyToId}`;
    }
    if (replyText) {
      replyText.textContent = clipText(cached?.text || '');
    }
    updateFloatingMessagesHeight();
  };
  const isChatDisabled = () => templateManager?.isChatDisabled?.() ?? false;

  const moderateDelete = (messageId) => {
    const code = getModCode();
    if (!code) {
      setStatus('missing moderation code');
      return;
    }
    GM_xmlhttpRequest({
      method: "POST",
      url: `${TEMPLATE_SYNC_BASE_URL}/chat/moderate/delete`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ code, id: messageId }),
      onload: (response) => {
        if (response.status >= 200 && response.status < 300) {
          setStatus('moderation delete sent');
        } else {
          setStatus(`moderation failed (${response.status})`);
        }
      },
      onerror: () => setStatus('moderation error')
    });
  };

  const parseBanTarget = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const isMessageId = /^\d+$/.test(raw);
    return { raw, isMessageId };
  };

  const postModerationAction = (endpoint, payload) => {
    GM_xmlhttpRequest({
      method: "POST",
      url: `${TEMPLATE_SYNC_BASE_URL}${endpoint}`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      onload: (response) => {
        if (response.status >= 200 && response.status < 300) {
          setStatus('moderation ok');
        } else {
          setStatus(`moderation failed (${response.status})`);
        }
      },
      onerror: () => setStatus('moderation error')
    });
  };

  const moderateBan = (target, type, isUnban = false) => {
    const code = getModCode();
    if (!code) {
      setStatus('missing moderation code');
      return;
    }
    const parsed = parseBanTarget(target);
    if (!parsed) {
      setStatus('missing ban target');
      return;
    }
    const endpoint = type === 'device'
      ? (isUnban ? '/chat/moderate/unban_device' : '/chat/moderate/ban_device')
      : (isUnban ? '/chat/moderate/unban' : '/chat/moderate/ban');
    const payload = { code };
    if (type === 'device') {
      if (isUnban) {
        payload.device_id = parsed.raw;
      } else if (parsed.isMessageId) {
        const cached = messageCache.get(parsed.raw);
        if (!cached?.device_id) {
          setStatus('device id not found');
          return;
        }
        payload.device_id = cached.device_id;
        if (cached?.text) {
          payload.message = String(cached.text);
        }
      } else {
        payload.device_id = parsed.raw;
      }
    } else {
      if (isUnban) {
        payload.ip = parsed.raw;
      } else if (parsed.isMessageId) {
        payload.message_id = Number(parsed.raw);
        const cached = messageCache.get(parsed.raw);
        if (cached?.text) {
          payload.message = String(cached.text);
        }
      } else {
        payload.ip = parsed.raw;
      }
    }
    postModerationAction(endpoint, payload);
  };

  const fetchBans = () => {
    const code = getModCode();
    if (!code) {
      setStatus('missing moderation code');
      return;
    }
    GM_xmlhttpRequest({
      method: "GET",
      url: `${TEMPLATE_SYNC_BASE_URL}/chat/moderate/banned?code=${encodeURIComponent(code)}`,
      onload: (response) => {
        let data = {};
        try {
          data = response.response ?? JSON.parse(response.responseText || "{}");
        } catch (_) {
          data = {};
        }
        const list = Array.isArray(data?.banned) ? data.banned : [];
        if (!list.length) {
          setStatus('no bans');
          return;
        }
        const lines = list.map((entry) => {
          const typeLabel = entry?.type || 'unknown';
          const idLabel = entry?.identifier || entry?.ip || entry?.device_id || '';
          const ts = entry?.created_at ? ` @ ${entry.created_at}` : '';
          const msg = entry?.message ? ` — ${entry.message}` : '';
          return `${typeLabel}: ${idLabel}${ts}${msg}`;
        });
        alert(lines.join('\n'));
      },
      onerror: () => setStatus('moderation error')
    });
  };

  const ensureDeleteButton = (row) => {
    const messageId = row.getAttribute('data-msg-id');
    const messageIdNum = messageId ? Number(messageId) : NaN;
    const existing = row.querySelector('.bm-chat-delete');
    const code = getModCode();
    if (!code || !Number.isFinite(messageIdNum)) {
      if (existing) existing.remove();
      row.style.position = '';
      row.style.paddingRight = '';
      return;
    }
    if (existing) return;
    const btn = document.createElement('button');
    btn.className = 'bm-chat-delete';
    btn.type = 'button';
    btn.textContent = '✖';
    btn.title = 'Delete message';
    row.style.position = 'relative';
    row.style.paddingRight = '18px';
    btn.style.position = 'absolute';
    btn.style.top = '2px';
    btn.style.right = '2px';
    btn.style.marginLeft = '0';
    btn.style.background = 'transparent';
    btn.style.border = '1px solid var(--bm-border-strong)';
    btn.style.color = 'var(--bm-accent-strong)';
    btn.style.borderRadius = '50%';
    btn.style.width = '14px';
    btn.style.height = '14px';
    btn.style.minWidth = '14px';
    btn.style.minHeight = '14px';
    btn.style.padding = '0';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.fontSize = '9px';
    btn.style.lineHeight = '1';
    btn.style.zIndex = '2';
    btn.style.pointerEvents = 'auto';
    btn.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      moderateDelete(messageIdNum);
    });
    row.appendChild(btn);
  };

  const renderModerationControls = () => {
    const rows = messagesEl.querySelectorAll('.bm-chat-message');
    rows.forEach(ensureDeleteButton);
    if (modTools) {
      modTools.style.display = getModCode() ? 'flex' : 'none';
    }
    updateFloatingMessagesHeight();
  };

  const appendMessage = (payload) => {
    // Normalize user field from possible server keys for compatibility; prefer non-anon usernames when provided
    const candidateUser = payload?.user ?? payload?.username ?? payload?.name ?? payload?.Lt;
    const fallbackUser = payload?.username ?? payload?.name ?? payload?.Lt;
    const resolvedUser = (candidateUser && candidateUser !== 'anon')
      ? candidateUser
      : (fallbackUser && fallbackUser !== 'anon')
        ? fallbackUser
        : 'anon';
    payload.user = normalizeUser(resolvedUser);
    applyPendingReply(payload);
    const user = payload.user;
    const text = payload?.text || '';
    const ts = payload?.ts ? new Date(payload.ts) : new Date();
    const line = document.createElement('div');
    line.className = 'bm-chat-message';
    if (payload?.id !== undefined && payload?.id !== null) {
      const messageId = String(payload.id);
      line.setAttribute('data-msg-id', messageId);
      messageCache.set(messageId, payload);
    }
    const replyId = payload?.reply_to;
    if (replyId !== undefined && replyId !== null) {
      const replyBlock = document.createElement('div');
      replyBlock.className = 'bm-chat-reply-inline';
      const replySource = messageCache.get(String(replyId));
      const replyTitle = document.createElement('span');
      replyTitle.className = 'bm-chat-reply-title';
      replyTitle.textContent = replySource?.user ? `↪ Reply to ${replySource.user}` : `↪ Reply to #${replyId}`;
      const replySnippet = document.createElement('span');
      replySnippet.className = 'bm-chat-reply-snippet';
      replySnippet.textContent = clipText(replySource?.text || `Message #${replyId}`);
      replyBlock.appendChild(replyTitle);
      replyBlock.appendChild(replySnippet);
      line.appendChild(replyBlock);
    }
    const row = document.createElement('div');
    row.className = 'bm-chat-row';
    const meta = document.createElement('span');
    meta.className = 'bm-chat-meta';
    const timeLabel = ts.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    meta.textContent = `[${timeLabel}] ${user}:`;
    const body = document.createElement('span');
    body.className = 'bm-chat-body';
    appendLinkedText(body, text, { enableTeleport: true, shortenWplace: true });
    row.appendChild(meta);
    row.appendChild(body);
    line.appendChild(row);
    messagesEl.appendChild(line);
    while (messagesEl.childElementCount > 200) {
      messagesEl.removeChild(messagesEl.firstChild);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    ensureDeleteButton(line);
    line.addEventListener('dblclick', () => {
      const id = line.getAttribute('data-msg-id');
      if (id) {
        setReplyTo(id);
        textInput.focus();
      }
    });
  };

  const handleDeleted = (payload) => {
    const messageId = payload?.id;
    if (typeof messageId !== 'number') return;
    const row = messagesEl.querySelector(`.bm-chat-message[data-msg-id="${messageId}"]`);
    if (row) row.remove();
    messageCache.delete(String(messageId));
    if (replyToId && String(messageId) === replyToId) {
      clearReply();
    }
  };

  const scheduleReconnect = () => {
    const delay = reconnectAttempts === 0 ? 2000 : reconnectAttempts === 1 ? 4000 : 10000;
    reconnectAttempts = Math.min(reconnectAttempts + 1, 2);
    if (reconnectTimer) return;
    setStatus(`reconnecting in ${Math.round(delay / 1000)}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (chatSocket && (chatSocket.readyState === WebSocket.OPEN || chatSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    setStatus('connecting');
    const buildChatUrl = () => {
      try {
        const url = new URL(CHAT_WS_URL);
        url.searchParams.set('user', getUserName());
        const deviceId = getDeviceId();
        if (deviceId) {
          url.searchParams.set('device_id', deviceId);
        }
        return url.toString();
      } catch (_) {
        const sep = CHAT_WS_URL.includes('?') ? '&' : '?';
        const deviceId = getDeviceId();
        const extra = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : '';
        return `${CHAT_WS_URL}${sep}user=${encodeURIComponent(getUserName())}${extra}`;
      }
    };
    chatSocket = new WebSocket(buildChatUrl());
    chatSocket.onopen = () => {
      reconnectAttempts = 0;
      setStatus('connected');
    };
    chatSocket.onclose = () => {
      setStatus('disconnected');
      scheduleReconnect();
    };
    chatSocket.onerror = () => {
      setStatus('error');
    };
    chatSocket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'chat') {
          appendMessage(payload);
        } else if (payload?.type === 'chat_deleted') {
          handleDeleted(payload);
        }
      } catch (_) {}
    };
  };

  const sendMessage = () => {
    let text = textInput.value.trim();
    if (!text) return;
    if (text.length > CHAT_MAX_TEXT_LEN) {
      text = text.slice(0, CHAT_MAX_TEXT_LEN);
      textInput.value = text;
    }
    const user = getUserName();
    if (userInput && userInput.value.trim() !== user) {
      userInput.value = user;
    }
    if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
      setStatus('disconnected');
      return;
    }
    const device_id = getDeviceId();
    const auth_token = getAuthToken();
    const payload = {
      type: 'chat',
      text,
      user,
      username: user,
      name: user,
      Lt: user,
      ...(device_id ? { device_id } : {}),
      ...(auth_token ? { auth_token } : {})
    };
    if (replyToId) {
      payload.reply_to = replyToId;
      queuePendingReply(user, text, replyToId);
    }
    chatSocket.send(JSON.stringify(payload));
    textInput.value = '';
    clearReply();
  };

  const setChatEnabled = (enabled) => {
    chatDetails.style.display = enabled ? '' : 'none';
    if (!enabled) {
      try { chatSocket?.close(); } catch (_) {}
      return;
    }
    connect();
  };

  window.setChatEnabled = setChatEnabled;

  if (chatInitialized) {
    setChatEnabled(!isChatDisabled());
    return;
  }
  chatInitialized = true;

  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  modCodeInput?.addEventListener('input', () => {
    GM.setValue('bmChatModCode', modCodeInput.value.trim());
  renderModerationControls();
  messagesEl.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.bm-chat-delete') : null;
    if (!target) return;
    const row = target.closest('.bm-chat-message');
    const messageId = row?.getAttribute('data-msg-id');
    const messageIdNum = messageId ? Number(messageId) : NaN;
    if (!Number.isFinite(messageIdNum)) return;
    event.preventDefault();
    event.stopPropagation();
    moderateDelete(messageIdNum);
  });
  });
  const banBtn = document.getElementById('bm-chat-ban-btn');
  const unbanBtn = document.getElementById('bm-chat-unban-btn');
  const bansBtn = document.getElementById('bm-chat-bans-btn');
  banBtn?.addEventListener('click', () => {
    moderateBan(banTargetInput?.value, banTypeSelect?.value || 'ip', false);
  });
  unbanBtn?.addEventListener('click', () => {
    moderateBan(banTargetInput?.value, banTypeSelect?.value || 'ip', true);
  });
  bansBtn?.addEventListener('click', () => {
    fetchBans();
  });
  replyClear?.addEventListener('click', () => {
    clearReply();
    textInput.focus();
  });
  userInput?.addEventListener('change', () => {
    const user = getUserName();
    userInput.value = user;
    GM.setValue('bmChatUser', user);
    // Reconnect to apply new username via query params; server doesn't support identify frames
    try { chatSocket?.close(); } catch (_) {}
    connect();
  });

  Promise.all([
    GM.getValue('bmChatUser', '').catch(() => ''),
    GM.getValue('bmChatModCode', '').catch(() => '')
  ]).then(([savedUser, savedCode]) => {
    if (userInput && !userInput.value) {
      const fallback = document.getElementById('bm-user-name')?.textContent?.trim() || '';
      userInput.value = normalizeUser(savedUser || fallback);
    }
    if (modCodeInput && !modCodeInput.value) {
      modCodeInput.value = savedCode || '';
      renderModerationControls();
    }
  }).finally(() => {
    setChatEnabled(!isChatDisabled());
  });

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.key.toLowerCase() !== 'a') return;
    if (isChatDisabled()) return;
    const active = document.activeElement;
    if (active && active.tagName && ['INPUT', 'TEXTAREA'].includes(active.tagName) && active !== textInput && active !== userInput && active !== modCodeInput) {
      return;
    }
    const chatDetails = document.getElementById('bm-contain-chat');
    if (chatDetails && chatDetails.tagName === 'DETAILS') {
      chatDetails.open = true;
    }
    if (modCodeInput) {
      const isHidden = modCodeInput.style.display === 'none';
      modCodeInput.style.display = isHidden ? '' : 'none';
      updateFloatingMessagesHeight();
      if (isHidden) {
        modCodeInput.focus();
      } else {
        textInput.focus();
      }
    } else {
      textInput.focus();
    }
  });
}

/** What code to execute instantly in the client (webpage) to spy on fetch calls.
 * This code will execute outside of TamperMonkey's sandbox.
 * @since 0.11.15
 */
inject(() => {

  const script = document.currentScript; // Gets the current script HTML Script Element
  const name = script?.getAttribute('bm-name') || 'Rus Marble'; // Gets the name value that was passed in. Defaults to "Rus Marble" if nothing was found
  const consoleStyle = script?.getAttribute('bm-cStyle') || ''; // Gets the console style value that was passed in. Defaults to no styling if nothing was found
  const fetchedBlobQueue = new Map(); // Blobs being processed

  // intercept 
  // const originalBroadcastChannel_onmessage = window.BroadcastChannel.prototype.onmessage;
  // function wrapped(...args) {
  //   console.log("BroadcastChannel onmessage", args);
  //   return originalBroadcastChannel_onmessage.apply(this, args);
  // }
  // window.BroadcastChannel.prototype.onmessage = wrapped;

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data;

    const elapsed = Date.now() - blink;

    // Since this code does not run in the userscript, we can't use consoleLog().
    console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
    console.log(`Blob fetch took %c${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')}%c MM:SS.mmm`, consoleStyle, '');
    console.log(fetchedBlobQueue);
    console.groupEnd();

    // The modified blob won't have an endpoint, so we ignore any message without one.
    if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {

      const callback = fetchedBlobQueue.get(blobID); // Retrieves the blob based on the UUID

      // If the blobID is a valid function...
      if (typeof callback === 'function') {

        callback(blobData); // ...Retrieve the blob data from the blobID function
      } else {
        // ...else the blobID is unexpected. We don't know what it is, but we know for sure it is not a blob. This means we ignore it.

        consoleWarn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
      }

      fetchedBlobQueue.delete(blobID); // Delete the blob from the queue, because we don't need to process it again
    }
  });

  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Overrides fetch
  window.fetch = async function(...args) {

    const blink = Date.now(); // Current time

    const response = await originalFetch.apply(this, args); // Sends a fetch
    const cloned = response.clone(); // Makes a copy of the response

    // Retrieves the endpoint name. Unknown endpoint = "ignore"
    const endpointName = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');
      // Sends a message about the endpoint it spied on
      if (endpointName.endsWith("/tile/random")) {
        // modify the response to send to desired coordinate

        return new Promise((resolve) => {
          const blobUUID = crypto.randomUUID(); // Generates a random UUID
          fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
            // The response that triggers when the blob is finished processing

            // Creates a new response
            resolve(new Response(blobProcessed, {
              headers: cloned.headers,
              status: cloned.status,
              statusText: cloned.statusText
            }));

            // Since this code does not run in the userscript, we can't use consoleLog().
            console.log(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
          });

          cloned.json()
          .then(jsonData => {
            window.postMessage({
              source: 'blue-marble',
              endpoint: endpointName,
              blobID: blobUUID,
              jsonData: jsonData,
              blink: blink
            }, '*');
          })
          .catch(err => {
            console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
          });
        });
      } if (endpointName.includes("/s0/pixel/") && endpointName.includes("?x=") && endpointName.includes("&y=") && cloned.status === 400) {
        // try to fix the JSON response
        return new Promise((resolve, reject) => {
          const cloned2 = response.clone();
          cloned2.text().then(text => {
            const errorPrefix = '{"error":"Invalid x","status":400}';
            if (text.startsWith(errorPrefix)) {
              const fixedPayload = text.slice(errorPrefix.length);
              console.error("Fixed", fixedPayload);
              try {
                const actualPayload = JSON.parse(fixedPayload);
                console.error("actualPayload", actualPayload);
                window.postMessage({
                  source: 'blue-marble',
                  endpoint: endpointName,
                  jsonData: actualPayload,
                  blink: blink
                }, '*');

                // Creates a new response
                resolve(new Response(fixedPayload, {
                  headers: cloned.headers,
                  status: 200,
                  statusText: 'OK'
                }));
              } catch (err) {
                console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
                // Return the original 400 response
                resolve(response);
              }
            } else {
              // Return the original 400 response
              resolve(response);
            }
          }).catch(err => {
            console.error(`%c${name}%c: Failed to get Content: `, consoleStyle, '', err);
            // Return the original 400 response
            resolve(response);
          });
        });
      } else {
        cloned.json()
        .then(jsonData => {
          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            jsonData: jsonData,
            blink: blink
          }, '*');
        })
        .catch(err => {
          console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
        });
      }
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
      // Fetch custom for all images but opensourcemap

      const blob = await cloned.blob(); // The original blob

      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');

      // Send the received blob
      window.postMessage({
        source: 'blue-marble',
        endpoint: endpointName,
        lastModified: cloned.headers.get("Last-Modified"),
        blobData: blob,
        blink: blink
      });
    }

    return response; // Returns the original response
  };

  const hookedMapFuncs = {
    "values": Map.prototype.values
  };
  const hookedMapValues = function () {
    const temp = hookedMapFuncs.values.call(this);
    Array.from(temp).forEach(x => {
        if (x && x["maps"] instanceof Set) {
            Array.from(x["maps"]).forEach(y => {
                if (y && y["flyTo"]) (document.head["__bmmap"] = y, restoreMapPrototype());
            });
        };
    })
    return temp;
  };
  const restoreMapPrototype = function () {
    for (const key in hookedMapFuncs) {
      Map.prototype[key] = hookedMapFuncs[key];
    }
  };
  // Don't hook "set", "get", "has", some Proxy object doing something like "setDefault" may make it into infinite recursion
  // [].forEach(key => {
  //   hookedMapFuncs[key] = Map.prototype[key];
  //   Map.prototype[key] = function (...args) {
  //     this.values(); // call this once
  //     return hookedMapFuncs[key].call(this, ...args);
  //   };
  // });
  Map.prototype.values = hookedMapValues;
});

// Imports the CSS file (inline build) or remote fallback
if (typeof __INLINE_CSS__ !== 'undefined' && __INLINE_CSS__) {
  GM.addStyle(__INLINE_CSS__);
} else {
  GM_xmlhttpRequest({
    method: "GET",
    url: CSS_BM_File,
    onload: (response) => {
      if (response.status >= 200 && response.status < 300) {
        GM.addStyle(response.responseText);
      } else {
        consoleWarn(`%c${name}%c: Failed to load CSS (${response.status}) from ${CSS_BM_File}`, consoleStyle, '');
        console.log(`${name}: CSS load failed`, { status: response.status, url: CSS_BM_File });
      }
    },
    onerror: (err) => {
      consoleWarn(`%c${name}%c: Failed to load CSS from ${CSS_BM_File}`, consoleStyle, '', err);
      console.log(`${name}: CSS load error`, { url: CSS_BM_File, err });
    }
  });
}

// CONSTRUCTORS
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlayMain.setApiManager(apiManager); // Sets the API manager
const templateSync = createTemplateSync({
  name,
  consoleStyle,
  consoleLog,
  consoleWarn,
  gmRequest,
  templateManager,
  templateSyncBaseUrl: TEMPLATE_SYNC_BASE_URL,
  templateUpdatePollMs: TEMPLATE_UPDATE_POLL_MS,
  remoteFlagsRefreshMs: REMOTE_FLAGS_REFRESH_MS,
  buildTemplateFilterList: () => window.buildTemplateFilterList?.(),
  autoSyncOnStatus: (message) => overlayMain.handleDisplayStatus(message),
  autoSyncOnError: (message) => overlayMain.handleDisplayError(message),
  autoSyncSyncToggleList: () => window.syncToggleList?.(),
  autoSyncBuildTemplateFilterList: () => window.buildTemplateFilterList?.(),
  autoSyncBuildColorFilterList: () => window.buildColorFilterList?.(),
});

GM.getValue('bmTemplates', '{}').then(async storageTemplatesValue => {
  const userSettingsValue = await GM.getValue('bmUserSettings', '{}');
  let userSettings;
  try {
    userSettings = JSON.parse(userSettingsValue);
  } catch {
    userSettings = {};
  }
  console.log(userSettings);
  console.log(Object.keys(userSettings).length);
  if (Object.keys(userSettings).length == 0) {
    const uuid = crypto.randomUUID(); // Generates a random UUID
    console.log(uuid);
    templateManager.setUserSettings({
      'uuid': uuid,
      'hideLockedColors': false,
      'progressBarEnabled': true,
      'hideCompletedColors': false,
      'sortBy': 'total-desc',
      'anchor': 'lt', // Top left
      'smartPlace': false, // Hidden in settings
      'memorySavingMode': false,
      'eventEnabled': false,
      'eventProvider': '',
      'eventClaimedShown': true,
      'eventUnavailableShown': true,
      'onlyCurrentColorShown': false,
      'themeOverridden': false,
      'currentTheme': '',
      'layoutTheme': 'classic',
      'templateDisplay': 'cross',
      'templateListRemaining': true,
      'hideDroplets': false,
      'hideNextLevel': false,
      'hideStatus': false,
      'isLegacyDisplay': false,
      'showErrorMap': false,
      'showOnlyEnabledColorsErrorMap': false, // Hidden in settings
      'showIntegerZoom': false,
      'enableKeybinds': false,
      'lineTemplateButton': false, // Hidden in settings
      'ruspixelFlagEnabled': true,
      'autoSyncTemplates': false,
      'chatDisabled': false,
    });
    templateManager.storeUserSettings();
  } else {
    templateManager.setUserSettings(userSettings);
  }

  // load templates after user settings
  let storageTemplates;
  try {
    storageTemplates = JSON.parse(storageTemplatesValue);
  } catch {
    storageTemplates = {};
  }

  console.log(storageTemplates);
  templateManager.importJSON(storageTemplates); // Loads the templates

  await waitForBody();
  observeWplaceTheme();
  await buildOverlayMain(); // Builds the main overlay
  initChat();
  templateSync.startTemplateUpdatePolling();
  startNotificationPolling();

  overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay
  const rebuildOverlayIfMissing = async () => {
    if (overlayBuildInFlight || document.getElementById('bm-overlay')) return;
    overlayBuildInFlight = true;
    try {
      await buildOverlayMain();
      overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag');
      applyWplaceThemeState();
    } catch (err) {
      consoleWarn(`%c${name}%c: Failed to rebuild overlay`, consoleStyle, '', err);
    } finally {
      overlayBuildInFlight = false;
    }
  };
  setInterval(rebuildOverlayIfMissing, 2000);

  const keysPressed = new Set();
  let animationFrameId = null;
  const PAN_SPEED = 25; // pixels per frame

  function panLoop() {
    if (!templateManager.areKeybindsEnabled()) {
        keysPressed.clear();
    }

    if (keysPressed.size === 0) {
      animationFrameId = null;
      return;
    }

    let dx = 0;
    let dy = 0;

    if (keysPressed.has('w') || keysPressed.has('arrowup')) dy -= 1;
    if (keysPressed.has('s') || keysPressed.has('arrowdown')) dy += 1;
    if (keysPressed.has('a') || keysPressed.has('arrowleft')) dx -= 1;
    if (keysPressed.has('d') || keysPressed.has('arrowright')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      if (dx !== 0 && dy !== 0) {
        // Normalize diagonal movement speed
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;
      }
      panMap([dx * PAN_SPEED, dy * PAN_SPEED]);
    }

    animationFrameId = requestAnimationFrame(panLoop);
  }

  document.addEventListener('keydown', (event) => {
    // Don't pan if disabled
    if (!templateManager.areKeybindsEnabled()) {
        return;
    }
    // Don't pan if user is typing in an input
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
    }

    const key = event.key.toLowerCase();
    const validKeys = ['w', 'a', 's', 'd']; //, 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']; // also used by wplace to handle rotation, so not capturing these

    // Ignore invalid keys or repeated keydown events
    if (!validKeys.includes(key) || keysPressed.has(key)) {
        return;
    }

    keysPressed.add(key);

    // Start the loop if it's not already running
    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(panLoop);
    }
  });

  document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    keysPressed.delete(key);
    // The loop will stop itself on the next frame if no keys are pressed
  });

  apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

  observeBlack(); // Observes the black palette color

  consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');
});

/** Add the zoom level buttons if they do not exist.
 * @since 0.86.15
 */
function createZoomButtons() {
  // If the 1x zoom button does not exist, we make new zoom level buttons
  const zoom1 = document.getElementById('BM-zoom-1x');
  if (zoom1) return;
  const ref = Array.from(document.querySelectorAll(".gap-1>.btn[title]")).slice(-1)[0];
  if (!ref) return;
  const container = ref.parentNode;
  if (!container) return;

  const isShown = templateManager.areIntegerZoomButtonsShown();

  function createZoomButton(zoomLevel) {
    const zoomBtn = document.createElement('button');

    const label = zoomLevel === 0 ? "Min" : (zoomLevel + 'x');
    zoomBtn.id = `BM-zoom-${label}`;
    zoomBtn.textContent = label;

    zoomBtn.className = ref.className;
    zoomBtn.classList.add('bm-zoom-btn');
    if (!isShown) {
      zoomBtn.style.display = "none";
    };

    zoomBtn.onclick = function() {
      var actualZoomLevel = zoomLevel;
      if (zoomLevel === 0) {
        var currentTileSize = getCurrentTileSize();
        var epsilon = 1e-7; // Ensure no rounding issue but remain negligible
        setZoom(Math.log2(8 * currentTileSize * currentTileSize) / 2 + epsilon);
        return;
      }
      setZoom(Math.log2(4000 * actualZoomLevel / window['devicePixelRatio']));
    };

    container.appendChild(zoomBtn); // Adds the zoom level button
  };

  [0, 1, 2, 3, 4, 5, 10, 25].forEach( zoom => createZoomButton(zoom) );
}

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  const observer = new MutationObserver((mutations, observer) => {
    createZoomButtons();

    const black = document.querySelector('#color-1'); // Attempt to retrieve the black color element for anchoring

    if (!black) {return;} // Black color does not exist yet. Kills iteself

    let move = document.querySelector('#bm-button-move'); // Tries to find the move button

    // If the move button does not exist, we make a new one
    if (!move) {
      move = document.createElement('button');
      move.id = 'bm-button-move';
      move.textContent = 'Move â†‘';
      move.className = 'btn btn-soft';
      move.onclick = function() {
        const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
        const shouldMoveUp = (this.textContent == 'Move â†‘');
        roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
        roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        this.textContent = shouldMoveUp ? 'Move â†“' : 'Move â†‘';
      }

      // Attempts to find the "Paint Pixel" element for anchoring
      const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

      paintPixel.parentNode?.appendChild(move); // Adds the move button
    }

    // should not be enabled on its own as it would break the wplace rules
    // just here for a proof-of-work, there's no way to enable it directly via the UI
    if (templateManager.userSettings?.smartPlace ?? false) {
      let paint = document.querySelector('#bm-button-paint'); // Tries to find the paint button

      // If the move button does not exist, we make a new one
      if (!paint) {
        paint = document.createElement('button');
        paint.id = 'bm-button-paint';
        paint.textContent = 'Paint';
        paint.className = 'btn btn-soft';
        paint.onclick = function() {
          const currentCharges = Math.floor(apiManager.getCurrentCharges());
          if (currentCharges === 0) return;
          let examples = [];
          const toggleStatus = new Set(templateManager.getDisplayedColorsSorted());
          for (const stats of templateManager.tileProgress.values()) {
            Object.entries(stats.palette).forEach(([colorKey, content]) => {
              if (!toggleStatus.has(colorKey)) return;
              const colorId = rgbToMeta.get(colorKey).id;
              if (!templateManager.isColorUnlocked(colorId)) return; // color not owned, need to disable no matter if enabled or not
              
              examples.extend(content.examplesEnabled.map(example => [colorId, example]));
            })
          };
          let exampleCoord;
          if (examples.length === 0) return;
          // if ([
          //   "bm-input-tx",
          //   "bm-input-ty",
          //   "bm-input-px",
          //   "bm-input-py",
          // ].every(elementId => document.getElementById(elementId)?.value !== "")) {
          //   const [[tx, ty], [px, py]] = getOverlayCoords();
          //   exampleCoord = [
          //     tx * templateManager.tileSize + px,
          //     ty * templateManager.tileSize + py,
          //   ];
          // } else {
          try {
            const geoCoords = getCenterGeoCoords();
            const tileCoords = coordsGeoCoordsToTileCoords(geoCoords[0], geoCoords[1]);
            exampleCoord = [
              tileCoords[0][0] * templateManager.tileSize + tileCoords[1][0],
              tileCoords[0][1] * templateManager.tileSize + tileCoords[1][1],
            ];
          } catch {
            const example = examples[Math.floor(Math.random() * examples.length)][1];
            exampleCoord = [
              example[0][0] * templateManager.tileSize + example[1][0],
              example[0][1] * templateManager.tileSize + example[1][1],
            ];
          };
          // }
          if (examples.length <= currentCharges) {
            // do nothing as all are going to be painted anyway
          } else if (examples.length < 5000) { // performance is close at about 5000 ~ 10000
             examples = examples.sort(([color1, coord1], [color2, coord2]) => {
              const _coord1 = [
                coord1[0][0] * templateManager.tileSize + coord1[1][0],
                coord1[0][1] * templateManager.tileSize + coord1[1][1],
              ];
              const _coord2 = [
                coord2[0][0] * templateManager.tileSize + coord2[1][0],
                coord2[0][1] * templateManager.tileSize + coord2[1][1],
              ];
              const dist1 = Math.sqrt(Math.pow(_coord1[0] - exampleCoord[0], 2) + Math.pow(_coord1[1] - exampleCoord[1], 2)) * (1 + Math.random() * 0.2);
              const dist2 = Math.sqrt(Math.pow(_coord2[0] - exampleCoord[0], 2) + Math.pow(_coord2[1] - exampleCoord[1], 2)) * (1 + Math.random() * 0.2);
              return dist1 - dist2;
            }).slice(0, currentCharges);
          } else {
            // we don't want to fully sort the array
            const buckets = {};
            const resultExamples = [];
            examples.forEach(([color1, coord1]) => {
              const _coord1 = [
                coord1[0][0] * templateManager.tileSize + coord1[1][0],
                coord1[0][1] * templateManager.tileSize + coord1[1][1],
              ];
              const dist1 = Math.floor(Math.sqrt(Math.pow(_coord1[0] - exampleCoord[0], 2) + Math.pow(_coord1[1] - exampleCoord[1], 2)) * (1 + Math.random() * 0.2));
              if (buckets[dist1] === undefined) {
                buckets[dist1] = [
                  [color1, coord1]
                ];
              } else {
                buckets[dist1].push(
                  [color1, coord1]
                );
              }
            });
            const sortedDist = Object.keys(buckets).sort((a, b) => a - b);
            for (const dist of sortedDist) {
              resultExamples.extend(buckets[dist]);
              if (resultExamples.length >= currentCharges) break;
            }
            examples = resultExamples.slice(0, currentCharges);
          }
          const canvas = document.querySelector("canvas.maplibregl-canvas");
          // for (let i = 0; i < examples.length; i++) {
          //   const [colorId, example] = examples[i];
          //   document.getElementById("color-" + colorId).click();
          //   teleportToTileCoords(example[0], example[1]);
          //   const ev = new MouseEvent("click", {
          //     "bubbles": true, "cancelable": true, "clientX": canvas.offsetWidth / 2, "clientY": canvas.offsetHeight / 2, "button": 0
          //   });
          //   canvas.dispatchEvent(ev);
          // }
          // Get back to the first point to show where the painted pixels are based on
          teleportToTileCoords(examples[0][1][0], examples[0][1][1]);
          const wplaceBad = !isMapTilerLoaded();
          setTimeout(() => {
            let currentColorId = examples[0][0];
            document.getElementById("color-" + currentColorId).click();

            const refW = [
              examples[0][1][0][0] * templateManager.tileSize + examples[0][1][1][0],
              examples[0][1][0][1] * templateManager.tileSize + examples[0][1][1][1],
            ]; // reference Wplace coord
            const cliC = [canvas.offsetWidth / 2, canvas.offsetHeight / 2]; // reference canvas coord
            const pxPerW = wplaceBad ? (512 * 2 ** (13 + 0)) / 2048000 : getPixelPerWplacePixel(); // teleport zoom is 13
            for (let i = 0; i < examples.length; i++) {
              const [colorId, example] = examples[i];
              if (currentColorId !== colorId) {
                currentColorId = colorId;
                document.getElementById("color-" + colorId).click();
              };
              const exW = [
                example[0][0] * templateManager.tileSize + example[1][0],
                example[0][1] * templateManager.tileSize + example[1][1],
              ]
              const ev = new MouseEvent("click", {
                "bubbles": true, "cancelable": true,
                "clientX": cliC[0] + (exW[0] - refW[0]) * pxPerW,
                "clientY": cliC[1] + (exW[1] - refW[1]) * pxPerW,
                "button": 0
              });
              canvas.dispatchEvent(ev);
            }
          }, wplaceBad ? 10000 : 0);
        }

        // Attempts to find the "Paint Pixel" element for anchoring
        const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

        paintPixel.parentNode?.appendChild(paint); // Adds the paint button
      }
    };

    // Hook color change to force refresh
    Array.from(black.parentNode.parentNode.getElementsByTagName('button')).forEach((button) => {
      // seems that the color selected button will remove all classes once clicked, so we hook the parent
      if (button.parentElement.classList.contains("bm-hooked")) {
        return;
      }
      button.addEventListener('click', function () {
        if (templateManager.isOnlyCurrentColorShown()) {
          // prevent lagging
          setTimeout(() => {
            templateManager.createOverlayOnMap()
            if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
              forceRefreshTiles();
            };
            // Just build the list (with the selected color toggled) as nothing has changed
            buildColorFilterList();
          }, 0);
        };
      });
      button.parentElement.classList.add("bm-hooked");
    })
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

const persistCoords = () => {
  try {
    const [[tx, ty], [px, py]] = getOverlayCoords();
    const data = { tx, ty, px, py };
    GM.setValue('bmCoords', JSON.stringify(data));
  } catch (_) {}
};

const teleportCoords = () => {
  try {
    const [[tx, ty], [px, py]] = getOverlayCoords();
    teleportToTileCoords([tx, ty], [px, py]);
  } catch (_) {}
};

/** Deploys the overlay to the page with minimize/maximize functionality.
 * Creates a responsive overlay UI that can toggle between full-featured and minimized states.
 * 
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 * Changed to async since 0.85.17
 */
async function buildOverlayMain() {
  let isMinimized = false; // Overlay state tracker (false = maximized, true = minimized)
  // Load last saved coordinates (if any)
  let savedCoords = {};
  const savedCoordsValue = await GM.getValue('bmCoords', '{}');
  try {
    savedCoords = JSON.parse(savedCoordsValue) || {};
  } catch {
    savedCoords = {};
  }
  
  overlayMain.addDiv({'id': 'bm-overlay', 'style': 'top: 10px; right: 75px;'})
    .addDiv({'id': 'bm-contain-header'})
      .addDiv({'id': 'bm-bar-drag'}).buildElement()
      .addImg({'alt': 'Rus Marble Icon - Click to minimize/maximize', 'src': 'https://raw.githubusercontent.com/korobkakonfet/rusmarble/custom-improve/dist/assets/logo_rusmarble.png', 'style': 'cursor: pointer;'},
        (instance, img) => {
          /** Click event handler for overlay minimize/maximize functionality.
           * 
           * Toggles between two distinct UI states:
           * 1. MINIMIZED STATE (60Ã—76px):
           *    - Shows only the Rus Marble icon and drag bar
           *    - Hides all input fields, buttons, and status information
           *    - Applies fixed dimensions for consistent appearance
           *    - Repositions icon with 3px right offset for visual centering
           * 
           * 2. MAXIMIZED STATE (responsive):
           *    - Restores full functionality with all UI elements
           *    - Removes fixed dimensions to allow responsive behavior
           *    - Resets icon positioning to default alignment
           *    - Shows success message when returning to maximized state
           * 
           * @param {Event} event - The click event object (implicit)
           */
          img.addEventListener('click', () => {
            isMinimized = !isMinimized; // Toggle the current state

            const overlay = document.querySelector('#bm-overlay');
            const header = document.querySelector('#bm-contain-header');
            const dragBar = document.querySelector('#bm-bar-drag');
            const coordsContainer = document.querySelector('#bm-contain-coords');
            const coordsButton = document.querySelector('#bm-button-coords');
            const createButton = document.querySelector('#bm-button-create');
            const enableButton = document.querySelector('#bm-button-enable');
            const disableButton = document.querySelector('#bm-button-disable');
            const eventContainer = document.querySelector('#bm-contain-eventitem');
            const coordInputs = document.querySelectorAll('#bm-contain-coords input');
            const statusTextbox = document.getElementById(instance.outputStatusId); // Status log textarea for user feedback
            
            // Pre-restore original dimensions when switching to maximized state
            // This ensures smooth transition and prevents layout issues
            if (!isMinimized) {
              overlay.style.width = "auto";
              overlay.style.maxWidth = "300px";
              overlay.style.minWidth = "200px";
              overlay.style.padding = "10px";
            }
            
            // Define elements that should be hidden/shown during state transitions
            // Each element is documented with its purpose for maintainability
            const elementsToToggle = [
              '#bm-overlay h1',                    // Main title "Rus Marble"
              '#bm-contain-userinfo',              // User information section (username, droplets, level)
              '#bm-overlay hr',                    // Visual separator lines
              '#bm-contain-automation > *:not(#bm-contain-coords)', // Automation section excluding coordinates
              '#bm-contain-buttons-action',        // Action buttons container
            ];
            
            // Apply visibility changes to all toggleable elements
            elementsToToggle.forEach(selector => {
              const elements = document.querySelectorAll(selector);
              elements.forEach(element => {
                element.style.display = isMinimized ? 'none' : '';
              });
            });
            // Handle coordinate container and button visibility based on state
            if (isMinimized) {
              // ==================== MINIMIZED STATE CONFIGURATION ====================
              // In minimized state, we hide ALL interactive elements except the icon and drag bar
              // This creates a clean, unobtrusive interface that maintains only essential functionality
              
              // Hide coordinate input container completely
              if (coordsContainer) {
                coordsContainer.style.display = 'none';
              }
              
              // Hide coordinate button (pin icon)
              if (coordsButton) {
                coordsButton.style.display = 'none';
              }
              
              // Hide create template button
              if (createButton) {
                createButton.style.display = 'none';
              }

              // Hide enable templates button
              if (enableButton) {
                enableButton.style.display = 'none';
              }

              // Hide disable templates button
              if (disableButton) {
                disableButton.style.display = 'none';
              }

              // Hide bm-contain-eventitem
              if (templateManager.isEventEnabled()) {
                eventContainer.style.display = 'none';
              }
              
              // Hide status textarea
              if (!templateManager.isStatusHidden()) {
                statusTextbox.style.display = 'none';
              }

              // Hide all coordinate input fields individually (failsafe)
              coordInputs.forEach(input => {
                input.style.display = 'none';
              });
              
              // Apply fixed dimensions for consistent minimized appearance
              // These dimensions were chosen to accommodate the icon while remaining compact
              overlay.style.width = '60px';    // Fixed width for consistency
              overlay.style.height = '76px';   // Fixed height (60px + 16px for better proportions)
              overlay.style.maxWidth = '60px';  // Prevent expansion
              overlay.style.minWidth = '60px';  // Prevent shrinking
              overlay.style.padding = '8px';    // Comfortable padding around icon
              
              // Apply icon positioning for better visual centering in minimized state
              // The 3px offset compensates for visual weight distribution
              img.style.marginLeft = '3px';
              
              // Configure header layout for minimized state
              header.style.textAlign = 'center';
              header.style.margin = '0';
              header.style.marginBottom = '0';
              
              // Ensure drag bar remains visible and properly spaced
              if (dragBar) {
                dragBar.style.display = '';
                dragBar.style.marginBottom = '0.35em';
              }
            } else {
              // ==================== MAXIMIZED STATE RESTORATION ====================
              // In maximized state, we restore all elements to their default functionality
              // This involves clearing all style overrides applied during minimization
              
              // Restore coordinate container to default state
              if (coordsContainer) {
                coordsContainer.style.display = '';           // Show container
                coordsContainer.style.flexDirection = '';     // Reset flex layout
                coordsContainer.style.justifyContent = '';    // Reset alignment
                coordsContainer.style.alignItems = '';        // Reset alignment
                coordsContainer.style.gap = '';               // Reset spacing
                coordsContainer.style.textAlign = '';         // Reset text alignment
                coordsContainer.style.margin = '';            // Reset margins
              }
              
              // Restore coordinate button visibility
              if (coordsButton) {
                coordsButton.style.display = '';
              }
              
              // Restore create button visibility and reset positioning
              if (createButton) {
                createButton.style.display = '';
                createButton.style.marginTop = '';
              }

              // Restore enable button visibility and reset positioning
              if (enableButton) {
                enableButton.style.display = '';
                enableButton.style.marginTop = '';
              }

              // Restore disable button visibility and reset positioning
              if (disableButton) {
                disableButton.style.display = '';
                disableButton.style.marginTop = '';
              }

              // Restore bm-contain-eventitem
              if (templateManager.isEventEnabled()) {
                eventContainer.style.display = '';
              } else {
                eventContainer.style.display = 'none'; // eventManager itself matches #bm-contain-automation > *:not(#bm-contain-coords)
              }
              
              // Restore status textarea
              if (!templateManager.isStatusHidden()) {
                statusTextbox.style.display = '';
              } else {
                statusTextbox.style.display = 'none'; // statusTextbox itself matches #bm-contain-automation > *:not(#bm-contain-coords)
              }
              
              // Restore all coordinate input fields
              coordInputs.forEach(input => {
                input.style.display = '';
              });
              
              // Reset icon positioning to default (remove minimized state offset)
              img.style.marginLeft = '';
              
              // Restore overlay to responsive dimensions
              overlay.style.padding = '10px';
              
              // Reset header styling to defaults
              header.style.textAlign = '';
              header.style.margin = '';
              header.style.marginBottom = '';
              
              // Reset drag bar spacing
              if (dragBar) {
                dragBar.style.marginBottom = '0.65em';
              }
              
              // Remove all fixed dimensions to allow responsive behavior
              // This ensures the overlay can adapt to content changes
              overlay.style.width = '';
              overlay.style.height = '';
            }
            
            // ==================== ACCESSIBILITY AND USER FEEDBACK ====================
            // Update accessibility information for screen readers and tooltips
            
            // Update alt text to reflect current state for screen readers and tooltips
            img.alt = isMinimized ? 
              'Rus Marble Icon - Minimized (Click to maximize)' : 
              'Rus Marble Icon - Maximized (Click to minimize)';
            
            // No status message needed - state change is visually obvious to users
          });
        }
      ).buildElement()
      .addHeader(1, {'textContent': name})
        .addSmall({'textContent': ` v${version}`}).buildElement()
      .buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-userinfo'})
      .addP({'textContent': 'Username: '})
        .addB({'id': 'bm-user-name'}).buildElement()
      .buildElement()
      .addP({'id': 'bm-user-charges'}, (_, element) => {
        element.setAttribute('aria-live', 'polite');
      })
        .addText('Full Charges in ')
        .addSpan({'className': 'bm-charge-countdown', 'textContent': '--:--'}, (_, element) => {
          element.dataset.role = 'countdown';
        }).buildElement()
        .addText(' ')
        .addSpan({'className': 'bm-charge-count', 'textContent': '(0 / 0)'}, (_, element) => {
          element.dataset.role = 'charge-count';
        }).buildElement()
      .buildElement()
      .addP({'id': 'bm-user-suspend', 'style': 'display: none;'}, (_, element) => {
        element.setAttribute('aria-live', 'polite');
      })
        .addText('Suspension Expires in ')
        .addSpan({'className': 'bm-suspend-countdown', 'textContent': '--:--'}, (_, element) => {
          element.dataset.role = 'suspend-countdown';
        }).buildElement()
      .buildElement()
      .addP({'id': 'bm-user-suspend-reason', 'textContent': 'Reason: ', 'style': 'display: none;'})
        .addB({'id': 'bm-suspend-reason', 'textContent': 'Unknown'}).buildElement()
      .buildElement()
        .addP({'id': 'bm-user-droplets-row', 'textContent': 'Droplets: '}, (_, element) => {
          if (templateManager.isDropletsHidden()) {
            element.style.display = 'none';
          }
        })
          .addB({'id': 'bm-user-droplets'}).buildElement()
        .buildElement()
        .addP({'id': 'bm-user-nextlevel-row'}, (_, element) => {
          if (templateManager.isNextLevelHidden()) {
            element.style.display = 'none';
          }
        })
          .addB({'id': 'bm-user-nextpixel', 'textContent': '--'}).buildElement()
          .addText(' more pixel')
        .addSpan({'id': 'bm-user-nextpixel-plural', 'textContent': 's'}).buildElement()
        .addText(' to Lv. ')
        .addB({'id': 'bm-user-nextlevel', 'textContent': '--'}).buildElement()
      .buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-automation'})
      // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
      // .addBr().buildElement()
      // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
      // .addBr().buildElement()
      .addDiv({'id': 'bm-contain-coords'})
        .addButton({'id': 'bm-button-coords', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>'},
          (instance, button) => {
            button.onclick = () => {
              const coords = instance.apiManager?.coordsTilePixel; // Retrieves the coords from the API manager
              const emptyIfUndefined = value => value ?? "";
              if (coords?.[0] === undefined) {
                instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
                return;
              }
              instance.updateInnerHTML('bm-input-tx', emptyIfUndefined(coords?.[0]));
              instance.updateInnerHTML('bm-input-ty', emptyIfUndefined(coords?.[1]));
              instance.updateInnerHTML('bm-input-px', emptyIfUndefined(coords?.[2]));
              instance.updateInnerHTML('bm-input-py', emptyIfUndefined(coords?.[3]));
              apiManager.updateDownloadButton();
              persistCoords();
            }
          }
        ).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.tx ?? '')}, (instance, input) => {
          //if a paste happens on tx, split and format it into other coordinates if possible
          input.addEventListener("paste", (event) => {
            const clipboardText = (event.clipboardData || window.clipboardData).getData("text");

            const matchResult = [
              /^\s*([012]?\d{1,3}),\s*([012]?\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\s*$/, // comma-separated
              /^\s*([012]?\d{1,3})\s+([012]?\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/, // space-separated
              /^\s*\(?Tl X: ([012]?\d{1,3}), Tl Y: ([012]?\d{1,3}), Px X: (\d{1,3}), Px Y: (\d{1,3})\)?\s*$/, // display format
            ].map(r => r.exec(clipboardText)).filter(r => r).pop(); //find the regex that matches the clipboard text

            if (matchResult === undefined) { // If we don't have 4 clean coordinates, end the function.
              return;
            }
            // let splitText = clipboardText.split(" ").filter(n => n).map(Number).filter(n => !isNaN(n)); //split and filter all Non Numbers

            // if (splitText.length !== 4 ) { // If we don't have 4 clean coordinates, end the function.
            //   return;
            // }

            let splitText = matchResult.slice(1).map(Number);

            let coords = selectAllCoordinateInputs(document); 

            for (let i = 0; i < coords.length; i++) { 
              coords[i].value = splitText[i]; //add the split vales
            }

            apiManager.updateDownloadButton();
            persistCoords();

            event.preventDefault(); //prevent the pasting of the original paste that would overide the split value
          })
          const handler = () => (apiManager.updateDownloadButton(), persistCoords());
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.ty ?? '')}, (instance, input) => {
          const handler = () => (apiManager.updateDownloadButton(), persistCoords());
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.px ?? '')}, (instance, input) => {
          const handler = () => (apiManager.updateDownloadButton(), persistCoords());
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.py ?? '')}, (instance, input) => {
          const handler = () => (apiManager.updateDownloadButton(), persistCoords());
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
        .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '✈️', 'title': 'Teleport'},
          (instance, button) => {
            button.onclick = () => {
              teleportCoords();
            }
          }
        ).buildElement()
      .buildElement();

    buildUserSettingsSection({
      overlay: overlayMain,
      templateManager,
      apiManager,
      layoutThemeOptions,
      templateDisplayOptions,
      normalizeLayoutTheme,
      normalizeTemplateDisplay,
      applyLayoutTheme,
      forceUpdateTheme: () => forceUpdateTheme(),
      buildColorFilterList: () => buildColorFilterList(),
      buildTemplateFilterList: () => buildTemplateFilterList(),
      buildEventList: () => buildEventList(),
      forceRefreshTiles,
      removeLayer,
      themeList,
      outputStatusId: overlayMain.outputStatusId,
    });

    overlayMain
      .addDetails({'id': 'bm-contain-colorfilter', 'textContent': 'Colors', 'style': 'border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;'}, (instance, summary, details) => {
        details.open = true;
      })
        // Color sorting
        .addP({'textContent': 'Sort Colors by ', 'style': 'font-size: small; margin-top: 3px; margin-left: 5px;'})
          // Sorting UI
          .addSelect({'id': 'bm-color-sort'}, (instance, select) => {
            const order = [
              "Asc", "Desc"
            ]
            const currentSortBy = templateManager.getSortBy();
            Object.keys(sortByOptions).forEach(o => {
              order.forEach(o2 => {
                const option = document.createElement('option');
                option.value = `${o.toLowerCase()}-${o2.toLowerCase()}`;
                option.textContent = `${o[0].toUpperCase() + o.slice(1).toLowerCase()} (${o2}.)`;
                if (option.value === currentSortBy) { option.selected = true; }
                select.appendChild(option);
              })
            });
            select.addEventListener('change', () => {
              templateManager.setSortBy(select.value);
              buildColorFilterList();
              const parts = select.value.split('-');
              instance.handleDisplayStatus(`Changed the sort criteria to "${parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase()}" in ${parts[1]}ending order.`);
            })
          }).buildElement()
        .buildElement()
        // Color buttons
        .addDiv({'id': 'bm-button-colors-container', 'style': 'display: flex; gap: 6px; margin-top: 3px; margin-bottom: 3px;'})
          .addButton({'id': 'bm-button-colors-enable-all', 'textContent': 'Enable All'}, (instance, button) => {
            button.onclick = () => {
              templateManager.templatesArray.forEach(t => {
                if (!t?.colorPalette) { return; }
                Object.values(t.colorPalette).forEach(v => v.enabled = true);
              })
              syncToggleList();
              templateManager.createOverlayOnMapVisibleFirst();
              buildColorFilterList();
              instance.handleDisplayStatus('Enabled all colors');
              if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
                forceRefreshTiles();
              };
            };
          }).buildElement()
          .addButton({'id': 'bm-button-colors-disable-all', 'textContent': 'Disable All'}, (instance, button) => {
            button.onclick = () => {
              templateManager.templatesArray.forEach(t => {
                if (!t?.colorPalette) { return; }
                Object.values(t.colorPalette).forEach(v => v.enabled = false);
              })
              syncToggleList();
              removeLayer("overlay");
              templateManager.createOverlayOnMapVisibleFirst();
              buildColorFilterList();
              instance.handleDisplayStatus('Disabled all colors');
              if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
                forceRefreshTiles();
              };
            };
          }).buildElement()
          .addButton({'id': 'bm-button-colors-disable-paid', 'textContent': 'Disable Paid'}, (instance, button) => {
            button.onclick = () => {
              templateManager.templatesArray.forEach(t => {
                if (!t?.colorPalette) { return; }
                Object.entries(t.colorPalette).forEach(([rgb, value]) => {
                  const meta = rgbToMeta.get(rgb);
                  const colorId = Number(meta?.id);
                  if (Number.isFinite(colorId) && colorId >= 32) {
                    value.enabled = false;
                  }
                });
              });
              syncToggleList();
              templateManager.createOverlayOnMapVisibleFirst();
              buildColorFilterList();
              instance.handleDisplayStatus('Disabled paid colors');
              if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
                forceRefreshTiles();
              };
            };
          }).buildElement()
        .buildElement()
        .addDiv({'id': 'bm-colorfilter-list', 'style': 'max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;'}).buildElement()
      .buildElement()
      // Template filter UI
      .addDetails({'id': 'bm-contain-templatefilter', 'textContent': 'Templates', 'style': 'border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;'}, (instance, summary, details) => {
        details.open = true;
      })
        // Template buttons
        .addDiv({'id': 'bm-contain-buttons-template', 'style': 'margin-bottom: 3px;'})
          .addInputFile({'id': 'bm-input-file-template', 'textContent': 'Select Img', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif'}) // .buildElement()
          .addButton({'id': 'bm-button-create', 'textContent': 'Create', 'style': 'margin: 0 1ch;'}, (instance, button) => {
            button.onclick = async () => {
              const input = document.querySelector('#bm-input-file-template');

              const coordTlX = document.querySelector('#bm-input-tx');
              if (!coordTlX.checkValidity()) {coordTlX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
              const coordTlY = document.querySelector('#bm-input-ty');
              if (!coordTlY.checkValidity()) {coordTlY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
              const coordPxX = document.querySelector('#bm-input-px');
              if (!coordPxX.checkValidity()) {coordPxX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
              const coordPxY = document.querySelector('#bm-input-py');
              if (!coordPxY.checkValidity()) {coordPxY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}

              // Kills itself if there is no file
              if (!input?.files[0]) {instance.handleDisplayError(`No file selected!`); return;}

              await templateManager.createTemplate(
                input.files[0],
                input.files[0]?.name.replace(/\.[^/.]+$/, ''),
                [
                  Number(coordTlX.value),
                  Number(coordTlY.value),
                  Number(coordPxX.value),
                  Number(coordPxY.value),
                ],
                templateManager.getAnchor()
              );

              // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
              // apiManager.templateCoordsTilePixel = apiManager.coordsTilePixel; // Update template coords
              // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
              // templateManager.setTemplateImage(input.files[0]);

              instance.handleDisplayStatus(`Drew to canvas!`);
            }
            }).buildElement()
          .addButton({'id': 'bm-button-sync-templates', 'textContent': '🔄'}, (instance, button) => {
            button.style.position = 'relative';
            button.style.overflow = 'visible';
            const badge = document.createElement('span');
            badge.id = 'bm-sync-templates-badge';
            badge.className = 'bm-sync-badge';
            badge.style.display = 'none';
            button.appendChild(badge);
            button.onclick = async () => {
              try {
                await templateSync.syncTemplatesFromServer({
                  onStatus: (message) => instance.handleDisplayStatus(message),
                  onError: (message) => instance.handleDisplayError(message),
                  syncToggleList: () => window.syncToggleList?.(),
                  buildTemplateFilterList: () => window.buildTemplateFilterList?.(),
                  buildColorFilterList: () => window.buildColorFilterList?.(),
                });
              } catch (err) {
                // Error already reported in the sync helper.
              }
              };
            }).buildElement()
            .addSelect({'id': 'bm-template-anchor'}, (instance, select) => {
            const anchors = {
              "lt": "⟔",
              "mt": "⨪",
              "rt": "ᒬ",
              "lm": "꜏",
              "mm": "⊡",
              "rm": "꜊",
              "lb": "Ŀ",
              "mb": "∸",
              "rb": "⟓",
            };
            const anchorTextX = {
              "l": "Left",
              "m": "Center",
              "r": "Right",
            };
            const anchorTextY = {
              "t": "Top",
              "m": "Middle",
              "b": "Bottom",
            };
            const currentAnchor = templateManager.getAnchor();
            Object.entries(anchors).forEach(([anchor, displayText]) => {
              const option = document.createElement('option');
              option.value = anchor;
              option.textContent = displayText;
              if (anchor === currentAnchor) { option.selected = true; }
              select.appendChild(option);
            });
            select.addEventListener('change', () => {
              templateManager.setAnchor(select.value);
              instance.handleDisplayStatus(`Changed the default template anchor to "${anchorTextY[select.value[1]]} ${anchorTextX[select.value[0]]}".`);
            })
          }).buildElement()
        .buildElement()
        .addDiv({'id': 'bm-templatefilter-list', 'style': 'max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;'}).buildElement()
        .buildElement()
        // Chat UI
      .addDetails({'id': 'bm-contain-chat', 'textContent': 'Chat', 'style': 'border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;'}, (instance, summary, details) => {
          details.open = false;
        })
          .addDiv({'id': 'bm-chat-mod-tools', 'style': 'display: none; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 4px;'})
            .addSelect({'id': 'bm-chat-ban-type', 'style': 'width: 8ch;'}, (instance, select) => {
              const optIp = document.createElement('option');
              optIp.value = 'ip';
              optIp.textContent = 'IP';
              const optDevice = document.createElement('option');
              optDevice.value = 'device';
              optDevice.textContent = 'Device';
              select.appendChild(optIp);
              select.appendChild(optDevice);
            }).buildElement()
            .addInput({'type': 'text', 'id': 'bm-chat-ban-target', 'placeholder': 'IP / device id / msg id', 'maxlength': 64, 'style': 'width: 18ch;'}).buildElement()
            .addButton({'id': 'bm-chat-ban-btn', 'textContent': 'Ban', 'style': 'font-size: 11px; padding: 0 6px;'}).buildElement()
            .addButton({'id': 'bm-chat-unban-btn', 'textContent': 'Unban', 'style': 'font-size: 11px; padding: 0 6px;'}).buildElement()
            .addButton({'id': 'bm-chat-bans-btn', 'textContent': 'Bans', 'style': 'font-size: 11px; padding: 0 6px;'}).buildElement()
          .buildElement()
          .addDiv({'id': 'bm-chat-messages', 'style': 'max-height: 120px; overflow-y: auto; border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-bottom: 4px;'}).buildElement()
          .addDiv({'id': 'bm-chat-reply', 'style': 'display: none; border-left: 3px solid var(--bm-chat-reply-border); padding: 4px 6px; margin-bottom: 4px; border-radius: 4px; background: var(--bm-chat-reply-bg);'})
            .addSpan({'id': 'bm-chat-reply-label', 'textContent': 'Replying to'}).buildElement()
            .addSpan({'id': 'bm-chat-reply-text', 'style': 'display: block; font-size: 11px; color: var(--bm-muted);'}).buildElement()
            .addButton({'id': 'bm-chat-reply-clear', 'textContent': '✖', 'style': 'float: right; font-size: 10px; padding: 0 4px;'}).buildElement()
          .buildElement()
          .addDiv({'id': 'bm-chat-input-row', 'style': 'display: flex; gap: 4px; align-items: center;'})
            .addInput({'type': 'text', 'id': 'bm-chat-user', 'placeholder': 'User', 'maxlength': CHAT_MAX_USER_LEN, 'style': 'width: 12ch;'}).buildElement()
            .addInput({'type': 'password', 'id': 'bm-chat-modcode', 'placeholder': 'Code', 'maxlength': 64, 'style': 'width: 8ch; display: none;'}).buildElement()
            .addInput({'type': 'text', 'id': 'bm-chat-text', 'placeholder': 'Message', 'maxlength': CHAT_MAX_TEXT_LEN, 'style': 'flex: 1;'}).buildElement()
          .buildElement()
        .buildElement()
      // Event UI
      .addDetails({'id': 'bm-contain-eventitem', 'textContent': 'Event', 'style': 'border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; display: none; margin-top: 4px;'}, (instance, summary, details) => {
        if (templateManager.isEventEnabled()) {
          details.style.display = '';
        }
        details.open = true;
      })
        .addButton({'id': 'bm-button-set-eventprovider', 'textContent': 'Set Data Provider', 'style': 'margin: 0 1ch;'}, (instance, button) => {
          button.onclick = () => {
            const currentProvider = templateManager.getEventProvider();
            const providerURL = prompt('Enter the event data provider JSON URL:', currentProvider === "" ? "https://wplace.samuelscheit.com/tiles/pumpkin.json" : currentProvider);
            if (!providerURL) { return; }
            const isUrl = (content => {
              try { return Boolean(new URL(content)); }
              catch(e){ return false; }
            })(providerURL);
            if (!isUrl) {
              alert("The URL you entered is not valid!");
              return;
            }
            templateManager.setEventProvider(providerURL);
            buildEventList();
          };
        }).buildElement()
        .addButton({'id': 'bm-button-refresh-event', 'textContent': 'Refresh Data', 'style': 'margin: 0 1ch;'}, (instance, button) => {
          button.onclick = () => buildEventList();
        }).buildElement()
        .addDiv({'id': 'bm-eventitem-list', 'style': 'max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;'}).buildElement()
      .buildElement()
      // Status
      .addTextarea({'id': overlayMain.outputStatusId, 'placeholder': `Status: Sleeping...\nVersion: ${version}`, 'readOnly': true}, (instance, textarea) => {
        if (templateManager.isStatusHidden()) {
          textarea.style.display = 'none';
        }
      }).buildElement()
      .addDiv({'id': 'bm-contain-buttons-action'})
        .addDiv()
          // .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'textContent': '✈'}).buildElement()
          // .addButton({'id': 'bm-button-favorite', 'className': 'bm-help', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon points="10,2 12,7.5 18,7.5 13.5,11.5 15.5,18 10,14 4.5,18 6.5,11.5 2,7.5 8,7.5" fill="white"></polygon></svg>'}).buildElement()
          // .addButton({'id': 'bm-button-templates', 'className': 'bm-help', 'innerHTML': '🖌'}).buildElement()
          .addButton({'id': 'bm-button-convert', 'className': 'bm-help', 'innerHTML': '🎨', 'title': 'Template Color Converter'}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
          .addButton({'id': 'bm-button-website', 'className': 'bm-help', 'innerHTML': '🌐', 'title': 'Official Rus Marble Website'}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://t.me/ruswplace', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
        .buildElement()
        .addDiv({'id': 'bm-footer'})
          .addSmall({'textContent': `Forked by korobka_konfet`, 'title': 'by SwingTheVine | Forked by TWY | Forked by korobka_konfet', 'style': 'margin-top: auto;'}).buildElement()
        .buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay(document.body);

  applyLayoutTheme(templateManager.getLayoutTheme());

  // ------- Helper: Build the color filter list -------
  const syncToggleList = () => {
    try {
      (templateManager.templatesArray ?? []).forEach(t => {
        const key = t.storageKey;
        if (key && templateManager.templatesJSON?.templates?.[key]) {
          const templateJSON = templateManager.templatesJSON.templates[key]
          templateJSON.enabled = t.enabled;
          templateJSON.palette = t.colorPalette;
        }
      })
      // persist immediately
      templateManager.storeTemplates();
    } catch (_) {};
  };
  window.syncToggleList = syncToggleList;

  const buildColorFilterList = () => {
    const listContainer = document.querySelector('#bm-colorfilter-list');
    const toggleStatus = templateManager.getPaletteToggledStatus();
    const hideCompleted = templateManager.areCompletedColorsHidden();
    const hideLocked = templateManager.areLockedColorsHidden();
    listContainer.innerHTML = '';

    const { paletteSum, combinedProgress } = templateManager.getOverallPerColorProgress();

    if (!listContainer || !(Object.keys(paletteSum).length)) {
      if (listContainer) { listContainer.innerHTML = '<small>No template colors to display.</small>'; }
      return;
    }

    const sortBy = templateManager.getSortBy();
    const sortByParts = sortBy.split('-');
    const keyFunction = sortByOptions[sortByParts[0]];

    const compareFunction = (
      sortByParts[1] === "asc" ?
        (a,b) => keyFunction(a) - keyFunction(b) :
        (a,b) => keyFunction(b) - keyFunction(a)
    );

    const paletteSumSorted = Object.entries(paletteSum)
      .map(([rgb, count]) => [rgb, combinedProgress[rgb]?.paintedAndEnabled ?? 0, count])
      .sort(compareFunction); // sort by frequency desc

    let hasColors = false;
    for (const [rgb, paintedCount, totalCount] of paletteSumSorted) {
      if (hideLocked && rgb === 'other') continue;
      if (hideCompleted && paintedCount === totalCount) continue;
      let row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      let swatch = document.createElement('div');
      swatch.style.width = '14px';
      swatch.style.height = '14px';
      swatch.style.border = '1px solid var(--bm-border-strong)';

      let colorName = '';
      let colorKey = '';
      const tMeta = rgbToMeta.get(rgb);
      // Special handling for "other" and "transparent"
      if (rgb === 'other') {
        swatch.style.background = '#888'; // Neutral color for "Other"
        colorName = "Other";
        colorKey = "other";
      } else if (rgb === '#deface') {
        swatch.style.background = '#deface';
        colorName = "Transparent";
        colorKey = "transparent";
      } else {
        const [r, g, b] = rgb.split(',').map(Number);
        swatch.style.background = `rgb(${r},${g},${b})`;
        try {
          if (tMeta && typeof tMeta.id === 'number') {
            if (hideLocked && !templateManager.isColorUnlocked(tMeta.id)) continue;
            const displayName = tMeta?.name || `rgb(${r},${g},${b})`;
            // const starLeft = tMeta.premium ? '★ ' : '';
            // colorName = `#${tMeta.id} ${starLeft}${displayName}`;
            if (tMeta.premium) {
              swatch.style.borderColor = "gold";
              swatch.style.boxShadow = "0 0 2px yellow";
            }
            colorName = `${displayName}`;
            colorKey = `${r},${g},${b}`;
          }
        } catch (ignored) {}
      }

      let label = document.createElement('span');
      label.style.fontSize = '12px';

      if (sortByParts[0] === "remaining" || (hideCompleted && sortByParts[0] !== "painted")) {
        const remainingLabelText = (totalCount - paintedCount).toLocaleString();
        label.textContent = `${colorName} • ${remainingLabelText} Left`;
      } else {
        const labelText = totalCount.toLocaleString();
        const paintedLabelText = paintedCount.toLocaleString();
        label.textContent = `${colorName} • ${paintedLabelText} / ${labelText}`;
      }

      if (templateManager.isProgressBarEnabled()) {
        const percentageProgress = paintedCount / (totalCount === 0 ? 1 : totalCount) * 100;
        row.style.background = `linear-gradient(to right, rgb(0, 128, 0, 0.8) 0%, rgb(0, 128, 0, 0.8) ${percentageProgress}%, transparent ${percentageProgress}%, transparent 100%)`;
      }

      const paletteEntry = combinedProgress[colorKey];
      let currentIndex = 0;
      swatch.addEventListener('click', () => {
        // if ((paletteEntry?.examples?.length ?? 0) > 0) {
        if ((paletteEntry?.examplesEnabled?.length ?? 0) > 0) {
          // const examples = paletteEntry.examples;
          const examples = paletteEntry.examplesEnabled;
          // const exampleIndex = Math.floor(Math.random() * examples.length);
          const exampleIndex = currentIndex % examples.length;
          teleportToTileCoords(examples[exampleIndex][0], examples[exampleIndex][1]);
          ++currentIndex;
        }
      });
      // if ((paletteEntry?.examples?.length ?? 0) > 0) {
      if ((paletteEntry?.examplesEnabled?.length ?? 0) > 0) {
        swatch.style["cursor"] = "pointer";
      };

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      if (templateManager.isOnlyCurrentColorShown()) {
        toggle.checked = tMeta?.id === getCurrentColor();
        toggle.disabled = true;
      } else {
        toggle.checked = toggleStatus[rgb] ?? true;
      }
      toggle.addEventListener('change', () => {
        (templateManager.templatesArray ?? []).forEach(template => {
          if (!template?.colorPalette) return;
          if (template.colorPalette[rgb] !== undefined) {
            template.colorPalette[rgb].enabled = toggle.checked;
          }
        })
        overlayMain.handleDisplayStatus(`${toggle.checked ? 'Enabled' : 'Disabled'} ${rgb}`);
        syncToggleList();
        templateManager.createOverlayOnMapVisibleFirst();
        if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
          forceRefreshTiles();
        };
      });

      row.appendChild(toggle);
      row.appendChild(swatch);
      row.appendChild(label);
      listContainer.appendChild(row);
      hasColors = true;
    }
    if (!hasColors && listContainer) {
      if (hideLocked) {
        if (hideCompleted) {
          listContainer.innerHTML = '<small>All owned colors have been completed.</small>';
        } else {
          listContainer.innerHTML = '<small>Remaining colors are all locked.</small>';
        }
      } else { // hideCompleted
        listContainer.innerHTML = '<small>All colors have been completed.</small>';
      }
    }
  };
  window.buildColorFilterList = buildColorFilterList;

  const buildTemplateFilterList = () => {
    const listContainer = document.querySelector('#bm-templatefilter-list');
    consoleLog(templateManager);
    if (templateManager.templatesArray?.length === 0) {
      if (listContainer) { listContainer.innerHTML = '<small>No templates to display.</small>'; }
      return;
    }

    listContainer.innerHTML = '';
      const entries = templateManager.templatesArray;
      const entriesIndexed = entries.map((t, idx) => ({ t, idx }));
      entriesIndexed.sort((a, b) => {
        const aStore = templateManager.templatesJSON?.templates?.[a.t.storageKey] ?? {};
        const bStore = templateManager.templatesJSON?.templates?.[b.t.storageKey] ?? {};
        const aStoreRemote = aStore.remote === true;
        const bStoreRemote = bStore.remote === true;
        const aIsRemote = a.t.isRemote === true || aStoreRemote;
        const bIsRemote = b.t.isRemote === true || bStoreRemote;
        const aTop = normalizeFlag(a.t.remoteToTop) || normalizeFlag(aStore.remoteToTop);
        const bTop = normalizeFlag(b.t.remoteToTop) || normalizeFlag(bStore.remoteToTop);
        const aGroup = aTop ? 0 : (aIsRemote ? 2 : 1);
        const bGroup = bTop ? 0 : (bIsRemote ? 2 : 1);
        if (aGroup !== bGroup) return aGroup - bGroup;
        if (aGroup === 1) return a.idx - b.idx;
        const aOrder = normalizeRemoteOrder(
          Number.isFinite(a.t.remoteOrder) ? a.t.remoteOrder : aStore.remoteOrder
        );
        const bOrder = normalizeRemoteOrder(
          Number.isFinite(b.t.remoteOrder) ? b.t.remoteOrder : bStore.remoteOrder
        );
        const aOrderValue = aOrder === null ? Number.MAX_SAFE_INTEGER : aOrder;
        const bOrderValue = bOrder === null ? Number.MAX_SAFE_INTEGER : bOrder;
        if (aOrderValue !== bOrderValue) return aOrderValue - bOrderValue;
        return a.idx - b.idx;
      });

    const templateEnabledState = Object.fromEntries(
      (templateManager.templatesArray ?? []).map(t => [t.storageKey, t.enabled ?? true])
    );
    const combinedTemplate = {};
    for (const stats of templateManager.tileProgress.values()) {
      Object.entries(stats.template).forEach(([storageKey, content]) => {
        if (templateEnabledState[storageKey] === false) return; // skip only when explicitly disabled
        if (combinedTemplate[storageKey] === undefined) {
          combinedTemplate[storageKey] = Object.fromEntries(Object.entries(content));
        } else {
          combinedTemplate[storageKey].painted += content.painted;
        }
      })
    };

      for (const entry of entriesIndexed) {
        const template = entry.t;
      let row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      let removeButton = document.createElement('a');
      removeButton.className = 'bm-icon-link';
      removeButton.title = "Remove template";
      removeButton.textContent = "🗑️";
      removeButton.style.fontSize = '12px';
      removeButton.onclick = () => {
        if (confirm(`Remove template ${template?.displayName}?`)) {
          templateManager.deleteTemplate(template?.storageKey);
        }
      }

      let teleportButton = document.createElement('a');
      teleportButton.className = 'bm-icon-link';
      teleportButton.title = "Teleport to template";
      teleportButton.textContent = "✈️";
      teleportButton.style.fontSize = '12px';
      teleportButton.onclick = () => {
        teleportToTileCoords(template.coords.slice(0, 2), template.coords.slice(2, 4));
      }

        let label = document.createElement('span');
        label.style.fontSize = '12px';
        const paletteTotal = template?.colorPalette
          ? Object.values(template.colorPalette).reduce((sum, meta) => sum + (Number(meta?.count) || 0), 0)
          : 0;
        const totalCount =
          Number(template.requiredPixelCount ?? template.pixelCount ?? paletteTotal) || 0;
        const totalLabelText = totalCount.toLocaleString();

        const templateName = template["displayName"];
        const templateStore = templateManager.templatesJSON?.templates?.[template.storageKey] ?? {};
        const isRemote = template.isRemote === true || templateStore.remote === true;
        const isHighlighted = normalizeFlag(template.remoteHighlighted) || normalizeFlag(templateStore.remoteHighlighted);
        const filledCount = combinedTemplate[template.storageKey]?.painted ?? 0;
        const filledLabelText = `${filledCount.toLocaleString()}`;
        const remainingCount = Math.max(0, totalCount - filledCount);
        const remainingLabelText = `${remainingCount.toLocaleString()}`;
        const showRemaining = templateManager.isTemplateListRemainingEnabled();
        const renameElement = document.createElement('span');
        renameElement.textContent = templateName;
        renameElement.className = "bm-templatename";
        renameElement.style.cursor = isRemote ? 'not-allowed' : 'text';
        renameElement.title = isRemote ? 'Remote templates cannot be renamed.' : 'Click to rename.';
        renameElement.addEventListener('click', () => {
        if (isRemote) {
          overlayMain.handleDisplayStatus('Remote templates cannot be renamed.');
          return;
        }
        if (renameElement.dataset.editing === 'true') { return; }
        renameElement.dataset.editing = 'true';
        const currentName = template["displayName"];
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'bm-template-rename-input';
        let finished = false;
        const finish = (shouldSave) => {
          if (finished) { return; }
          finished = true;
          const nextName = input.value.trim();
          label.replaceChild(renameElement, input);
          renameElement.dataset.editing = '';
          if (!shouldSave || !nextName || nextName === currentName) { return; }
          template["displayName"] = nextName;
          renameElement.textContent = nextName;
          try {
            const templateJSON = templateManager.templatesJSON?.templates?.[template.storageKey];
            if (templateJSON) {
              templateJSON.name = nextName;
              templateManager.storeTemplates();
            }
          } catch (_) {}
          buildTemplateFilterList();
        };
        label.replaceChild(input, renameElement);
        input.focus();
        input.select();
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
          }
        });
        input.addEventListener('blur', () => finish(true));
      });
        if (isRemote) {
          row.classList.add('bm-template-remote');
          const badge = document.createElement('span');
          badge.className = 'bm-remote-badge';
          badge.textContent = 'REMOTE';
          label.appendChild(badge);
        }
        if (isHighlighted) {
          row.classList.add('bm-template-highlight');
        }
      label.appendChild(renameElement);
      const countSpan = document.createElement('span');
      countSpan.className = 'bm-template-count';
      countSpan.textContent = showRemaining
        ? ` left ${remainingLabelText}`
        : ` • ${filledLabelText} / ${totalLabelText}`;
      label.appendChild(countSpan);

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = template.enabled;
      toggle.addEventListener('change', () => {
        template.enabled = toggle.checked;
        overlayMain.handleDisplayStatus(`${toggle.checked ? 'Enabled' : 'Disabled'} ${templateName}`);
        if (toggle.checked) {
          templateManager.createOverlayOnMap(template.sortID);
        } else {
          // reset related tiles if it is being toggled off
          // since the tile may not be involed in the template anymore
          templateManager.clearTileProgress(template);
          removeLayer(null, template.sortID);
        }
        syncToggleList();
        // The total count has changed from clearTileProgress, and that may be a template outside the current view, so we need to refresh
        buildColorFilterList();
        forceRefreshTiles();
      });

      row.appendChild(toggle);
      row.appendChild(removeButton);
      row.appendChild(teleportButton);
      row.appendChild(label);
      listContainer.appendChild(row);
    }
  };
  window.buildTemplateFilterList = buildTemplateFilterList;

  const buildEventList = () => {
    const listContainer = document.querySelector('#bm-eventitem-list');
    const showClaimed = templateManager.isEventClaimedShown();
    const showUnavailable = templateManager.isEventUnavailableShown();
    const provider = apiManager.eventDataURL ?? templateManager.getEventProvider();
    if (apiManager.eventClaimed === null) {
      listContainer.innerHTML = '<small>The event claimed items list is not loaded. Make sure you have clicked the ongoing Event button from the top left corner.</small>';
      return;
    };
    if (apiManager.eventData === null && (provider === null || provider == "")) {
      // rely on external sources
      listContainer.innerHTML = '<small>Event data provider is not set.</small>';
      return;
    };
    const eventClaimedList = new Set(apiManager.eventClaimed);
    consoleLog("eventClaimedList", eventClaimedList);
    // Format: e.g. https://wplace.samuelscheit.com/tiles/pumpkin.json
    (
      apiManager.eventData === null ?
      fetch(provider, {
        "credentials": "include",
      }).then(response => response.json()) :
      new Promise(resolve => {
        const consumed = apiManager.eventData;
        apiManager.eventData = null; // already consumed
        resolve(consumed);
      })
    ).then(data => {
      consoleLog("event Location data", data);
      if (typeof data !== 'object') {
        listContainer.innerHTML = '<small>The event data provider does not provide a known format.</small>';
        return;
      }
      listContainer.textContent = "";
      let hasEntries = false;
      const dataSource = (
        Array.isArray(data) ?
        data.map((entry, index) => [entry.id ?? index, entry]) :
        Object.entries(data)
      );
      dataSource.forEach(([itemId, info]) => {
        itemId = Number(itemId);
        const isClaimed = eventClaimedList.has(itemId)
        if (isClaimed && !showClaimed) return;
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '6px';

        let coords = null;
        let coordStatus = "";
        if (typeof info === 'object') {
          if (info['lat'] !== undefined && info['lng'] !== undefined) {
            coords = [info['lat'], info['lng']];
          } else if (info['latitude'] !== undefined && info['longitude'] !== undefined) {
            coords = [info['latitude'], info['longitude']];
          } else if (
            info['tileX'] !== undefined && info['offsetX'] !== undefined &&
            info['tileY'] !== undefined && info['offsetY'] !== undefined
          ) {
            coords = coordsTileCoordsToGeoCoords(
              [info['tileX'], info['tileY']],
              [info['offsetX'], info['offsetY']]
            )
          }
          // Check Time
          if (info['foundAt'] !== undefined) {
            const currentTimestamp = Date.now();
            const currentHour = currentTimestamp - (currentTimestamp % 3600000);
            const foundTimestamp = new Date(info['foundAt']).getTime();
            const foundHour = foundTimestamp - (foundTimestamp % 3600000);
            if (currentHour !== foundHour) {
              coordStatus = "Expired • ";
              if (!showUnavailable) return;
            }
          }
        }

        if (coords !== null) {
          let teleportButton = document.createElement('a');
          teleportButton.className = 'bm-icon-link';
          teleportButton.title = "Teleport to event item";
          teleportButton.textContent = "✈️";
          teleportButton.style.fontSize = '12px';
          teleportButton.onclick = () => {
            teleportToGeoCoords(coords[0], coords[1]);
            const mapMarkers = Array.from(
              document.querySelectorAll(".cursor-pointer.z-10") // z-10: not the pin (z-20)
            ).filter( x => {
              if (x.style.opacity != 1) return false;
              const rect = x.getBoundingClientRect();
              const windowWidth = window.innerWidth || document.documentElement.clientWidth;
              const windowHeight = window.innerHeight || document.documentElement.clientHeight;
              return (
                rect.top >= 0 && rect.bottom <= windowWidth &&
                rect.left >= 0 && rect.right <= windowHeight
              );
            });
            if (mapMarkers.length === 1) { // only 1 opaque marker on screen
              mapMarkers[0].click(); // safely click it  
            };
          }
          row.appendChild(teleportButton);
        } else {
          coordStatus = "Unknown Coordinate Format • ";
        }

        let label = document.createElement('span');
        label.style.fontSize = '12px';
        label.textContent = `#${itemId} • ${coordStatus}${eventClaimedList.has(itemId) ? "Claimed" : "Unclaimed"}`;
        row.appendChild(label);
        listContainer.appendChild(row);
        hasEntries = true;
      });
      if (!hasEntries && listContainer) {
        listContainer.innerHTML = `<small>No ${showClaimed ? "" : "unclaimed "}items have ${showUnavailable ? "" : "recent "}data available.</small>`;
      }
    }).catch(err => {
      listContainer.innerHTML = '<small>Failed fetching the event item info from the event data provider. Make sure the provider URL is a valid JSON resource and can be accessed with appropriate CORS.</small>';
    });

  };
  window.buildEventList = buildEventList;

  const forceUpdateTheme = () => {
    if (templateManager.isThemeOverridden()) {
      setTheme(templateManager.getCurrentTheme());
    } else {
      setTheme(Object.keys(themeList)[0]);
    }
  };
  window.forceUpdateTheme = forceUpdateTheme;

  // a workaround to force Map.prototype to be called
  const forceClickCenter = () => {
    if (!isMapTilerLoaded()) {
      if (!forceClickCenter.clickCount) forceClickCenter.clickCount = 0;
      // Try at most 10 times
      if (forceClickCenter.clickCount < 10) {
        const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
        if (allianceOrRankingButton) {
          // not in painting mode
          const canvas = document.querySelector("canvas.maplibregl-canvas");
          if (canvas) {
            const ev = new MouseEvent("click", {
              "bubbles": true, "cancelable": true,
              "clientX": canvas.offsetWidth / 2,
              "clientY": canvas.offsetHeight / 2,
              "button": 0
            });
            canvas.dispatchEvent(ev);
            ++forceClickCenter.clickCount;
          };
        }
      };
      setTimeout(forceClickCenter, 100);
    };
  };
  window.forceClickCenter = forceClickCenter;

  // Listen for template creation/import completion to (re)build palette list
  window.addEventListener('message', (event) => {
    if (event?.data?.bmEvent === 'bm-rebuild-color-list') {
      try { buildColorFilterList(); } catch (_) {}
    } else if (event?.data?.bmEvent === 'bm-rebuild-template-list') {
      try { buildTemplateFilterList(); } catch (_) {}
    } else if (event?.data?.bmEvent === 'bm-rebuild-event-list') {
      try { buildEventList(); } catch (_) {}
    }
  });

  // If a template was already loaded from storage, show the color UI and build list
  setTimeout(() => {
    try {
      if (templateManager.templatesArray?.length > 0) {
        // const colorUI = document.querySelector('#bm-contain-colorfilter');
        // if (colorUI) { colorUI.style.display = ''; }
        buildColorFilterList();
      }
      if (templateManager.templatesArray?.length > 0) {
        buildTemplateFilterList();
      }
    } catch (_) {}
    try {
      if (templateManager.isEventEnabled()) {
        buildEventList();
      }
    } catch (_) {}
    try {
      // this feature is currently broken by wplace
      if (templateManager.isThemeOverridden()) {
        doAfterMapFound(forceUpdateTheme);
      }
    } catch (_) {}
    try {
      forceClickCenter();
    } catch (_) {}
  }, 0);

}
