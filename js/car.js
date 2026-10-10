// The car: physics state, a per-car gearbox, and procedural geometry built from a spec.
//
// Nothing here is hard-coded to a particular vehicle. `spec.body` drives the silhouette
// (profile, dimensions, ride height, wing and wheel style) and `spec` drives the gearbox,
// while physics.js reads the same spec for grip/steer/accel. Customisation (paint, accent,
// wheels, underglow) is layered on top as plain data, so visual changes can never alter
// how a car drives.

import * as THREE from 'three';
import { gearsFor, DEFAULT_SPEC, WHEELS } from './cars.js';
import { damp } from './utils.js';

// Profile tweaks applied on top of the shared body dimensions.
const PROFILES = {
  coupe:  { noseDrop: 0.12, noseLen: 1.7, deckDrop: 0.00, shoulder: 0.36, cabinBack: -0.30, rake: 0.62 },
  hatch:  { noseDrop: 0.10, noseLen: 1.2, deckDrop: 0.10, shoulder: 0.30, cabinBack: -0.10, rake: 0.50 },
  muscle: { noseDrop: 0.04, noseLen: 2.0, deckDrop: 0.02, shoulder: 0.44, cabinBack: -0.45, rake: 0.70 },
  wedge:  { noseDrop: 0.20, noseLen: 2.0, deckDrop: -0.04, shoulder: 0.30, cabinBack: -0.35, rake: 0.78 },
};

export class Car {
  constructor(opts = {}) {
    this.spec = opts.spec || DEFAULT_SPEC;
    this.style = opts.style || {};
    this.isPlayer = false;

    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.body = new THREE.Group();   // leans / squats independently of the heading
    this.group.add(this.body);
    this.position = this.group.position;

    this.gears = gearsFor(this.spec.topSpeedKmh, this.spec.accelScale);

    // physics state
    this.heading = 0;
    this.vel = { x: 0, z: 0 };
    this.steer = 0;
    this.yawRate = 0;
    this.speed = 0; this.speedKmh = 0; this.fwdSpeed = 0; this.latSpeed = 0;
    this.slipAngle = 0; this.drifting = false; this.driftHard = false;
    this.gear = 0;
    this.nos = 100; this.nosActive = false;
    this.surfaceGrip = 1;
    this.nightLevel = 1;      // 1 = night: lights and underglow at full strength
    this._braking = false;
    this._roll = 0; this._pitch = 0;

    this._frontPivots = [];
    this._wheels = [];
    this._rims = [];
    this._disposables = [];
    this._spawn = { x: 0, z: 0, heading: 0 };
    this._build();
  }

  // --- geometry helpers ---
  _mat(opts) { const m = new THREE.MeshStandardMaterial(opts); this._disposables.push(m); return m; }
  _geo(g) { this._disposables.push(g); return g; }

