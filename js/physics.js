// NFS-Most-Wanted-flavoured arcade vehicle physics.
//
// Instead of bleeding off sideways velocity with a single grip constant, this uses a
// two-axle SLIP-ANGLE tyre model: each axle's lateral force rises with its slip angle
// until it saturates at that axle's grip limit, then the tyre slides. That one change is
// what gives the MW feel — planted on entry, breakaway when you overdrive it, and a drift
// you hold with the throttle and counter-steer rather than one that snaps back.
//
// On top of that:
//  - weight transfer: braking loads the front (and unloads the rear), power does the
//    reverse, so you can provoke or catch a slide with the pedals
//  - power oversteer: throttle eats rear grip
//  - handbrake: collapses rear grip for a deliberate drift initiation
//  - NOS: extra thrust that can push past the gear's cap
//
// Body frame: x = forward, s = the car's "side" axis (+X at heading 0). Positive yaw
// rotates forward toward +s, which is screen-LEFT, so left steering input is positive.
// Standard planar vehicle equations are used, including the centripetal cross terms
// (v̇_fwd = a_fwd + r·v_side, v̇_side = a_side − r·v_fwd) — those are what actually turn
// the velocity vector with the body.

import { clamp, damp } from './utils.js';
import { gearsFor, DEFAULT_SPEC } from './cars.js';

const KMH = 3.6;

// Gearing for the baseline car. Each Car builds its own table from its spec, so this is
// only the fallback for anything constructed without one.
export const GEARS = gearsFor(DEFAULT_SPEC.topSpeedKmh, DEFAULT_SPEC.accelScale);

// Baseline handling model. Cars scale these through their spec rather than overriding
// them, so there is exactly one place to tune how the game drives.
export const CAR = {
  maxSpeed: 250 / KMH,
  reverseMaxKmh: 28,
  reverseAccel: 8,
  brakeForce: 17,
  rollDrag: 1.2,
  airDrag: 0.0008,

  // steering: quick at low speed, progressively less lock as speed rises so a fast
  // corner stays planted instead of snapping into oversteer on a moderate input
  maxSteer: 0.56,
  steerFalloff: 0.74,
  steerResponse: 13,
  steerReturn: 17,
  counterSteerBonus: 0.35,  // extra steering authority while sliding, to catch it

  // chassis
  wheelBase: 2.95,
  frontDist: 1.35,          // CG -> front axle
  rearDist: 1.60,           // CG -> rear axle
  yawInertia: 1.75,         // radius of gyration squared
  maxYawRate: 2.9,

  // Tyres. `stiff*` is how fast lateral force builds per radian of slip; `grip*` is where
  // it saturates and the tyre starts sliding. These do different jobs: stiffness sets how
  // much slip a normal corner needs (too low and the car visibly drifts through every
  // bend), grip sets when it lets go. Drift comes from saturation — the handbrake (x0.26)
  // and each car's `driftiness` cut the rear limit — not from a soft rear.
  stiffFront: 26.0,
  stiffRear: 32.0,
  gripFront: 17.0,
  gripRear: 23.0,
  handbrakeGrip: 0.26,      // rear grip multiplier while handbraking
  handbrakeStiff: 0.40,
  throttleGripLoss: 0.10,   // power oversteer
  brakeRearLoss: 0.14,      // trail-braking rotation

  // weight transfer (fraction of load moved at full accel/brake)
  loadTransfer: 0.34,

  // nitrous
  nosThrust: 25,
  nosOverspeed: 1.16,       // NOS can push this far past the gear cap
  nosDrain: 36,             // % per second held
  nosRefill: 6.5,           // % per second regained
};

