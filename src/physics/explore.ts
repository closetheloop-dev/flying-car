/**
 * The comparison runs for /?explore=<key>: the same hop flown with one setting lower and
 * higher than it is now, each at a value where the hop still flies. A setting the plan
 * depends on gets the air time fitted to each value, as the Tweak card does.
 */
import { fitAirTime } from './feasible';
import { solveFlight } from './flight';
import type { Params } from './params';
import { SETTING_BY_KEY, type FlightMode, type SettingKey } from './settings';
import type { Timeline } from './timeline';

export interface ExploreRun {
  side: 'lower' | 'higher';
  /** The setting's value in this run (SI). */
  value: number;
  /** The settings to change for this run: the value, and the air time if it had to move. */
  changes: Partial<Params>;
}

/** A comparison run, flown. */
export interface ExploreFlown {
  run: ExploreRun;
  tl: Timeline;
}

/** What explore.worker.ts is asked to work out. */
export interface ExploreRequest {
  params: Params;
  key: SettingKey;
  mode: FlightMode;
}

/** How far each comparison reaches first, as a share of the setting's range. */
const REACH = 0.25;
/** Values tried per side, each halfway back toward the current value. */
const TRIES = 4;

/**
 * The lower and higher runs to compare (one, or none, at the end of a range or where no
 * nearby value flies). Each check solves the plan (≈ 30–300 ms); `pause` runs between them.
 */
export async function exploreRuns(
  p: Params,
  key: SettingKey,
  pause: () => Promise<void> = async () => {},
): Promise<ExploreRun[]> {
  const s = SETTING_BY_KEY.get(key)!;
  const v = p[key] as number;
  const snap = (x: number) =>
    s.integer ? Math.round(x) : Number(Math.min(Math.max(Math.round(x / s.step) * s.step, s.min), s.max).toFixed(6));
  const reach = s.integer ? Math.max(1, Math.floor((s.max - s.min) * REACH)) : (s.max - s.min) * REACH;
  const runs: ExploreRun[] = [];
  for (const dir of [-1, 1] as const) {
    let x = snap(Math.min(Math.max(v + dir * reach, s.min), s.max));
    for (let k = 0; k < TRIES && x !== v; k++) {
      const q = { ...p, [key]: x };
      let air: number | null;
      if (key === 'airTimeVideo') {
        await pause();
        air = solveFlight(q).feasible ? x : null;
      } else air = await fitAirTime(q, p.airTimeVideo, pause);
      if (air !== null) {
        const changes: Partial<Params> = { [key]: x };
        if (air !== q.airTimeVideo) changes.airTimeVideo = air;
        runs.push({ side: dir < 0 ? 'lower' : 'higher', value: x, changes });
        break;
      }
      x = snap((x + v) / 2);
    }
  }
  return runs;
}
