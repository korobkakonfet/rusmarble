import esbuild from 'esbuild';
import fs from 'fs';
import { execSync } from 'child_process';

try {
  const update = execSync('node build/update-version.js', { stdio: 'inherit' });
  console.log('Version updated in meta file successfully');
} catch (error) {
  console.error('Failed to update version number:', error);
  process.exit(1);
}

const metaContent = fs.readFileSync('src/BlueMarble.meta.js', 'utf8');

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