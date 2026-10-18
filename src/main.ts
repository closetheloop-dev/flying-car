import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { norm } from './physics/math';
import { fitAirTime } from './physics/feasible';
import { DEFAULT_PARAMS, G0, type Params } from './physics/params';
import {
  CLOSED_LOOP_FOLDER,
  DEFAULT_FLIGHT_MODE,
  SETTING_BY_KEY,
  SETTINGS,
  validateSettings,
  type SettingKey,
} from './physics/settings';
import { simulateControlled } from './physics/closedloop';
import { computeTimeline, type Incident, type Sample, type Timeline } from './physics/timeline';
import { STAGE } from './physics/layout';
import { IncidentMarkers, type FreeRect } from './scene/alerts';
import { Plumes, plumeLevel } from './scene/effects';
import { BLOOM_THRESHOLD, GLOW_RESOLUTION } from './scene/glow';
import { modelInstance, preloadModels, setModelRenderer } from './scene/glb';
import { WHEEL_RADIUS, buildStuntCar, dressStuntCar, type StuntCar } from './scene/models';
import { dressParked } from './scene/parked';
import { Smoke } from './scene/smoke';
import { FORCE_COLORS, FlightPath, ForceArrows, RunGhost, applyPose } from './scene/overlays';
import type { ExploreFlown, ExploreRequest } from './physics/explore';
import { EXPLORE_COLORS, ExplorePanel } from './ui/explore';
import { buildWorld } from './scene/world';
import { AlertBanner, markScrubber } from './ui/alerts';
import { incidentLabel } from './ui/incidents';
import { parseQuery, toQuery } from './ui/query';
import { registerTools, type ToolHost } from './ui/webmcp';
import { TimeChart, type ChartEvent } from './ui/chart';
import { buildControls, type DisplayOptions, type FlightMode } from './ui/controls';
import { FootagePanel } from './ui/footage';
import { formatForce, formatTime } from './ui/format';
import { LivePanel, SummaryPanel } from './ui/hud';
import { axisUnit, onUnitsChange, setUnitSystem, toDisplay, unitOf, unitSystem, type UnitSystem } from './ui/units';
import { buildAbout } from './ui/about';
import { EndCard } from './ui/endcard';
import { FlightHud } from './ui/flighthud';
import { scrollCue } from './ui/scroll-cue';
import { returnFocus, wireSiteMenu } from './ui/site-menu';
import { SMALL_SCREEN, TweakCard } from './ui/tweak';
import '@fontsource-variable/inter';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import './style.css';

/** A remembered UI choice (falls back quietly where storage is unavailable). */
const remembered = {
  get: (key: string): string | null => {
    try {
      return localStorage.getItem(`flyingcar:${key}`);
    } catch {
      return null;
    }
  },
  set: (key: string, v: string) => {
    try {
      localStorage.setItem(`flyingcar:${key}`, v);
    } catch {
      /* private mode */
    }
  },
};

// ── Renderer & scene ─────────────────────────────────────────────────────
// Selective bloom by construction: lit (PBR) surfaces are capped just below the bloom
// threshold, so only unlit emissive objects — lamps, light strips, jet cores — glow.
// Without this, the floodlights' tiny specular hotspots on curved bodywork exceed the
// threshold and their glow pops in and out as they slide across facets when the
// camera moves (the "flicker"). Must run before any material compiles.
THREE.ShaderChunk.opaque_fragment =
  `#ifdef STANDARD\noutgoingLight = min(outgoingLight, vec3(${(BLOOM_THRESHOLD * 0.9).toFixed(2)}));\n#endif\n` +
  THREE.ShaderChunk.opaque_fragment;

const host = document.getElementById('viewport')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
host.append(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
host.append(labelRenderer.domElement);

const scene = new THREE.Scene();
const parkedVehicles = buildWorld(scene, renderer);
// The GLB vehicle models replace the procedural ones as they arrive.
setModelRenderer(renderer);
preloadModels();
for (const { obstacle, group } of parkedVehicles) {
  modelInstance(obstacle.kind, obstacle.length)
    .then((m) => {
      dressParked(group, m);
      applyRenderingToggles();
    })
    .catch((e) => console.warn(`Kept the procedural ${obstacle.label}: its GLB model didn't load.`, e));
}
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const controls = new OrbitControls(camera, labelRenderer.domElement);
controls.enableDamping = true;

// The scene renders into the composer's targets, not the canvas, so the renderer's
// `antialias` flag does nothing; edges are smoothed with SMAA after tone mapping instead.
// (A multisampled half-float target renders solid black on some GPUs, with no error.)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.35, BLOOM_THRESHOLD);
// Soft knee: glow ramps in over one threshold-width instead of switching on at a hard
// step. The high-pass runs at half resolution, so with a hard step anything whose
// averaged brightness sits near the threshold blinks as the camera moves.
(bloom.highPassUniforms as Record<string, THREE.IUniform<number>>).smoothWidth.value = BLOOM_THRESHOLD * 0.5;
composer.addPass(bloom);
composer.addPass(new OutputPass());
const smaa = new SMAAPass();
composer.addPass(smaa);

// ── State ────────────────────────────────────────────────────────────────
// Settings come from the URL (?mass=1500&apexHeight=8&model=ideal …), over the defaults.
const query = parseQuery(location.search);
const params: Params = { ...DEFAULT_PARAMS, ...query.params };
/** URL parameters that were ignored, shown with the problems until the settings change. */
let urlProblems = query.problems;
const display: DisplayOptions = {
  forceArrows: false,
  arrowLabels: true,
  flightPath: true,
  ghosts: false,
  compare: true,
  smoke: true,
  smokeAmount: 1,
  bloom: true,
  lightGlow: true,
  reflections: true,
  shadows: true,
  clearcoat: true,
  smaa: true,
};
/** Ideal: exact thrust for the fitted path. Closed-loop: a controller flies it through disturbances. */
const flight: { mode: FlightMode } = { mode: query.model ?? DEFAULT_FLIGHT_MODE };
const buildTimeline = (): Timeline => {
  const ideal = computeTimeline({ ...params }); // a snapshot: tl.params must not change with the panel
  return flight.mode === 'controlled' ? simulateControlled(ideal) : ideal;
};
let tl: Timeline = buildTimeline();
let simTime = 0;
let playing = false;
let speed = 1;
let car: StuntCar;
let plumes: Plumes;
const smoke = new Smoke();
scene.add(smoke.mesh);
const arrows = new ForceArrows();
scene.add(arrows.group);
const path = new FlightPath();
scene.add(path.group);
const defaultGhost = new RunGhost();
scene.add(defaultGhost.group);
/** /?explore=<key>: the setting flown lower and higher alongside (null: not exploring). */
let exploreKey: SettingKey | null = query.explore ?? null;
const exploreGhosts = {
  lower: new RunGhost(EXPLORE_COLORS.lower, false),
  higher: new RunGhost(EXPLORE_COLORS.higher, false),
};
Object.values(exploreGhosts).forEach((g) => scene.add(g.group));
/** The comparison runs flown for exploreKey (empty while they're worked out). */
let exploreFlown: ExploreFlown[] = [];
/** The worker working them out, and the timer that starts it (see refreshExplore). */
let exploreWorker: Worker | null = null;
let exploreTimer = 0;
const EXPLORE_DELAY_MS = 300;

/** The default run in each flight model, for the comparison ghost (computed once, when first needed). */
const baselines = new Map<FlightMode, Timeline>();
let baselinePending = false;
const isDefault = () => SETTINGS.every((s) => params[s.key] === DEFAULT_PARAMS[s.key]);

/**
 * Show the default run alongside this one when the settings differ from the defaults (and
 * the comparison is on). A default run not computed yet is simulated after the next frame
 * is drawn, so opening a URL with settings isn't held up by a second simulation.
 */
/** Whether the real stunt's ghost is wanted (not while exploring a setting: its cars are enough). */
const comparing = () => display.compare && !exploreKey && !isDefault();
/** Whether the real stunt's ghost is drawn now. */
const defaultGhostShown = () => comparing() && baselines.has(flight.mode);
function updateComparison() {
  const baseline = comparing() ? baselines.get(flight.mode) : undefined;
  const changed = !!baseline !== !document.getElementById('legend-default')!.hidden;
  defaultGhost.setBaseline(baseline ?? null);
  document.getElementById('legend-default')!.hidden = !baseline;
  if (changed) reframe(); // the Wide view includes the ghost's path
  if (baseline || !comparing() || baselinePending) return;
  baselinePending = true;
  requestAnimationFrame(() =>
    setTimeout(() => {
      const mode = flight.mode;
      const ideal = computeTimeline({ ...DEFAULT_PARAMS });
      baselines.set(mode, mode === 'controlled' ? simulateControlled(ideal) : ideal);
      baselinePending = false;
      updateComparison();
    }, 0),
  );
}
const incidentMarkers = new IncidentMarkers(document.body, (i) => frameIncident(i));
scene.add(incidentMarkers.group);

const live = new LivePanel();
const summary = new SummaryPanel();
const panelHost = document.getElementById('panel-host')!;
const paramsHost = document.createElement('section');
paramsHost.className = 'params-host';
panelHost.append(live.root, summary.root, paramsHost);
const hud = new FlightHud(document.getElementById('hud')!);

/** Free geometry, plus materials owned by one object (shared materials are left alone). */
function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.userData.shared) return; // GLB copies share geometry with the template
    m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => mt.userData.owned && mt.dispose());
  });
}

