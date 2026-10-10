// Most-Wanted-style radar: a small 2D canvas in the corner showing the circuit with the
// player's car locked pointing up, so the map rotates around you rather than you around
// it. Draws the track as a thick stroked path (cached in track-space, re-stroked each
// frame under a rotate/translate transform), the start line, then blips for every car.
//
// Rendering is 2D canvas, not WebGL — cheap, and it keeps the radar crisp at any DPI.

const SIZE = 184;        // css px
const RANGE = 230;       // world units visible from the centre

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = SIZE * this._dpr;
    canvas.height = SIZE * this._dpr;
    canvas.style.width = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    this.track = null;
  }

  setTrack(track) {
    this.track = track;
    // Keep a local, MW-style view rather than fitting the whole lap, but widen it a
    // little on the bigger circuits so corners still arrive with enough warning.
    const ex = Math.max(track.extent?.x ?? RANGE, track.extent?.z ?? RANGE);
    this.range = Math.max(200, Math.min(400, ex * 0.95));
    this.scale = (SIZE / 2) / this.range;
  }

  // player: the human car (defines centre + rotation). cars: [{ car, color, isPlayer }]
  draw(player, cars, accent = '#22e3ff') {
    const ctx = this.ctx, t = this.track;
    if (!t || !player) return;
    const R = SIZE / 2;

    ctx.save();
    ctx.scale(this._dpr, this._dpr);
    ctx.clearRect(0, 0, SIZE, SIZE);

    // circular dark field
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 10, 22, 0.72)';
    ctx.fill();
    ctx.save();
    ctx.clip();

    // world -> radar: translate to player, rotate so the car's heading points up.
    // World z maps to canvas y (down), so a heading of 0 (+Z) would point DOWN; the extra
    // PI turns it up, and it keeps world-left on radar-left to match the 3D view.
    ctx.translate(R, R);
    ctx.rotate(player.heading + Math.PI);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-player.position.x, -player.position.z);

    // track ribbon
    const wp = t.waypoints;
    ctx.beginPath();
    ctx.moveTo(wp[0].x, wp[0].z);
    for (let i = 1; i < wp.length; i++) ctx.lineTo(wp[i].x, wp[i].z);
    ctx.closePath();
    ctx.lineWidth = t.width;
    ctx.strokeStyle = 'rgba(126, 146, 200, 0.42)';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineWidth = 2 / this.scale;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // start/finish marker
    const start = t.poseAt(0, 0);
    ctx.beginPath();
    ctx.arc(start.x, start.z, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // car blips (drawn in world space; the transform handles rotation)
    for (const c of cars) {
      if (c.isPlayer) continue;
      ctx.beginPath();
      ctx.arc(c.car.position.x, c.car.position.z, 9, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
    }
    ctx.restore(); // undo clip + world transform

    // player arrow, always centred and pointing up
    ctx.translate(R, R);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // bezel
    ctx.save();
    ctx.scale(this._dpr, this._dpr);
    ctx.beginPath();
    ctx.arc(R, R, R - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }
}
