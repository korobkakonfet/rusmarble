/** For development compiling of patches
 * @since 0.12.0
 */

import fs from 'fs';
import { execSync } from 'child_process';

try {
  const update = execSync('npm version patch --no-git-tag-version', { stdio: 'inherit' });
  console.log('Version patch updated successfully');
} catch (error) {
  console.error('Failed to update version number:', error);
  process.exit(1);
}

const readmePath = 'docs/README.md';

let readmeContent = fs.readFileSync(readmePath, 'utf-8');

readmeContent = readmeContent.replace(/(Total_Patches-)(\d+)(-black)/, (match, prefix, number, suffix) => {
  const incremented = Number(number) + 1;
  return `${prefix}${incremented}${suffix}`;
});

fs.writeFileSync(readmePath, readmeContent, 'utf-8');