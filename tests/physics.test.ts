import { describe, expect, it } from 'vitest';
import { allocate } from '../src/physics/allocation';
import { add, mulMV, scale, yawRollMatrix, type V3 } from '../src/physics/math';
import { nnls } from '../src/physics/nnls';
import { DEFAULT_PARAMS, G0, type Params } from '../src/physics/params';
import { roll, solveVertical, vertical } from '../src/physics/profile';
import { MAX_LANDING_BURN_G, solveFlight } from '../src/physics/flight';
import { computeTimeline } from '../src/physics/timeline';
import { buildThrusters } from '../src/physics/vehicle';

const P: Params = { ...DEFAULT_PARAMS };

describe('nnls', () => {
  it('matches the unconstrained solution when it is already non-negative', () => {
    const x = nnls(
      [
        [2, 0],
        [0, 4],
        [1, 1],
      ],
      [2, 8, 3],
    );
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[1]).toBeCloseTo(2, 6);
  });

  it('clamps at zero when the free optimum would be negative', () => {
    // Free LS solution is x = [3, -1]; constrained optimum puts x1 = 0.
    const x = nnls(
      [
        [1, 0],
        [0, 1],
      ],
      [3, -1],
    );
    expect(x).toEqual([3, 0]);
  });
});

describe('thruster allocation', () => {
  const thrusters = buildThrusters(P);

  it('delivers a pure vertical lift with only non-negative forces', () => {
    const a = allocate(thrusters, { force: [0, 60_000, 0], torque: [0, 0, 0] });
    expect(a.forces.every((f) => f >= 0)).toBe(true);
    expect(a.residual).toBeLessThan(1e-4);
    expect(a.achieved.force[1]).toBeCloseTo(60_000, 0);
  });

  it('rolls by firing left and right lift thrusters unevenly, given enough lift', () => {
    const lever = P.width * 0.33;
    const torque = -15_000; // toward the noses
    const lift = (1.05 * Math.abs(torque)) / lever;
    const a = allocate(thrusters, { force: [0, lift, 0], torque: [torque, 0, 0] });
    expect(a.residual).toBeLessThan(1e-4);
    const [fl, fr, rl, rr] = a.forces;
    expect(fl + rl).toBeLessThan(fr + rr); // the right side pushes harder to roll left
  });

  it('cannot roll without lift: there is no thruster that pushes the car down', () => {
    const a = allocate(thrusters, { force: [0, 0, 0], torque: [15_000, 0, 0] });
    expect(a.residual).toBeGreaterThan(0.5);
    expect(thrusters.every((t) => t.direction[1] >= 0)).toBe(true);
  });
});

describe('vertical profile', () => {
  const v = solveVertical(P);

  it('is feasible with the default (footage-matched) parameters', () => {
    expect(v.problems).toEqual([]);
  });

  it('reaches the measured apex and lands at the measured time at the target speed', () => {
    const apex = vertical(v, P, v.tApex);
    expect(apex.y).toBeCloseTo(P.apexHeight, 6);
    expect(apex.vy).toBeCloseTo(0, 6);
    const td = vertical(v, P, v.T - 1e-9);
    expect(td.y).toBeCloseTo(P.cgHeight, 5);
    expect(td.vy).toBeCloseTo(-P.touchdownSpeed, 5);
  });

  it('is continuous in position and velocity across every phase boundary', () => {
    for (const tb of [v.tb, v.ts, v.T, v.T + v.tComp, v.T + v.tComp + v.tSettle]) {
      const a = vertical(v, P, tb - 1e-7);
      const b = vertical(v, P, tb + 1e-7);
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-5);
      expect(Math.abs(a.vy - b.vy)).toBeLessThan(1e-4);
    }
  });

  it('flags an air time too short for the apex', () => {
    expect(solveVertical({ ...P, airTimeVideo: 1.5 }).feasible).toBe(false);
  });

  it('rejects 2× slow-motion: the descent would have to beat free fall', () => {
    const slow = solveVertical({ ...P, footageSlowdown: 2 });
    expect(slow.T).toBeCloseTo(v.T / 2, 9);
    expect(slow.feasible).toBe(false);
  });

  it('needs more launch thrust when the footage is mildly slowed', () => {
    // A 9 m apex needs ≥ 2.9 s in the air, so only a slight slowdown stays feasible.
    const slow = solveVertical({ ...P, footageSlowdown: 1.02 });
    expect(slow.feasible).toBe(true);
    expect(slow.a1).toBeGreaterThan(v.a1);
  });
});

