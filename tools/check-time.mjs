// Validates the time-of-day presets. world.js reads every one of these fields when the
// time changes; a missing or malformed one would silently leave a light at its previous
// value, which looks like a lighting bug rather than a typo. Also checks the presets
// actually differ, and that the day/night ends behave the way the scene depends on
// (daylight must pull the neon glow right back, night must keep it at full strength).
//
// Run: node tools/check-time.mjs

import { TIMES, DEFAULT_TIME, timeById, registerGlow, applyGlow } from '../js/timeofday.js';

let failures = 0;
const fail = (name, msg) => { console.log(`FAIL  ${name}: ${msg}`); failures++; };

const isHex = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff;
const isUnit = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));

for (const t of TIMES) {
  const p = [];
  if (!t.id || !t.name) p.push('missing id/name');

  if (!Array.isArray(t.skyStops) || t.skyStops.length < 2) p.push('needs at least 2 sky stops');
  else {
    let last = -1;
    for (const [pos, hex] of t.skyStops) {
      if (!isUnit(pos)) p.push(`sky stop position ${pos} outside 0..1`);
      if (pos < last) p.push('sky stops not in ascending order');
      last = pos;
      if (!/^#[0-9a-f]{6}$/i.test(hex)) p.push(`sky stop colour ${hex} is not #rrggbb`);
    }
  }

  if (!t.fog || !isHex(t.fog.color)) p.push('fog.color missing');
  else if (!(t.fog.near > 0) || !(t.fog.far > t.fog.near)) p.push(`fog near/far invalid (${t.fog.near}/${t.fog.far})`);

  for (const [key, needPos] of [['hemi', false], ['key', true], ['fill', true]]) {
    const l = t[key];
    if (!l) { p.push(`${key} light missing`); continue; }
    if (!(l.intensity >= 0)) p.push(`${key}.intensity invalid`);
    if (needPos && !isVec3(l.pos)) p.push(`${key}.pos must be [x,y,z]`);
    if (key === 'hemi') {
      if (!isHex(l.sky) || !isHex(l.ground)) p.push('hemi.sky/ground must be hex');
    } else if (!isHex(l.color)) p.push(`${key}.color must be hex`);
  }

  if (!(t.exposure > 0)) p.push('exposure must be positive');
  if (!isUnit(t.stars)) p.push('stars must be 0..1');
  if (!isUnit(t.moon)) p.push('moon must be 0..1');
  if (!isUnit(t.nightLevel)) p.push('nightLevel must be 0..1');

  if (!t.sunDisc) p.push('sunDisc missing');
  else {
    if (!isUnit(t.sunDisc.opacity)) p.push('sunDisc.opacity must be 0..1');
    if (!isHex(t.sunDisc.color)) p.push('sunDisc.color must be hex');
    if (!isVec3(t.sunDisc.pos)) p.push('sunDisc.pos must be [x,y,z]');
    if (!(t.sunDisc.scale > 0)) p.push('sunDisc.scale must be positive');
  }

  if (t.groundMix !== null && t.groundMix !== undefined) {
    if (!isHex(t.groundMix.color)) p.push('groundMix.color must be hex');
    if (!isUnit(t.groundMix.t)) p.push('groundMix.t must be 0..1');
  }

  if (p.length) { p.forEach((m) => fail(t.name, m)); continue; }
  console.log(
    `PASS  ${t.name.padEnd(6)} exposure ${t.exposure.toFixed(2)}  key ${t.key.intensity.toFixed(2)}  ` +
    `hemi ${t.hemi.intensity.toFixed(2)}  stars ${t.stars.toFixed(2)}  nightLevel ${t.nightLevel.toFixed(2)}`
  );
}

// --- the presets must be meaningfully different, not three shades of the same scene ---
if (new Set(TIMES.map((t) => t.id)).size !== TIMES.length) fail('presets', 'duplicate ids');
if (!TIMES.some((t) => t.id === DEFAULT_TIME)) fail('presets', `DEFAULT_TIME "${DEFAULT_TIME}" is not a preset`);
if (timeById('nope').id !== TIMES[TIMES.length - 1].id) fail('timeById', 'unknown id should fall back');

const day = timeById('day'), night = timeById('night');
if (!(day.key.intensity > night.key.intensity * 1.5)) fail('day/night', 'daylight key light is not clearly brighter');
if (!(day.nightLevel < night.nightLevel * 0.4)) fail('day/night', 'daylight does not pull the glow back');
if (!(day.stars === 0 && day.moon === 0)) fail('day', 'stars/moon must be hidden in daylight');
if (!(night.sunDisc.opacity === 0)) fail('night', 'the sun disc must be hidden at night');
if (!(day.fog.far > night.fog.far)) fail('day/night', 'daylight should see further than night');

// --- the glow registry must actually scale materials, and respect its floor ---
{
  const glows = [];
  const neon = { emissiveIntensity: 1.5 };
  const pool = { transparent: true, opacity: 0.4 };
  registerGlow(glows, neon, { floor: 0.08 });
  registerGlow(glows, pool, { floor: 0 });

  applyGlow(glows, 1);
  const litOk = Math.abs(neon.emissiveIntensity - 1.5) < 1e-6 && Math.abs(pool.opacity - 0.4) < 1e-6;
  applyGlow(glows, 0.18);
  const dimOk = neon.emissiveIntensity < 1.5 * 0.4 && pool.opacity < 0.4 * 0.25;
  applyGlow(glows, 0);
  const floorOk = Math.abs(neon.emissiveIntensity - 1.5 * 0.08) < 1e-6 && Math.abs(pool.opacity) < 1e-9;

  if (!litOk) fail('glow registry', 'full night level should restore the original values');
  if (!dimOk) fail('glow registry', 'daylight should dim registered materials');
  if (!floorOk) fail('glow registry', 'floor not respected at level 0');
  if (litOk && dimOk && floorOk) console.log('PASS  glow registry scales and respects floors');
}

console.log(failures ? `\n${failures} problem(s)` : `\nAll ${TIMES.length} time presets valid`);
process.exit(failures ? 1 : 0);
