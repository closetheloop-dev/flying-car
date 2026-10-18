import { G0, type Params } from './params';
import { roll, solveVertical, type Phase, type VerticalProfile } from './profile';
import { buildThrusters, principalInertia } from './vehicle';

/**
 * Thrust-driven flight, as the footage shows it: the lift jets fire along the car's
 * own down axis for the whole hop, so the push they give rotates with the barrel roll —
 * up while upright, toward the line-up's noses while the roof faces them (that is the
 * sideways drift), and down while inverted.
 *
 * The lift-jet throttle is specified as specific force along body-up (in g):
 *   launch   0 → tb         k1   (solved so the CG apex reaches `apexHeight`)
 *   sustain  tb → tLand     k2 = `sustainThrustG`, plus `invertedThrustG` while
 *                                 upside down (pushing the car back down)
 *   landing  tLand → T      k3   (tLand and k3 solved for a soft touchdown at
 *                                 y = cgHeight, vy = −touchdownSpeed, at T = air time)
 * The car rolls by firing its left and right lift thrusters unevenly, so a roll torque τ
 * needs at least |τ| / (lever arm) of total lift. Wherever the roll speeds up or stops
 * faster than the scheduled thrust allows, the lift is raised to that minimum
 * (`rollLiftG`) — the strong down-jets at the start of the roll and during the landing
 * correction in the footage.
 * Height and sideways position follow by integrating gravity and this thrust. (Drag on
 * the vertical and sideways motion is a few newtons and is left to the force
 * allocation in the timeline, which balances it with the nozzles.) The roll itself is
 * still prescribed (fitted to the footage); its torque comes from the attitude nozzles.
 * Forward motion is drag-only, handled in the timeline.
 */
export interface FlightSolution {
  feasible: boolean;
  problems: string[];
  /** Launch, landing-burn throttles [g] and timings [s]. */
  k1: number;
  k2: number;
  k3: number;
  tb: number;
  tLand: number;
  T: number;
  tApex: number;
  apex: number;
  /** Sideways position and speed at touchdown [m, m/s]. */
  zTouchdown: number;
  vzTouchdown: number;
  /** Profile for the ground phases after touchdown (suspension). */
  ground: VerticalProfile;
  dt: number;
  y: Float64Array;
  vy: Float64Array;
  ay: Float64Array;
  z: Float64Array;
  vz: Float64Array;
  az: Float64Array;
}

export interface FlightState {
  y: number;
  vy: number;
  ay: number;
  z: number;
  vz: number;
  az: number;
  phase: Phase;
}

const DT = 1 / 960;
/**
 * The hardest landing burn a plan may use [× the car's weight]: the tire load that counts
 * as a hard landing (HARD_LANDING_LOAD in timeline.ts). A burn harder than the impact it
 * prevents defeats its purpose; without a limit, plans at the edge of feasibility called
 * for burns of tens of g in the last few hundredths of a second.
 */
export const MAX_LANDING_BURN_G = 5;

interface Seg {
  y: number;
  vy: number;
  z: number;
  vz: number;
}

/** Sideways and vertical specific force [m/s²] from body-up thrust k (in g) at roll φ, plus gravity. */
function accel(k: number, phi: number): [number, number] {
  return [k * G0 * Math.cos(phi) - G0, k * G0 * Math.sin(phi)];
}

/**
 * Minimum lift [g] for the roll at time t: torque I·α delivered by a left/right thrust
 * difference across the lift thrusters' lever arm (with a 5% margin).
 */