function rebuild() {
  // A run that was over stays over (at the new run's end, which may be a moment later).
  const wasOver = !!tl && !!car && simTime >= tl.events.end - 1e-6;
  tl = buildTimeline();
  if (isDefault()) baselines.set(flight.mode, tl); // the default run itself: keep it for comparisons
  if (car) {
    scene.remove(car.root);
    disposeTree(car.root);
  }
  car = buildStuntCar(params, tl.thrusters);
  scene.add(car.root);
  path.rebuild(tl, car.root); // before the plumes and alert outline are attached, so ghosts don't carry them
  for (const g of [defaultGhost, ...Object.values(exploreGhosts)]) g.setCar(car.root);
  plumes = new Plumes(car.nozzles);
  incidentMarkers.rebuild(tl, car.root);
  // The GLB Roadster replaces the procedural body once loaded (after the ghosts were cloned).
  const built = car;
  modelInstance('roadster', params.length)
    .then((m) => {
      if (car !== built) return; // rebuilt again meanwhile
      dressStuntCar(built, m, params);
      // The comparison ghosts get the model too: just the body, in the body frame like the car.
      const body = new THREE.Group();
      body.add(m.clone(true));
      for (const g of [defaultGhost, ...Object.values(exploreGhosts)]) g.setCar(body);
      applyRenderingToggles();
    })
    .catch((e) => console.warn("Kept the procedural Roadster: its GLB model didn't load.", e));
  banner.update(tl, urlProblems);
  markScrubber(scrubWrap, tl);
  live.setThrusters(tl);
  summary.update(tl);
  tweak.setStatus(tl);
  // Reset: in the phone's top bar only once there's something to undo; elsewhere dimmed.
  resetBtn.hidden = isDefault();
  tweak.setCanReset(!isDefault());
  panel.setCanReset(!isDefault());
  endCard.hide();
  resultShown = false; // new settings: say how they went the first time they finish
  updateCharts();
  applyDisplay();
  simTime = wasOver ? tl.events.end : Math.min(Math.max(simTime, tl.events.start), tl.events.end);
  smoke.clear();
  lastIndex = -1; // the timeline changed even if the sample index didn't: refresh readouts
  renderFrame(0);
  reframe();
  updateLaunch();
  refreshExplore();
}

/**
 * Fly the explored setting lower and higher than it is now, and show them beside this run.
 * The solves run in a worker (each takes up to about a second), started a moment after the
 * last change, so dragging through values doesn't start one per value; any change ends the
 * worker still busy with the old settings.
 */
function refreshExplore() {
  exploreWorker?.terminate();
  exploreWorker = null;
  clearTimeout(exploreTimer);
  const hadRuns = exploreFlown.length > 0;
  exploreFlown = [];
  Object.values(exploreGhosts).forEach((g) => g.setBaseline(null));
  if (hadRuns) reframe();
  if (!exploreKey) {
    explorePanel.hide();
    return;
  }
  const key = exploreKey;
  const current = tl;
  if (flight.mode === 'ideal' && SETTING_BY_KEY.get(key)!.folder === CLOSED_LOOP_FOLDER) {
    explorePanel.show(
      key,
      current,
      [],
      'This setting only matters in the Closed-loop flight model; this run is Ideal.',
    );
    return;
  }
  explorePanel.show(key, current, null);
  const request: ExploreRequest = { params: { ...params }, key, mode: flight.mode };
  exploreTimer = window.setTimeout(() => {
    const worker = new Worker(new URL('./physics/explore.worker.ts', import.meta.url), { type: 'module' });
    exploreWorker = worker;
    const done = () => {
      worker.terminate();
      if (exploreWorker === worker) exploreWorker = null;
    };
    worker.onmessage = (e: MessageEvent<ExploreFlown[]>) => {
      done();
      exploreFlown = e.data;
      for (const f of exploreFlown) exploreGhosts[f.run.side].setBaseline(f.tl);
      explorePanel.show(key, current, exploreFlown);
      reframe(); // the Wide view includes their paths
    };
    worker.onerror = (e) => {
      done();
      console.warn('The explore runs could not be worked out.', e.message);
      explorePanel.show(key, current, [], 'The comparison could not be worked out.');
    };
    worker.postMessage(request);
  }, EXPLORE_DELAY_MS);
}

/** Start exploring a setting (null: stop); the URL keeps it, so the comparison can be shared. */
function setExplore(key: SettingKey | null) {
  exploreKey = key;
  history.replaceState(history.state, '', `${location.pathname}${pageQuery()}${location.hash}`);
  refreshExplore();
  updateComparison();
}

/** This page's query string: the settings, the setting explored, and others' parameters. */
const pageQuery = () => toQuery(params, flight.mode, query.foreign, exploreKey);

// ── Charts ───────────────────────────────────────────────────────────────
const chartHost = document.getElementById('charts')!;
const scrubTo = (t: number) => {
  simTime = Math.min(Math.max(t, tl.events.start), tl.events.end);
  smoke.clear();
  updateLaunch();
};
const charts = {
  thrust: new TimeChart({ title: 'Total thrust', unit: '', digits: 1 }, scrubTo),
  torque: new TimeChart({ title: 'Required torque', unit: '', digits: 1 }, scrubTo),
  height: new TimeChart({ title: 'CG height', unit: '', digits: 2 }, scrubTo),
  occ: new TimeChart({ title: 'Driver g-load', unit: 'g', digits: 2 }, scrubTo),
};
Object.values(charts).forEach((c) => chartHost.append(c.el));
// Where they swipe (narrow screens), the edge with more fades, and ‹ › page a chart at a
// time (a mouse has no sideways swipe). The camera row says the same when it scrolls.
{
  const [prev, next] = ['prev', 'next'].map((k) => document.querySelector<HTMLButtonElement>(`.pager.${k}`)!);
  scrollCue(chartHost, (left, right) => {
    // A button that hides while it has focus (the row reached its end) hands focus over.
    if (!left && document.activeElement === prev && right) next.focus();
    if (!right && document.activeElement === next && left) prev.focus();
    prev.hidden = !left;
    next.hidden = !right;
  });
  const page = (dir: number) => {
    const step = (chartHost.querySelector<HTMLElement>('.chart')?.offsetWidth ?? 0) + 6;
    chartHost.scrollBy({ left: dir * step, behavior: 'smooth' });
  };
  prev.onclick = () => page(-1);
  next.onclick = () => page(1);
  scrollCue(document.querySelector<HTMLElement>('.cams')!);
}

