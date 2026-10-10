// Race track: a closed circuit built from hand-authored control points, smoothed with a
// closed Catmull-Rom spline and resampled at even arc length. That gives real circuit
// character — long straights, hairpins, chicanes, sweepers — instead of an oval.
//
// Everything downstream (AI waypoints, grid poses, asphalt ribbon, kerbs, guardrails,
// gates, lamps, the radar, and the boundary constraint) works off the resampled
// centerline plus its outward normals, so a new shape needs no other changes.
//
// Control points arrive as [angleDeg, radiusFactor] pairs scaled by (rx, rz). Keeping
// them in increasing-angle order around the centre guarantees a simple closed loop that
// can't self-intersect, which keeps the ribbon mesh and the lap logic valid.

import * as THREE from 'three';
import { controlPoints, splineLoop, loopNormals, loopBounds } from './trackgeom.js';
import { registerGlow, applyGlow } from './timeofday.js';

const RAIL_INNER = 0x22e3ff; // cyan  = inside edge
const RAIL_OUTER = 0xff2d95; // magenta = outside edge
const GATE_COLOR = 0x8aff6b;

function checkerTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 32;
  const g = c.getContext('2d'), sq = 16;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
    g.fillStyle = ((x + y) % 2 === 0) ? '#f2f2f2' : '#111111';
    g.fillRect(x * sq, y * sq, sq, sq);
  }
  return new THREE.CanvasTexture(c);
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW_TEX = glowTexture();

export class Track {
  constructor(config = {}) {
    this.width = config.width ?? 24;
    this.lampStep = config.lampStep ?? 11;   // from the quality preset
    const rx = config.rx ?? 180, rz = config.rz ?? 120;
    const shape = config.shape ?? [[0, 1], [90, 1], [180, 1], [270, 1]];

    const loop = splineLoop(controlPoints(shape, rx, rz), 6);
    this.waypoints = loop.points;
    this.length = loop.length;

    // world-space bounds, used to place scenery clear of the circuit
    const b = loopBounds(this.waypoints);
    this.bounds = b;
    this.extent = b.extent;

    this._normals = loopNormals(this.waypoints);
    this._glows = [];          // lamps, rails, gates: dimmed in daylight
    this.group = new THREE.Group();
    this._lastIdx = new WeakMap(); // per-car search hint for constrain()
    this._build();
  }

  // Point on the centerline offset sideways, plus the heading along the track there.
  poseAt(idxOffset = 0, lateral = 0) {
    const wp = this.waypoints, n = wp.length;
    const idx = ((Math.round(idxOffset) % n) + n) % n;
    const p = wp[idx], next = wp[(idx + 1) % n];
    const tx = next.x - p.x, tz = next.z - p.z, tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    return { x: p.x + nx * lateral, z: p.z + nz * lateral, heading: Math.atan2(tx, tz) };
  }

  // Outward-offset point, used by world.js to place scenery that never lands on the road.
  edgePoint(i, outward) {
    const p = this.waypoints[i], nrm = this._normals[i];
    // -normal is the outer side of the loop (normals point inward for a CCW loop)
    return { x: p.x - nrm.nx * outward, z: p.z - nrm.nz * outward };
  }
  innerPoint(i, inward) {
    const p = this.waypoints[i], nrm = this._normals[i];
    return { x: p.x + nrm.nx * inward, z: p.z + nrm.nz * inward };
  }

