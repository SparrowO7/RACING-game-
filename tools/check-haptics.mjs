// Validates the haptics layer headlessly.
//
// The interesting part isn't calling navigator.vibrate — it's the rate limiting. Collisions
// and button presses can fire many times a second, and queuing vibrations back to back
// turns a phone into one continuous buzz, which is the fastest way to make a player switch
// vibration off. That logic has no visible symptom until someone plays on a real device,
// so it is pinned here instead.
//
// Also checks the module stays silent rather than throwing where the API is absent
// (iOS Safari exposes no navigator.vibrate at all).
//
// Run: node tools/check-haptics.mjs

let failures = 0;
const fail = (name, msg) => { console.log(`FAIL  ${name}: ${msg}`); failures++; };

// Node's `navigator` and `performance` are read-only getters, so shim via defineProperty.
const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

let clock = 0;
const calls = [];
setGlobal('navigator', { maxTouchPoints: 5, vibrate: (p) => { calls.push(p); return true; } });
setGlobal('performance', { now: () => clock });

const { haptic, setHaptics, hapticsSupported } = await import('../js/haptics.js');

if (!hapticsSupported()) fail('support', 'navigator.vibrate should be detected');

// --- every named pattern fires ---
const KINDS = ['tap', 'shift', 'nos', 'bump', 'crash', 'count', 'go', 'checkpoint', 'finish'];
for (const k of KINDS) {
  clock += 10000;                       // clear any rate limit
  if (!haptic(k)) fail('patterns', `"${k}" did not fire`);
}
if (haptic('nope')) fail('patterns', 'an unknown pattern should not fire');

// --- rate limiting: a burst must not become a continuous buzz ---
clock += 10000;
let fired = 0;
for (let i = 0; i < 40; i++) { clock += 5; if (haptic('bump')) fired++; }
if (fired > 3) fail('rate limit', `${fired} bumps got through in 200 ms`);
if (fired === 0) fail('rate limit', 'every bump was blocked');

// ...but the same pattern is allowed again after a real gap
clock += 5000;
if (!haptic('bump')) fail('rate limit', 'a bump after a long gap should fire');

// --- rate limits are per pattern, so a crash is not blocked by a bump ---
clock += 10000;
haptic('bump');
clock += 5;
if (!haptic('crash')) fail('rate limit', 'patterns should be limited independently');

// --- intensity scales the buzz durations, never the leading delay ---
clock += 10000;
calls.length = 0;
haptic('crash', 1);
clock += 10000;
haptic('crash', 0.3);
const [strong, weak] = calls;
if (!Array.isArray(strong) || !Array.isArray(weak)) {
  fail('intensity', 'crash should emit a pattern array');
} else {
  if (!(weak[1] < strong[1])) fail('intensity', `low intensity did not shorten the buzz (${weak[1]} vs ${strong[1]})`);
  if (weak[0] !== strong[0]) fail('intensity', 'intensity must not change the leading delay');
}

// --- a scalar pattern is scaled too, and stays a number ---
clock += 10000;
calls.length = 0;
haptic('tap', 1);
clock += 10000;
haptic('tap', 0.3);
if (typeof calls[0] !== 'number' || typeof calls[1] !== 'number') {
  fail('intensity', 'scalar patterns should stay numbers');
} else if (!(calls[1] <= calls[0])) {
  fail('intensity', 'low intensity should not lengthen a scalar buzz');
}

// --- the toggle cancels in flight and blocks further firing ---
clock += 10000;
calls.length = 0;
setHaptics(false);
if (!(calls.length === 1 && calls[0] === 0)) fail('toggle', 'disabling should cancel vibration in flight');
clock += 10000;
if (haptic('tap')) fail('toggle', 'disabled haptics should not fire');
setHaptics(true);
clock += 10000;
if (!haptic('tap')) fail('toggle', 're-enabling should restore firing');

if (!failures) {
  console.log(`PASS  ${KINDS.length} patterns fire`);
  console.log('PASS  rate limiting caps bursts and is per pattern');
  console.log('PASS  intensity scales buzz length only');
  console.log('PASS  toggle cancels and blocks');
}

// --- no API: must no-op silently, not throw ---
{
  setGlobal('navigator', { maxTouchPoints: 5 });     // no vibrate
  const bare = await import('../js/haptics.js?no-vibrate');
  if (bare.hapticsSupported()) fail('unsupported', 'should report unsupported without navigator.vibrate');
  try {
    if (bare.haptic('tap')) fail('unsupported', 'should not claim to fire');
    bare.setHaptics(false);
    bare.setHaptics(true);
    console.log('PASS  no-ops where unsupported (iOS Safari)');
  } catch (e) {
    fail('unsupported', 'threw without navigator.vibrate: ' + e.message);
  }
}

console.log(failures ? `\n${failures} problem(s)` : '\nHaptics layer valid');
process.exit(failures ? 1 : 0);
