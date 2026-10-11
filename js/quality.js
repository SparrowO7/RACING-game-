// Graphics quality presets.
//
// The cost on a phone is almost entirely rendering, not simulation — five cars of physics
// is nothing, but a 2048px shadow map at devicePixelRatio 3 on a 1080p phone is asking
// the GPU to shade ~7M pixels a frame. These presets scale the things that actually move
// that number: render resolution, shadow resolution (or shadows at all), how much distant
// scenery exists, and the particle budget.
//
// Everything here is read at build/apply time, so switching quality never touches the
// physics or the game state.

export const QUALITY = {
  low: {
    id: 'low',
    name: 'Low',
    pixelRatio: 1,
    shadows: false,
    shadowMap: 512,
    skyline: 22,          // distant silhouette buildings
    stars: 220,
    treeStep: 5,          // sample every Nth centerline point for trees (higher = fewer)
    towerStep: 11,
    particles: 36,
    skidMarks: 90,
    lampStep: 16,         // street lamps along the circuit
    fogScale: 0.65,       // pull the far plane in so less has to be drawn
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    pixelRatio: 1.5,
    shadows: true,
    shadowMap: 1024,
    skyline: 48,
    stars: 450,
    treeStep: 3,
    towerStep: 8,
    particles: 64,
    skidMarks: 170,
    lampStep: 13,
    fogScale: 0.85,
  },
  high: {
    id: 'high',
    name: 'High',
    pixelRatio: 2,
    shadows: true,
    shadowMap: 2048,
    skyline: 80,
    stars: 700,
    treeStep: 2,
    towerStep: 7,
    particles: 90,
    skidMarks: 260,
    lampStep: 11,
    fogScale: 1,
  },
};

export const QUALITY_LIST = [QUALITY.low, QUALITY.medium, QUALITY.high];

export function qualityById(id) { return QUALITY[id] || QUALITY.high; }

// Pick a sensible starting point rather than making a phone render the desktop scene once
// before the player finds the settings. Deliberately conservative: a wrong guess upward
// costs a bad first impression, a wrong guess downward costs a little sharpness.
//
// Pixel count matters as much as core count, and it is where tablets catch you out: a
// large tablet reports plenty of cores but also a very high-resolution panel, so the GPU
// is being asked to shade several times a phone's workload. Fill rate is what this engine
// is bound by, so the raw pixel budget gets the final say.
export function detectQuality() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const w = window.screen.width, h = window.screen.height;
  const shortSide = Math.min(w, h);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const megapixels = (w * dpr * h * dpr) / 1e6;

  let tier;
  if (coarse) {
    tier = (shortSide <= 500 || cores <= 6) ? 'low' : 'medium';
  } else {
    tier = cores <= 4 ? 'medium' : 'high';
  }

  // A very dense panel pulls the tier down one step regardless of core count. The touch
  // threshold is set above a normal tablet (~3.9 MP) so an iPad keeps its shadows, and
  // only the large high-resolution ones (~5.6 MP) drop to the no-shadow preset.
  if (megapixels > 4.5 && tier === 'high') tier = 'medium';
  if (megapixels > 4.8 && tier === 'medium' && coarse) tier = 'low';

  return tier;
}
