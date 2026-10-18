import { allocate, type Wrench } from './allocation';
import { LINEUP, LINEUP_Z, STAGE, type Obstacle } from './layout';
import { add, cross, mulMtV, mulMV, norm, quintic, scale, sub, yawRollMatrix, type M3, type V3 } from './math';
import { G0, GAS_CONSTANT, N2_COMPRESSIBILITY, N2_MOLAR_MASS, TANK_TEMPERATURE, type Params } from './params';
import { flightState, solveFlight, type FlightSolution } from './flight';
import { roll, rollWindow, vertical, type Phase } from './profile';
import { buildThrusters, driverSeat, principalInertia, type Thruster } from './vehicle';

export interface Sample {
  t: number;
  phase: Phase;
  airborne: boolean;
  pos: V3;
  vel: V3;
  acc: V3;
  yaw: number;
  roll: number;
  /** Body → world rotation. */
  R: M3;
  omegaBody: V3;
  alphaBody: V3;
  mass: number;
  /** World-frame forces on the car [N]. */
  gravity: V3;
  drag: V3;
  thrust: V3;
  ground: V3;
  /** Body-frame wrench the thrusters (air) or tires (ground) must supply. */
  required: Wrench;
  thrusterForces: number[];
  saturated: number[];
  residual: number;
  /** Cumulative gas expelled [kg]. */
  gasUsed: number;
  /** Specific force felt at the driver's seat, as a multiple of g. */
  occupantG: number;
  /** Kinetic power in the exhaust jets [W]. */
  jetPower: number;
}

export interface Peak {
  value: number;
  t: number;
}

export interface Summary {
  approachSpeed: number;
  weight: number;
  peakThrust: Peak;
  peakThrustToWeight: number;
  launchThrust: number;
  landingThrust: number;
  peakThruster: Peak & { index: number };
  peakRollTorque: Peak;
  peakRollRate: Peak;
  /** Largest thrust component across the approach line (world z). */
  peakLateralThrust: Peak;
  totalImpulse: number;
  gasMass: number;
  tankVolumeLiters: number;
  tankMass: number;
  peakOccupantG: Peak;
  weightlessTime: number;
  minClearance: { value: number; t: number; obstacle: string };
  touchdownLoad: number;
  noBurnImpactSpeed: number;
  noBurnImpactLoad: number;
  peakJetPower: Peak;
  exhaustVelocity: number;
  maxResidual: number;
}

export interface Events {
  start: number;
  liftoff: number;
  burnout: number;
  apex: number;
  rollStart: number;
  rollEnd: number;
  landingBurn: number;
  touchdown: number;
  stop: number;
  end: number;
}

/** How the closed-loop flight differs from the ideal one (closedloop.ts). */
export interface ControlReport {
  /** Touchdown time, vertical speed [m/s] and tilt from level [deg]. */
  touchdownTime: number;
  touchdownSpeed: number;
  touchdownTiltDeg: number;
  /** Landing point minus the ideal one, along and across the flight line [m]. */
  landingError: [number, number];
  /** Largest and rms position error from the ideal path in flight [m]. */
  maxPosError: number;
  rmsPosError: number;
  /** Largest attitude error from the ideal [deg]. */
  maxAttError: number;
  /** Nitrogen beyond the ideal flight's [kg]. */
  extraGas: number;
  /** Time both front side thrusters fire at once [s], and valve pulses started. */
  opposedSideTime: number;
  pulses: number;
}

/** An axis-aligned solid the car must clear (a parked vehicle or the stage). */
export interface Solid {
  label: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  bottom: number;
  top: number;
}

/**
 * Something that makes the run invalid, with when and where it happens, so the UI can
 * point at it during playback: the car hitting a solid, landing hard, or not being able
 * to fly at all with these settings: 'infeasible-plan' when no flight plan meets them (the
 * car stays at its launch point), 'no-flight' when the closed-loop flight can't climb.
 */
export interface Incident {
  kind: 'collision' | 'hard-landing' | 'tilted-landing' | 'infeasible-plan' | 'no-flight' | 'no-landing';
  /** One-line description, also listed with the warnings. */
  message: string;
  /** Short text for the marker in the 3D view. */
  label: string;
  /** When it starts and ends [s from liftoff]. */
  t: number;
  tEnd: number;
  /** Where it happens: the first contact point, the touchdown point, or the launch point. */
  point: V3;
  /** Collision only: the solid that is hit, and the deepest penetration [m]. */
  solid?: Solid;
  depth?: number;
  /** Hard landing: vertical speed [m/s] and peak tire load [× weight]; tilted landing: tilt from level [deg]. */
  speed?: number;
  load?: number;
  tiltDeg?: number;
  /** Collision: the phase it starts in (before liftoff, in flight, or after touchdown). */
  phase?: Phase;
}

