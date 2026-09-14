/** GM.* / GM_xmlhttpRequest shim for the Chrome extension build.
 * Runs in the page's MAIN world (document_start) right before the userscript body, so the
 * userscript sees the same globals Tampermonkey would give it. Storage and cross-origin
 * requests are relayed to bridge.js (isolated world) over window.postMessage, because the
 * MAIN world has no access to chrome.* APIs.
 */
(() => {
  const CH = '__rm_gm__';
  const pending = new Map();
  const queue = [];
  let ready = false;
  let seq = 0;

  const raw = (msg) => window.postMessage({ [CH]: 'req', ...msg }, location.origin);
  const send = (msg) => (ready ? raw(msg) : queue.push(msg));

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data[CH] === undefined) return;
    const d = event.data;
    if (d[CH] === 'ready') {
      ready = true;
      queue.splice(0).forEach(raw);
      return;
    }
    if (d[CH] !== 'res') return;
    const p = pending.get(d.id);
    if (!p) return;
    if (d.event) {
      if (d.final) pending.delete(d.id);
      try { p.handlers?.[d.event]?.(d.payload); } catch (e) { console.error(e); }
      return;
    }
    pending.delete(d.id);
    if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
  });
  // bridge.js may have started before or after us — cover both orders
  window.postMessage({ [CH]: 'ping' }, location.origin);

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
    info: __GM_INFO__,
  };

  const GM_xmlhttpRequest = (details) => {
    const id = ++seq;
    const { onload, onerror, ontimeout, onabort, onprogress, onreadystatechange, ...args } = details || {};
    pending.set(id, { handlers: { onload, onerror, ontimeout, onabort }, resolve() {}, reject() {} });
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

  window.__rmGm = { GM, GM_info: GM.info, GM_xmlhttpRequest, unsafeWindow: window };
})();
