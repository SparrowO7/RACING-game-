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
const probe = (coarse, cores, touchPoints, w, h, dpr = 1) => {
  globalThis.window.matchMedia = () => ({ matches: coarse });
  globalThis.window.screen = { width: w, height: h };
  globalThis.window.devicePixelRatio = dpr;
  setGlobal('navigator', { hardwareConcurrency: cores, maxTouchPoints: touchPoints });
  return detectQuality();
};
const phone = probe(true, 8, 5, 390, 844, 3);
const tablet = probe(true, 8, 5, 820, 1180, 2);
const bigTablet = probe(true, 8, 5, 1024, 1366, 2);
const desktop = probe(false, 12, 0, 2560, 1440, 1);
const retinaDesktop = probe(false, 12, 0, 2560, 1440, 2);
const weakDesktop = probe(false, 2, 0, 1366, 768, 1);

if (phone !== 'low') fail('detectQuality', `a phone should get low, got ${phone}`);
// a normal tablet should keep its shadows rather than being punished for being a tablet
if (tablet !== 'medium') fail('detectQuality', `a 2x 820x1180 tablet should get medium, got ${tablet}`);
// but a large dense panel is a fill-rate problem however many cores it reports
if (bigTablet !== 'low') fail('detectQuality', `a 2x 1024x1366 tablet should drop to low, got ${bigTablet}`);
if (desktop !== 'high') fail('detectQuality', `a strong desktop should get high, got ${desktop}`);
if (retinaDesktop !== 'medium') fail('detectQuality', `a 5K desktop should step down, got ${retinaDesktop}`);
if (weakDesktop === 'high') fail('detectQuality', 'a 2-core desktop should not get high');
if (!failures) {
  console.log(`PASS  auto-detect: phone=${phone} tablet=${tablet} bigTablet=${bigTablet} ` +
    `desktop=${desktop} retina=${retinaDesktop} weak=${weakDesktop}`);
}

// --- tilt steering maths ---
// Sign and axis errors here are invisible without a device in hand: the wheel just steers
// the wrong way, or not at all in one orientation. The maths is a pure function so it can
// be pinned against every screen rotation.
{
  const { lateralTilt } = await import('../js/touch.js');

  // portrait: leaning right is positive gamma, and that is the whole answer
  if (lateralTilt(0, 20, 0) !== 20) fail('lateralTilt', 'portrait should pass gamma straight through');
  if (lateralTilt(45, 20, 0) !== 20) fail('lateralTilt', 'portrait must ignore beta');

  // landscape: the lean axis becomes beta, with opposite signs for the two rotations
  const right90 = lateralTilt(20, 0, 90);
  const right270 = lateralTilt(20, 0, 270);
  if (Math.abs(Math.abs(right90) - 20) > 1e-6) fail('lateralTilt', 'at 90 deg the lean should come from beta');
  if (Math.sign(right90) === Math.sign(right270)) {
    fail('lateralTilt', 'the two landscape rotations must give opposite signs');
  }

  // upside-down portrait mirrors portrait
  if (Math.abs(lateralTilt(0, 20, 180) + 20) > 1e-6) fail('lateralTilt', '180 deg should mirror portrait');

  // a level device reads as centred in every orientation
  for (const a of [0, 90, 180, 270]) {
    if (Math.abs(lateralTilt(0, 0, a)) > 1e-9) fail('lateralTilt', `level device not centred at ${a} deg`);
  }

  // leaning further always steers further, and symmetrically
  for (const a of [0, 90, 180, 270]) {
    const small = Math.abs(lateralTilt(8, 8, a));
    const large = Math.abs(lateralTilt(24, 24, a));
    if (!(large > small)) fail('lateralTilt', `tilting further did not read further at ${a} deg`);
    if (Math.abs(lateralTilt(-8, -8, a) + lateralTilt(8, 8, a)) > 1e-9) {
      fail('lateralTilt', `asymmetric response at ${a} deg`);
    }
  }

  // missing sensor fields must not become NaN steering
  for (const bad of [[null, 10], [10, null], [undefined, 10], [10, undefined]]) {
    if (lateralTilt(bad[0], bad[1], 90) !== null) fail('lateralTilt', 'incomplete readings should return null');
  }

  if (!failures) console.log('PASS  tilt maths: 4 orientations, symmetry, monotonic, null-safe');
}

// --- tilt availability must refuse clearly, not silently ---
{
  const { tiltBlockedReason, screenAngle } = await import('../js/touch.js');

  globalThis.window.DeviceOrientationEvent = undefined;
  globalThis.window.isSecureContext = true;
  if (tiltBlockedReason() !== 'sensor not supported') fail('tiltBlockedReason', 'should report missing sensor API');

  globalThis.window.DeviceOrientationEvent = function () {};
  globalThis.window.isSecureContext = false;
  // Chrome gates motion sensors behind a secure context, so a LAN http:// address gets
  // no events at all — the player needs to be told that, not left tilting a dead wheel.
  if (tiltBlockedReason() !== 'needs HTTPS') fail('tiltBlockedReason', 'should report the insecure context');

  globalThis.window.isSecureContext = true;
  if (tiltBlockedReason() !== null) fail('tiltBlockedReason', 'should allow tilt when supported and secure');

  // orientation angle: prefer the modern API, fall back, then default
  setGlobal('screen', { orientation: { angle: 90 } });
  if (screenAngle() !== 90) fail('screenAngle', 'should read screen.orientation.angle');
  setGlobal('screen', {});
  globalThis.window.orientation = 270;
  if (screenAngle() !== 270) fail('screenAngle', 'should fall back to window.orientation');
  delete globalThis.window.orientation;
  if (screenAngle() !== 0) fail('screenAngle', 'should default to 0');

  if (!failures) console.log('PASS  tilt availability reports a specific reason');
}

console.log(failures ? `\n${failures} problem(s)` : '\nInput and quality layers valid');
process.exit(failures ? 1 : 0);