export interface Timeline {
  params: Params;
  thrusters: Thruster[];
  inertia: V3;
  /** The ideal flight solution (the closed-loop flight's reference). */
  flight: FlightSolution;
  samples: Sample[];
  dt: number;
  events: Events;
  summary: Summary;
  warnings: string[];
  /** Collisions, hard landing, or no feasible flight — each with a time and place. */
  incidents: Incident[];
  obstacles: Obstacle[];
  /** Present for a closed-loop flight. */
  control?: ControlReport;
}

export const DT = 1 / 480;
const POST_STOP = 1.5;

/** Axis-aligned solids the car must clear: each parked vehicle (standing on the stage) and the stage. */
export const SOLIDS: Solid[] = [
  ...LINEUP.map((o) => ({
    label: o.label,
    x0: o.x - o.width / 2,
    x1: o.x + o.width / 2,
    z0: LINEUP_Z - o.length / 2,
    z1: LINEUP_Z + o.length / 2,
    bottom: STAGE.height,
    top: STAGE.height + o.height,
  })),
  { label: 'stage', x0: STAGE.x0, x1: STAGE.x1, z0: STAGE.z0, z1: STAGE.z1, bottom: 0, top: STAGE.height },
];
/**
 * The road, for incidents only: the body striking it (falling back, or rolling into it).
 * The fully compressed suspension just brings the body box to the road, so contact
 * counts from 1 cm in.
 */
const ROAD: Solid = {
  label: 'road',
  x0: -Infinity,
  x1: Infinity,
  z0: -Infinity,
  z1: Infinity,
  bottom: -Infinity,
  top: 0,
};
const ROAD_TOLERANCE = 0.01;
const RANGE_ITERATIONS = 5;
/** Peak tire load at touchdown, in multiples of the car's weight, above which it is a hard landing. */
export const HARD_LANDING_LOAD = 5;

/** Attitude-dependent drag: per-face CdA weighted by how squarely the airflow hits each face. */
export function dragForce(p: Params, vel: V3, R: M3): V3 {
  const speed = norm(vel);
  if (speed < 1e-6) return [0, 0, 0];
  const d = mulMtV(R, scale(vel, 1 / speed));
  const cda = p.cdaFront * Math.abs(d[0]) + p.cdaTop * Math.abs(d[1]) + p.cdaSide * Math.abs(d[2]);
  return scale(vel, -0.5 * p.airDensity * cda * speed);
}

/** Body angular velocity / acceleration for R = Ry(ψ)·Rx(φ). */
function bodyRates(phi: number, dphi: number, ddphi: number, dpsi: number, ddpsi: number) {
  const c = Math.cos(phi),
    s = Math.sin(phi);
  const omega: V3 = [dphi, dpsi * c, -dpsi * s];
  const alpha: V3 = [ddphi, ddpsi * c - dpsi * dphi * s, -ddpsi * s - dpsi * dphi * c];
  return { omega, alpha };
}

/**
 * The body box used for collisions, in the body frame: half-sizes and how far its center
 * sits above the CG (the CG sits low in the car; the floor is 0.12 m off the road).
 */
export function bodyBox(p: Params) {
  return { hx: p.length / 2, hy: p.height / 2, hz: p.width / 2, yOff: p.height / 2 - (p.cgHeight - 0.12) };
}

/** Lowest point of the rotated body box, and its X / Z extents in the world. */
function bodyBounds(p: Params, pos: V3, R: M3) {
  let minY = Infinity,
    minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  const { hx, hy, hz, yOff } = bodyBox(p);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const w = add(pos, mulMV(R, [sx * hx, sy * hy + yOff, sz * hz]));
        minY = Math.min(minY, w[1]);
        minX = Math.min(minX, w[0]);
        maxX = Math.max(maxX, w[0]);
        minZ = Math.min(minZ, w[2]);
        maxZ = Math.max(maxZ, w[2]);
      }
  return { minY, minX, maxX, minZ, maxZ };
}