function updateCharts() {
  const n = tl.samples.length;
  const t = new Float64Array(n);
  const force = axisUnit('force', tl.summary.peakThrust.value);
  // Pick the torque unit from what is actually plotted: the full in-flight torque magnitude.
  const peakTorque = tl.samples.reduce((m, s) => (s.airborne ? Math.max(m, norm(s.required.torque)) : m), 0);
  const torque = axisUnit('torque', peakTorque);
  const imperial = unitSystem() === 'imperial';
  charts.thrust.setUnit(force.unit, imperial ? 0 : 1);
  charts.torque.setUnit(torque.unit, imperial ? 0 : 1);
  charts.height.setUnit(unitOf('length'), imperial ? 1 : 2);
  const series = {
    thrust: new Float64Array(n),
    torque: new Float64Array(n),
    height: new Float64Array(n),
    occ: new Float64Array(n),
  };
  tl.samples.forEach((s, i) => {
    t[i] = s.t;
    series.thrust[i] = norm(s.thrust) * force.factor;
    series.torque[i] = s.airborne ? norm(s.required.torque) * torque.factor : 0;
    series.height[i] = toDisplay('length', s.pos[1]);
    series.occ[i] = s.occupantG;
  });
  const e = tl.events;
  const events: ChartEvent[] = [
    { t: e.liftoff, label: 'liftoff' },
    { t: e.burnout, label: 'launch burn ends' },
    { t: e.apex, label: 'apex' },
    { t: e.rollStart, label: 'roll starts' },
    { t: e.rollEnd, label: 'roll ends' },
    { t: e.landingBurn, label: 'landing burn' },
    { t: e.touchdown, label: 'touchdown' },
    ...tl.incidents.map((i) => ({ t: i.t, label: incidentLabel(i), critical: true })),
  ];
  // Wide enough to include every incident, e.g. hitting something on the approach.
  const incidentTimes = tl.incidents.map((i) => i.t);
  const win: [number, number] = [
    Math.max(e.start, Math.min(-0.5, ...incidentTimes.map((t) => t - 0.3))),
    Math.min(e.end, Math.max(e.touchdown + 1.2, ...incidentTimes.map((t) => t + 0.3))),
  ];
  const semi = tl.obstacles.find((o) => o.kind === 'semi');
  charts.thrust.setRefs([{ value: params.mass * G0 * force.factor, label: `Weight ${formatForce(params.mass * G0)}` }]);
  charts.height.setRefs(semi ? [{ value: toDisplay('length', STAGE.height + semi.height), label: 'Semi roof' }] : []);
  charts.occ.setRefs([{ value: 1, label: '1 g' }]);
  for (const k of Object.keys(series) as (keyof typeof series)[]) charts[k].setData(t, series[k], win, events);
}

// ── Controls ─────────────────────────────────────────────────────────────
function applyDisplay() {
  arrows.enabled = display.forceArrows;
  arrows.showLabels = display.arrowLabels;
  // The force legend explains the arrows, so it shows only with them.
  legend.querySelectorAll<HTMLElement>('.force').forEach((li) => (li.hidden = !display.forceArrows));
  tweak.refresh();
  path.group.visible = display.flightPath;
  path.setGhostsVisible(display.ghosts);
  updateComparison();
  smoke.mesh.visible = display.smoke;
  smoke.amount = display.smokeAmount;
  bloom.enabled = display.bloom;
  applyRenderingToggles();
}

/**
 * The Rendering switches: each disables one costly or GPU-sensitive feature. Re-run after
 * every rebuild, since rebuilding the car creates new strips and materials.
 */
const envMap = scene.environment;
function applyRenderingToggles() {
  smaa.enabled = display.smaa;
  scene.environment = display.reflections ? envMap : null;
  const shadowsChanged = renderer.shadowMap.enabled !== display.shadows;
  renderer.shadowMap.enabled = display.shadows;
  scene.traverse((o) => {
    if (o.userData.glow) o.visible = display.lightGlow;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const phys = mat as THREE.MeshPhysicalMaterial;
      if (phys.isMeshPhysicalMaterial) {
        phys.userData.clearcoat0 ??= phys.clearcoat;
        const want = display.clearcoat ? phys.userData.clearcoat0 : 0;
        // Clearcoat 0 vs > 0 compiles a different shader, so recompile on change.
        if (phys.clearcoat > 0 !== want > 0) phys.needsUpdate = true;
        phys.clearcoat = want;
      }
      if (shadowsChanged) mat.needsUpdate = true; // shadow sampling is compiled in
    }
  });
}
// ── Source footage, picture-in-picture, synced to the simulation clock ─────
const footage = new FootagePanel((view) => {
  if (view === '2') setCam('video');
});
// On the page itself, not in the 3D view, so it stacks above the HUD and the Tweak card.
document.body.append(footage.root);
const footageToggle = document.getElementById('footage-toggle')!;
const setFootageVisible = (v: boolean) => {
  if (footage.unavailable) v = false;
  footage.setVisible(v);
  requestAnimationFrame(() => {
    fitFootage();
    reframe(); // the Wide view keeps the run out from under it
  });
  footageToggle.setAttribute('aria-pressed', String(v));
};
footageToggle.onclick = () => setFootageVisible(!footage.visible);
footage.root.addEventListener('footage-hidden', () => setFootageVisible(false));
// It slides when the notice above it comes or goes: frame the Wide view where it ends up.
footage.root.addEventListener('transitionend', (e) => {
  if (e.target === footage.root && e.propertyName === 'top') reframe();
});
// Dragged elsewhere (or put back): the Wide view keeps the run clear of it there.
footage.onMoved = () => {
  fitFootage();
  reframe();
};
// Without the frames (they aren't in the source), there is no footage to offer.
footage.root.addEventListener('footage-unavailable', () => {
  footageToggle.hidden = true;
  setFootageVisible(false);
});
// Shown on every load; hiding it lasts until the page is reloaded.
setFootageVisible(true);

/** After any settings change: the URL now describes these settings, then rebuild. */
function settingsChanged() {
  urlProblems = [];
  history.replaceState(history.state, '', `${location.pathname}${pageQuery()}${location.hash}`);
  tweak.refresh();
  // The air time changed elsewhere (the Lab, a URL, a tool): it's no longer the card's fit.
  if (fittedAirTime !== null && params.airTimeVideo !== fittedAirTime) {
    fittedAirTime = null;
    tweak.setNote('');
  }
  rebuild();
}

const panel = buildControls(params, display, settingsChanged, applyDisplay, flight, paramsHost, {
  onExplore: (key) => {
    setExplore(key);
    setLabOpen(false); // the Lab covers the comparison (at the top of the Tweak card)
  },
  onReset: () => askReset(),
});

// ── Tweak card: the settings a visitor plays with ─────────────────────────
// (On a phone it is a sheet, opened and closed with Tweak in the top bar.)
const tweakBtn = document.getElementById('tweak-btn')!;
const tweak = new TweakCard(document.getElementById('tweak')!, {
  params,
  display,
  set: (changes) => void tweakSet(changes),
  onDisplay: applyDisplay,
  reset: () => askReset(),
  onFold: (open) => tweakBtn.setAttribute('aria-expanded', String(open)),
});
tweakBtn.onclick = () => tweak.toggle();

/** Back to the real stunt's settings (the flight model stays), dropping any fit in progress. */
function resetToStunt() {
  tweakSeq++;
  tweak.setNote('');
  applyValidated({}, undefined, true);
}
// On a phone a stray tap could lose the visitor's settings, so it asks first (Reset in the
// top bar, the Tweak card's or the Lab's); elsewhere it resets straight away.
const resetConfirm = document.getElementById('reset-confirm') as HTMLDialogElement;
function askReset() {
  if (!matchMedia(SMALL_SCREEN).matches) return resetToStunt();
  resetConfirm.returnValue = '';
  resetConfirm.showModal();
}
resetConfirm.addEventListener('close', () => {
  if (resetConfirm.returnValue !== 'reset') return;
  resetToStunt();
  // The top bar's Reset hides once there's nothing to reset: focus on Tweak beside it, not lost.
  const f = document.activeElement as HTMLElement | null;
  if (!f || f === document.body || !f.getClientRects().length) returnFocus(tweakBtn);
});
// A tap on the dimmed backdrop (the dialog itself, outside its form) cancels.
resetConfirm.addEventListener('click', (e) => {
  if (e.target === resetConfirm) resetConfirm.close('cancel');
});
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
resetBtn.onclick = askReset;

// The explored setting's comparison, at the top of the card (shown even when it's folded).
const explorePanel = new ExplorePanel(() => setExplore(null));
document.getElementById('tweak')!.prepend(explorePanel.root);

/** The air time the Tweak card last fitted (null: the footage's, or one set in the Lab or URL). */
let fittedAirTime: number | null = null;
/** Counts Tweak changes, so a fit that a newer change overtook is dropped. */
let tweakSeq = 0;
/**
 * Apply a Tweak card change, keeping the hop flyable: a higher hop, another number of rolls
 * or a different roll time needs a different time in the air than the footage's. So the air
 * time moves to the nearest one that flies, preferring the footage's (or one set in the Lab),
 * and the card says when it did. Where no air time works, the change applies as it is and
 * the card says it can't fly.
 */
