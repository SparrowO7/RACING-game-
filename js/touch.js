// Touch controls for phones and tablets.
//
// Exposes exactly the same interface as HumanController — throttle / brake / steer /
// handbrake / nos / slowmo plus the edge-triggered shift and reset flags — so physics.js
// and game.js never learn that a touch device is driving.
//
// Layout, for a phone held in landscape:
//   bottom-left   round steering wheel (drag, or tilt when gyro mode is on)
//   bottom-right  ACCEL, with BRAKE beside it
//   top-right     NITRO, where a thumb can reach it without leaving the wheel
//   top-right     small TILT and AUTO/MAN toggles, plus RESET
//
// Tilt mode reads deviceorientation. Which axis means "steer" depends on how the device
// is rotated, so the live screen orientation angle picks the axis and the neutral point is
// calibrated the moment the player enables it — nobody holds a phone perfectly flat.

import { haptic } from './haptics.js';

const STEER_TRAVEL = 64;    // px of drag for full lock
const TILT_RANGE = 26;      // degrees of tilt for full lock
const TILT_DEADZONE = 1.5;  // degrees ignored around the calibrated centre
const TILT_TIMEOUT = 1400;  // ms to wait for a first sensor reading before giving up

// Lateral ("lean") tilt in SCREEN space, from the device-frame angles.
//
// beta is rotation about the device's X axis and gamma about its Y axis, both fixed to the
// hardware — so which one means "lean left/right" depends on how the screen is rotated
// relative to the device. Rotating the (gamma, beta) pair by the screen orientation angle
// handles every case with one expression instead of a branch per orientation, which is
// where sign mistakes hide. At angle 0 this is just gamma, as it should be in portrait.
export function lateralTilt(beta, gamma, angle) {
  if (beta === null || beta === undefined || gamma === null || gamma === undefined) return null;
  const rad = (angle * Math.PI) / 180;
  return gamma * Math.cos(rad) - beta * Math.sin(rad);
}

// The screen's rotation, preferring the modern API and falling back to the deprecated one.
export function screenAngle() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') return window.orientation;
  return 0;
}

// Why tilt steering cannot run here, or null if it can. Device-motion sensors are gated
// behind a secure context in Chrome, so a LAN address like http://192.168.x.x silently
// delivers no events at all — the most likely reason tilt "does nothing" in testing.
export function tiltBlockedReason() {
  if (typeof window === 'undefined') return 'no window';
  if (!window.DeviceOrientationEvent) return 'sensor not supported';
  if (!window.isSecureContext) return 'needs HTTPS';
  return null;
}

export class TouchControls {
  constructor(opts = {}) {
    this.autoShift = opts.autoShift !== false;
    this.tiltEnabled = false;

    this._steer = 0;
    this._dragSteer = 0;
    this._tiltSteer = 0;
    this._throttle = 0;
    this._brake = 0;
    this._handbrake = false;
    this._nos = false;
    this._resetEdge = false;
    this._shiftUpEdge = false;
    this._shiftDownEdge = false;

    this._steerPointer = null;
    this._steerOrigin = 0;
    this._buttons = new Map();
    this._tiltZero = null;
    this._tiltInvert = false;
    this._tiltSeen = false;
    this._tiltTimer = null;

    this._root = this._build();
    document.body.appendChild(this._root);
    this._bind();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'touch-ui';
    root.innerHTML = `
      <div class="t-wheel" data-role="steer">
        <div class="t-wheel-dial">
          <div class="t-wheel-rim"></div>
          <div class="t-wheel-spoke"></div>
          <div class="t-wheel-hub"></div>
        </div>
      </div>

      <button class="t-nitro" data-btn="nos"><span>NITRO</span></button>

      <div class="t-toggles">
        <button class="t-mini t-tilt" data-btn="tilt">TILT</button>
        <button class="t-mini t-invert" data-btn="tiltInvert" hidden>⇄ FLIP</button>
        <button class="t-mini t-gear" data-btn="gearToggle">AUTO</button>
        <button class="t-mini" data-btn="reset">RESET</button>
        <button class="t-mini t-shift-up" data-btn="shiftUp" hidden>GEAR ▲</button>
        <button class="t-mini t-shift-down" data-btn="shiftDown" hidden>GEAR ▼</button>
      </div>

      <div class="t-pedals">
        <button class="t-btn t-brake" data-btn="brake">BRAKE</button>
        <button class="t-btn t-accel" data-btn="throttle">ACCEL</button>
      </div>`;

    this._dial = root.querySelector('.t-wheel-dial');
    this._wheel = root.querySelector('.t-wheel');
    this._gearBtn = root.querySelector('.t-gear');
    this._tiltBtn = root.querySelector('.t-tilt');
    this._invertBtn = root.querySelector('.t-invert');
    this._shiftUpBtn = root.querySelector('.t-shift-up');
    this._shiftDownBtn = root.querySelector('.t-shift-down');
    return root;
  }

