import { G0, type Params } from './params';

export type Phase = 'approach' | 'launch' | 'coast' | 'landing' | 'touchdown' | 'settle' | 'slide';

/**
 * Analytic vertical profile with a ballistic coast. The flight itself is now
 * thrust-driven (flight.ts); this profile supplies the touchdown and suspension phases,
 * and is the sustained-thrust-free limit of that model. Real time, t = 0 at liftoff.
 *
 *   launch   0 → tb        constant upward acceleration (launch burn)
 *   coast    tb → ts       ballistic, through the apex
 *   landing  ts → T        constant upward acceleration (braking burn) down to −vt
 *   touchdown              suspension absorbs vt over its travel
 *   settle                 suspension returns to ride height
 */
export interface VerticalProfile {
  feasible: boolean;
  problems: string[];
  tb: number;
  a1: number;
  v1: number;
  y1: number;
  tApex: number;
  ts: number;
  ys: number;
  vs: number;
  a3: number;
  T: number;
  vt: number;
  aComp: number;
  tComp: number;
  tSettle: number;
}

export interface VerticalState {
  y: number;
  vy: number;
  ay: number;
  phase: Phase;
}

const SETTLE_TIME = 0.35;

export function solveVertical(p: Params): VerticalProfile {
  const g = G0;
  const k = Math.max(p.footageSlowdown, 0.05);
  const problems: string[] = [];
  const tb = Math.max(p.launchBurnVideo / k, 0.02);
  const T = p.airTimeVideo / k;
  const rise = p.apexHeight - p.cgHeight;
  const vt = Math.max(p.touchdownSpeed, 0);

  // ½·a1·tb² + (a1·tb)²/2g = rise  →  a1 = g/2·(√(1 + 8·rise/(g·tb²)) − 1)
  const a1 = rise > 0 ? (g / 2) * (Math.sqrt(1 + (8 * rise) / (g * tb * tb)) - 1) : 0;
  const v1 = a1 * tb;
  const y1 = p.cgHeight + 0.5 * a1 * tb * tb;
  const tApex = tb + v1 / g;
  if (rise <= 0) problems.push('Apex height must be above the ride-height CG.');

  // Coast down for u seconds, then brake for tl = c − u, reaching −vt at y0 exactly at T.
  const c = T - tApex;
  let u = NaN;
  let tl = NaN;
  let a3 = NaN;
  if (c <= 0) {
    problems.push(`Air time ${T.toFixed(2)} s is shorter than the climb to the apex (${tApex.toFixed(2)} s).`);
  } else {
    const denom = g * c - vt;
    u = denom > 1e-9 ? (2 * rise - vt * c) / denom : NaN;
    tl = c - u;
    a3 = tl > 1e-9 ? (g * u - vt) / tl : NaN;
    const freeFall = Math.sqrt((2 * rise) / g);
    if (!(tl > 0)) {
      problems.push(
        `Descent in ${c.toFixed(2)} s is faster than free fall (${freeFall.toFixed(2)} s), so it would need downward thrust. Lower the apex or lengthen the air time.`,
      );
    } else if (!(u >= 0)) {
      problems.push(
        'Air time too long for this apex: the car would have to hover. Raise the apex or shorten the air time.',
      );
    } else if (!(a3 > 0)) {
      problems.push('Touchdown speed is higher than the free-fall speed, so no braking burn is needed or possible.');
    }
  }
  const ts = tApex + (Number.isFinite(u) ? u : 0);
  const coastDown = ts - tApex;
  const ys = p.apexHeight - 0.5 * g * coastDown * coastDown;
  const vs = -g * coastDown;
  const travel = Math.max(p.suspensionTravel, 0.01);
  const aComp = vt > 1e-6 ? (vt * vt) / (2 * travel) : 0;
  const tComp = vt > 1e-6 ? vt / aComp : 0;

  return {
    feasible: problems.length === 0,
    problems,
    tb,
    a1,
    v1,
    y1,
    tApex,
    ts,
    ys,
    vs,
    a3,
    T,
    vt,
    aComp,
    tComp,
    tSettle: SETTLE_TIME,
  };
}

