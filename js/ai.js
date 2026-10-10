// Simple arcade AI driver — same control interface as HumanController, so physics.js
// treats it identically. It chases a target waypoint kept ~lookahead ahead, steers toward
// it (steer > 0 = left), eases off in corners, brakes if a corner is sharp while fast.
//
// GEAR HANDICAP: unlike a player, an AI only up-shifts after sitting at the gear's shift
// point for `shiftDelay` seconds. A large delay (Infinity) means it can never leave 1st
// gear and is stuck at the gear-1 speed cap — an easy car to beat. Down-shifts happen
// immediately when it drops out of the gear's band, so it never bogs down.

import { clamp } from './utils.js';

export class AIController {
  constructor(car, waypoints, opts = {}) {
    this.car = car;
    this.waypoints = waypoints;
    this.idx = opts.startIdx ?? 0;
    this.maxThrottle = opts.maxThrottle ?? 0.9;
    this.lookahead = opts.lookahead ?? 18;
    this.shiftDelay = opts.shiftDelay ?? 0.4; // seconds held at the shift point before up-shifting
    this._atThreshold = 0;
    this._throttle = 0; this._brake = 0; this._steer = 0;
  }

  update(dt) {
    const c = this.car, wp = this.waypoints, n = wp.length;

    let guard = 0;
    while (guard++ < n) {
      const t = wp[this.idx];
      const d = Math.hypot(t.x - c.position.x, t.z - c.position.z);
      if (d < this.lookahead) this.idx = (this.idx + 1) % n; else break;
    }

    const t = wp[this.idx];
    const desired = Math.atan2(t.x - c.position.x, t.z - c.position.z);
    let diff = desired - c.heading;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    this._steer = clamp(diff * 1.5, -1, 1);
    const sharp = Math.min(Math.abs(diff), 1);
    this._throttle = this.maxThrottle * (1 - sharp * 0.55);
    this._brake = (Math.abs(diff) > 1.0 && c.speed > 24) ? 0.5 : 0;

    this._gearLogic(dt);
  }

  _gearLogic(dt) {
    const c = this.car, gears = c.gears;
    // lazy down-shift keeps it out of a bogged high gear
    if (c.gear > 0 && c.speedKmh < gears[c.gear - 1].up * 0.6) {
      c.gear--; this._atThreshold = 0; return;
    }
    // up-shift only after lingering at the shift point for shiftDelay seconds
    if (c.gear < gears.length - 1 && c.speedKmh >= gears[c.gear].up) {
      this._atThreshold += dt;
      if (this._atThreshold >= this.shiftDelay) { c.gear++; this._atThreshold = 0; }
    } else {
      this._atThreshold = 0;
    }
  }

  get throttle() { return this._throttle; }
  get brake() { return this._brake; }
  get steer() { return this._steer; }
  get handbrake() { return false; }
  get nos() { return false; }
  get slowmo() { return false; }
  get resetPressed() { return false; }
}
