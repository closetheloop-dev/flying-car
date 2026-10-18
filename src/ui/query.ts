import { DEFAULT_PARAMS, type Params } from '../physics/params';
import {
  DEFAULT_FLIGHT_MODE,
  SETTING_BY_KEY,
  SETTINGS,
  isFixedConstant,
  suggestSetting,
  validateSettings,
  type FlightMode,
  type SettingKey,
} from '../physics/settings';

/**
 * Physics settings in the page URL, so a configuration can be opened with a plain GET:
 *
 *   /?mass=1500&apexHeight=8&model=ideal
 *
 * Every Parameters-panel setting is a parameter named after its key, in SI units (meters,
 * kilograms, newtons, pascals, m/s; times in seconds, angles in degrees), plus
 * `model=controlled|ideal` for the flight model, and `explore=<setting key>` to fly that
 * setting lower and higher alongside. Values that can't be used are ignored and reported.
 * Parameters that aren't settings (e.g. tracking tags) are left alone and kept.
 */
export interface QueryResult {
  params: Partial<Params>;
  model?: FlightMode;
  /** The setting to compare lower and higher values of (not in `foreign`: the page writes it back). */
  explore?: SettingKey;
  /** One line per setting value that was ignored, and why. */
  problems: string[];
  /** Parameters that aren't settings, kept as they are (name → value). */
  foreign: [string, string][];
}

/** Long raw values are shortened in messages. */
const shorten = (s: string) => (s.length > 40 ? `${s.slice(0, 37)}…` : s);

export function parseQuery(search: string): QueryResult {
  const q = new URLSearchParams(search);
  const changes: Record<string, string> = {};
  const problems: string[] = [];
  const foreign: [string, string][] = [];
  let model: string | undefined;
  let explore: SettingKey | undefined;
  for (const [name, raw] of q) {
    if (name === 'explore') {
      if (explore !== undefined) problems.push('explore= appears more than once; only the first is read');
      else if (!SETTING_BY_KEY.has(raw as SettingKey)) {
        const guess = suggestSetting(raw);
        problems.push(`explore=${shorten(raw)}: not a setting${guess ? `. Did you mean ${guess}?` : ''}`);
      } else explore = raw as SettingKey;
      continue;
    }
    const isSetting = name === 'model' || SETTING_BY_KEY.has(name as SettingKey);
    if (!isSetting) {
      // Kept as is (it may be someone else's, e.g. a tracking tag); flagged if it is one
      // of the model's fixed constants or looks like a mistyped setting.
      foreign.push([name, raw]);
      const guess = suggestSetting(name);
      if (isFixedConstant(name)) problems.push(`${name}=${shorten(raw)}: a fixed constant of the model, not a setting`);
      else if (guess) problems.push(`${name}=${shorten(raw)}: not a setting. Did you mean ${guess}?`);
      continue;
    }
    if (name in changes || (name === 'model' && model !== undefined)) {
      problems.push(`${name}= appears more than once; only the first is read`);
      continue;
    }
    if (name === 'model') model = raw;
    else changes[name] = raw;
  }
  const v = validateSettings(changes, model);
  // Name the raw value in each message, as typed in the URL.
  for (const { key, message } of v.issues) {
    const raw = (key === 'model' ? model : changes[key]) ?? '';
    problems.push(`${key}=${shorten(raw)}: ${message}`);
  }
  return { params: v.accepted as Partial<Params>, model: v.model, explore, problems, foreign };
}

/** Shortest decimal of at most 12 significant digits that keeps the value (to ≈ 1e-11 relative). */
function formatValue(v: number): string {
  for (let d = 1; d < 12; d++) {
    const s = String(Number(v.toPrecision(d)));
    if (Math.abs(Number(s) - v) <= 1e-11 * Math.abs(v)) return s;
  }
  return String(Number(v.toPrecision(12)));
}

/**
 * The query string for these settings: only what differs from the defaults, the setting
 * explored (if any), then any parameters that aren't settings, as they were ('' for none).
 */
export function toQuery(
  params: Params,
  model: FlightMode,
  foreign: [string, string][] = [],
  explore?: SettingKey | null,
): string {
  const q = new URLSearchParams();
  for (const s of SETTINGS) {
    const v = params[s.key] as number;
    if (v !== DEFAULT_PARAMS[s.key]) q.set(s.key, formatValue(v));
  }
  if (model !== DEFAULT_FLIGHT_MODE) q.set('model', model);
  if (explore) q.set('explore', explore);
  for (const [k, v] of foreign) q.append(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}
