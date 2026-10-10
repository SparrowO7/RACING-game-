// Game orchestrator: renderer, scene, world, track, cars, cameras, input, race, UI, audio,
// effects, radar, and the loop.
//
// Modes: single (you + 3 gear-handicapped AI) and coop (2 humans, split-screen).
// Wired here: the 4-speed gearbox, nitrous, a speedbreaker-style slow-mo, lap/checkpoint
// race with countdown, track-boundary enforcement, selectable maps and lap counts, the
// Most-Wanted radar, the ESC menu, procedural audio and the particle/skid effects.

import * as THREE from 'three';
import { World } from './world.js';
import { Track } from './track.js';
import { Car } from './car.js';
import { ChaseCamera } from './camera.js';
import { Input, HumanController, SCHEMES } from './input.js';
import { AIController } from './ai.js';
import { stepVehicle, resolveCarCollisions } from './physics.js';
import { CARS, carById } from './cars.js';
import { Race, formatTime } from './race.js';
import { MAPS } from './maps.js';
import { UI } from './ui.js';
import { TIMES, DEFAULT_TIME, timeById } from './timeofday.js';
import { qualityById, detectQuality, QUALITY_LIST } from './quality.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { GameAudio } from './audio.js';
import { Particles, SkidMarks } from './effects.js';
import { Minimap } from './minimap.js';
import { clamp, damp } from './utils.js';

const P1_COLOR = 0xff2d6b;
const P2_COLOR = 0x3fa9ff;
const AI_COLORS = [0x22e3ff, 0xffd23f, 0x8aff6b];
const SLOWMO_SCALE = 0.42;
const SB_DRAIN = 42;   // speedbreaker meter % per second
const SB_REFILL = 11;
const PHYSICS_STEP = 1 / 120;   // max integration step: keeps fast cars from tunnelling

export class Game {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.qualityId = detectQuality();
    const q = qualityById(this.qualityId);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene = new THREE.Scene();
    this.world = new World(this.scene, this.qualityId);
    this.input = new Input();
    this.race = new Race();

