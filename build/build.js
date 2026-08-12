/** Builds the userscript using esbuild.
 * This will:
 * 1. Update the package version across the entire project
 * 2. Bundle the JS files into one file (esbuild)
 * 3. Bundle the CSS files into one file (esbuild)
 * 4. Compress & obfuscate the bundled JS file (terner)
 * 5. Runs the CSS selector mangler (cssMandler.js)
 * @since 0.0.6
*/

// ES Module imports
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { consoleStyle } from './utils.js';
import mangleSelectors from './cssMangler.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// CommonJS imports (require)
const terser = require('terser');

const isGitHub = !!process.env?.GITHUB_ACTIONS; // Is this running in a GitHub Action Workflow?'
const cliFlags = new Set(
  process.argv
    .slice(2)
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean)
);
const cliMode = cliFlags.has('--dev') || cliFlags.has('-d')
  ? 'development'
  : cliFlags.has('--prod') || cliFlags.has('-p')
    ? 'production'
    : null;
const buildModeRaw = String(cliMode ?? process.env.BUILD_MODE ?? process.env.NODE_ENV ?? 'production')
  .trim()
  .toLowerCase();
const isDebug = ['dev', 'development', 'debug', 'local'].includes(buildModeRaw);
const isProduction = !isDebug;
const shouldMangleProperties = process.env?.MANGLE_PROPERTIES === '1';
const localCssUrl = 'http://localhost:8000/dist/RusMarble.user.css';
const prodCssUrl = 'https://raw.githubusercontent.com/korobkakonfet/rusmarble/refs/heads/custom-improve/dist/RusMarble.user.css';
const cssBmFile = process.env.CSS_BM_FILE ?? (isProduction ? prodCssUrl : localCssUrl);
const localTemplateSyncUrl = 'http://localhost:8003';
const prodTemplateSyncUrl = 'https://wplace.zaebal.me';
const templateSyncBaseUrl = process.env.TEMPLATE_SYNC_BASE_URL ?? (isProduction ? prodTemplateSyncUrl : localTemplateSyncUrl);
const prodChatWsUrl = 'wss://wplace.zaebal.me/ws/chat';
const chatWsUrl = process.env.CHAT_WS_URL ?? (isProduction ? prodChatWsUrl : '');

console.log(`${consoleStyle.BLUE}Starting build...${consoleStyle.RESET}`);
console.log(`Mode: ${isProduction ? 'production' : 'development'} (${buildModeRaw || 'production'})`);

// Tries to build the wiki if build.js is run in a GitHub Workflow
// if (isGitHub) {
//   try {
//     console.log(`Generating JSDoc...`);
//     execSync(`npx jsdoc src/ -r -d docs -t node_modules/minami`, { stdio: "inherit" });
//     console.log(`JSDoc built ${consoleStyle.GREEN}successfully${consoleStyle.RESET}`);
//   } catch (error) {
//     console.error(`${consoleStyle.RED + consoleStyle.BOLD}Failed to generate JSDoc${consoleStyle.RESET}:`, error);
//     process.exit(1);
//   }
// }

// Tries to bump the version
try {
  execSync('node build/compile-wasm.js', { stdio: 'inherit' });
  console.log(`WASM assets compiled ${consoleStyle.GREEN}successfully${consoleStyle.RESET}`);
  const update = execSync('node build/update-version.js', { stdio: 'inherit' });
  console.log(`Version updated in meta file ${consoleStyle.GREEN}successfully${consoleStyle.RESET}`);
} catch (error) {
  console.error(`${consoleStyle.RED + consoleStyle.BOLD}Failed to update version number${consoleStyle.RESET}:`, error);
  process.exit(1);
}

// Fetches the userscript metadata banner
const metaContent = fs.readFileSync('src/RusMarble.meta.js', 'utf8');
const blueMetaContent = fs.existsSync('src/BlueMarble.meta.js')
  ? fs.readFileSync('src/BlueMarble.meta.js', 'utf8')
  : null;

// Compiles a string array of all CSS files
const cssFiles = fs.readdirSync('src/')
  .filter(file => file.endsWith('.css'))
  .map(file => `src/${file}`);
let tempCssEntryPoint = null;
let cssEntryPoint = cssFiles[0];
if (cssFiles.length > 1) {
  tempCssEntryPoint = 'build/.tmp-entry.css';
  const imports = cssFiles
    .map((file) => {
      const relativeImport = path.relative(
        path.dirname(tempCssEntryPoint),
        file
      ).replaceAll('\\', '/');
      return `@import "./${relativeImport}";`;
    })
    .join('\n');
  fs.writeFileSync(tempCssEntryPoint, `${imports}\n`, 'utf8');
  cssEntryPoint = tempCssEntryPoint;
}

