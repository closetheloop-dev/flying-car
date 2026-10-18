import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type Params } from '../src/physics/params';
import { SETTINGS, type FlightMode, type SettingKey } from '../src/physics/settings';
import { computeTimeline, type Timeline } from '../src/physics/timeline';
import { simulateControlled } from '../src/physics/closedloop';
import { toQuery } from '../src/ui/query';
import { toolDefinitions, type ToolHost } from '../src/ui/webmcp';

const run = (p: Params, m: FlightMode) => {
  const ideal = computeTimeline({ ...p });
  return m === 'controlled' ? simulateControlled(ideal) : ideal;
};

/** A stand-in for the page (starting in the ideal model), with calls recorded. */
function fakeHost() {
  let params: Params = { ...DEFAULT_PARAMS };
  let model: FlightMode = 'ideal';
  let tl: Timeline = computeTimeline(params);
  let foreign: [string, string][] = [];
  let explore: SettingKey | null = null;
  const calls: string[] = [];
  const host: ToolHost = {
    params: () => ({ ...params }),
    model: () => model,
    timeline: () => tl,
    simulate: (p, m) => {
      calls.push(`simulate:${m}`);
      return run(p, m);
    },
    apply: (changes, m, reset, f, e) => {
      calls.push('apply');
      params = { ...(reset ? DEFAULT_PARAMS : params), ...changes };
      if (m) model = m;
      if (f) foreign = f;
      if (e !== undefined) explore = e;
      tl = run(params, model);
    },
    // (As the page: its own URL carries the setting explored, a what-if's doesn't.)
    url: (p, m) => `http://app/${p ? toQuery(p, m ?? model, foreign) : toQuery(params, model, foreign, explore)}`,
    seek: () => calls.push('seek'),
    play: () => calls.push('play'),
    camera: (c) => calls.push(`camera:${c}`),
    frameIncident: (k, play) => {
      calls.push(`frame:${k}:${play}`);
      return k < tl.incidents.length;
    },
    view: () => ({ t: 0, playing: false, camera: 'front' }),
  };
  return { host, calls };
}

