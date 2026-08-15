/** @file Custom (user-defined) layout theme: token schema, normalization,
 * CSS variable generation and the shareable base64 codec.
 *
 * The palette themes in `overlay.css` are static `--bm-*` blocks keyed by
 * `#bm-overlay[data-layout-theme="..."]`. The "custom" theme instead stores a
 * plain colour map in user settings and applies it as inline custom properties
 * on `#bm-overlay`, which the rest of the UI (including floating panels, via
 * `applyOverlayVarsToFloatingElement`) already reads.
 *
 * @since 0.87.76
 */

export const CUSTOM_LAYOUT_THEME = 'custom';

/** The composed drag-handle property. Must stay a literal for the CSS mangler. */
export const CUSTOM_THEME_DRAG_BG_VAR = '--bm-drag-bg';

/** Current share-code payload version. Bump only on breaking schema changes. */
export const CUSTOM_THEME_CODE_VERSION = 1;

/** Editable tokens, grouped for the editor UI.
 *
 * `key` is the stable storage/share-code identifier. `cssVar` is the custom
 * property it drives, and MUST stay a literal string: the CSS mangler rewrites
 * `--bm-*` names in the stylesheet and rewrites the matching literals in this
 * bundle, so a name built at runtime (`'--bm-' + key`) would survive mangling
 * unchanged and no longer match the stylesheet. `drag-dot` has no `cssVar`
 * because it is composed into `--bm-drag-bg` instead.
 *
 * Every value is stored as an 8-digit `#rrggbbaa` string so alpha survives a
 * round-trip through the share code.
 */
