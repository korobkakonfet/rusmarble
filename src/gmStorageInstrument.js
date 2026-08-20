/** @file Instrumentation for the GM storage channel.
 *
 * Chrome raises "Unchecked runtime.lastError: Message exceeded maximum allowed size of 64MiB"
 * from the extension side, asynchronously, after the offending message has already been posted.
 * Nothing in page/sandbox script can catch it — by the time it appears, the call that caused it
 * has long since returned (or silently never settled). So instead of trying to trap the error,
 * this records every GM storage call we make: key, payload size, how long it took, whether it
 * ever settled, and the stack of whoever called it.
 *
 * Correlating that log against the console errors answers the only question that matters first:
 * whether these messages originate from this userscript at all. If the errors appear while this
 * log shows no large payload and no unsettled call, the source is another extension.
 *
 * Read it from the page console with `storageLog()`.
 * @since 0.87.80
 */

/** Calls at or above this many characters are flagged; Chrome's hard ceiling is 64MiB. */
const LARGE_PAYLOAD_CHARS = 1 * 1024 * 1024;

/** Ring buffer cap, so a chatty session cannot grow this without bound. */
const MAX_ENTRIES = 500;

const entries = [];
let sequence = 0;

const push = (entry) => {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  return entry;
};

/** Caller location, minus the frames belonging to this file. */
const captureCaller = () => {
  const stack = new Error().stack || '';
  return stack
    .split('\n')
    .slice(1)
    .filter((line) => !line.includes('gmStorageInstrument'))
    .slice(0, 4)
    .map((line) => line.trim())
    .join(' | ');
};

const sizeOf = (value) => {
  if (typeof value === 'string') return value.length;
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch (_) {
    return -1; // not serializable; the size is whatever Tampermonkey makes of it
  }
};

/** Wraps one GM storage method so every call through it is recorded.
 * The wrapper never changes the result or swallows a rejection — it only observes.
 */
const instrument = (method, getPayloadSize) => {
  const original = GM[method];
  if (typeof original !== 'function' || original.__bmInstrumented) return;

  const wrapped = function (...args) {
    const entry = push({
      seq: sequence++,
      method,
      key: typeof args[0] === 'string' ? args[0] : String(args[0]),
      chars: getPayloadSize(args),
      startedAt: Date.now(),
      settled: false,
      ms: null,
      outcome: 'pending',
      caller: captureCaller(),
    });
    if (entry.chars >= LARGE_PAYLOAD_CHARS) entry.large = true;

    let result;
    try {
      result = original.apply(GM, args);
    } catch (error) {
      entry.settled = true;
      entry.outcome = 'threw';
      entry.error = error?.message || String(error);
      entry.ms = Date.now() - entry.startedAt;
      throw error;
    }

    return Promise.resolve(result).then(
      (value) => {
        entry.settled = true;
        entry.outcome = 'ok';
        entry.ms = Date.now() - entry.startedAt;
        if (method === 'getValue') entry.chars = sizeOf(value);
        return value;
      },
      (error) => {
        entry.settled = true;
        entry.outcome = 'rejected';
        entry.error = error?.message || String(error);
        entry.ms = Date.now() - entry.startedAt;
        throw error;
      }
    );
  };
  wrapped.__bmInstrumented = true;
  GM[method] = wrapped;
};

/** Installs the wrappers. Safe to call more than once. */
export function installGmStorageInstrumentation() {
  if (typeof GM !== 'object' || !GM) return;
  // setValue's payload is argument 2; every other method carries only a key.
  instrument('setValue', (args) => sizeOf(args[1]));
  instrument('getValue', () => 0); // filled in on resolve, once the value is known
  instrument('deleteValue', () => 0);
  instrument('listValues', () => 0);

  // document.head is the same node in the sandbox and the page, which is why the other debug
  // bridges (__bmOverlayIssues, __bmCanvas) hang off it too.
  try {
    document.head.__bmStorageLog = () => getGmStorageLog();
  } catch (_) {}
}

/** Snapshot of what has crossed the storage channel so far.
 * `pending` is the interesting field: a call that never settled is the signature of a message
 * Chrome refused, and its `caller` names the code that sent it.
 */
export function getGmStorageLog() {
  const calls = entries.map((entry) => ({
    ...entry,
    MiB: entry.chars > 0 ? (entry.chars / 1048576).toFixed(3) : '0',
  }));
  const pending = calls.filter((entry) => !entry.settled);
  const large = calls.filter((entry) => entry.large);
  const failed = calls.filter((entry) => entry.outcome === 'threw' || entry.outcome === 'rejected');
  let totalWritten = 0;
  for (const entry of calls) {
    if (entry.method === 'setValue' && entry.chars > 0) totalWritten += entry.chars;
  }
  return {
    totalCalls: calls.length,
    pendingCount: pending.length,
    largeCount: large.length,
    failedCount: failed.length,
    totalWrittenMiB: (totalWritten / 1048576).toFixed(2),
    biggestCall: calls.slice().sort((a, b) => b.chars - a.chars)[0] || null,
    pending,
    large,
    failed,
    calls,
  };
}