  // Nearest centerline index, searched locally around the last known index for speed.
  _nearestIdx(x, z, car) {
    const wp = this.waypoints, n = wp.length;
    const hint = car ? this._lastIdx.get(car) : undefined;
    let best = 0, bd = Infinity;
    if (hint !== undefined) {
      const span = 24;
      for (let k = -span; k <= span; k++) {
        const i = ((hint + k) % n + n) % n;
        const dx = wp[i].x - x, dz = wp[i].z - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      // if the local window clearly lost the car, fall back to a full scan
      if (bd < (this.width * 3) ** 2) { if (car) this._lastIdx.set(car, best); return best; }
    }
    bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = wp[i].x - x, dz = wp[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    if (car) this._lastIdx.set(car, best);
    return best;
  }

  // How far along the lap this car is, 0..n (used for race positions).
  progressIndex(car) { return this._nearestIdx(car.position.x, car.position.z, car); }

  // Distance from a world point to the centerline. world.js uses this to reject any
  // scenery that would land on (or too near) the road — the fix for trees on the track.
  distanceTo(x, z) {
    const wp = this.waypoints;
    let bd = Infinity;
    for (let i = 0; i < wp.length; i++) {
      const dx = wp[i].x - x, dz = wp[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) bd = d;
    }
    return Math.sqrt(bd);
  }

  // Keep a car on the ribbon (anti-cheat + walls). Clamps it inside the track edge and
  // removes outward velocity. Returns the outward speed removed (m/s), 0 if safely inside.
  constrain(car, margin = 1.5) {
    const i = this._nearestIdx(car.position.x, car.position.z, car);
    const p = this.waypoints[i], nrm = this._normals[i];
    const lat = (car.position.x - p.x) * nrm.nx + (car.position.z - p.z) * nrm.nz;
    const maxLat = this.width / 2 - margin;
    if (Math.abs(lat) <= maxLat) return 0;
    const s = Math.sign(lat), over = Math.abs(lat) - maxLat;
    car.position.x -= nrm.nx * s * over;
    car.position.z -= nrm.nz * s * over;
    const vn = (car.vel.x * nrm.nx + car.vel.z * nrm.nz) * s;
    let removed = 0;
    if (vn > 0) { car.vel.x -= vn * nrm.nx * s; car.vel.z -= vn * nrm.nz * s; removed = vn; }
    car.speed = Math.hypot(car.vel.x, car.vel.z);
    car.speedKmh = car.speed * 3.6;
    return removed;
  }

  _build() {
    this._ribbon();
    this._dashes();
    this._kerbs();
    this._barriers();
    this._startLine();
    this._gantry();
    this._gates();
    this._lamps();
  }

  _ribbon() {
    const wp = this.waypoints, n = wp.length, half = this.width / 2, pos = [];
    for (let i = 0; i < n; i++) {
      const p = wp[i], nrm = this._normals[i];
      pos.push(p.x + nrm.nx * half, 0.03, p.z + nrm.nz * half);
      pos.push(p.x - nrm.nx * half, 0.03, p.z - nrm.nz * half);
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const a0 = i * 2, b0 = i * 2 + 1, a1 = ((i + 1) % n) * 2, b1 = ((i + 1) % n) * 2 + 1;
      idx.push(a0, b0, a1, b0, b1, a1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1b1f2b, roughness: 0.95, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  _dashes() {
    const wp = this.waypoints, n = wp.length;
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4d35e, emissive: 0x5a4a10, emissiveIntensity: 0.5 });
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.35, 3), mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
    let c = 0;
    for (let i = 0; i < n; i += 2) {
      const p = wp[i], next = wp[(i + 1) % n];
      q.setFromAxisAngle(up, Math.atan2(next.x - p.x, next.z - p.z)).multiply(flat);
      pos.set(p.x, 0.05, p.z); m.compose(pos, q, scl); inst.setMatrixAt(c++, m);
    }
    inst.count = c; inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  // Red/white rumble-strip kerbs wherever the centerline actually bends.
  _kerbs() {
    const wp = this.waypoints, n = wp.length, half = this.width / 2 - 0.3;
    const corners = [];
    for (let i = 0; i < n; i++) {
      const a0 = this._normals[i], a1 = this._normals[(i + 1) % n];
      if (a0.nx * a1.nx + a0.nz * a1.nz < 0.9994) corners.push(i);
    }
    const geo = new THREE.BoxGeometry(1.0, 0.14, 1.7);
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd21f2f, roughness: 0.6, emissive: 0x3a0608, emissiveIntensity: 0.4 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
    const cap = corners.length * 2 + 2;
    const red = new THREE.InstancedMesh(geo, redMat, cap);
    const white = new THREE.InstancedMesh(geo, whiteMat, cap);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const scl = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    let ri = 0, wi = 0, c = 0;
    for (const i of corners) {
      const p = wp[i], nrm = this._normals[i];
      q.setFromAxisAngle(up, Math.atan2(nrm.nz, -nrm.nx));
      const useRed = (c % 2 === 0);
      for (const sideSign of [1, -1]) {
        pos.set(p.x + nrm.nx * half * sideSign, 0.07, p.z + nrm.nz * half * sideSign);
        m.compose(pos, q, scl);
        if (useRed) red.setMatrixAt(ri++, m); else white.setMatrixAt(wi++, m);
      }
      c++;
    }
    red.count = ri; white.count = wi;
    red.instanceMatrix.needsUpdate = true; white.instanceMatrix.needsUpdate = true;
    this.group.add(red); this.group.add(white);
  }

  // Low neon guardrails on both edges: dark wall + glowing top rail. Cyan inside,
  // magenta outside, so the circuit's direction always reads at a glance.
  _barriers() {
    const wp = this.waypoints, n = wp.length, half = this.width / 2, H = 1.4;
    const wall = (sideSign, railColor) => {
      const wallPos = [], railPos = [], idx = [];
      for (let i = 0; i < n; i++) {
        const p = wp[i], nrm = this._normals[i];
        const ex = p.x + nrm.nx * half * sideSign, ez = p.z + nrm.nz * half * sideSign;
        wallPos.push(ex, 0, ez, ex, H, ez);
        railPos.push(ex, H, ez, ex, H + 0.2, ez);
      }
      for (let i = 0; i < n; i++) {
        const a0 = i * 2, b0 = i * 2 + 1, a1 = ((i + 1) % n) * 2, b1 = ((i + 1) % n) * 2 + 1;
        idx.push(a0, b0, a1, b0, b1, a1);
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
      wg.setIndex(idx); wg.computeVertexNormals();
      this.group.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x0f1320, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide })));
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
      rg.setIndex(idx);
      const railMat = new THREE.MeshBasicMaterial({ color: railColor, side: THREE.DoubleSide });
      registerGlow(this._glows, railMat, { dimColor: true, floor: 0.45 });
      this.group.add(new THREE.Mesh(rg, railMat));
    };
    wall(1, RAIL_INNER);
    wall(-1, RAIL_OUTER);
  }

