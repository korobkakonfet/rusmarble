/** GM.* / GM_xmlhttpRequest shim for the Chrome extension build.
 * Runs in the page's MAIN world (document_start) right before the userscript body, so the
 * userscript sees the same globals Tampermonkey would give it. Storage and cross-origin requests
 * are relayed to bridge.js (isolated world), because the MAIN world has no access to chrome.*
 * APIs.
 *
 * The relay is a pair of `document` CustomEvents with JSON-string details, not
 * window.postMessage: every `message` listener on the page would see postMessage traffic,
 * while a CustomEvent only reaches listeners registered for its name, and a string detail is
 * the one kind that survives the hop between JS worlds. The natives are captured here, at
 * document_start, before the page's scripts run.
 */
(() => {
  const REQ = 'x-gm-q';
  const RES = 'x-gm-a';
  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  const NativeCustomEvent = CustomEvent;
  const emit = (name, msg) => nativeDispatch.call(document, new NativeCustomEvent(name, { detail: JSON.stringify(msg) }));
  const pending = new Map();
  const queue = [];
  let ready = false;
  let seq = 0;

  const raw = (msg) => emit(REQ, { kind: 'req', ...msg });
  const send = (msg) => (ready ? raw(msg) : queue.push(msg));

  const fromB64 = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };

  document.addEventListener(RES, (event) => {
    if (typeof event.detail !== 'string') return;
    let d;
    try { d = JSON.parse(event.detail); } catch (_) { return; }
    if (d.kind === 'ready') {
      ready = true;
      queue.splice(0).forEach(raw);
      return;
    }
    if (d.kind !== 'res') return;
    const p = pending.get(d.id);
    if (!p) return;
    if (d.event) {
      if (d.final) pending.delete(d.id);
      const payload = d.payload;
      if (payload && payload.responseB64 !== undefined) {
        const buf = fromB64(payload.responseB64);
        delete payload.responseB64;
        payload.response = p.responseType === 'blob' ? new Blob([buf]) : buf;
      }
      try { p.handlers?.[d.event]?.(payload); } catch (e) { console.error(e); }
      return;
    }
    pending.delete(d.id);
    if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
  });
  // bridge.js may have started before or after us — cover both orders
  emit(REQ, { kind: 'ping' });

  const call = (op, args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    send({ id, op, args });
  });

  const GM = {
    addStyle(css) {
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
      return style;
    },
    async getValue(key, defaultValue) {
      const value = await call('get', { key });
      return value === undefined ? defaultValue : value;
    },
    setValue: (key, value) => call('set', { key, value }),
    deleteValue: (key) => call('delete', { key }),
    listValues: () => call('list', {}),
    // Relay to an optional service-worker handler; builds without one answer with an error.
    rmInput: (op, args) => call('input', { op, ...(args || {}) }),
    info: __GM_INFO__,
  };

  const GM_xmlhttpRequest = (details) => {
    const id = ++seq;
    const { onload, onerror, ontimeout, onabort, onprogress, onreadystatechange, ...args } = details || {};
    pending.set(id, { handlers: { onload, onerror, ontimeout, onabort }, responseType: args.responseType, resolve() {}, reject() {} });
    send({ id, op: 'xhr', args });
    return {
      abort() {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        send({ id, op: 'abort', args: {} });
        p.handlers.onabort?.({ status: 0, responseText: '', response: null });
      },
    };
  };
  GM.xmlHttpRequest = GM_xmlhttpRequest;

  // Picked up and deleted by the wrapper build-extension.js puts around the userscript body.
  window.__rmGm = { GM, GM_info: GM.info, GM_xmlhttpRequest, unsafeWindow: window };
})();
