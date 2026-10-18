import { allocate, type Wrench } from './allocation';
import {
  add,
  cross,
  expSO3,
  mulMM,
  mulMtV,
  mulMV,
  norm,
  orthonormalize,
  quintic,
  rng,
  scale,
  sub,
  subM,
  transpose,
  vee,
  yawRollMatrix,
  type M3,
  type V3,
} from './math';
import { G0 } from './params';
import { vertical } from './profile';
import {
  DT,
  checkWarnings,
  dragForce,
  findClearance,
  findIncidents,
  summarize,
  type ControlReport,
  type Sample,
  type Timeline,
} from './timeline';
import { driverSeat } from './vehicle';

/**
 * Closed-loop flight: the car is simulated forward as a rigid body, driven only by the
 * thrust its thrusters actually deliver, under a flight controller that tracks the ideal
 * flight (the reference) and copes with things going wrong:
 *
 *  - thrust: each thruster delivers a fixed few percent more or less than commanded, plus
 *    fast fluctuation; valves respond with a lag, and below a minimum opening they can
 *    only pulse (sigma-delta: the duty cycle carries the average);
 *  - the true center of mass is a few centimeters from where the controller assumes it,
 *    so every thrust line carries an unmodeled torque; the inertia is mis-estimated;
 *  - gusts change the airflow and therefore the drag.
 *
 * The controller runs at `controlRate`. It computes the force and torque to apply —
 * feedforward from the reference plus feedback on position, velocity, attitude and rate
 * (a geometric attitude controller on SO(3)) — and the same allocation as the ideal
 * model splits that across the six thrusters. Because it constantly corrects, thrusters
 * flicker and sometimes fire against each other, as in the footage.
 */