  _startLine() {
    const pose = this.poseAt(0, 0);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(this.width, 3),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 }));
    band.rotation.x = -Math.PI / 2; band.rotation.z = -pose.heading;
    band.position.set(pose.x, 0.06, pose.z);
    this.group.add(band);
  }

  _gantry() {
    const pose = this.poseAt(0, 0), H = 6, half = this.width / 2 + 1;
    const rx = Math.cos(pose.heading), rz = -Math.sin(pose.heading);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x202633, metalness: 0.5, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, H, 8), postMat);
      post.position.set(pose.x + rx * half * s, H / 2, pose.z + rz * half * s);
      post.castShadow = true; this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.width + 2, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x151a26 }));
    beam.position.set(pose.x, H, pose.z); beam.rotation.y = pose.heading; this.group.add(beam);
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0x0b0e1a, emissive: RAIL_INNER, emissiveIntensity: 0.6 });
    registerGlow(this._glows, bannerMat, { floor: 0.3 });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(this.width, 1.3, 0.25), bannerMat);
    banner.position.set(pose.x, H - 1.0, pose.z); banner.rotation.y = pose.heading; this.group.add(banner);
  }

  _gates() {
    const n = this.waypoints.length, H = 4.5, half = this.width / 2 + 0.6;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.6 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0x0c1420, emissive: GATE_COLOR, emissiveIntensity: 0.8 });
    registerGlow(this._glows, barMat, { floor: 0.35 });
    for (const gi of [Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)]) {
      const pose = this.poseAt(gi, 0);
      const rx = Math.cos(pose.heading), rz = -Math.sin(pose.heading);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, H, 6), postMat);
        post.position.set(pose.x + rx * half * s, H / 2, pose.z + rz * half * s);
        this.group.add(post);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(this.width + 1.2, 0.5, 0.4), barMat);
      bar.position.set(pose.x, H, pose.z); bar.rotation.y = pose.heading; this.group.add(bar);
    }
  }

  _lamps() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f55, roughness: 0.7 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe8a3, emissive: 0xffd27a, emissiveIntensity: 1.8 });
    registerGlow(this._glows, bulbMat, { floor: 0.08 });
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.18, 6, 8), bulbGeo = new THREE.BoxGeometry(0.6, 0.25, 0.6);
    const poolGeo = new THREE.CircleGeometry(5, 20);
    const poolMat = new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: 0xffcf8a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    registerGlow(this._glows, poolMat, { floor: 0 });  // no pool of light in daylight
    const n = this.waypoints.length, off = this.width / 2 + 2.5;
    for (let i = 0; i < n; i += this.lampStep) {
      const e = this.edgePoint(i, off);
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(e.x, 3, e.z); pole.castShadow = true; this.group.add(pole);
      const bulb = new THREE.Mesh(bulbGeo, bulbMat); bulb.position.set(e.x, 6, e.z); this.group.add(bulb);
      const pool = new THREE.Mesh(poolGeo, poolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(e.x, 0.07, e.z); this.group.add(pool);
    }
  }

  // Scale every glowing track material to the current time of day (1 = night).
  setNightLevel(level) { applyGlow(this._glows, level); }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
  }
}
