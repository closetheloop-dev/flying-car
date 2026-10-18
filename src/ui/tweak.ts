import type { Params } from '../physics/params';
import { SETTING_BY_KEY, type SettingKey } from '../physics/settings';
import type { Timeline } from '../physics/timeline';
import type { DisplayOptions } from './controls';
import { incidentLabel, problemList } from './incidents';
import { inputUnit, num, onUnitsChange } from './units';

/**
 * The settings a visitor can play with without opening the Lab. `min`/`max` narrow a
 * slider to where the hop can still be made to fly by fitting its air time (main.ts), from
 * the stunt's other settings; the Lab keeps each setting's full range.
 */
const KNOBS: { key: SettingKey; label: string; hint?: string; min?: number; max?: number }[] = [
  { key: 'mass', label: 'Mass at liftoff' },
  { key: 'apexHeight', label: 'Hop height', hint: 'center of mass at the top', min: 6.75 },
  { key: 'range', label: 'Range', hint: 'liftoff to touchdown; longer is faster' },
  { key: 'rollTurns', label: 'Barrel rolls', hint: '↺ rolls toward the parked cars, ↻ away from them' },
  { key: 'rollDurationVideo', label: 'Roll time', hint: 'seconds for the whole roll', min: 0.75, max: 2.3 },
];

const SWITCHES: { key: keyof DisplayOptions; label: string }[] = [
  { key: 'smoke', label: 'Smoke' },
  { key: 'bloom', label: 'Glow' },
  { key: 'flightPath', label: 'Flight path' },
  { key: 'ghosts', label: 'Ghost trail' },
  { key: 'compare', label: 'Real-stunt car' },
  { key: 'forceArrows', label: 'Force arrows' },
];

const COLLAPSED_KEY = 'flyingcar:tweak-collapsed';
/** Phones, either way up (matches the small-screen rules in style.css). */
export const SMALL_SCREEN = '(max-width: 700px), (max-height: 500px)';

export interface TweakOptions {
  params: Params;
  display: DisplayOptions;
  /** Apply validated setting changes (SI) the way a URL or tool would. */
  set: (changes: Record<string, number>) => void;
  onDisplay: () => void;
  reset: () => void;
  /** The card was opened (true) or folded/hidden (false). */
  onFold?: (open: boolean) => void;
}

/**
 * The Tweak card: a few big-effect settings as sliders, some fun display switches, and
 * whether the flight still works. Sliders show display units; values apply on release.
 */
export class TweakCard {
  private body = document.createElement('div');
  private status = document.createElement('div');
  /** What the card did to keep the hop flyable (e.g. a fitted air time), under the status. */
  private note = document.createElement('div');
  private refreshers: (() => void)[] = [];
  private switchBoxes: [keyof DisplayOptions, HTMLInputElement][] = [];

