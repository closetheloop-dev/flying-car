import GUI, { type Controller } from 'lil-gui';
import { DEFAULT_PARAMS, type Params } from '../physics/params';
import { FOLDER_DOCS, MODE_DOCS, SETTING_DOCS } from '../physics/setting-docs';
import { CLOSED_LOOP_FOLDER, FOLDER_NAMES, SETTINGS, type FlightMode, type SettingKey } from '../physics/settings';
import { inputUnit, onUnitsChange } from './units';

export type { FlightMode };

export interface DisplayOptions {
  forceArrows: boolean;
  arrowLabels: boolean;
  flightPath: boolean;
  ghosts: boolean;
  /** When the settings differ from the defaults: the default run's path and a ghost car flying it. */
  compare: boolean;
  smoke: boolean;
  /** Smoke emission multiplier, 0–2. */
  smokeAmount: number;
  bloom: boolean;
  // Rendering features that cost frame rate or can flicker on some GPUs.
  lightGlow: boolean;
  reflections: boolean;
  shadows: boolean;
  clearcoat: boolean;
  smaa: boolean;
}

/**
 * A setting's one-line explanation: the row's tooltip, and an ⓘ button (for touch and the
 * keyboard) that shows it under the row, with a link to the setting on the reference page
 * and one that flies it lower and higher alongside.
 */
function addHint(c: Controller, key: SettingKey, onExplore?: (key: SettingKey) => void) {
  const doc = SETTING_DOCS[key];
  if (!doc) return;
  c.domElement.title = doc.hint;
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'lab-info';
  info.textContent = 'ⓘ';
  info.setAttribute('aria-label', `What ${c._name} does`);
  info.setAttribute('aria-expanded', 'false');
  const line = document.createElement('p');
  line.className = 'lab-hint';
  line.hidden = true;
  line.textContent = `${doc.hint} `;
  const more = document.createElement('a');
  more.href = `/guide/#${key}`;
  more.target = '_blank';
  more.rel = 'noopener';
  more.textContent = 'More ↗';
  line.append(more);
  if (onExplore) {
    const compare = document.createElement('button');
    compare.type = 'button';
    compare.className = 'link-btn';
    compare.textContent = 'Compare lower and higher';
    compare.onclick = () => onExplore(key);
    line.append(' · ', compare);
  }
  info.onclick = (e) => {
    e.preventDefault();
    line.hidden = !line.hidden;
    info.setAttribute('aria-expanded', String(!line.hidden));
  };
  c.$name.prepend(info); // before the label: long labels are cut off at their end
  c.domElement.after(line);
}

/** A round step giving roughly `n` positions across the range. */
function niceStep(range: number, n = 100): number {
  const raw = range / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = raw / mag;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * mag;
}

/**
 * The Parameters panel (in the Lab drawer, inside `container`). Values are stored in SI on
 * `params`; each slider shows them in the current display units and the panel rebuilds
 * when units change. Returns `refresh`, to show values changed elsewhere (the URL, tools,
 * the Tweak card).
 */
