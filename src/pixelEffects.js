/** @file Per-user pixel-info effects: what plays when someone opens a pixel painted by a user.
 *
 * Configs live on the RusMarble backend (`/effects`). Everyone can read them; only the owner of a
 * wplace account can change theirs, proven by painting a pixel the server picks (see the backend's
 * `pixel_effects.py`). The wplace token is never involved. After verifying, the server hands out an
 * edit key for that one user ID, kept in GM storage.
 * @since 0.87.108
 */

export const PIXEL_EFFECT_FLAGS = ['pulse', 'wave', 'confetti', 'fireworks', 'crown', 'border', 'clickExplode', 'sparkles'];

/** Effects reserved for the accounts below. Must match `EXCLUSIVE_FLAGS` / `EXCLUSIVE_USER_IDS`
 * on the server, which enforces it; this side only hides them and ignores them if sent anyway.
 * clickExplode is here because it only replays pulse/confetti/fireworks. */
export const PIXEL_EFFECT_EXCLUSIVE_FLAGS = ['pulse', 'wave', 'confetti', 'fireworks', 'clickExplode'];
const EXCLUSIVE_USER_IDS = new Set([11728406]);

/** Colour lists that only matter for exclusive effects. */
export const PIXEL_EFFECT_EXCLUSIVE_COLORS = ['confettiColors', 'fireworkColors'];

/** Whether a wplace user may use the exclusive effects. */
export const canUseExclusiveEffects = (userId) => EXCLUSIVE_USER_IDS.has(userId);

/** Must match `BADGE_EMOJIS` on the server. */
export const PIXEL_EFFECT_BADGES = [
  '👑', '⭐', '🔥', '💎', '❤️', '🐻', '🚀', '⚡', '🎉', '🌸', '💀', '🇷🇺',
  '😎', '👻', '🎨', '🖌️', '🌟', '🍀', '🐱', '🦊', '🐉', '🌙', '☀️', '🎮',
];

/** Named choices. Must match `ENUM_OPTIONS` on the server; defaults are in DEFAULT_PIXEL_EFFECTS. */
export const PIXEL_EFFECT_ENUMS = {
  nameStyle: ['none', 'gradient', 'glow'],
  borderSpeed: ['slow', 'normal', 'fast'],
  badgeAnimation: ['wobble', 'bounce', 'spin', 'none'],
  badgeSize: ['small', 'medium', 'large'],
  badgePosition: ['start', 'end'],
  nameFont: ['default', 'bold', 'italic', 'mono', 'serif', 'rounded'],
  cardTint: ['off', 'subtle', 'strong'],
  nameAnimation: ['none', 'float', 'heartbeat', 'jelly', 'shimmer', 'glitch'],
  cardEntrance: ['none', 'pop', 'slide', 'flip'],
  ambient: ['none', 'snow', 'hearts', 'bubbles', 'embers', 'stars'],
  mottoAnimation: ['none', 'typewriter', 'fade'],
};

/** Must match `MOTTO_MAX_LEN` on the server. */
export const PIXEL_EFFECT_MOTTO_MAX = 24;
const MOTTO_FORBIDDEN = /[\u0000-\u001f\u007f]|https?:\/\/|www\./i;

/** Whole-number options: [min, max, default]. Must match `INT_OPTIONS` on the server. */
export const PIXEL_EFFECT_INTS = {
  borderWidth: [2, 6, 3],
};

/** Min/max colours per list. Must match `COLOR_LIST_LIMITS` on the server. */
export const PIXEL_EFFECT_COLOR_LIMITS = {
  confettiColors: [1, 8],
  fireworkColors: [1, 4],
  borderColors: [2, 6],
  nameColors: [1, 3],
  sparkleColors: [1, 4],
  cardColors: [1, 2],
  haloColors: [1, 1],
  ambientColors: [1, 4],
};