async function tweakSet(changes: Record<string, number>) {
  const seq = ++tweakSeq;
  const preferred = params.airTimeVideo === fittedAirTime ? DEFAULT_PARAMS.airTimeVideo : params.airTimeVideo;
  tweak.setNote('Fitting the time in the air…');
  const next = { ...params, ...changes } as Params;
  const air = await fitAirTime(next, preferred, () => new Promise((r) => requestAnimationFrame(() => r())));
  if (seq !== tweakSeq) return; // a newer change (or Reset) took over
  // (No fit: the air time stays as it was, and so does whether the card had fitted it.)
  if (air !== null) fittedAirTime = air !== preferred ? air : null;
  applySettings(air === null ? changes : { ...changes, airTimeVideo: air });
  tweak.setNote(
    air === null || fittedAirTime === null
      ? ''
      : `Time in the air adjusted to ${fittedAirTime.toFixed(2)} s (the stunt: ${DEFAULT_PARAMS.airTimeVideo.toFixed(2)} s) so it can land.`,
  );
}

/**
 * Change settings from outside the panel (the debug hook, tools): each value is checked
 * against the setting's range like a URL parameter; valid ones are applied together,
 * the panel and URL follow, and the reasons for any rejected ones are returned.
 */
function applySettings(changes: Record<string, unknown>, model?: unknown): string[] {
  const v = validateSettings(changes, model);
  if (!Object.keys(v.accepted).length && v.model === undefined) return v.problems; // nothing to change
  applyValidated(v.accepted as Partial<Params>, v.model, false);
  return v.problems;
}

/**
 * Apply already-validated changes (optionally after restoring the defaults) everywhere;
 * `foreign`, if given, replaces the URL parameters that aren't settings (kept as they are),
 * and `explore`, if given, the setting explored (null: none), as loading a URL does.
 */
function applyValidated(
  changes: Partial<Params>,
  model: FlightMode | undefined,
  reset: boolean,
  foreign?: [string, string][],
  explore?: SettingKey | null,
) {
  if (reset) Object.assign(params, DEFAULT_PARAMS);
  if (foreign) query.foreign = foreign;
  if (explore !== undefined) exploreKey = explore; // (rebuilding works its comparison out)
  Object.assign(params, changes);
  if (model) flight.mode = model;
  panel.refresh();
  settingsChanged();
}

const legend = document.getElementById('legend')!;
legend.innerHTML =
  (
    [
      ['thrust', 'Thrust (net)'],
      ['gravity', 'Weight'],
      ['ground', 'Ground reaction'],
      ['drag', 'Drag (drawn ×20)'],
      ['torque', 'Torque (axis)'],
    ] as const
  )
    .map(([k, l]) => `<li class="force"><span class="key" style="background:${FORCE_COLORS[k]}"></span>${l}</li>`)
    .join('') +
  // Shown while the default run is drawn for comparison (see updateComparison).
  '<li id="legend-default" hidden><span class="key" style="width:16px;height:2px;border-radius:0;background:repeating-linear-gradient(90deg,#d6dbe2 0 4px,transparent 4px 7px)"></span>Real-stunt car</li>';

const unitButtons = document.querySelectorAll<HTMLButtonElement>('.units button');
const showUnits = (u: UnitSystem) =>
  unitButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.units === u)));
unitButtons.forEach((b) => (b.onclick = () => setUnitSystem(b.dataset.units as UnitSystem)));
showUnits(unitSystem());
onUnitsChange((u) => {
  showUnits(u);
  summary.update(tl);
  banner.update(tl, urlProblems);
  incidentMarkers.relabel();
  updateCharts();
  if (endCard.visible) endCard.show(tl, flight.mode);
  lastIndex = -1;
});

// ── Lab drawer: Live, Results, Parameters ─────────────────────────────────
type Tab = 'live' | 'results' | 'params';
const tabs: Record<Tab, HTMLElement> = {
  live: document.getElementById('tab-live')!,
  results: document.getElementById('tab-results')!,
  params: document.getElementById('tab-params')!,
};
const tabPanels: Record<Tab, HTMLElement> = { live: live.root, results: summary.root, params: paramsHost };
const TAB_ORDER = Object.keys(tabs) as Tab[];
for (const k of TAB_ORDER) {
  tabPanels[k].id = `panel-${k}`;
  tabPanels[k].setAttribute('role', 'tabpanel');
  tabPanels[k].setAttribute('aria-labelledby', tabs[k].id);
  tabs[k].setAttribute('aria-controls', tabPanels[k].id);
}
function showTab(which: Tab) {
  for (const k of TAB_ORDER) {
    tabs[k].setAttribute('aria-selected', String(k === which));
    tabs[k].tabIndex = k === which ? 0 : -1; // one tab stop; arrows move between tabs
    tabPanels[k].hidden = k !== which;
  }
}
TAB_ORDER.forEach((k) => (tabs[k].onclick = () => showTab(k)));
document.querySelector<HTMLElement>('.lab [role=tablist]')!.addEventListener('keydown', (e) => {
  const at = TAB_ORDER.findIndex((k) => tabs[k] === document.activeElement);
  if (at < 0) return;
  const to =
    e.key === 'ArrowRight'
      ? (at + 1) % TAB_ORDER.length
      : e.key === 'ArrowLeft'
        ? (at + TAB_ORDER.length - 1) % TAB_ORDER.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? TAB_ORDER.length - 1
            : -1;
  if (to < 0) return;
  e.preventDefault();
  e.stopPropagation(); // the arrow moves between tabs only, not the playback too
  showTab(TAB_ORDER[to]);
  tabs[TAB_ORDER[to]].focus();
});
showTab('live');

const lab = document.getElementById('lab')!;
const labBtn = document.getElementById('lab-btn')!;
/** The charts were folded to make room for the Lab (and unfold when it closes). */
let chartsFoldedForLab = false;
function setLabOpen(open: boolean, tab?: Tab) {
  const was = !lab.hidden;
  lab.hidden = !open;
  document.body.classList.toggle('lab-open', open);
  labBtn.setAttribute('aria-expanded', String(open));
  panel.setListening(open); // the Parameters panel only needs to follow the Tweak card while it shows
  if (tab) showTab(tab);
  if (open) endCard.hide(); // the result strip would sit over the Lab (whose Results say it all)
  // In a short window (a phone on its side) the Lab gets the charts' height while it's open.
  if (
    open &&
    !was &&
    matchMedia('(max-height: 500px)').matches &&
    !document.body.classList.contains('charts-collapsed')
  ) {
    chartsFoldedForLab = true;
    setChartsCollapsed(true);
  } else if (!open && was && chartsFoldedForLab) {
    chartsFoldedForLab = false;
    setChartsCollapsed(false);
  }
  if (open !== was) {
    reframe(); // the free part of the view changed
    requestAnimationFrame(() => fitFootage()); // and the HUD may have hidden or shown
  }
  // Focus follows: into the Lab on opening, back to its button on closing.
  if (open && !was) (Object.values(tabs).find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs.live).focus();
  else if (!open && was && lab.contains(document.activeElement)) labBtn.focus();
}
const labOpen = () => !lab.hidden;
labBtn.onclick = () => setLabOpen(!labOpen());
document.getElementById('lab-close')!.onclick = () => setLabOpen(false);

// ── Share, About, notices ─────────────────────────────────────────────────
const toastHost = document.getElementById('toast-host')!;
// Windows placed under the notices (the footage, on some layouts) follow their height.
let lastBannerH = 0;
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--toast-h', `${Math.ceil(toastHost.getBoundingClientRect().height)}px`);
  fitFootage();
  // The problem notice stays up, so the Wide view keeps the run clear of it (a passing
  // notice like "Link copied" doesn't move the camera).
  const bannerH = Math.round(toastHost.querySelector('.alert-banner')?.getBoundingClientRect().height ?? 0);
  if (bannerH !== lastBannerH) {
    lastBannerH = bannerH;
    reframe();
  }
}).observe(toastHost);
/** A short notice under the top bar that fades away. */
function notify(text: string) {
  const n = document.createElement('div');
  n.className = 'notice';
  n.setAttribute('role', 'status');
  n.textContent = text;
  toastHost.append(n);
  setTimeout(() => n.remove(), 2200);
}
async function share() {
  const url = location.href;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: document.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    notify('Link copied. It opens this exact flight.');
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return; // the share sheet was dismissed
    prompt('Copy this link:', url);
  }
}
document.getElementById('share-btn')!.onclick = () => void share();
const about = document.getElementById('about') as HTMLDialogElement;
buildAbout(about);
const aboutBtn = document.getElementById('about-btn')!;
aboutBtn.onclick = () => about.showModal();
// Focus back where it came from (☰, when About was opened from the folded menu).
about.addEventListener('close', () => returnFocus(aboutBtn));