describe('roll', () => {
  it('turns exactly one full revolution, starting and ending at rest', () => {
    const before = roll(P, 0);
    const after = roll(P, 10);
    expect(before.angle).toBeCloseTo(0, 12);
    expect(after.angle).toBeCloseTo(2 * Math.PI * P.rollTurns, 9);
    expect(Math.abs(after.rate)).toBe(0);
  });

  it('rolls toward the line-up noses (−z) by default', () => {
    // Mid-roll at a quarter turn: the car's up axis should lean toward −z.
    const quarter = roll(P, P.rollStartVideo + P.rollDurationVideo * 0.34);
    expect(Math.sin(quarter.angle)).toBeLessThan(0);
  });

  it('has continuous angle and rate, and rate = d(angle)/dt, for any ramp length', () => {
    for (const [ramp, stop, over] of [
      [0.1, 0.05, 0],
      [0.4, 0.26, 9],
      [5, 5, 20],
    ]) {
      const q = { ...P, rollRampVideo: ramp, rollStopVideo: stop, rollOvershootDeg: over };
      const h = 1e-5;
      for (let t = 0; t < 3; t += 0.013) {
        const a = roll(q, t - h),
          b = roll(q, t + h);
        expect(Math.abs(b.angle - a.angle)).toBeLessThan(1e-3);
        expect((b.angle - a.angle) / (2 * h)).toBeCloseTo(roll(q, t).rate, 3);
      }
    }
  });

  it('holds a steady cruise rate between the ramps', () => {
    const mid = P.rollStartVideo + P.rollDurationVideo / 2;
    const peak = 2 * Math.PI * P.rollTurns - (P.rollOvershootDeg * Math.PI) / 180; // rollTurns < 0
    const cruise = peak / (P.rollDurationVideo - (P.rollRampVideo + P.rollStopVideo) / 2);
    expect(roll(P, mid).rate).toBeCloseTo(cruise, 9);
    expect(roll(P, mid).accel).toBe(0);
  });

  it('overshoots level by the set angle, then settles back before touchdown', () => {
    const peakT = P.rollStartVideo + P.rollDurationVideo;
    const past = (roll(P, peakT).angle - 2 * Math.PI * P.rollTurns) * Math.sign(P.rollTurns);
    expect((past * 180) / Math.PI).toBeCloseTo(P.rollOvershootDeg, 6);
    expect(roll(P, peakT).rate).toBeCloseTo(0, 9);
    const level = roll(P, peakT + P.rollSettleVideo + 1e-6);
    expect(level.angle).toBeCloseTo(2 * Math.PI * P.rollTurns, 9);
    expect(peakT + P.rollSettleVideo).toBeLessThan(P.airTimeVideo);
  });
});

