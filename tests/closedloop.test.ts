import { describe, expect, it } from 'vitest';
import { simulateControlled } from '../src/physics/closedloop';
import { norm } from '../src/physics/math';
import { DEFAULT_PARAMS, G0, type Params } from '../src/physics/params';
import { computeTimeline } from '../src/physics/timeline';

const P: Params = { ...DEFAULT_PARAMS };
const PERFECT: Params = {
  ...P,
  gustStd: 0,
  thrustScatter: 0,
  thrustNoise: 0,
  cgOffset: 0,
  inertiaError: 0,
  valveLag: 0,
  minOpening: 0,
  controlRate: 480,
};

describe('closed-loop flight', () => {
  it('reproduces the ideal flight when nothing goes wrong (forward model ≡ inverse model)', () => {
    const ideal = computeTimeline(PERFECT);
    const tl = simulateControlled(ideal);
    const c = tl.control!;
    console.log('perfect:', JSON.stringify(c));
    expect(c.maxPosError).toBeLessThan(0.03);
    expect(c.maxAttError).toBeLessThan(0.5);
    expect(Math.abs(c.touchdownTime - ideal.events.touchdown)).toBeLessThan(0.02);
    expect(Math.abs(c.extraGas)).toBeLessThan(2);
  });

  it('turns the car by the slide yaw as it brakes after landing, as the ideal flight does', () => {
    const yawAtEnd = (tl: ReturnType<typeof computeTimeline>) => tl.samples[tl.samples.length - 1].yaw;
    const straight = simulateControlled(computeTimeline(P));
    const ideal = computeTimeline({ ...P, driftYawDeg: 90 });
    const turned = simulateControlled(ideal);
    expect(((yawAtEnd(turned) - yawAtEnd(straight)) * 180) / Math.PI).toBeCloseTo(90, 3);
    // With a turn rate to match (and the torque the tires must supply for it), not a car
    // that swings round while reporting it isn't turning.
    const peakYawRate = (tl: typeof ideal) =>
      Math.max(...tl.samples.filter((s) => s.t > tl.events.touchdown).map((s) => Math.abs(s.omegaBody[1])));
    expect(peakYawRate(turned)).toBeGreaterThan(0.5);
    // (Within 15%: the flown touchdown speed, and so the braking time, differs a little.)
    expect(Math.abs(peakYawRate(turned) / peakYawRate(ideal) - 1)).toBeLessThan(0.15);
    expect(turned.samples.some((s) => s.t > turned.events.touchdown && s.required.torque[1] !== 0)).toBe(true);
  });

  it('leads its feedforward by the valve lag, so a lagging valve still lands softly', () => {
    // Only the valve lag: without the lead the thrust arrives late through the short
    // landing burn and the car lands ≈ 0.7 m/s hard.
    const ideal = computeTimeline({ ...PERFECT, valveLag: 0.03 });
    const tl = simulateControlled(ideal);
    const c = tl.control!;
    expect(Math.abs(c.touchdownSpeed - PERFECT.touchdownSpeed)).toBeLessThan(0.4);
    expect(c.maxPosError).toBeLessThan(0.25);
    expect(c.maxAttError).toBeLessThan(3);
    expect(tl.warnings).toEqual([]);
  });

  const ideal = computeTimeline(P);
  const tl = simulateControlled(ideal);
  const c = tl.control!;

  it('tracks the reference through the default disturbances and lands safely', () => {
    console.log('disturbed:', JSON.stringify(c), 'warnings:', tl.warnings);
    expect(tl.warnings).toEqual([]); // in particular, no hard landing
    expect(c.maxPosError).toBeLessThan(1.5);
    expect(c.touchdownSpeed).toBeLessThan(P.touchdownSpeed + 0.6);
    expect(c.touchdownTiltDeg).toBeLessThan(10);
    expect(Math.hypot(...c.landingError)).toBeLessThan(1.5);
  });

  it('reports a car that cannot climb, instead of letting it sink into the road', () => {
    const weak = simulateControlled(computeTimeline({ ...P, liftThrusterMax: 5000 }));
    const first = weak.incidents[0];
    expect(first.kind).toBe('no-flight');
    expect(first.t).toBeLessThan(0.5);
    // The car never goes below ride height minus the suspension's 2 cm allowance in flight,
    // and once it has settled back it stays on the road (it doesn't fly the ideal arc).
    for (const s of weak.samples.filter((x) => x.airborne)) expect(s.pos[1]).toBeGreaterThan(P.cgHeight - 0.03);
    for (const s of weak.samples.filter((x) => x.t >= first.t)) {
      expect(s.pos[1]).toBeGreaterThan(P.cgHeight - P.suspensionTravel - 1e-6);
      expect(s.pos[1]).toBeLessThan(P.cgHeight + 1e-6);
      expect(norm(s.thrust)).toBe(0);
    }
    expect(weak.incidents.some((i) => i.solid?.label === 'road')).toBe(false);
  });

  it('does not mistake a long-travel suspension for the body hitting the road', () => {
    const ideal = computeTimeline({ ...P, suspensionTravel: 0.3 });
    expect(ideal.incidents).toEqual([]);
    expect(simulateControlled(ideal).incidents).toEqual([]);
  });

  it('completes the full roll toward the noses', () => {
    const last = tl.samples.filter((s) => s.airborne).at(-1)!;
    expect((last.roll * 180) / Math.PI).toBeGreaterThan(-380);
    expect((last.roll * 180) / Math.PI).toBeLessThan(-340);
  });

  it('uses about the ideal amount of gas, and fires the thrusters in pulses', () => {
    // Corrections cost gas, but a slightly firmer landing saves some braking, so the
    // difference can go either way; over several disturbance draws it stays within ≈ 12%.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const run = seed === P.seed ? c : simulateControlled({ ...ideal, params: { ...P, seed } }).control!;
      expect(Number.isFinite(run.extraGas)).toBe(true);
      expect(Math.abs(run.extraGas)).toBeLessThan(0.12 * ideal.summary.gasMass);
    }
    expect(c.pulses).toBeGreaterThan(20);
  });

  it('is repeatable for a given seed and different for another', () => {
    const again = simulateControlled(computeTimeline(P)).control!;
    expect(again.maxPosError).toBe(c.maxPosError);
    const other = simulateControlled(computeTimeline({ ...P, seed: 7 })).control!;
    expect(other.maxPosError).not.toBe(c.maxPosError);
  });

  it('obeys Newton: thrust + drag + gravity integrate to the simulated path', () => {
    const air = tl.samples.filter((s) => s.airborne);
    for (const s of air.slice(1, -1)) {
      const a = [0, 1, 2].map((k) => (s.thrust[k] + s.drag[k] + s.gravity[k]) / s.mass);
      a.forEach((v, k) => expect(v).toBeCloseTo(s.acc[k], 6));
    }
    expect(air[0].mass).toBeCloseTo(P.mass, 6);
    expect(air.at(-1)!.mass).toBeLessThan(P.mass - 50);
    expect(G0).toBeGreaterThan(9.8);
  });
});
