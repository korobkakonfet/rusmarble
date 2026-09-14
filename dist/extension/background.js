/** Service worker: performs GM_xmlhttpRequest fetches on behalf of the content script. */
const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'xhr') return false;
  (async () => {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = msg.timeout > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, msg.timeout) : null;
    try {
      const res = await fetch(msg.url, {
        method: msg.method || 'GET',
        headers: msg.headers || {},
        body: msg.data ?? undefined,
        credentials: msg.anonymous ? 'omit' : 'include',
        signal: ctrl.signal,
      });
      const payload = {
        status: res.status,
        statusText: res.statusText,
        finalUrl: res.url,
        responseHeaders: [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\r\n'),
      };
      const type = String(msg.responseType || '').toLowerCase();
      if (type === 'arraybuffer' || type === 'blob') {
        payload.responseB64 = toB64(await res.arrayBuffer());
      } else {
        const text = await res.text();
        payload.responseText = text;
        if (type === 'json') {
          try { payload.response = JSON.parse(text); } catch { payload.response = null; }
        } else {
          payload.response = text;
        }
      }
      sendResponse(payload);
    } catch (e) {
      sendResponse({ error: String(e?.message || e), event: timedOut ? 'ontimeout' : 'onerror' });
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  return true; // keep the channel open for the async response
});