    this.audio = new GameAudio();
    const unlock = () => this.audio.init();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });

    this.particles = new Particles(this.scene, q.particles);
    this.skids = new SkidMarks(this.scene, q.skidMarks);
    this.minimap = new Minimap(document.getElementById('radar-canvas'));

    this.players = [];
    this.ais = [];
    this.mode = 'single';
    this.mapIndex = 0;
    this.lapsOverride = null;
    this.totalLaps = MAPS[0].laps;
    this.timeId = DEFAULT_TIME;

    // car selection + customisation (set from the garage screen)
    this.p1Car = CARS[0].id;
    this.p2Car = CARS[1].id;
    this.p1Style = { paint: P1_COLOR, accent: 0x22e3ff, wheels: 'split5', glow: 0x22e3ff };
    this.p2Style = { paint: P2_COLOR, accent: 0xffffff, wheels: 'mesh', glow: 0x3fa9ff };

    this.paused = false;
    this._finishShown = false;
    this._lastCount = 99;
    this._timeScale = 1;

    this.dom = {
      hud: document.getElementById('hud'),
      p1box: document.getElementById('p1-speed'),
      p1speed: document.querySelector('#p1-speed .val'),
      p1gear: document.getElementById('p1-gear'),
      p1shift: document.getElementById('p1-shift'),
      p1nos: document.getElementById('p1-nos'),
      p2box: document.getElementById('p2-speed'),
      p2speed: document.querySelector('#p2-speed .val'),
      p2gear: document.getElementById('p2-gear'),
      p2shift: document.getElementById('p2-shift'),
      p2nos: document.getElementById('p2-nos'),
      lap: document.getElementById('lap'),
      laps: document.getElementById('laps'),
      pos: document.getElementById('pos'),
      cars: document.getElementById('cars'),
      time: document.getElementById('time'),
      countdown: document.getElementById('countdown'),
      speedLines: document.getElementById('speed-lines'),
      drift: document.getElementById('drift-meter'),
      driftText: document.getElementById('drift-text'),
    };

    // On a touch device the on-screen controls become player 1's input. They implement
    // the same controller interface, so nothing downstream changes.
    this.touch = isTouchDevice() ? new TouchControls() : null;
    if (this.touch) {
      document.body.classList.add('touch-device');
      this._watchOrientation();
    }

    this.ui = new UI(this);

    window.addEventListener('resize', () => this._resize());
    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);

    this.loadMap(0);
  }

  // ---------- setup ----------
  // `specId` picks the vehicle from the catalogue; `style` is the player's customisation.
  _mk(specId, style, idxOffset, lateral, isPlayer) {
    const car = new Car({ spec: carById(specId), style });
    car.isPlayer = isPlayer;
    car._skidLast = null; car._smokeT = 0; car._wasBraking = false;
    car._hitCd = 0; car._prevStage = undefined; car._handbrake = false;
    car._wasNos = false; car.sb = 100; car.driftScore = 0;
    const pose = this.track.poseAt(idxOffset, lateral);
    car.setSpawn(pose.x, pose.z, pose.heading);
    this.scene.add(car.group);
    return car;
  }

  _removeCars() {
    for (const p of this.players) { this.scene.remove(p.car.group); p.car.dispose(); }
    for (const a of this.ais) { this.scene.remove(a.car.group); a.car.dispose(); }
    this.players = [];
    this.ais = [];
  }

  _spawnCars() {
    this._removeCars();
    const n = this.track.waypoints.length;

    const p1Control = this.touch || new HumanController(this.input, SCHEMES.wasd);

    if (this.mode === 'coop') {
      const c1 = this._mk(this.p1Car, this.p1Style, 0, -5, true);
      const c2 = this._mk(this.p2Car, this.p2Style, 0, 5, true);
      this.players.push({ car: c1, control: p1Control, camera: new ChaseCamera(1) });
      this.players.push({ car: c2, control: new HumanController(this.input, SCHEMES.arrows), camera: new ChaseCamera(1) });
      this.dom.hud.classList.add('coop');
    } else {
      const c1 = this._mk(this.p1Car, this.p1Style, 0, -5, true);
      this.players.push({ car: c1, control: p1Control, camera: new ChaseCamera(1) });
      // Grid alongside the player. Each AI carries a gear-shift handicap:
      // Infinity = never up-shifts (stuck in 1st), 5 s = very late, 2 s = moderate.
      const grid = [
        { idxOffset: 0, lateral: 5, shiftDelay: Infinity, car: 'kestrel' },
        { idxOffset: -3, lateral: -5, shiftDelay: 5, car: 'torrent' },
        { idxOffset: -3, lateral: 5, shiftDelay: 2, car: 'apex' },
      ];
      for (let i = 0; i < grid.length; i++) {
        const g = grid[i];
        const car = this._mk(g.car, { paint: AI_COLORS[i], glow: AI_COLORS[i] }, g.idxOffset, g.lateral, false);
        const startIdx = ((g.idxOffset % n) + n) % n;
        this.ais.push({ car, control: new AIController(car, this.track.waypoints, { startIdx, maxThrottle: 0.9, shiftDelay: g.shiftDelay }) });
      }
      this.dom.hud.classList.remove('coop');
    }
    const night = timeById(this.timeId).nightLevel;
    for (const p of this.players) { p.car.nightLevel = night; p.camera.update(p.car, 0.25); }
    for (const a of this.ais) a.car.nightLevel = night;
  }

  _allCars() {
    return [
      ...this.players.map((p) => ({ car: p.car, color: '#ffffff', isPlayer: true })),
      ...this.ais.map((a, i) => ({ car: a.car, color: '#' + AI_COLORS[i].toString(16).padStart(6, '0'), isPlayer: false })),
    ];
  }

  _setupRace() {
    const cars = [...this.players.map((p) => p.car), ...this.ais.map((a) => a.car)];
    this.race.setup(this.track, this.totalLaps, cars);
    this._finishShown = false;
    this._lastCount = 99;
    this.skids?.clear();
    this.particles?.clear();
  }

  // ---------- public actions (used by UI) ----------
  loadMap(i) {
    this.mapIndex = i;
    const m = MAPS[i];
    if (this.track) { this.scene.remove(this.track.group); this.track.dispose(); }
    this.track = new Track({
      rx: m.rx, rz: m.rz, width: m.width, shape: m.shape,
      lampStep: qualityById(this.qualityId).lampStep,
    });
    this.scene.add(this.track.group);
    this.world.buildCity(this.track, m);
    this._applyTime();
    this.totalLaps = this.lapsOverride ?? m.laps;
    this.minimap.setTrack(this.track);
    this._spawnCars();
    this._setupRace();
    this._resize();
    this.ui?.refresh();
  }

  // Push the current time-of-day preset into the world, the track's glowing props and
  // every car's lights, so one setting drives all of them.
  _applyTime() {
    const preset = timeById(this.timeId);
    this.world.applyTime(preset, MAPS[this.mapIndex], this.renderer);
    this.track?.setNightLevel(preset.nightLevel);
    for (const p of this.players) p.car.nightLevel = preset.nightLevel;
    for (const a of this.ais) a.car.nightLevel = preset.nightLevel;
    document.body.dataset.tod = preset.id;
  }

  // A racing HUD needs the width. In portrait the game keeps running but a prompt covers
  // it, so the player is never driving a layout that does not fit.
  _watchOrientation() {
    const check = () => {
      document.body.classList.toggle('portrait', window.innerHeight > window.innerWidth);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
  }

  // Change graphics quality. Resolution, shadows, star count and fog apply immediately;
  // scenery density and the effect pools are baked at build time, so those are rebuilt.
  setQuality(id) {
    if (!QUALITY_LIST.some((q) => q.id === id)) return;
    this.qualityId = id;
    const q = qualityById(id);

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.world.setQuality(id);

    this.particles.dispose();
    this.skids.dispose();
    this.particles = new Particles(this.scene, q.particles);
    this.skids = new SkidMarks(this.scene, q.skidMarks);

    this.loadMap(this.mapIndex);   // rebuilds scenery and the track's lamp density
  }

  setTimeOfDay(id) {
    if (!TIMES.some((t) => t.id === id)) return;
    this.timeId = id;
    this._applyTime();
    this.ui?.refresh();
  }

  setGameMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this._spawnCars();
    this._setupRace();
    this._resize();
    this.ui?.refresh();
  }

  setLaps(n) {
    this.lapsOverride = n;
    this.totalLaps = n;
    this.restart();
    this.ui?.refresh();
  }

  // Garage: pick a vehicle for a player slot. Respawns so the change is immediate.
  setCar(slot, specId) {
    if (slot === 2) this.p2Car = specId; else this.p1Car = specId;
    this._spawnCars();
    this._setupRace();
    this._resize();
    this.ui?.refresh();
  }

  // Garage: paint / accent / wheels / underglow. Visual only — never touches the spec,
  // so customising a car can't change how it drives.
  setStyle(slot, patch) {
    const target = slot === 2 ? 'p2Style' : 'p1Style';
    this[target] = { ...this[target], ...patch };
    this._spawnCars();
    this._setupRace();
    this._resize();
    this.ui?.refresh();
  }

  restart() {
    for (const p of this.players) p.car.reset();
    for (const a of this.ais) a.car.reset();
    this._setupRace();
    this.ui.hideFinish();
    this.paused = false;
  }

  // ---------- loop ----------
  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    const aspect = this.mode === 'coop' ? (w / 2) / h : w / h;
    for (const p of this.players) p.camera.resize(aspect);
  }

  start() { this.renderer.setAnimationLoop(this._loop); }
  stop() { this.renderer.setAnimationLoop(null); }

  _loop() {
    let raw = Math.min(this.clock.getDelta(), 1 / 30);
    this.input.beginFrame();

    if (this.input.justPressed('Escape')) this.ui.toggle();
    if (this.input.justPressed('Digit1')) this.setGameMode('single');
    if (this.input.justPressed('Digit2')) this.setGameMode('coop');

    if (!this.paused) this._update(raw);
    this._render();
  }

  _update(raw) {
    // --- speedbreaker: hold to slow the whole simulation, drains its own meter ---
    const p0 = this.players[0];
    let wantSlow = false;
    if (p0 && this.mode === 'single' && this.race.phase === 'racing') {
      wantSlow = p0.control.slowmo && p0.car.sb > 1;
    }
    if (p0) {
      if (wantSlow) p0.car.sb = Math.max(0, p0.car.sb - SB_DRAIN * raw);
      else p0.car.sb = Math.min(100, p0.car.sb + SB_REFILL * raw);
    }
    this._timeScale = damp(this._timeScale, wantSlow ? SLOWMO_SCALE : 1, 9, raw);
    const dt = raw * this._timeScale;

    this.race.update(dt);
    this._raceAudioCues();
    const racing = this.race.phase === 'racing';

    if (racing) {
      // Per-frame, once-only work: gear shifts and reset are edge-triggered, so running
      // them inside the substep loop below would fire a single key press several times.
      for (const p of this.players) {
        const c = p.control, car = p.car;
        // Touch defaults to an automatic box: a sixth on-screen button for shifting is
        // one too many on a phone, and the player can switch it to manual in the HUD.
        if (c.autoShift) {
          if (car.canShiftUp()) { car.shiftUp(); this.audio.shift(); }
          else if (car.canShiftDown()) { car.shiftDown(); this.audio.shift(); }
        }
        if (c.shiftUpPressed && car.shiftUp()) this.audio.shift();
        if (c.shiftDownPressed && car.shiftDown()) this.audio.shift();
        if (c.resetPressed) car.reset();
        car._handbrake = c.handbrake;
        car._braking = c.brake > 0;

        const brakingHard = c.brake > 0 && car.fwdSpeed > 14;
        if (brakingHard && !car._wasBraking) this.audio.brake();
        car._wasBraking = brakingHard;
      }

      // Physics runs on fixed substeps. At 245 km/h a car covers ~2.3 m in a 1/30 s
      // frame, which is the whole length of a car body — enough to skip clean past a
      // rival or a barrier between two tests. Capping each integration step keeps that
      // travel well below the contact size, so nothing tunnels at any frame rate.
      let remaining = dt;
      let guard = 0;
      while (remaining > 1e-5 && guard++ < 16) {
        const h = Math.min(PHYSICS_STEP, remaining);
        remaining -= h;
        this._physicsStep(h);
      }

      for (const p of this.players) {
        const car = p.car;
        if (car.nosActive && !car._wasNos) { this.audio.nos(); p.camera.addShake(0.18); }
        car._wasNos = car.nosActive;
        car._hitCd = Math.max(0, car._hitCd - dt);
      }

      // visuals and effects run once per frame on the full delta
      for (const a of this.ais) { a.car.syncVisuals(dt); this._carEffects(a.car, dt); }
      for (const p of this.players) { p.car.syncVisuals(dt); this._carEffects(p.car, dt); }
    }

    // engine tone from player 1
    if (racing && p0) {
      this.audio.engine(p0.car.speedKmh, p0.car.rev(), p0.control.throttle, p0.car.nosActive);
    } else {
      this.audio.engine(0, 0, 0, false);
    }

    for (const p of this.players) p.camera.update(p.car, dt, p.car.nosActive);
    this.world.update(dt);
    this.particles.update(dt);
    this._updateHud();

    if (this.race.phase === 'finished' && !this._finishShown) this._showFinish();
  }

  _raceAudioCues() {
    if (this.race.phase === 'countdown') {
      const num = Math.ceil(this.race.countdown);
      if (num !== this._lastCount) { this._lastCount = num; if (num >= 1 && num <= 3) this.audio.countdownBeep(); }
    } else if (this._lastCount !== 0) {
      this._lastCount = 0;
      if (this.race.phase === 'racing') this.audio.go();
    }
    for (const p of this.players) {
      const e = this.race.entryOf(p.car);
      if (!e) continue;
      if (p.car._prevStage === undefined) { p.car._prevStage = e.stage; continue; }
      if (e.stage !== p.car._prevStage) { p.car._prevStage = e.stage; this.audio.checkpoint(); }
    }
  }

  // tyre smoke + skid marks, driven by the slip angle from the tyre model
  _carEffects(car, dt) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
    const rearX = car.position.x - fx * 1.5, rearZ = car.position.z - fz * 1.5;
    const smoking = car.drifting || (car._handbrake && car.speed > 6) || (car._braking && car.speed > 18);

    // drift scoring: how long and how hard you hold the slide
    if (car.drifting) car.driftScore += car.slipAngle * car.speed * dt * 6;
    else car.driftScore = damp(car.driftScore, 0, 3, dt);

    if (car.drifting && car.speed > 6) {
      if (!car._skidLast || Math.hypot(car.position.x - car._skidLast.x, car.position.z - car._skidLast.z) > 0.55) {
        this.skids.add(rearX + rx * 1.02, rearZ + rz * 1.02, car.heading);
        this.skids.add(rearX - rx * 1.02, rearZ - rz * 1.02, car.heading);
        car._skidLast = { x: car.position.x, z: car.position.z };
      }
    }

    car._smokeT -= dt;
    if (smoking && car._smokeT <= 0) {
      car._smokeT = 0.03;
      const puff = car.driftHard ? 0.52 : 0.38;
      for (const side of [-1.02, 1.02]) {
        this.particles.emit(rearX + rx * side, 0.3, rearZ + rz * side, {
          color: 0xdcdce6, opacity: puff, life: 0.65, scale: 0.55, grow: 2.6,
          vx: (Math.random() - 0.5) * 1.4 - fx * 1.8, vy: 0.8 + Math.random() * 0.7, vz: (Math.random() - 0.5) * 1.4 - fz * 1.8,
        });
      }
    }

    // nitrous flame out of the exhausts
    if (car.nosActive) {
      for (const side of [-0.4, 0.4]) {
        this.particles.emit(car.position.x - fx * 2.4 + rx * side, 0.35, car.position.z - fz * 2.4 + rz * side, {
          color: 0x66ccff, opacity: 0.8, life: 0.2, scale: 0.3, grow: 0.7,
          vx: -fx * 7, vy: 0.5, vz: -fz * 7,
        });
      }
    }
  }

  _sparks(car) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    this._sparksAt(car.position.x + fx * 2.4, car.position.z + fz * 2.4, 1);
  }

  _sparksAt(x, z, strength = 1) {
    const count = Math.max(3, Math.round(8 * strength));
    const spread = 5 + 5 * strength;
    for (let i = 0; i < count; i++) {
      this.particles.emit(x, 0.6, z, {
        color: 0xff8a3d, opacity: 0.9, life: 0.4, scale: 0.22, grow: 0.5,
        vx: (Math.random() - 0.5) * spread, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * spread,
      });
    }
  }

  _shiftPrompt(el, car) {
    if (!el) return;
    const up = car.canShiftUp(), down = car.canShiftDown();
    el.classList.toggle('show', up || down);
    el.classList.toggle('down', down && !up);
    el.textContent = (down && !up) ? 'SHIFT ↓' : 'SHIFT ↑';
  }

  // One fixed physics substep: integrate every car, resolve car-to-car contacts against
  // that consistent snapshot, then clamp each car back inside the track. The order is
  // deliberate — resolving contacts per-car would let a rival push a car that had not
  // moved yet, and clamping before the contact pass would let a push shove a car through
  // the barrier.
  _physicsStep(h) {
    for (const a of this.ais) {
      a.control.update(h);
      stepVehicle(a.car, a.control, h);
    }
    for (const p of this.players) {
      stepVehicle(p.car, p.control, h);
    }

    this._resolveContacts();

    for (const a of this.ais) this.track.constrain(a.car);
    for (const p of this.players) {
      const car = p.car;
      const wallHit = this.track.constrain(car);
      if (wallHit > 7) {
        p.camera.addShake(Math.min(0.6, wallHit / 40));
        this._sparks(car);
        if (car._hitCd <= 0) { this.audio.collision(Math.min(wallHit / 30, 1)); car._hitCd = 0.3; }
      }
    }
  }

  // Car-to-car contacts, plus the feedback that sells them: sparks at the contact point,
  // a camera kick and a thud for whichever player was involved.
  _resolveContacts() {
    const all = [...this.players.map((p) => p.car), ...this.ais.map((a) => a.car)];
    const contacts = resolveCarCollisions(all);
    if (!contacts.length) return;

    for (const hit of contacts) {
      if (hit.impact < 2) continue;                 // ignore gentle rubbing
      this._sparksAt(hit.x, hit.z, Math.min(hit.impact / 14, 1));
      for (const p of this.players) {
        if (p.car !== hit.a && p.car !== hit.b) continue;
        p.camera.addShake(Math.min(0.5, hit.impact / 26));
        if (p.car._hitCd <= 0) {
          this.audio.collision(Math.min(hit.impact / 20, 1));
          p.car._hitCd = 0.25;
        }
      }
    }
  }

  _updateHud() {
    const p1 = this.players[0];
    if (p1) {
      this.dom.p1speed.textContent = Math.round(p1.car.speedKmh);
      this.dom.p1gear.textContent = 'G' + (p1.car.gear + 1);
      this._shiftPrompt(this.dom.p1shift, p1.car);
      this.dom.p1nos.style.width = p1.car.nos + '%';
      this.dom.p1box.classList.toggle('nos-active', p1.car.nosActive);
    }
    if (this.mode === 'coop' && this.players[1]) {
      const p2 = this.players[1];
      this.dom.p2speed.textContent = Math.round(p2.car.speedKmh);
      this.dom.p2gear.textContent = 'G' + (p2.car.gear + 1);
      this._shiftPrompt(this.dom.p2shift, p2.car);
      this.dom.p2nos.style.width = p2.car.nos + '%';
      this.dom.p2box.classList.toggle('nos-active', p2.car.nosActive);
    }

    if (p1) {
      const e = this.race.entryOf(p1.car);
      if (e) {
        this.dom.lap.textContent = Math.min(e.lap + 1, this.totalLaps);
        this.dom.laps.textContent = this.totalLaps;
        this.dom.pos.textContent = this.race.positionOf(p1.car);
        this.dom.cars.textContent = this.race.entries.length;
      }
      // drift readout
      const show = p1.car.drifting && p1.car.driftScore > 40;
      this.dom.drift.classList.toggle('show', show);
      if (show) this.dom.driftText.textContent = 'DRIFT  ' + Math.round(p1.car.driftScore);
      // radar
      if (this.mode !== 'coop') {
        const accent = '#' + MAPS[this.mapIndex].accent.toString(16).padStart(6, '0');
        this.minimap.draw(p1.car, this._allCars(), accent);
      }
    }
    this.dom.time.textContent = formatTime(this.race.time);

    const cd = this.dom.countdown;
    if (this.race.phase === 'countdown') {
      cd.textContent = String(Math.max(1, Math.ceil(this.race.countdown)));
      cd.classList.add('show');
    } else if (this.race.phase === 'racing' && this.race.time < 0.8) {
      cd.textContent = 'GO!';
      cd.classList.add('show');
    } else {
      cd.classList.remove('show');
    }

    if (this.dom.speedLines) {
      const sp = p1 ? p1.car.speedKmh : 0;
      this.dom.speedLines.classList.toggle('show', sp > 170 || (p1 && p1.car.nosActive));
    }
  }

  _showFinish() {
    this._finishShown = true;
    const w = this.race.winner;
    let html;
    if (this.mode === 'coop') {
      const which = w.car === this.players[0].car ? 'PLAYER 1' : 'PLAYER 2';
      html = `<h2>${which} WINS</h2><p>${formatTime(w.time)}</p>`;
    } else {
      const pos = this.race.positionOf(this.players[0].car);
      const place = ['1st', '2nd', '3rd', '4th'][pos - 1] || pos + 'th';
      html = `<h2>FINISHED · ${place}</h2><p>Time ${formatTime(w.time)}</p>`;
    }
    this.ui.showFinish(html);
  }

  _render() {
    const w = innerWidth, h = innerHeight, r = this.renderer;
    if (this.mode === 'coop' && this.players.length === 2) {
      r.setScissorTest(true);
      r.setViewport(0, 0, w / 2, h); r.setScissor(0, 0, w / 2, h);
      r.render(this.scene, this.players[0].camera.cam);
      r.setViewport(w / 2, 0, w / 2, h); r.setScissor(w / 2, 0, w / 2, h);
      r.render(this.scene, this.players[1].camera.cam);
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
    } else if (this.players[0]) {
      r.render(this.scene, this.players[0].camera.cam);
    }
  }
}
