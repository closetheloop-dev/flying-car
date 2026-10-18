import { describe, expect, it } from 'vitest';
import { exploreRuns } from '../src/physics/explore';
import { fitAirTime } from '../src/physics/feasible';
import { solveFlight } from '../src/physics/flight';
import { DEFAULT_PARAMS, type Params } from '../src/physics/params';

describe('fitting the air time (the Tweak card)', () => {
  const stunt = DEFAULT_PARAMS.airTimeVideo;

  it("keeps the footage's air time when the plan works with it", async () => {
    expect(await fitAirTime({ ...DEFAULT_PARAMS }, stunt)).toBe(stunt);
  });

  it('finds a nearby air time that flies when the footage’s does not', async () => {
    for (const change of [{ rollTurns: 0 }, { rollTurns: 2 }, { apexHeight: 10 }, { rollDurationVideo: 1.2 }]) {
      const p = { ...DEFAULT_PARAMS, ...change };
      expect(solveFlight(p).feasible, JSON.stringify(change)).toBe(false);
      const air = await fitAirTime(p, stunt);
      expect(air, JSON.stringify(change)).not.toBeNull();
      expect(Math.abs(air! - stunt), JSON.stringify(change)).toBeLessThan(1);
      expect(solveFlight({ ...p, airTimeVideo: air! }).feasible, JSON.stringify(change)).toBe(true);
    }
  }, 120_000);

  it('says when no air time can work', async () => {
    expect(await fitAirTime({ ...DEFAULT_PARAMS, apexHeight: 5 }, stunt)).toBeNull();
  }, 120_000);
});

describe('exploring a setting (/?explore=)', () => {
  const flies = (p: Partial<Params>) => solveFlight({ ...DEFAULT_PARAMS, ...p }).feasible;

  it('flies a lower and a higher value, fitting the air time where the plan needs it', async () => {
    const runs = await exploreRuns({ ...DEFAULT_PARAMS }, 'apexHeight');
    expect(runs.map((r) => r.side)).toEqual(['lower', 'higher']);
    const [lower, higher] = runs;
    expect(lower.value).toBeLessThan(DEFAULT_PARAMS.apexHeight);
    expect(higher.value).toBeGreaterThan(DEFAULT_PARAMS.apexHeight);
    for (const r of runs) {
      expect(r.changes.apexHeight).toBe(r.value);
      expect(r.changes.airTimeVideo).toBeDefined(); // the stunt's air time only fits its own hop
      expect(flies(r.changes)).toBe(true);
    }
  }, 120_000);

  it('steps whole numbers by one, and leaves the air time alone where it still works', async () => {
    const runs = await exploreRuns({ ...DEFAULT_PARAMS }, 'isp');
    expect(runs.map((r) => Object.keys(r.changes))).toEqual([['isp'], ['isp']]);
    const seeds = await exploreRuns({ ...DEFAULT_PARAMS, seed: 5 }, 'seed');
    expect(seeds.map((r) => r.value).every((v) => Number.isInteger(v) && v !== 5)).toBe(true);
  }, 120_000);

  it('has no lower run at the bottom of the range', async () => {
    const runs = await exploreRuns({ ...DEFAULT_PARAMS, driftYawDeg: 0 }, 'driftYawDeg');
    expect(runs.map((r) => r.side)).toEqual(['higher']);
  });
});