// The top bar's links fold under ☰ on a phone (as on the reading pages).
wireSiteMenu();

// ── Charts row: collapsible, remembered ───────────────────────────────────
const chartsToggle = document.getElementById('charts-toggle')!;
function setChartsCollapsed(c: boolean, remember = false) {
  document.body.classList.toggle('charts-collapsed', c);
  chartsToggle.setAttribute('aria-expanded', String(!c));
  chartsToggle.title = c ? 'Show the charts' : 'Hide the charts';
  if (remember) remembered.set('charts-collapsed', c ? '1' : '0');
  setTimeout(() => fitFootage(), 250); // the HUD moves with the dock (after its transition)
}
// On a phone, where the 3D view needs the room, they start hidden on every visit (opening
// them lasts until the page is reloaded); elsewhere they start open, and the choice is kept.
const smallScreen = matchMedia(SMALL_SCREEN);
chartsToggle.onclick = () => {
  chartsFoldedForLab = false; // the visitor's own choice now (closing the Lab won't undo it)
  setChartsCollapsed(!document.body.classList.contains('charts-collapsed'), !smallScreen.matches);
};
setChartsCollapsed(smallScreen.matches || remembered.get('charts-collapsed') === '1');

// ── Playing: Launch, the end of the run, Replay ───────────────────────────
const playBtn = document.getElementById('play')!;
const launchBtn = document.getElementById('launch')!;
const endCard = new EndCard(document.getElementById('endcard')!, {
  share: () => void share(),
  openLab: () => {
    endCard.hide();
    setLabOpen(true, 'results');
  },
  hidden: () => {
    updateLaunch();
    fitFootage(); // the footage may grow back where the strip was
  },
});
/** Where a replay (and each loop) starts: a moment of the approach before liftoff. */
const replayStart = () => Math.max(tl.events.start, -0.6);
/** Whether these settings' result has been shown (once, the first time the run finishes). */
let resultShown = false;
/** How long the result strip stays up [s] (it can also be closed, or opened in the Lab). */
const RESULT_SECONDS = 9;
const atEnd = () => simTime >= tl.events.end - 1e-6;
const setPlaying = (p: boolean) => {
  playing = p;
  playBtn.textContent = p ? '❚❚' : '▶';
  updateLaunch();
};
function replay() {
  endCard.hide();
  simTime = replayStart();
  smoke.clear();
  setPlaying(true);
}
/** Play from here, or from the start again once the run is over. */
function launch() {
  if (atEnd()) replay();
  else setPlaying(true);
}
/** The big Launch / Replay button shows while paused before liftoff or at the end. */
function updateLaunch() {
  const show = !playing && !endCard.visible && (simTime < 0 || atEnd());
  launchBtn.hidden = !show;
  launchBtn.textContent = atEnd() ? '↻ Replay' : '▶ Launch';
  updateKeyHint(show);
}
const cueEl = document.querySelector<HTMLElement>('.cue')!;
/** Launch from a button: until the keys have been used, the hint stays up a few seconds. */
function launchByPointer() {
  launch();
  if (keysUsed) return;
  clearTimeout(hintTimer);
  hintUntil = performance.now() + HINT_MS;
  hintTimer = window.setTimeout(() => updateLaunch(), HINT_MS);
  updateLaunch();
}
playBtn.onclick = () => (playing ? setPlaying(false) : launchByPointer());
launchBtn.onclick = () => launchByPointer();

// The key hint: space plays and pauses, the arrows step a frame. It shows while paused
// (above Launch, or alone mid-hop), and for a few seconds after a launch by pointer until
// the keys have been used. Touch screens don't show it (style.css).
const keyHint = document.getElementById('keyhint')!;
const HINT_MS = 5000;
let keysUsed = remembered.get('keys-used') === '1';
let hintUntil = 0;
let hintTimer = 0;
const STEP_HTML = '<span><kbd>←</kbd> <kbd>→</kbd> frame by frame</span>';
function updateKeyHint(launchShown: boolean) {
  const midRun = !playing && !launchShown;
  const show = !endCard.visible && (!playing || performance.now() < hintUntil);
  keyHint.hidden = !show;
  const state = midRun ? 'paused' : 'keys';
  if (keyHint.dataset.state !== state) {
    // (filled even while hidden: frameWide measures it)
    keyHint.dataset.state = state;
    keyHint.innerHTML =
      (midRun ? '<span><b>Paused.</b> <kbd>Space</kbd> plays</span> ' : '<span><kbd>Space</kbd> play / pause</span> ') +
      STEP_HTML;
  }
}
function noteKeysUsed() {
  if (keysUsed) return;
  keysUsed = true;
  remembered.set('keys-used', '1');
  hintUntil = 0;
}
(document.getElementById('speed') as HTMLSelectElement).onchange = (e) => {
  speed = Number((e.target as HTMLSelectElement).value);
};
const scrub = document.getElementById('scrub') as HTMLInputElement;
scrub.oninput = () => scrubTo(tl.events.start + Number(scrub.value) * (tl.events.end - tl.events.start));
const scrubWrap = document.getElementById('scrub-wrap')!;
const clock = document.getElementById('clock')!;

// Invalid settings: the banner lists why, and Show plays the moment it happens, framed.
const showIncident = (i: Incident) => {
  frameIncident(i);
  scrubTo(Math.max(tl.events.start, i.t - 0.8));
  setPlaying(true);
};
const banner = new AlertBanner(toastHost, showIncident);

const topbar = document.querySelector<HTMLElement>('.topbar')!;
// What sits under the top bar (the notices, the Tweak card, the Lab) follows its actual
// height, which grows when the legend wraps.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--top-h', `${Math.ceil(topbar.getBoundingClientRect().bottom) + 6}px`);
  fitFootage();
  reframe();
}).observe(topbar);
const tweakCard = document.getElementById('tweak')!;
// Collapsing or opening the card changes the room the Wide view has on the right (and, as
// the sheet on a phone, how high Launch sits above it while it shows a comparison).
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--tweak-h', `${Math.ceil(tweakCard.getBoundingClientRect().height)}px`);
  fitFootage(); // on an upright phone the footage stays above the sheet
  reframe();
}).observe(tweakCard);
const hudEl = document.getElementById('hud')!;
// The Launch button sits just right of the HUD, wherever that ends.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--hud-right', `${Math.ceil(hudEl.getBoundingClientRect().right)}px`);
  fitFootage();
}).observe(hudEl);
/** Whether the visitor has been told the footage stepped aside for lack of room. */
let noRoomSaid = false;
/**
 * The footage window (top left) must end above the HUD and its phase label, whatever the
 * top bar and the problem notice take: cap its width (its height follows, 16:9 plus its two
 * bars) to the room between them.
 */
function fitFootage() {
  const phase = hudEl.querySelector('.hud-phase')?.getBoundingClientRect();
  const hud = hudEl.getBoundingClientRect();
  const strip = document.getElementById('endcard')!.getBoundingClientRect();
  // Above the HUD, its phase label and (while it shows) the result strip. On an upright phone
  // also above the Tweak sheet (which grows with the sheet's sliders or a comparison), and a
  // strip above all that for the hop itself, which has no room beside it there.
  const upright = matchMedia('(max-width: 700px) and (min-height: 501px)').matches;
  const sheet = tweakCard.getBoundingClientRect();
  const bottom =
    Math.min(
      hud.height > 0 ? hud.top : innerHeight,
      phase && phase.height > 0 ? phase.top : innerHeight,
      strip.height > 0 ? strip.top : innerHeight,
      upright && sheet.height > 0 ? sheet.top : innerHeight,
    ) - (upright ? 80 : 0);
  const top = topbar.getBoundingClientRect().bottom + 6 + toastHost.offsetHeight + 6;
  const bars = 62; // the bar above the frame and the credit below it
  const maxW = ((bottom - top - 10 - bars) * 16) / 9;
  document.documentElement.style.setProperty('--footage-max-w', `${Math.floor(Math.max(maxW, 0))}px`);
  // Too little room to be any use (a phone with a long problem notice): it steps aside,
  // and its button says why. Not once the visitor has put it somewhere else: it stays there,
  // kept on screen.
  const noRoom = maxW < 140 && !footage.moved;
  // Said once per visit, the first time it steps aside (the dashed button alone is cryptic).
  if (noRoom && footage.visible && !footage.root.classList.contains('no-room') && !noRoomSaid) {
    noRoomSaid = true;
    notify('Footage hidden for now: no room. It comes back when there is.');
  }
  footage.keepOnScreen();
  footage.root.classList.toggle('no-room', noRoom);
  footageToggle.classList.toggle('no-room', noRoom && footage.visible);
  footageToggle.title =
    noRoom && footage.visible
      ? 'No room for the footage just now; it comes back when there is (F)'
      : 'Show the real video, synced to the simulation (F)';
}
addEventListener('resize', () => fitFootage());
/**
 * Parts of the 3D view covered by overlays. The free area excludes the top bar, the Lab
 * (when open) and the Tweak card where it runs down the right side; the HUD, the footage
 * window, a bottom-sheet Tweak card and the end card are blockers inside it.
 */