export const CUSTOM_THEME_GROUPS = [
  {
    id: 'surface',
    labelKey: 'customTheme.group.surface',
    labelFallback: 'Surfaces',
    tokens: [
      { key: 'bg', cssVar: '--bm-bg', labelKey: 'customTheme.token.bg', labelFallback: 'Window background', default: '#541824e0' },
      { key: 'panel-bg', cssVar: '--bm-panel-bg', labelKey: 'customTheme.token.panelBg', labelFallback: 'Panel background', default: '#541824f5' },
      { key: 'comment-bg', cssVar: '--bm-comment-bg', labelKey: 'customTheme.token.commentBg', labelFallback: 'Comment background', default: '#541824d6' },
      { key: 'subtle-bg', cssVar: '--bm-subtle-bg', labelKey: 'customTheme.token.subtleBg', labelFallback: 'Subtle background', default: '#00000033' },
    ],
  },
  {
    id: 'text',
    labelKey: 'customTheme.group.text',
    labelFallback: 'Text & Icons',
    tokens: [
      { key: 'fg', cssVar: '--bm-fg', labelKey: 'customTheme.token.fg', labelFallback: 'Text', default: '#ffffffff' },
      { key: 'muted', cssVar: '--bm-muted', labelKey: 'customTheme.token.muted', labelFallback: 'Muted text', default: '#d3d3d3ff' },
      { key: 'icon', cssVar: '--bm-icon', labelKey: 'customTheme.token.icon', labelFallback: 'Icons', default: '#111111ff' },
    ],
  },
  {
    id: 'border',
    labelKey: 'customTheme.group.border',
    labelFallback: 'Borders',
    tokens: [
      { key: 'border', cssVar: '--bm-border', labelKey: 'customTheme.token.border', labelFallback: 'Border', default: '#ffffff1a' },
      { key: 'border-strong', cssVar: '--bm-border-strong', labelKey: 'customTheme.token.borderStrong', labelFallback: 'Strong border', default: '#ffffff33' },
    ],
  },
  {
    id: 'button',
    labelKey: 'customTheme.group.button',
    labelFallback: 'Buttons',
    tokens: [
      { key: 'btn-bg', cssVar: '--bm-btn-bg', labelKey: 'customTheme.token.btnBg', labelFallback: 'Button', default: '#8b1e2fff' },
      { key: 'btn-hover', cssVar: '--bm-btn-hover', labelKey: 'customTheme.token.btnHover', labelFallback: 'Button hover', default: '#a3263aff' },
      { key: 'btn-active', cssVar: '--bm-btn-active', labelKey: 'customTheme.token.btnActive', labelFallback: 'Button active', default: '#b83a4cff' },
      { key: 'btn-text', cssVar: '--bm-btn-text', labelKey: 'customTheme.token.btnText', labelFallback: 'Button text', default: '#ffffffff' },
    ],
  },
  {
    id: 'accent',
    labelKey: 'customTheme.group.accent',
    labelFallback: 'Accents',
    tokens: [
      { key: 'accent', cssVar: '--bm-accent', labelKey: 'customTheme.token.accent', labelFallback: 'Accent', default: '#f2c1cdff' },
      { key: 'accent-strong', cssVar: '--bm-accent-strong', labelKey: 'customTheme.token.accentStrong', labelFallback: 'Strong accent', default: '#ffd6deff' },
      { key: 'accent-soft', cssVar: '--bm-accent-soft', labelKey: 'customTheme.token.accentSoft', labelFallback: 'Soft accent', default: '#f2c1cd99' },
      { key: 'charge-time', cssVar: '--bm-charge-time', labelKey: 'customTheme.token.chargeTime', labelFallback: 'Charge timer', default: '#ffd6deff' },
    ],
  },
  {
    id: 'highlight',
    labelKey: 'customTheme.group.highlight',
    labelFallback: 'Highlights',
    tokens: [
      { key: 'highlight-bg', cssVar: '--bm-highlight-bg', labelKey: 'customTheme.token.highlightBg', labelFallback: 'Highlight background', default: '#b83a4c59' },
      { key: 'highlight-border', cssVar: '--bm-highlight-border', labelKey: 'customTheme.token.highlightBorder', labelFallback: 'Highlight border', default: '#ffd6deb3' },
      { key: 'highlight-text', cssVar: '--bm-highlight-text', labelKey: 'customTheme.token.highlightText', labelFallback: 'Highlight text', default: '#ffe8eeff' },
      { key: 'highlight-text-border', cssVar: '--bm-highlight-text-border', labelKey: 'customTheme.token.highlightTextBorder', labelFallback: 'Highlight text border', default: '#ffe8eed9' },
    ],
  },
  {
    id: 'status',
    labelKey: 'customTheme.group.status',
    labelFallback: 'Status',
    tokens: [
      { key: 'warn', cssVar: '--bm-warn', labelKey: 'customTheme.token.warn', labelFallback: 'Warning', default: '#ffa500ff' },
      { key: 'danger', cssVar: '--bm-danger', labelKey: 'customTheme.token.danger', labelFallback: 'Danger', default: '#fa8072ff' },
    ],
  },
  {
    id: 'chat',
    labelKey: 'customTheme.group.chat',
    labelFallback: 'Chat',
    tokens: [
      { key: 'chat-reply-bg', cssVar: '--bm-chat-reply-bg', labelKey: 'customTheme.token.chatReplyBg', labelFallback: 'Reply background', default: '#00000033' },
      { key: 'chat-reply-border', cssVar: '--bm-chat-reply-border', labelKey: 'customTheme.token.chatReplyBorder', labelFallback: 'Reply border', default: '#f2c1cdcc' },
    ],
  },
  {
    id: 'notify',
    labelKey: 'customTheme.group.notify',
    labelFallback: 'Notifications',
    tokens: [
      { key: 'notify-bg', cssVar: '--bm-notify-bg', labelKey: 'customTheme.token.notifyBg', labelFallback: 'Notification background', default: '#121212eb' },
      { key: 'notify-fg', cssVar: '--bm-notify-fg', labelKey: 'customTheme.token.notifyFg', labelFallback: 'Notification text', default: '#ffffffff' },
      { key: 'notify-muted', cssVar: '--bm-notify-muted', labelKey: 'customTheme.token.notifyMuted', labelFallback: 'Notification muted text', default: '#cfcfcfff' },
      { key: 'notify-border', cssVar: '--bm-notify-border', labelKey: 'customTheme.token.notifyBorder', labelFallback: 'Notification border', default: '#ffffff33' },
    ],
  },
  {
    id: 'misc',
    labelKey: 'customTheme.group.misc',
    labelFallback: 'Misc',
    tokens: [
      { key: 'drag-dot', labelKey: 'customTheme.token.dragDot', labelFallback: 'Drag handle dots', default: '#7a1f2fd9' },
    ],
  },
  {
    id: 'site',
    labelKey: 'customTheme.group.site',
    labelFallback: 'wplace UI',
    // Only applied while "Restyle wplace UI" is on. These drive daisyUI's own
    // tokens on <html>, which every wplace panel/card/button reads. Unlike the
    // `--bm-*` names these are not `bm-` prefixed, so the CSS mangler ignores
    // them and they are safe to keep as plain strings.
    site: true,
    tokens: [
      { key: 'site-base-100', siteVar: '--color-base-100', labelKey: 'customTheme.token.siteBase100', labelFallback: 'Surface', default: '#2a303cff', example: { kind: 'card', classes: 'card bg-base-100 text-base-content' } },
      { key: 'site-base-200', siteVar: '--color-base-200', labelKey: 'customTheme.token.siteBase200', labelFallback: 'Surface (sunken)', default: '#242933ff', example: { kind: 'card', classes: 'card bg-base-200 text-base-content' } },
      { key: 'site-base-300', siteVar: '--color-base-300', labelKey: 'customTheme.token.siteBase300', labelFallback: 'Surface (deepest)', default: '#20252eff', example: { kind: 'card', classes: 'card bg-base-300 text-base-content' } },
      { key: 'site-base-content', siteVar: '--color-base-content', labelKey: 'customTheme.token.siteBaseContent', labelFallback: 'Surface text', default: '#ecf9ffff', example: { kind: 'card', classes: 'card bg-base-100 text-base-content' } },
      { key: 'site-primary', siteVar: '--color-primary', labelKey: 'customTheme.token.sitePrimary', labelFallback: 'Primary', default: '#605dffff', example: { kind: 'btn', classes: 'btn btn-primary' } },
      { key: 'site-primary-content', siteVar: '--color-primary-content', labelKey: 'customTheme.token.sitePrimaryContent', labelFallback: 'Primary text', default: '#edf1feff', example: { kind: 'btn', classes: 'btn btn-primary' } },
      { key: 'site-secondary', siteVar: '--color-secondary', labelKey: 'customTheme.token.siteSecondary', labelFallback: 'Secondary', default: '#f43098ff', example: { kind: 'btn', classes: 'btn btn-secondary' } },
      { key: 'site-secondary-content', siteVar: '--color-secondary-content', labelKey: 'customTheme.token.siteSecondaryContent', labelFallback: 'Secondary text', default: '#f9e4f0ff', example: { kind: 'btn', classes: 'btn btn-secondary' } },
      { key: 'site-accent', siteVar: '--color-accent', labelKey: 'customTheme.token.siteAccent', labelFallback: 'Accent', default: '#00d3bbff', example: { kind: 'chip', classes: 'bg-accent text-accent-content' } },
      { key: 'site-accent-content', siteVar: '--color-accent-content', labelKey: 'customTheme.token.siteAccentContent', labelFallback: 'Accent text', default: '#084d49ff', example: { kind: 'chip', classes: 'bg-accent text-accent-content' } },
      { key: 'site-neutral', siteVar: '--color-neutral', labelKey: 'customTheme.token.siteNeutral', labelFallback: 'Neutral', default: '#09090bff', example: { kind: 'badge', classes: 'badge badge-neutral' } },
      { key: 'site-neutral-content', siteVar: '--color-neutral-content', labelKey: 'customTheme.token.siteNeutralContent', labelFallback: 'Neutral text', default: '#e4e4e7ff', example: { kind: 'badge', classes: 'badge badge-neutral' } },
      { key: 'site-info', siteVar: '--color-info', labelKey: 'customTheme.token.siteInfo', labelFallback: 'Info', default: '#00bafeff', example: { kind: 'alert', classes: 'alert alert-info' } },
      { key: 'site-success', siteVar: '--color-success', labelKey: 'customTheme.token.siteSuccess', labelFallback: 'Success', default: '#00d390ff', example: { kind: 'btn', classes: 'btn btn-success' } },
      { key: 'site-warning', siteVar: '--color-warning', labelKey: 'customTheme.token.siteWarning', labelFallback: 'Warning', default: '#fcb700ff', example: { kind: 'alert', classes: 'alert alert-warning' } },
      { key: 'site-error', siteVar: '--color-error', labelKey: 'customTheme.token.siteError', labelFallback: 'Error', default: '#ff627dff', example: { kind: 'alert', classes: 'alert alert-error' } },
    ],
  },
];

