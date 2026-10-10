// Builds the web deploy bundle into dist-web/.
//
// The repo root can't be published directly: it also holds the Electron wrapper, the dev
// tools and node_modules. This copies only what the browser build actually loads, so a
// Netlify (or any static host) deploy stays small and contains nothing private.
//
// Run: node tools/build-web.cjs   (or `npm run build:web`)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-web');

// Everything the page loads, and nothing else.
const INCLUDE = [
  'index.html',
  'style.css',
  'js',
  'vendor',
  ['assets/icon.png', 'icon.png'],       // used as the favicon
];

function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      // package.json inside js/ only marks the folder as ESM for Node's tooling
      if (entry === 'package.json') continue;
      copy(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const item of INCLUDE) {
  const [from, to] = Array.isArray(item) ? item : [item, item];
  const src = path.join(ROOT, from);
  if (!fs.existsSync(src)) {
    console.error(`missing: ${from} — run "npm run vendor" and "npm run icon" first`);
    process.exit(1);
  }
  copy(src, path.join(OUT, to));
}

// Link the favicon so the deployed page isn't hitting a 404 on every load.
const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('rel="icon"')) {
  html = html.replace('<link rel="stylesheet"', '<link rel="icon" href="icon.png" />\n<link rel="stylesheet"');
  fs.writeFileSync(indexPath, html);
}

const kb = (dirSize(OUT) / 1024).toFixed(0);
console.log(`built dist-web/ (${kb} KB)`);
