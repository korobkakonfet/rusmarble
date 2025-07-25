/** Builds the userscript using esbuild.
 * This is for compiling all of the source files into a single userscript file.
 * This also compiles all CSS files into a single CSS file.
 * @since 0.0.6
*/

import esbuild from 'esbuild';
import fs from 'fs';
import { execSync } from 'child_process';

// Tries to bump the minor version
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
esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'dist/BlueMarble.user.js',
  format: 'iife',
  banner: {
    js: metaContent
  },
  legalComments: 'inline',
  minify: true
}).catch(() => process.exit(1));