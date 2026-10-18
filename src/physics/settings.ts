import { DEFAULT_PARAMS, type Params } from './params';

/** Physical quantity of a setting, for display-unit conversion (null = unitless or seconds). */
export type SettingQuantity = 'length' | 'shortLength' | 'mass' | 'force' | 'pressure' | 'velocity' | 'accel' | 'area';

/** SI unit each quantity is stored, and accepted in URLs and tool calls, in. */
const SI_UNIT: Record<SettingQuantity, string> = {
  length: 'm',
  shortLength: 'm',
  mass: 'kg',
  force: 'N',
  pressure: 'Pa',
  velocity: 'm/s',
  accel: 'm/s²',
  area: 'm²',
};

/** One adjustable physics setting: the Parameters panel's sliders, URL parameters and tools all use these. */
export interface Setting {
  key: keyof Params & string;
  /** Label without units, as in the panel. */
  label: string;
  quantity: SettingQuantity | null;
  /** SI unit of the stored value ('' for unitless; seconds and degrees are in the label). */
  unit: string;
  /** The unit as a reader needs it, including those named in the label: s, °, g, Hz, rad/s, fraction ('' if none). */
  displayUnit: string;
  /** Allowed range, inclusive, in SI. */
  min: number;
  max: number;
  /** Slider step in SI (the panel rounds it to a nice step in display units). */
  step: number;
  /** Whole numbers only. */
  integer: boolean;
  folder: string;
}

type Row = [keyof Params & string, string, SettingQuantity | null, number, number, number, boolean?];

/** The settings that only the closed-loop flight model uses (the Ideal one has no controller or errors). */
export const CLOSED_LOOP_FOLDER = 'Closed-loop flight';

const FOLDERS: [string, Row[]][] = [
  [
    'Maneuver (measured from footage)',
    [
      ['footageSlowdown', 'Footage slow-mo factor', null, 0.5, 3, 0.05],
      ['airTimeVideo', 'Air time on screen (s)', null, 1.5, 4, 0.05],
      ['apexHeight', 'Apex CG height', 'length', 3, 10, 0.1],
      ['range', 'Range liftoff→touchdown', 'length', 15, 45, 0.5],
      ['apexX', 'Apex past the Semi', 'length', -8, 8, 0.1],
      ['sustainThrustG', 'Sustained lift thrust (g)', null, 0, 1.2, 0.01],
      ['invertedThrustG', 'Extra lift while inverted (g)', null, 0, 2, 0.01],
      ['launchBurnVideo', 'Launch burn on screen (s)', null, 0.1, 1, 0.01],
      ['touchdownSpeed', 'Touchdown speed', 'velocity', 0, 5, 0.1],
      ['rollStartVideo', 'Roll start on screen (s)', null, 0, 1.5, 0.01],
      ['rollDurationVideo', 'Roll duration on screen (s)', null, 0.5, 2.8, 0.01],
      ['rollRampVideo', 'Roll spin-up time on screen (s)', null, 0.05, 1.4, 0.05],
      ['rollStopVideo', 'Roll stop time on screen (s)', null, 0.02, 1.0, 0.01],
      ['rollOvershootDeg', 'Roll overshoot past level (°)', null, 0, 30, 1],
      ['rollSettleVideo', 'Overshoot correction time (s)', null, 0.02, 0.8, 0.01],
      ['rollTurns', 'Barrel rolls (− = toward noses)', null, -3, 3, 1, true],
    ],
  ],
  [
    'Vehicle',
    [
      ['mass', 'Mass at liftoff', 'mass', 1200, 3000, 10],
      ['cgHeight', 'CG height at rest', 'length', 0.35, 0.7, 0.01],
      ['inertiaScale', 'Inertia vs uniform box', null, 0.5, 1.2, 0.01],
    ],
  ],
  [
    'Propulsion (cold gas N₂)',
    [
      ['isp', 'Specific impulse (s)', null, 40, 80, 1],
      ['liftThrusterMax', 'Lift thruster rating', 'force', 5_000, 60_000, 500],
      ['rcsThrusterMax', 'Side thruster rating', 'force', 2_000, 30_000, 500],
      ['tankPressure', 'Tank pressure', 'pressure', 10e6, 70e6, 1e6],
      ['usableFraction', 'Usable gas fraction', null, 0.5, 0.95, 0.01],
    ],
  ],
  [
    'Ground & air',
    [
      ['suspensionTravel', 'Suspension travel', 'shortLength', 0.04, 0.3, 0.01],
      ['brakingDecel', 'Slide deceleration', 'accel', 2, 10, 0.1],
      ['driftYawDeg', 'Slide yaw (°)', null, 0, 270, 5],
      ['cdaTop', 'Drag area from above', 'area', 2, 12, 0.1],
    ],
  ],
  [
    CLOSED_LOOP_FOLDER,
    [
      ['gustStd', 'Gusts (std)', 'velocity', 0, 6, 0.1],
      ['thrustScatter', 'Thruster output error (fraction)', null, 0, 0.2, 0.005],
      ['thrustNoise', 'Thrust fluctuation (fraction)', null, 0, 0.3, 0.005],
      ['cgOffset', 'Center-of-mass error', 'shortLength', 0, 0.15, 0.005],
      ['inertiaError', 'Inertia error (fraction)', null, 0, 0.4, 0.01],
      ['valveLag', 'Valve response time (s)', null, 0, 0.12, 0.005],
      ['minOpening', 'Smallest steady opening (fraction)', null, 0, 0.4, 0.01],
      ['controlRate', 'Controller rate (Hz)', null, 20, 480, 10, true],
      ['posBandwidth', 'Path-tracking bandwidth (rad/s)', null, 0.5, 8, 0.1],
      ['attBandwidth', 'Attitude bandwidth (rad/s)', null, 2, 30, 0.5],
      ['seed', 'Disturbance seed', null, 1, 999, 1, true],
    ],
  ],
];