  _setSteer(value) {
    this._steer = Math.max(-1, Math.min(1, value));
    // the dial turns the way the wheel would: steer is +1 for left, so negate for CSS
    this._dial.style.transform = `rotate(${-this._steer * 115}deg)`;
  }

  _bind() {
    // --- drag steering on the wheel ---
    const onDown = (e) => {
      if (this.tiltEnabled || this._steerPointer !== null) return;
      this._steerPointer = e.pointerId;
      this._steerOrigin = e.clientX;
      this._wheel.setPointerCapture(e.pointerId);
      this._wheel.classList.add('active');
      e.preventDefault();
    };
    const onMove = (e) => {
      if (e.pointerId !== this._steerPointer) return;
      const t = Math.max(-1, Math.min(1, (e.clientX - this._steerOrigin) / STEER_TRAVEL));
      this._dragSteer = -t;             // screen-right turns right; physics takes left as +1
      this._setSteer(this._dragSteer);
      e.preventDefault();
    };
    const onUp = (e) => {
      if (e.pointerId !== this._steerPointer) return;
      this._steerPointer = null;
      this._dragSteer = 0;
      this._setSteer(0);
      this._wheel.classList.remove('active');
    };

    this._wheel.addEventListener('pointerdown', onDown);
    this._wheel.addEventListener('pointermove', onMove);
    this._wheel.addEventListener('pointerup', onUp);
    this._wheel.addEventListener('pointercancel', onUp);
    this._wheelHandlers = { onDown, onMove, onUp };

    // --- buttons ---
    // Pointer capture keeps a button held even when the thumb slides off it, which on a
    // phone happens constantly; losing throttle mid-corner because of that is miserable.
    this._btnHandlers = [];
    for (const btn of this._root.querySelectorAll('[data-btn]')) {
      const kind = btn.dataset.btn;
      const down = (e) => {
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('held');
        this._buttons.set(e.pointerId, btn);
        this._press(kind, true);
        e.preventDefault();
      };
      const up = (e) => {
        if (!this._buttons.has(e.pointerId)) return;
        this._buttons.delete(e.pointerId);
        btn.classList.remove('held');
        this._press(kind, false);
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
      this._btnHandlers.push({ btn, down, up });
    }

    this._onTilt = (e) => this._handleTilt(e);
  }

  _press(kind, isDown) {
    if (isDown && kind !== 'tilt') haptic('tap');
    switch (kind) {
      case 'throttle': this._throttle = isDown ? 1 : 0; break;
      case 'brake': this._brake = isDown ? 1 : 0; break;
      case 'nos': this._nos = isDown; if (isDown) haptic('nos'); break;
      case 'reset': if (isDown) this._resetEdge = true; break;
      case 'shiftUp': if (isDown) this._shiftUpEdge = true; break;
      case 'shiftDown': if (isDown) this._shiftDownEdge = true; break;
      case 'gearToggle': if (isDown) this.setAutoShift(!this.autoShift); break;
      case 'tilt': if (isDown) this.toggleTilt(); break;
      case 'tiltInvert':
        if (isDown) {
          this._tiltInvert = !this._tiltInvert;
          this._invertBtn.classList.toggle('on', this._tiltInvert);
          this._tiltZero = null;            // recalibrate so the flip feels immediate
        }
        break;
    }
  }

  // --- gyro steering ---
  async toggleTilt() {
    if (this.tiltEnabled) { this.setTilt(false); return; }

    // Refuse up front for reasons we can know without waiting, and say which one.
    const blocked = tiltBlockedReason();
    if (blocked) { this._tiltUnavailable(blocked); return; }

    // iOS 13+ gates motion data behind a permission prompt that must be triggered by a
    // user gesture — which this button press is.
    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if (await DOE.requestPermission() !== 'granted') {
          this._tiltUnavailable('permission denied');
          return;
        }
      } catch {
        this._tiltUnavailable('permission failed');
        return;
      }
    }
    this.setTilt(true);
  }

  setTilt(on) {
    this.tiltEnabled = on;
    this._tiltBtn.classList.toggle('on', on);
    this._tiltBtn.textContent = on ? 'TILT ON' : 'TILT';
    this._wheel.classList.toggle('tilt-mode', on);
    this._tiltZero = null;             // recalibrate on the next reading
    this._invertBtn.hidden = !on;
    clearTimeout(this._tiltTimer);

    if (on) {
      this._tiltSeen = false;
      window.addEventListener('deviceorientation', this._onTilt);
      haptic('shift');
      // Some devices register the listener happily and then never fire. Rather than
      // leaving the player tilting a phone that does nothing, give up and say so.
      this._tiltTimer = setTimeout(() => {
        if (!this._tiltSeen) {
          this.setTilt(false);
          this._tiltUnavailable('no sensor data');
        }
      }, TILT_TIMEOUT);
    } else {
      window.removeEventListener('deviceorientation', this._onTilt);
      this._tiltSteer = 0;
      this._setSteer(this._dragSteer);
    }
  }

  // Tell the player why, on the button itself — "needs HTTPS" in particular is something
  // they can act on (open the deployed site instead of the LAN address).
  _tiltUnavailable(reason) {
    this._tiltBtn.textContent = reason === 'needs HTTPS' ? 'TILT: HTTPS' : 'NO TILT';
    this._tiltBtn.classList.add('unavailable');
    this._tiltBtn.classList.remove('on');
    this._tiltBtn.title = `Tilt steering unavailable: ${reason}`;
    this._invertBtn.hidden = true;
    // not disabled: the player may fix the cause (grant permission, reload over HTTPS)
  }

  _handleTilt(e) {
    const raw = lateralTilt(e.beta, e.gamma, screenAngle());
    if (raw === null) return;

    if (!this._tiltSeen) {
      this._tiltSeen = true;
      clearTimeout(this._tiltTimer);
      this._tiltBtn.classList.remove('unavailable');
    }

    if (this._tiltZero === null) this._tiltZero = raw;   // however they were holding it
    let delta = raw - this._tiltZero;
    if (Math.abs(delta) < TILT_DEADZONE) delta = 0;
    else delta -= Math.sign(delta) * TILT_DEADZONE;

    const t = Math.max(-1, Math.min(1, delta / TILT_RANGE));
    this._tiltSteer = (this._tiltInvert ? t : -t);
    this._setSteer(this._tiltSteer);
  }

  setAutoShift(on) {
    this.autoShift = on;
    this._gearBtn.textContent = on ? 'AUTO' : 'MAN';
    this._gearBtn.classList.toggle('manual', !on);
    this._shiftUpBtn.hidden = on;
    this._shiftDownBtn.hidden = on;
  }

  setVisible(on) { this._root.style.display = on ? '' : 'none'; }

  // --- controller interface (identical to HumanController) ---
  get throttle() { return this._throttle; }
  get brake() { return this._brake; }
  get steer() { return this._steer; }
  get handbrake() { return this._handbrake; }
  get nos() { return this._nos; }
  get slowmo() { return false; }

  // Edge flags are consumed on read, the same way Input.justPressed clears each frame.
  get resetPressed() { const v = this._resetEdge; this._resetEdge = false; return v; }
  get shiftUpPressed() { const v = this._shiftUpEdge; this._shiftUpEdge = false; return v; }
  get shiftDownPressed() { const v = this._shiftDownEdge; this._shiftDownEdge = false; return v; }

  dispose() {
    const h = this._wheelHandlers;
    this._wheel.removeEventListener('pointerdown', h.onDown);
    this._wheel.removeEventListener('pointermove', h.onMove);
    this._wheel.removeEventListener('pointerup', h.onUp);
    this._wheel.removeEventListener('pointercancel', h.onUp);
    for (const { btn, down, up } of this._btnHandlers) {
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
    }
    window.removeEventListener('deviceorientation', this._onTilt);
    clearTimeout(this._tiltTimer);
    this._root.remove();
  }
}

// Coarse pointer + no hover is the reliable signal for a touch device; a narrow window on
// a desktop is not one, and a large tablet is.
export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}
