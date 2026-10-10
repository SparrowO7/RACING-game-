// Validates every circuit in maps.js headlessly, before it ever reaches the GPU.
//
// A self-intersecting or self-touching centerline silently breaks three things at once:
// the asphalt ribbon triangulates into a knot, Track.constrain() can snap a car across to
// a different part of the lap, and the checkpoint lap counter can be skipped. So we check:
//   1. no two non-adjacent centerline segments cross
//   2. no two distant points come closer than the full track width (sections overlapping)
//   3. corner radius stays drivable (a hairpin tighter than the car can turn is unfair)
//   4. sample spacing is uniform (physics, kerbs and dashes all assume it)
//
// Run: node tools/check-tracks.mjs

import { MAPS } from '../js/maps.js';
import { controlPoints, splineLoop, loopNormals, loopBounds } from '../js/trackgeom.js';

function segmentsCross(a1, a2, b1, b2) {
  const d = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = d(b1, b2, a1), d2 = d(b1, b2, a2), d3 = d(a1, a2, b1), d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Radius of the circle through three consecutive samples.
function cornerRadius(p0, p1, p2) {
  const a = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const b = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  const c = Math.hypot(p2.x - p0.x, p2.z - p0.z);
  const area = Math.abs((p1.x - p0.x) * (p2.z - p0.z) - (p2.x - p0.x) * (p1.z - p0.z)) / 2;
  if (area < 1e-6) return Infinity;
  return (a * b * c) / (4 * area);
}

let failures = 0;

for (const m of MAPS) {
  const { points, length } = splineLoop(controlPoints(m.shape, m.rx, m.rz), 6);
  const n = points.length;
  const normals = loopNormals(points);
  const bounds = loopBounds(points);
  const problems = [];

  // 1. segment crossings (skip neighbours, which legitimately share endpoints)
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    const a1 = points[i], a2 = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // wrap-around neighbour
      const b1 = points[j], b2 = points[(j + 1) % n];
      if (segmentsCross(a1, a2, b1, b2)) crossings++;
    }
  }
  if (crossings) problems.push(`${crossings} self-intersection(s)`);

  // 2. distant sections crowding each other (would let cars jump between them).
  // Separation must be measured against the ALONG-LAP distance, taking the wrap-around
  // into account — points either side of index 0 are neighbours, not distant sections.
  const minSep = m.width * 1.15;
  const skip = Math.ceil(minSep / 6) + 6;
  let tooClose = 0, closest = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const along = Math.min(j - i, n - (j - i));
      if (along < skip) continue;
      const d = Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z);
      if (d < closest) closest = d;
      if (d < minSep) tooClose++;
    }
  }
  if (tooClose) problems.push(`${tooClose} overlapping pair(s), closest ${closest.toFixed(1)}m < ${minSep.toFixed(1)}m`);

  // 3. drivable corner radius
  let minR = Infinity;
  for (let i = 0; i < n; i++) {
    const r = cornerRadius(points[(i - 2 + n) % n], points[i], points[(i + 2) % n]);
    if (r < minR) minR = r;
  }
  if (minR < 14) problems.push(`tightest corner radius ${minR.toFixed(1)}m is too sharp`);

  // 4. uniform sampling
  let minStep = Infinity, maxStep = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d < minStep) minStep = d;
    if (d > maxStep) maxStep = d;
  }
  if (maxStep / minStep > 1.5) problems.push(`uneven sampling ${minStep.toFixed(2)}..${maxStep.toFixed(2)}m`);

  // 5. normals must point inward (world.js relies on this to place props off-road):
  // moving along the normal should move TOWARD the centre, so p·n must be negative.
  const mid = Math.floor(n / 2);
  const nrm = normals[mid], p = points[mid];
  if (p.x * nrm.nx + p.z * nrm.nz > 0) problems.push('normals point outward (scenery would be placed on the road)');

  const ok = problems.length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${m.name.padEnd(20)} ` +
    `${Math.round(length)}m  ${n} pts  minR ${minR === Infinity ? '-' : minR.toFixed(0) + 'm'}  ` +
    `extent ${bounds.extent.x.toFixed(0)}x${bounds.extent.z.toFixed(0)}` +
    (ok ? '' : '\n      -> ' + problems.join('; '))
  );
}

console.log(failures ? `\n${failures} map(s) need fixing` : '\nAll maps valid');
process.exit(failures ? 1 : 0);
