// Race state machine: 3-2-1 countdown, lap counting via ordered checkpoints (so you
// can't cheat the line), a shared timer, live positions, and a winner. Tracks every car
// (players + AI). The race ENDS when a human finishes all laps, but positions are ranked
// by FINISH ORDER — so an AI that crossed the line before you ranks ahead of you in the
// result instead of you always reading "1st".

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export class Race {
  constructor() {
    this.phase = 'countdown';
    this.countdown = 3.0;
    this.time = 0;
    this.totalLaps = 3;
    this.entries = [];
    this.winner = null;
    this.n = 1;
    this.finishedCount = 0;
  }

  setup(track, totalLaps, cars) {
    this.track = track;
    this.totalLaps = totalLaps;
    this.n = track.waypoints.length;
    const n = this.n;
    this.gates = [Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)];
    this.entries = cars.map((car) => ({ car, lap: 0, stage: 0, wpIndex: 0, finished: false, time: 0, finishOrder: 0 }));
    this.phase = 'countdown';
    this.countdown = 3.0;
    this.time = 0;
    this.winner = null;
    this.finishedCount = 0;
  }

  update(dt) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'racing';
      return;
    }
    if (this.phase === 'finished') return;

    this.time += dt;
    const wp = this.track.waypoints, n = this.n;

    for (const e of this.entries) {
      e.wpIndex = this._nearest(e.car, wp, n);
      if (e.finished) continue;

      const targetIdx = e.stage < this.gates.length ? this.gates[e.stage] : 0;
      const t = wp[targetIdx];
      const d = Math.hypot(t.x - e.car.position.x, t.z - e.car.position.z);
      if (d < 16) {
        if (e.stage < this.gates.length) {
          e.stage++;
        } else {
          e.stage = 0;
          e.lap++;
          if (e.lap >= this.totalLaps) {
            e.finished = true;
            e.time = this.time;
            e.finishOrder = ++this.finishedCount; // 1 = first to finish
            if (e.car.isPlayer && !this.winner) { this.winner = e; this.phase = 'finished'; }
          }
        }
      }
    }
  }

  _nearest(car, wp, n) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = wp[i].x - car.position.x, dz = wp[i].z - car.position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Ranking score. Any finished car scores far above every unfinished car, and among
  // finished cars an earlier finish (smaller finishOrder) scores higher.
  _progress(e) {
    if (e.finished) return 1e9 - e.finishOrder;
    return e.lap * this.n + e.wpIndex;
  }

  positionOf(car) {
    const sorted = [...this.entries].sort((x, y) => this._progress(y) - this._progress(x));
    return sorted.findIndex((e) => e.car === car) + 1;
  }

  entryOf(car) { return this.entries.find((e) => e.car === car); }
}