  constructor(
    private root: HTMLElement,
    private o: TweakOptions,
  ) {
    const head = document.createElement('div');
    head.className = 'tweak-head';
    head.innerHTML = '<span class="tweak-title">Tweak it</span>';
    const fold = document.createElement('button');
    fold.className = 'icon-btn';
    head.append(fold);
    // On a phone it is hidden (collapsed hides it entirely there) until opened with the top
    // bar's Tweak, on every visit; elsewhere it folds to its header, and that is remembered.
    const small = matchMedia(SMALL_SCREEN);
    const stored = (() => {
      try {
        return localStorage.getItem(COLLAPSED_KEY);
      } catch {
        return null;
      }
    })();
    const setCollapsed = (c: boolean, remember = true) => {
      root.classList.toggle('collapsed', c);
      fold.textContent = small.matches ? '✕' : c ? '▸' : '▾';
      fold.setAttribute('aria-label', c ? 'Show the tweaks' : 'Hide the tweaks');
      fold.setAttribute('aria-expanded', String(!c));
      this.o.onFold?.(!c);
      if (!remember || small.matches) return;
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '1' : '0');
      } catch {
        /* private mode */
      }
    };
    this.setCollapsed = setCollapsed;
    fold.onclick = () => setCollapsed(!root.classList.contains('collapsed'));
    setCollapsed(small.matches || stored === '1', false);
    small.addEventListener('change', () => setCollapsed(root.classList.contains('collapsed'), false));
    this.body.className = 'tweak-body';
    root.append(head, this.body);
    this.build();
    onUnitsChange(() => this.build());
  }

  private build() {
    const { params } = this.o;
    this.body.replaceChildren();
    this.refreshers = [];
    for (const { key, label, hint, min, max } of KNOBS) {
      const setting = SETTING_BY_KEY.get(key)!;
      const s = { ...setting, min: min ?? setting.min, max: max ?? setting.max };
      const u = s.quantity ? inputUnit(s.quantity) : { unit: s.displayUnit, factor: 1 };
      const knob = document.createElement('label');
      knob.className = 'knob';
      knob.innerHTML = `<span class="knob-top"><span class="knob-label">${label}</span><span class="knob-value"></span></span>`;
      const input = document.createElement('input');
      input.type = 'range';
      // The slider moves in display units; values snap to the setting's own step in SI, so
      // the ends of the range and the real stunt's values land exactly.
      const step = s.step * u.factor;
      const lo = s.min * u.factor;
      input.min = String(lo);
      // The top on the step grid from the bottom (the browser snaps to it), so the slider's
      // end is reachable; snap() maps it to the setting's max.
      // (Plus a hair, so floating-point rounding can't leave the last grid step past it.)
      input.max = String(lo + Math.round((s.max * u.factor - lo) / step) * step + step * 1e-3);
      input.step = String(step);
      const snap = (display: number) => {
        // The ends of the slider are the ends of the range, whatever the unit grid's rounding.
        if (display >= Number(input.max) - step / 2) return s.max;
        if (display <= Number(input.min) + step / 2) return s.min;
        const si = Math.round(display / u.factor / s.step) * s.step;
        return Number(Math.min(Math.max(si, s.min), s.max).toFixed(6));
      };
      const decimals = s.integer || step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
      const value = knob.querySelector<HTMLElement>('.knob-value')!;
      const show = (si: number) => {
        const text =
          key === 'rollTurns'
            ? si === 0
              ? 'none'
              : `${Math.abs(si)} ${si < 0 ? '↺' : '↻'}`
            : `${num(si * u.factor, decimals)} ${u.unit}`;
        value.textContent = text;
        input.setAttribute(
          'aria-valuetext',
          key === 'rollTurns'
            ? si === 0
              ? 'no roll'
              : `${Math.abs(si)} ${si < 0 ? 'toward the parked cars' : 'away from the parked cars'}`
            : text,
        );
      };
      input.oninput = () => show(snap(Number(input.value)));
      input.onchange = () => this.o.set({ [key]: snap(Number(input.value)) });
      input.setAttribute('aria-label', label);
      knob.append(input);
      if (hint) knob.insertAdjacentHTML('beforeend', `<span class="knob-hint">${hint}</span>`);
      this.body.append(knob);
      this.refreshers.push(() => {
        input.value = String((params[key] as number) * u.factor);
        show(params[key] as number);
      });
    }
    this.status.className = 'status-line';
    this.status.setAttribute('role', 'status');
    this.note.className = 'tweak-note';
    this.note.setAttribute('aria-live', 'polite');
    this.note.hidden = !this.note.textContent;
    this.body.append(this.status, this.note);
    if (this.lastTimeline) this.setStatus(this.lastTimeline);

    const sw = document.createElement('div');
    sw.className = 'switches';
    this.switchBoxes = SWITCHES.map(({ key, label }) => {
      const l = document.createElement('label');
      l.className = 'switch';
      const box = document.createElement('input');
      box.type = 'checkbox';
      if (key === 'compare') l.title = 'The real stunt flown alongside, when your settings differ from it';
      if (key === 'ghosts') l.title = 'Snapshots of the car along its path';
      box.onchange = () => {
        (this.o.display[key] as boolean) = box.checked;
        this.o.onDisplay();
      };
      l.append(box, label);
      sw.append(l);
      return [key, box];
    });
    this.body.append(sw);

    // (Kept in view at the bottom of the card, however far it scrolls.)
    const actions = document.createElement('div');
    actions.className = 'tweak-actions';
    this.resetBtn.className = 'chip';
    this.resetBtn.onclick = () => {
      if (this.canReset) this.o.reset();
    };
    this.setCanReset(this.canReset);
    actions.append(this.resetBtn);
    this.body.append(actions);
    this.refresh();
  }

  private setCollapsed: (c: boolean) => void = () => {};

  /** Unfold the card (on a phone: show it) and put focus in it, or fold (hide) it. */
  toggle() {
    const open = this.root.classList.contains('collapsed');
    this.setCollapsed(!open);
    if (open) this.body.querySelector<HTMLInputElement>('input')?.focus();
  }

  /** Whether Reset has anything to do (the settings differ from the real stunt's). */
  setCanReset(can: boolean) {
    // aria-disabled, not disabled: it stays reachable, and its label says why it does nothing.
    this.canReset = can;
    this.resetBtn.setAttribute('aria-disabled', String(!can));
    this.resetBtn.textContent = can ? '↺ Reset to the real stunt' : 'These are the real stunt’s settings';
  }
  private resetBtn = document.createElement('button');
  private canReset = false;

  /** A short line under the status about what the card adjusted ('' hides it). */
  setNote(text: string) {
    this.note.textContent = text;
    this.note.hidden = !text;
  }

  /** Show the current settings and display switches (after any change from elsewhere). */
  refresh() {
    this.refreshers.forEach((r) => r());
    for (const [key, box] of this.switchBoxes) box.checked = this.o.display[key] as boolean;
  }

  /**
   * Whether this flight works, in a line, in this card's terms (the problem notice and the
   * Lab name the settings the physics uses, some of which only the Lab has).
   */
  setStatus(tl: Timeline) {
    this.lastTimeline = tl;
    const { first, others } = problemList(tl);
    const bad = !!first || others.length > 0;
    this.status.classList.toggle('ok', !bad);
    this.status.classList.toggle('bad', bad);
    this.status.textContent = !bad
      ? '✓ It flies, and lands.'
      : first?.kind === 'infeasible-plan'
        ? '⚠ Can’t fly like this, at any time in the air. Try a smaller change.'
        : first
          ? `⚠ ${incidentLabel(first)}`
          : others[0].startsWith('Over rated force')
            ? '⚠ It flies, but pushes a thruster past its rating (see the Lab).'
            : '⚠ It flies, with a warning. See the Lab’s Results.';
  }
  private lastTimeline: Timeline | null = null;
}
