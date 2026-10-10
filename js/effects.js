// Lightweight visual effects, all pooled/instanced for performance:
//  - Particles: billboard sprites reused from a pool (tyre smoke + collision sparks)
//  - SkidMarks: an InstancedMesh ring buffer of dark quads laid on the ground
// Nothing is created or destroyed per frame; a soft circle texture is generated once.

import * as THREE from 'three';

function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class Particles {
  constructor(scene, max = 90) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    const tex = smokeTexture();
    for (let i = 0; i < max; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.pool.push(s);
    }
  }

  emit(x, y, z, o = {}) {
    const s = this.pool.pop();
    if (!s) return;
    s.visible = true;
    s.position.set(x, y, z);
    s.material.color.setHex(o.color ?? 0xcccccc);
    s._base = o.opacity ?? 0.5;
    s.material.opacity = s._base;
    s._vx = o.vx ?? 0; s._vy = o.vy ?? 0.6; s._vz = o.vz ?? 0;
    s._life = o.life ?? 0.7; s._maxLife = s._life;
    s._scale = o.scale ?? 0.5; s._grow = o.grow ?? 2;
    s.scale.setScalar(s._scale);
    this.active.push(s);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s._life -= dt;
      if (s._life <= 0) {
        s.visible = false; s.material.opacity = 0;
        this.active.splice(i, 1); this.pool.push(s);
        continue;
      }
      const k = s._life / s._maxLife;
      s.material.opacity = s._base * k;
      s.position.x += s._vx * dt;
      s.position.y += s._vy * dt;
      s.position.z += s._vz * dt;
      s.scale.setScalar(s._scale + (1 - k) * s._grow);
    }
  }

  clear() {
    for (const s of this.active) { s.visible = false; s.material.opacity = 0; this.pool.push(s); }
    this.active.length = 0;
  }

  // Release every sprite and its material. Called when the quality preset resizes the
  // pool, so changing settings does not leak a full set of sprites each time.
  dispose() {
    for (const s of [...this.active, ...this.pool]) {
      this.scene.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.active.length = 0;
    this.pool.length = 0;
  }
}

export class SkidMarks {
  constructor(scene, max = 260) {
    this.max = max;
    this.idx = 0;
    const geo = new THREE.PlaneGeometry(0.34, 0.95);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0b0b0f, transparent: true, opacity: 0.5, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, hide);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this._up = new THREE.Vector3(0, 1, 0);
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  add(x, z, heading) {
    this._q.setFromAxisAngle(this._up, heading).multiply(this._flat);
    this._p.set(x, 0.04, z);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(this.idx, this._m);
    this.idx = (this.idx + 1) % this.max;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, hide);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.idx = 0;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
