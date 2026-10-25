/** Isolated-world side of the GM shim: owns chrome.storage and forwards GM_xmlhttpRequest to
 * the service worker, which has host permissions and is not bound by page CORS. Talks to gm-shim.js over `document` CustomEvents with JSON-string
 * details — see the note there on why not window.postMessage.
 */
(() => {
  const REQ = 'x-gm-q';
  const RES = 'x-gm-a';
  const abortable = new Map();
  const emit = (msg) => document.dispatchEvent(new CustomEvent(RES, { detail: JSON.stringify(msg) }));
  const post = (msg) => emit({ kind: 'res', ...msg });

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
      case 'input': {
        const r = await chrome.runtime.sendMessage({ type: 'input', ...args });
        if (!r || r.error) return post({ id, error: r?.error || 'No answer from the extension.' });
        return post({ id, result: r.result });
      }
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
        // Binary bodies stay base64 across the JSON hop; gm-shim.js turns them back into an
        // ArrayBuffer / Blob in the page's world.
        return post({ id, event: 'onload', final: true, payload: r });
      }
      default:
        return post({ id, error: `Unknown GM op: ${op}` });
    }
  }

  document.addEventListener(REQ, (event) => {
    if (typeof event.detail !== 'string') return;
    let d;
    try { d = JSON.parse(event.detail); } catch (_) { return; }
    if (d.kind === 'ping') return emit({ kind: 'ready' });
    if (d.kind !== 'req') return;
    handle(d).catch((e) => post({ id: d.id, error: String(e?.message || e) }));
  });
  emit({ kind: 'ready' });
})();