function viewBlockers(): { canvas: DOMRect; free: FreeRect; blockers: DOMRect[] } {
  const canvas = renderer.domElement.getBoundingClientRect();
  const free: FreeRect = { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom };
  free.top = Math.max(free.top, topbar.getBoundingClientRect().bottom);
  if (!lab.hidden) free.right = Math.min(free.right, lab.getBoundingClientRect().left);
  const hudRect = hudEl.getBoundingClientRect();
  const blockers: DOMRect[] = [hudRect];
  const t = tweakCard.getBoundingClientRect();
  // Down the right side it narrows the free area; anywhere else (a bottom sheet, or just its
  // header when collapsed, above where the scene sits) it only blocks.
  const rightSide =
    t.width > 0 &&
    t.left > (canvas.left + canvas.right) / 2 &&
    t.top < (canvas.top + canvas.bottom) / 2 &&
    t.bottom > free.top + (canvas.bottom - free.top) * 0.3;
  if (rightSide) free.right = Math.min(free.right, t.left);
  else if (t.width > 0) blockers.push(t);
  if (footage.visible) blockers.push(footage.root.getBoundingClientRect());
  if (endCard.visible) blockers.push(document.getElementById('endcard')!.getBoundingClientRect());
  return { canvas, free, blockers };
}

/**
 * Point the camera at an incident from the front of the line-up, with the spot in the
 * middle of the part of the view that no panel covers.
 */
function frameIncident(i: Incident) {
  setCam('front');
  const [px, py, pz] = i.point;
  const d = 17;
  const { canvas, free } = viewBlockers();
  // Screen right is world −x from the front, so shift the aim right of the spot by half
  // the covered width to move the spot to the free area's center.
  const shiftPx = (canvas.right - free.right) / 2;
  const metersPerPx = (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(canvas.height, 1);
  const target = new THREE.Vector3(px - shiftPx * metersPerPx, Math.max(py, 0.3) + 0.9, pz);
  camera.position.set(target.x, target.y + 2.5, pz - d);
  controls.target.copy(target);
  controls.update();
  // A custom view now, not the Front preset.
  document.querySelectorAll('.cams button').forEach((b) => {
    b.classList.remove('on');
    b.setAttribute('aria-pressed', 'false');
  });
  framed = true;
}

const CAM_ORDER: Cam[] = ['front', 'video', 'end', 'chase', 'top'];
/** The control a pointer press last focused, until Tab moves focus by keyboard. */
let pointerFocused: Element | null = null;
document.addEventListener(
  'pointerdown',
  (e) => (pointerFocused = (e.target as Element).closest('button, a, [role=tab]')),
  true,
);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Tab') pointerFocused = null;
  },
  true,
);
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea, .lil-gui') || about.open || resetConfirm.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Space and arrows on a control reached by keyboard do what that control does. One that
  // merely kept focus after a click lets go, so the keys control playback again. (Not
  // :focus-visible: a key press makes even a clicked button match it.)
  const control = (e.target as HTMLElement).closest<HTMLElement>('button, a, [role=tab]');
  if (control && (e.code === 'Space' || e.code === 'Enter' || e.code.startsWith('Arrow'))) {
    if (control !== pointerFocused || e.code === 'Enter') return;
    control.blur(); // so the key's release doesn't also click it
    pointerFocused = null;
  }
  if (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') noteKeysUsed();
  if (e.code === 'Space') {
    e.preventDefault();
    if (playing) setPlaying(false);
    else launch();
  } else if (e.code === 'ArrowRight') scrubTo(simTime + 1 / 60);
  else if (e.code === 'ArrowLeft') scrubTo(simTime - 1 / 60);
  else if (e.code === 'Home') scrubTo(tl.events.start);
  else if (e.code === 'KeyR') replay();
  else if (e.code === 'KeyL') setLabOpen(!labOpen());
  else if (e.code === 'KeyF') setFootageVisible(!footage.visible);
  else if (e.code === 'KeyC') setCam(CAM_ORDER[(CAM_ORDER.indexOf(cam) + 1) % CAM_ORDER.length]);
  else if (e.code === 'Escape') {
    if (endCard.visible) endCard.hide();
    else if (!lab.hidden) setLabOpen(false);
    updateLaunch();
  }
});

// ── Cameras ──────────────────────────────────────────────────────────────
type Cam = 'front' | 'video' | 'end' | 'chase' | 'top';
let cam: Cam = 'front';
/** The camera was moved to frame an incident (a custom view, not the preset). */
let framed = false;
const DEFAULT_FOV = 40;
/** The frame the presets' fields of view are set for: the footage's 16:9. */
const FRAME_ASPECT = 16 / 9;
/** The current view's vertical field of view for a 16:9 frame [deg]. */
let baseFov = DEFAULT_FOV;
/**
 * The camera's vertical field of view from the current view's: in a 3D view narrower than
 * 16:9 it widens, so the whole 16:9 frame still fits across (instead of its sides being cut
 * off); in a wider view the extra width just shows more at the sides.
 */
function fitFov() {
  const half = THREE.MathUtils.degToRad(baseFov / 2);
  const needed = THREE.MathUtils.radToDeg(
    2 * Math.atan((Math.tan(half) * FRAME_ASPECT) / Math.max(camera.aspect, 1e-3)),
  );
  const fov = Math.max(baseFov, needed);
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}
const PRESETS: Record<
  Exclude<Cam, 'chase'>,
  { pos: [number, number, number]; target: [number, number, number]; fov?: number }
> = {
  front: { pos: [0, 3.5, -34], target: [0, 3.2, 0] },
  // The footage's front-view camera (0:12–0:17), solved against the parked line-up:
  // 1.2 m up, 27.6 m in front of it, tilted up 11.7°, 32° vertical field of view.
  video: { pos: [-0.262, 1.2, -27.592], target: [0.034, 5.246, -8.008], fov: 32.06 },
  // Looking down the lane line from behind the launch point, as at 0:09.
  end: { pos: [-40, 7, 0.6], target: [0, 3.2, 0] },
  top: { pos: [0, 42, -0.01], target: [0, 0, 0] },
};
function setCam(c: Cam) {
  cam = c;
  framed = false;
  document.querySelectorAll<HTMLButtonElement>('.cams button').forEach((b) => {
    b.classList.toggle('on', b.dataset.cam === c);
    b.setAttribute('aria-pressed', String(b.dataset.cam === c));
    // (In a camera row that scrolls, the chosen one scrolls into view, e.g. after C.)
    if (b.dataset.cam === c) b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });
  controls.enabled = c !== 'chase';
  baseFov = c === 'chase' ? DEFAULT_FOV : (PRESETS[c].fov ?? DEFAULT_FOV);
  fitFov();
  userMoved = false;
  if (c === 'front') frameWide();
  else if (c !== 'chase') {
    camera.position.set(...PRESETS[c].pos);
    controls.target.set(...PRESETS[c].target);
    controls.update();
  }
}

/** The visitor has orbited or zoomed since the last preset (so the view isn't re-framed under them). */
let userMoved = false;
controls.addEventListener('start', () => (userMoved = true));

/**
 * The Wide view: the whole hop, from where a replay starts on the approach to just past
 * touchdown, fitted into the part of the view no panel covers (left of the Tweak card or
 * the Lab), seen from in front of the line-up. Re-run when the run or the layout changes.
 */
