/**
 * Display units. The physics is SI throughout; this module converts for display only.
 * US customary (Imperial) is the default; the choice is remembered across visits.
 */
export type UnitSystem = 'imperial' | 'si';

export type Quantity =
  | 'force'
  | 'torque'
  | 'mass'
  | 'length'
  | 'shortLength'
  | 'speed'
  | 'velocity'
  | 'accel'
  | 'volume'
  | 'pressure'
  | 'power'
  | 'impulse'
  | 'area';

interface UnitDef {
  unit: string;
  /** Multiply an SI value by this to get the display value. */
  factor: number;
  digits: number;
  /** Optional larger unit used above a threshold (in display units of the base). */
  big?: { above: number; unit: string; factor: number; digits: number };
}

const TABLE: Record<UnitSystem, Record<Quantity, UnitDef>> = {
  si: {
    force: { unit: 'N', factor: 1, digits: 0, big: { above: 1000, unit: 'kN', factor: 1e-3, digits: 1 } },
    torque: { unit: 'N·m', factor: 1, digits: 0, big: { above: 1000, unit: 'kN·m', factor: 1e-3, digits: 1 } },
    mass: { unit: 'kg', factor: 1, digits: 1 },
    length: { unit: 'm', factor: 1, digits: 2 },
    shortLength: { unit: 'cm', factor: 100, digits: 0 },
    speed: { unit: 'km/h', factor: 3.6, digits: 0 },
    velocity: { unit: 'm/s', factor: 1, digits: 1 },
    accel: { unit: 'm/s²', factor: 1, digits: 1 },
    volume: { unit: 'L', factor: 1000, digits: 0 },
    pressure: { unit: 'bar', factor: 1e-5, digits: 0 },
    power: { unit: 'W', factor: 1, digits: 0, big: { above: 1e5, unit: 'MW', factor: 1e-6, digits: 1 } },
    impulse: { unit: 'N·s', factor: 1, digits: 0, big: { above: 1000, unit: 'kN·s', factor: 1e-3, digits: 1 } },
    area: { unit: 'm²', factor: 1, digits: 1 },
  },
  imperial: {
    force: { unit: 'lbf', factor: 0.2248089, digits: 0 },
    torque: { unit: 'lbf·ft', factor: 0.7375621, digits: 0 },
    mass: { unit: 'lb', factor: 2.2046226, digits: 0 },
    length: { unit: 'ft', factor: 3.2808399, digits: 1 },
    shortLength: { unit: 'in', factor: 39.370079, digits: 1 },
    speed: { unit: 'mph', factor: 2.2369363, digits: 0 },
    velocity: { unit: 'ft/s', factor: 3.2808399, digits: 1 },
    accel: { unit: 'ft/s²', factor: 3.2808399, digits: 1 },
    volume: { unit: 'gal', factor: 264.17205, digits: 0 },
    pressure: { unit: 'psi', factor: 1.4503774e-4, digits: 0 },
    power: { unit: 'hp', factor: 1.3410221e-3, digits: 0 },
    impulse: { unit: 'lbf·s', factor: 0.2248089, digits: 0 },
    area: { unit: 'ft²', factor: 10.76391, digits: 1 },
  },
};

const STORAGE_KEY = 'flyingcar:units';
let current: UnitSystem = (() => {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return v === 'si' || v === 'imperial' ? v : 'imperial';
  } catch {
    return 'imperial';
  }
})();
const listeners = new Set<(u: UnitSystem) => void>();

export const unitSystem = (): UnitSystem => current;

export function setUnitSystem(u: UnitSystem) {
  if (u === current) return;
  current = u;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, u);
  } catch {
    /* storage unavailable — keep the choice for this session only */
  }
  listeners.forEach((f) => f(u));
}

export function onUnitsChange(f: (u: UnitSystem) => void) {
  listeners.add(f);
}

/** Display value in the base unit of the quantity (no auto-scaling). */
export const toDisplay = (q: Quantity, si: number): number => si * TABLE[current][q].factor;
export const fromDisplay = (q: Quantity, v: number): number => v / TABLE[current][q].factor;
export const unitOf = (q: Quantity): string => TABLE[current][q].unit;
export const digitsOf = (q: Quantity): number => TABLE[current][q].digits;

const nf = new Map<number, Intl.NumberFormat>();
export function num(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '—';
  let f = nf.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    nf.set(digits, f);
  }
  return f.format(v);
}

/** Format an SI value in the current system, switching to the larger unit where defined. */
export function fmt(q: Quantity, si: number, digits?: number): string {
  if (!Number.isFinite(si)) return '—';
  const d = TABLE[current][q];
  const v = si * d.factor;
  if (d.big && Math.abs(v) >= d.big.above) return `${num(si * d.big.factor, digits ?? d.big.digits)} ${d.big.unit}`;
  return `${num(v, digits ?? d.digits)} ${d.unit}`;
}

/** Unit and scale for a chart axis showing values up to `maxSi`, so ticks stay readable. */
export function axisUnit(q: Quantity, maxSi: number): { unit: string; factor: number } {
  const d = TABLE[current][q];
  if (d.big && Math.abs(maxSi * d.factor) >= d.big.above) return { unit: d.big.unit, factor: d.big.factor };
  return { unit: d.unit, factor: d.factor };
}

/** Unit for input fields: as display, except SI forces are entered in kN rather than N. */
export function inputUnit(q: Quantity): { unit: string; factor: number } {
  if (current === 'si' && q === 'force') return { unit: 'kN', factor: 1e-3 };
  return { unit: TABLE[current][q].unit, factor: TABLE[current][q].factor };
}
