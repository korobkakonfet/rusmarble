/** Builds the userscript using esbuild.
 * This will:
 * 1. Update the package version across the entire project
 * 2. Bundle the JS files into one file (esbuild)
 * 3. Bundle the CSS files into one file (esbuild)
 * 4. Compress & obfuscate the bundled JS file (terner)
 * 5. Create a sourcemap
 * @since 0.0.6
*/

// ES Module imports
import esbuild from 'esbuild';
import fs from 'fs';
import { execSync } from 'child_process';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// CommonJS imports (require)
const terser = require('terser');

const isGitHub = !!process.env.GITHUB_ACTIONS; // Is this running in a GitHub Action Workflow?

// Tries to bump the version
try {
  const update = execSync('node build/update-version.js', { stdio: 'inherit' });
  console.log('Version updated in meta file successfully');
} catch (error) {
  console.error('Failed to update version number:', error);
  process.exit(1);
}

// Fetches the userscript metadata banner
const metaContent = fs.readFileSync('src/BlueMarble.meta.js', 'utf8');

// Compiles a string array of all CSS files
const cssFiles = fs.readdirSync('src/')
  .filter(file => file.endsWith('.css'))
  .map(file => `src/${file}`);

// Compiles the CSS files
esbuild.build({
  entryPoints: cssFiles,
  bundle: true,
  outfile: 'dist/BlueMarble.user.css',
  minify: true
});

// Compiles the JS files
const resultEsbuild = await esbuild.build({
  entryPoints: ['src/main.js'], // "Infect" the files from this point (it spreads from this "patient 0")
  bundle: true, // Should the code be bundled?
  outfile: 'dist/BlueMarble.user.js', // The file the bundled code is exported to
  format: 'iife', // What format the bundler bundles the code into
  target: 'es2020', // What is the minimum version/year that should be supported? When omited, it attempts to support backwards compatability with legacy browsers
  platform: 'browser', // The platform the bundled code will be operating on
  legalComments: 'inline', // What level of legal comments are preserved? (Hard: none, Soft: inline)
  minify: false, // Should the code be minified?
  write: false // Should we write the outfile?
}).catch(() => process.exit(1));

// Retrieves the JS file
const resultEsbuildJS = resultEsbuild.outputFiles.find(file => file.path.endsWith('.js'));

// Obfuscates the JS file
const resultTerser = await terser.minify(resultEsbuildJS.text, {
  sourceMap: {
    filename: 'dist/BlueMarble.user.js', // The file to make a sourcemap for
    url: ' ' // (This setting is intentional) The sourcemap url to point to.
  },
  mangle: {
    toplevel: true, // Obfuscate top-level class/function names
    keep_classnames: false, // Should class names be preserved?
    keep_fnames: false, // Should function names be preserved?
    reserved: [], // List of keywords to preserve
    properties: {
      // regex: /.*/, // Yes, I am aware I should be using a RegEx. Yes, like you, I am also suprised the userscript still functions
      keep_quoted: true, // Should names in quotes be preserved?
      reserved: [] // What properties should be preserved?
    },
  },
  compress: {
    dead_code: isGitHub, // Should unreachable code be removed?
    drop_console: isGitHub, // Should console code be removed?
    drop_debugger: isGitHub, // Should debugger code be removed?
    passes: 2 // Number of times the compression algorithm runs
  },
  format: {
    comments: 'some' // Save legal comments
  }
});

// Creates the sourcemap file
fs.writeFileSync('dist/BlueMarble.user.js.map', resultTerser.map, 'utf8');

// Adds the banner
fs.writeFileSync('dist/BlueMarble.user.js', metaContent + resultTerser.code, 'utf8');