import { describe, expect, it } from 'vitest';
import readme from '../README.md?raw';
import { DEFAULT_PARAMS } from '../src/physics/params';
import { SETTINGS, checkValue, parseDecimal, validateSettings } from '../src/physics/settings';
import { parseQuery, toQuery } from '../src/ui/query';

describe('settings in the URL', () => {
  it('has every default inside its allowed range', () => {
    for (const s of SETTINGS) expect(checkValue(s, DEFAULT_PARAMS[s.key] as number), s.key).toBeNull();
  });

  it('reads settings and the flight model from the query string', () => {
    const r = parseQuery('?mass=1500&apexHeight=8&model=ideal&rollTurns=-2&apexX=%E2%88%928');
    expect(r.problems).toEqual([]);
    expect(r.params).toEqual({ mass: 1500, apexHeight: 8, rollTurns: -2, apexX: -8 }); // − (U+2212) is a minus
    expect(r.model).toBe('ideal');
  });

  it('ignores and reports bad values and repeats, naming the raw value', () => {
    const r = parseQuery(
      '?mass=abc&apexHeight=99&rollTurns=1.5&model=rocket&range=20&range=30&seed=&controlRate=0x10&cgHeight=1e999',
    );
    expect(r.params).toEqual({ range: 20 });
    expect(r.model).toBeUndefined();
    const all = r.problems.join('\n');
    expect(r.problems).toHaveLength(8);
    expect(all).toMatch(/seed=: seed must be a number/);
    expect(all).toMatch(/mass=abc: mass must be a number/);
    expect(all).toMatch(/apexHeight=99: apexHeight must be between 3 and 10 m/);
    expect(all).toMatch(/rollTurns=1.5: rollTurns must be a whole number/);
    expect(all).toMatch(/model=rocket: model must be controlled or ideal/);
    expect(all).toMatch(/range= appears more than once/);
    expect(all).toMatch(/controlRate=0x10: controlRate must be a number/); // no hex
    expect(all).toMatch(/cgHeight=1e999: cgHeight must be between/); // too big, not "not a number"
  });

  it('keeps parameters that are not settings, and flags likely typos', () => {
    const r = parseQuery('?utm_source=news&mas=1500&fbclid=AbC');
    expect(r.params).toEqual({});
    expect(r.foreign).toEqual([
      ['utm_source', 'news'],
      ['mas', '1500'],
      ['fbclid', 'AbC'],
    ]);
    expect(r.problems).toEqual(['mas=1500: not a setting. Did you mean mass?']);
    expect(toQuery({ ...DEFAULT_PARAMS, mass: 1500 }, 'controlled', r.foreign)).toBe(
      '?mass=1500&utm_source=news&mas=1500&fbclid=AbC',
    );
  });

  it('reads the setting to explore, and writes it after the settings', () => {
    const r = parseQuery('?explore=apexHeight&mass=1500');
    expect(r.explore).toBe('apexHeight');
    expect(r.problems).toEqual([]);
    expect(r.foreign).toEqual([]); // the page writes it back itself (and a what-if's URL leaves it out)
    expect(toQuery({ ...DEFAULT_PARAMS, mass: 1500 }, 'controlled', r.foreign, r.explore)).toBe(
      '?mass=1500&explore=apexHeight',
    );
    const bad = parseQuery('?explore=apexHieght');
    expect(bad.explore).toBeUndefined();
    expect(bad.foreign).toEqual([]);
    expect(bad.problems).toEqual(['explore=apexHieght: not a setting. Did you mean apexHeight?']);
    const twice = parseQuery('?explore=mass&explore=range');
    expect(twice.explore).toBe('mass');
    expect(twice.foreign).toEqual([]);
    expect(twice.problems).toEqual(['explore= appears more than once; only the first is read']);
  });

  it('parses plain decimals only', () => {
    for (const ok of ['1', '-2.5', '+3', '.5', '5.', '1e3', '2.5E-2', '−4'])
      expect(Number.isNaN(parseDecimal(ok)), ok).toBe(false);
    for (const bad of ['', ' ', '0x10', '0b11', '0o7', 'Infinity', '1,5', '1 2', '--1', 'e5', '1e'])
      expect(parseDecimal(bad), bad).toBeNaN();
  });

  it('validates tool-style changes the same way', () => {
    const v = validateSettings({ mass: 1800, seed: 2.5, length: 5, apexX: '−1' }, 'ideal');
    expect(v.accepted).toEqual({ mass: 1800, apexX: -1 });
    expect(v.model).toBe('ideal');
    expect(v.problems).toEqual(['seed must be a whole number', 'length is a fixed constant, not a setting']);
    expect(parseQuery('?airDensity=1&mass=abc&mass=1500').problems).toEqual([
      'airDensity=1: a fixed constant of the model, not a setting',
      'mass= appears more than once; only the first is read',
      'mass=abc: mass must be a number',
    ]);
  });

  it('is documented in the README: every setting once, with its unit, default and range', () => {
    const num = (s: string) => Number(s.trim().replace('−', '-'));
    const rows = [
      // (Cells may be padded to align the columns.)
      ...readme.matchAll(/^\| `(\w+)` +\| [^|]+ \| ([^|]+) \| ([^|]+) \| ([^|–]+) – ([\d.]+)(, whole)? *\|$/gm),
    ];
    expect(rows.map((m) => m[1]).sort()).toEqual(SETTINGS.map((s) => s.key).sort()); // each exactly once
    for (const m of rows) {
      const s = SETTINGS.find((x) => x.key === m[1])!;
      expect([num(m[3]), num(m[4]), num(m[5])], s.key).toEqual([DEFAULT_PARAMS[s.key], s.min, s.max]);
      expect(!!m[6], `${s.key} whole`).toBe(s.integer);
      if (s.unit) expect(m[2].trim(), `${s.key} unit`).toBe(s.unit);
    }
  });

  it('writes only what differs from the defaults, and round-trips', () => {
    expect(toQuery({ ...DEFAULT_PARAMS }, 'controlled')).toBe('');
    const p = {
      ...DEFAULT_PARAMS,
      mass: 1234.5,
      apexX: -6,
      tankPressure: 25e6,
      thrustScatter: 0.1 + 0.02,
      apexHeight: 7.5110399931432195,
    };
    const q = toQuery(p, 'ideal');
    expect(q).toBe(
      '?apexHeight=7.5110399931&apexX=-6&mass=1234.5&tankPressure=25000000&thrustScatter=0.12&model=ideal',
    );
    const back = parseQuery(q);
    expect(back.problems).toEqual([]);
    expect(back.model).toBe('ideal');
    for (const [k, v] of Object.entries(back.params))
      expect(Math.abs(v - (p as Record<string, number>)[k])).toBeLessThanOrEqual(1.01e-11 * Math.abs(v));
    // Never more than 12 significant digits.
    for (const v of new URLSearchParams(q).values())
      if (/\d/.test(v)) expect(v.replace(/[-.]|e.*$/g, '').replace(/^0+/, '').length).toBeLessThanOrEqual(12);
  });
});
