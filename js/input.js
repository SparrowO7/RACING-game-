// Input: raw keyboard state + edge detection, two control schemes (so two players share
// one keyboard), and a controller that exposes clean driving axes, gear-shift edges, and
// the Most-Wanted extras — nitrous (held) and speedbreaker (held, single-player only).
//
// STEERING SIGN: the chase camera looks toward +Z, so world +X is screen-LEFT; a left
// turn needs heading to INCREASE, i.e. steer > 0. So left keys = +1, right keys = -1.

const RELEVANT = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyE', 'KeyQ', 'KeyC', 'Space', 'ShiftLeft',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftRight', 'ControlRight', 'Period', 'Comma', 'Numpad0',
  'Digit1', 'Digit2', 'Escape',
]);

export const SCHEMES = {
  wasd: {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    handbrake: 'Space', reset: 'KeyR', shiftUp: 'KeyE', shiftDown: 'KeyQ',
    nos: 'ShiftLeft', slowmo: 'KeyC',
  },
  arrows: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    handbrake: 'ShiftRight', reset: 'ControlRight', shiftUp: 'Period', shiftDown: 'Comma',
    nos: 'Numpad0', slowmo: null,
  },
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this._queued = new Set();

    this._onDown = (e) => {
      if (RELEVANT.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this._queued.add(e.code);
      this.keys.add(e.code);
    };
    this._onUp = (e) => { this.keys.delete(e.code); };
    this._onBlur = () => { this.keys.clear(); };

    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
  }

  beginFrame() { this.pressed = this._queued; this._queued = new Set(); }
  down(code) { return !!code && this.keys.has(code); }
  justPressed(code) { return !!code && this.pressed.has(code); }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
  }
}

export class HumanController {
  constructor(input, scheme) { this.input = input; this.scheme = scheme; }

  get throttle() { return this.input.down(this.scheme.up) ? 1 : 0; }
  get brake() { return this.input.down(this.scheme.down) ? 1 : 0; }
  get steer() {
    let s = 0;
    if (this.input.down(this.scheme.left)) s += 1;   // left = +1
    if (this.input.down(this.scheme.right)) s -= 1;  // right = -1
    return s;
  }
  get handbrake() { return this.input.down(this.scheme.handbrake); }
  get nos() { return this.input.down(this.scheme.nos); }
  get slowmo() { return this.input.down(this.scheme.slowmo); }
  get resetPressed() { return this.input.justPressed(this.scheme.reset); }
  get shiftUpPressed() { return this.input.justPressed(this.scheme.shiftUp); }
  get shiftDownPressed() { return this.input.justPressed(this.scheme.shiftDown); }
}
