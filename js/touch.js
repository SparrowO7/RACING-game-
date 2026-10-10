// Touch controls for phones and tablets.
//
// Exposes exactly the same interface as HumanController — throttle / brake / steer /
// handbrake / nos / slowmo plus the edge-triggered shift and reset flags — so physics.js
// and game.js never learn that a touch device is driving. Swapping controller is the only
// change needed to support a new input device.
//
// Layout follows what actually works on a phone held in landscape: a thumb-drag steering
// pad under the left thumb (absolute joysticks are fiddly while the car is moving), and
// the pedals under the right thumb. Gears default to automatic on touch, because a sixth
// on-screen button for shifting is one too many.

const STEER_TRAVEL = 70;   // px of drag for full lock

export class TouchControls {
  constructor(opts = {}) {
    this.autoShift = opts.autoShift !== false;

    this._steer = 0;
    this._throttle = 0;
    this._brake = 0;
    this._handbrake = false;
    this._nos = false;
    this._resetEdge = false;
    this._shiftUpEdge = false;
    this._shiftDownEdge = false;

    this._steerPointer = null;
    this._steerOrigin = 0;
    this._buttons = new Map();   // pointerId -> button element

    this._root = this._build();
    document.body.appendChild(this._root);
    this._bind();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'touch-ui';
    root.innerHTML = `
      <div class="t-steer" data-role="steer">
        <div class="t-steer-track"><div class="t-steer-knob"></div></div>
        <span class="t-steer-hint">STEER</span>
      </div>
      <div class="t-pedals">
        <button class="t-btn t-nos" data-btn="nos">NOS</button>
        <button class="t-btn t-drift" data-btn="handbrake">DRIFT</button>
        <button class="t-btn t-brake" data-btn="brake">BRAKE</button>
        <button class="t-btn t-gas" data-btn="throttle">GAS</button>
      </div>
      <div class="t-utility">
        <button class="t-mini" data-btn="reset">RESET</button>
        <button class="t-mini t-gear" data-btn="gearToggle">AUTO</button>
        <button class="t-mini t-shift-up" data-btn="shiftUp" hidden>▲</button>
        <button class="t-mini t-shift-down" data-btn="shiftDown" hidden>▼</button>
      </div>`;
    this._knob = root.querySelector('.t-steer-knob');
    this._gearBtn = root.querySelector('.t-gear');
    this._shiftUpBtn = root.querySelector('.t-shift-up');
    this._shiftDownBtn = root.querySelector('.t-shift-down');
    return root;
  }

  _bind() {
    const steerPad = this._root.querySelector('[data-role="steer"]');

    const onSteerDown = (e) => {
      if (this._steerPointer !== null) return;
      this._steerPointer = e.pointerId;
      this._steerOrigin = e.clientX;
      steerPad.setPointerCapture(e.pointerId);
      steerPad.classList.add('active');
      e.preventDefault();
    };
    const onSteerMove = (e) => {
      if (e.pointerId !== this._steerPointer) return;
      const dx = e.clientX - this._steerOrigin;
      const t = Math.max(-1, Math.min(1, dx / STEER_TRAVEL));
      // screen-right must turn right, and physics takes left as +1
      this._steer = -t;
      this._knob.style.transform = `translateX(${t * 38}px)`;
      e.preventDefault();
    };
    const onSteerUp = (e) => {
      if (e.pointerId !== this._steerPointer) return;
      this._steerPointer = null;
      this._steer = 0;
      this._knob.style.transform = 'translateX(0)';
      steerPad.classList.remove('active');
    };

    steerPad.addEventListener('pointerdown', onSteerDown);
    steerPad.addEventListener('pointermove', onSteerMove);
    steerPad.addEventListener('pointerup', onSteerUp);
    steerPad.addEventListener('pointercancel', onSteerUp);
    this._steerHandlers = { steerPad, onSteerDown, onSteerMove, onSteerUp };

    // Buttons use pointer capture so a thumb that slides off the button still counts as
    // held — on a phone that happens constantly and losing throttle mid-corner is awful.
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
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      this._btnHandlers.push({ btn, down, up });
    }
  }

  _press(kind, isDown) {
    switch (kind) {
      case 'throttle': this._throttle = isDown ? 1 : 0; break;
      case 'brake': this._brake = isDown ? 1 : 0; break;
      case 'handbrake': this._handbrake = isDown; break;
      case 'nos': this._nos = isDown; break;
      case 'reset': if (isDown) this._resetEdge = true; break;
      case 'shiftUp': if (isDown) this._shiftUpEdge = true; break;
      case 'shiftDown': if (isDown) this._shiftDownEdge = true; break;
      case 'gearToggle': if (isDown) this.setAutoShift(!this.autoShift); break;
    }
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
    const h = this._steerHandlers;
    h.steerPad.removeEventListener('pointerdown', h.onSteerDown);
    h.steerPad.removeEventListener('pointermove', h.onSteerMove);
    h.steerPad.removeEventListener('pointerup', h.onSteerUp);
    h.steerPad.removeEventListener('pointercancel', h.onSteerUp);
    for (const { btn, down, up } of this._btnHandlers) {
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
    }
    this._root.remove();
  }
}

// Coarse pointer + no hover is the reliable signal for a touch device; a narrow window on
// a desktop is not one, and a large tablet is.
export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}
