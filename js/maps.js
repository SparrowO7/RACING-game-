// Selectable circuits. Each centerline is authored as control points in
// [angleDeg, radiusFactor] form, scaled by (rx, rz) and smoothed into a closed spline by
// track.js. Angles ascend so the loop can't self-intersect; the radius factor is what
// gives each circuit its character — hold it near 1.0 across a wide angular gap for a
// long straight, dip it sharply for a hairpin, alternate it for esses.
//
// Each map also carries its own look: lap target, sky tint, accent colour, ground tint,
// infield treatment (plaza / towers / industrial / water) and whether it gets palms.

export const MAPS = [
  {
    name: 'Dockside Circuit',
    rx: 200, rz: 135, width: 24, laps: 3,
    sky: 0x141d3e, accent: 0x22e3ff, ground: 0x12162c, infield: 'plaza', palms: false,
    // long right-hand straight, hairpin at turn 3, esses on the back section
    shape: [
      [0, 1.00], [22, 1.00], [45, 0.96],
      [70, 0.74], [86, 0.66],
      [104, 0.76], [128, 0.94],
      [152, 1.00], [178, 1.00],
      [205, 0.88], [232, 0.80],
      [258, 0.92], [285, 1.00],
      [312, 0.92], [338, 0.98],
    ],
  },
  {
    name: 'Waterfront Sweep',
    rx: 215, rz: 150, width: 26, laps: 3,
    sky: 0x08202e, accent: 0x2ff0d0, ground: 0x0a1b24, infield: 'water', palms: true,
    // continuous alternating sweepers — flowing, high average speed
    shape: [
      [0, 0.95], [30, 1.00], [60, 0.88], [88, 0.98],
      [118, 0.86], [146, 1.00], [174, 0.90],
      [204, 1.00], [232, 0.86], [262, 0.98],
      [292, 0.88], [322, 1.00], [350, 0.92],
    ],
  },
  {
    name: 'Canyon Run',
    rx: 162, rz: 120, width: 22, laps: 4,
    sky: 0x1c1026, accent: 0xffb347, ground: 0x1a1118, infield: 'industrial', palms: false,
    // tight and relentless: a corner every few seconds. Radius swings are kept modest and
    // spread over wider angles — a sharper zigzag produced ~9 m hairpins, tighter than the
    // car can carry any speed through (tools/check-tracks.mjs rejects those).
    shape: [
      [0, 0.96], [26, 0.80], [52, 0.98], [80, 0.82],
      [108, 0.96], [136, 0.80], [164, 0.98],
      [192, 0.82], [220, 0.96], [248, 0.80],
      [276, 0.98], [304, 0.82], [332, 0.95],
    ],
  },
  {
    name: 'Grand Circuit',
    rx: 255, rz: 175, width: 26, laps: 2,
    sky: 0x120e30, accent: 0xff2d95, ground: 0x14102a, infield: 'towers', palms: false,
    // the long one: three big straights joined by fast loaded corners
    shape: [
      [0, 1.00], [25, 1.00], [50, 1.00], [72, 0.86],
      [96, 0.82], [120, 0.94], [146, 1.00], [172, 1.00],
      [198, 0.88], [224, 0.84], [248, 0.94], [272, 1.00],
      [298, 1.00], [324, 0.90], [350, 0.96],
    ],
  },
  {
    name: 'Airport Chicane',
    rx: 230, rz: 125, width: 28, laps: 3,
    sky: 0x101830, accent: 0x8aff6b, ground: 0x101528, infield: 'plaza', palms: false,
    // two runway-length straights, each ended by a hard chicane — top-gear and NOS track
    shape: [
      [0, 1.00], [18, 1.00], [36, 1.00], [54, 1.00],
      [76, 0.84], [94, 0.90], [112, 0.78],
      [134, 0.92], [158, 1.00], [182, 1.00], [206, 1.00],
      [230, 0.86], [252, 0.92], [274, 0.80],
      [298, 0.94], [322, 1.00], [346, 1.00],
    ],
  },
];