/** Horizontal flight with drag only (no thrust along x), returning distance covered by touchdown. */
function flightDistance(p: Params, f: FlightSolution, v0: number, until = f.T): number {
  let x = 0,
    vx = v0;
  const ground = (t: number) => vertical(f.ground, p, t);
  for (let t = 0; t < until; t += DT) {
    const h = Math.min(DT, until - t);
    const s = flightState(f, p, t, ground);
    const r = roll(p, t);
    const D = dragForce(p, [vx, s.vy, s.vz], yawRollMatrix(0, r.angle));
    vx += (D[0] / p.mass) * h;
    x += vx * h;
  }
  return x;
}

export function computeTimeline(p: Params): Timeline {
  const thrusters = buildThrusters(p);
  const inertia = principalInertia(p);
  const flight = solveFlight(p);
  const groundAt = (t: number) => vertical(flight.ground, p, t);
  const warnings = [...flight.problems];
  const seat = driverSeat(p);
  const ve = p.isp * G0;
  const weight = p.mass * G0;
  const rw = rollWindow(p);
  if (flight.feasible && rw.end > flight.T)
    warnings.push('The roll is still under way at touchdown. Shorten it or start it earlier.');
  if (Math.abs(p.rollTurns - Math.round(p.rollTurns)) > 1e-6)
    warnings.push('A fractional roll lands the car on its side or roof.');

  // Choose the approach speed that covers the measured range by touchdown.
  const T = flight.feasible ? flight.T : 0;
  let v0 = flight.feasible ? p.range / T : p.range / Math.max(p.airTimeVideo / Math.max(p.footageSlowdown, 0.05), 0.5);
  if (flight.feasible) {
    for (let i = 0; i < RANGE_ITERATIONS; i++) v0 *= p.range / flightDistance(p, flight, v0);
  }
  // Place the apex at x = apexX (0 = directly over the Semi). With no feasible flight the
  // car can't lift off: it drives up as usual, brakes, and stops at the launch point (half
  // the range before the apex, but never inside the stage) by liftoff time.
  const grounded = !flight.feasible;
  const toApex = flight.feasible ? flightDistance(p, flight, v0, flight.tApex) : p.range / 2;
  const xLaunch = grounded ? Math.min(p.apexX - toApex, STAGE.x0 - p.length / 2 - 0.5) : p.apexX - toApex;
  const D = Math.max(p.approachDuration, 0.1);
  const approachDecel = grounded ? Math.max(p.brakingDecel, v0 / D) : 0;
  const brakeStart = grounded ? -v0 / approachDecel : 0; // when braking for the stop begins

  const tStart = -p.approachDuration;
  const samples: Sample[] = [];
  let x = grounded ? xLaunch - v0 * (brakeStart - tStart) - (v0 * v0) / (2 * approachDecel) : xLaunch + v0 * tStart;
  let vx = v0;
  let gasUsed = 0;
  let stopTime = NaN;
  const brakeTime = v0 / Math.max(p.brakingDecel, 0.1);
  const yawTotal = (p.driftYawDeg * Math.PI) / 180;
  const tEndEstimate = T + brakeTime + POST_STOP;

  for (let i = 0; ; i++) {
    const t = tStart + i * DT;
    if (t > tEndEstimate + 1e-9) break;
    const mass = p.mass - gasUsed;
    const airborne = flight.feasible && t >= 0 && t < T;
    const vs = flightState(flight, p, t, groundAt);
    const phase: Phase = vs.phase;
    const r = airborne
      ? roll(p, t)
      : { angle: flight.feasible && t >= T ? 2 * Math.PI * p.rollTurns : 0, rate: 0, accel: 0 };

    // Yaw: zero until touchdown, then the drift as the car brakes.
    let yaw = { angle: 0, rate: 0, accel: 0 };
    if (flight.feasible && t >= T) {
      const q = quintic((t - T) / brakeTime);
      yaw = {
        angle: yawTotal * q.s,
        rate: (yawTotal * q.ds) / brakeTime,
        accel: (yawTotal * q.dds) / (brakeTime * brakeTime),
      };
    }

    const R = yawRollMatrix(yaw.angle, r.angle);
    const vel: V3 = [vx, vs.vy, vs.vz];
    const drag = dragForce(p, vel, R);
    let ax: number;
    // Braking ends exactly at the stop: the last step only takes off the speed that is left.
    const brake = (decel: number) => (vx > 0 ? -Math.min(decel, vx / DT) : 0);
    if (airborne) ax = drag[0] / mass;
    else if (t < 0) ax = grounded && t >= brakeStart ? brake(approachDecel) : 0;
    else ax = brake(grounded ? approachDecel : p.brakingDecel);
    const acc: V3 = [ax, vs.ay, vs.az];
    const gravity: V3 = [0, -mass * G0, 0];
    const totalForce = scale(acc, mass);
    const external = sub(sub(totalForce, gravity), drag); // what thrusters or tires must supply

    const { omega, alpha } = bodyRates(r.angle, r.rate, r.accel, yaw.rate, yaw.accel);
    const Iw: V3 = [inertia[0] * omega[0], inertia[1] * omega[1], inertia[2] * omega[2]];
    const torque = add([inertia[0] * alpha[0], inertia[1] * alpha[1], inertia[2] * alpha[2]], cross(omega, Iw));
    const required: Wrench = { force: mulMtV(R, external), torque };

    let thrusterForces = thrusters.map(() => 0);
    let saturated: number[] = [];
    let residual = 0;
    let thrust: V3 = [0, 0, 0];
    let ground: V3 = [0, 0, 0];
    if (airborne) {
      const a = allocate(thrusters, required);
      thrusterForces = a.forces;
      saturated = a.saturated;
      residual = a.residual;
      thrust = mulMV(R, a.achieved.force);
    } else {
      ground = external;
    }
    const thrustSum = thrusterForces.reduce((s, f) => s + f, 0);

    // Specific force at the driver's seat: a_cg + α×r + ω×(ω×r) − g.
    const rel = add(cross(alpha, seat), cross(omega, cross(omega, seat)));
    const seatAcc = add(acc, mulMV(R, rel));
    const occupantG = norm(add(seatAcc, [0, G0, 0])) / G0;

    samples.push({
      t,
      phase,
      airborne,
      pos: [x, vs.y, vs.z],
      vel,
      acc,
      yaw: yaw.angle,
      roll: r.angle,
      R,
      omegaBody: omega,
      alphaBody: alpha,
      mass,
      gravity,
      drag,
      thrust,
      ground,
      required,
      thrusterForces,
      saturated,
      residual,
      gasUsed,
      occupantG,
      jetPower: 0.5 * thrustSum * ve,
    });

    // Advance horizontal state and gas (semi-implicit Euler).
    gasUsed += (thrustSum / ve) * DT;
    vx = Math.max(0, vx + ax * DT);
    if (t >= T && vx === 0 && Number.isNaN(stopTime)) stopTime = t;
    x += vx * DT;
  }

  const events: Events = {
    start: tStart,
    liftoff: 0,
    burnout: flight.tb,
    apex: flight.tApex,
    rollStart: rw.start,
    rollEnd: rw.end,
    landingBurn: flight.tLand,
    touchdown: T,
    stop: Number.isNaN(stopTime) ? T + brakeTime : stopTime,
    end: samples[samples.length - 1].t,
  };

  const minClear = flight.feasible
    ? findClearance(p, samples)
    : { value: Infinity, t: 0, obstacle: '', phase: 'approach' as Phase };
  const summary = summarize(p, samples, v0, weight, ve, minClear);
  // A grounded car can still have been driven into something on the approach.
  const incidents = findIncidents(p, samples, summary);
  if (grounded) {
    // No flight plan meets the settings, so the car stays at its launch point.
    incidents.push({
      kind: 'infeasible-plan',
      message: flight.problems[0] ?? 'No feasible flight with these settings.',
      label: 'No feasible flight',
      t: 0,
      tEnd: events.end,
      point: [xLaunch, 0, 0],
    });
    incidents.sort((a, b) => a.t - b.t);
  }
  warnings.push(
    ...checkWarnings(thrusters, samples, summary),
    ...incidents.filter((i) => i.kind !== 'infeasible-plan').map((i) => i.message),
  );
  return {
    params: p,
    thrusters,
    inertia,
    flight,
    samples,
    dt: DT,
    events,
    summary,
    warnings,
    incidents,
    obstacles: LINEUP,
  };
}

