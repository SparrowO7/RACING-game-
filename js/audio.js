// Procedural audio (Web Audio, no files). The engine is a small harmonic stack — a sub
// plus oscillators at the 1st/2nd/3rd engine orders — run through a soft-clip waveshaper
// for growl, a low-pass that opens with revs/throttle, and a touch of filtered noise for
// induction grit. Pitch tracks the per-gear rev, so it rises, drops on an up-shift, and
// rises again like a real straight-six. Short synthesized blips cover the one-shot SFX.
// Everything no-ops until init() runs on the first user gesture (browser autoplay rule).

function softClip(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * k); }
  return curve;
}

export class GameAudio {
  constructor() { this.ctx = null; this.ready = false; this.enabled = true; }

  init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.45 : 0;
    this.master.connect(ctx.destination);

    // engine volume -> master
    this.engineOut = ctx.createGain();
    this.engineOut.gain.value = 0;
    this.engineOut.connect(this.master);

    // osc bus -> soft-clip -> low-pass -> engineOut
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass'; this.lp.frequency.value = 350;
    this.lp.connect(this.engineOut);
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = softClip(2.4);
    this.shaper.connect(this.lp);
    this.oscBus = ctx.createGain();
    this.oscBus.gain.value = 0.5;
    this.oscBus.connect(this.shaper);

    // harmonic stack (engine orders)
    const mk = (type, mul, gain) => {
      const o = ctx.createOscillator(); o.type = type;
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g); g.connect(this.oscBus); o.start();
      return { o, mul };
    };
    this.parts = [
      mk('sine', 0.5, 0.7),      // sub rumble
      mk('sawtooth', 1.0, 0.6),  // 1st order
      mk('sawtooth', 2.0, 0.4),  // 2nd order
      mk('square', 3.0, 0.28),   // 3rd order (straight-six character)
    ];

    // induction/exhaust noise -> bandpass -> noiseGain -> engineOut
    const nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const nsrc = ctx.createBufferSource(); nsrc.buffer = nbuf; nsrc.loop = true;
    this.noiseBP = ctx.createBiquadFilter(); this.noiseBP.type = 'bandpass'; this.noiseBP.frequency.value = 900; this.noiseBP.Q.value = 0.8;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    nsrc.connect(this.noiseBP); this.noiseBP.connect(this.noiseGain); this.noiseGain.connect(this.engineOut);
    nsrc.start();

    this.ready = true;
    this.resume();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setEnabled(v) { this.enabled = v; if (this.master) this.master.gain.value = v ? 0.45 : 0; }

  // rev: 0..1 within current gear; throttle: 0..1; nos: nitrous engaged
  engine(speedKmh, rev, throttle, nos = false) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const f = 34 + rev * 150 + Math.min(speedKmh, 260) * 0.05; // firing fundamental (Hz)
    for (const p of this.parts) p.o.frequency.setTargetAtTime(f * p.mul, t, 0.04);
    const load = 0.4 + throttle * 0.6;
    const boost = nos ? 1.3 : 1;
    this.engineOut.gain.setTargetAtTime((0.11 + Math.min(speedKmh / 260, 1) * 0.06) * load * boost, t, 0.08);
    this.lp.frequency.setTargetAtTime((340 + rev * 2600 + throttle * 1300) * boost, t, 0.08);
    this.noiseGain.gain.setTargetAtTime((0.02 + rev * 0.05) * load * (nos ? 2.2 : 1), t, 0.1);
    this.noiseBP.frequency.setTargetAtTime(500 + rev * 1600, t, 0.1);
  }

  _blip(freq, dur, type = 'square', vol = 0.3, slideTo = null) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, vol, cutoff) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }

  collision(intensity = 1) {
    this._noise(0.3, Math.min(0.5, 0.2 + intensity * 0.3), 430);
    this._blip(90, 0.18, 'sine', Math.min(0.4, 0.2 + intensity * 0.25), 40); // low thump
  }
  brake() { this._noise(0.32, 0.12, 2600); }
  nos() { this._noise(0.45, 0.2, 5200); this._blip(260, 0.35, 'sawtooth', 0.18, 1400); }
  countdownBeep() { this._blip(440, 0.14, 'square', 0.28); }
  go() { this._blip(880, 0.3, 'square', 0.34); }
  checkpoint() { this._blip(660, 0.07, 'sine', 0.24); this._blip(990, 0.1, 'sine', 0.2); }
  shift() { this._blip(300, 0.05, 'square', 0.2, 520); }
  click() { this._blip(520, 0.04, 'square', 0.16); }
}
