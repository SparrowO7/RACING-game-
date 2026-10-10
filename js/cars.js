// Car catalogue. Every car is pure data: performance numbers that physics.js reads, and
// body/style numbers that car.js builds geometry from. Nothing in the simulation special-
// cases a particular car, so adding one here is enough to make it selectable and drivable.
//
// Performance fields are multipliers around a 1.0 baseline (except topSpeedKmh), which
// keeps the handling model single-sourced: tune the model in physics.js, tune the cars here.
//
// Gear caps are derived from topSpeedKmh by GEAR_FRACTIONS so every car has four usable
// gears without hand-written tables. The baseline 250 km/h car lands on 60 / 110 / 175 /
// 250, matching the gearing the game shipped with.

export const GEAR_FRACTIONS = [0.24, 0.44, 0.70, 1.0];
export const SHIFT_POINT = 0.82; // fraction of a gear's own cap where the up-shift unlocks

// Gear table for a given top speed. accel falls off in the taller gears.
export function gearsFor(topSpeedKmh, accelScale = 1) {
  const baseAccel = [11, 8.5, 6.5, 4.5];
  return GEAR_FRACTIONS.map((f, i) => {
    const max = topSpeedKmh * f;
    return {
      max,
      up: i === GEAR_FRACTIONS.length - 1 ? Infinity : max * SHIFT_POINT,
      accel: baseAccel[i] * accelScale * (topSpeedKmh / 250),
    };
  });
}

// 0..10 bars for the garage, derived from the same numbers the physics uses so the
// display can never drift from how the car actually drives. Each stat is mapped across
// the range the catalogue actually spans — a flat scale compressed every car onto the
// same bar and made genuinely different cars look identical.
const STAT_RANGES = {
  topSpeedKmh: [215, 300],
  accelScale: [0.90, 1.30],
  steerScale: [0.80, 1.30],
  gripScale: [0.80, 1.30],
  nosPower: [0.85, 1.30],
};

function bar(value, [lo, hi]) {
  const t = (value - lo) / (hi - lo);
  return Math.max(1, Math.min(10, Math.round(1 + t * 9)));
}

export function statBars(spec) {
  return {
    'TOP SPEED': bar(spec.topSpeedKmh, STAT_RANGES.topSpeedKmh),
    ACCELERATION: bar(spec.accelScale, STAT_RANGES.accelScale),
    HANDLING: bar(spec.steerScale, STAT_RANGES.steerScale),
    GRIP: bar(spec.gripScale, STAT_RANGES.gripScale),
    NITRO: bar(spec.nosPower, STAT_RANGES.nosPower),
  };
}

export const DEFAULT_SPEC = {
  id: 'default',
  name: 'Street',
  class: 'Balanced',
  topSpeedKmh: 250,
  accelScale: 1.0,
  gripScale: 1.0,
  steerScale: 1.0,
  nosPower: 1.0,
  driftiness: 1.0,
  paint: 0xff2d6b,
  accent: 0x22e3ff,
  body: {},
};