function frameWide() {
  const at = (run: Timeline, t: number) =>
    run.samples[Math.max(0, Math.min(run.samples.length - 1, Math.round((t - run.events.start) / run.dt)))].pos;
  // The hop, the whole stage with the line-up (even when the car never gets there), and the
  // real stunt's path when its ghost is shown, or the explored setting's runs.
  const runs = [tl, ...(defaultGhostShown() ? [baselines.get(flight.mode)!] : []), ...exploreFlown.map((f) => f.tl)];
  // From where a replay starts (the approach) to where the car comes to a stop after landing
  // (the slide carries it well past touchdown), plus the car's half-length and a little.
  // What must show: the car (with room for its length and its roll) at every moment, and
  // the stage with the line-up (the Semi is the tallest).
  const reach = tl.params.length / 2 + 0.6;
  const pts: [number, number, number][] = [];
  for (const r of runs) {
    for (let t = replayStart(); t <= r.events.stop + 1e-9; t += 0.1) {
      const [x, y, z] = at(r, t);
      for (const dx of [-reach, reach]) for (const dy of [-1.3, 1.3]) pts.push([x + dx, Math.max(0, y + dy), z]);
    }
  }
  for (let x = STAGE.x0; x <= STAGE.x1 + 1e-9; x += 1) pts.push([x, 0, 0], [x, 4.5, 0]);

  // Where it may go: the view under the top bar, left of the Lab and above the HUD (and its
  // phase label), and never under the Tweak card, where it really is: a short card at the top
  // right leaves the ground below it free.
  const { canvas, free } = viewBlockers();
  for (const r of [hudEl.getBoundingClientRect(), hudEl.querySelector('.hud-phase')?.getBoundingClientRect()]) {
    if (r && r.height > 0) free.bottom = Math.min(free.bottom, r.top);
  }
  const PAD = 10;
  const right = lab.hidden ? canvas.right : Math.min(canvas.right, lab.getBoundingClientRect().left);
  const area = { left: canvas.left + PAD, right: right - PAD, top: free.top + PAD, bottom: free.bottom - PAD };
  type Box = { left: number; right: number; top: number; bottom: number };
  const box = (b: DOMRect): Box[] =>
    b.width > 0 && b.height > 0
      ? [{ left: b.left - PAD, right: b.right + PAD, top: b.top - PAD, bottom: b.bottom + PAD }]
      : [];
  // Never under the Tweak card or the problem notice.
  const card = [
    ...box(tweakCard.getBoundingClientRect()),
    ...box(toastHost.querySelector('.alert-banner')!.getBoundingClientRect()),
  ];
  // Launch with the key hint (measured as if both showed, so playing and pausing don't change
  // the framing) and the footage window: kept clear too, unless that makes the hop much
  // smaller (Launch mid-view in a middling window); then they may overlap it.
  const shown = [launchBtn.hidden, keyHint.hidden];
  launchBtn.hidden = keyHint.hidden = false;
  const cue = box(cueEl.getBoundingClientRect());
  [launchBtn.hidden, keyHint.hidden] = shown;
  const film = footage.visible ? box(footage.root.getBoundingClientRect()) : [];

  // Moving the camera across (and its target with it) slides the picture without changing
  // it, so for each distance: project once from straight ahead, then look for a shift (tx, ty)
  // that keeps every point in the area and off the panels. For each tx across the range, the
  // ty a panel rules out are exact intervals (one per point under it); what is left are the
  // gaps. To fit, any gap will do; to choose, the shift with the most room around the hop.
  const probe = camera.clone();
  const v = new THREE.Vector3();
  const place = (d: number, blocks: Box[], choose = false) => {
    probe.position.set(0, 0.3, -d);
    probe.lookAt(0, 0, 0);
    probe.updateMatrixWorld();
    const sp = pts.map(([x, y, z]) => {
      v.set(x, y, z).project(probe);
      return [canvas.left + ((v.x + 1) / 2) * canvas.width, canvas.top + ((1 - v.y) / 2) * canvas.height];
    });
    const xs = sp.map((p) => p[0]),
      ys = sp.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs);
    const txLo = area.left - minX,
      txHi = area.right - maxX;
    const tyLo = area.top - Math.min(...ys),
      tyHi = area.bottom - Math.max(...ys);
    if (txLo > txHi || tyLo > tyHi) return null;
    const txMid = (txLo + txHi) / 2;
    let best: { tx: number; ty: number; room: number; off: number } | null = null;
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const tx = txHi > txLo ? txLo + ((txHi - txLo) * i) / N : txLo;
      const ruled: [number, number][] = [];
      for (const b of blocks)
        for (const [x, y] of sp) if (x + tx > b.left && x + tx < b.right) ruled.push([b.top - y, b.bottom - y]);
      ruled.sort((a, b) => a[0] - b[0]);
      const gaps: [number, number][] = [];
      let at = tyLo;
      for (const [s, e] of ruled) {
        if (s > at) gaps.push([at, Math.min(s, tyHi)]);
        at = Math.max(at, e);
        if (at >= tyHi) break;
      }
      if (at <= tyHi) gaps.push([at, tyHi]);
      for (const [a, c] of gaps) {
        if (c < a) continue;
        if (!choose) return { tx, ty: a };
        // In the middle of its gap; room is the nearest the hop comes to an edge or a panel
        // sideways, or up and down.
        const ty = (a + c) / 2;
        let room = Math.min(minX + tx - area.left, area.right - maxX - tx, (c - a) / 2);
        for (const b of blocks) {
          for (const [x, y] of sp) {
            if (y + ty <= b.top || y + ty >= b.bottom) continue;
            room = Math.min(room, x + tx <= b.left ? b.left - x - tx : x + tx - b.right);
          }
        }
        const off = Math.abs(tx - txMid);
        if (!best || room > best.room + 1 || (room > best.room - 1 && off < best.off)) best = { tx, ty, room, off };
      }
    }
    return best;
  };
  // The nearest distance that fits (closer only fits less), searched between lo and hi.
  const nearest = (blocks: Box[], lo: number, hi: number, steps: number) => {
    if (!place(hi, blocks)) return null;
    for (let k = 0; k < steps; k++) {
      const mid = (lo + hi) / 2;
      if (place(mid, blocks)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const d0 = nearest(card, 15, 400, 18) ?? 120; // nothing fits (a tiny view): a plain far view
  // Each extra panel only pushes the camera back; keep both clear if it costs at most a quarter
  // of the size. Otherwise the footage, at up to 1.6× (it stays up, and would hide the landing),
  // or else Launch, which shows only while paused.
  let blocks = card;
  let dFit = d0;
  for (const [more, cost] of [
    [[...cue, ...film], 1.25],
    [film, 1.6],
    [cue, 1.25],
  ] as const) {
    if (more.length === 0) continue;
    const d = nearest([...card, ...more], d0, d0 * cost, 8);
    if (d) {
      blocks = [...card, ...more];
      dFit = d;
      break;
    }
  }
  const d = dFit * 1.03; // a little room
  const shift = place(d, blocks, true) ?? place(d, card, true) ?? { tx: 0, ty: 0 };
  // Screen right is world −x from the front, so sliding the picture right moves the camera
  // to +x; sliding it down moves the camera up.
  const metersPerPx = (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(canvas.height, 1);
  const aimX = shift.tx * metersPerPx,
    aimY = shift.ty * metersPerPx;
  camera.position.set(aimX, aimY + 0.3, -d);
  controls.target.set(aimX, aimY, 0);
  controls.update();
}
document
  .querySelectorAll<HTMLButtonElement>('.cams button')
  .forEach((b) => (b.onclick = () => setCam(b.dataset.cam as Cam)));
setCam('front');

// ── Frame update ─────────────────────────────────────────────────────────
const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function sampleIndex(t: number): number {
  const i = Math.round((t - tl.events.start) / tl.dt);
  return Math.max(0, Math.min(tl.samples.length - 1, i));
}

const carry = new THREE.Vector3();
let lastPhase = '';
function emitSmoke(s: Sample, dt: number) {
  if (!display.smoke || dt <= 0) return;
  carry.set(...s.vel);
  car.root.getWorldQuaternion(tmpQ);
  s.thrusterForces.forEach((f, i) => {
    car.nozzles[i].getWorldPosition(tmpV);
    tmpD
      .set(...tl.thrusters[i].direction)
      .negate()
      .applyQuaternion(tmpQ);
    smoke.emitJet(tl.thrusters[i].id, { origin: tmpV, dir: tmpD, carry, throttle: plumeLevel(f) }, dt);
  });
  if (s.phase === 'touchdown' && lastPhase !== 'touchdown') {
    smoke.burst(new THREE.Vector3(s.pos[0], 0, s.pos[2]), 140, 4);
  }
  lastPhase = s.phase;
  const speedNow = norm(s.vel);
  const sliding = (s.phase === 'touchdown' || s.phase === 'settle' || s.phase === 'slide') && speedNow > 0.3;
  if (sliding) {
    // Burnout: rear tires spin against the slide; smoke scales with slip speed.
    [2, 3].forEach((w) => {
      car.wheels[w].getWorldPosition(tmpV);
      tmpV.y = 0.12;
      smoke.emitTire(`tire${w}`, tmpV, carry, Math.min(1, 0.35 + speedNow / 8), dt);
    });
  }
}

let lastIndex = -1;
function renderFrame(simDt: number) {
  const idx = sampleIndex(simTime);
  const s = tl.samples[idx];
  applyPose(car.root, s);
  // Rolling without slipping: the angle is the distance over the wheel's radius.
  car.wheels.forEach(
    (w) => (w.rotation.z = (-s.pos[0] / (w.userData.rollRadius ?? WHEEL_RADIUS)) * (w.userData.spinSign ?? 1)),
  );
  plumes.update(s.thrusterForces, simDt);
  emitSmoke(s, simDt);

  const cg = new THREE.Vector3(...s.pos);
  arrows.update(s, cg, tl.params.mass * G0);
  const view = viewBlockers();
  incidentMarkers.update(simTime, performance.now() / 1000, camera, view.canvas, view.free, view.blockers);
  defaultGhost.update(simTime);
  Object.values(exploreGhosts).forEach((g) => g.update(simTime));

  if (cam === 'chase') {
    // OrbitControls.update() always looks at its target, even when disabled, so steer
    // the target rather than calling camera.lookAt (which update() would override).
    camera.position.lerp(cg.clone().add(new THREE.Vector3(-10, 3.5, -6)), 0.15);
    controls.target.copy(cg);
  }
  controls.update();

  if (idx !== lastIndex) {
    live.update(s, tl);
    hud.update(s, tl);
    Object.values(charts).forEach((c) => c.setCursor(s.t));
    lastIndex = idx;
  }
  clock.textContent = formatTime(s.t);
  footage.sync(simTime, playing, params.footageSlowdown);
  scrub.value = String((simTime - tl.events.start) / (tl.events.end - tl.events.start));

  camera.updateMatrixWorld();
  smoke.update(Math.max(simDt, 0), camera);
  composer.render();
  labelRenderer.render(scene, camera);
}

/** Fit the renderer to the 3D view's size and the screen's current pixel density. */
function resize() {
  const w = host.clientWidth,
    h = host.clientHeight;
  if (!w || !h) return; // hidden or collapsed: keep the last size
  const ratio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h);
  renderer.getDrawingBufferSize(GLOW_RESOLUTION);
  composer.setPixelRatio(ratio);
  composer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fitFov(); // the presets frame 16:9: a narrower view needs a wider field of view
  reframe();
}

/**
 * Re-fit the Wide view after a layout or run change, unless the visitor has moved the camera:
 * once, before the next frame is drawn, however many changes come before it.
 */
function reframe() {
  reframePending = true;
}
let reframePending = false;
function flushReframe() {
  if (!reframePending) return;
  reframePending = false;
  if (cam === 'front' && !framed && !userMoved && tl) frameWide();
}
// The view's own size, not just the window's: any layout change that resizes it counts.
new ResizeObserver(() => resize()).observe(host);
resize();
/**
 * Pixel density changes (browser zoom, or a monitor with other scaling) don't always resize
 * the view, and density media queries don't reliably report them, so each frame compares it.
 */
let pixelRatioSeen = window.devicePixelRatio;
function checkPixelRatio() {
  if (window.devicePixelRatio === pixelRatioSeen) return;
  pixelRatioSeen = window.devicePixelRatio;
  resize();
}

rebuild();
simTime = replayStart();
reframe();
updateLaunch();

const clockTimer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  checkPixelRatio();
  flushReframe();
  clockTimer.update();
  const frameDt = Math.min(clockTimer.getDelta(), 0.1);
  let simDt = 0;
  if (playing) {
    simDt = frameDt * speed;
    const before = simTime;
    simTime += simDt;
    if (incidentMarkers.crossed(before, simTime)) banner.flash();
    if (simTime >= tl.events.end) {
      // The run is over: loop back to the approach. The first time these settings finish,
      // say how it went (a strip at the bottom that fades); later loops just play.
      simTime = replayStart();
      smoke.clear();
      simDt = 0;
      // (Not over the Lab, whose Results tab says the same.)
      if (!resultShown && !labOpen()) {
        resultShown = true;
        endCard.show(tl, flight.mode, RESULT_SECONDS);
        updateLaunch(); // the key hint steps aside for the strip
        fitFootage();
      }
    }
  }
  renderFrame(simDt);
});