export const DEFAULT_PIXEL_EFFECTS = Object.freeze({
  pulse: true,
  wave: true,
  confetti: true,
  fireworks: true,
  crown: true,
  border: true,
  clickExplode: true,
  confettiColors: ['#000000', '#111111', '#1c1c1c', '#262626', '#333333', '#3c3c3c', '#4a4a4a', '#575757'],
  fireworkColors: ['#ffffff', '#0039a6', '#d52b1e'],
  borderColors: ['#8a5a00', '#d4a017', '#fff3b0', '#ffd700', '#b8860b', '#7a4e00'],
  nameColors: ['#ffd700', '#ff7f27', '#d52b1e'],
  sparkleColors: ['#fff3b0', '#ffd700'],
  cardColors: ['#d4a017', '#7a4e00'],
  haloColors: ['#ffd25a'],
  sparkles: false,
  motto: '',
  badgeSize: 'medium',
  badgePosition: 'start',
  nameFont: 'default',
  cardTint: 'off',
  nameAnimation: 'none',
  cardEntrance: 'none',
  ambient: 'none',
  mottoAnimation: 'none',
  ambientColors: ['#ffffff', '#cfe8ff'],
  badge: '👑',
  nameStyle: 'none',
  borderSpeed: 'normal',
  borderWidth: 3,
  badgeAnimation: 'wobble',
});

/** Built-in effects that apply until the user saves their own on the server. */
const BUILT_IN_EFFECTS = new Map([[11728406, DEFAULT_PIXEL_EFFECTS]]);

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const EFFECTS_REFRESH_MS = 5 * 60 * 1000;
const EDIT_KEY_STORAGE = 'rmPixelEffectsEditKey';

/**
 * Cleans a config from the server (or the editor). Anything unknown or malformed falls back to
 * the defaults, and colours/badges are checked again here because they end up in inline styles.
 * @param {object} raw
 * @param {number} userId Whose config it is; exclusive effects are dropped for everyone else.
 * @returns {object}
 */
export const normalizePixelEffects = (raw, userId) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const config = {};
  PIXEL_EFFECT_FLAGS.forEach((flag) => {
    config[flag] = typeof source[flag] === 'boolean' ? source[flag] : false;
  });
  Object.entries(PIXEL_EFFECT_COLOR_LIMITS).forEach(([key, [min, max]]) => {
    const list = Array.isArray(source[key]) ? source[key].filter((c) => typeof c === 'string' && HEX_COLOR.test(c)) : [];
    config[key] = list.length >= min ? list.slice(0, max).map((c) => c.toLowerCase()) : [...DEFAULT_PIXEL_EFFECTS[key]];
  });
  config.badge = PIXEL_EFFECT_BADGES.includes(source.badge) ? source.badge : DEFAULT_PIXEL_EFFECTS.badge;
  Object.entries(PIXEL_EFFECT_ENUMS).forEach(([key, allowed]) => {
    config[key] = allowed.includes(source[key]) ? source[key] : DEFAULT_PIXEL_EFFECTS[key];
  });
  const motto = typeof source.motto === 'string' ? source.motto.split(/\s+/).filter(Boolean).join(' ') : '';
  config.motto = motto.length <= PIXEL_EFFECT_MOTTO_MAX && !MOTTO_FORBIDDEN.test(motto) ? motto : '';
  Object.entries(PIXEL_EFFECT_INTS).forEach(([key, [min, max, fallback]]) => {
    const value = source[key];
    config[key] = Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  });
  if (!canUseExclusiveEffects(userId)) {
    PIXEL_EFFECT_EXCLUSIVE_FLAGS.forEach((flag) => { config[flag] = false; });
  }
  return config;
};

