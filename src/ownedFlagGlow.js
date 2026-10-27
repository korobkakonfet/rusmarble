/** @file Pixel info: the region button's flag emoji glows green when the user owns that flag
 * (owning it refunds 10% of the charges spent painting in that country).
 * wplace renders the button as `<button><span class="font-flag">🇷🇺</span> <span>Region</span> …</button>`
 * and updates the emoji through a text node, so the check re-runs on text changes too.
 * @since 0.87.132
 */

/** Flag emoji by wplace country id - 1 (`countries` table of the wplace bundle). The region's
 * `countryId` is the same id the `/me` `flagsBitmap` is indexed with. */
const FLAG_EMOJIS = [
  '🇦🇫','🇦🇱','🇩🇿','🇦🇸','🇦🇩','🇦🇴','🇦🇮','🇦🇶','🇦🇬','🇦🇷','🇦🇲','🇦🇼','🇦🇺','🇦🇹','🇦🇿','🇧🇸','🇧🇭','🇧🇩','🇧🇧','🇧🇾',
  '🇧🇪','🇧🇿','🇧🇯','🇧🇲','🇧🇹','🇧🇴','🇧🇶','🇧🇦','🇧🇼','🇧🇻','🇧🇷','🇮🇴','🇧🇳','🇧🇬','🇧🇫','🇧🇮','🇨🇻','🇰🇭','🇨🇲','🇨🇦',
  '🇰🇾','🇨🇫','🇹🇩','🇨🇱','🇨🇳','🇨🇽','🇨🇨','🇨🇴','🇰🇲','🇨🇬','🇨🇰','🇨🇷','🇭🇷','🇨🇺','🇨🇼','🇨🇾','🇨🇿','🇨🇮','🇩🇰','🇩🇯',
  '🇩🇲','🇩🇴','🇪🇨','🇪🇬','🇸🇻','🇬🇶','🇪🇷','🇪🇪','🇸🇿','🇪🇹','🇫🇰','🇫🇴','🇫🇯','🇫🇮','🇫🇷','🇬🇫','🇵🇫','🇹🇫','🇬🇦','🇬🇲',
  '🇬🇪','🇩🇪','🇬🇭','🇬🇮','🇬🇷','🇬🇱','🇬🇩','🇬🇵','🇬🇺','🇬🇹','🇬🇬','🇬🇳','🇬🇼','🇬🇾','🇭🇹','🇭🇲','🇭🇳','🇭🇰','🇭🇺','🇮🇸',
  '🇮🇳','🇮🇩','🇮🇷','🇮🇶','🇮🇪','🇮🇲','🇮🇱','🇮🇹','🇯🇲','🇯🇵','🇯🇪','🇯🇴','🇰🇿','🇰🇪','🇰🇮','🇽🇰','🇰🇼','🇰🇬','🇱🇦','🇱🇻',
  '🇱🇧','🇱🇸','🇱🇷','🇱🇾','🇱🇮','🇱🇹','🇱🇺','🇲🇴','🇲🇬','🇲🇼','🇲🇾','🇲🇻','🇲🇱','🇲🇹','🇲🇭','🇲🇶','🇲🇷','🇲🇺','🇾🇹','🇲🇽',
  '🇫🇲','🇲🇩','🇲🇨','🇲🇳','🇲🇪','🇲🇸','🇲🇦','🇲🇿','🇲🇲','🇳🇦','🇳🇷','🇳🇵','🇳🇱','🇳🇨','🇳🇿','🇳🇮','🇳🇪','🇳🇬','🇳🇺','🇳🇫',
  '🇰🇵','🇲🇰','🇲🇵','🇳🇴','🇴🇲','🇵🇰','🇵🇼','🇵🇸','🇵🇦','🇵🇬','🇵🇾','🇵🇪','🇵🇭','🇵🇳','🇵🇱','🇵🇹','🇵🇷','🇶🇦','🇨🇩','🇷🇴',
  '🇷🇺','🇷🇼','🇷🇪','🇧🇱','🇸🇭','🇰🇳','🇱🇨','🇲🇫','🇵🇲','🇻🇨','🇼🇸','🇸🇲','🇸🇹','🇸🇦','🇸🇳','🇷🇸','🇸🇨','🇸🇱','🇸🇬','🇸🇽',
  '🇸🇰','🇸🇮','🇸🇧','🇸🇴','🇿🇦','🇬🇸','🇰🇷','🇸🇸','🇪🇸','🇱🇰','🇸🇩','🇸🇷','🇸🇯','🇸🇪','🇨🇭','🇸🇾','🇹🇼','🇹🇯','🇹🇿','🇹🇭',
  '🇹🇱','🇹🇬','🇹🇰','🇹🇴','🇹🇹','🇹🇳','🇹🇲','🇹🇨','🇹🇻','🇹🇷','🇺🇬','🇺🇦','🇦🇪','🇬🇧','🇺🇸','🇺🇲','🇺🇾','🇺🇿','🇻🇺','🇻🇦',
  '🇻🇪','🇻🇳','🇻🇬','🇻🇮','🇼🇫','🇪🇭','🇾🇪','🇿🇲','🇿🇼','🇦🇽','🇮🇨',
];

const FLAG_SELECTOR = 'button > span.font-flag:first-child';

let readBitmap = () => '';
let cachedBitmap = null;
/** @type {Set<string>} */
let ownedEmojis = new Set();
let scheduled = false;
let started = false;

/** Decodes wplace's `flagsBitmap`: base64 bytes, bit `id` counted from the LAST byte.
 * @param {string} base64
 * @returns {Set<string>} Owned flag emojis
 */
function decodeOwnedFlags(base64) {
  const owned = new Set();
  let bytes;
  try {
    bytes = Uint8Array.from(atob(base64 || 'AA=='), ch => ch.charCodeAt(0));
  } catch {
    return owned;
  }
  FLAG_EMOJIS.forEach((emoji, index) => {
    const id = index + 1;
    const byte = Math.floor(id / 8);
    if (byte < bytes.length && (bytes[bytes.length - 1 - byte] & (1 << (id % 8)))) {owned.add(emoji);}
  });
  return owned;
}

function scan() {
  scheduled = false;
  const bitmap = String(readBitmap() ?? '');
  if (bitmap !== cachedBitmap) {
    cachedBitmap = bitmap;
    ownedEmojis = decodeOwnedFlags(bitmap);
  }
  for (const span of document.querySelectorAll(FLAG_SELECTOR)) {
    const owned = ownedEmojis.has(span.textContent.trim());
    if (owned !== span.hasAttribute('data-rm-owned-flag')) {span.toggleAttribute('data-rm-owned-flag', owned);}
  }
}

function schedule() {
  if (scheduled) {return;}
  scheduled = true;
  requestAnimationFrame(scan);
}

/** Starts marking owned flags in the pixel info region button.
 * @param {() => (string|undefined)} getFlagsBitmap - Returns the `/me` `flagsBitmap` (base64)
 */
export function initOwnedFlagGlow(getFlagsBitmap) {
  if (started) {return;}
  started = true;
  readBitmap = getFlagsBitmap;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
}