/** Flat list of every editable token descriptor. */
export const CUSTOM_THEME_TOKENS = CUSTOM_THEME_GROUPS.flatMap((group) => group.tokens);

const TOKEN_BY_KEY = new Map(CUSTOM_THEME_TOKENS.map((token) => [token.key, token]));

/** The default custom palette (a copy of the "classic" theme). */
export const getDefaultCustomTheme = () => {
  const colors = {};
  for (const token of CUSTOM_THEME_TOKENS) { colors[token.key] = token.default; }
  return colors;
};

const HEX_RE = /^#?([0-9a-f]{3,8})$/i;

/** Coerces any supported colour notation into `#rrggbbaa`.
 * Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and `rgb()`/`rgba()`.
 * @param {*} value - The raw value.
 * @param {string} fallback - Returned when `value` cannot be parsed.
 * @returns {string} An 8-digit lowercase hex string.
 */
export const normalizeCustomThemeColor = (value, fallback = '#000000ff') => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;

  const rgbMatch = raw.match(/^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:[\s,/]+([0-9.]+%?))?\s*\)$/i);
  if (rgbMatch) {
    const channel = (input) => Math.max(0, Math.min(255, Math.round(Number(input) || 0)));
    const alphaRaw = rgbMatch[4];
    let alpha = 1;
    if (alphaRaw !== undefined) {
      alpha = alphaRaw.endsWith('%') ? (parseFloat(alphaRaw) / 100) : parseFloat(alphaRaw);
      if (!Number.isFinite(alpha)) alpha = 1;
    }
    alpha = Math.max(0, Math.min(1, alpha));
    const parts = [channel(rgbMatch[1]), channel(rgbMatch[2]), channel(rgbMatch[3]), Math.round(alpha * 255)];
    return '#' + parts.map((part) => part.toString(16).padStart(2, '0')).join('');
  }

  const hexMatch = raw.match(HEX_RE);
  if (!hexMatch) return fallback;
  let hex = hexMatch[1].toLowerCase();
  if (hex.length === 3 || hex.length === 4) { hex = hex.split('').map((char) => char + char).join(''); }
  if (hex.length === 6) { hex += 'ff'; }
  if (hex.length !== 8) return fallback;
  return '#' + hex;
};

