import { G0 } from './params';
import type { FlightMode } from './settings';
import { norm } from './math';
import { clearanceBySolid, type Incident, type Sample, type Timeline } from './timeline';

const r = (v: number, digits = 3) => (Number.isFinite(v) ? Number(v.toPrecision(digits + 1)) : null);

/** An incident as plain data (SI units, times from liftoff). */
function incidentData(i: Incident) {
  return {
    kind: i.kind,
    message: i.message,
    t_s: r(i.t),
    tEnd_s: r(i.tEnd),
    where_m: i.point.map((v) => r(v)),
    ...(i.solid ? { hits: i.solid.label, depth_m: r(i.depth!) } : {}),
    ...(i.speed !== undefined ? { speed_mps: r(i.speed) } : {}),
  };
}

/**
 * A run's results as plain data, for tools and scripts: whether it is valid (and if not,
 * what goes wrong, when and where), and the headline forces, gas and loads. SI units,
 * named in each key (N, kg, m, s, m/s, W, g = multiples of standard gravity); times are
 * from liftoff.
 */
export function runReport(tl: Timeline, model: FlightMode) {
  const f = tl.flight,
    e = tl.events;
  const airborne = tl.samples.filter((x) => x.airborne);
  const last = airborne.at(-1);
  const landed = tl.samples.find((x) => x.t >= e.touchdown) ?? tl.samples[tl.samples.length - 1];
  const apex = airborne.reduce((a, b) => (b.pos[1] > a.pos[1] ? b : a), airborne[0] ?? tl.samples[0]);
  const weight = tl.params.mass * G0;
  // A flight that can't climb or never lands is not a flight, even if the plan was feasible.
  const flies =
    f.feasible &&
    !tl.incidents.some((i) => i.kind === 'infeasible-plan' || i.kind === 'no-flight' || i.kind === 'no-landing');
  const figures = flightFigures(tl, weight, apex, last, landed);
  return {
    flightModel: model,
    /**
     * In the ideal model the forces are what the fitted flight requires; in the closed-loop
     * model they are what the thrusters actually delivered while the controller flew it.
     */
    forces: model === 'ideal' ? 'required by the ideal flight' : 'delivered in the closed-loop flight',
    /** True when the run has no problems at all (no incidents, no warnings). */
    valid: flies && tl.incidents.length === 0 && tl.warnings.length === 0,
    /** A flight happens: the plan is feasible and the car lifts off and lands. */
    flies,
    /** The ideal plan for these settings exists (the closed-loop flight may still fail). */
    planFeasible: f.feasible,
    incidents: tl.incidents.map(incidentData),
    warnings: tl.warnings.filter((w) => !tl.incidents.some((i) => i.message === w)),
    // Without a feasible plan there is no flight to describe: the same keys, all null.
    ...(f.feasible ? figures : (Object.fromEntries(Object.keys(figures).map((k) => [k, null])) as NullFigures)),
    /** How the controller flew it against the ideal plan; null in the ideal model, or when nothing was flown. */
    closedLoop: tl.control
      ? {
          touchdownTilt_deg: r(tl.control.touchdownTiltDeg),
          landingErrorVsIdeal_m: tl.control.landingError.map((v) => r(v)),
          maxPathErrorVsIdeal_m: r(tl.control.maxPosError),
          maxAttitudeErrorVsIdeal_deg: r(tl.control.maxAttError),
          gasVsIdeal_kg: r(tl.control.extraGas),
          valvePulses: tl.control.pulses,
        }
      : null,
    /**
     * Times from liftoff. Burn and roll times and the apex are the plan's; touchdown and
     * stop are as flown. Null for what doesn't happen (e.g. no feasible flight).
     */
    events_s: Object.fromEntries(
      Object.entries(e).map(([k, v]) => [k, f.feasible || k === 'start' || k === 'end' ? r(v) : null]),
    ),
    eventsNote:
      "events_s: burnout, apex, roll and landing-burn times are the plan's; touchdown and stop are as flown (if the car never flies, the plan's times did not happen).",
  };
}

type Figures = ReturnType<typeof flightFigures>;
type NullFigures = { [K in keyof Figures]: null };

