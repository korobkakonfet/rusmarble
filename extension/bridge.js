/** Isolated-world side of the GM shim: owns chrome.storage and forwards GM_xmlhttpRequest to
 * the service worker (which has host permissions and is not bound by page CORS).
 */
(() => {
  const CH = '__rm_gm__';
  const abortable = new Map();
  const post = (msg) => window.postMessage({ [CH]: 'res', ...msg }, location.origin);

  const fromB64 = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };

  async function handle(d) {
    const { id, op, args } = d;
    switch (op) {
      case 'get': {
        const r = await chrome.storage.local.get(args.key);
        return post({ id, result: r[args.key] });
      }
      case 'set':
        await chrome.storage.local.set({ [args.key]: args.value });
        return post({ id, result: undefined });
      case 'delete':
        await chrome.storage.local.remove(args.key);
        return post({ id, result: undefined });
      case 'list':
        return post({ id, result: Object.keys(await chrome.storage.local.get(null)) });
      case 'abort':
        abortable.get(id)?.abort?.();
        return;
      case 'xhr': {
        const token = { aborted: false, abort() { this.aborted = true; } };
        abortable.set(id, token);
        let r;
        try {
          r = await chrome.runtime.sendMessage({ type: 'xhr', ...args });
        } catch (e) {
          r = { error: String(e?.message || e), event: 'onerror' };
        }
        abortable.delete(id);
        if (token.aborted) return;
        if (!r || r.error) {
          return post({ id, event: r?.event || 'onerror', final: true, payload: { status: 0, statusText: '', responseText: '', response: null, error: r?.error } });
        }
        if (r.responseB64 !== undefined) {
          const buf = fromB64(r.responseB64);
          delete r.responseB64;
          r.response = args.responseType === 'blob' ? new Blob([buf]) : buf;
        }
        return post({ id, event: 'onload', final: true, payload: r });
      }
      default:
        return post({ id, error: `Unknown GM op: ${op}` });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data[CH] === undefined) return;
    const d = event.data;
    if (d[CH] === 'ping') return window.postMessage({ [CH]: 'ready' }, location.origin);
    if (d[CH] !== 'req') return;
    handle(d).catch((e) => post({ id: d.id, error: String(e?.message || e) }));
  });
  window.postMessage({ [CH]: 'ready' }, location.origin);
})();
