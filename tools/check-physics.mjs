// Headless physics tests. physics.js and cars.js have no DOM dependency, so the whole
// handling model can be driven from Node — which is the only way to verify things like
// "does nitrous actually do anything" and "is this frame-rate independent" without a GPU.
//
// Run: node tools/check-physics.mjs

import { stepVehicle, resolveCarCollisions, CAR } from '../js/physics.js';
import { CARS, carById, gearsFor } from '../js/cars.js';

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!pass) failures++;
};

// Minimal stand-in for Car: just the state physics.js reads and writes.
function makeCar(specId = 'vector') {
  const spec = carById(specId);
  return {
    spec,
    gears: gearsFor(spec.topSpeedKmh, spec.accelScale),
    position: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0, steer: 0, yawRate: 0,
    speed: 0, speedKmh: 0, fwdSpeed: 0, latSpeed: 0,
    slipAngle: 0, drifting: false, driftHard: false,
    gear: 0, nos: 100, nosActive: false, surfaceGrip: 1,
  };
}
const input = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nos: false, ...o });

// Run for `seconds` at a fixed step, auto-shifting like a competent driver would.
function run(car, inp, seconds, dt = 1 / 60, autoShift = true) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    if (autoShift && car.gear < car.gears.length - 1 && car.speedKmh >= car.gears[car.gear].up) car.gear++;
    stepVehicle(car, inp, dt);
    if (!Number.isFinite(car.speed) || !Number.isFinite(car.position.x)) return { nan: true, at: i * dt };
  }
  return { nan: false };
}

// --- 1. accelerates and respects the gear ceiling ---
{
  const car = makeCar();
  run(car, input({ throttle: 1 }), 12, 1 / 60, false); // locked in 1st
  const cap = car.gears[0].max;
  check('gear 1 accelerates to its cap', car.speedKmh > cap * 0.95 && car.speedKmh <= cap + 0.6,
    `${car.speedKmh.toFixed(1)} km/h, cap ${cap.toFixed(0)}`);
}

// --- 2. nitrous must push PAST the current gear's cap (the bug the user reported) ---
{
  const cap = makeCar().gears[0].max;

  const plain = makeCar();
  run(plain, input({ throttle: 1 }), 12, 1 / 60, false); // locked in 1st, no boost

  // Track the peak while boosting: the tank empties partway through, so the final
  // reading alone would miss whether the boost ever did anything.
  const boosted = makeCar();
  let peak = 0;
  for (let i = 0; i < 360; i++) {
    stepVehicle(boosted, input({ throttle: 1, nos: true }), 1 / 60);
    peak = Math.max(peak, boosted.speedKmh);
  }
  check('nitrous exceeds the gear cap', peak > cap + 15,
    `plain ${plain.speedKmh.toFixed(0)} -> nos peak ${peak.toFixed(0)} km/h (cap ${cap.toFixed(0)})`);

  // and it must not teleport the speed back down when the tank empties
  const afterDepletion = boosted.speedKmh;
  stepVehicle(boosted, input({ throttle: 1 }), 1 / 60);
  check('no speed snap when nitrous runs out', Math.abs(boosted.speedKmh - afterDepletion) < 3,
    `${afterDepletion.toFixed(1)} -> ${boosted.speedKmh.toFixed(1)} km/h in one frame`);

  check('nitrous drains its tank', boosted.nos < 100, `${boosted.nos.toFixed(0)}% left`);
  check('nitrous refills when released', (() => {
    const before = boosted.nos;
    run(boosted, input({ throttle: 1 }), 3);
    return boosted.nos > before;
  })(), `${boosted.nos.toFixed(0)}%`);
}

// --- 3. nitrous is gated when the tank is empty ---
{
  const car = makeCar();
  car.nos = 0;
  run(car, input({ throttle: 1, nos: true }), 1);
  check('empty tank disables nitrous', car.nosActive === false);
}

// --- 4. braking and reverse ---
{
  const car = makeCar();
  run(car, input({ throttle: 1 }), 8);
  const fast = car.speedKmh;
  run(car, input({ brake: 1 }), 2);
  check('braking slows the car', car.speedKmh < fast * 0.5, `${fast.toFixed(0)} -> ${car.speedKmh.toFixed(0)} km/h`);
  run(car, input({ brake: 1 }), 4);
  check('holding brake engages reverse', car.fwdSpeed < -1, `${car.fwdSpeed.toFixed(1)} m/s`);
}