export function stepVehicle(car, input, dt) {
  const spec = car.spec || DEFAULT_SPEC;
  const gears = car.gears || GEARS;
  const topSpeed = (spec.topSpeedKmh || 250) / KMH;

  const h = car.heading;
  const fx = Math.sin(h), fz = Math.cos(h);   // forward
  const sx = Math.cos(h), sz = -Math.sin(h);  // side (+X at heading 0)

  let vFwd = car.vel.x * fx + car.vel.z * fz;
  let vSide = car.vel.x * sx + car.vel.z * sz;

  const throttle = input.throttle, brake = input.brake;
  const handbrake = !!input.handbrake;

  // ---- nitrous ----
  const wantNos = !!input.nos && car.nos > 1 && vFwd > 3;
  car.nosActive = wantNos;
  if (wantNos) car.nos = Math.max(0, car.nos - CAR.nosDrain * dt);
  else car.nos = Math.min(100, car.nos + CAR.nosRefill * dt);

  // ---- longitudinal: engine / brake / drag ----
  // Nitrous lifts the speed ceiling to the NEXT gear's cap (top speed in 4th). Without
  // that it was clamped to the current gear and felt like it did nothing — in 1st it only
  // bought a few km/h. Now it genuinely pulls you past the gear and up to the shift point.
  const gear = gears[car.gear] || gears[0];
  let cap = gear.max / KMH;
  if (wantNos) {
    const next = gears[Math.min(car.gear + 1, gears.length - 1)];
    cap = Math.max(cap * CAR.nosOverspeed, next.max / KMH);
  }

  let aLong = 0;
  if (throttle > 0 && vFwd < cap) aLong += gear.accel * throttle;
  if (wantNos && vFwd < cap) aLong += CAR.nosThrust * (spec.nosPower ?? 1);
  if (brake > 0) {
    if (vFwd > 0.4) aLong -= CAR.brakeForce;
    else aLong -= CAR.reverseAccel;
  }
  if (throttle === 0 && brake === 0 && Math.abs(vFwd) > 0.05) {
    aLong -= Math.sign(vFwd) * CAR.rollDrag * (1 + Math.abs(vFwd) * 0.03);
  }
  aLong -= Math.sign(vFwd) * CAR.airDrag * vFwd * vFwd;

  // ---- steering: smoothed, speed-sensitive, with counter-steer authority ----
  const speedNorm = clamp(Math.abs(vFwd) / topSpeed, 0, 1);
  let steerCap = CAR.maxSteer * (spec.steerScale ?? 1) * (1 - CAR.steerFalloff * speedNorm);
  // Extra lock to catch a slide — but ONLY while actually counter-steering, i.e. steering
  // against the yaw. Granting it whenever the car was sliding created a feedback loop
  // (slide -> more lock -> more front force -> more yaw -> more slide) that spun the car
  // out on moderate inputs.
  const yawNow = car.yawRate || 0;
  const countering = input.steer !== 0 && Math.sign(input.steer) !== Math.sign(yawNow);
  if (countering) {
    const slideAmount = clamp(Math.abs(vSide) / 9, 0, 1);
    steerCap *= 1 + CAR.counterSteerBonus * slideAmount;
  }
  const steerTarget = input.steer * steerCap;
  const rate = input.steer === 0 ? CAR.steerReturn : CAR.steerResponse;
  car.steer = damp(car.steer, steerTarget, rate, dt);

  // ---- weight transfer: longitudinal accel moves load between the axles ----
  const loadShift = clamp(aLong / 14, -1, 1);           // -1 hard brake .. +1 hard accel
  const loadFront = clamp(1 - CAR.loadTransfer * loadShift, 0.45, 1.55);
  const loadRear  = clamp(1 + CAR.loadTransfer * loadShift, 0.45, 1.55);

  // ---- tyre forces from slip angles ----
  // Below walking pace the slip-angle math is ill-conditioned, so blend to a kinematic
  // steering model and damp out any sideways velocity.
  const tireBlend = clamp(Math.abs(vFwd) / 4.5, 0, 1);
  const vRef = Math.max(Math.abs(vFwd), 2.2);           // denominator floor
  const yaw = car.yawRate || 0;

  const slipFront = Math.atan2(vSide + yaw * CAR.frontDist, vRef) - car.steer;
  const slipRear  = Math.atan2(vSide - yaw * CAR.rearDist, vRef);

  // Per-car grip, scaled again by the surface the car is on (1 = dry asphalt; less on a
  // wet line or a dirt shoulder). `driftiness` loosens the rear, but with a DAMPED curve:
  // a straight divide made a drifty car slide through every normal corner (Tandem S held
  // 78 deg of slip just turning in). This keeps the character without breaking the basics.
  const gripScale = (spec.gripScale ?? 1) * (car.surfaceGrip ?? 1);
  const driftiness = spec.driftiness ?? 1;
  const driftGrip = 1 / (1 + (driftiness - 1) * 0.55);  // 1.6 -> x0.74, not x0.63
  const driftStiff = 1 / (1 + (driftiness - 1) * 0.45);

  let stiffR = CAR.stiffRear * driftStiff;
  let gripR = CAR.gripRear * loadRear * gripScale * driftGrip;
  if (handbrake) { stiffR *= CAR.handbrakeStiff; gripR *= CAR.handbrakeGrip; }
  gripR *= 1 - CAR.throttleGripLoss * throttle;         // power oversteer
  if (brake > 0 && vFwd > 2) gripR *= 1 - CAR.brakeRearLoss;
  const gripF = CAR.gripFront * loadFront * gripScale;

  // force opposes slip, saturating at the grip limit
  const fyFront = -clamp(CAR.stiffFront * slipFront, -gripF, gripF);
  const fyRear  = -clamp(stiffR * slipRear, -gripR, gripR);

  const aSide = (fyFront * Math.cos(car.steer) + fyRear) * tireBlend;
  const yawAcc = (fyFront * CAR.frontDist * Math.cos(car.steer) - fyRear * CAR.rearDist) / CAR.yawInertia;

  // ---- integrate yaw (blending to kinematic at crawl speed) ----
  let yawRate = yaw + yawAcc * dt * tireBlend;
  const yawKinematic = (vFwd / CAR.wheelBase) * Math.tan(car.steer);
  yawRate = yawRate * tireBlend + yawKinematic * (1 - tireBlend);
  yawRate = clamp(yawRate, -CAR.maxYawRate, CAR.maxYawRate);
  car.yawRate = yawRate;
  car.heading += yawRate * dt;

  // ---- integrate body velocities (with centripetal cross terms) ----
  vFwd += (aLong + yawRate * vSide) * dt;
  vSide += (aSide - yawRate * vFwd) * dt;
  if (tireBlend < 1) vSide *= Math.exp(-(1 - tireBlend) * 9 * dt); // settle when crawling
  // The gear cap limits what the ENGINE can add (gated above), it is not a velocity clamp.
  // Clamping speed to the gear cap here used to snap the car from ~110 back to ~60 km/h the
  // instant nitrous ran out, which is what made the boost feel like it did nothing. Only an
  // absolute ceiling is enforced; drag brings an over-speeding car down smoothly.
  const absoluteMax = topSpeed * CAR.nosOverspeed;
  vFwd = clamp(vFwd, -CAR.reverseMaxKmh / KMH, absoluteMax);

  // ---- back to world space, using the NEW heading ----
  const nfx = Math.sin(car.heading), nfz = Math.cos(car.heading);
  const nsx = Math.cos(car.heading), nsz = -Math.sin(car.heading);
  car.vel.x = nfx * vFwd + nsx * vSide;
  car.vel.z = nfz * vFwd + nsz * vSide;
  car.position.x += car.vel.x * dt;
  car.position.z += car.vel.z * dt;

  // ---- bookkeeping for visuals, audio and HUD ----
  car.fwdSpeed = vFwd;
  car.latSpeed = vSide;
  car.speed = Math.hypot(car.vel.x, car.vel.z);
  car.speedKmh = car.speed * KMH;
  car.slipAngle = Math.abs(Math.atan2(vSide, Math.max(Math.abs(vFwd), 0.5)));
  car.drifting = car.slipAngle > 0.17 && car.speed > 7;   // ~10 degrees of slip
  car.driftHard = car.slipAngle > 0.34 && car.speed > 9;
}