/** Splits `#rrggbbaa` into its `#rrggbb` part and a 0..1 alpha.
 * @param {string} value
 * @returns {{hex: string, alpha: number}}
 */
export const splitCustomThemeColor = (value) => {
  const normalized = normalizeCustomThemeColor(value);
  return {
    hex: normalized.slice(0, 7),
    alpha: parseInt(normalized.slice(7, 9), 16) / 255,
  };
};

/** Joins a `#rrggbb` hex and a 0..1 alpha back into `#rrggbbaa`. */
export const joinCustomThemeColor = (hex, alpha) => {
  const base = normalizeCustomThemeColor(hex).slice(0, 7);
  const clamped = Math.max(0, Math.min(1, Number(alpha)));
  const alphaByte = Math.round((Number.isFinite(clamped) ? clamped : 1) * 255);
  return base + alphaByte.toString(16).padStart(2, '0');
};

/** Renders `#rrggbbaa` as a CSS `rgba()` string.
 * Emitted rather than the hex form so the values stay readable in devtools and
 * behave identically on browsers with partial 8-digit-hex support.
 */
export const customThemeColorToCss = (value) => {
  const normalized = normalizeCustomThemeColor(value);
  const red = parseInt(normalized.slice(1, 3), 16);
  const green = parseInt(normalized.slice(3, 5), 16);
  const blue = parseInt(normalized.slice(5, 7), 16);
  const alpha = Math.round((parseInt(normalized.slice(7, 9), 16) / 255) * 1000) / 1000;
  return alpha >= 1 ? `rgb(${red}, ${green}, ${blue})` : `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

/** Fills in missing/invalid entries from the defaults and drops unknown keys.
 * @param {*} value - A (possibly partial or hostile) colour map.
 * @returns {Record<string, string>} A complete, valid palette.
 */
export const normalizeCustomTheme = (value) => {
  const source = (value && typeof value === 'object') ? value : {};
  const colors = {};
  for (const token of CUSTOM_THEME_TOKENS) {
    colors[token.key] = normalizeCustomThemeColor(source[token.key], token.default);
  }
  return colors;
};

/** Builds the daisyUI `--color-*` properties wplace's own UI reads.
 *
 * Applied inline on `<html>`, which outranks every stylesheet rule, so this
 * repaints the site on top of whatever `data-theme` is active.
 *
 * @param {Record<string, string>} colors - A normalized palette.
 * @returns {Array<[string, string]>} `[property, value]` pairs.
 */
export const buildCustomThemeSiteVars = (colors) => {
  const palette = normalizeCustomTheme(colors);
  const vars = [];
  for (const token of CUSTOM_THEME_TOKENS) {
    if (!token.siteVar) continue;
    vars.push([token.siteVar, customThemeColorToCss(palette[token.key])]);
  }
  return vars;
};

/** Builds the `--bm-*` custom properties for a palette.
 * @param {Record<string, string>} colors - A normalized palette.
 * @returns {Array<[string, string]>} `[property, value]` pairs.
 */
export const buildCustomThemeCssVars = (colors) => {
  const palette = normalizeCustomTheme(colors);
  const vars = [];
  for (const token of CUSTOM_THEME_TOKENS) {
    if (!token.cssVar) continue; // e.g. drag-dot, composed into --bm-drag-bg below
    vars.push([token.cssVar, customThemeColorToCss(palette[token.key])]);
  }
  const dot = customThemeColorToCss(palette['drag-dot']);
  vars.push([CUSTOM_THEME_DRAG_BG_VAR, `radial-gradient(circle at 3px 3px, ${dot} 0 1.6px, transparent 1.6px)`]);
  vars.push(['--bm-drag-bg-repeat', 'repeat']);
  vars.push(['--bm-drag-bg-size', '6px 6px']);
  // The glass border follows the strong border so custom palettes keep a matching frame.
  vars.push(['--bm-glass-border', customThemeColorToCss(palette['border-strong'])]);
  return vars;
};

/* -------------------------------------------------------------------------- */
/* Share codes                                                                */
/* -------------------------------------------------------------------------- */

/** UTF-8 safe base64 encode. `btoa` alone throws on non-Latin1 input. */
const encodeBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) { binary += String.fromCharCode(bytes[i]); }
  return btoa(binary);
};

/** UTF-8 safe base64 decode. */
const decodeBase64 = (text) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return new TextDecoder().decode(bytes);
};

/** Prefix so a pasted code is recognisable as ours and cheap to validate. */
const CODE_PREFIX = 'RMTHEME1:';

/** Encodes a palette into a shareable code.
 *
 * Colours are packed as bare hex digits keyed by token index rather than by
 * name, which keeps the code short enough to paste into chat.
 *
 * @param {Record<string, string>} colors - The palette to share.
 * @param {string} [name] - Optional human-readable theme name.
 * @returns {string} The share code.
 */
export const encodeCustomThemeCode = (colors, name = '', applyToSite = false) => {
  const palette = normalizeCustomTheme(colors);
  const payload = {
    v: CUSTOM_THEME_CODE_VERSION,
    n: String(name ?? '').trim().slice(0, 48),
    s: applyToSite ? 1 : 0,
    c: CUSTOM_THEME_TOKENS.map((token) => palette[token.key].slice(1)),
  };
  if (!payload.n) { delete payload.n; }
  return CODE_PREFIX + encodeBase64(JSON.stringify(payload));
};

/** Decodes a share code produced by {@link encodeCustomThemeCode}.
 *
 * Tolerates surrounding whitespace, a missing prefix, and codes generated by a
 * build with a different token list (missing tokens fall back to the default).
 *
 * @param {string} code - The share code.
 * @returns {{colors: Record<string, string>, name: string}|null} `null` when the code is unusable.
 */
export const decodeCustomThemeCode = (code) => {
  const raw = String(code ?? '').trim().replace(/\s+/g, '');
  if (!raw) return null;
  const body = raw.startsWith(CODE_PREFIX) ? raw.slice(CODE_PREFIX.length) : raw;
  let payload = null;
  try {
    payload = JSON.parse(decodeBase64(body));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const colors = getDefaultCustomTheme();
  if (Array.isArray(payload.c)) {
    // Index-keyed form.
    CUSTOM_THEME_TOKENS.forEach((token, index) => {
      const entry = payload.c[index];
      if (entry === undefined || entry === null) return;
      colors[token.key] = normalizeCustomThemeColor(entry, token.default);
    });
  } else if (payload.colors && typeof payload.colors === 'object') {
    // Name-keyed form, tolerated so hand-written codes also import.
    for (const [key, entry] of Object.entries(payload.colors)) {
      const token = TOKEN_BY_KEY.get(key);
      if (!token) continue;
      colors[token.key] = normalizeCustomThemeColor(entry, token.default);
    }
  } else {
    return null;
  }

  return {
    colors,
    name: String(payload.n ?? payload.name ?? '').trim().slice(0, 48),
    // Absent in codes made before the wplace-UI tokens existed; default off so
    // an old code never unexpectedly repaints the whole site.
    applyToSite: !!(payload.s ?? payload.applyToSite ?? 0),
  };
};
