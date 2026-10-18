import { solveFlight } from './flight';
import type { Params } from './params';
import { SETTING_BY_KEY, type SettingKey } from './settings';

/** The settings find_feasible varies by default: the ones the plan's feasibility hinges on. */
export const FEASIBILITY_KEYS: SettingKey[] = ['airTimeVideo', 'apexHeight', 'rollDurationVideo', 'sustainThrustG'];

export interface FeasibleEdges {
  setting: SettingKey;
  value: number;
  /** Whether the plan is feasible at the current value. */
  planFeasible: boolean;
  /**
   * Infeasible now: the nearest values below and above that give a feasible plan (others
   * unchanged), null if there is none before the range ends. Feasible now: how far down and
   * up the value can go and stay feasible (the range's end if it stays feasible that far).
   * Every value returned has been checked feasible as reported (after rounding).
   */
  below: number | null;
  above: number | null;
}

/** Digits to report a value to: one past the setting's slider step (none for whole numbers). */
const decimals = (step: number, integer: boolean) => (integer ? 0 : Math.max(0, Math.ceil(-Math.log10(step)) + 1));

/**
 * Where the flight plan's feasibility changes as one setting moves away from its value,
 * the others fixed: steps out in doubling steps (from 1/32 of the setting's range) until
 * feasibility flips or the range ends, then bisects the edge to 1/8 of a slider step. A
 * feasible stretch narrower than the first step can be stepped over. Each check solves
 * the plan (≈ 30–300 ms); `pause` runs between checks, e.g. to let the page draw.
 */
export async function feasibleEdges(
  p: Params,
  key: SettingKey,
  pause: () => Promise<void> = async () => {},
): Promise<FeasibleEdges> {
  const s = SETTING_BY_KEY.get(key)!;
  const v = p[key] as number;
  const snap = (x: number) => (s.integer ? Math.round(x) : x);
  const feasible = async (x: number) => {
    await pause();
    return solveFlight({ ...p, [key]: snap(x) }).feasible;
  };
  const now = await feasible(v);
  const d = decimals(s.step, s.integer);
  const unit = 10 ** -d;
  const tolerance = s.integer ? 1 : s.step / 8;
  const first = s.integer ? Math.max(1, Math.round((s.max - s.min) / 32)) : (s.max - s.min) / 32;

  /** The reported value: x rounded to d decimals, moved toward `inside` until it checks feasible (null if it won't). */
  const settle = async (x: number, inside: number) => {
    const dir = Math.sign(inside - x) || 1;
    let y = dir > 0 ? Math.ceil(x / unit - 1e-9) * unit : Math.floor(x / unit + 1e-9) * unit;
    for (let k = 0; k < 4; k++, y += dir * unit) {
      y = Math.min(Math.max(Number(y.toFixed(d)), s.min), s.max);
      if (await feasible(y)) return y;
    }
    return null;
  };

  const edge = async (dir: -1 | 1): Promise<number | null> => {
    const end = dir < 0 ? s.min : s.max;
    let a = v; // last value with the current feasibility
    for (let k = 0; ; k++) {
      const x = snap(dir < 0 ? Math.max(v - first * 2 ** k, end) : Math.min(v + first * 2 ** k, end));
      if (x === a) return now ? end : null; // the range ends before feasibility flips
      if ((await feasible(x)) !== now) {
        let b = x;
        while (Math.abs(b - a) > tolerance) {
          const m = snap((a + b) / 2);
          if (m === a || m === b) break;
          if ((await feasible(m)) === now) a = m;
          else b = m;
        }
        // Feasible now: the last feasible value (a), rounded back toward v; infeasible now:
        // the first feasible one (b), rounded on into the feasible side.
        return now ? settle(a, v) : settle(b, b + (b - a));
      }
      a = x;
    }
  };
  const below = await edge(-1);
  const above = await edge(1);
  return { setting: key, value: v, planFeasible: now, below, above };
}

/** How far past the edge of what's feasible a fitted air time goes [s on screen]. */
const AIR_TIME_MARGIN = 0.05;

/**
 * The air time on screen that lets these settings fly: `preferred` if the plan works with
 * it, else the nearest that does (null if none in the setting's range). Used to keep the
 * quick controls flyable: a higher hop or another number of rolls needs a different time in
 * the air, which the footage fixes at its own value.
 */
export async function fitAirTime(
  p: Params,
  preferred: number,
  pause: () => Promise<void> = async () => {},
): Promise<number | null> {
  // The search steps outward and can step over a narrow window; the air time the settings
  // had before this change is worth a try too.
  const found = await nearestAirTime(p, preferred, pause);
  if (found !== null || p.airTimeVideo === preferred) return found;
  await pause();
  return solveFlight(p).feasible ? p.airTimeVideo : null;
}

async function nearestAirTime(p: Params, preferred: number, pause: () => Promise<void>): Promise<number | null> {
  const s = SETTING_BY_KEY.get('airTimeVideo')!;
  const flies = async (x: number) => {
    await pause();
    return solveFlight({ ...p, airTimeVideo: x }).feasible;
  };
  if (await flies(preferred)) return preferred;
  // Out from `preferred` on both sides at once, in doubling steps, so the nearer edge is
  // found first; then that edge is bisected to a slider step (each check is one solve).
  const d = decimals(s.step, s.integer);
  const last = { [-1]: preferred, [1]: preferred } as Record<-1 | 1, number>;
  for (let k = 0; k < 10; k++) {
    for (const dir of [-1, 1] as const) {
      const x = Math.min(Math.max(preferred + dir * ((s.max - s.min) / 64) * 2 ** k, s.min), s.max);
      if (x === last[dir]) continue; // this side's range has ended
      if (!(await flies(x))) {
        last[dir] = x;
        continue;
      }
      let [a, b] = [last[dir], x]; // a fails, b flies
      while (Math.abs(b - a) > s.step) {
        const m = (a + b) / 2;
        if (await flies(m)) b = m;
        else a = m;
      }
      // A little inside the edge, where the landing burn isn't at its limit (right at the edge
      // the flown hop lands hard), else at the edge; rounded for display; checked to fly.
      const inside = Number(Math.min(Math.max(b + dir * AIR_TIME_MARGIN, s.min), s.max).toFixed(d));
      if (await flies(inside)) return inside;
      for (let y = Number(b.toFixed(d)), i = 0; i < 4; i++, y = Number((y + dir * 10 ** -d).toFixed(d))) {
        if (y >= s.min && y <= s.max && (await flies(y))) return y;
      }
      return b;
    }
  }
  return null;
}