export function rollLiftG(p: Params, t: number): number {
  // Cached on the values it depends on, not the object: callers may change a Params
  // object in place between runs. (One entry, compared field by field: this runs every step.)
  const k = rollLiftCache;
  if (
    k.mass !== p.mass ||
    k.length !== p.length ||
    k.width !== p.width ||
    k.height !== p.height ||
    k.cgHeight !== p.cgHeight ||
    k.inertiaScale !== p.inertiaScale
  ) {
    const lever = Math.min(
      ...buildThrusters(p)
        .filter((x) => x.group === 'lift')
        .map((x) => Math.abs(x.position[2])),
    );
    Object.assign(k, {
      mass: p.mass,
      length: p.length,
      width: p.width,
      height: p.height,
      cgHeight: p.cgHeight,
      inertiaScale: p.inertiaScale,
      factor: (1.05 * principalInertia(p)[0]) / (lever * p.mass * G0),
    });
  }
  return k.factor * Math.abs(roll(p, t).accel);
}
/**
 * Extra lift [g] fired while the car is upside down, which pushes it back down: full
 * `invertedThrustG` when inverted, fading to none at 90° of roll. It is symmetric about
 * inverted, so its sideways push on the way into and out of the inversion cancels.
 */
function invertedG(p: Params, phi: number): number {
  return Math.max(p.invertedThrustG, 0) * Math.max(0, -Math.cos(phi));
}

/** Factor I / (lever · m · g) for the last vehicle geometry and mass seen. */
const rollLiftCache = {
  mass: NaN,
  length: NaN,
  width: NaN,
  height: NaN,
  cgHeight: NaN,
  inertiaScale: NaN,
  factor: NaN,
};

/** Integrate from state s at time t0 to t1 with throttle k(t); semi-implicit Euler. */
function integrate(
  p: Params,
  s: Seg,
  t0: number,
  t1: number,
  k: (t: number) => number,
  rec?: (i: number, s: Seg, ay: number, az: number) => void,
  i0 = 0,
): Seg {
  let { y, vy, z, vz } = s;
  const n = Math.max(0, Math.round((t1 - t0) / DT));
  for (let i = 0; i < n; i++) {
    const t = t0 + i * DT;
    const phi = roll(p, t).angle;
    const [ay, az] = accel(Math.max(k(t) + invertedG(p, phi), rollLiftG(p, t)), phi);
    rec?.(i0 + i, { y, vy, z, vz }, ay, az);
    vy += ay * DT;
    vz += az * DT;
    y += vy * DT;
    z += vz * DT;
  }
  return { y, vy, z, vz };
}

