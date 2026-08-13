/**
 * RusMarble in-page profiler.
 * Toggle with Alt+P. Stats auto-reset every 30 s.
 * API: profiler.measure(label, fn), profiler.measureAsync(label, fn),
 *      profiler.start(label), profiler.end(label), profiler.record(label, ms)
 */

import { makePointerPannable } from './utils.js';

const stats = new Map(); // label → { count, totalMs, maxMs, lastMs }
let hudEl = null;
let rafId = null;
let resetTimer = null;
let logTimer = null;
const RESET_INTERVAL_MS = 30_000;
const HUD_REFRESH_MS = 500;
const LOG_SNAPSHOT_INTERVAL_MS = 2_000;
const LOG_MAX_SNAPSHOTS = 300; // ~10 min at 2s intervals

// ── log buffer ─────────────────────────────────────────────────────────────
const logBuffer = []; // array of { t, stats[] }
let logRunning = false;
const sessionStart = Date.now();

function takeSnapshot() {
  const snap = {
    t: (Date.now() - sessionStart) / 1000, // seconds since profiler init
    stats: profiler.getStats(),
  };
  logBuffer.push(snap);
  if (logBuffer.length > LOG_MAX_SNAPSHOTS) {
    logBuffer.shift();
  }
}

function startLogging() {
  if (logRunning) return;
  logRunning = true;
  logTimer = setInterval(takeSnapshot, LOG_SNAPSHOT_INTERVAL_MS);
}

function stopLogging() {
  logRunning = false;
  clearInterval(logTimer);
  logTimer = null;
}

