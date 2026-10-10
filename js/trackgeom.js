// Pure track geometry — no three.js, so it can be unit-tested in Node.
//
// A circuit is authored as [angleDeg, radiusFactor] control points (see maps.js), turned
// into world-space points, smoothed with a closed uniform Catmull-Rom spline, and
// resampled at even arc length. Keeping this separate from the mesh building means the
// shape of every map can be validated headlessly — a self-intersecting centerline would
// silently break the asphalt ribbon, the boundary constraint and the lap counter.

// Uniform Catmull-Rom through p1..p2 (p0/p3 are the neighbours).
export function crPoint(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}

// [angleDeg, radiusFactor][] -> world-space control points.
export function controlPoints(shape, rx, rz) {
  return shape.map(([deg, rf]) => {
    const a = (deg * Math.PI) / 180;
    return { x: Math.cos(a) * rx * rf, z: Math.sin(a) * rz * rf };
  });
}

// Dense-sample the closed spline, then resample at ~`step` spacing so physics, kerb
// placement and dash spacing stay uniform all the way round the lap.
export function splineLoop(ctrl, step = 6) {
  const n = ctrl.length;
  const dense = [];
  const SUB = 24;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < SUB; s++) dense.push(crPoint(p0, p1, p2, p3, s / SUB));
  }
  const m = dense.length;
  const cum = [0];
  for (let i = 1; i <= m; i++) {
    const a = dense[i - 1], b = dense[i % m];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[m];
  const count = Math.max(48, Math.round(total / step));
  const points = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (seg < m && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const t = (target - cum[seg]) / segLen;
    const a = dense[seg], b = dense[(seg + 1) % m];
    points.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return { points, length: total };
}

// Inward-pointing unit normals (the control points ascend in angle, so the loop runs
// counter-clockwise and the left normal faces the centre).
export function loopNormals(points) {
  const n = points.length, out = [];
  for (let i = 0; i < n; i++) {
    const next = points[(i + 1) % n], prev = points[(i - 1 + n) % n];
    const tx = next.x - prev.x, tz = next.z - prev.z, tl = Math.hypot(tx, tz) || 1;
    out.push({ nx: -tz / tl, nz: tx / tl });
  }
  return out;
}

export function loopBounds(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  return {
    minX, maxX, minZ, maxZ,
    extent: { x: Math.max(Math.abs(minX), Math.abs(maxX)), z: Math.max(Math.abs(minZ), Math.abs(maxZ)) },
  };
}
