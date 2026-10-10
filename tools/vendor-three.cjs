// Copies the installed Three.js module build into vendor/ so the packaged desktop app
// runs offline. The packaged `files` list intentionally excludes node_modules, so vendor/
// is the copy that actually ships — this script keeps it in sync with the dependency and
// refuses to silently vendor a different revision than index.html's import map expects.
//
// Run: node tools/vendor-three.cjs   (also runs as part of `npm run prebuild`)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
const LICENSE_SRC = path.join(ROOT, 'node_modules', 'three', 'LICENSE');
const OUT_DIR = path.join(ROOT, 'vendor');
const OUT = path.join(OUT_DIR, 'three.module.js');

if (!fs.existsSync(SRC)) {
  console.error('three is not installed. Run: npm install');
  process.exit(1);
}

const src = fs.readFileSync(SRC, 'utf8');
const rev = (src.match(/REVISION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
if (!rev) {
  console.error('could not read REVISION from ' + SRC);
  process.exit(1);
}

const declared = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  .devDependencies.three.replace(/^[^\d]*/, '');
const declaredRev = declared.split('.')[1]; // 0.160.0 -> "160"
if (declaredRev && declaredRev !== rev) {
  console.error(`revision mismatch: installed r${rev}, package.json wants r${declaredRev}`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, src);
if (fs.existsSync(LICENSE_SRC)) {
  fs.copyFileSync(LICENSE_SRC, path.join(OUT_DIR, 'three.LICENSE'));
}

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`vendored three r${rev} -> vendor/three.module.js (${kb} KB)`);