// ---------------------------------------------------------------------------
// Car-to-car collisions.
//
// Each car is approximated by two circles along its length rather than one big circle:
// a single circle around a 4.5 x 1.9 m car is either too wide (cars bounce while still
// visually side by side) or too short (they interpenetrate nose to tail). Two circles
// behave like a capsule and get both cases right.
//
// Resolution is mass-equal and arcade: separate the overlap, then exchange the velocity
// component along the contact normal with low restitution so contact bleeds speed and
// nudges cars aside instead of launching them. Tangential motion is left alone, so you
// can lean on a rival through a corner and slide along them.
//
// Returns the contacts that happened, so the caller can add shake, sparks and sound.
const BODY_CIRCLES = [
  { along: 1.15, radius: 1.12 },
  { along: -1.15, radius: 1.12 },
];
const RESTITUTION = 0.22;

export function resolveCarCollisions(cars) {
  const contacts = [];

  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];

      // cheap reject before the 4 circle-pair tests
      const cdx = b.position.x - a.position.x, cdz = b.position.z - a.position.z;
      if (cdx * cdx + cdz * cdz > 36) continue;   // 6 m apart: nothing can touch

      const afx = Math.sin(a.heading), afz = Math.cos(a.heading);
      const bfx = Math.sin(b.heading), bfz = Math.cos(b.heading);

      // find the deepest of the four circle pairs and resolve that one
      let best = null;
      for (const ca of BODY_CIRCLES) {
        const ax = a.position.x + afx * ca.along, az = a.position.z + afz * ca.along;
        for (const cb of BODY_CIRCLES) {
          const bx = b.position.x + bfx * cb.along, bz = b.position.z + bfz * cb.along;
          const dx = bx - ax, dz = bz - az;
          const d2 = dx * dx + dz * dz;
          const minD = ca.radius + cb.radius;
          if (d2 >= minD * minD) continue;
          const d = Math.sqrt(d2);
          const pen = minD - (d > 1e-6 ? d : 0);
          if (!best || pen > best.pen) {
            // if the centres coincide, push along the line between the car origins
            const fallback = Math.hypot(cdx, cdz) || 1;
            best = {
              pen,
              nx: d > 1e-6 ? dx / d : cdx / fallback,
              nz: d > 1e-6 ? dz / d : cdz / fallback,
              x: d > 1e-6 ? ax + dx * 0.5 : (a.position.x + b.position.x) / 2,
              z: d > 1e-6 ? az + dz * 0.5 : (a.position.z + b.position.z) / 2,
            };
          }
        }
      }
      if (!best) continue;

      // The deepest circle pair gives the contact depth, but its normal can point the
      // WRONG WAY once two cars have interpenetrated: in a nose-to-tail overlap the
      // deepest pair is the follower's front circle against the leader's rear circle,
      // which by then sits *behind* it, so separating along that normal drives the cars
      // further into each other. Flip the normal whenever it opposes the direction the
      // other car's body actually lies in.
      const centreLen = Math.hypot(cdx, cdz);
      if (centreLen > 1e-4) {
        if (best.nx * (cdx / centreLen) + best.nz * (cdz / centreLen) < 0) {
          best.nx = -best.nx; best.nz = -best.nz;
        }
      } else {
        // perfectly coincident: push apart sideways relative to the first car
        best.nx = Math.cos(a.heading); best.nz = -Math.sin(a.heading);
      }

      // separate
      const half = best.pen * 0.5;
      a.position.x -= best.nx * half; a.position.z -= best.nz * half;
      b.position.x += best.nx * half; b.position.z += best.nz * half;

      // exchange the approaching velocity along the normal
      const rvn = (b.vel.x - a.vel.x) * best.nx + (b.vel.z - a.vel.z) * best.nz;
      let impact = 0;
      if (rvn < 0) {
        impact = -rvn;
        const imp = -(1 + RESTITUTION) * rvn * 0.5;
        a.vel.x -= imp * best.nx; a.vel.z -= imp * best.nz;
        b.vel.x += imp * best.nx; b.vel.z += imp * best.nz;
      }

      for (const c of [a, b]) {
        c.speed = Math.hypot(c.vel.x, c.vel.z);
        c.speedKmh = c.speed * KMH;
      }
      contacts.push({ a, b, impact, x: best.x, z: best.z });
    }
  }

  return contacts;
}
