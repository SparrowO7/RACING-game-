// Third-person chase camera: smooth position + look-at follow with slight lag,
// speed-based FOV, and collision-shake support. Deliberately not rigidly parented
// to the car so it lags and leans a touch, which reads as "speed".

import * as THREE from 'three';
import { damp, clamp } from './utils.js';
import { CAR } from './physics.js';

export class ChaseCamera {
  constructor(aspect) {
    this.baseFov = 62;
    this.maxFov = 76;
    this.cam = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 3000);
    this._pos = new THREE.Vector3(0, 5, -12);
    this._look = new THREE.Vector3();
    this.shake = 0;
  }

  resize(aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); }

  // amount ~ 0..1 collision intensity
  addShake(amount) { this.shake = Math.min(this.shake + amount, 1.4); }

  update(car, dt, nos = false) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const sx = Math.cos(car.heading), sz = -Math.sin(car.heading);
    const back = 9.0, height = 4.2, ahead = 7;

    // desired position: behind + above the car, pushed slightly to the outside of a
    // slide so a drift reads from the camera as well as the car
    const slide = clamp((car.latSpeed || 0) / 12, -1, 1);
    const dx = car.position.x - fx * back - sx * slide * 2.2;
    const dz = car.position.z - fz * back - sz * slide * 2.2;
    const follow = 6; // responsiveness (lower = more lag)
    this._pos.x = damp(this._pos.x, dx, follow, dt);
    this._pos.y = damp(this._pos.y, height, follow, dt);
    this._pos.z = damp(this._pos.z, dz, follow, dt);
    if (this._pos.y < 1.3) this._pos.y = 1.3; // never clip through ground

    // collision shake
    let shx = 0, shy = 0;
    if (this.shake > 0.001) {
      shx = (Math.random() - 0.5) * this.shake;
      shy = (Math.random() - 0.5) * this.shake;
      this.shake = damp(this.shake, 0, 7, dt);
    }
    this.cam.position.set(this._pos.x + shx, this._pos.y + shy, this._pos.z);

    // look a little ahead of the car, biased into the direction it's actually travelling
    this._look.x = damp(this._look.x, car.position.x + fx * ahead + sx * slide * 3.2, follow, dt);
    this._look.y = damp(this._look.y, 1.3, follow, dt);
    this._look.z = damp(this._look.z, car.position.z + fz * ahead + sz * slide * 3.2, follow, dt);
    this.cam.lookAt(this._look);

    // speed-based FOV, with an extra punch on nitrous
    const speedNorm = clamp(car.speed / CAR.maxSpeed, 0, 1);
    let targetFov = this.baseFov + (this.maxFov - this.baseFov) * speedNorm;
    if (nos) targetFov += 7;
    this.cam.fov = damp(this.cam.fov, targetFov, nos ? 9 : 4, dt);
    this.cam.updateProjectionMatrix();
  }
}
