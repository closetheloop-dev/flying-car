import { FEASIBILITY_KEYS, feasibleEdges } from '../physics/feasible';
import { DEFAULT_PARAMS, type Params } from '../physics/params';
import { runReport, stateAt } from '../physics/report';
import { MODE_DOCS, SETTING_DOCS } from '../physics/setting-docs';
import {
  DEFAULT_FLIGHT_MODE,
  FLIGHT_MODES,
  SETTINGS,
  SETTING_BY_KEY,
  VIDEO_TIME_NOTE,
  suggestSetting,
  validateSettings,
  type FlightMode,
  type SettingKey,
} from '../physics/settings';
import type { Timeline } from '../physics/timeline';
import { parseQuery } from './query';

/** What the tools need from the app. */
export interface ToolHost {
  params(): Params;
  model(): FlightMode;
  timeline(): Timeline;
  /** Run the simulation for these settings without changing the page. */
  simulate(params: Params, model: FlightMode): Timeline;
  /**
   * Apply validated changes to the page (panel, URL, 3D view); `reset` first restores the
   * defaults; `foreign`, if given, replaces the page URL's parameters that aren't settings,
   * and `explore` the setting explored (null: none).
   */
  apply(
    changes: Partial<Params>,
    model: FlightMode | undefined,
    reset: boolean,
    foreign?: [string, string][],
    explore?: SettingKey | null,
  ): void;
  /** The page URL for these settings (the current ones if omitted). */
  url(params?: Params, model?: FlightMode): string;
  seek(t: number): void;
  play(on: boolean): void;
  camera(name: string): void;
  /** Frame an incident; play it from just before, or pause exactly at it. */
  frameIncident(index: number, play: boolean): boolean;
  /** The view: time, whether it is playing, and the camera ('custom' after framing). */
  view(): { t: number; playing: boolean; camera: string };
}

export const CAMERAS = ['front', 'video', 'end', 'chase', 'top'] as const;
/** Most moments one get_state_at call returns. */
const MAX_TIMES = 200;

/** JSON Schema for a settings object: every setting, with its unit and range. */
const settingsSchema = {
  type: 'object',
  description: `Settings to change, by name, in SI units (get_settings lists every setting with its unit, range and current value). ${VIDEO_TIME_NOTE}`,
  properties: Object.fromEntries(
    SETTINGS.map((s) => [
      s.key,
      {
        type: s.integer ? 'integer' : 'number',
        minimum: s.min,
        maximum: s.max,
        description: `${s.label.replace(/\s*\((s|°|g|Hz|rad\/s|fraction)\)$/, '')}${s.displayUnit ? ` [${s.displayUnit}]` : ''}. Default ${DEFAULT_PARAMS[s.key]}.`,
      },
    ]),
  ),
  additionalProperties: false,
} as const;

const modelSchema = {
  type: 'string',
  enum: FLIGHT_MODES,
  description:
    "Flight model: 'controlled' simulates a flight controller flying through disturbances (forces are those delivered); 'ideal' is the exact thrust the fitted path requires.",
} as const;

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] });
const fail = (message: string, data: Record<string, unknown> = {}) => ({
  ...text({ error: message, ...data }),
  isError: true,
});

class InputError extends Error {}