/** One request to the backend through GM (the site's CSP/CORS don't apply there). */
const backendRequest = (baseUrl, method, path, { body, key } = {}) => new Promise((resolve, reject) => {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  GM_xmlhttpRequest({
    method,
    url: `${baseUrl}${path}`,
    headers,
    data: body === undefined ? undefined : JSON.stringify(body),
    timeout: 20000,
    onload: (response) => {
      let json = null;
      try { json = JSON.parse(response.responseText || 'null'); } catch (_) {}
      resolve({ status: response.status, json });
    },
    onerror: () => reject(new Error('network')),
    ontimeout: () => reject(new Error('timeout')),
  });
});

/** Turns a failed response into a readable message (the server sends `detail`). */
export const describeEffectsError = (response, fallback) =>
  (typeof response?.json?.detail === 'string' && response.json.detail) || fallback;

/**
 * @param {object} deps
 * @param {string} deps.baseUrl Backend origin, e.g. `https://wplace.zaebal.me`.
 * @param {() => void} [deps.onUpdate] Called after a load that changed the effects.
 */
export const createPixelEffectsStore = ({ baseUrl, onUpdate }) => {
  /** userId -> normalized config, from the server. */
  let remote = new Map();
  let loadedAt = 0;
  let loading = null;
  let lastPayload = '';

  const refresh = () => {
    if (loading) return loading;
    loading = backendRequest(baseUrl, 'GET', '/effects')
      .then(({ status, json }) => {
        if (status !== 200 || !json || typeof json.effects !== 'object') return;
        loadedAt = Date.now();
        const payload = JSON.stringify(json.effects);
        if (payload === lastPayload) return;
        lastPayload = payload;
        const next = new Map();
        Object.entries(json.effects).forEach(([id, config]) => {
          const userId = Number(id);
          if (Number.isSafeInteger(userId) && userId > 0) next.set(userId, normalizePixelEffects(config, userId));
        });
        remote = next;
        try { onUpdate?.(); } catch (_) {}
      })
      .catch(() => {})
      .finally(() => { loading = null; });
    return loading;
  };

  /** The effects for a painter, or null. Cheap and synchronous; refreshes in the background. */
  const getFor = (userId) => {
    if (Date.now() - loadedAt > EFFECTS_REFRESH_MS) void refresh();
    return remote.get(userId) || BUILT_IN_EFFECTS.get(userId) || null;
  };

  /** Lets the owner see a save immediately, without waiting for the next refresh. */
  const setLocal = (userId, config) => {
    if (config) remote.set(userId, normalizePixelEffects(config, userId));
    else remote.delete(userId);
  };

  const loadEditKey = async () => {
    try {
      const stored = JSON.parse(await GM.getValue(EDIT_KEY_STORAGE, 'null'));
      return stored && Number.isSafeInteger(stored.userId) && typeof stored.key === 'string' ? stored : null;
    } catch (_) {
      return null;
    }
  };
  const saveEditKey = (userId, key) => GM.setValue(EDIT_KEY_STORAGE, JSON.stringify({ userId, key }));
  const clearEditKey = () => GM.deleteValue(EDIT_KEY_STORAGE);

  const api = {
    startChallenge: (userId, [tileX, tileY, x, y]) => backendRequest(baseUrl, 'POST', '/effects/challenge', {
      body: { user_id: userId, tile_x: tileX, tile_y: tileY, x, y },
    }),
    verify: (challengeId) => backendRequest(baseUrl, 'POST', '/effects/verify', { body: { challenge_id: challengeId } }),
    getMine: (key) => backendRequest(baseUrl, 'GET', '/effects/me', { key }),
    saveMine: (key, config) => backendRequest(baseUrl, 'PUT', '/effects/me', { key, body: { config } }),
    deleteMine: (key) => backendRequest(baseUrl, 'DELETE', '/effects/me', { key }),
  };

  /** Every config that can play: the server's plus the built-in ones. */
  const all = () => [...remote.values(), ...BUILT_IN_EFFECTS.values()];

  return { refresh, getFor, all, setLocal, loadEditKey, saveEditKey, clearEditKey, api };
};
