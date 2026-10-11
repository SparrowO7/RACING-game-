// Menu / UI: the ESC pause menu (resume, restart, mode, laps, map, garage, info) and the
// finish panel. Everything is built from the same data the simulation uses — maps.js for
// circuits, cars.js for vehicles and customisation — so a menu entry can't exist for
// something the game doesn't actually have. Every button calls a real game method.

import { MAPS } from './maps.js';
import { CARS, PAINTS, GLOWS, WHEELS, carById, statBars } from './cars.js';
import { TIMES } from './timeofday.js';
import { QUALITY_LIST } from './quality.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class UI {
  constructor(game) {
    this.game = game;
    this.menu = document.getElementById('menu');
    this.finish = document.getElementById('finish');
    this.infoPanel = document.getElementById('info-panel');
    this._build();
    this._wire();
    this.refresh();
  }

  _build() {
    const mk = (parent, attr, value, label, extra = {}) => {
      const b = document.createElement('button');
      b.dataset[attr] = value;
      if (label !== null) b.textContent = label;
      Object.assign(b.style, extra);
      parent.appendChild(b);
      return b;
    };

    const maps = this.menu.querySelector('.maps');
    maps.innerHTML = '';
    MAPS.forEach((m, i) => mk(maps, 'map', String(i), m.name));

    const times = this.menu.querySelector('.times');
    times.innerHTML = '';
    // AUTO follows the device's light/dark theme; the named presets pin it.
    mk(times, 'time', 'auto', 'Auto');
    TIMES.forEach((t) => mk(times, 'time', t.id, t.name));

    const quality = this.menu.querySelector('.quality');
    quality.innerHTML = '';
    QUALITY_LIST.forEach((q) => mk(quality, 'quality', q.id, q.name));

    const cars = this.menu.querySelector('.cars');
    cars.innerHTML = '';
    CARS.forEach((c) => mk(cars, 'car', c.id, c.name));

    const paints = this.menu.querySelector('.paints');
    paints.innerHTML = '';
    PAINTS.forEach((p) => {
      const b = mk(paints, 'paint', p.id, null, { background: hex(p.hex) });
      b.title = p.name;
    });

    const glows = this.menu.querySelector('.glows');
    glows.innerHTML = '';
    GLOWS.forEach((g) => {
      const b = mk(glows, 'glow', g.id, null, g.id === 'none' ? {} : { background: hex(g.hex) });
      if (g.id === 'none') b.classList.add('swatch-off');
      b.title = g.name;
    });

    const wheels = this.menu.querySelector('.wheels');
    wheels.innerHTML = '';
    WHEELS.forEach((w) => mk(wheels, 'wheels', w.id, w.name));
  }

  _wire() {
    this.menu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const g = this.game;
      g.audio?.click();
      const d = b.dataset;

      if (d.act === 'resume') this.close();
      else if (d.act === 'restart') { g.restart(); this.close(); }
      else if (d.act === 'info') this.infoPanel.classList.toggle('hidden');
      else if (d.mode) g.setGameMode(d.mode);
      else if (d.laps) g.setLaps(+d.laps);
      else if (d.map !== undefined) g.loadMap(+d.map);
      else if (d.time) g.setTimeOfDay(d.time);
      else if (d.quality) g.setQuality(d.quality);
      else if (d.haptics) g.setHapticsEnabled(d.haptics === 'on');
      else if (d.car) g.setCar(1, d.car);
      else if (d.paint) g.setStyle(1, { paint: PAINTS.find((p) => p.id === d.paint).hex });
      else if (d.glow) {
        const entry = GLOWS.find((x) => x.id === d.glow);
        g.setStyle(1, { glow: entry.id === 'none' ? 0 : entry.hex });
      } else if (d.wheels) g.setStyle(1, { wheels: d.wheels });
    });

    this.finish.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.game.audio?.click();
      if (b.dataset.act === 'restart') { this.game.restart(); this.hideFinish(); }
      else if (b.dataset.act === 'menu') { this.hideFinish(); this.open(); }
    });
  }

  open() { this.menu.classList.remove('hidden'); this.game.paused = true; this.refresh(); }
  close() { this.menu.classList.add('hidden'); this.game.paused = false; }
  toggle() { this.menu.classList.contains('hidden') ? this.open() : this.close(); }

  showFinish(html) {
    this.finish.querySelector('.result').innerHTML = html;
    this.finish.classList.remove('hidden');
  }
  hideFinish() { this.finish.classList.add('hidden'); }

  // Mirror the live game state into the menu: active mode / laps / map / car / style,
  // plus the selected car's stat bars.
  refresh() {
    const g = this.game;
    const mark = (sel, test) => this.menu.querySelectorAll(sel).forEach((b) => b.classList.toggle('active', test(b)));

    mark('[data-mode]', (b) => b.dataset.mode === g.mode);
    mark('[data-map]', (b) => Number(b.dataset.map) === g.mapIndex);
    mark('[data-laps]', (b) => Number(b.dataset.laps) === g.totalLaps);
    // AUTO is active while the game is still following the system theme
    mark('[data-time]', (b) => (b.dataset.time === 'auto' ? g.timeAuto : !g.timeAuto && b.dataset.time === g.timeId));
    mark('[data-quality]', (b) => b.dataset.quality === g.qualityId);

    // Only offer the vibration toggle where the device can actually vibrate, rather than
    // showing a switch that silently does nothing.
    const hapticsRow = document.getElementById('haptics-row');
    if (hapticsRow) {
      hapticsRow.hidden = !g.hapticsAvailable;
      mark('[data-haptics]', (b) => (b.dataset.haptics === 'on') === !!g.hapticsOn);
    }
    mark('[data-car]', (b) => b.dataset.car === g.p1Car);
    mark('[data-wheels]', (b) => b.dataset.wheels === (g.p1Style.wheels || 'split5'));
    mark('[data-paint]', (b) => {
      const p = PAINTS.find((x) => x.id === b.dataset.paint);
      return p && p.hex === g.p1Style.paint;
    });
    mark('[data-glow]', (b) => {
      const x = GLOWS.find((y) => y.id === b.dataset.glow);
      if (!x) return false;
      return x.id === 'none' ? !g.p1Style.glow : x.hex === g.p1Style.glow;
    });

    const spec = carById(g.p1Car);
    const blurb = document.getElementById('car-blurb');
    if (blurb) blurb.textContent = `${spec.class} · ${spec.topSpeedKmh} km/h — ${spec.blurb}`;

    const stats = document.getElementById('car-stats');
    if (stats) {
      stats.innerHTML = '';
      for (const [name, value] of Object.entries(statBars(spec))) {
        const row = document.createElement('div');
        row.className = 'stat';
        const label = document.createElement('span');
        label.className = 'stat-name';
        label.textContent = name;
        const pips = document.createElement('div');
        pips.className = 'pips';
        for (let i = 1; i <= 10; i++) {
          const pip = document.createElement('i');
          pip.className = 'pip' + (i <= value ? ' on' : '');
          pips.appendChild(pip);
        }
        row.append(label, pips);
        stats.appendChild(row);
      }
    }
  }
}