/**
 * Clearance over everything solid — the parked vehicles and the stage itself — in every
 * phase, so a short range that lifts off inside a vehicle's footprint or lands on the
 * stage is caught, not only mid-air contact.
 */
export function findClearance(
  p: Params,
  samples: Sample[],
): { value: number; t: number; obstacle: string; phase: Phase } {
  const minClear = { value: Infinity, t: 0, obstacle: '', phase: 'approach' as Phase };
  for (const s of samples) {
    const b = bodyBounds(p, s.pos, s.R);
    for (const o of SOLIDS) {
      if (b.maxX > o.x0 && b.minX < o.x1 && b.maxZ > o.z0 && b.minZ < o.z1 && b.minY - o.top < minClear.value) {
        minClear.value = b.minY - o.top;
        minClear.t = s.t;
        minClear.obstacle = o.label;
        minClear.phase = s.phase;
      }
    }
  }
  return minClear;
}

/**
 * The smallest gap between the car and each solid while the car is over it (null if the
 * car never passes over it), and when.
 */
export function clearanceBySolid(p: Params, samples: Sample[]) {
  return SOLIDS.map((o) => {
    let gap = Infinity,
      t = NaN;
    for (const s of samples) {
      const b = bodyBounds(p, s.pos, s.R);
      if (b.maxX > o.x0 && b.minX < o.x1 && b.maxZ > o.z0 && b.minZ < o.z1 && b.minY - o.top < gap) {
        gap = b.minY - o.top;
        t = s.t;
      }
    }
    return { solid: o, gap: Number.isFinite(gap) ? gap : null, t: Number.isFinite(gap) ? t : null };
  });
}