/** Reject unknown top-level arguments, pointing a misplaced setting at the right shape. */
function checkKeys(input: Record<string, unknown>, allowed: string[]) {
  for (const k of Object.keys(input)) {
    if (allowed.includes(k)) continue;
    if (SETTING_BY_KEY.has(k as SettingKey) && allowed.includes('settings')) {
      throw new InputError(
        `${k} is a setting: put it inside "settings", e.g. {"settings": {"${k}": ${JSON.stringify(input[k])}}}.`,
      );
    }
    throw new InputError(
      `Unknown argument "${k}"; this tool takes ${allowed.length ? allowed.map((a) => `"${a}"`).join(', ') : 'no arguments'}.`,
    );
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function settingsArg(input: Record<string, unknown>): Record<string, unknown> {
  if (input.settings === undefined) return {};
  if (!isPlainObject(input.settings))
    throw new InputError('"settings" must be an object of setting names to numbers, e.g. {"mass": 2400}.');
  return input.settings;
}

function numberArg(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new InputError(`"${name}" must be a number.`);
  return v;
}

/** The settings that differ from the defaults (what makes this run different). */
const nonDefault = (p: Params) =>
  Object.fromEntries(SETTINGS.filter((s) => p[s.key] !== DEFAULT_PARAMS[s.key]).map((s) => [s.key, p[s.key]]));

/** Wrap a tool body so bad input and unexpected errors come back as error results, not exceptions. */
function guarded(body: (input: Record<string, unknown>) => unknown) {
  const failWith = (e: unknown) =>
    fail(e instanceof InputError ? e.message : `The tool failed: ${String((e as Error)?.message ?? e)}`);
  return (input: Record<string, unknown> = {}) => {
    try {
      if (!isPlainObject(input)) throw new InputError('Arguments must be an object.');
      const out = body(input);
      return out instanceof Promise ? out.catch(failWith) : out;
    } catch (e) {
      return failWith(e);
    }
  };
}

/** A run's results, pointing at find_feasible when no flight plan meets the settings. */
function results(tl: Timeline, model: FlightMode) {
  const report = runReport(tl, model);
  return {
    ...report,
    hint: report.planFeasible
      ? null
      : 'No flight plan meets these settings. find_feasible gives the nearest values of the settings the plan hinges on (air time, apex, roll duration, sustained thrust) that make it feasible.',
  };
}

/**
 * The run on the page, as every tool that returns results ends: the flight model, the
 * settings that differ from the defaults, the page URL, and the results.
 */
function onPage(host: ToolHost) {
  return {
    flightModel: host.model(),
    settingsChangedFromDefaults: nonDefault(host.params()),
    url: host.url(),
    results: results(host.timeline(), host.model()),
  };
}

/** Settings changes and where to start from, as simulate and find_feasible take them. */
function whatIf(host: ToolHost, input: Record<string, unknown>) {
  if (input.fromDefaults !== undefined && typeof input.fromDefaults !== 'boolean')
    throw new InputError('"fromDefaults" must be true or false.');
  const v = validateSettings(settingsArg(input), input.model, { numbersOnly: true });
  return { v, params: { ...(input.fromDefaults ? DEFAULT_PARAMS : host.params()), ...v.accepted } as Params };
}

/** Let the page draw a frame's worth between plan solves (a long search doesn't freeze it). */
const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The simulator as WebMCP tools (document.modelContext): read and change the settings,
 * run what-if simulations without touching the page, read results and the state at any
 * moment, and drive the view. Settings use the same names, SI units and ranges as the
 * URL parameters.
 */
export function toolDefinitions(host: ToolHost): WebMCP.ModelContextTool[] {
  return [
    {
      name: 'get_settings',
      title: 'Get settings',
      description: `List every adjustable setting of the Flying Car simulation (flyingcar.pet: a Roadster's cold-gas thruster hop and barrel roll over a parked Semi), keyed by name as simulate and set_settings take them: "values" has the current values (pass them, or some of them, straight back as "settings"), and "settings" each one's label, what it does, unit, allowed range, default and group. Also the current flight model (with what each model means) and the shareable page URL. Values are SI. ${VIDEO_TIME_NOTE}`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: guarded((input) => {
        checkKeys(input, []);
        const p = host.params();
        return text({
          flightModel: host.model(),
          flightModels: Object.fromEntries(FLIGHT_MODES.map((m) => [m, MODE_DOCS[m].text])),
          url: host.url(),
          note: VIDEO_TIME_NOTE,
          values: Object.fromEntries(SETTINGS.map((s) => [s.key, p[s.key]])),
          settings: Object.fromEntries(
            SETTINGS.map((s) => [
              s.key,
              {
                label: s.label,
                description: SETTING_DOCS[s.key]?.hint ?? '',
                unit: s.displayUnit,
                group: s.folder,
                value: p[s.key],
                default: DEFAULT_PARAMS[s.key],
                min: s.min,
                max: s.max,
                wholeNumber: s.integer,
              },
            ]),
          ),
        });
      }),
    },
    {
      name: 'set_settings',
      title: 'Change settings',
      description:
        'Change settings on the page (the panel, URL and 3D view follow) and return the new run\'s results (same format as get_results). Put settings inside "settings", in SI units and within range; rejected ones are listed and the rest are applied. "model" switches the flight model. "reset": true restores the footage-matched defaults first (it keeps the flight model unless "model" is given).',
      inputSchema: {
        type: 'object',
        properties: {
          settings: settingsSchema,
          model: modelSchema,
          reset: { type: 'boolean', description: 'Restore all settings to their defaults before applying these.' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: guarded((input) => {
        checkKeys(input, ['settings', 'model', 'reset']);
        const settings = settingsArg(input);
        if (input.reset !== undefined && typeof input.reset !== 'boolean')
          throw new InputError('"reset" must be true or false.');
        const reset = input.reset === true;
        const v = validateSettings(settings, input.model, { numbersOnly: true });
        if (!Object.keys(v.accepted).length && v.model === undefined && !reset) {
          return fail(
            v.problems.length ? 'Nothing was changed.' : 'Nothing to change: give "settings", "model" or "reset".',
            { rejected: v.problems },
          );
        }
        host.apply(v.accepted as Partial<Params>, v.model, reset);
        return text({ applied: v.accepted, rejected: v.problems, ...onPage(host) });
      }),
    },
    {
      name: 'load_url',
      title: 'Open a settings URL',
      description:
        "Load a shareable URL of this page (such as the one simulate, set_settings or get_settings returns) the way opening it would: the defaults, then the URL's settings and flight model (controlled if it names none); parameters that aren't settings stay in the page URL as they are. The page doesn't reload. Also takes just the query string, e.g. \"?mass=2600&apexHeight=10\". Returns what was applied, the URL parameters that were rejected and why, and the page's settings, URL and results (as get_results).",
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'A URL of this page with settings in its query, or just the query ("?mass=2600").',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: guarded((input) => {
        checkKeys(input, ['url']);
        if (typeof input.url !== 'string')
          throw new InputError('"url" must be a string, e.g. "?mass=2600" or this page\'s full URL.');
        const raw = input.url.trim();
        if (!raw)
          throw new InputError(
            '"url" is empty: give this page\'s URL, or a query such as "?mass=2600" ("?" alone opens the defaults).',
          );
        if (!raw.includes('?') && !raw.includes('/') && raw.includes('=')) {
          throw new InputError(`A query starts with "?": did you mean "?${raw}"?`);
        }
        const here = new URL(host.url());
        let u: URL;
        try {
          u = new URL(raw, here);
        } catch {
          throw new InputError(`${JSON.stringify(raw)} is not a URL.`);
        }
        if (u.origin !== here.origin || u.pathname !== here.pathname) {
          throw new InputError(
            `That URL is not this page (${here.origin}${here.pathname}); only this page's settings can be loaded.`,
          );
        }
        const q = parseQuery(u.search);
        host.apply(q.params, q.model ?? DEFAULT_FLIGHT_MODE, true, q.foreign, q.explore ?? null);
        return text({ applied: q.params, rejected: q.problems, ...onPage(host) });
      }),
    },
    {
      name: 'get_results',
      title: 'Get results',
      description:
        'Results of the run currently on the page: "valid" (no problems at all), "flies", any incidents (collisions with a parked vehicle, the stage or the road; hard landing; no feasible flight; can\'t climb), each with when (s from liftoff) and where (m), other warnings, and the forces, gas and loads (required in the ideal model, delivered in the closed-loop model). SI units, named in each key. In events_s, burn, roll and apex times are the plan\'s; touchdown and stop are as flown.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: guarded((input) => {
        checkKeys(input, []);
        return text(onPage(host));
      }),
    },
    {
      name: 'simulate',
      title: 'Simulate (what-if)',
      description:
        'Run the simulation for the page\'s current settings with these changes (or for the defaults with these changes, with "fromDefaults": true), without changing the page, and return its results (same format as get_results) with every setting that differs from the defaults and the URL that would open this run. Use it to explore before committing with set_settings. A run takes about 0.2–4 s.',
      inputSchema: {
        type: 'object',
        properties: {
          settings: settingsSchema,
          model: modelSchema,
          fromDefaults: {
            type: 'boolean',
            description:
              'Start from the footage-matched defaults instead of the page\'s current settings (the flight model is still the page\'s unless "model" is given).',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: guarded((input) => {
        checkKeys(input, ['settings', 'model', 'fromDefaults']);
        const { v, params } = whatIf(host, input);
        if (v.problems.length)
          return fail('Some settings are invalid; nothing was simulated.', { rejected: v.problems });
        const model = v.model ?? host.model();
        const tl = host.simulate(params, model);
        return text({
          changed: v.accepted,
          flightModel: model,
          settingsChangedFromDefaults: nonDefault(params),
          url: host.url(params, model),
          results: results(tl, model),
        });
      }),
    },
    {
      name: 'find_feasible',
      title: 'Find feasible settings',
      description: `Where the flight plan stays (or becomes) feasible as single settings move, each varied on its own with the rest fixed, for the page's settings with these changes (or the defaults with them, with "fromDefaults": true). The page is not changed. For each setting in "vary" (default: ${FEASIBILITY_KEYS.join(', ')}): if the plan is infeasible now, "below" and "above" are the nearest values that make it feasible (null: none within the setting's range); if it is feasible, how far the setting can go down and up and stay feasible (the range's end if it stays feasible that far). Edges are found to about 1/8 of the setting's slider step, and each value returned has been checked to give a feasible plan as reported. A feasible plan includes a landing burn of at most 5 × the car's weight, but plans near an edge use most of that: back off from an edge for an easier flight. Covers the plan only: run simulate on a candidate to check for collisions, the landing and the thruster ratings. Slow: about 3–10 s per setting (up to about 40 s for the default four), as each check solves the plan; the page keeps running meanwhile. Vary fewer settings for a quicker answer.`,
      inputSchema: {
        type: 'object',
        properties: {
          settings: settingsSchema,
          fromDefaults: {
            type: 'boolean',
            description: "Start from the footage-matched defaults instead of the page's current settings.",
          },
          vary: {
            type: 'array',
            items: { type: 'string', enum: SETTINGS.map((s) => s.key) },
            minItems: 1,
            maxItems: 8,
            description: `Settings to vary, one at a time (default: ${FEASIBILITY_KEYS.join(', ')}).`,
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: guarded(async (input) => {
        checkKeys(input, ['settings', 'fromDefaults', 'vary']);
        const { v, params } = whatIf(host, input);
        if (v.problems.length)
          return fail('Some settings are invalid; nothing was searched.', { rejected: v.problems });
        let vary = FEASIBILITY_KEYS;
        if (input.vary !== undefined) {
          if (!Array.isArray(input.vary) || !input.vary.length || input.vary.length > 8)
            throw new InputError('"vary" must be a list of 1 to 8 setting names.');
          for (const k of input.vary) {
            if (k === 'model')
              throw new InputError(
                '"model" is the flight model, not a setting the plan depends on; vary settings only.',
              );
            if (typeof k !== 'string' || !SETTING_BY_KEY.has(k as SettingKey)) {
              const guess = typeof k === 'string' ? suggestSetting(k) : undefined;
              throw new InputError(
                `${JSON.stringify(k)} is not a setting${guess && guess !== 'model' ? `. Did you mean ${guess}?` : '.'}`,
              );
            }
          }
          vary = [...new Set(input.vary as SettingKey[])];
        }
        const edges = [];
        for (const k of vary) edges.push(await feasibleEdges(params, k, yieldToPage));
        return text({ settingsChangedFromDefaults: nonDefault(params), planFeasible: edges[0].planFeasible, edges });
      }),
    },
    {
      name: 'get_state_at',
      title: 'Get the state at a time',
      description: `The car's state in the run on the page at time "t", or at each of up to ${MAX_TIMES} "times" (s from liftoff; negative is the approach): phase, position [x along the flight line, height, sideways] (m), velocity (m/s), roll (deg), total and per-thruster thrust (N), ground reaction (N), mass (kg), driver g-load.`,
      inputSchema: {
        type: 'object',
        properties: {
          t: { type: 'number', description: 'Time from liftoff [s].' },
          times: {
            type: 'array',
            items: { type: 'number' },
            maxItems: MAX_TIMES,
            description: 'Several times from liftoff [s].',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: guarded((input) => {
        checkKeys(input, ['t', 'times']);
        if ((input.t === undefined) === (input.times === undefined))
          throw new InputError('Give either "t" or "times".');
        const tl = host.timeline();
        if (input.t !== undefined) return text(stateAt(tl, numberArg(input.t, 't')));
        if (!Array.isArray(input.times) || input.times.length > MAX_TIMES)
          throw new InputError(`"times" must be an array of at most ${MAX_TIMES} numbers.`);
        return text(input.times.map((t, k) => stateAt(tl, numberArg(t, `times[${k}]`))));
      }),
    },
    {
      name: 'show',
      title: 'Show in the 3D view',
      description:
        'Drive the view on the page: jump to a time, play or pause, pick a camera preset, or frame an incident (by its index in get_results\' incidents). With "incident", it plays from just before the incident; add "play": false to pause exactly at it instead (e.g. for a screenshot). Framing picks its own camera, so give "incident" or "camera", not both, and "incident" or "t", not both. Returns the time, whether it is playing, and the camera.',
      inputSchema: {
        type: 'object',
        properties: {
          t: { type: 'number', description: 'Jump to this time [s from liftoff].' },
          play: { type: 'boolean', description: 'Play (true) or pause (false).' },
          camera: {
            type: 'string',
            enum: CAMERAS,
            description:
              "Camera preset: 'front' (wide), 'video' (the footage's front camera), 'end' (end-on), 'chase', 'top'.",
          },
          incident: { type: 'integer', minimum: 0, description: 'Frame this incident and play it from just before.' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: guarded((input) => {
        checkKeys(input, ['t', 'play', 'camera', 'incident']);
        // Check everything before doing anything.
        if (Object.keys(input).length === 0)
          throw new InputError('Nothing to show: give "t", "play", "camera" or "incident".');
        if (input.camera !== undefined && !(CAMERAS as readonly unknown[]).includes(input.camera))
          throw new InputError(`"camera" must be one of ${CAMERAS.join(', ')}.`);
        if (input.camera !== undefined && input.incident !== undefined)
          throw new InputError('Give "incident" or "camera", not both: framing an incident picks its own camera.');
        if (input.t !== undefined && input.incident !== undefined)
          throw new InputError('Give "incident" or "t", not both: framing an incident sets the time.');
        if (input.play !== undefined && typeof input.play !== 'boolean')
          throw new InputError('"play" must be true or false.');
        const t = input.t === undefined ? undefined : numberArg(input.t, 't');
        const tl = host.timeline();
        if (input.incident !== undefined) {
          const k = input.incident;
          if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k >= tl.incidents.length) {
            throw new InputError(
              `There is no incident ${JSON.stringify(k)}; get_results lists ${tl.incidents.length} (indices from 0).`,
            );
          }
          host.frameIncident(k, input.play !== false);
        } else {
          if (input.camera !== undefined) host.camera(input.camera as string);
          if (t !== undefined) host.seek(t);
          if (input.play !== undefined) host.play(input.play as boolean);
        }
        const v = host.view();
        // The tool runs synchronously, so the view's time is still where the seek put it.
        const clamped = t !== undefined && Math.abs(v.t - t) > tl.dt * 2;
        return text({
          t_s: Number(v.t.toFixed(3)),
          playing: v.playing,
          camera: v.camera,
          ...(clamped
            ? {
                note: `t = ${t} s is outside the run (${tl.events.start} to ${tl.events.end.toFixed(2)} s); moved to the nearest moment.`,
              }
            : {}),
        });
      }),
    },
  ];
}

/**
 * Register the tools with WebMCP (the browser's, or the polyfill's, loaded on demand).
 * The polyfill only answers this window (no cross-origin frames or other origins' tabs).
 */
export async function registerTools(host: ToolHost): Promise<number> {
  if (!('modelContext' in document)) {
    (window as unknown as { __webModelContextOptions?: unknown }).__webModelContextOptions = {
      transport: { tabServer: { allowedOrigins: [location.origin] }, iframeServer: false },
    };
    await import('@mcp-b/global');
  }
  const mc = document.modelContext;
  if (!mc) throw new Error('WebMCP is unavailable (it needs a secure context: https or localhost)');
  const tools = toolDefinitions(host);
  for (const tool of tools) await mc.registerTool(tool);
  return tools.length;
}
