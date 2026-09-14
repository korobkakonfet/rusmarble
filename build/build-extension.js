/** Packages the built userscript (dist/RusMarble.user.js) as a Chrome MV3 extension.
 * Run `npm run build` first — this script only wraps the existing bundle:
 *   dist/extension/          unpacked extension (load via chrome://extensions)
 *   dist/RusMarble.extension.zip   upload to the Chrome Web Store
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { consoleStyle } from './utils.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'dist/extension');
const SRC = path.join(ROOT, 'extension');
const userscriptPath = path.join(ROOT, 'dist/RusMarble.user.js');
const metaPath = path.join(ROOT, 'src/RusMarble.meta.js');

if (!fs.existsSync(userscriptPath)) {
  console.error(`${consoleStyle.RED}dist/RusMarble.user.js not found — run \`npm run build\` first${consoleStyle.RESET}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const meta = fs.readFileSync(metaPath, 'utf8');
const userscript = fs.readFileSync(userscriptPath, 'utf8');

// Strip the ==UserScript== banner; the body is an esbuild IIFE
const bannerEnd = userscript.indexOf('// ==/UserScript==');
const body = bannerEnd === -1 ? userscript : userscript.slice(bannerEnd + '// ==/UserScript=='.length);

const metaValues = (key) => [...meta.matchAll(new RegExp(`^// @${key}\\s+(.+)$`, 'gm'))].map((m) => m[1].trim());
const scriptName = metaValues('name')[0] || 'Rus Marble';
const connectHosts = metaValues('connect').map((h) => `https://${h}/*`);
const matches = metaValues('match');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });

// page.js = GM shim + userscript body, both in the MAIN world at document_start
const gmInfo = {
  script: { name: scriptName, version: pkg.version, namespace: metaValues('namespace')[0] || '' },
  scriptHandler: 'RusMarble Extension',
  version: pkg.version,
};
const shim = fs.readFileSync(path.join(SRC, 'gm-shim.js'), 'utf8').replace('__GM_INFO__', JSON.stringify(gmInfo));
const pageJs = `${shim}\n(function (GM, GM_info, GM_xmlhttpRequest, unsafeWindow) {\n${body}\n})(window.__rmGm.GM, window.__rmGm.GM_info, window.__rmGm.GM_xmlhttpRequest, window.__rmGm.unsafeWindow);\n`;
fs.writeFileSync(path.join(OUT, 'page.js'), pageJs, 'utf8');
fs.copyFileSync(path.join(SRC, 'bridge.js'), path.join(OUT, 'bridge.js'));
fs.copyFileSync(path.join(SRC, 'background.js'), path.join(OUT, 'background.js'));

// Icons: Chrome Web Store wants 128px; resize the 32px logo with Pillow when available
const logo = path.join(ROOT, 'dist/assets/logo_rusmarble.png');
const iconSizes = [16, 32, 48, 128];
let iconsOk = false;
try {
  execSync(`python3 -c "
from PIL import Image
im = Image.open('${logo}').convert('RGBA')
for s in ${JSON.stringify(iconSizes)}:
    im.resize((s, s), Image.NEAREST).save('${path.join(OUT, 'icons')}/icon%d.png' % s)
"`, { stdio: 'pipe' });
  iconsOk = true;
} catch {
  console.warn(`${consoleStyle.YELLOW}Pillow not available — copying the 32px logo for every icon size${consoleStyle.RESET}`);
  for (const s of iconSizes) fs.copyFileSync(logo, path.join(OUT, 'icons', `icon${s}.png`));
}
const icons = Object.fromEntries(iconSizes.map((s) => [String(s), `icons/icon${s}.png`]));

const manifest = {
  manifest_version: 3,
  name: scriptName,
  version: pkg.version,
  description: 'Overlay templates, stats and helpers for wplace.live. Not affiliated with wplace.live.',
  homepage_url: pkg.homepage,
  icons,
  permissions: ['storage'],
  host_permissions: [...new Set([...matches, ...connectHosts])],
  background: { service_worker: 'background.js' },
  content_scripts: [
    { matches, js: ['bridge.js'], run_at: 'document_start', all_frames: false },
    { matches, js: ['page.js'], run_at: 'document_start', all_frames: false, world: 'MAIN' },
  ],
  minimum_chrome_version: '111',
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

// Zip for the Web Store
const zipPath = path.join(ROOT, 'dist/RusMarble.extension.zip');
fs.rmSync(zipPath, { force: true });
try {
  execSync(`python3 -c "import shutil; shutil.make_archive('${zipPath.replace(/\.zip$/, '')}', 'zip', '${OUT}')"`, { stdio: 'pipe' });
  console.log(`Zip written: ${path.relative(ROOT, zipPath)}`);
} catch {
  console.warn(`${consoleStyle.YELLOW}python3 not available — zip dist/extension manually for the Web Store${consoleStyle.RESET}`);
}
console.log(`${consoleStyle.GREEN + consoleStyle.BOLD}Extension built: ${path.relative(ROOT, OUT)} (v${pkg.version}, icons ${iconsOk ? 'resized' : 'copied'})${consoleStyle.RESET}`);