/** The flight's headline forces, gas, loads and clearances (meaningful only for a feasible plan). */
function flightFigures(tl: Timeline, weight: number, apex: Sample, last: Sample | undefined, landed: Sample) {
  const s = tl.summary,
    f = tl.flight,
    e = tl.events;
  return {
    peakThrust_N: r(s.peakThrust.value),
    launch: { thrust_N: r(s.launchThrust), thrustToWeight: r(s.launchThrust / weight), burn_s: r(f.tb) },
    apex: { height_m: r(apex.pos[1]), t_s: r(apex.t), x_m: r(apex.pos[0]) },
    landingBurn: { thrust_N: r(s.landingThrust), thrustToWeight: r(s.landingThrust / weight), start_s: r(f.tLand) },
    touchdown: {
      t_s: r(e.touchdown),
      verticalSpeed_mps: last ? r(Math.max(-last.vel[1], 0)) : null,
      tireLoad_N: r(s.touchdownLoad),
      tireLoadToWeight: r(s.touchdownLoad / ((last?.mass ?? tl.params.mass) * G0)),
      sidewaysDrift_m: r(Math.abs(landed.pos[2])),
    },
    peakThruster_N: r(s.peakThruster.value),
    peakThrusterId: tl.thrusters[s.peakThruster.index]?.id ?? null,
    /**
     * Each nozzle's peak force against its rating. In the closed-loop model a nozzle can
     * deliver a few percent over its rating: its output scatters around the command,
     * and only the command is held at the rating.
     */
    thrusters: thrusterUse(tl),
    /** The closest the car comes to each parked vehicle and the stage while over it (null: never over it). */
    clearanceBySolid: clearanceBySolid(tl.params, tl.samples).map((c) => ({
      solid: c.solid.label,
      x_m: [r(c.solid.x0), r(c.solid.x1)],
      top_m: r(c.solid.top),
      gap_m: c.gap === null ? null : r(c.gap),
      t_s: c.t === null ? null : r(c.t),
    })),
    peakRollTorque_Nm: r(s.peakRollTorque.value),
    peakRollRate_degps: r((s.peakRollRate.value * 180) / Math.PI),
    totalImpulse_Ns: r(s.totalImpulse),
    nitrogen_kg: r(s.gasMass),
    tankVolume_L: r(s.tankVolumeLiters),
    tankMass_kg: r(s.tankMass),
    massAtTouchdown_kg: r(tl.params.mass - s.gasMass),
    peakJetPower_W: r(s.peakJetPower.value),
    driverPeak_g: r(s.peakOccupantG.value),
    clearance: { m: r(s.minClearance.value), over: s.minClearance.obstacle },
    approachSpeed_mps: r(s.approachSpeed),
    withoutLandingBurn: { impactSpeed_mps: r(s.noBurnImpactSpeed), tireLoadToWeight: r(s.noBurnImpactLoad / weight) },
  };
}

export type RunReport = ReturnType<typeof runReport>;

/** Peak force of each nozzle and of each group (lift, side), with its rating and use. */
function thrusterUse(tl: Timeline) {
  const peaks = tl.thrusters.map(() => 0);
  for (const s of tl.samples) s.thrusterForces.forEach((f, j) => (peaks[j] = Math.max(peaks[j], f)));
  const each = tl.thrusters.map((th, j) => ({
    id: th.id,
    group: th.group,
    peak_N: r(peaks[j]),
    rating_N: th.maxForce,
    use_pct: r((100 * peaks[j]) / th.maxForce),
  }));
  const group = (g: string) => {
    const xs = each.filter((e) => e.group === g);
    const top = xs.reduce((a, b) => ((b.peak_N ?? 0) > (a.peak_N ?? 0) ? b : a), xs[0]);
    return top ? { peak_N: top.peak_N, rating_N: top.rating_N, use_pct: top.use_pct, busiest: top.id } : null;
  };
  return {
    note: tl.control
      ? 'Delivered forces; commands are held at the rating, and output scatters a few percent around the command, so use_pct can slightly exceed 100.'
      : 'Forces the ideal flight requires; over 100% use means the rating is too low for this flight.',
    lift: group('lift'),
    side: group('side'),
    each,
  };
}

/** The state at time t (s from liftoff), as plain data; t is clamped to the run, and says so. */
export function stateAt(tl: Timeline, t: number) {
  const i = Math.max(0, Math.min(tl.samples.length - 1, Math.round((t - tl.events.start) / tl.dt)));
  const s = tl.samples[i];
  const clamped = t < tl.events.start - tl.dt || t > tl.events.end + tl.dt;
  return {
    t_s: r(s.t, 4),
    ...(clamped
      ? {
          note: `t = ${t} s is outside the run (${r(tl.events.start)} to ${r(tl.events.end)} s); this is the nearest moment.`,
        }
      : {}),
    phase: s.phase,
    airborne: s.airborne,
    position_m: s.pos.map((v) => r(v)),
    velocity_mps: s.vel.map((v) => r(v)),
    roll_deg: r((s.roll * 180) / Math.PI),
    thrust_N: r(norm(s.thrust)),
    thrusters_N: Object.fromEntries(tl.thrusters.map((th, j) => [th.id, r(s.thrusterForces[j])])),
    groundReaction_N: r(norm(s.ground)),
    mass_kg: r(s.mass),
    driver_g: r(s.occupantG),
  };
}