/** Thruster-rating warnings for a finished set of samples. */
export function checkWarnings(
  thrusters: Thruster[],
  samples: Sample[],
  summary: Summary,
  closedLoop = false,
): string[] {
  const warnings: string[] = [];
  if (summary.peakThruster.value > 0) {
    const sat = new Set<number>();
    samples.forEach((s) => s.saturated.forEach((j) => sat.add(j)));
    if (sat.size) {
      const ids = [...sat].map((j) => thrusters[j].id).join(', ');
      const rating = (Math.max(...[...sat].map((j) => thrusters[j].maxForce)) / 1000).toPrecision(4);
      const peak = (summary.peakThruster.value / 1000).toPrecision(4);
      warnings.push(
        closedLoop
          ? // The controller's commands are held at the rating; the output scatters around them.
            `Over rated force: the controller asked ${ids} for more than their ${rating} kN rating (commands are held at the rating; with output scatter the busiest nozzle delivered ${peak} kN).`
          : `Over rated force: the flight needs up to ${peak} kN from ${ids}, more than their ${rating} kN rating.`,
      );
    }
  }
  return warnings;
}

/** "0.62 s before liftoff", "at +0.51 s", or "at +3.29 s, after touchdown". */
export function whenText(t: number, phase?: Phase): string {
  if (phase === 'approach' || (phase === undefined && t < 0)) return `${Math.abs(t).toFixed(2)} s before liftoff`;
  const at = `at ${t < 0 ? '−' : '+'}${Math.abs(t).toFixed(2)} s`;
  return phase && ['touchdown', 'settle', 'slide'].includes(phase) ? `${at}, after touchdown` : at;
}

/**
 * Collisions and a hard landing, each with when and where it happens. A collision is a
 * stretch of samples in which the body box is inside a solid (a parked vehicle, the
 * stage, or the road): it starts where the car first touches (the marker goes there)
 * and reports the deepest penetration, at most the solid's own height.
 */
export function findIncidents(p: Params, samples: Sample[], summary: Summary): Incident[] {
  const incidents: Incident[] = [];
  const bounds = samples.map((s) => bodyBounds(p, s.pos, s.R));
  for (const o of [...SOLIDS, ROAD]) {
    const tolerance = o === ROAD ? ROAD_TOLERANCE : 0;
    let open: Incident | null = null;
    samples.forEach((s, k) => {
      // While the suspension compresses and settles, the wheels carry the car: the rigid
      // body box would dip as deep as the suspension travel, which is not the body hitting the road.
      if (o === ROAD && (s.phase === 'touchdown' || s.phase === 'settle')) {
        open = null;
        return;
      }
      const b = bounds[k];
      const overlaps = b.maxX > o.x0 && b.minX < o.x1 && b.maxZ > o.z0 && b.minZ < o.z1;
      const depth = overlaps ? Math.min(o.top - b.minY, o.top - o.bottom) : -Infinity;
      if (depth <= tolerance) {
        open = null;
        return;
      }
      if (!open) {
        const point: V3 = [
          (Math.max(b.minX, o.x0) + Math.min(b.maxX, o.x1)) / 2,
          o.top,
          (Math.max(b.minZ, o.z0) + Math.min(b.maxZ, o.z1)) / 2,
        ];
        open = {
          kind: 'collision',
          message: '',
          label: `Hits the ${o.label}`,
          t: s.t,
          tEnd: s.t,
          point,
          solid: o,
          depth: 0,
          phase: s.phase,
        };
        incidents.push(open);
      }
      open.tEnd = s.t;
      open.depth = Math.max(open.depth!, depth);
    });
  }
  for (const c of incidents) {
    c.message = `Collision: the car hits the ${c.solid!.label} ${whenText(c.t, c.phase)}, up to ${c.depth!.toFixed(2)} m deep.`;
  }
  // Hard landing: the suspension has to stop the descent within its travel, so the tire
  // load grows with the square of the touchdown speed.
  const last = samples.filter((s) => s.airborne).at(-1);
  const loadFactor = last ? summary.touchdownLoad / (last.mass * G0) : 0; // weight at touchdown
  if (last && loadFactor > HARD_LANDING_LOAD) {
    const vt = Math.max(-last.vel[1], 0);
    const t = last.t + DT;
    incidents.push({
      kind: 'hard-landing',
      message: `Hard landing: ${vt.toFixed(1)} m/s at touchdown puts ${loadFactor.toFixed(2)} × the car's weight on the tires (more than ${HARD_LANDING_LOAD} ×).`,
      label: `Hard landing · ${vt.toFixed(1)} m/s`,
      t,
      tEnd: t + 0.15,
      point: [last.pos[0], 0, last.pos[2]],
      speed: vt,
      load: loadFactor,
    });
  }
  return incidents.sort((a, b) => a.t - b.t);
}