// --- 5. steering turns the car, and a measured corner stays planted ---
// A *moderate* input is the right test for "planted": full lock at 170 km/h is an
// overdriven input and is supposed to break traction (checked separately below).
{
  const car = makeCar();
  run(car, input({ throttle: 1 }), 5);
  const h0 = car.heading;
  run(car, input({ throttle: 0.6, steer: 0.45 }), 2);
  const turned = Math.abs(car.heading - h0);
  const velAngle = Math.atan2(car.vel.x, car.vel.z);
  let drift = Math.abs(velAngle - car.heading);
  while (drift > Math.PI) drift = Math.abs(drift - 2 * Math.PI);
  check('steering changes heading', turned > 0.3, `${(turned * 57.3).toFixed(0)} deg`);
  // Arcade target: a fast corner on a moderate input should sit in a controllable
  // slip band — loose enough to feel alive, not so loose that it spins. Under ~18 deg
  // here, versus ~37 deg at full lock and ~88 deg on the handbrake, which is the
  // separation the handling model is aiming for.
  check('measured corner stays in the controllable band', drift < 0.31,
    `slip ${(drift * 57.3).toFixed(1)} deg`);
}

// --- 5b. overdriving it does break traction (the skill ceiling) ---
{
  const car = makeCar();
  run(car, input({ throttle: 1 }), 9);
  run(car, input({ throttle: 1, steer: 1 }), 1.5);
  check('full lock at speed breaks traction', car.slipAngle > 0.17,
    `slip ${(car.slipAngle * 57.3).toFixed(0)} deg at ${car.speedKmh.toFixed(0)} km/h`);
}

// --- 6. handbrake breaks traction, and grip recovers afterwards ---
{
  const car = makeCar();
  run(car, input({ throttle: 1 }), 7);
  run(car, input({ throttle: 0.7, steer: 1, handbrake: true }), 1.2);
  const slipping = car.slipAngle;
  check('handbrake induces a slide', slipping > 0.17, `slip ${(slipping * 57.3).toFixed(0)} deg`);
  run(car, input({ throttle: 0.5, steer: 0 }), 2.5);
  check('grip recovers after the slide', car.slipAngle < slipping * 0.5,
    `slip ${(car.slipAngle * 57.3).toFixed(1)} deg`);
}

// --- 7. lower surface grip really does reduce cornering grip ---
// Measured as turn RADIUS, not slip angle: reducing grip at both axles makes the car
// understeer and plough wide, which actually *lowers* the body-vs-velocity angle. Radius
// is the honest metric — a car with less grip cannot hold as tight a line.
{
  const corner = (surfaceGrip) => {
    const car = makeCar();
    car.surfaceGrip = surfaceGrip;
    run(car, input({ throttle: 1 }), 7);
    const h0 = car.heading;
    const p0 = { x: car.position.x, z: car.position.z };
    run(car, input({ throttle: 0.7, steer: 0.8 }), 1.5);
    const swept = Math.abs(car.heading - h0);                 // radians turned
    const chord = Math.hypot(car.position.x - p0.x, car.position.z - p0.z);
    return swept > 0.05 ? chord / swept : Infinity;            // approximate radius
  };
  const dryR = corner(1.0), wetR = corner(0.5);
  check('low-grip surface widens the line', wetR > dryR * 1.12,
    `dry R=${dryR.toFixed(0)}m vs wet R=${wetR.toFixed(0)}m`);
}

// --- 8. frame-rate independence: the same drive at 30 and 240 Hz must agree ---
{
  const drive = (dt) => {
    const car = makeCar();
    run(car, input({ throttle: 1 }), 10, dt);
    run(car, input({ throttle: 0.8, steer: 1 }), 3, dt);
    return car;
  };
  const slow = drive(1 / 30), fast = drive(1 / 240);
  const speedDiff = Math.abs(slow.speedKmh - fast.speedKmh);
  const distSlow = Math.hypot(slow.position.x, slow.position.z);
  const distFast = Math.hypot(fast.position.x, fast.position.z);
  const distDiff = Math.abs(distSlow - distFast) / Math.max(distSlow, 1);
  check('speed matches across frame rates', speedDiff < 6,
    `30Hz ${slow.speedKmh.toFixed(1)} vs 240Hz ${fast.speedKmh.toFixed(1)} km/h`);
  check('distance matches across frame rates', distDiff < 0.08,
    `${(distDiff * 100).toFixed(1)}% apart`);
}

// --- 9. no NaN under abusive input ---
{
  let nan = null;
  for (const id of CARS.map((c) => c.id)) {
    const car = makeCar(id);
    for (let i = 0; i < 4000; i++) {
      const inp = input({
        throttle: Math.random() < 0.5 ? 1 : 0,
        brake: Math.random() < 0.3 ? 1 : 0,
        steer: Math.round(Math.random() * 2 - 1),
        handbrake: Math.random() < 0.2,
        nos: Math.random() < 0.2,
      });
      stepVehicle(car, inp, 1 / 30);
      if (!Number.isFinite(car.speed) || !Number.isFinite(car.heading) || !Number.isFinite(car.position.x)) {
        nan = id; break;
      }
    }
    if (nan) break;
  }
  check('no NaN under random input (all cars)', nan === null, nan ? 'broke on ' + nan : '5 cars x 4000 steps');
}