describe('timeline', () => {
  const tl = computeTimeline(P);

  it('depends only on the settings values, not on what the same object held before', () => {
    // A settings object changed in place (as the panel does) must give the same run as a fresh one.
    const live = { ...P, inertiaScale: 0.5 };
    computeTimeline(live);
    live.inertiaScale = 1.2;
    const reused = computeTimeline(live);
    const fresh = computeTimeline({ ...P, inertiaScale: 1.2 });
    expect(reused.flight.feasible).toBe(fresh.flight.feasible);
    expect(reused.summary.landingThrust).toBe(fresh.summary.landingThrust);
    expect(reused.summary.peakRollTorque.value).toBe(fresh.summary.peakRollTorque.value);
  });

  it('has no warnings for the default maneuver', () => {
    expect(tl.warnings).toEqual([]);
  });

  it('covers the measured range between liftoff and touchdown', () => {
    const lift = tl.samples.find((s) => s.t >= 0)!;
    const td = tl.samples.find((s) => s.t >= tl.events.touchdown)!;
    expect(td.pos[0] - lift.pos[0]).toBeCloseTo(P.range, 0);
  });

  it('puts the apex at the measured position past the Semi and clears it', () => {
    const apex = tl.samples.reduce((a, b) => (b.pos[1] > a.pos[1] ? b : a));
    expect(Math.abs(apex.pos[0] - P.apexX)).toBeLessThan(0.5);
    expect(tl.summary.minClearance.value).toBeGreaterThan(0);
  });

  it('flags a range so short the car lifts off or lands inside the line-up', () => {
    // At 16 m the car lifts off within the Cybercab's footprint and lands on the stage.
    const short = computeTimeline({ ...P, range: 16 });
    expect(short.warnings.some((w) => w.startsWith('Collision'))).toBe(true);
    expect(short.summary.minClearance.value).toBeLessThan(0);
  });

  it('reports each collision with when it starts and where the car first touches', () => {
    expect(tl.incidents).toEqual([]);
    const short = computeTimeline({ ...P, range: 16 });
    const hits = short.incidents.filter((i) => i.kind === 'collision');
    expect(hits.map((i) => i.solid!.label)).toContain('Cybercab');
    for (const i of hits) {
      const s = i.solid!;
      // Never deeper than the solid itself is tall.
      expect(i.depth!).toBeLessThanOrEqual(s.top - s.bottom + 1e-9);
      // The marker sits on top of the solid that is hit, inside its footprint.
      expect(i.point[1]).toBeCloseTo(s.top, 9);
      expect(i.point[0]).toBeGreaterThanOrEqual(s.x0 - 1e-9);
      expect(i.point[0]).toBeLessThanOrEqual(s.x1 + 1e-9);
      expect(i.tEnd).toBeGreaterThanOrEqual(i.t);
      expect(i.depth!).toBeGreaterThan(0);
      // The start is a sample time after the first sample (the car starts clear of it).
      const k = short.samples.findIndex((x) => x.t >= i.t - 1e-9);
      expect(short.samples[k].t).toBeCloseTo(i.t, 9);
      expect(k).toBeGreaterThan(0);
    }
    expect(short.warnings.filter((w) => w.startsWith('Collision')).length).toBe(hits.length);
    // Sorted by time.
    expect(short.incidents.map((i) => i.t)).toEqual(short.incidents.map((i) => i.t).sort((a, b) => a - b));
  });

  it('has one clean feasibility edge as a setting moves (no flicker near it)', () => {
    // Near this edge the landing-burn search used to judge its coarse scan before refining
    // it, so feasibility flipped back and forth every few thousandths of a second.
    const base = { ...P, mass: 1500, apexHeight: 7.5, range: 42, airTimeVideo: 3.05 };
    const ok: boolean[] = [];
    for (let r = 1.52; r <= 1.6 + 1e-9; r += 0.004) ok.push(solveFlight({ ...base, rollDurationVideo: r }).feasible);
    const flips = ok.slice(1).filter((v, i) => v !== ok[i]).length;
    expect(ok[0]).toBe(false);
    expect(ok.at(-1)).toBe(true);
    expect(flips).toBe(1);
  }, 60_000);

  it('limits the landing burn, so plans at the edge stay physical', () => {
    // Just below an apex of 9 m the plan used to call for burns of tens of g at the last moment.
    for (const apexHeight of [8.6, 8.7, 8.75, 8.8, 8.9, 8.95, 8.999]) {
      const f = solveFlight({ ...P, apexHeight });
      if (f.feasible) expect(f.k3, String(apexHeight)).toBeLessThanOrEqual(MAX_LANDING_BURN_G);
      else expect(f.problems[0]).toMatch(/No landing burn of up to 5 × the car's weight/);
    }
    expect(solveFlight({ ...P, apexHeight: 8.95 }).feasible).toBe(false);
    expect(solveFlight(P).k3).toBeLessThan(4); // the footage's landing burn is well inside the limit
  });

  it('keeps a car that cannot fly at its launch point, and says why', () => {
    const grounded = computeTimeline({ ...P, apexHeight: 7 });
    expect(grounded.flight.feasible).toBe(false);
    const nf = grounded.incidents.find((i) => i.kind === 'infeasible-plan')!;
    expect(nf.message).toBe(grounded.flight.problems[0]);
    expect(nf.t).toBe(0);
    // It brakes to a stop at the launch point by liftoff, and stays clear of the line-up.
    const after = grounded.samples.filter((s) => s.t >= 0);
    for (const s of after) {
      expect(s.pos[0]).toBeCloseTo(nf.point[0], 1);
      expect(Math.abs(s.vel[0])).toBeLessThan(0.05);
      // Standing still and level (its braking ends at liftoff): no roll, then 1 g.
      expect(s.roll).toBe(0);
      if (s.t > 0.01) expect(s.occupantG).toBeCloseTo(1, 2);
    }
    expect(grounded.incidents.filter((i) => i.kind === 'collision')).toEqual([]);
    // Even when the launch point would be inside the line-up, it stops short of the stage.
    const short = computeTimeline({ ...P, apexHeight: 7, range: 15, apexX: 8 });
    expect(short.incidents.map((i) => i.kind)).toEqual(['infeasible-plan']);
    const stop = short.samples.at(-1)!.pos[0];
    expect(stop + P.length / 2).toBeLessThan(-9.5);
  });

  it('flags a hard landing where the car touches down', () => {
    const hard = computeTimeline({ ...P, touchdownSpeed: 5 });
    const h = hard.incidents.find((i) => i.kind === 'hard-landing')!;
    expect(h).toBeDefined();
    expect(h.t).toBeCloseTo(hard.events.touchdown, 2);
    const td = hard.samples.find((s) => s.t >= hard.events.touchdown)!;
    expect(h.point[0]).toBeCloseTo(td.pos[0], 1);
    expect(hard.warnings).toContain(h.message);
  });

  it('reproduces the trajectory when the derived forces are integrated back (Newton check)', () => {
    // Integrate a = (thrust + drag + gravity + ground) / m from liftoff and compare positions.
    const air = tl.samples.filter((s) => s.airborne);
    let pos: V3 = [...air[0].pos];
    let vel: V3 = [...air[0].vel];
    for (let i = 0; i < air.length - 1; i++) {
      const s = air[i];
      const F = add(add(s.thrust, s.drag), add(s.gravity, s.ground));
      const a = scale(F, 1 / s.mass);
      vel = add(vel, scale(a, tl.dt));
      pos = add(pos, scale(vel, tl.dt));
    }
    const last = air[air.length - 1];
    const err = [0, 1, 2].map((k) => Math.abs(pos[k] - last.pos[k]));
    console.log('Newton check error per axis [m]:', err.map((e) => e.toFixed(3)).join(', '));
    for (const e of err) expect(e).toBeLessThan(0.1);
  });

  it('drifts ≈2 m toward the noses from the lift thrust turning with the roll', () => {
    const approach = tl.samples.find((s) => s.t >= -0.5)!;
    const landed = tl.samples.find((s) => s.t >= tl.events.touchdown)!;
    expect(approach.pos[2]).toBeCloseTo(0, 9);
    expect(landed.pos[2]).toBeLessThan(-1.5);
    expect(landed.pos[2]).toBeGreaterThan(-2.6);
    // Over a full turn the sideways push reverses, so little sideways speed is left.
    expect(Math.abs(tl.flight.vzTouchdown)).toBeLessThan(1);
  });

  it('keeps the lift jets lit for the whole flight, pushing along the car’s up axis', () => {
    const lift = tl.thrusters.flatMap((t, j) => (t.group === 'lift' ? [j] : []));
    for (const s of tl.samples.filter((x) => x.airborne)) {
      const f = lift.reduce((sum, j) => sum + s.thrusterForces[j], 0);
      // Specific force is ≈ sustainThrustG of the liftoff mass; the car gets lighter.
      expect(f / (P.mass * G0)).toBeGreaterThan(P.sustainThrustG * 0.85);
    }
    // While inverted, the sustained thrust pushes the car toward the ground.
    const inverted = tl.samples.find((s) => s.airborne && Math.cos(s.roll) < -0.95)!;
    expect(inverted.thrust[1]).toBeLessThan(0);
  });

  it('drifts less with less sustained thrust (the roll’s own lift still pushes a little sideways)', () => {
    const plain = computeTimeline({ ...P, sustainThrustG: 0 });
    const zPlain = plain.samples.find((s) => s.t >= plain.events.touchdown)!.pos[2];
    const zDefault = tl.samples.find((s) => s.t >= tl.events.touchdown)!.pos[2];
    expect(Math.abs(zPlain)).toBeLessThan(Math.abs(zDefault));
  });

  it('pushes harder while inverted, bringing the car down sooner without adding drift', () => {
    const high = { ...P, apexHeight: 9.5, invertedThrustG: 0.75 };
    const tlHigh = computeTimeline(high);
    expect(tlHigh.flight.feasible).toBe(true);
    const lift = tlHigh.thrusters.flatMap((t, j) => (t.group === 'lift' ? [j] : []));
    const inverted = tlHigh.samples.find((s) => s.airborne && Math.cos(s.roll) < -0.99)!;
    const f = lift.reduce((sum, j) => sum + inverted.thrusterForces[j], 0);
    expect(f / (high.mass * G0)).toBeGreaterThan((high.sustainThrustG + high.invertedThrustG) * 0.85);
    // Without it, that apex leaves the car still airborne at the measured touchdown...
    expect(computeTimeline({ ...high, invertedThrustG: 0 }).flight.feasible).toBe(false);
    // ...and the drift is about the same as the default flight's.
    expect(Math.abs(tlHigh.flight.zTouchdown - tl.flight.zTouchdown)).toBeLessThan(0.6);
  });

  it('charges gas at impulse / (Isp·g0)', () => {
    expect(tl.summary.gasMass).toBeCloseTo(tl.summary.totalImpulse / (P.isp * G0), 6);
  });

  it('thrusters supply the required roll torque (Euler equation) during the roll', () => {
    const mid = tl.samples.find((s) => s.t > tl.events.rollStart + 0.2)!;
    const thrusters = tl.thrusters;
    let tx = 0;
    mid.thrusterForces.forEach((f, j) => {
      const p = thrusters[j].position,
        d = thrusters[j].direction;
      tx += f * (p[1] * d[2] - p[2] * d[1]);
    });
    expect(tx).toBeCloseTo(mid.required.torque[0], -1);
    expect(Math.abs(mid.required.torque[0])).toBeCloseTo(tl.inertia[0] * Math.abs(mid.alphaBody[0]), 0);
  });

  it('keeps the rotation matrix orthonormal', () => {
    const R = yawRollMatrix(0.7, 2.1);
    const x = mulMV(R, [1, 0, 0]);
    expect(Math.hypot(...x)).toBeCloseTo(1, 12);
  });

  it('writes the headline numbers to the test log', () => {
    const s = tl.summary;
    const kN = (v: number) => `${(v / 1000).toFixed(1)} kN`;
    console.log({
      approachSpeed: `${s.approachSpeed.toFixed(2)} m/s`,
      launchThrust: kN(s.launchThrust),
      landingThrust: kN(s.landingThrust),
      peakTW: s.peakThrustToWeight.toFixed(2),
      peakThruster: `${tl.thrusters[s.peakThruster.index].id} ${kN(s.peakThruster.value)}`,
      peakRollTorque: kN(s.peakRollTorque.value) + '·m',
      peakRollRate: `${((s.peakRollRate.value * 180) / Math.PI).toFixed(0)} °/s`,
      peakLateralThrust: kN(s.peakLateralThrust.value),
      impulse: `${(s.totalImpulse / 1000).toFixed(1)} kN·s`,
      gas: `${s.gasMass.toFixed(1)} kg`,
      tank: `${s.tankVolumeLiters.toFixed(0)} L, ${s.tankMass.toFixed(0)} kg`,
      occupantG: s.peakOccupantG.value.toFixed(2),
      weightless: s.weightlessTime.toFixed(2),
      clearance: `${s.minClearance.value.toFixed(2)} m over ${s.minClearance.obstacle}`,
      touchdownLoad: kN(s.touchdownLoad),
      noBurn: `${s.noBurnImpactSpeed.toFixed(1)} m/s → ${kN(s.noBurnImpactLoad)}`,
      jetPower: `${(s.peakJetPower.value / 1e6).toFixed(1)} MW`,
      residual: s.maxResidual.toExponential(2),
      events: tl.events,
    });
  });
});
