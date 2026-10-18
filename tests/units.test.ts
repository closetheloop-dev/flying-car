import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/physics/params';
import { computeTimeline } from '../src/physics/timeline';
import { incidentLabel, incidentText } from '../src/ui/incidents';
import { axisUnit, fmt, fromDisplay, inputUnit, setUnitSystem, toDisplay, unitSystem } from '../src/ui/units';

describe('units', () => {
  it('defaults to Imperial', () => {
    expect(unitSystem()).toBe('imperial');
  });

  it('converts with standard factors and round-trips', () => {
    setUnitSystem('imperial');
    expect(toDisplay('force', 4.4482216)).toBeCloseTo(1, 6); // 1 lbf
    expect(toDisplay('length', 0.3048)).toBeCloseTo(1, 6); // 1 ft
    expect(toDisplay('mass', 0.45359237)).toBeCloseTo(1, 6); // 1 lb
    expect(toDisplay('torque', 1.3558179)).toBeCloseTo(1, 6); // 1 lbf·ft
    expect(toDisplay('pressure', 6894.757)).toBeCloseTo(1, 5); // 1 psi
    expect(fromDisplay('speed', toDisplay('speed', 11.7))).toBeCloseTo(11.7, 9);
  });

  it('formats in the active system, switching to larger SI units where sensible', () => {
    setUnitSystem('imperial');
    expect(fmt('force', 70_000)).toBe('15,737 lbf');
    setUnitSystem('si');
    expect(fmt('force', 70_000)).toBe('70.0 kN');
    expect(fmt('force', 850)).toBe('850 N');
    expect(axisUnit('torque', 12_500)).toEqual({ unit: 'kN·m', factor: 1e-3 });
    expect(inputUnit('force')).toEqual({ unit: 'kN', factor: 1e-3 });
    setUnitSystem('imperial');
  });
});

describe('incident text', () => {
  it('uses the display units, and plain wording for times', () => {
    const tl = computeTimeline({ ...DEFAULT_PARAMS, range: 16, touchdownSpeed: 5, suspensionTravel: 0.04 });
    const hit = tl.incidents.find((i) => i.kind === 'collision' && i.phase === 'approach')!;
    const hard = tl.incidents.find((i) => i.kind === 'hard-landing')!;
    setUnitSystem('imperial');
    expect(incidentText(hit)).toMatch(/s before liftoff, up to [\d.]+ (ft|in) deep\.$/);
    expect(incidentText(hit)).not.toMatch(/−[\d.]+ s before/);
    expect(incidentLabel(hard)).toMatch(/ft\/s$/);
    setUnitSystem('si');
    expect(incidentText(hit)).toMatch(/up to [\d.]+ (m|cm) deep\.$/);
    expect(incidentText(hard)).toMatch(/m\/s at touchdown/);
    setUnitSystem('imperial');
  });
});
