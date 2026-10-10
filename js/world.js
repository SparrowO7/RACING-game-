// World: atmosphere (gradient sky dome, stars, moon), lighting, a textured ground, and a
// rebuildable city built AROUND the current circuit.
//
// Every prop is placed from the track's own geometry, not from a bounding ellipse: props
// either sit at `track.edgePoint(i, offset)` — a point pushed straight out from the road
// edge along the centerline normal — or are rejected when `track.distanceTo()` says they'd
// land too close to the road. That's what keeps trees and buildings off the racing line on
// irregular, splined circuits.

import * as THREE from 'three';
import { skyTextureFor, timeById, DEFAULT_TIME, registerGlow, applyGlow } from './timeofday.js';
import { qualityById } from './quality.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

// ---------- shared textures (built once) ----------
function windowTexture(litHex) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#06080f'; g.fillRect(0, 0, 64, 128);
  const cols = 5, rows = 14, mw = 7, mh = 5;
  const gx = (64 - cols * mw) / (cols + 1), gy = (128 - rows * mh) / (rows + 1);
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    g.fillStyle = Math.random() < 0.5 ? litHex : '#0a0e1c';
    g.fillRect(gx + col * (mw + gx), gy + r * (mh + gy), mw, mh);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.5, 3);
  return t;
}
function discTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(226,236,255,0.6)');
  grad.addColorStop(1, 'rgba(226,236,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function groundTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let i = 0; i < 1400; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  g.strokeStyle = 'rgba(150,170,255,0.10)'; g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(70, 70);
  return t;
}
function billboardTexture(text, accentHex) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#070a16'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = accentHex; g.lineWidth = 6; g.strokeRect(8, 8, 240, 112);
  g.fillStyle = accentHex; for (let i = 0; i < 3; i++) g.fillRect(28 + i * 20, 54, 10, 20);
  g.fillStyle = '#ffffff'; g.font = 'bold 54px Arial'; g.textBaseline = 'middle';
  g.fillText(text, 92, 64);
  return new THREE.CanvasTexture(c);
}

const WINDOW_MATS = [
  new THREE.MeshStandardMaterial({ color: 0x1a2040, roughness: 0.85, emissive: 0xffffff, emissiveMap: windowTexture('#bfeeff'), emissiveIntensity: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0x241a33, roughness: 0.85, emissive: 0xffffff, emissiveMap: windowTexture('#ffd9a0'), emissiveIntensity: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0x1f1830, roughness: 0.85, emissive: 0xffffff, emissiveMap: windowTexture('#ff9ad1'), emissiveIntensity: 0.85 }),
];
const NEON_MATS = [
  new THREE.MeshStandardMaterial({ color: 0xff2d95, emissive: 0xff2d95, emissiveIntensity: 1.5 }),
  new THREE.MeshStandardMaterial({ color: 0x22e3ff, emissive: 0x22e3ff, emissiveIntensity: 1.5 }),
  new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xffb347, emissiveIntensity: 1.3 }),
];
const SKYLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x0a0e1e });
const BILLBOARD_WORDS = ['NEON', 'DRIFT', 'V-MAX', 'RUN', 'TURBO', '240'];

const MAX_STARS = 700;

export class World {
  constructor(scene, qualityId = 'high') {
    this.scene = scene;
    this.q = qualityById(qualityId);
    this.cityGroup = null;
    this._spinners = [];
    this._groundTex = groundTexture();

    // Two glow registries: `_glows` for the module-level materials shared across every
    // map, `_cityGlows` for the ones a single buildCity() creates (and which are dropped
    // when the map changes). Both get scaled by the time of day.
    this._glows = [];
    this._cityGlows = [];
    for (const m of WINDOW_MATS) registerGlow(this._glows, m, { floor: 0.06 });
    for (const m of NEON_MATS) registerGlow(this._glows, m, { floor: 0.08 });

    this.time = timeById(DEFAULT_TIME);
    this.nightLevel = this.time.nightLevel;
    this._buildStatic();
  }

