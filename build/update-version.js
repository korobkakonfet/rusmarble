/** Updates the version number in the metadata.
 * This updates the version number in the metadata to the version specified in package.json.
 * @since 0.0.6
*/

import fs from 'fs';
import { consoleStyle } from './utils.js';

console.log(`${consoleStyle.BLUE}Starting update-version...${consoleStyle.RESET}`);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = pkg.version;

const metaPaths = ['src/RusMarble.meta.js', 'src/BlueMarble.meta.js'];
for (const metaPath of metaPaths) {
  if (!fs.existsSync(metaPath)) continue;
  let meta = fs.readFileSync(metaPath, 'utf-8');
  meta = meta.replace(/@version\s+[\d.]+/, `@version      ${version}`);
  fs.writeFileSync(metaPath, meta);
}
console.log(`${consoleStyle.GREEN}Updated${consoleStyle.RESET} userscript version to ${consoleStyle.MAGENTA}${version}${consoleStyle.RESET}`);