// The simulator as WebMCP tools, for AI agents (see README, "WebMCP tools").
const toolHost: ToolHost = {
  params: () => ({ ...params }),
  model: () => flight.mode,
  timeline: () => tl,
  simulate: (p, model) => {
    const ideal = computeTimeline({ ...p });
    return model === 'controlled' ? simulateControlled(ideal) : ideal;
  },
  apply: applyValidated,
  url: (p, model) =>
    p ? `${location.origin}${location.pathname}${toQuery(p, model ?? flight.mode, query.foreign)}` : location.href,
  seek: (t) => scrubTo(t),
  play: (on) => setPlaying(on),
  camera: (c) => setCam(c as Cam),
  frameIncident: (k, play) => {
    const i = tl.incidents[k];
    if (!i) return false;
    if (play) showIncident(i);
    else {
      frameIncident(i);
      setPlaying(false);
      scrubTo(i.t); // exactly at it
    }
    return true;
  },
  view: () => ({ t: simTime, playing, camera: framed ? 'custom' : cam }),
};
// Registered just after the first frame is drawn, so the polyfill doesn't hold it up.
// (Not on idle: the render loop runs every frame, so a busy page may never be idle.)
// `window.webmcpTools` says when they are ready, or why not (for scripts such as the bridge).
const webmcpTools: { ready: boolean; count: number; error?: string } = { ready: false, count: 0 };
Object.assign(window, { webmcpTools });
// Whichever comes first: the first frame, or 1 s (a background tab draws no frames).
let registering = false;
const startRegistering = () => {
  if (registering) return;
  registering = true;
  const watchdog = setTimeout(() => {
    if (!webmcpTools.ready) webmcpTools.error ??= 'WebMCP tool registration has not finished after 20 s';
  }, 20_000);
  registerTools(toolHost)
    .then((n) => Object.assign(webmcpTools, { ready: true, count: n, error: undefined }))
    .catch((e) => {
      webmcpTools.error = String(e?.message ?? e);
      console.warn('WebMCP tools are unavailable:', e);
    })
    .finally(() => clearTimeout(watchdog));
};
requestAnimationFrame(() => setTimeout(startRegistering, 0));
setTimeout(startRegistering, 1000);

// Expose for debugging in the console, as `flyingcar`.
const debugHook = {
  get timeline() {
    return tl;
  },
  params,
  scene,
  seek: (t: number) => scrubTo(t),
  /** Change physics settings (validated; returns the reasons for any rejected) and rebuild. */
  set: (changes: Partial<Record<SettingKey, number>>, model?: FlightMode) => applySettings(changes, model),
  camera: (c: Cam) => setCam(c),
  /** The comparison with the default run: shown now, and whether that run is computed. */
  compare: () => ({ shown: !document.getElementById('legend-default')!.hidden, ready: baselines.has(flight.mode) }),
  play: setPlaying,
  /** Where a world point lands on the page [CSS px], for checking the framing. */
  project: (p: [number, number, number]) => {
    const v = new THREE.Vector3(...p).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  },
  look: (pos: [number, number, number], target: [number, number, number], fov?: number) => {
    setCam('front');
    if (fov) {
      baseFov = fov;
      fitFov();
    }
    camera.position.set(...pos);
    controls.target.set(...target);
    controls.update();
    framed = true; // a custom view: layout changes don't re-fit it
  },
};
Object.assign(window, { flyingcar: debugHook });
