import esbuild from 'esbuild';
import fs from 'fs';
import { execSync } from 'child_process';

try {
  // Run `npm version patch` synchronously, capturing the output
  const output = execSync('npm version patch --no-git-tag-version', { stdio: 'inherit' });
  console.log('Version bumped successfully');
  const update = execSync('node update-version.js', { stdio: 'inherit' });
  console.log('Version updated in meta file successfully');
} catch (error) {
  console.error('Failed to bump version:', error);
  process.exit(1);
}

const metaContent = fs.readFileSync('BlueMarble.meta.js', 'utf8');

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