// --- 10. the car specs actually produce different behaviour ---
{
  const results = CARS.map((c) => {
    const car = makeCar(c.id);
    run(car, input({ throttle: 1 }), 20);
    const top = car.speedKmh;
    run(car, input({ throttle: 0.8, steer: 1 }), 1.6);
    return { name: c.name, top, slip: car.slipAngle };
  });
  const tops = results.map((r) => r.top);
  const slips = results.map((r) => r.slip);
  check('cars reach different top speeds', Math.max(...tops) - Math.min(...tops) > 30,
    tops.map((t) => t.toFixed(0)).join('/') + ' km/h');
  check('cars differ in slide behaviour', Math.max(...slips) - Math.min(...slips) > 0.03,
    slips.map((s) => (s * 57.3).toFixed(0)).join('/') + ' deg');
}

// --- 11. car-to-car collisions ---
{
  const place = (id, x, z, heading = 0, vx = 0, vz = 0) => {
    const c = makeCar(id);
    c.position.x = x; c.position.z = z; c.heading = heading;
    c.vel.x = vx; c.vel.z = vz;
    c.speed = Math.hypot(vx, vz); c.speedKmh = c.speed * 3.6;
    return c;
  };
  const gap = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);

  // overlapping cars must be pushed apart
  {
    const a = place('vector', 0, 0), b = place('vector', 0, 1.2);
    const before = gap(a, b);
    resolveCarCollisions([a, b]);
    check('overlapping cars separate', gap(a, b) > before + 0.4,
      `${before.toFixed(2)}m -> ${gap(a, b).toFixed(2)}m`);
  }

  // cars far apart are left completely alone
  {
    const a = place('vector', 0, 0), b = place('vector', 0, 20);
    const contacts = resolveCarCollisions([a, b]);
    check('distant cars are untouched', contacts.length === 0 && a.position.z === 0 && b.position.z === 20);
  }

  // a rear-end shunt transfers speed: the follower slows, the leader is pushed on
  {
    const lead = place('vector', 0, 6, 0, 0, 5);
    const chase = place('vector', 0, 2, 0, 0, 30);
    resolveCarCollisions([lead, chase]);
    check('rear-end shunt slows the follower', chase.speed < 30,
      `${chase.speed.toFixed(1)} m/s`);
    check('rear-end shunt pushes the leader on', lead.speed > 5,
      `${lead.speed.toFixed(1)} m/s`);
  }

  // side-by-side contact nudges apart without launching either car
  {
    const a = place('vector', -0.9, 0, 0, 0, 40);
    const b = place('vector', 0.9, 0, 0, 0, 40);
    resolveCarCollisions([a, b]);
    const speeds = [a.speed, b.speed];
    check('side contact does not launch cars', speeds.every((s) => s < 45),
      speeds.map((s) => s.toFixed(1)).join(' / ') + ' m/s');
  }

  // sustained closing speed must not tunnel: drive one car into a stationary one and
  // confirm they never end up on opposite sides of each other
  {
    const still = place('vector', 0, 30);
    const rammer = place('torrent', 0, 0);
    // The game integrates physics on fixed substeps of at most 1/120 s for exactly this
    // reason, so the test drives it the same way a 30 fps frame would be driven.
    const PHYSICS_STEP = 1 / 120;
    let tunnelled = false, minGap = Infinity, topSpeed = 0;
    for (let frame = 0; frame < 300 && !tunnelled; frame++) {
      let remaining = 1 / 30;
      while (remaining > 1e-5) {
        const h = Math.min(PHYSICS_STEP, remaining);
        remaining -= h;
        stepVehicle(rammer, input({ throttle: 1, nos: true }), h);
        if (rammer.gear < 3 && rammer.speedKmh >= rammer.gears[rammer.gear].up) rammer.gear++;
        resolveCarCollisions([rammer, still]);
        minGap = Math.min(minGap, gap(rammer, still));
        topSpeed = Math.max(topSpeed, rammer.speedKmh);
        if (rammer.position.z > still.position.z) { tunnelled = true; break; }
      }
    }
    check('fast impact does not tunnel through', !tunnelled,
      `closest ${minGap.toFixed(2)}m at up to ${topSpeed.toFixed(0)} km/h`);
  }

  // a full grid in contact stays finite and stops overlapping
  {
    const grid = [
      place('vector', 0, 0), place('kestrel', 1.4, 0.6),
      place('torrent', -1.2, 1.1), place('apex', 0.3, -1.3),
    ];
    for (let i = 0; i < 40; i++) resolveCarCollisions(grid);
    const finite = grid.every((c) => Number.isFinite(c.position.x) && Number.isFinite(c.position.z));
    let worst = Infinity;
    for (let i = 0; i < grid.length; i++) {
      for (let j = i + 1; j < grid.length; j++) worst = Math.min(worst, gap(grid[i], grid[j]));
    }
    check('a pile-up resolves without NaN', finite);
    check('a pile-up stops overlapping', worst > 1.6, `closest pair ${worst.toFixed(2)}m`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll physics checks passed');
process.exit(failures ? 1 : 0);