export function buildControls(
  params: Params,
  display: DisplayOptions,
  onParams: () => void,
  onDisplay: () => void,
  flight: { mode: FlightMode } = { mode: 'ideal' },
  container?: HTMLElement,
  hooks: {
    /** Fly a setting lower and higher alongside (the hints' Compare link). */
    onExplore?: (key: SettingKey) => void;
    /** Reset to the real stunt the page's way (on a phone it asks first); without it, at once. */
    onReset?: () => void;
  } = {},
): { refresh: () => void; setCanReset: (can: boolean) => void; setListening: (on: boolean) => void } {
  const { onExplore } = hooks;
  let gui: GUI | null = null;
  // Folders start collapsed; what the user opens stays open across rebuilds (unit changes).
  let openFolders = new Set<string>();
  const applyDefaults = () => Object.assign(params, DEFAULT_PARAMS);
  let resetCtl: Controller | null = null;
  let canReset = true;
  let refreshAll = () => {};
  let displayControllers: GUI['controllers'] = [];
  let listening = false;

  const build = () => {
    if (gui) {
      openFolders = new Set(gui.folders.filter((f) => !f._closed).map((f) => f._title));
      gui.destroy();
    }
    gui = new GUI({ title: 'Parameters', container, width: container ? undefined : 310 });
    const refreshers: (() => void)[] = [];
    refreshAll = () => refreshers.forEach((r) => r());

    // What every setting does, in full, on the reference page.
    const guide = document.createElement('a');
    guide.className = 'lab-guide';
    guide.href = '/guide/';
    guide.target = '_blank';
    guide.rel = 'noopener';
    guide.textContent = 'Guide: what each setting does ↗';
    gui.$children.prepend(guide);

    // The flight model, what it means, and only the settings that apply to it.
    const modeNote = document.createElement('p');
    modeNote.className = 'lab-note';
    let closedLoop: GUI | null = null;
    const showMode = () => {
      modeNote.textContent = MODE_DOCS[flight.mode].text;
      closedLoop?.show(flight.mode === 'controlled');
    };
    const mode = gui
      .add(flight, 'mode', {
        // (Short, to fit; the note under the selector says what each does.)
        'Closed-loop': 'controlled',
        Ideal: 'ideal',
      })
      .name('Flight model')
      .onChange(() => {
        showMode();
        onParams();
      });
    mode.domElement.after(modeNote);
    refreshers.push(() => {
      mode.updateDisplay();
      showMode();
    });

    for (const name of FOLDER_NAMES) {
      const folder = gui.addFolder(name);
      if (name === CLOSED_LOOP_FOLDER) closedLoop = folder;
      folder.domElement.title = FOLDER_DOCS[name] ?? '';
      for (const { key, label, quantity: q, min, max, step } of SETTINGS.filter((s) => s.folder === name)) {
        const u = q ? inputUnit(q) : { unit: '', factor: 1 };
        const proxy = { v: (params[key] as number) * u.factor };
        const lo = Math.min(min, max) * u.factor,
          hi = Math.max(min, max) * u.factor;
        const s = q ? niceStep(hi - lo, (max - min) / step) : step;
        const decimals = Math.max(0, -Math.floor(Math.log10(s) + 1e-9));
        // The slider shows a rounded value; remember it so releasing an untouched slider
        // doesn't write the rounding back (e.g. 6.0 m → 19.7 ft → 6.0046 m).
        let shown = Number(proxy.v.toFixed(decimals));
        proxy.v = shown;
        const c = folder
          .add(proxy, 'v', lo, hi, s)
          .decimals(decimals)
          .name(q ? `${label} (${u.unit})` : label)
          .onFinishChange((v: number) => {
            if (v === shown) return;
            shown = v;
            (params[key] as number) = v / u.factor;
            onParams();
          });
        refreshers.push(() => {
          shown = Number(((params[key] as number) * u.factor).toFixed(decimals));
          proxy.v = shown;
          c.updateDisplay();
        });
        addHint(c, key, onExplore);
      }
      if (name === CLOSED_LOOP_FOLDER) {
        folder
          .add(
            {
              reroll: () => {
                params.seed = 1 + Math.floor(Math.random() * 999);
                refreshAll();
                onParams();
              },
            },
            'reroll',
          )
          .name('New disturbance draw');
      }
    }

    const disp = gui.addFolder('Display');
    disp.add(display, 'forceArrows').name('Force arrows').onChange(onDisplay);
    disp.add(display, 'arrowLabels').name('Arrow labels').onChange(onDisplay);
    disp.add(display, 'flightPath').name('Flight path').onChange(onDisplay);
    disp.add(display, 'ghosts').name('Ghost trail').onChange(onDisplay);
    disp.add(display, 'compare').name('Real-stunt car').onChange(onDisplay);
    disp.add(display, 'smoke').name('Gas & tire smoke').onChange(onDisplay);
    disp.add(display, 'smokeAmount', 0, 2, 0.1).name('Smoke amount').onChange(onDisplay);
    disp.add(display, 'bloom').name('Glow (bloom)').onChange(onDisplay);
    // The Tweak card switches some of these too; follow its changes while the panel shows.
    displayControllers = disp.controllers;
    displayControllers.forEach((c) => c.listen(listening));

    // Costly or GPU-sensitive features: switch one off for frame rate, or to see whether it
    // is what flickers on a given GPU.
    const render = gui.addFolder('Rendering');
    render.add(display, 'lightGlow').name('Light-strip glow').onChange(onDisplay);
    render.add(display, 'reflections').name('Reflections').onChange(onDisplay);
    render.add(display, 'shadows').name('Shadows').onChange(onDisplay);
    render.add(display, 'clearcoat').name('Glossy clearcoat').onChange(onDisplay);
    render.add(display, 'smaa').name('Edge smoothing (SMAA)').onChange(onDisplay);

    resetCtl = gui
      .add(
        {
          reset: () => {
            if (hooks.onReset) return hooks.onReset();
            applyDefaults();
            refreshAll();
            onParams();
          },
        },
        'reset',
      )
      .name('↺ Reset to the real stunt (keeps the flight model)')
      .enable(canReset);
    resetCtl.domElement.classList.add('lab-reset');

    gui.folders.forEach((f) => (openFolders.has(f._title) ? f.open() : f.close()));
    showMode();
  };

  build();
  onUnitsChange(build);
  return {
    refresh: () => refreshAll(),
    /** Whether Reset has anything to do (the settings differ from the real stunt's). */
    setCanReset: (can: boolean) => {
      canReset = can;
      resetCtl?.enable(can);
    },
    /** Follow display changes made elsewhere (each listening control polls every frame). */
    setListening: (on: boolean) => {
      listening = on;
      displayControllers.forEach((c) => c.listen(on));
    },
  };
}