// Compiles the CSS files
await esbuild.build({
  entryPoints: [cssEntryPoint],
  bundle: true,
  outfile: 'dist/RusMarble.user.css',
  minify: true
});
if (tempCssEntryPoint && fs.existsSync(tempCssEntryPoint)) {
  fs.unlinkSync(tempCssEntryPoint);
}
if (blueMetaContent) {
  fs.copyFileSync('dist/RusMarble.user.css', 'dist/BlueMarble.user.css');
}
const inlineCss = fs.readFileSync('dist/RusMarble.user.css', 'utf8');

// Compiles the JS files
const workerBundle = await esbuild.build({
  entryPoints: ['src/templatePixelWorker.js'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  // The worker is inlined into the userscript as a string, so its size lands directly in the
  // shipped file — 122K unminified vs 48K minified. Safe to minify: handlers are dispatched by
  // string key (handlers[type]) and esbuild does not rename property names.
  minify: isProduction,
}).catch(() => process.exit(1));
// With write:false and no outfile, esbuild names the output "<stdout>" — matching on a .js
// suffix silently found nothing, so the worker source was inlined as an empty string and the
// whole worker pool disabled itself at runtime. Fall back to the single output file.
const workerBundleJS = workerBundle.outputFiles.find(file => file.path.endsWith('.js'))
  ?? workerBundle.outputFiles[0];
if (!workerBundleJS?.text?.trim()) {
  console.error('\x1b[31mWorker bundle is empty — template workers would be disabled at runtime.\x1b[0m');
  process.exit(1);
}

const resultEsbuild = await esbuild.build({
  entryPoints: ['src/main.js'], // "Infect" the files from this point (it spreads from this "patient 0")
  bundle: true, // Should the code be bundled?
  outfile: 'dist/RusMarble.user.js', // The file the bundled code is exported to
  define: {
    __CSS_BM_FILE__: JSON.stringify(cssBmFile),
    __TEMPLATE_SYNC_BASE_URL__: JSON.stringify(templateSyncBaseUrl),
    __CHAT_WS_URL__: JSON.stringify(chatWsUrl),
    __INLINE_CSS__: JSON.stringify(inlineCss),
    __TEMPLATE_PIXEL_WORKER_SOURCE__: JSON.stringify(workerBundleJS?.text || '')
  },
  format: 'iife', // What format the bundler bundles the code into
  target: 'es2020', // What is the minimum version/year that should be supported? When omited, it attempts to support backwards compatability with legacy browsers
  platform: 'browser', // The platform the bundled code will be operating on
  legalComments: 'inline', // What level of legal comments are preserved? (Hard: none, Soft: inline)
  minify: false, // Should the code be minified?
  write: false, // Should we write the outfile to the disk?
}).catch(() => process.exit(1));

// Retrieves the JS file
const resultEsbuildJS = resultEsbuild.outputFiles.find(file => file.path.endsWith('.js'));

// Obfuscates the JS file
let resultTerser = await terser.minify(resultEsbuildJS.text, {
  mangle: {
    //toplevel: true, // Obfuscate top-level class/function names
    keep_classnames: false, // Should class names be preserved?
    keep_fnames: false, // Should function names be preserved?
    reserved: [], // List of keywords to preserve
    ...(shouldMangleProperties ? {
      properties: {
        // regex: /.*/, // Yes, I am aware I should be using a RegEx. Yes, like you, I am also suprised the userscript still functions
        keep_quoted: true, // Should names in quotes be preserved?
        reserved: [
          'tx', 'ty', 'px', 'py', 'willReadFrequently',
          // Chat protocol / API fields (avoid mangling so production builds match server contract)
          'type', 'text', 'user', 'username', 'name', 'Lt', 'device_id',
          'reply_to', 'id', 'ts', 'auth_token', 'message', 'retry_after', 'scope',
          'banned', 'notifications', 'reason', 'banned_at', 'created_at', 'messages',
          'identifier', 'ip', 'device', 'message_id', 'ban_id'
        ] // What properties should be preserved?
      }
    } : {}),
  },
  format: {
    comments: 'some' // Save legal comments
  },
  compress: {
    dead_code: isProduction, // Should unreachable code be removed?
    drop_console: isProduction, // Should console code be removed?
    drop_debugger: isProduction, // SHould debugger code be removed?
    passes: 2 // How many times terser will compress the code
  }
});

if (isDebug) resultTerser.code = resultEsbuildJS.text; // no obfuscation

// Writes the obfuscated/mangled JS code to a file
fs.writeFileSync('dist/RusMarble.user.js', resultTerser.code, 'utf8');

let importedMapCSS = {}; // The imported CSS map

// Import a previous CSS map in local builds to keep selector names stable across runs.
// GitHub builds start from a clean workspace and generate a fresh mapping artifact.
if (!isDebug) {
  if (!isGitHub) {
    try {
      importedMapCSS = JSON.parse(fs.readFileSync('dist/RusMarble.user.css.map.json', 'utf8'));
    } catch {
      console.log(`${consoleStyle.YELLOW}Warning! Could not find a CSS map to import. A 100% new CSS map will be generated...${consoleStyle.RESET}`);
    }
  }

  // Mangle CSS selectors for production-style builds and return a mapping when enabled.
  const mapCSS = mangleSelectors({
    inputPrefix: 'bm-',
    outputPrefix: 'bm-',
    pathJS: 'dist/RusMarble.user.js',
    pathCSS: 'dist/RusMarble.user.css',
    importMap: importedMapCSS,
    returnMap: isProduction
  });

  // If a map was returned, write it to the file
  if (mapCSS) {
    fs.writeFileSync('dist/RusMarble.user.css.map.json', JSON.stringify(mapCSS, null, 2));
  }
}

// Adds the banner
fs.writeFileSync(
  'dist/RusMarble.user.js', 
  metaContent + fs.readFileSync('dist/RusMarble.user.js', 'utf8').replace(
    '"<placeholder CSS>"',
    JSON.stringify(fs.readFileSync('dist/RusMarble.user.css', 'utf8'))
  ), 
  'utf8'
);
if (blueMetaContent) {
  const rusmarbleUserscript = fs.readFileSync('dist/RusMarble.user.js', 'utf8');
  const blueBody = rusmarbleUserscript.startsWith(metaContent)
    ? rusmarbleUserscript.slice(metaContent.length)
    : rusmarbleUserscript.replace(metaContent, '');
  fs.writeFileSync('dist/BlueMarble.user.js', blueMetaContent + blueBody, 'utf8');
  if (fs.existsSync('dist/RusMarble.user.css.map.json')) {
    fs.copyFileSync('dist/RusMarble.user.css.map.json', 'dist/BlueMarble.user.css.map.json');
  }
}

console.log(`${consoleStyle.GREEN + consoleStyle.BOLD + consoleStyle.UNDERLINE}Building complete!${consoleStyle.RESET}`);

// Fetches the userscript bookmarklet 
const bookmarkletContent = fs.readFileSync('src/bookmarklet.js', 'utf8');

// Obfuscates the Bookmarklet file
let resultBookmarklet = await terser.minify(bookmarkletContent, {
  mangle: {
    keep_classnames: false,
    keep_fnames: false,
    reserved: [],
    properties: {
      keep_quoted: true,
      reserved: []
    },
  },
  format: {
    comments: 'some'
  },
  compress: {
    dead_code: true,
    drop_console: true,
    drop_debugger: true,
    passes: 2
  }
});

// Writes the obfuscated/mangled bookmarklet code to a file
fs.writeFileSync('dist/RusMarble.bookmarklet.min.js', "javascript:" + resultBookmarklet.code.replaceAll(' ', '%20'), 'utf8');
if (blueMetaContent) {
  fs.copyFileSync('dist/RusMarble.bookmarklet.min.js', 'dist/BlueMarble.bookmarklet.min.js');
}

// Updates the README badges locally (version + compression) so they are committed
// alongside the build instead of being patched/pushed back by the CI. Production only.
if (isProduction) {
  try {
    updateReadmeBadges();
    console.log(`README badges updated ${consoleStyle.GREEN}successfully${consoleStyle.RESET}`);
  } catch (error) {
    console.warn(`${consoleStyle.YELLOW}Warning! Could not update README badges${consoleStyle.RESET}:`, error?.message ?? error);
  }
}

/** Recursively sums the byte size of every file under a directory. */
function dirByteSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirByteSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

/** Rewrites the Latest_Version and Compression shields.io badges in docs/README.md. */
function updateReadmeBadges() {
  const readmePath = 'docs/README.md';
  if (!fs.existsSync(readmePath)) return;

  const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  let readme = fs.readFileSync(readmePath, 'utf8');

  // Version badge, e.g. Latest_Version-0.87.67-lightblue
  readme = readme.replace(/(Latest_Version-)[^-\s)"]*(-lightblue)/, `$1${version}$2`);

  // Compression badge: same formula the CI used.
  const distSize = dirByteSize('dist');
  const srcSize = dirByteSize('src') + dirByteSize('dist/assets');
  if (srcSize > 0) {
    const percentage = (100 - (distSize * 100) / srcSize).toFixed(2);
    readme = readme.replace(
      /https:\/\/img\.shields\.io\/badge\/Compression-[^"')\s]*/,
      `https://img.shields.io/badge/Compression-${percentage}%25-blue`
    );
  }

  fs.writeFileSync(readmePath, readme, 'utf8');
}