export const CARS = [
  {
    id: 'vector',
    name: 'Vector GT',
    class: 'Balanced',
    blurb: 'Even-handed coupé. Good everywhere, best place to learn the drift.',
    topSpeedKmh: 250,
    accelScale: 1.0, gripScale: 1.0, steerScale: 1.0, nosPower: 1.0, driftiness: 1.0,
    paint: 0xff2d6b, accent: 0x22e3ff,
    body: {
      profile: 'coupe',
      length: 4.5, width: 1.94, rideHeight: 0.52, cabinLen: 1.95, cabinHeight: 0.44,
      wing: 'tall', scoop: true, canards: true, wheelR: 0.46, trackWidth: 1.02,
    },
  },
  {
    id: 'kestrel',
    name: 'Kestrel R',
    class: 'Grip',
    blurb: 'Light and pointy. Highest cornering grip, modest top end.',
    topSpeedKmh: 228,
    accelScale: 1.08, gripScale: 1.22, steerScale: 1.18, nosPower: 0.9, driftiness: 0.8,
    paint: 0x8aff6b, accent: 0xffffff,
    body: {
      profile: 'hatch',
      length: 4.0, width: 1.84, rideHeight: 0.50, cabinLen: 2.1, cabinHeight: 0.52,
      wing: 'ducktail', scoop: false, canards: false, wheelR: 0.42, trackWidth: 0.96,
    },
  },
  {
    id: 'torrent',
    name: 'Torrent V8',
    class: 'Muscle',
    blurb: 'Huge thrust, lazy grip. Oversteers on power — hold it with the throttle.',
    topSpeedKmh: 262,
    accelScale: 1.25, gripScale: 0.86, steerScale: 0.86, nosPower: 1.15, driftiness: 1.35,
    paint: 0xffd23f, accent: 0xff2d95,
    body: {
      profile: 'muscle',
      length: 4.9, width: 2.06, rideHeight: 0.56, cabinLen: 1.8, cabinHeight: 0.46,
      wing: 'ducktail', scoop: true, canards: false, wheelR: 0.50, trackWidth: 1.08,
    },
  },
  {
    id: 'apex',
    name: 'Apex Wedge',
    class: 'Top speed',
    blurb: 'Low, wide, aero-led. Fastest in a straight line, needs smooth hands.',
    topSpeedKmh: 288,
    accelScale: 0.95, gripScale: 1.05, steerScale: 0.92, nosPower: 1.25, driftiness: 0.95,
    paint: 0x22e3ff, accent: 0xff2d95,
    body: {
      profile: 'wedge',
      length: 4.7, width: 2.02, rideHeight: 0.44, cabinLen: 1.7, cabinHeight: 0.38,
      wing: 'tall', scoop: false, canards: true, wheelR: 0.45, trackWidth: 1.06,
    },
  },
  {
    id: 'drifter',
    name: 'Tandem S',
    class: 'Drift',
    blurb: 'Built to slide. Loose rear, huge counter-steer lock, endless smoke.',
    topSpeedKmh: 238,
    accelScale: 1.05, gripScale: 0.92, steerScale: 1.25, nosPower: 0.95, driftiness: 1.6,
    paint: 0xffffff, accent: 0xff2d95,
    body: {
      profile: 'coupe',
      length: 4.4, width: 1.9, rideHeight: 0.48, cabinLen: 1.9, cabinHeight: 0.42,
      wing: 'tall', scoop: false, canards: true, wheelR: 0.45, trackWidth: 1.0,
    },
  },
];

export function carById(id) { return CARS.find((c) => c.id === id) || CARS[0]; }

// Wheel and underglow options, applied on top of a car's own look.
export const WHEELS = [
  { id: 'split5', name: 'Split 5', spokes: 5, rim: 0xb6c0cf, dish: 0.30 },
  { id: 'mesh', name: 'Mesh', spokes: 10, rim: 0x8e97a6, dish: 0.26 },
  { id: 'bronze', name: 'Bronze 6', spokes: 6, rim: 0xc08a4a, dish: 0.28 },
  { id: 'black', name: 'Matte Black', spokes: 5, rim: 0x2a2d35, dish: 0.30 },
];

export const PAINTS = [
  { id: 'crimson', name: 'Crimson', hex: 0xff2d6b },
  { id: 'cyan', name: 'Ion', hex: 0x22e3ff },
  { id: 'amber', name: 'Amber', hex: 0xffd23f },
  { id: 'lime', name: 'Lime', hex: 0x8aff6b },
  { id: 'violet', name: 'Violet', hex: 0x9b6bff },
  { id: 'white', name: 'Pearl', hex: 0xf2f4f8 },
  { id: 'graphite', name: 'Graphite', hex: 0x3a3f4b },
];

export const GLOWS = [
  { id: 'cyan', name: 'Cyan', hex: 0x22e3ff },
  { id: 'pink', name: 'Pink', hex: 0xff2d95 },
  { id: 'amber', name: 'Amber', hex: 0xffb347 },
  { id: 'lime', name: 'Lime', hex: 0x8aff6b },
  { id: 'none', name: 'Off', hex: 0x000000 },
];
