import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = pkg.version;

let meta = fs.readFileSync('src/BlueMarble.meta.js', 'utf-8');
meta = meta.replace(/@version\s+[\d.]+/, `@version      ${version}`);

fs.writeFileSync('src/BlueMarble.meta.js', meta);
console.log(`Updated userscript version to ${version}`);