  _box(mat, w, h, d, x, y, z, rx = 0, rz = 0) {
    const m = new THREE.Mesh(this._geo(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    this.body.add(m);
    return m;
  }

  _build() {
    const b = this.spec.body || {};
    const p = PROFILES[b.profile] || PROFILES.coupe;
    const L = b.length ?? 4.5;            // overall length
    const W = b.width ?? 1.94;            // body width
    const Y = b.rideHeight ?? 0.52;       // floor-pan height
    const cabLen = b.cabinLen ?? 1.95;
    const cabH = b.cabinHeight ?? 0.44;
    const wheelR = b.wheelR ?? 0.46;
    const tw = b.trackWidth ?? 1.02;      // half-track (wheel centre offset)
    const halfL = L / 2;

    const paintHex = this.style.paint ?? this.spec.paint ?? 0xff2d6b;
    const accentHex = this.style.accent ?? this.spec.accent ?? 0x22e3ff;
    const wheelStyle = WHEELS.find((w) => w.id === (this.style.wheels || 'split5')) || WHEELS[0];

    const paint = this._mat({ color: paintHex, metalness: 0.5, roughness: 0.3 });
    const paintDark = this._mat({ color: paintHex, metalness: 0.6, roughness: 0.45 });
    const carbon = this._mat({ color: 0x1b1d23, metalness: 0.5, roughness: 0.45 });
    const glass = this._mat({ color: 0x0a0f1c, metalness: 0.8, roughness: 0.1 });
    const chrome = this._mat({ color: 0xc9d2de, metalness: 0.95, roughness: 0.2 });
    const accentMat = this._mat({ color: accentHex, emissive: accentHex, emissiveIntensity: 1.2 });

    // --- chassis ---
    this._box(paint, W, 0.40, L, 0, Y, 0);                                   // main tub
    this._box(paint, W * 0.95, 0.26, p.noseLen, 0, Y - p.noseDrop, halfL - p.noseLen / 2 - 0.05); // bonnet
    this._box(carbon, W * 0.93, 0.14, 0.75, 0, Y - p.noseDrop - 0.1, halfL - 0.05);               // splitter
    this._box(carbon, W * 1.09, 0.20, L * 0.56, 0, Y - 0.22, -0.1);          // side skirts
    this._box(paintDark, W * 1.04, p.shoulder, L * 0.29, 0, Y + 0.06 - p.deckDrop, -halfL * 0.82); // rear deck
    this._box(carbon, W * 0.96, 0.16, 0.5, 0, Y - 0.2, -halfL + 0.08);       // diffuser

    // wide arches over each wheel
    for (const sx of [-1, 1]) for (const z of [tw * 1.45, -tw * 1.47]) {
      this._box(paintDark, 0.34, 0.40, 1.82, sx * tw, Y + 0.04, z);
    }
    if (b.scoop) this._box(carbon, W * 0.37, 0.16, 0.8, 0, Y + 0.06, halfL - 1.0);
    if (b.canards) for (const sx of [-1, 1]) this._box(carbon, 0.34, 0.1, 0.5, sx * W * 0.43, Y - p.noseDrop - 0.07, halfL - 0.15);

    // --- glasshouse ---
    const cz = p.cabinBack;
    this._box(paint, W * 0.78, cabH, cabLen, 0, Y + 0.42, cz);
    this._box(glass, W * 0.75, cabH * 0.9, cabLen * 1.04, 0, Y + 0.46, cz);
    this._box(glass, W * 0.74, 0.56, 0.12, 0, Y + 0.38, cz + cabLen / 2 + 0.12, -p.rake);
    this._box(glass, W * 0.71, 0.50, 0.12, 0, Y + 0.36, cz - cabLen / 2 - 0.1, p.rake * 0.8);
    this._box(paint, W * 0.77, 0.1, cabLen * 0.82, 0, Y + 0.63, cz - 0.1);
    for (const sx of [-1, 1]) this._box(carbon, 0.12, 0.1, 0.2, sx * W * 0.53, Y + 0.32, cz + cabLen / 2);

    // --- rear wing ---
    if (b.wing === 'tall') {
      for (const sx of [-0.74, 0.74]) this._box(carbon, 0.1, 0.46, 0.14, sx, Y + 0.44, -halfL + 0.1);
      this._box(carbon, W * 1.01, 0.08, 0.52, 0, Y + 0.70, -halfL + 0.08);
      this._box(accentMat, W * 1.01, 0.07, 0.08, 0, Y + 0.74, -halfL - 0.16);
      for (const sx of [-1, 1]) this._box(carbon, 0.06, 0.34, 0.56, sx * W * 0.51, Y + 0.58, -halfL + 0.08);
    } else if (b.wing === 'ducktail') {
      this._box(paintDark, W * 0.99, 0.12, 0.42, 0, Y + 0.28 - p.deckDrop, -halfL + 0.2, -0.22);
      this._box(accentMat, W * 0.99, 0.05, 0.07, 0, Y + 0.33 - p.deckDrop, -halfL + 0.02);
    }

    // --- lights ---
    this.headMat = this._mat({ color: 0xffffff, emissive: 0xfff4cf, emissiveIntensity: 1.6 });
    for (const sx of [-1, 1]) this._box(this.headMat, W * 0.24, 0.11, 0.1, sx * W * 0.34, Y - p.noseDrop + 0.02, halfL + 0.05);
    for (const sx of [-1, 1]) this._box(accentMat, W * 0.24, 0.04, 0.08, sx * W * 0.34, Y - p.noseDrop - 0.06, halfL + 0.05);
    this.tailMat = this._mat({ color: 0xff0a33, emissive: 0xff0022, emissiveIntensity: 1.1 });
    this._box(this.tailMat, W * 0.84, 0.12, 0.08, 0, Y + 0.14, -halfL - 0.05);
    for (const sx of [-1, 1]) this._box(this.tailMat, W * 0.22, 0.2, 0.06, sx * W * 0.28, Y + 0.12, -halfL - 0.07);

    // --- exhausts ---
    for (const sx of [-0.4, 0.4]) {
      const pipe = new THREE.Mesh(this._geo(new THREE.CylinderGeometry(0.1, 0.11, 0.26, 10)), chrome);
      pipe.rotation.x = Math.PI / 2; pipe.position.set(sx, Y - 0.19, -halfL - 0.15); this.body.add(pipe);
    }

    // --- underglow (skipped entirely when set to 'none') ---
    const glowHex = this.style.glow;
    if (glowHex !== 0 && glowHex !== undefined) {
      this.glowMat = new THREE.MeshBasicMaterial({
        color: glowHex, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      this._disposables.push(this.glowMat);
      const glow = new THREE.Mesh(this._geo(new THREE.PlaneGeometry(W * 1.34, L * 1.2)), this.glowMat);
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; this.body.add(glow);
    }

    // --- wheels ---
    const tyreMat = this._mat({ color: 0x121317, roughness: 0.95 });
    const rimMat = this._mat({ color: wheelStyle.rim, metalness: 0.9, roughness: 0.25 });
    const tyreGeo = this._geo(new THREE.CylinderGeometry(wheelR, wheelR, wheelR * 0.78, 20));
    const dishGeo = this._geo(new THREE.CylinderGeometry(wheelStyle.dish * (wheelR / 0.46), wheelStyle.dish * (wheelR / 0.46), wheelR * 0.82, 14));
    const spokeGeo = this._geo(new THREE.BoxGeometry(0.07, 0.05, wheelR * 1.2));
    for (const wp of [
      { x: -tw, z: tw * 1.45, front: true }, { x: tw, z: tw * 1.45, front: true },
      { x: -tw, z: -tw * 1.47, front: false }, { x: tw, z: -tw * 1.47, front: false },
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(wp.x, wheelR, wp.z);
      const tyre = new THREE.Mesh(tyreGeo, tyreMat); tyre.rotation.z = Math.PI / 2; tyre.castShadow = true;
      const dish = new THREE.Mesh(dishGeo, rimMat); dish.rotation.z = Math.PI / 2;
      pivot.add(tyre); pivot.add(dish);
      for (let i = 0; i < wheelStyle.spokes; i++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.rotation.x = (i / wheelStyle.spokes) * Math.PI;
        dish.add(spoke);
      }
      this.body.add(pivot);
      this._wheels.push(tyre); this._rims.push(dish);
      if (wp.front) this._frontPivots.push(pivot);
    }

    this._wheelR = wheelR;
  }

  setSpawn(x, z, heading = 0) { this._spawn = { x, z, heading }; this.reset(); }

  reset() {
    this.position.set(this._spawn.x, 0, this._spawn.z);
    this.heading = this._spawn.heading;
    this.vel.x = 0; this.vel.z = 0;
    this.steer = 0; this.yawRate = 0;
    this.speed = 0; this.speedKmh = 0; this.fwdSpeed = 0; this.latSpeed = 0;
    this.slipAngle = 0; this.drifting = false; this.driftHard = false;
    this.gear = 0; this.nos = 100; this.nosActive = false;
    this.surfaceGrip = 1;
    this._roll = 0; this._pitch = 0;
    this.syncVisuals(0);
  }

  // --- gearbox (per-car table) ---
  shiftUp() {
    if (this.gear >= this.gears.length - 1) return false;
    if (this.speedKmh >= this.gears[this.gear].up) { this.gear++; return true; }
    return false;
  }
  shiftDown() { if (this.gear > 0) { this.gear--; return true; } return false; }
  canShiftUp() { return this.gear < this.gears.length - 1 && this.speedKmh >= this.gears[this.gear].up; }
  canShiftDown() { return this.gear > 0 && this.speedKmh < this.gears[this.gear - 1].up * 0.6; }

  // Rev fraction within the current gear — drives the engine note and any tacho.
  rev() {
    const g = this.gear;
    const floor = g === 0 ? 0 : this.gears[g - 1].max;
    const ceil = this.gears[g].max;
    return Math.max(0, Math.min(1, (this.speedKmh - floor) / (ceil - floor || 1)));
  }

  syncVisuals(dt) {
    this.group.rotation.y = this.heading;

    // body roll into the slide, dive under braking, squat on nitrous
    const rollTarget = -(this.latSpeed / 14) * 0.1;
    const pitchTarget = this._braking && this.fwdSpeed > 2 ? -0.025 : (this.nosActive ? 0.022 : 0);
    if (dt > 0) {
      this._roll = damp(this._roll, rollTarget, 7, dt);
      this._pitch = damp(this._pitch, pitchTarget, 6, dt);
    } else { this._roll = rollTarget; this._pitch = pitchTarget; }
    this.body.rotation.z = this._roll;
    this.body.rotation.x = this._pitch;

    for (const pivot of this._frontPivots) pivot.rotation.y = this.steer;
    const spin = (this.fwdSpeed * dt) / this._wheelR;
    for (const w of this._wheels) w.rotation.x -= spin;
    for (const r of this._rims) r.rotation.x -= spin;

    // Lights read differently by time of day: tail lamps stay legible under braking even
    // in sunlight (they are a gameplay signal), while the decorative underglow all but
    // disappears. `nightLevel` is 1 at night and ~0.18 at midday.
    const n = this.nightLevel;
    const braking = this._braking && this.fwdSpeed > 1;
    this.tailMat.emissiveIntensity = braking ? 2.8 : (0.25 + 0.85 * n);
    this.headMat.emissiveIntensity = 0.3 + 1.3 * n;
    if (this.glowMat) {
      const base = this.nosActive ? 0.7 : (this.drifting ? 0.5 : 0.35);
      this.glowMat.opacity = base * (0.08 + 0.92 * n);
    }
  }

  // Release the geometry and materials this car created (called when swapping cars/maps).
  dispose() {
    for (const d of this._disposables) d.dispose?.();
    this._disposables.length = 0;
  }
}