function downloadLog() {
  takeSnapshot(); // grab final state before download
  const payload = {
    version: 1,
    sessionStart: new Date(sessionStart).toISOString(),
    snapshotIntervalMs: LOG_SNAPSHOT_INTERVAL_MS,
    snapshots: logBuffer,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rusmarble-profile-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── core timing ────────────────────────────────────────────────────────────

function getOrCreate(label) {
  let s = stats.get(label);
  if (!s) {
    s = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
    stats.set(label, s);
  }
  return s;
}

function record(label, ms) {
  const s = getOrCreate(label);
  s.count++;
  s.totalMs += ms;
  s.lastMs = ms;
  if (ms > s.maxMs) s.maxMs = ms;
}

// ── pending start times for manual start/end pairs ────────────────────────
const pending = new Map(); // label → performance.now()

export const profiler = {
  start(label) {
    pending.set(label, performance.now());
  },

  end(label) {
    const t = pending.get(label);
    if (t === undefined) return;
    pending.delete(label);
    record(label, performance.now() - t);
  },

  /** Record a pre-measured duration directly. */
  record(label, ms) {
    record(label, ms);
  },

  /** Wrap a synchronous function call and record its duration. */
  measure(label, fn) {
    const t = performance.now();
    const result = fn();
    record(label, performance.now() - t);
    return result;
  },

  /** Wrap an async function call and record its duration. */
  async measureAsync(label, fn) {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      record(label, performance.now() - t);
    }
  },

  reset() {
    stats.clear();
    pending.clear();
  },

  getStats() {
    return [...stats.entries()]
      .map(([label, s]) => ({
        label,
        count: s.count,
        avgMs: s.count ? s.totalMs / s.count : 0,
        maxMs: s.maxMs,
        totalMs: s.totalMs,
        lastMs: s.lastMs,
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
  },
};

// ── HUD rendering ──────────────────────────────────────────────────────────

function renderHud() {
  if (!hudEl) return;
  const rows = profiler.getStats();
  if (!rows.length) {
    hudEl.querySelector('.bm-prof-body').textContent = '(no data yet — interact with the map)';
    return;
  }

  const maxTotal = rows[0].totalMs || 1;
  const lines = rows.map(r => {
    const bar = Math.round((r.totalMs / maxTotal) * 20);
    const barStr = '█'.repeat(bar) + '░'.repeat(20 - bar);
    const warn = r.maxMs > 50 ? ' ⚠' : r.maxMs > 16 ? ' ·' : '';
    return (
      `${barStr} ${r.label}\n` +
      `  calls:${r.count}  avg:${r.avgMs.toFixed(1)}ms  max:${r.maxMs.toFixed(1)}ms  total:${r.totalMs.toFixed(0)}ms${warn}`
    );
  });

  const logStatus = `\n\n── log: ${logBuffer.length} snapshots (${(logBuffer.length * LOG_SNAPSHOT_INTERVAL_MS / 1000).toFixed(0)}s) ──`;
  hudEl.querySelector('.bm-prof-body').textContent = lines.join('\n\n') + logStatus;
}

function scheduleHudRefresh() {
  if (!hudEl) return;
  if (rafId) return;
  rafId = setTimeout(() => {
    rafId = null;
    renderHud();
    if (hudEl) scheduleHudRefresh();
  }, HUD_REFRESH_MS);
}

function scheduleAutoReset() {
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    profiler.reset();
    scheduleAutoReset();
  }, RESET_INTERVAL_MS);
}

// ── HUD creation ───────────────────────────────────────────────────────────

function createHud() {
  if (hudEl) return;

  hudEl = document.createElement('div');
  hudEl.id = 'bm-profiler-hud';
  Object.assign(hudEl.style, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    zIndex: '2147483647',
    background: 'rgba(0,0,0,0.88)',
    color: '#d4f5d4',
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '1.4',
    padding: '8px 10px',
    borderRadius: '6px',
    maxWidth: '500px',
    maxHeight: '80vh',
    overflowY: 'auto',
    userSelect: 'none',
    pointerEvents: 'auto',
    boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
    whiteSpace: 'pre',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
    color: '#7ef07e',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
    cursor: 'move',
  });

  const title = document.createElement('span');
  title.textContent = '⏱ RusMarble Profiler';

  const hint = document.createElement('small');
  hint.textContent = '(Alt+P close · resets 30s)';
  hint.style.cssText = 'opacity:.55;font-weight:normal;font-size:10px';

  const spacer = document.createElement('span');
  spacer.style.flex = '1';

  const btnReset = makeBtn('⟳', 'Reset current window', () => {
    profiler.reset();
    renderHud();
  });

  const btnDownload = makeBtn('⬇ log', `Download profiler log (${logBuffer.length} snapshots)`, () => {
    downloadLog();
  });
  // keep download button tooltip updated
  setInterval(() => {
    btnDownload.title = `Download profiler log (${logBuffer.length} snapshots)`;
  }, 2000);

  header.appendChild(title);
  header.appendChild(hint);
  header.appendChild(spacer);
  header.appendChild(btnReset);
  header.appendChild(btnDownload);

  const body = document.createElement('div');
  body.className = 'bm-prof-body';
  body.textContent = '(no data yet — interact with the map)';

  hudEl.appendChild(header);
  hudEl.appendChild(body);

  // Drag support. The HUD is anchored by `right`, not `left`, so it does not use
  // the shared makePanelDraggable helper.
  makePointerPannable(header, {
    onStart: (e) => {
      if (e.target.tagName === 'BUTTON') return null;
      const rect = hudEl.getBoundingClientRect();
      return { right: window.innerWidth - rect.right, top: rect.top };
    },
    onMove: (dx, dy, origin) => {
      hudEl.style.right = `${origin.right - dx}px`;
      hudEl.style.top = `${origin.top + dy}px`;
    },
  });

  document.body.appendChild(hudEl);
  scheduleHudRefresh();
  scheduleAutoReset();
  renderHud();
}

function makeBtn(label, title, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.title = title;
  Object.assign(btn.style, {
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '3px',
    color: '#d4f5d4',
    cursor: 'pointer',
    fontSize: '10px',
    padding: '1px 5px',
    fontFamily: 'monospace',
  });
  btn.addEventListener('click', onClick);
  return btn;
}

function destroyHud() {
  hudEl?.remove();
  hudEl = null;
  clearTimeout(rafId);
  rafId = null;
  clearTimeout(resetTimer);
  resetTimer = null;
}

// ── keyboard toggle ────────────────────────────────────────────────────────

export function initProfiler() {
  startLogging(); // always log in background, even when HUD is closed

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'p' || e.key === 'з')) { // з = Russian п
      e.preventDefault();
      if (hudEl) {
        destroyHud();
      } else {
        createHud();
      }
    }
  });
}