export function summarize(
  p: Params,
  samples: Sample[],
  v0: number,
  weight: number,
  ve: number,
  minClear: { value: number; t: number; obstacle: string },
): Summary {
  const peak = (f: (s: Sample) => number): Peak =>
    samples.reduce<Peak>(
      (best, s) => {
        const v = f(s);
        return v > best.value ? { value: v, t: s.t } : best;
      },
      { value: 0, t: 0 },
    );

  const peakThrust = peak((s) => norm(s.thrust));
  let peakThruster = { value: 0, t: 0, index: 0 };
  let totalImpulse = 0;
  let weightless = 0;
  let maxResidual = 0;
  let touchdownLoad = 0;
  for (const s of samples) {
    s.thrusterForces.forEach((f, j) => {
      if (f > peakThruster.value) peakThruster = { value: f, t: s.t, index: j };
      totalImpulse += f * DT;
    });
    if (s.airborne && s.occupantG < 0.1) weightless += DT;
    maxResidual = Math.max(maxResidual, s.residual);
    if (s.phase === 'touchdown' || s.phase === 'settle') touchdownLoad = Math.max(touchdownLoad, s.ground[1]);
  }
  const gasMass = samples[samples.length - 1].gasUsed;
  const density = (p.tankPressure * N2_MOLAR_MASS) / (N2_COMPRESSIBILITY * GAS_CONSTANT * TANK_TEMPERATURE);
  const tankVolume = gasMass / (density * p.usableFraction);
  const rise = p.apexHeight - p.cgHeight;
  const noBurnSpeed = Math.sqrt(2 * G0 * Math.max(rise, 0));
  const travel = Math.max(p.suspensionTravel, 0.01);

  return {
    approachSpeed: v0,
    weight,
    peakThrust,
    peakThrustToWeight: peakThrust.value / weight,
    launchThrust: peak((s) => (s.phase === 'launch' ? norm(s.thrust) : 0)).value,
    landingThrust: peak((s) => (s.phase === 'landing' ? norm(s.thrust) : 0)).value,
    peakThruster,
    peakRollTorque: peak((s) => (s.airborne ? Math.abs(s.required.torque[0]) : 0)),
    peakRollRate: peak((s) => Math.abs(s.omegaBody[0])),
    peakLateralThrust: peak((s) => Math.abs(s.thrust[2])),
    totalImpulse,
    gasMass,
    tankVolumeLiters: tankVolume * 1000,
    tankMass: (p.tankPressure * tankVolume) / p.copvPerformance,
    peakOccupantG: peak((s) => s.occupantG),
    weightlessTime: weightless,
    minClearance: Number.isFinite(minClear.value) ? minClear : { value: NaN, t: 0, obstacle: '—' },
    touchdownLoad,
    noBurnImpactSpeed: noBurnSpeed,
    noBurnImpactLoad: p.mass * (G0 + (noBurnSpeed * noBurnSpeed) / (2 * travel)),
    peakJetPower: peak((s) => s.jetPower),
    exhaustVelocity: ve,
    maxResidual,
  };
}