function bisect(f: (x: number) => number, lo: number, hi: number, iters = 50): number {
  let flo = f(lo);
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

export function solveFlight(p: Params): FlightSolution {
  const ground = solveVertical(p); // only its touchdown/settle phases are used
  const k = Math.max(p.footageSlowdown, 0.05);
  const T = p.airTimeVideo / k;
  // On the step grid, so the solve and the final run switch throttle on the same step.
  const tb = Math.round(Math.max(p.launchBurnVideo / k, 0.02) / DT) * DT;
  const k2 = Math.max(p.sustainThrustG, 0);
  const vt = Math.max(p.touchdownSpeed, 0);
  const y0 = p.cgHeight;
  const start: Seg = { y: y0, vy: 0, z: 0, vz: 0 };
  const problems: string[] = [];

  // Peak height of the coast (no landing burn) for a launch throttle k1.
  const coastApex = (k1: number) => {
    let peak = y0,
      tPeak = 0;
    const s1 = integrate(p, start, 0, tb, () => k1);
    integrate(
      p,
      s1,
      tb,
      T,
      () => k2,
      (i, s) => {
        if (s.y > peak) {
          peak = s.y;
          tPeak = tb + i * DT;
        }
      },
    );
    return { peak, tPeak };
  };
  let k1 = NaN;
  if (p.apexHeight <= y0) problems.push('Apex height must be above the ride-height CG.');
  else if (coastApex(40).peak < p.apexHeight)
    problems.push('Apex is out of reach even at 40 g of launch thrust. Lengthen the launch burn.');
  else k1 = bisect((x) => coastApex(x).peak - p.apexHeight, 1, 40);

  const empty = new Float64Array(0);
  const fail = (): FlightSolution => ({
    feasible: false,
    problems,
    k1,
    k2,
    k3: NaN,
    tb,
    tLand: NaN,
    T,
    tApex: NaN,
    apex: NaN,
    zTouchdown: 0,
    vzTouchdown: 0,
    ground,
    dt: DT,
    y: empty,
    vy: empty,
    ay: empty,
    z: empty,
    vz: empty,
    az: empty,
  });
  if (!Number.isFinite(k1)) return fail();
  const { tPeak } = coastApex(k1);

  // Coast states (launch + sustain, no landing burn) at every step, to start burns from.
  const nT = Math.round(T / DT);
  const coast: Seg[] = []; // filled in step order, 0 to nT
  let s = integrate(
    p,
    start,
    0,
    tb,
    () => k1,
    (i, st) => (coast[i] = st),
  );
  s = integrate(
    p,
    s,
    tb,
    T,
    () => k2,
    (i, st) => (coast[i] = st),
    Math.round(tb / DT),
  );
  coast[nT] = s;

  // Landing burn from step iL with throttle k3: height and vertical speed at T.
  const land = (iL: number, k3: number) => integrate(p, coast[iL], iL * DT, T, () => k3);
  // For a burn start, the throttle that puts the car at ride height exactly at T.
  const k3For = (iL: number) => {
    const f = (x: number) => land(iL, x).y - y0;
    if (f(0) > 0) return NaN; // still above ride height at T without braking: air time too long
    if (f(MAX_LANDING_BURN_G) < 0) return NaN; // can't stop in time within the limit
    return bisect(f, 0, MAX_LANDING_BURN_G, 32); // 5 g / 2³² ≈ 1e-9 g
  };
  // Search the burn start (after the apex — braking on the way up is not a landing burn)
  // so the touchdown speed equals vt. Starts earlier in the descent can also satisfy that,
  // with a weak burn fired while the car is still rolling, which pushes it sideways; the
  // landing burn is the latest one that does.
  // Scanning back from touchdown, the first sign change of the speed error between
  // consecutive feasible starts brackets it, so the scan stops there.
  const iMin = Math.max(Math.round(tb / DT), Math.round(tPeak / DT)) + 1;
  type Cand = { iL: number; k3: number; err: number };
  const candidate = (iL: number): Cand | null => {
    const k3 = k3For(iL);
    return Number.isFinite(k3) ? { iL, k3, err: land(iL, k3).vy + vt } : null; // err = 0 when touchdown speed = vt
  };
  const cands: Cand[] = [];
  let best: Cand | null = null;
  let bracket: [number, number] | null = null;
  const SCAN = 12; // coarse step of the scan; the bracket is then refined step by step
  for (let iL = iMin + SCAN * Math.floor((nT - 3 - iMin) / SCAN); iL >= iMin; iL -= SCAN) {
    const c = candidate(iL);
    if (!c) continue;
    const later = cands.at(-1);
    cands.push(c);
    if (later && Math.sign(c.err) !== Math.sign(later.err)) {
      best = Math.abs(c.err) < Math.abs(later.err) ? c : later;
      bracket = [c.iL, later.iL];
      break;
    }
  }
  // No bracket: the closest miss (rejected below unless it is close enough).
  if (!best) for (const c of cands) if (!best || Math.abs(c.err) < Math.abs(best.err)) best = c;
  // Refine the burn start step by step within the bracket (or around the closest miss)
  // before judging it: the coarse starts on either side of a bracket can both be well off
  // while the step between them is right, and judging first made feasibility flicker on
  // and off as a setting moved by a few thousandths.
  if (best) {
    const [lo, hi] = bracket ?? [best.iL - SCAN, best.iL + SCAN];
    for (let iL = Math.max(iMin, lo); iL <= hi && iL < nT - 2; iL++) {
      const c = candidate(iL);
      if (c && Math.abs(c.err) < Math.abs(best.err)) best = c;
    }
  }
  if (!best || Math.abs(best.err) > 0.3) {
    problems.push(
      coast[nT].y > y0
        ? `Air time ${T.toFixed(2)} s is too short: the car is still airborne then even with no landing burn (nothing can push it down). Lengthen the air time, or lower the apex or the sustained thrust.`
        : `No landing burn of up to ${MAX_LANDING_BURN_G} × the car's weight gives a soft touchdown at ${T.toFixed(2)} s: the car comes down too early, or too fast to stop in time. Adjust the air time against the apex (a higher apex needs a longer one), or raise the sustained thrust.`,
    );
    return fail();
  }
  const tLand = best.iL * DT;
  const k3 = best.k3;

  // Final trajectory, recorded at every step.
  const y = new Float64Array(nT + 1),
    vy = new Float64Array(nT + 1),
    ay = new Float64Array(nT + 1);
  const z = new Float64Array(nT + 1),
    vz = new Float64Array(nT + 1),
    az = new Float64Array(nT + 1);
  const thr = (t: number) => (t + 1e-9 < tb ? k1 : t + 1e-9 < tLand ? k2 : k3);
  const rec = (i: number, st: Seg, a1: number, a2: number) => {
    y[i] = st.y;
    vy[i] = st.vy;
    ay[i] = a1;
    z[i] = st.z;
    vz[i] = st.vz;
    az[i] = a2;
  };
  const end = integrate(p, start, 0, T, thr, rec);
  y[nT] = end.y;
  vy[nT] = end.vy;
  z[nT] = end.z;
  vz[nT] = end.vz;
  [ay[nT], az[nT]] = accel(Math.max(k3 + invertedG(p, roll(p, T).angle), rollLiftG(p, T)), roll(p, T).angle);

  if (Math.abs(end.vz) > 1)
    problems.push(`The car is still sliding sideways at ${Math.abs(end.vz).toFixed(1)} m/s at touchdown.`);
  // Ground phases reuse the analytic suspension model with the actual touchdown speed.
  const vtActual = Math.max(-end.vy, 0);
  const travel = Math.max(p.suspensionTravel, 0.01);
  const aComp = vtActual > 1e-6 ? (vtActual * vtActual) / (2 * travel) : 0;
  const groundVt = { ...ground, T, vt: vtActual, aComp, tComp: vtActual > 1e-6 ? vtActual / aComp : 0 };

  return {
    feasible: problems.length === 0,
    problems,
    k1,
    k2,
    k3,
    tb,
    tLand,
    T,
    tApex: tPeak,
    apex: p.apexHeight,
    zTouchdown: end.z,
    vzTouchdown: end.vz,
    ground: groundVt,
    dt: DT,
    y,
    vy,
    ay,
    z,
    vz,
    az,
  };
}

/** Vertical and sideways state at time t (liftoff = 0). After touchdown: suspension, then rest. */
export function flightState(
  f: FlightSolution,
  p: Params,
  t: number,
  groundState: (t: number) => { y: number; vy: number; ay: number; phase: Phase },
): FlightState {
  if (t < 0 || !f.feasible) return { y: p.cgHeight, vy: 0, ay: 0, z: 0, vz: 0, az: 0, phase: 'approach' };
  if (t >= f.T) {
    const g = groundState(t);
    return { ...g, z: f.zTouchdown, vz: 0, az: 0 };
  }
  const x = t / f.dt;
  // The epsilon keeps sample times that land on a step (e.g. 0.55 s → 527.9999) on that
  // step, so a phase change uses the new acceleration from its first step.
  const i = Math.min(Math.floor(x + 1e-6), f.y.length - 2);
  const u = x - i;
  const lerp = (a: Float64Array) => a[i] + (a[i + 1] - a[i]) * u;
  const ts = i * f.dt + 1e-9; // phase of the step being taken, as in the integration
  const phase: Phase = ts < f.tb ? 'launch' : ts < f.tLand ? 'coast' : 'landing';
  return { y: lerp(f.y), vy: lerp(f.vy), ay: f.ay[i], z: lerp(f.z), vz: lerp(f.vz), az: f.az[i], phase };
}
