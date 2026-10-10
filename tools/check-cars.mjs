// Sanity-checks the car catalogue: gear tables must be monotonic and reachable, shift
// points must sit below their own gear's cap, and the garage stat bars must stay in range.
//
// It also asserts the baseline car still gears at 60 / 110 / 175 / 250 km/h — that was the
// hand-written table the game shipped with, and the derived version must reproduce it so
// the refactor to data-driven stats didn't quietly change how the default car drives.
//
// Run: node tools/check-cars.mjs

import { CARS, DEFAULT_SPEC, gearsFor, statBars } from '../js/cars.js';

let failures = 0;
const fail = (name, msg) => { console.log(`FAIL  ${name}: ${msg}`); failures++; };

// --- regression: the baseline table must be unchanged ---
const base = gearsFor(DEFAULT_SPEC.topSpeedKmh, DEFAULT_SPEC.accelScale);
const baseCaps = base.map((g) => Math.round(g.max));
const expected = [60, 110, 175, 250];
if (JSON.stringify(baseCaps) !== JSON.stringify(expected)) {
  fail('baseline gearing', `caps ${baseCaps.join('/')} != shipped ${expected.join('/')}`);
} else {
  console.log(`PASS  baseline gearing      ${baseCaps.join(' / ')} km/h`);
}

for (const c of CARS) {
  const gears = gearsFor(c.topSpeedKmh, c.accelScale);
  const problems = [];

  // caps ascend, top gear reaches the quoted top speed
  for (let i = 1; i < gears.length; i++) {
    if (gears[i].max <= gears[i - 1].max) problems.push(`gear ${i + 1} cap not above gear ${i}`);
  }
  if (Math.abs(gears[gears.length - 1].max - c.topSpeedKmh) > 0.5) {
    problems.push(`top gear ${gears[gears.length - 1].max.toFixed(0)} != topSpeedKmh ${c.topSpeedKmh}`);
  }

  // every shift point must be reachable: below its own cap, and above the previous cap
  // would mean the gear is unusable, so check both directions
  for (let i = 0; i < gears.length - 1; i++) {
    if (gears[i].up >= gears[i].max) problems.push(`gear ${i + 1} shift point at/above its cap`);
    if (i > 0 && gears[i].up <= gears[i - 1].max) {
      problems.push(`gear ${i + 1} shift point below gear ${i} cap (gear unusable)`);
    }
  }

  // accel must be positive and should taper in taller gears
  for (let i = 0; i < gears.length; i++) {
    if (!(gears[i].accel > 0)) problems.push(`gear ${i + 1} accel not positive`);
    if (i > 0 && gears[i].accel >= gears[i - 1].accel) problems.push(`gear ${i + 1} accel not tapering`);
  }

  // spec fields present and in a sane range
  for (const k of ['accelScale', 'gripScale', 'steerScale', 'nosPower', 'driftiness']) {
    const v = c[k];
    if (typeof v !== 'number' || v <= 0 || v > 2.5) problems.push(`${k}=${v} out of range`);
  }
  if (!c.body || !c.body.profile) problems.push('missing body.profile');

  const bars = statBars(c);
  for (const [k, v] of Object.entries(bars)) {
    if (v < 1 || v > 10) problems.push(`stat ${k}=${v} outside 1..10`);
  }

  if (problems.length) { problems.forEach((p) => fail(c.name, p)); continue; }
  const barStr = Object.entries(bars).map(([k, v]) => `${k.slice(0, 3)}${v}`).join(' ');
  console.log(
    `PASS  ${c.name.padEnd(14)} ${String(c.topSpeedKmh).padStart(3)}km/h  ` +
    `${gears.map((g) => g.max.toFixed(0)).join('/')}  ${c.body.profile.padEnd(6)} ${barStr}`
  );
}

// distinctness: cars should differ in more than paint
const sigs = new Set(CARS.map((c) => [c.topSpeedKmh, c.accelScale, c.gripScale, c.steerScale, c.driftiness].join(',')));
if (sigs.size !== CARS.length) fail('catalogue', 'two cars share identical performance stats');
const profiles = new Set(CARS.map((c) => c.body.profile));
if (profiles.size < 3) fail('catalogue', `only ${profiles.size} distinct silhouettes`);

console.log(failures ? `\n${failures} problem(s)` : `\nAll ${CARS.length} cars valid`);
process.exit(failures ? 1 : 0);
