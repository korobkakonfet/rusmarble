/** Verifies an alternate extension-point module still matches the mainline contract.
 *
 * src/extensionPoints.js (committed, all no-ops) defines the interface. A private build may
 * supply its own implementation and point EXTENSIONS_MODULE at it; this checks the two agree.
 *
 * Implementing a subset is fine and expected — anything not implemented simply keeps the no-op.
 * What is NOT fine is an export the mainline module does not declare: that means either a hook
 * was renamed in mainline (so the implementation is now dead and its feature silently gone) or
 * one was never declared (so nothing ever calls it). Both are silent failures, so orphans fail.
 *
 * Skips silently when no alternate module is present, which is the normal public checkout.
 * Run: node build/check-extension-points.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = path.join(root, 'src/extensionPoints.js');
const ALTERNATE = path.join(root, process.env.EXTENSIONS_MODULE || 'src/exp/expHooks.local.js');

if (!fs.existsSync(ALTERNATE)) {
  console.log('No alternate extension-point module present — skipping.');
  process.exit(0);
}

const exportsOf = (file) => {
  const code = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of code.matchAll(/^export\s+(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  return names;
};

const declared = exportsOf(CONTRACT);
const implemented = exportsOf(ALTERNATE);

const orphans = [...implemented].filter((n) => !declared.has(n));
const notImplemented = [...declared].filter((n) => !implemented.has(n));

for (const n of orphans) {
  console.log(`ORPHAN: '${n}' is exported by the alternate module but declared nowhere in src/extensionPoints.js`);
}

if (orphans.length) {
  console.log(`\n${orphans.length} orphaned extension point(s).`);
  process.exit(1);
}

console.log(
  `Extension points OK: ${implemented.size}/${declared.size} implemented`
  + (notImplemented.length ? ` (no-op: ${notImplemented.join(', ')})` : '')
);
process.exit(0);
