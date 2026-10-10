// Validates the input and quality layers without a browser.
//
// TouchControls and HumanController are interchangeable by contract: game.js picks one
// and physics.js never knows which. Nothing enforces that at runtime, so a getter renamed
// on one and not the other would surface as "the brake does nothing on my phone" — which
// is exactly the kind of bug that is painful to find on a device you cannot debug on.
// This compares the two interfaces statically from source.
//
// Quality presets are plain data, so those are checked directly, including that the
// presets really are ordered by cost (a "low" that renders more than "high" is a typo
// nobody notices until a phone catches fire).
//
// Run: node tools/check-input.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const fail = (name, msg) => { console.log(`FAIL  ${name}: ${msg}`); failures++; };

// --- pull the member names out of a class body ---
function membersOf(src, className) {
  const start = src.indexOf(`class ${className}`);
  if (start < 0) return null;
  // walk braces to find the class body
  const open = src.indexOf('{', start);
  let depth = 0, end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open, end);
  const names = new Set();
  for (const m of body.matchAll(/^\s{2}get\s+([A-Za-z0-9_$]+)\s*\(/gm)) names.add(m[1]);
  for (const m of body.matchAll(/^\s{2}([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/gm)) {
    if (m[1] !== 'constructor' && !m[1].startsWith('_')) names.add(m[1]);
  }
  return names;
}

const inputSrc = readFileSync(join(root, 'js/input.js'), 'utf8');
const touchSrc = readFileSync(join(root, 'js/touch.js'), 'utf8');

const human = membersOf(inputSrc, 'HumanController');
const touch = membersOf(touchSrc, 'TouchControls');

if (!human) fail('input.js', 'HumanController not found');
if (!touch) fail('touch.js', 'TouchControls not found');

if (human && touch) {
  // everything physics/game reads off a controller must exist on both
  const required = ['throttle', 'brake', 'steer', 'handbrake', 'nos', 'slowmo',
    'resetPressed', 'shiftUpPressed', 'shiftDownPressed'];
  const missingHuman = required.filter((r) => !human.has(r));
  const missingTouch = required.filter((r) => !touch.has(r));
  if (missingHuman.length) fail('HumanController', 'missing ' + missingHuman.join(', '));
  if (missingTouch.length) fail('TouchControls', 'missing ' + missingTouch.join(', '));

  const drift = [...human].filter((m) => !touch.has(m));
  if (drift.length) fail('interface drift', 'TouchControls lacks ' + drift.join(', '));

  if (!missingHuman.length && !missingTouch.length && !drift.length) {
    console.log(`PASS  controller interfaces match (${required.length} members)`);
  }
}

// --- the game must actually read every controller member it relies on ---
{
  const gameSrc = readFileSync(join(root, 'js/game.js'), 'utf8');
  const physicsSrc = readFileSync(join(root, 'js/physics.js'), 'utf8');
  const combined = gameSrc + physicsSrc;
  const used = ['throttle', 'brake', 'steer', 'handbrake', 'nos', 'slowmo',
    'resetPressed', 'shiftUpPressed', 'shiftDownPressed']
    .filter((m) => combined.includes(m));
  console.log(`PASS  game/physics reference ${used.length}/9 controller members`);
}

// --- edge-triggered getters must clear themselves, or a tap would latch on ---
for (const edge of ['resetPressed', 'shiftUpPressed', 'shiftDownPressed']) {
  const re = new RegExp(`get ${edge}\\(\\)[^\\n]*`);
  const line = (touchSrc.match(re) || [''])[0];
  if (!line.includes('= false')) {
    fail('TouchControls', `${edge} does not clear itself on read (a tap would latch)`);
  }
}
if (!failures) console.log('PASS  touch edge flags clear on read');

// --- quality presets ---
// Node exposes a read-only `navigator`, so the shim has to be installed with
// defineProperty rather than a plain assignment.
const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

setGlobal('window', { matchMedia: () => ({ matches: false }), screen: { width: 1920, height: 1080 } });
setGlobal('navigator', { hardwareConcurrency: 8, maxTouchPoints: 0 });

const { QUALITY_LIST, qualityById, detectQuality } = await import('../js/quality.js');

const NUMERIC = ['pixelRatio', 'shadowMap', 'skyline', 'stars', 'treeStep', 'towerStep',
  'particles', 'skidMarks', 'lampStep', 'fogScale'];
for (const q of QUALITY_LIST) {
  const p = [];
  if (typeof q.shadows !== 'boolean') p.push('shadows must be a boolean');
  for (const k of NUMERIC) {
    if (!(typeof q[k] === 'number' && q[k] > 0)) p.push(`${k} must be a positive number`);
  }
  if (q.fogScale > 1) p.push('fogScale above 1 would push the far plane past the sky dome');
  if (p.length) { p.forEach((m) => fail(q.name, m)); continue; }
  console.log(`PASS  ${q.name.padEnd(7)} dpr ${q.pixelRatio}  shadows ${q.shadows ? q.shadowMap : 'off'}  ` +
    `skyline ${q.skyline}  stars ${q.stars}  particles ${q.particles}`);
}

// cost must increase from low to high for the things that scale up...
const [low, med, high] = QUALITY_LIST;
for (const [k, label] of [['pixelRatio', 'resolution'], ['skyline', 'skyline'], ['stars', 'stars'],
  ['particles', 'particles'], ['skidMarks', 'skid marks'], ['fogScale', 'view distance']]) {
  if (!(low[k] <= med[k] && med[k] <= high[k])) fail('ordering', `${label} is not ordered low <= medium <= high`);
}
// ...and decrease for the "step" fields, where a bigger number means fewer props
for (const [k, label] of [['treeStep', 'tree density'], ['towerStep', 'tower density'], ['lampStep', 'lamp density']]) {
  if (!(low[k] >= med[k] && med[k] >= high[k])) fail('ordering', `${label} is not ordered low >= medium >= high`);
}
if (!low.shadows && high.shadows) console.log('PASS  quality presets ordered by cost');
else if (low.shadows) fail('ordering', 'the low preset should not render shadows');

if (qualityById('nope').id !== 'high') fail('qualityById', 'unknown id should fall back to high');

// --- auto-detect must pick something sane for each kind of device ---
const probe = (coarse, cores, touchPoints, w, h) => {
  globalThis.window.matchMedia = () => ({ matches: coarse });
  globalThis.window.screen = { width: w, height: h };
  setGlobal('navigator', { hardwareConcurrency: cores, maxTouchPoints: touchPoints });
  return detectQuality();
};
const phone = probe(true, 8, 5, 390, 844);
const tablet = probe(true, 8, 5, 1024, 1366);
const desktop = probe(false, 12, 0, 2560, 1440);
const weakDesktop = probe(false, 2, 0, 1366, 768);

if (phone !== 'low') fail('detectQuality', `a phone should get low, got ${phone}`);
if (tablet === 'high') fail('detectQuality', 'a tablet should not default to high');
if (desktop !== 'high') fail('detectQuality', `a strong desktop should get high, got ${desktop}`);
if (weakDesktop === 'high') fail('detectQuality', 'a 2-core desktop should not get high');
if (!failures) console.log(`PASS  auto-detect: phone=${phone} tablet=${tablet} desktop=${desktop} weak=${weakDesktop}`);

console.log(failures ? `\n${failures} problem(s)` : '\nInput and quality layers valid');
process.exit(failures ? 1 : 0);
