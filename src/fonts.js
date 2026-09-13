// Fonts bundled into the userscript. esbuild inlines `.ttf` imports as data: URLs
// (see the `loader` option in build/build.js), so no network request is needed.
import ruxpixelPantinUrl from './fonts/RuxpixelPantin.ttf';
import ruspixelPantin2Url from './fonts/RuspixelPantin2.ttf';

/** Font families registered by the userscript, usable via `font-family` in CSS. */
export const BUNDLED_FONTS = [
  { family: 'RuxpixelPantin', url: ruxpixelPantinUrl, format: 'truetype' },
  { family: 'RuspixelPantin2', url: ruspixelPantin2Url, format: 'truetype' },
];

/** Builds the `@font-face` rules for every bundled font.
 * @returns {string} CSS text to pass to GM.addStyle
 */
export function buildFontFaceCss() {
  return BUNDLED_FONTS.map(({ family, url, format }) =>
    `@font-face{font-family:"${family}";src:url("${url}") format("${format}");font-weight:normal;font-style:normal;font-display:swap;}`
  ).join('\n');
}