export function vertical(v: VerticalProfile, p: Params, t: number): VerticalState {
  const g = G0;
  const y0 = p.cgHeight;
  if (t < 0) return { y: y0, vy: 0, ay: 0, phase: 'approach' };
  if (t < v.tb) return { y: y0 + 0.5 * v.a1 * t * t, vy: v.a1 * t, ay: v.a1, phase: 'launch' };
  if (t < v.ts) {
    const tau = t - v.tb;
    return { y: v.y1 + v.v1 * tau - 0.5 * g * tau * tau, vy: v.v1 - g * tau, ay: -g, phase: 'coast' };
  }
  if (t < v.T) {
    const tau = t - v.ts;
    return { y: v.ys + v.vs * tau + 0.5 * v.a3 * tau * tau, vy: v.vs + v.a3 * tau, ay: v.a3, phase: 'landing' };
  }
  const tc = t - v.T;
  if (tc < v.tComp) {
    return { y: y0 - v.vt * tc + 0.5 * v.aComp * tc * tc, vy: -v.vt + v.aComp * tc, ay: v.aComp, phase: 'touchdown' };
  }
  const travel = v.vt > 1e-6 ? (v.vt * v.vt) / (2 * v.aComp) : 0;
  const tr = tc - v.tComp;
  if (tr < v.tSettle && travel > 0) {
    const w = Math.PI / v.tSettle;
    return {
      y: y0 - (travel * (1 + Math.cos(w * tr))) / 2,
      vy: (travel * w * Math.sin(w * tr)) / 2,
      ay: (travel * w * w * Math.cos(w * tr)) / 2,
      phase: 'settle',
    };
  }
  return { y: y0, vy: 0, ay: 0, phase: 'slide' };
}

export interface AngleState {
  angle: number;
  rate: number;
  accel: number;
}

/**
 * Barrel roll about the body's long axis, shaped like the footage: a gentle spin-up, a
 * near-constant roll rate, a hard stop that carries the car a few degrees past level
 * (the overshoot), then a quick correction back to level before landing (0:20–0:21).
 *
 *   spin-up  r1 s   rate eases in along a half cosine
 *   cruise          constant rate
 *   stop     r2 s   rate eases out, ending `overshoot` past the full turn
 *   settle   S s    rolls back the overshoot along a half cosine
 *
 * `rollDurationVideo` runs from the start to the peak of the overshoot.
 */
export function roll(p: Params, t: number): AngleState {
  const k = Math.max(p.footageSlowdown, 0.05);
  const start = p.rollStartVideo / k;
  const D = Math.max(p.rollDurationVideo / k, 0.05);
  const r1 = Math.min(Math.max(p.rollRampVideo / k, 1e-3), D * 0.9);
  const r2 = Math.min(Math.max(p.rollStopVideo / k, 1e-3), D - r1);
  const S = Math.max(p.rollSettleVideo / k, 1e-3);
  const total = 2 * Math.PI * p.rollTurns;
  const over = Math.sign(total) * ((p.rollOvershootDeg * Math.PI) / 180);
  const peak = total + over;
  const w0 = peak / (D - (r1 + r2) / 2); // cruise roll rate
  const u = t - start;
  // Angle covered x seconds into a ramp of length r, and the rate and acceleration there.
  const ramp = (x: number, r: number) => ({
    angle: w0 * (x / 2 - (r / (2 * Math.PI)) * Math.sin((Math.PI * x) / r)),
    rate: (w0 * (1 - Math.cos((Math.PI * x) / r))) / 2,
    accel: ((w0 * Math.PI) / (2 * r)) * Math.sin((Math.PI * x) / r),
  });
  if (u <= 0) return { angle: 0, rate: 0, accel: 0 };
  if (u < r1) return ramp(u, r1);
  if (u <= D - r2) return { angle: (w0 * r1) / 2 + w0 * (u - r1), rate: w0, accel: 0 };
  if (u < D) {
    const down = ramp(D - u, r2); // mirror of a spin-up
    return { angle: peak - down.angle, rate: down.rate, accel: -down.accel };
  }
  if (u < D + S) {
    const x = (Math.PI * (u - D)) / S;
    return {
      angle: total + (over * (1 + Math.cos(x))) / 2,
      rate: (-over * Math.PI * Math.sin(x)) / (2 * S),
      accel: (-over * Math.PI * Math.PI * Math.cos(x)) / (2 * S * S),
    };
  }
  return { angle: total, rate: 0, accel: 0 };
}

/** From the roll's start until the car is level again (after the overshoot correction). */
export function rollWindow(p: Params): { start: number; end: number } {
  const k = Math.max(p.footageSlowdown, 0.05);
  const start = p.rollStartVideo / k;
  const settle = p.rollOvershootDeg > 0 ? Math.max(p.rollSettleVideo / k, 0) : 0;
  return { start, end: start + Math.max(p.rollDurationVideo / k, 0.05) + settle };
}
