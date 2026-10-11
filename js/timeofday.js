// Time of day. Each preset is a complete lighting set-up, not just a background colour:
// sky gradient, fog, key/fill/ambient lights, tone-mapping exposure, how visible the
// stars/moon/sun disc are, how much of the map's ground tint survives, and a `nightLevel`
// that tells every emissive material (neon, lit windows, street lamps, headlights,
// underglow) how hard to glow. In daylight those have to pull right back or the scene
// reads like a night track with a blue sky pasted behind it.

export const TIMES = [
  {
    id: 'day',
    name: 'Day',
    skyStops: [
      [0.00, '#2f6fd0'], [0.38, '#5ba3e8'], [0.55, '#9ed0f5'],
      [0.62, '#cfe6f7'], [0.70, '#e8eef2'], [1.00, '#b9c6cf'],
    ],
    fog: { color: 0xcfe0ee, near: 420, far: 1900 },
    hemi: { sky: 0xdceeff, ground: 0x6f7a5e, intensity: 1.5 },
    key: { color: 0xfff6e2, intensity: 2.6, pos: [220, 340, 150] },
    fill: { color: 0x9fc4ff, intensity: 0.45, pos: [-180, 110, -200] },
    exposure: 1.0,
    stars: 0, moon: 0,
    sunDisc: { opacity: 0.95, color: 0xfff3cf, pos: [420, 620, -900], scale: 150 },
    groundMix: { color: 0x7c8667, t: 0.78 },
    nightLevel: 0.18,
  },
  {
    id: 'dusk',
    name: 'Dusk',
    skyStops: [
      [0.00, '#17204d'], [0.34, '#3b3070'], [0.50, '#8a4a74'],
      [0.58, '#e07a4e'], [0.66, '#f2a65a'], [0.78, '#6b4a63'], [1.00, '#2a2340'],
    ],
    fog: { color: 0x8a5a66, near: 340, far: 1500 },
    hemi: { sky: 0xffc9a8, ground: 0x3e3550, intensity: 1.15 },
    key: { color: 0xffb070, intensity: 1.8, pos: [-260, 90, 120] },
    fill: { color: 0x6a7cff, intensity: 0.4, pos: [180, 120, -180] },
    exposure: 1.12,
    stars: 0.35, moon: 0.35,
    sunDisc: { opacity: 0.8, color: 0xff9a4e, pos: [-900, 180, 500], scale: 190 },
    groundMix: { color: 0x4a3e4a, t: 0.45 },
    nightLevel: 0.6,
  },
  {
    id: 'night',
    name: 'Night',
    skyStops: [
      [0.00, '#090c26'], [0.42, '#1a1140'], [0.55, '#3a1c5e'],
      [0.60, '#7b2a6a'], [0.66, '#241640'], [1.00, '#0a0e20'],
    ],
    fog: { color: 0x241a44, near: 300, far: 1100 },
    hemi: { sky: 0xafc4ff, ground: 0x2a2550, intensity: 1.0 },
    key: { color: 0xfff0d6, intensity: 1.3, pos: [160, 220, 100] },
    fill: { color: 0xff4fae, intensity: 0.3, pos: [-140, 70, -170] },
    exposure: 1.25,
    stars: 0.85, moon: 1,
    sunDisc: { opacity: 0, color: 0xffffff, pos: [0, 900, -1400], scale: 120 },
    groundMix: null,          // keep the map's own ground tint
    nightLevel: 1,
  },
];

export const DEFAULT_TIME = 'night';
export function timeById(id) { return TIMES.find((t) => t.id === id) || TIMES[TIMES.length - 1]; }

// Follow the device theme the way a website does: a phone in dark mode gets the night
// circuit, light mode gets daylight. Only a starting point — picking a time explicitly in
// the menu takes over, and the game stops following the system until AUTO is chosen again.
export function detectSystemTime() {
  const dark = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'night' : 'day';
}

// Subscribe to system theme changes. Returns an unsubscribe function.
export function watchSystemTime(onChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e) => onChange(e.matches ? 'night' : 'day');
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

// A vertical gradient sky texture from a preset's stops.
export function skyTextureFor(preset) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  for (const [pos, hex] of preset.skyStops) grad.addColorStop(pos, hex);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return c;
}

// --- emissive registry -------------------------------------------------------
// Materials whose glow should follow the time of day register here with whatever
// "fully lit" means for them. One pass then scales them all, so adding a new glowing
// prop is a single registerGlow() call instead of another special case.

export function registerGlow(list, mat, opts = {}) {
  list.push({
    mat,
    emissive: opts.emissive ?? mat.emissiveIntensity ?? null,
    opacity: opts.opacity ?? (mat.transparent ? mat.opacity : null),
    // MeshBasicMaterial has no emissive channel, so its colour is dimmed instead
    color: opts.dimColor ? mat.color.clone() : null,
    floor: opts.floor ?? 0,
  });
  return mat;
}

export function applyGlow(list, level) {
  for (const e of list) {
    const k = e.floor + (1 - e.floor) * level;
    if (e.emissive !== null) e.mat.emissiveIntensity = e.emissive * k;
    if (e.opacity !== null) e.mat.opacity = e.opacity * k;
    if (e.color) {
      e.mat.color.copy(e.color).multiplyScalar(0.35 + 0.65 * k);
    }
  }
}
