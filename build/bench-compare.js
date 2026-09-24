// Compares two `npm run benchmark -- --json <file>` dumps by median time.
// Usage: node build/bench-compare.js <before.json> <after.json> [--threshold 5]
import { readFileSync } from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const thresholdIndex = process.argv.indexOf('--threshold');
const thresholdPct = thresholdIndex >= 0 ? Number(process.argv[thresholdIndex + 1]) : 5;

if (!beforePath || !afterPath) {
  console.error('Usage: node build/bench-compare.js <before.json> <after.json> [--threshold 5]');
  process.exit(2);
}

const load = (path) => new Map(JSON.parse(readFileSync(path, 'utf8')).results.map((result) => [result.name, result]));
const before = load(beforePath);
const after = load(afterPath);

const rows = [];
let regressions = 0;
for (const [name, next] of after) {
  const prev = before.get(name);
  if (!prev) {
    rows.push([name, '-', next.medianMs.toFixed(3), 'new', '']);
    continue;
  }
  const deltaPct = prev.medianMs > 0 ? ((next.medianMs - prev.medianMs) / prev.medianMs) * 100 : 0;
  const checksumNote = prev.checksum !== next.checksum ? 'checksum changed' : '';
  let verdict = '';
  if (deltaPct > thresholdPct) { verdict = 'SLOWER'; regressions++; }
  else if (deltaPct < -thresholdPct) verdict = 'faster';
  rows.push([
    name,
    prev.medianMs.toFixed(3),
    next.medianMs.toFixed(3),
    `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% ${verdict}`.trim(),
    checksumNote,
  ]);
}
for (const name of before.keys()) {
  if (!after.has(name)) rows.push([name, before.get(name).medianMs.toFixed(3), '-', 'removed', '']);
}

console.log(['Benchmark'.padEnd(52), 'before ms'.padStart(11), 'after ms'.padStart(11), 'delta'.padStart(18), ''].join(' '));
for (const [name, prev, next, delta, note] of rows) {
  console.log([name.padEnd(52), prev.padStart(11), next.padStart(11), delta.padStart(18), note].join(' '));
}
console.log(`\n${regressions} regression(s) over ${thresholdPct}% by median.`);
process.exitCode = regressions > 0 ? 1 : 0;
