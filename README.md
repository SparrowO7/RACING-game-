# NEON STREET RUN

An original low-poly arcade street racer that runs in a browser and as a desktop app.
Plain HTML/CSS/JS with [Three.js](https://threejs.org) — no framework, no build step for
development, and no network access required at runtime.

All art is generated in code: the cars, circuits, city, sky and textures are procedural,
and every sound is synthesised with the Web Audio API. There are no third-party game
assets in this repository.

## Play

```bash
npm install
npm run serve        # http://localhost:8200
```

ES modules need to be served over HTTP — opening `index.html` from the filesystem will
not work. To play on a phone, open `http://<your-LAN-IP>:8200` from the same Wi-Fi.

Desktop app:

```bash
npm start            # Electron
npm run build        # packaged Windows installer in dist/
```

## Controls

| Action | Player 1 | Player 2 | Touch |
| --- | --- | --- | --- |
| Drive / steer | `W A S D` | Arrow keys | left thumb pad |
| Handbrake (drift) | `Space` | `Right-Shift` | DRIFT |
| Nitrous | `Left-Shift` | `Numpad 0` | NOS |
| Slow-mo | `C` | — | — |
| Gear up / down | `E` / `Q` | `.` / `,` | AUTO by default |
| Reset car | `R` | `Right-Ctrl` | RESET |
| Pause / menu | `Esc` | | tap menu |

Tap the handbrake to swing the tail out, then hold the slide with counter-steer and
throttle — grip returns as the slip angle comes down. Shift up to unlock more speed.

## What's in the menu

Mode (solo vs 3 AI, or two players split-screen), lap count, five circuits, time of day
(day / dusk / night), graphics quality, and a garage with five cars that genuinely differ
in top speed, acceleration, handling, grip, nitro and silhouette — plus paint, underglow
and wheel options that are purely cosmetic and never touch the physics.

## Layout

```
index.html style.css   the page
js/                    game modules (physics, cars, tracks, world, AI, UI, audio, …)
vendor/                Three.js, committed so the app runs offline
electron/              desktop wrapper
tools/                 dev server, validation suite, build scripts
```

`js/` has one responsibility per module. The handling model lives entirely in
`physics.js`; `cars.js` and `maps.js` are pure data, so adding a car or a circuit needs no
code changes.

## Validation

There is no browser in CI, so the parts that can be checked headlessly are:

```bash
npm run check
```

- **imports** — every named import resolves
- **cars** — gear tables are monotonic and reachable; the baseline car still gears exactly
  as it originally did
- **tracks** — no self-intersections, no sections crowding each other, drivable corner
  radii, uniform sampling, correct normal direction
- **time of day** — every field the renderer reads is present; the glow registry scales
  and respects its floors
- **input** — the touch controller's interface matches the keyboard controller's, edge
  flags self-clear, quality presets are ordered by cost
- **physics** — a headless driving simulation: nitrous, braking and reverse, drift and
  recovery, surface grip, frame-rate independence, NaN fuzzing, car-to-car collisions and
  tunnelling at top speed

This suite has caught several bugs that reading the code did not, including nitrous being
silently cancelled by the gear speed cap and cars passing through each other above
240 km/h.

## Deploy

```bash
npm run build:web    # assembles dist-web/ (~1.5 MB)
```

`netlify.toml` builds and publishes that directory. Any static host works — the output is
plain files with no server requirements.

## Licence

Project code: MIT. Three.js is bundled in `vendor/` under its own MIT licence
(`vendor/three.LICENSE`).
