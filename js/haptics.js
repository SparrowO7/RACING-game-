// Haptic feedback.
//
// Thin wrapper over the Vibration API with one job beyond calling it: rate limiting.
// Collisions and button presses can fire many times a second, and queuing vibrations
// back to back turns a phone into a continuous buzz that players switch off. Each
// pattern has a minimum gap, and a global toggle kills all of it.
//
// Support is real but uneven: Android Chrome/Firefox vibrate, iOS Safari does not expose
// the API at all. Everything here silently no-ops when it is unavailable, so callers never
// need to check.

const PATTERNS = {
  tap: { pattern: 10, gap: 40 },          // any on-screen button press
  shift: { pattern: 14, gap: 90 },        // gear change
  nos: { pattern: [0, 22, 30, 22], gap: 400 },
  bump: { pattern: 22, gap: 110 },        // light contact
  crash: { pattern: [0, 45, 35, 70], gap: 260 },
  count: { pattern: 18, gap: 300 },       // countdown beat
  go: { pattern: [0, 40, 50, 90], gap: 800 },
  checkpoint: { pattern: 12, gap: 300 },
  finish: { pattern: [0, 70, 60, 70, 60, 140], gap: 1500 },
};

const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const lastFired = new Map();
let enabled = true;

export function hapticsSupported() { return supported; }

export function setHaptics(on) {
  enabled = !!on;
  if (!enabled && supported) navigator.vibrate(0);   // cancel anything in flight
}

export function haptic(kind, intensity = 1) {
  if (!supported || !enabled) return false;
  const spec = PATTERNS[kind];
  if (!spec) return false;

  const now = performance.now();
  if (now - (lastFired.get(kind) ?? -Infinity) < spec.gap) return false;
  lastFired.set(kind, now);

  // intensity can only scale duration — the API has no amplitude control
  const scale = Math.max(0.3, Math.min(1, intensity));
  const pattern = Array.isArray(spec.pattern)
    ? spec.pattern.map((ms, i) => (i % 2 === 1 ? Math.round(ms * scale) : ms))
    : Math.round(spec.pattern * scale);

  try { navigator.vibrate(pattern); } catch { return false; }
  return true;
}
