// Small shared math helpers used across the game.

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate independent smoothing toward a target.
// `rate` ~ snappiness (higher = reaches target faster). Safe for any dt.
export const damp = (current, target, rate, dt) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

// Move `current` toward `target` by at most `maxDelta` (linear).
export const moveToward = (current, target, maxDelta) => {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
};

// Multiply an m/s value by this to display km/h.
export const KMH = 3.6;