  _buildStatic() {
    const scene = this.scene;
    scene.background = new THREE.Color(0x141d3e);
    scene.fog = new THREE.Fog(0x241a44, 300, 1100);

    // Lights are created once and re-coloured by applyTime(), so switching time of day
    // never rebuilds the scene graph or re-allocates shadow maps.
    this.hemi = new THREE.HemisphereLight(0xafc4ff, 0x2a2550, 1.0);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xfff0d6, 1.3);
    sun.position.set(160, 220, 100);
    sun.castShadow = this.q.shadows;
    sun.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    const s = 340;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s; sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 760; sun.shadow.bias = -0.0004;
    scene.add(sun); this.sun = sun;

    this.fill = new THREE.DirectionalLight(0xff4fae, 0.3);
    this.fill.position.set(-140, 70, -170);
    scene.add(this.fill);

    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x12162c, roughness: 1, map: this._groundTex });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    this._sky();
  }

  _sky() {
    // The sky is a canvas gradient on the inside of a dome. applyTime() repaints that one
    // canvas in place, which is why the texture is kept rather than recreated.
    this._skyCanvas = skyTextureFor(timeById(DEFAULT_TIME));
    this._skyTex = new THREE.CanvasTexture(this._skyCanvas);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 16),
      new THREE.MeshBasicMaterial({ map: this._skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -1; this.scene.add(dome);
    this.dome = dome;

    const N = MAX_STARS, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.55 + 0.05, R = 2000;
      pos[i * 3] = Math.cos(u) * Math.cos(v * Math.PI / 2) * R;
      pos[i * 3 + 1] = Math.sin(v * Math.PI / 2) * R;
      pos[i * 3 + 2] = Math.sin(u) * Math.cos(v * Math.PI / 2) * R;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    this.stars.renderOrder = -1; this.scene.add(this.stars);
    // draw range rather than a rebuild, so quality can change without re-allocating
    this.stars.geometry.setDrawRange(0, this.q.stars);

    this._disc = discTexture();
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._disc, color: 0xdfe8ff, fog: false, depthWrite: false, transparent: true }));
    this.moon.scale.set(190, 190, 1); this.moon.position.set(-760, 700, -1350); this.scene.add(this.moon);

    // A second disc stands in for the sun; invisible at night, it anchors the daytime sky.
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._disc, color: 0xfff3cf, fog: false, depthWrite: false, transparent: true, opacity: 0 }));
    this.sunDisc.scale.set(150, 150, 1); this.scene.add(this.sunDisc);
  }

  // Switch time of day. `theme` is the current map, so the ground can keep part of its
  // identity tint while still reading as daylight.
  applyTime(preset, theme = {}, renderer = null) {
    this.time = preset;
    this.nightLevel = preset.nightLevel;

    // repaint the dome gradient in place
    const fresh = skyTextureFor(preset);
    const ctx = this._skyCanvas.getContext('2d');
    ctx.clearRect(0, 0, this._skyCanvas.width, this._skyCanvas.height);
    ctx.drawImage(fresh, 0, 0);
    this._skyTex.needsUpdate = true;

    this.scene.fog.color.setHex(preset.fog.color);
    this.scene.fog.near = preset.fog.near;
    this.scene.fog.far = preset.fog.far * this.q.fogScale;
    this.scene.background.setHex(preset.fog.color);

    this.hemi.color.setHex(preset.hemi.sky);
    this.hemi.groundColor.setHex(preset.hemi.ground);
    this.hemi.intensity = preset.hemi.intensity;

    this.sun.color.setHex(preset.key.color);
    this.sun.intensity = preset.key.intensity;
    this.sun.position.set(...preset.key.pos);

    this.fill.color.setHex(preset.fill.color);
    this.fill.intensity = preset.fill.intensity;
    this.fill.position.set(...preset.fill.pos);

    if (renderer) renderer.toneMappingExposure = preset.exposure;

    this.stars.material.opacity = preset.stars;
    this.stars.visible = preset.stars > 0.01;
    this.moon.material.opacity = preset.moon;
    this.moon.visible = preset.moon > 0.01;

    const sd = preset.sunDisc;
    this.sunDisc.material.opacity = sd.opacity;
    this.sunDisc.material.color.setHex(sd.color);
    this.sunDisc.position.set(...sd.pos);
    this.sunDisc.scale.set(sd.scale, sd.scale, 1);
    this.sunDisc.visible = sd.opacity > 0.01;

    this._applyGround(theme);
    applyGlow(this._glows, this.nightLevel);
    applyGlow(this._cityGlows, this.nightLevel);
  }

  _applyGround(theme = {}) {
    const base = theme.ground !== undefined ? theme.ground : 0x12162c;
    this.groundMat.color.setHex(base);
    const mix = this.time?.groundMix;
    if (mix) this.groundMat.color.lerp(new THREE.Color(mix.color), mix.t);
  }

  // (Re)build scenery around `track`. All placement is derived from the track geometry.
  buildCity(track, theme = {}) {
    if (this.cityGroup) {
      this.scene.remove(this.cityGroup);
      this.cityGroup.traverse((o) => { if (o.geometry && o.geometry !== BOX) o.geometry.dispose(); });
    }
    this._spinners = [];
    this._cityGlows = [];
    const group = new THREE.Group();
    const accent = theme.accent ?? 0x22e3ff;
    if (theme.ground !== undefined) this.groundMat.color.setHex(theme.ground);

    this.track = track;
    this.clearance = track.width / 2 + 10; // nothing solid closer than this to the road

    this._trees(group, track, theme);
    this._billboards(group, track, accent);
    this._towers(group, track, theme);
    this._infield(group, track, theme, accent);
    this._skyline(group, track);

    this.cityGroup = group;
    this.scene.add(group);
  }

  // Trees hugging the outside of the circuit — offset along the centerline normal, so
  // they follow every curve instead of cutting across it.
  _trees(group, track, theme) {
    const n = track.waypoints.length;
    const slots = [];
    for (let i = 0; i < n; i += this.q.treeStep) {
      if (Math.random() < 0.45) continue;
      const off = track.width / 2 + 6 + Math.random() * 16;
      const e = track.edgePoint(i, off);
      slots.push(e);
    }
    if (!slots.length) return;

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1.9, 6);
    const leafGeo = new THREE.IcosahedronGeometry(1.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: theme.palms ? 0x2f9e62 : 0x2f7d46, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, slots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, slots.length);
    trunks.castShadow = true; leaves.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < slots.length; i++) {
      const e = slots[i];
      const k = 0.85 + Math.random() * 0.95;
      q.setFromAxisAngle(up, Math.random() * Math.PI);
      sc.set(k, k, k);
      pos.set(e.x, 0.95 * k, e.z); m.compose(pos, q, sc); trunks.setMatrixAt(i, m);
      pos.set(e.x, 3.1 * k, e.z); m.compose(pos, q, sc); leaves.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true; leaves.instanceMatrix.needsUpdate = true;
    group.add(trunks); group.add(leaves);
  }

  _billboards(group, track, accent) {
    const accentHex = '#' + accent.toString(16).padStart(6, '0');
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2e, roughness: 0.7 });
    const n = track.waypoints.length, count = 6;
    for (let b = 0; b < count; b++) {
      const i = Math.floor((b / count) * n) + 7;
      const idx = i % n;
      const e = track.edgePoint(idx, track.width / 2 + 15);
      const road = track.waypoints[idx];
      const face = Math.atan2(road.x - e.x, road.z - e.z); // look back at the road
      const g = new THREE.Group(); g.position.set(e.x, 0, e.z); g.rotation.y = face;
      for (const px of [-5, 5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 11, 6), postMat);
        post.position.set(px, 5.5, 0); g.add(post);
      }
      const tex = billboardTexture(BILLBOARD_WORDS[b % BILLBOARD_WORDS.length], accentHex);
      const panelMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.0 });
      registerGlow(this._cityGlows, panelMat, { floor: 0.22 });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(13, 6.5, 0.4), panelMat);
      panel.position.set(0, 12, 0); g.add(panel);
      group.add(g);
    }
  }

  // Lit towers set well back from the outside of the circuit.
  _towers(group, track, theme) {
    const n = track.waypoints.length;
    const step = theme.infield === 'industrial' ? Math.max(3, this.q.towerStep - 2) : this.q.towerStep;
    for (let i = 0; i < n; i += step) {
      const off = track.width / 2 + 34 + Math.random() * 70;
      const e = track.edgePoint(i, off);
      if (track.distanceTo(e.x, e.z) < this.clearance + 14) continue;
      const w = 12 + Math.random() * 13, d = 12 + Math.random() * 13, h = 20 + Math.random() * 62;
      const m = new THREE.Mesh(BOX, WINDOW_MATS[(Math.random() * WINDOW_MATS.length) | 0]);
      m.scale.set(w, h, d); m.position.set(e.x, h / 2, e.z);
      m.castShadow = true; m.receiveShadow = true; group.add(m);
      if (Math.random() < 0.6) {
        const neon = new THREE.Mesh(BOX, NEON_MATS[(Math.random() * NEON_MATS.length) | 0]);
        neon.scale.set(w * 0.7, 0.8, 1.4); neon.position.set(e.x, h + 0.7, e.z); group.add(neon);
      }
    }
  }

  // Infield: a tinted patch plus a landmark pylon with a slowly rotating searchlight.
  // Candidate positions are rejected unless they clear the road by `clearance`.
  _infield(group, track, theme, accent) {
    const kind = theme.infield ?? 'plaza';
    const ex = track.extent.x, ez = track.extent.z;

    // the pylon sits at the centroid, which is always deep inside the loop
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 3, 8), new THREE.MeshStandardMaterial({ color: 0x20283c, metalness: 0.4, roughness: 0.6 }));
    base.position.y = 1.5; base.castShadow = true; group.add(base);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 28, 8), new THREE.MeshStandardMaterial({ color: 0x161b2b }));
    mast.position.y = 16; group.add(mast);
    const accentMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.6 });
    registerGlow(this._cityGlows, accentMat, { floor: 0.12 });
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4 - i * 0.3, 0.18, 8, 24), accentMat);
      ring.position.y = 8 + i * 5.5; ring.rotation.x = Math.PI / 2; group.add(ring);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), accentMat);
    beacon.position.y = 31; group.add(beacon);

    const spin = new THREE.Group(); spin.position.y = 30;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 36, 16, 1, true),
      registerGlow(this._cityGlows, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    beam.position.set(17, -7, 0); beam.rotation.z = Math.PI / 2 + 0.5; spin.add(beam);
    group.add(spin);
    this._spinners.push({ obj: spin, speed: 0.5 });

    // scatter infield dressing, rejecting anything near the road
    const tryPlace = (make, attempts) => {
      for (let k = 0; k < attempts; k++) {
        const x = (Math.random() - 0.5) * 2 * ex * 0.8;
        const z = (Math.random() - 0.5) * 2 * ez * 0.8;
        if (track.distanceTo(x, z) < this.clearance + 8) continue;
        if (Math.hypot(x, z) < 12) continue; // keep the pylon's footprint clear
        make(x, z);
      }
    };

    if (kind === 'water') {
      const waterMat = new THREE.MeshStandardMaterial({ color: 0x0b3b4a, roughness: 0.22, metalness: 0.55 });
      tryPlace((x, z) => {
        const r = 22 + Math.random() * 30;
        const pond = new THREE.Mesh(new THREE.CircleGeometry(r, 24), waterMat);
        pond.rotation.x = -Math.PI / 2; pond.position.set(x, 0.03, z); group.add(pond);
      }, 7);
    }
    if (theme.palms) {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4326, roughness: 1 });
      const frondMat = new THREE.MeshStandardMaterial({ color: 0x2f9e62, roughness: 1, side: THREE.DoubleSide });
      tryPlace((x, z) => {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 7, 6), trunkMat);
        trunk.position.set(x, 3.5, z); trunk.rotation.z = (Math.random() - 0.5) * 0.3; trunk.castShadow = true; group.add(trunk);
        for (let i = 0; i < 6; i++) {
          const frond = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4.2, 4), frondMat);
          frond.position.set(x, 7, z);
          frond.rotation.z = (Math.PI / 2.6) * Math.cos((i / 6) * Math.PI * 2);
          frond.rotation.y = (i / 6) * Math.PI * 2;
          group.add(frond);
        }
      }, 14);
    }
    if (kind === 'industrial') {
      const crateMat = new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.9 });
      tryPlace((x, z) => {
        const sz = 2.5 + Math.random() * 3;
        const crate = new THREE.Mesh(BOX, crateMat); crate.scale.setScalar(sz);
        crate.position.set(x, sz / 2, z); crate.castShadow = true; group.add(crate);
      }, 22);
    }
    if (kind === 'towers' || kind === 'plaza') {
      const count = kind === 'towers' ? 14 : 7;
      tryPlace((x, z) => {
        const w = 11 + Math.random() * 11, d = 11 + Math.random() * 11;
        const h = (kind === 'towers' ? 30 : 16) + Math.random() * 45;
        const m = new THREE.Mesh(BOX, WINDOW_MATS[(Math.random() * WINDOW_MATS.length) | 0]);
        m.scale.set(w, h, d); m.position.set(x, h / 2, z);
        m.castShadow = true; m.receiveShadow = true; group.add(m);
        if (Math.random() < 0.5) {
          const neon = new THREE.Mesh(BOX, NEON_MATS[(Math.random() * NEON_MATS.length) | 0]);
          neon.scale.set(w * 0.7, 0.8, 1.4); neon.position.set(x, h + 0.7, z); group.add(neon);
        }
      }, count);
    }
  }

  _skyline(group, track) {
    const ex = track.extent.x, ez = track.extent.z;
    for (let i = 0; i < this.q.skyline; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rx = ex + 330 + Math.random() * 560, rz = ez + 330 + Math.random() * 560;
      const w = 16 + Math.random() * 28, h = 40 + Math.random() * 160;
      const m = new THREE.Mesh(BOX, SKYLINE_MAT);
      m.scale.set(w, h, 16 + Math.random() * 28);
      m.position.set(Math.cos(ang) * rx, h / 2, Math.sin(ang) * rz); group.add(m);
      if (Math.random() < 0.25) {
        const dot = new THREE.Mesh(BOX, NEON_MATS[(Math.random() * NEON_MATS.length) | 0]);
        dot.scale.set(w * 0.5, 1.2, 1.2); dot.position.set(m.position.x, h + 1, m.position.z); group.add(dot);
      }
    }
  }

  update(dt) { for (const s of this._spinners) s.obj.rotation.y += s.speed * dt; }

  // Apply the parts of a quality preset that can change without rebuilding the scene.
  // Scenery density (trees/towers/skyline) is baked into buildCity, so the caller reloads
  // the map after this to pick those up.
  setQuality(qualityId) {
    this.q = qualityById(qualityId);
    this.sun.castShadow = this.q.shadows;
    if (this.sun.shadow.mapSize.x !== this.q.shadowMap) {
      // the existing shadow render target is the wrong size; drop it so three rebuilds it
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    }
    this.stars.geometry.setDrawRange(0, this.q.stars);
    if (this.time) this.scene.fog.far = this.time.fog.far * this.q.fogScale;
  }

  // Ground tint only — sky, fog and lighting all come from the time-of-day preset now.
  setGroundTheme(theme) { this._applyGround(theme); }
}
