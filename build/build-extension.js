/** Packages the built userscript (dist/RusMarble.user.js) as a Chrome MV3 extension.
 * Run `npm run build` first — this script only wraps the existing bundle:
 *   dist/extension/          unpacked extension (load via chrome://extensions)
 *   dist/RusMarble.extension.zip   upload to the Chrome Web Store
 *
 * With --exp it wraps the private exp bundle (dist/RusMarble.exp.user.js, `npm run build:ex`)
 * into dist/extension-exp/ instead, with any extra service-worker files from src/exp/extension/.
 * Local use only: never zipped.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { consoleStyle } from './utils.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXP = process.argv.includes('--exp');
const OUT = path.join(ROOT, EXP ? 'dist/extension-exp' : 'dist/extension');
const SRC = path.join(ROOT, 'extension');
const userscriptPath = path.join(ROOT, EXP ? 'dist/RusMarble.exp.user.js' : 'dist/RusMarble.user.js');
const metaPath = path.join(ROOT, EXP ? 'dist/RusMarble.exp.meta.js' : 'src/RusMarble.meta.js');

if (!fs.existsSync(userscriptPath)) {
  console.error(`${consoleStyle.RED}${path.relative(ROOT, userscriptPath)} not found — run \`npm run ${EXP ? 'build:ex' : 'build'}\` first${consoleStyle.RESET}`);
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
// The shim parks its objects on window.__rmGm; take them and delete it before the page's own
// scripts run, so nothing of ours stays on the page's window.
const pageJs = `${shim}\n(() => {\nconst __rm = window.__rmGm;\ndelete window.__rmGm;\n(function (GM, GM_info, GM_xmlhttpRequest, unsafeWindow) {\n${body}\n})(__rm.GM, __rm.GM_info, __rm.GM_xmlhttpRequest, __rm.unsafeWindow);\n})();\n`;
fs.writeFileSync(path.join(OUT, 'page.js'), pageJs, 'utf8');
fs.copyFileSync(path.join(SRC, 'bridge.js'), path.join(OUT, 'bridge.js'));
let background = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');
if (EXP) {
  const expDir = path.join(ROOT, 'src/exp/extension');
  for (const file of fs.existsSync(expDir) ? fs.readdirSync(expDir).filter((f) => f.endsWith('.js')).sort() : []) {
    background += `\n${fs.readFileSync(path.join(expDir, file), 'utf8')}`;
  }
}
fs.writeFileSync(path.join(OUT, 'background.js'), background, 'utf8');

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

// Each exp service-worker file declares what it needs on a `// @permission name` line.
const expPermissions = [];
if (EXP) {
  const expDir = path.join(ROOT, 'src/exp/extension');
  for (const file of fs.existsSync(expDir) ? fs.readdirSync(expDir) : []) {
    for (const m of fs.readFileSync(path.join(expDir, file), 'utf8').matchAll(/^\/\/ @permission\s+(\S+)/gm)) {
      if (!expPermissions.includes(m[1])) expPermissions.push(m[1]);
    }
  }
}

const manifest = {
  manifest_version: 3,
  name: scriptName,
  version: pkg.version,
  description: 'Overlay templates, stats and helpers for wplace.live. Not affiliated with wplace.live.',
  homepage_url: pkg.homepage,
  icons,
  permissions: EXP ? ['storage', ...expPermissions] : ['storage'],
  host_permissions: [...new Set([...matches, ...connectHosts])],
  background: { service_worker: 'background.js' },
  content_scripts: [
    { matches, js: ['bridge.js'], run_at: 'document_start', all_frames: false },
    { matches, js: ['page.js'], run_at: 'document_start', all_frames: false, world: 'MAIN' },
  ],
  minimum_chrome_version: '111',
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

if (EXP) {
  console.log(`${consoleStyle.GREEN + consoleStyle.BOLD}Exp extension built: ${path.relative(ROOT, OUT)} (v${pkg.version}, extra permissions: ${expPermissions.join(', ') || 'none'}, not zipped)${consoleStyle.RESET}`);
  process.exit(0);
}

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