export function simulateControlled(ideal: Timeline): Timeline {
  const p = ideal.params;
  if (!ideal.flight.feasible) return ideal;
  const { thrusters, inertia } = ideal;
  const r = rng(p.seed);
  const ve = p.isp * G0;
  const seat = driverSeat(p);
  const iStart = ideal.samples.findIndex((s) => s.t >= -1e-9);
  const ref = (i: number) => ideal.samples[Math.min(i, ideal.samples.length - 1)];

  // ── The truth the controller does not know ────────────────────────────
  const dir = (): V3 => {
    const v: V3 = [r.gauss(), r.gauss() * 0.5, r.gauss()];
    return scale(v, 1 / Math.max(norm(v), 1e-9));
  };
  const cgErr = scale(dir(), p.cgOffset);
  const bias = thrusters.map(() => 1 + p.thrustScatter * r.gauss());
  const Itrue = inertia.map((I) => I * Math.max(0.3, 1 + p.inertiaError * r.gauss())) as V3;
  const arm = thrusters.map((t) => sub(t.position, cgErr)); // lever arms from the true CG
  let wind: V3 = [0, 0, 0];
  const gustTau = 0.6;

  // ── Controller settings ───────────────────────────────────────────────
  const steps = Math.max(1, Math.round(1 / (p.controlRate * DT)));
  const cycle = steps * DT;
  const wp = p.posBandwidth,
    wa = p.attBandwidth,
    zeta = 0.8;
  // The acceleration and angular-acceleration feedforward leads by the valve lag the
  // controller expects, so thrust arrives when the reference wants it — it matters for the
  // short, hard landing burn (the attitude and rate targets themselves are not led: a
  // first-order lag delays force, not pose). It never reads past the planned touchdown,
  // where the reference switches to the suspension's ground reaction.
  const leadSteps = Math.round(Math.max(p.valveLag, 0) / DT);
  const iTd = ideal.samples.findIndex((s) => s.t >= ideal.events.touchdown - 1e-9);
  const iAirEnd = (iTd < 0 ? ideal.samples.length : iTd) - 1;
  const kR = inertia.map((I) => I * wa * wa) as V3;
  const kW = inertia.map((I) => 2 * zeta * I * wa) as V3;

  // ── State ─────────────────────────────────────────────────────────────
  const s0 = ref(iStart);
  let pos: V3 = [...s0.pos];
  let vel: V3 = [...s0.vel];
  let R: M3 = [...s0.R];
  let w: V3 = [0, 0, 0];
  let gas = 0;
  let rollAngle = 0;
  const cmd = thrusters.map(() => 0);
  const level = thrusters.map(() => 0); // valve-limited target
  const actual = thrusters.map(() => 0);
  const bucket = thrusters.map(() => 0); // sigma-delta accumulator
  const wasOn = thrusters.map(() => false);
  let noise = thrusters.map(() => 0);
  let required: Wrench = { force: [0, 0, 0], torque: [0, 0, 0] };
  let residual = 0;
  let pulses = 0;
  let opposedSide = 0;
  const sideIdx = thrusters.flatMap((t, j) => (t.group === 'side' ? [j] : []));
  const lag = p.valveLag > 1e-4 ? 1 - Math.exp(-DT / p.valveLag) : 1;

  const samples: Sample[] = ideal.samples.slice(0, iStart);
  let maxPos = 0,
    sumPos2 = 0,
    nPos = 0,
    maxAtt = 0;
  let touchdown = NaN;
  let fellBack = NaN; // when the car settled back onto its wheels before the apex
  const tApex = ideal.events.apex;
  const tLimit = ideal.events.touchdown + 1.5;

  for (let i = iStart; ; i++) {
    const t = ideal.events.start + i * DT;
    const rf = ref(i);
    const mass = p.mass - gas;
    const k = i - iStart;

    // ── Controller update ───────────────────────────────────────────────
    if (k % steps === 0) {
      // Translation: track the reference with a PD law around its acceleration.
      const ep = sub(rf.pos, pos),
        ev = sub(rf.vel, vel);
      const rl = ref(Math.min(i + leadSteps, iAirEnd));
      // Past the planned touchdown the feedforward is a plain hover; feedback brings it down.
      const aFF: V3 = i > iAirEnd ? [0, 0, 0] : rl.acc;
      const aDes = add(aFF, add(scale(ep, wp * wp), scale(ev, 2 * zeta * wp)));
      const dragEst = dragForce(p, vel, R); // no wind knowledge
      const F = sub(sub(scale(aDes, mass), [0, -mass * G0, 0]), dragEst);
      // Attitude: geometric tracking control (Lee et al.) with the nominal inertia.
      const Rd = rf.R,
        wd = rf.omegaBody,
        ad = rl.alphaBody;
      const RtRd = mulMM(transpose(R), Rd);
      const eR = scale(vee(subM(mulMM(transpose(Rd), R), mulMM(transpose(R), Rd))), 0.5);
      const wdB = mulMV(RtRd, wd);
      const eW = sub(w, wdB);
      const Iw = [inertia[0] * w[0], inertia[1] * w[1], inertia[2] * w[2]] as V3;
      const ff = sub(cross(w, wdB), mulMV(RtRd, ad));
      const tau: V3 = [0, 1, 2].map((a) => -kR[a] * eR[a] - kW[a] * eW[a] + cross(w, Iw)[a] - inertia[a] * ff[a]) as V3;
      required = { force: mulMtV(R, F), torque: tau };
      const alloc = allocate(thrusters, required);
      residual = alloc.residual;
      alloc.forces.forEach((f, j) => (cmd[j] = Math.min(Math.max(f, 0), thrusters[j].maxForce)));

      // Valves: steady opening above the minimum, pulses below it.
      noise = thrusters.map(() => p.thrustNoise * r.gauss());
      thrusters.forEach((th, j) => {
        const minF = p.minOpening * th.maxForce;
        if (cmd[j] >= minF || minF <= 0) {
          level[j] = cmd[j];
          bucket[j] = 0;
        } else {
          bucket[j] += cmd[j] * cycle;
          if (bucket[j] >= minF * cycle * 0.5) {
            level[j] = minF;
            bucket[j] -= minF * cycle;
          } else level[j] = 0;
        }
        const on = level[j] > 0;
        if (on && !wasOn[j]) pulses++;
        wasOn[j] = on;
      });
    }

    // ── Plant: what the thrusters really deliver, and how the car moves ──
    let Fb: V3 = [0, 0, 0],
      Tb: V3 = [0, 0, 0];
    thrusters.forEach((th, j) => {
      const target = level[j] * bias[j] * Math.max(0, 1 + noise[j]);
      actual[j] += (target - actual[j]) * lag;
      const f = scale(th.direction, actual[j]);
      Fb = add(Fb, f);
      Tb = add(Tb, cross(arm[j], f));
    });
    if (sideIdx.length === 2 && sideIdx.every((j) => actual[j] > 0.02 * thrusters[j].maxForce)) opposedSide += DT;

    // Gusts: an Ornstein–Uhlenbeck wind, weaker vertically.
    const sq = Math.sqrt((2 * DT) / gustTau);
    wind = [0, 1, 2].map(
      (a) => wind[a] - (wind[a] / gustTau) * DT + p.gustStd * (a === 1 ? 0.4 : 1) * sq * r.gauss(),
    ) as V3;
    const drag = dragForce(p, sub(vel, wind), R);
    const gravity: V3 = [0, -mass * G0, 0];
    const thrust = mulMV(R, Fb);
    const acc = scale(add(add(thrust, drag), gravity), 1 / mass);
    const Iw = [Itrue[0] * w[0], Itrue[1] * w[1], Itrue[2] * w[2]] as V3;
    const wDot = sub(Tb, cross(w, Iw)).map((v, a) => v / Itrue[a]) as V3;

    // Tracking error statistics.
    const pe = norm(sub(pos, rf.pos));
    maxPos = Math.max(maxPos, pe);
    sumPos2 += pe * pe;
    nPos++;
    const cosAtt = (mulMM(transpose(rf.R), R).reduce((s, v, n) => (n % 4 === 0 ? s + v : s), 0) - 1) / 2;
    maxAtt = Math.max(maxAtt, Math.acos(Math.min(1, Math.max(-1, cosAtt))));

    const rel = add(cross(wDot, seat), cross(w, cross(w, seat)));
    const seatAcc = add(acc, mulMV(R, rel));
    const thrustSum = actual.reduce((s, f) => s + f, 0);
    samples.push({
      t,
      phase: rf.phase === 'touchdown' || rf.phase === 'settle' || rf.phase === 'slide' ? 'landing' : rf.phase,
      airborne: true,
      pos: [...pos],
      vel: [...vel],
      acc,
      yaw: Math.atan2(-R[6], R[0]),
      roll: rollAngle,
      R: [...R],
      omegaBody: [...w],
      alphaBody: wDot,
      mass,
      gravity,
      drag,
      thrust,
      ground: [0, 0, 0],
      required,
      thrusterForces: [...actual],
      saturated: cmd.flatMap((c, j) => (c >= thrusters[j].maxForce * 0.9999 && level[j] > 0 ? [j] : [])),
      residual,
      gasUsed: gas,
      occupantG: norm(add(seatAcc, [0, G0, 0])) / G0,
      jetPower: 0.5 * thrustSum * ve,
    });

    // Integrate (semi-implicit Euler; rotation by the exponential map).
    vel = add(vel, scale(acc, DT));
    pos = add(pos, scale(vel, DT));
    w = add(w, scale(wDot, DT));
    R = orthonormalize(mulMM(R, expSO3(scale(w, DT))));
    rollAngle += w[0] * DT;
    gas += (thrustSum / ve) * DT;

    // Touchdown: back at ride height on the way down. Before the apex that means the
    // thrust couldn't hold the car up (the wheels meet the road again, so the flight ends).
    if ((vel[1] < 0 && pos[1] <= p.cgHeight && (t > tApex || pos[1] <= p.cgHeight - 0.02)) || t + DT > tLimit) {
      if (t <= tApex) fellBack = t + DT;
      touchdown = t + DT;
      break;
    }
  }

  // ── Ground: suspension, then a straight braking slide ──────────────────
  const vt = Math.max(-vel[1], 0);
  const travel = Math.max(p.suspensionTravel, 0.01);
  const aComp = vt > 1e-6 ? (vt * vt) / (2 * travel) : 0;
  // The ground phases start at this flight's own touchdown (launch and coast times too, so
  // a car that fell back early stays on the road rather than following the ideal arc).
  const ground = {
    ...ideal.flight.ground,
    tb: touchdown,
    ts: touchdown,
    T: touchdown,
    vt,
    aComp,
    tComp: vt > 1e-6 ? vt / aComp : 0,
  };
  const up: V3 = [R[1], R[4], R[7]];
  const tiltDeg = (Math.acos(Math.min(1, Math.max(-1, up[1]))) * 180) / Math.PI;
  const yawTd = Math.atan2(-R[6], R[0]);
  const tdPos: V3 = [...pos];
  let x = pos[0],
    vx = Math.max(vel[0], 0);
  const brakeTime = vx / Math.max(p.brakingDecel, 0.1);
  // The slide turns the car by the slide yaw as it brakes, as in the ideal flight (over at
  // least half a second, should it touch down with no speed to brake from).
  const yawTotal = (p.driftYawDeg * Math.PI) / 180;
  const turnTime = Math.max(brakeTime, 0.5);
  const tEnd = touchdown + brakeTime + 1.5;
  let stopTime = NaN;
  const mass = p.mass - gas;
  for (let i = samples.length; ; i++) {
    const t = ideal.events.start + i * DT;
    if (t > tEnd + 1e-9) break;
    const vs = vertical(ground, p, t);
    const q = quintic((t - touchdown) / turnTime);
    const yaw = yawTd + yawTotal * q.s;
    const Rg = yawRollMatrix(yaw, 2 * Math.PI * p.rollTurns);
    // Upright after whole rolls, so the turn is about the body's up axis.
    const omega: V3 = [0, (yawTotal * q.ds) / turnTime, 0];
    const alpha: V3 = [0, (yawTotal * q.dds) / (turnTime * turnTime), 0];
    const ax = vx > 0 ? -p.brakingDecel : 0;
    const vel3: V3 = [vx, vs.vy, 0];
    const acc: V3 = [ax, vs.ay, 0];
    const drag = dragForce(p, vel3, Rg);
    const gravity: V3 = [0, -mass * G0, 0];
    const external = sub(sub(scale(acc, mass), gravity), drag);
    const seatAcc = add(acc, mulMV(Rg, add(cross(alpha, seat), cross(omega, cross(omega, seat)))));
    samples.push({
      t,
      phase: vs.phase,
      airborne: false,
      pos: [x, vs.y, tdPos[2]],
      vel: vel3,
      acc,
      yaw,
      roll: 2 * Math.PI * p.rollTurns,
      R: Rg,
      omegaBody: omega,
      alphaBody: alpha,
      mass,
      gravity,
      drag,
      thrust: [0, 0, 0],
      ground: external,
      required: { force: mulMtV(Rg, external), torque: [0, inertia[1] * alpha[1], 0] },
      thrusterForces: thrusters.map(() => 0),
      saturated: [],
      residual: 0,
      gasUsed: gas,
      occupantG: norm(add(seatAcc, [0, G0, 0])) / G0,
      jetPower: 0,
    });
    vx = Math.max(0, vx + ax * DT);
    if (vx === 0 && Number.isNaN(stopTime)) stopTime = t;
    x += vx * DT;
  }

  const events = {
    ...ideal.events,
    touchdown,
    stop: Number.isNaN(stopTime) ? touchdown + brakeTime : stopTime,
    end: samples[samples.length - 1].t,
  };
  const weight = p.mass * G0;
  const minClear = findClearance(p, samples);
  const summary = summarize(p, samples, ideal.summary.approachSpeed, weight, ve, minClear);
  const idealTd = ideal.samples.find((s) => s.t >= ideal.events.touchdown)!;
  const control: ControlReport = {
    touchdownTime: touchdown,
    touchdownSpeed: vt,
    touchdownTiltDeg: tiltDeg,
    landingError: [tdPos[0] - idealTd.pos[0], tdPos[2] - idealTd.pos[2]],
    maxPosError: maxPos,
    rmsPosError: Math.sqrt(sumPos2 / Math.max(nPos, 1)),
    maxAttError: (maxAtt * 180) / Math.PI,
    extraGas: summary.gasMass - ideal.summary.gasMass,
    opposedSideTime: opposedSide,
    pulses,
  };
  const incidents = findIncidents(p, samples, summary);
  if (Number.isFinite(fellBack)) {
    incidents.push({
      kind: 'no-flight',
      message: `Not enough thrust to climb: the car settles back onto its wheels at +${fellBack.toFixed(2)} s, before reaching the apex.`,
      label: "Can't climb",
      t: fellBack,
      tEnd: events.end,
      point: [tdPos[0], 0, tdPos[2]],
    });
  } else if (touchdown >= tLimit - 1e-6) {
    incidents.push({
      kind: 'no-landing',
      message: 'The controller never brought the car down: it is still airborne 1.5 s after the planned touchdown.',
      label: 'Never lands',
      t: touchdown,
      tEnd: events.end,
      point: [...tdPos],
    });
  } else if (tiltDeg > 10) {
    incidents.push({
      kind: 'tilted-landing',
      message: `Lands tilted ${tiltDeg.toFixed(0)}° from level.`,
      label: `Lands tilted ${tiltDeg.toFixed(0)}°`,
      t: touchdown,
      tEnd: touchdown + 0.3,
      point: [tdPos[0], 0, tdPos[2]],
      tiltDeg,
    });
  }
  incidents.sort((a, b) => a.t - b.t);
  const warnings = [...checkWarnings(thrusters, samples, summary, true), ...incidents.map((i) => i.message)];
  return { ...ideal, samples, events, summary, warnings, incidents, control };
}
