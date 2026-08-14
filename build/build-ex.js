/** Builds a separate "smart" variant of the userscript.
 *
 * The smart-place feature lives only in a private, gitignored patch
 * (default: experimental.local.patch). This script applies that patch to the
 * working tree, runs the normal build, writes the result to a distinct output
 * file (dist/RusMarble.smart.user.js) with its own @name/@downloadURL so it can
 * be installed alongside the regular script, then always reverts the patch.
 *
 * Usage:
 *   node build/build-smart.js            # production smart build
 *   node build/build-smart.js --dev      # development smart build
 *   PATCH_FILE=other.local.patch node build/build-smart.js
 */

import fs from 'fs';
import { execSync } from 'child_process';
import { consoleStyle } from './utils.js';

const PATCH_FILE = process.env.PATCH_FILE ?? 'experimental.local.patch';
const PATCHED_FILES = [
  'src/main.js',
  'src/templateManager.js',
  'src/hqTemplate.js',
  'src/apiManager.js',
  'src/templateSync.js',
  'src/overlay.css',
  'src/layoutI18n.js',
];
const SMART_OUT = 'dist/RusMarble.exp.user.js';
const SMART_META_OUT = 'dist/RusMarble.exp.meta.js';
// The exp build is gitignored, so it can't be served from GitHub raw like the
// regular script. It is deployed as a static file behind nginx (see
// wplacetgbot/scripts/deploy_het.sh) so Tampermonkey can auto-update it.
const SMART_DOWNLOAD_URL = 'https://wplace.zaebal.me/wplacebot/RusMarble.exp.user.js';
const SMART_UPDATE_URL = 'https://wplace.zaebal.me/wplacebot/RusMarble.exp.meta.js';
const buildFlags = process.argv.slice(2).join(' ');

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const fail = (msg, err) => {
  console.error(`${consoleStyle.RED + consoleStyle.BOLD}${msg}${consoleStyle.RESET}`, err ?? '');
  process.exit(1);
};

if (!fs.existsSync(PATCH_FILE)) {
  fail(`Patch file not found: ${PATCH_FILE}. (It is private/gitignored — restore it locally.)`);
}

// Refuse to run if the target files already have uncommitted changes: we revert
// them with `git checkout` afterwards, which would clobber unrelated edits.
const dirty = execSync(`git status --porcelain -- ${PATCHED_FILES.join(' ')}`, { encoding: 'utf8' }).trim();
if (dirty) {
  fail(`Refusing to run: uncommitted changes in patched files. Commit or stash first:\n${dirty}`);
}

// Verify the patch applies before touching anything.
try {
  execSync(`git apply --check ${PATCH_FILE}`, { stdio: 'pipe' });
} catch (err) {
  fail(`Patch does not apply cleanly (${PATCH_FILE}). Regenerate it against current source.`, err?.stderr?.toString?.());
}

// build.js overwrites dist/RusMarble.user.js with the patched code, so keep a
// copy of the clean (committed) regular artifact to restore afterwards.
// The patch also carries CSS and the version badge, so those artifacts need the same treatment.
const REGULAR_OUT = 'dist/RusMarble.user.js';
const REGULAR_SIDE_ARTIFACTS = ['dist/RusMarble.user.css', 'dist/RusMarble.user.css.map.json', 'docs/README.md'];
const regularBackup = fs.existsSync(REGULAR_OUT) ? fs.readFileSync(REGULAR_OUT) : null;
const sideBackups = REGULAR_SIDE_ARTIFACTS
  .filter((file) => fs.existsSync(file))
  .map((file) => [file, fs.readFileSync(file)]);

let applied = false;
try {
  console.log(`${consoleStyle.BLUE}Applying ${PATCH_FILE}...${consoleStyle.RESET}`);
  run(`git apply ${PATCH_FILE}`);
  applied = true;

  console.log(`${consoleStyle.BLUE}Building smart variant...${consoleStyle.RESET}`);
  run(`node build/build.js ${buildFlags}`.trim());

  // Derive the smart output from the freshly built (patched) regular output.
  let code = fs.readFileSync(REGULAR_OUT, 'utf8');
  code = code
    .replace(/(^\/\/ @name\s+).*$/m, '$1Rus Marble (Exp)')
    .replace(/(^\/\/ @downloadURL\s+).*$/m, `$1${SMART_DOWNLOAD_URL}`)
    .replace(/(^\/\/ @updateURL\s+).*$/m, `$1${SMART_UPDATE_URL}`);
  fs.writeFileSync(SMART_OUT, code, 'utf8');

  // Emit a standalone metadata block for @updateURL so Tampermonkey only pulls
  // the header (not the whole bundle) when checking for updates.
  const metaMatch = code.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*$/m);
  if (!metaMatch) {
    fail('Could not extract UserScript metadata block for exp meta file.');
  }
  fs.writeFileSync(SMART_META_OUT, `${metaMatch[0]}\n`, 'utf8');

  console.log(`${consoleStyle.GREEN + consoleStyle.BOLD}Smart build complete → ${SMART_OUT}, ${SMART_META_OUT}${consoleStyle.RESET}`);
} catch (err) {
  fail('Smart build failed', err?.message ?? err);
} finally {
  // Restore the clean regular artifact (build.js clobbered it with smart code).
  if (regularBackup) {
    fs.writeFileSync(REGULAR_OUT, regularBackup);
  }
  for (const [file, contents] of sideBackups) {
    fs.writeFileSync(file, contents);
  }
  if (applied) {
    console.log(`${consoleStyle.BLUE}Reverting patch...${consoleStyle.RESET}`);
    try {
      execSync(`git checkout -- ${PATCHED_FILES.join(' ')}`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`${consoleStyle.RED + consoleStyle.BOLD}WARNING: failed to revert patched files — do it manually:${consoleStyle.RESET} git checkout -- ${PATCHED_FILES.join(' ')}`);
    }
  }
}