async function call(host: ToolHost, name: string, input: Record<string, unknown> = {}) {
  const tool = toolDefinitions(host).find((t) => t.name === name)!;
  const out = (await tool.execute(input, { signal: new AbortController().signal })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { isError: !!out.isError, data: JSON.parse(out.content[0].text) };
}

describe('WebMCP tools', () => {
  it('describe every setting with its unit and range', () => {
    const { host } = fakeHost();
    const tools = toolDefinitions(host);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'find_feasible',
      'get_results',
      'get_settings',
      'get_state_at',
      'load_url',
      'set_settings',
      'show',
      'simulate',
    ]);
    for (const name of ['set_settings', 'simulate']) {
      const props = (tools.find((t) => t.name === name)!.inputSchema as any).properties.settings.properties as Record<
        string,
        any
      >;
      expect(Object.keys(props).sort()).toEqual(SETTINGS.map((s) => s.key).sort());
      expect(props.mass).toMatchObject({ type: 'number', minimum: 1200, maximum: 3000 });
      expect(props.mass.description).toMatch(/\[kg\]/);
      expect(props.seed.type).toBe('integer');
    }
  });

  it('report the default run as valid, with its forces', async () => {
    const { host } = fakeHost();
    const { data: out } = await call(host, 'get_results');
    expect(out.settingsChangedFromDefaults).toEqual({});
    const data = out.results;
    expect(data.valid).toBe(true);
    expect(data.flies).toBe(true);
    expect(data.incidents).toEqual([]);
    expect(data.launch.thrust_N).toBeGreaterThan(60_000);
    expect(data.nitrogen_kg).toBeGreaterThan(50);
  });

  it('simulate a heavier car without changing the page', async () => {
    const { host, calls } = fakeHost();
    const light = (await call(host, 'simulate', { settings: { mass: 1500 } })).data.results;
    const heavyRun = (await call(host, 'simulate', { settings: { mass: 2500 } })).data;
    const heavy = heavyRun.results;
    expect(calls).toEqual(['simulate:ideal', 'simulate:ideal']); // never applied
    expect(heavyRun.settingsChangedFromDefaults).toEqual({ mass: 2500 });
    expect(heavyRun.url).toBe('http://app/?mass=2500&model=ideal');
    expect(heavy.forces).toBe('required by the ideal flight');
    // The same flight needs thrust and gas in proportion to the mass.
    expect(heavy.launch.thrust_N / light.launch.thrust_N).toBeCloseTo(2500 / 1500, 1);
    expect(heavy.nitrogen_kg).toBeGreaterThan(light.nitrogen_kg);
  });

  it('apply valid settings, list rejected ones, and refuse a call that changes nothing', async () => {
    const { host, calls } = fakeHost();
    const r = await call(host, 'set_settings', { settings: { mass: 1800, apexX: -6, wings: 2, seed: 1.5 } });
    expect(r.isError).toBe(false);
    expect(r.data.applied).toEqual({ mass: 1800, apexX: -6 });
    expect(r.data.rejected).toEqual(['wings is not a setting', 'seed must be a whole number']);
    expect(r.data.results.valid).toBe(false);
    expect(r.data.results.incidents.map((i: any) => i.hits)).toContain('Model 3');
    const none = await call(host, 'set_settings', { settings: { mass: 99999 } });
    expect(none.isError).toBe(true);
    expect(calls.filter((c) => c === 'apply')).toHaveLength(1);
    const reset = await call(host, 'set_settings', { reset: true });
    expect(reset.data.results.valid).toBe(true);
  });

  it('simulate in the model asked for, and report closed-loop forces as delivered', async () => {
    const { host, calls } = fakeHost();
    const cl = (await call(host, 'simulate', { model: 'controlled' })).data.results;
    expect(calls).toEqual(['simulate:controlled']);
    expect(cl.flightModel).toBe('controlled');
    expect(cl.forces).toBe('delivered in the closed-loop flight');
    expect(cl.closedLoop.valvePulses).toBeGreaterThan(0);
    // Too little thrust to climb: the plan exists, but no flight happens.
    const weak = (await call(host, 'simulate', { model: 'controlled', settings: { liftThrusterMax: 5000 } })).data
      .results;
    expect(weak.planFeasible).toBe(true);
    expect(weak.flies).toBe(false);
    expect(weak.incidents[0].kind).toBe('no-flight');
  });

  it('reject misplaced or mistyped arguments instead of ignoring them', async () => {
    const { host, calls } = fakeHost();
    const bare = await call(host, 'simulate', { mass: 2400 });
    expect(bare.isError).toBe(true);
    expect(bare.data.error).toMatch(/put it inside "settings"/);
    for (const [name, input] of [
      ['set_settings', { mass: 2400 }],
      ['set_settings', {}],
      ['set_settings', { reset: 'yes' }],
      ['set_settings', { settings: 'mass=2400' }],
      ['set_settings', { settings: null }],
      ['get_results', { verbose: true }],
      ['get_state_at', { t: null }],
      ['get_state_at', { t: '' }],
      ['get_state_at', {}],
      ['show', { play: 'true' }],
      ['show', { camera: 'top', incident: 0 }],
      ['show', {}],
    ] as const) {
      expect(
        (await call(host, name, input as Record<string, unknown>)).isError,
        `${name} ${JSON.stringify(input)}`,
      ).toBe(true);
    }
    expect(calls.filter((c) => c === 'apply' || c.startsWith('camera') || c === 'seek' || c === 'play')).toEqual([]);
    // Several moments at once, and times outside the run are said to be clamped.
    const series = (await call(host, 'get_state_at', { times: [0, 1, 2] })).data;
    expect(series.map((s: any) => s.t_s)).toEqual([0, 1, 2]);
    expect((await call(host, 'get_state_at', { t: 1e9 })).data.note).toMatch(/outside the run/);
  });

  it('report each nozzle against its rating and the clearance over each vehicle', async () => {
    const { host } = fakeHost();
    const res = (await call(host, 'get_results')).data.results;
    expect(res.thrusters.each.map((e: any) => e.id)).toEqual(['FL', 'FR', 'RL', 'RR', 'SL', 'SR']);
    expect(res.thrusters.lift.rating_N).toBe(DEFAULT_PARAMS.liftThrusterMax);
    expect(res.thrusters.lift.use_pct).toBeGreaterThan(40);
    expect(res.thrusters.side.peak_N).toBeLessThan(res.thrusters.lift.peak_N);
    const semi = res.clearanceBySolid.find((c: any) => c.solid === 'Semi');
    expect(semi.gap_m).toBeGreaterThan(2); // well over the Semi's roof
  });

  it('take numbers as numbers, suggest near-miss names, and can start from the defaults', async () => {
    const { host } = fakeHost();
    const str = await call(host, 'simulate', { settings: { mass: '2400' } });
    expect(str.isError).toBe(true);
    expect(str.data.rejected).toEqual(['mass must be a number (got the string "2400")']);
    expect((await call(host, 'simulate', { settings: { mas: 2400 } })).data.rejected).toEqual([
      'mas is not a setting. Did you mean mass?',
    ]);
    await call(host, 'set_settings', { settings: { apexX: -6 } });
    const fresh = (await call(host, 'simulate', { fromDefaults: true, settings: { mass: 2400 } })).data;
    expect(fresh.settingsChangedFromDefaults).toEqual({ mass: 2400 });
    expect(fresh.results.valid).toBe(true);
    const onPage = (await call(host, 'simulate', { settings: { mass: 2400 } })).data;
    expect(onPage.settingsChangedFromDefaults).toEqual({ apexX: -6, mass: 2400 });
  });

  it('frame an incident and pause exactly at it on request', async () => {
    const { host, calls } = fakeHost();
    await call(host, 'set_settings', { settings: { apexX: -6 } });
    expect((await call(host, 'show', { incident: 0, play: false })).isError).toBe(false);
    expect((await call(host, 'show', { incident: 0 })).isError).toBe(false);
    expect((await call(host, 'show', { incident: 0, t: 2 })).isError).toBe(true);
    expect(calls.filter((c) => c.startsWith('frame'))).toEqual(['frame:0:false', 'frame:0:true']);
  });

  it('list the settings keyed by name, with values that can be passed straight back', async () => {
    const { host } = fakeHost();
    const s = (await call(host, 'get_settings')).data;
    expect(s.values.mass).toBe(DEFAULT_PARAMS.mass);
    expect(Object.keys(s.settings).sort()).toEqual(SETTINGS.map((x) => x.key).sort());
    expect(s.settings.mass).toMatchObject({
      unit: 'kg',
      min: 1200,
      max: 3000,
      default: DEFAULT_PARAMS.mass,
      value: DEFAULT_PARAMS.mass,
    });
    // What each setting and flight model means, as the Lab and the reference page say.
    for (const k of Object.keys(s.settings)) expect(s.settings[k].description, k).toMatch(/\S.*\.$/);
    expect(Object.keys(s.flightModels).sort()).toEqual(['controlled', 'ideal']);
    const back = await call(host, 'simulate', { settings: s.values });
    expect(back.isError).toBe(false);
    expect(back.data.settingsChangedFromDefaults).toEqual({});
  });

  it('load the setting explored with a URL, and none without', async () => {
    const { host } = fakeHost();
    expect((await call(host, 'load_url', { url: '?explore=range&mass=2600' })).data.url).toBe(
      'http://app/?mass=2600&explore=range',
    );
    // A what-if's URL is for its settings alone.
    expect((await call(host, 'simulate', { settings: { mass: 2400 } })).data.url).toBe('http://app/?mass=2400');
    expect((await call(host, 'load_url', { url: '?mass=2200' })).data.url).toBe('http://app/?mass=2200');
  });

  it('load a settings URL the way opening it would', async () => {
    const { host } = fakeHost();
    await call(host, 'set_settings', { settings: { apexX: -6 } });
    const r = (await call(host, 'load_url', { url: 'http://app/?mass=2600&model=ideal&utm_source=x&mas=1' })).data;
    expect(r.applied).toEqual({ mass: 2600 });
    expect(host.params().apexX).toBe(DEFAULT_PARAMS.apexX); // from the defaults, not the page's settings
    expect(r.flightModel).toBe('ideal');
    expect(r.rejected).toEqual(['mas=1: not a setting. Did you mean mass?']);
    expect(r.settingsChangedFromDefaults).toEqual({ mass: 2600 });
    expect(r.results.flies).toBe(true);
    // Parameters that aren't settings stay in the page URL, as opening the URL keeps them.
    expect(r.url).toBe('http://app/?mass=2600&model=ideal&utm_source=x&mas=1');
    // Just the query works too, and a URL without a model opens in the default one.
    expect((await call(host, 'load_url', { url: '?apexHeight=9' })).data.applied).toEqual({ apexHeight: 9 });
    expect(host.model()).toBe('controlled');
    expect((await call(host, 'load_url', { url: 'mass=1500' })).data.error).toMatch(/did you mean "\?mass=1500"/);
    for (const input of [
      { url: 'http://elsewhere/?mass=2600' },
      { url: 'http://app/other?mass=2600' },
      {},
      { url: 2600 },
      { url: '' },
      { url: '  ' },
    ]) {
      expect((await call(host, 'load_url', input)).isError, JSON.stringify(input)).toBe(true);
    }
  });

  it('report an infeasible plan as one, with the same keys, and find the nearest feasible values', async () => {
    const { host } = fakeHost();
    const ok = (await call(host, 'get_results')).data.results;
    const bad = (await call(host, 'simulate', { settings: { apexHeight: 9.6 } })).data.results;
    expect(bad.planFeasible).toBe(false);
    expect(bad.flies).toBe(false);
    expect(bad.incidents.map((i: any) => i.kind)).toEqual(['infeasible-plan']);
    expect(bad.incidents[0].message).toMatch(/Air time .* too short/);
    expect(bad.hint).toMatch(/find_feasible/);
    expect(ok.hint).toBeNull();
    // Every key of a flying run is there (null), so clients can read them either way.
    for (const k of Object.keys(ok)) expect(bad, k).toHaveProperty(k);
    expect(bad.peakThrust_N).toBeNull();
    expect(bad.thrusters).toBeNull();
    expect(bad.closedLoop).toBeNull();
    const badClosedLoop = (await call(host, 'simulate', { model: 'controlled', settings: { apexHeight: 9.6 } })).data
      .results;
    expect(badClosedLoop.closedLoop).toBeNull();
    for (const k of Object.keys(ok)) expect(badClosedLoop, k).toHaveProperty(k);

    const found = (await call(host, 'find_feasible', { settings: { apexHeight: 9.6 }, vary: ['airTimeVideo'] })).data;
    expect(found.planFeasible).toBe(false);
    const [edge] = found.edges;
    expect(edge).toMatchObject({ setting: 'airTimeVideo', value: DEFAULT_PARAMS.airTimeVideo, planFeasible: false });
    expect(edge.above).toBeGreaterThan(DEFAULT_PARAMS.airTimeVideo);
    const fixed = (await call(host, 'simulate', { settings: { apexHeight: 9.6, airTimeVideo: edge.above } })).data
      .results;
    expect(fixed.planFeasible).toBe(true);
    // For a feasible plan: the window the setting can move in, and it stays feasible inside it.
    const win = (await call(host, 'find_feasible', { vary: ['rollDurationVideo'] })).data.edges[0];
    expect(win.planFeasible).toBe(true);
    expect(win.below).toBeLessThan(DEFAULT_PARAMS.rollDurationVideo);
    expect(win.above).toBeGreaterThan(DEFAULT_PARAMS.rollDurationVideo);
    for (const v of [win.below, win.above]) {
      expect(
        (await call(host, 'simulate', { settings: { rollDurationVideo: v } })).data.results.planFeasible,
        String(v),
      ).toBe(true);
    }
    // Whole-number settings get whole-number edges, which simulate accepts.
    const turns = (await call(host, 'find_feasible', { vary: ['rollTurns'] })).data.edges[0];
    for (const v of [turns.below, turns.above]) {
      expect(Number.isInteger(v), String(v)).toBe(true);
      expect((await call(host, 'simulate', { settings: { rollTurns: v } })).data.results.planFeasible).toBe(true);
    }
    expect((await call(host, 'find_feasible', { vary: ['rolDurationVideo'] })).data.error).toBe(
      '"rolDurationVideo" is not a setting. Did you mean rollDurationVideo?',
    );
    expect((await call(host, 'find_feasible', { vary: ['wings'] })).data.error).toBe('"wings" is not a setting.');
    expect((await call(host, 'find_feasible', { vary: ['model'] })).data.error).toMatch(/flight model/);
    expect((await call(host, 'find_feasible', { vary: [] })).isError).toBe(true);
  }, 180_000);

  it('refuse invalid what-ifs, times and cameras', async () => {
    const { host } = fakeHost();
    expect((await call(host, 'simulate', { settings: { mass: 'heavy' } })).isError).toBe(true);
    expect((await call(host, 'get_state_at', { t: 'soon' })).isError).toBe(true);
    expect((await call(host, 'show', { camera: 'drone' })).isError).toBe(true);
    expect((await call(host, 'show', { incident: 3 })).isError).toBe(true);
    const s = await call(host, 'get_state_at', { t: 1.5 });
    expect(s.data.airborne).toBe(true);
    expect(s.data.position_m[1]).toBeGreaterThan(7);
  });
});