/** A unit named at the end of a label, e.g. "Specific impulse (s)" → "s". */
const LABEL_UNITS = new Set(['s', '°', 'g', 'Hz', 'rad/s', 'fraction']);
const labelUnit = (label: string) => {
  const m = label.match(/\(([^)]*)\)$/);
  return m && LABEL_UNITS.has(m[1]) ? m[1] : '';
};

export const SETTINGS: Setting[] = FOLDERS.flatMap(([folder, rows]) =>
  rows.map(([key, label, quantity, min, max, step, integer]) => {
    const unit = quantity ? SI_UNIT[quantity] : '';
    return {
      key,
      label,
      quantity,
      unit,
      displayUnit: unit || labelUnit(label),
      min,
      max,
      step,
      integer: !!integer,
      folder,
    };
  }),
);

/**
 * Times named "…Video" (and labeled "on screen") are as seen in the footage; the
 * simulation runs on real time = video time ÷ footageSlowdown.
 */
export const VIDEO_TIME_NOTE =
  'Settings ending in "Video" are times as seen in the footage; real time = video time ÷ footageSlowdown (1 = real time).';
export const FOLDER_NAMES = FOLDERS.map(([name]) => name);
export const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export type FlightMode = 'controlled' | 'ideal';
export const FLIGHT_MODES: FlightMode[] = ['controlled', 'ideal'];
export const DEFAULT_FLIGHT_MODE: FlightMode = 'controlled';

/** A setting's name (a key of Params that the panel, the URL and the tools accept). */
export type SettingKey = Setting['key'];

/** Written the way the URL accepts it (plain digits, so it can be typed back). */
const fmtNumber = (v: number) => String(v);

/** Why a value can't be used for a setting, or null if it can. */
export function checkValue(s: Setting, v: number): string | null {
  if (Number.isNaN(v)) return `${s.key} must be a number`;
  if (v < s.min || v > s.max || !Number.isFinite(v)) {
    return `${s.key} must be between ${fmtNumber(s.min)} and ${fmtNumber(s.max)}${s.unit ? ` ${s.unit}` : ''}`;
  }
  if (s.integer && !Number.isInteger(v)) return `${s.key} must be a whole number`;
  return null;
}

/**
 * A number written in plain decimal (optionally with an exponent), as in a URL. Hex,
 * binary and other forms that JavaScript's Number() accepts are not; the Unicode minus
 * sign (−) counts as a minus. NaN if it isn't one.
 */
export function parseDecimal(raw: string): number {
  const s = raw.replace(/−/g, '-');
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : NaN;
}

export interface Validated {
  /** The values that can be used. */
  accepted: Partial<Record<SettingKey, number>>;
  model?: FlightMode;
  /** One line per value that can't be used, and why. */
  problems: string[];
  /** The same, with the name each is about. */
  issues: { key: string; message: string }[];
}

/**
 * Check a set of changes against the settings: names, numbers, ranges, whole numbers, and
 * the flight model. Used for URL parameters, the debug hook and the WebMCP tools alike.
 */
export function validateSettings(
  changes: Record<string, unknown>,
  model?: unknown,
  { numbersOnly = false }: { numbersOnly?: boolean } = {},
): Validated {
  const accepted: Partial<Record<SettingKey, number>> = {};
  const issues: { key: string; message: string }[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const s = SETTING_BY_KEY.get(key as SettingKey);
    if (!s) {
      const guess = suggestSetting(key);
      issues.push({
        key,
        message: isFixedConstant(key)
          ? `${key} is a fixed constant, not a setting`
          : `${key} is not a setting${guess ? `. Did you mean ${guess}?` : ''}`,
      });
      continue;
    }
    if (numbersOnly && typeof value !== 'number') {
      issues.push({
        key,
        message: `${key} must be a number (got ${typeof value === 'string' ? `the string ${JSON.stringify(value)}` : typeof value})`,
      });
      continue;
    }
    const v = typeof value === 'number' ? value : typeof value === 'string' ? parseDecimal(value.trim()) : NaN;
    const why = checkValue(s, v);
    if (why) issues.push({ key, message: why });
    else accepted[s.key] = v === 0 ? 0 : v; // no −0
  }
  let mode: FlightMode | undefined;
  if (model !== undefined) {
    if ((FLIGHT_MODES as unknown[]).includes(model)) mode = model as FlightMode;
    else issues.push({ key: 'model', message: `model must be ${FLIGHT_MODES.join(' or ')}` });
  }
  return { accepted, model: mode, issues, problems: issues.map((i) => i.message) };
}

/** Edit distance, case-insensitive (for spotting a mistyped setting name). */
function distance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array.from({ length: b.length }, () => 0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** The setting (or "model") a name was probably meant to be, if it is a near miss. */
export function suggestSetting(name: string): string | undefined {
  let best: string | undefined,
    bestD = Infinity;
  for (const n of [...SETTINGS.map((s) => s.key), 'model']) {
    const d = distance(name, n);
    if (d < bestD) [best, bestD] = [n, d];
  }
  return bestD <= Math.max(1, Math.min(2, Math.floor(name.length / 4))) ? best : undefined;
}

/** A model quantity that is not adjustable (e.g. the car's length or the air density). */
export function isFixedConstant(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULT_PARAMS, key) && !SETTING_BY_KEY.has(key as SettingKey);
}

/** The default value of every setting. */
export function defaultSettings(): Partial<Params> {
  return Object.fromEntries(SETTINGS.map((s) => [s.key, DEFAULT_PARAMS[s.key]]));
}
