import type { ExploreFlown } from '../physics/explore';
import { SETTING_DOCS } from '../physics/setting-docs';
import { SETTING_BY_KEY, type SettingKey } from '../physics/settings';
import type { Timeline } from '../physics/timeline';
import { problemList } from './incidents';
import { SMALL_SCREEN } from './tweak';
import { axisUnit, fmt, num, onUnitsChange, toDisplay, unitOf } from './units';

/** The comparison runs' colors (the ghosts, their paths and the panel's keys); this run's is the flight path's. */
export const EXPLORE_COLORS = { lower: 0xffb02e, higher: 0xb98cff, current: 0x86b6ef } as const;
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** A setting's value as the Lab shows it, in display units (with a true minus sign). */
function valueText(key: SettingKey, v: number): string {
  const s = SETTING_BY_KEY.get(key)!;
  if (s.quantity) return fmt(s.quantity, v).replace(/^-/, '−');
  const digits = s.integer ? 0 : Math.max(0, -Math.floor(Math.log10(s.step) + 1e-9));
  return `${num(v, digits).replace(/^-/, '−')}${s.displayUnit ? ` ${s.displayUnit}` : ''}`;
}

/** Whether two runs fly the same path, to a few centimeters (and, with `attitude`, facing the same way). */
function samePath(a: Timeline, b: Timeline, attitude: boolean): boolean {
  if (a.samples.length !== b.samples.length) return false;
  for (let i = 0; i < a.samples.length; i += 5) {
    const [p, q] = [a.samples[i], b.samples[i]];
    if (Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1], p.pos[2] - q.pos[2]) > 0.05) return false;
    if (attitude && p.R.some((r, j) => Math.abs(r - q.R[j]) > 0.01)) return false;
  }
  return true;
}

/**
 * The panel for /?explore=<key>: which setting the colored cars compare, what it does, and
 * how the lower, current and higher values come out. Only the note under the table is
 * announced as it changes (the table would be read out again on every settings change).
 */
export class ExplorePanel {
  readonly root = document.createElement('section');
  private name = document.createElement('p');
  private hint = document.createElement('p');
  private table = document.createElement('div');
  private note = document.createElement('p');
  private fold = document.createElement('button');
  /** Folded: just the setting and the three values (the key to the colored cars). */
  private folded = matchMedia(SMALL_SCREEN).matches;
  private last: Parameters<ExplorePanel['show']> | null = null;

  constructor(onClose: () => void) {
    this.root.className = 'explore';
    this.root.setAttribute('aria-label', 'Explore a setting');
    this.root.hidden = true;
    const head = document.createElement('div');
    head.className = 'explore-head';
    head.innerHTML = '<span class="explore-title">Exploring</span>';
    const buttons = document.createElement('span');
    buttons.className = 'explore-buttons';
    this.fold.className = 'icon-btn explore-fold';
    this.fold.onclick = () => this.setFolded(!this.folded);
    const close = document.createElement('button');
    close.className = 'icon-btn explore-close';
    close.setAttribute('aria-label', 'Stop exploring');
    close.textContent = '✕';
    close.onclick = onClose;
    buttons.append(this.fold, close);
    head.append(buttons);
    this.name.className = 'explore-name';
    this.hint.className = 'explore-hint explore-more';
    this.note.className = 'explore-note';
    this.note.setAttribute('aria-live', 'polite');
    this.root.append(head, this.name, this.hint, this.table, this.note);
    this.setFolded(this.folded);
    onUnitsChange(() => this.last && this.show(...this.last));
  }

  /**
   * Show the comparison for `key`: `runs` null while they are still being worked out;
   * `message`, if given, says why there is nothing to compare instead.
   */
  show(key: SettingKey, current: Timeline, runs: ExploreFlown[] | null, message?: string) {
    this.last = [key, current, runs, message];
    const s = SETTING_BY_KEY.get(key)!;
    this.name.innerHTML = `<b></b> <a href="/guide/#${key}" target="_blank" rel="noopener">More ↗</a>`;
    this.name.querySelector('b')!.textContent = s.label;
    this.hint.textContent = SETTING_DOCS[key]?.hint ?? '';
    const side = (which: 'lower' | 'higher') => runs?.find((r) => r.run.side === which) ?? null;
    const cols: [string, number, Timeline | null, number | null][] = [
      ['Lower', EXPLORE_COLORS.lower, side('lower')?.tl ?? null, side('lower')?.run.value ?? null],
      ['Yours', EXPLORE_COLORS.current, current, current.params[key] as number],
      ['Higher', EXPLORE_COLORS.higher, side('higher')?.tl ?? null, side('higher')?.run.value ?? null],
    ];
    const flown = cols.flatMap(([, , tl]) => (tl ? [tl] : []));
    const cell = (f: (tl: Timeline) => string) => cols.map(([, , tl]) => `<td>${tl ? f(tl) : '—'}</td>`).join('');
    const ok = (tl: Timeline) => {
      const { first, others } = problemList(tl);
      return first || others.length
        ? '<span class="bad" role="img" aria-label="no">⚠</span>'
        : '<span class="ok" role="img" aria-label="yes">✓</span>';
    };
    // The units go in the row names, so the three columns fit the card.
    const force = axisUnit('force', Math.max(...flown.map((tl) => tl.summary.peakThrust.value)));
    const mass = unitOf('mass');
    const missing = (which: 'lower' | 'higher') => {
      if (side(which)) return '';
      const end = which === 'lower' ? s.min : s.max;
      return (current.params[key] as number) === end
        ? ` It is already at its ${which === 'lower' ? 'lowest' : 'highest'}.`
        : ` No ${which} value nearby still flies.`;
    };
    const turned = runs?.some((r) => samePath(r.tl, current, false) && !samePath(r.tl, current, true));
    const fitted = !message && key !== 'airTimeVideo' && runs?.some((r) => r.run.changes.airTimeVideo !== undefined);
    const note =
      message ??
      (runs === null
        ? 'Working out the lower and higher runs (a few seconds)…'
        : !runs.length
          ? `Nothing to compare:${missing('lower')}${missing('higher')}`
          : (runs.every((r) => samePath(r.tl, current, true))
              ? 'They all fly the same way: what changes is in the numbers.'
              : turned
                ? 'They fly the same path, but turn differently: watch the colored cars.'
                : 'The colored cars fly the lower and higher values beside yours.') +
            missing('lower') +
            missing('higher'));
    this.table.innerHTML =
      `<table class="explore-table"><thead><tr><td></td>` +
      cols
        .map(
          ([name, color, , v]) =>
            `<th scope="col"><span class="key" style="background:${css(color)}"></span>${name}<br><span class="explore-value">${v === null ? '—' : valueText(key, v)}</span></th>`,
        )
        .join('') +
      `</tr></thead><tbody class="explore-more">` +
      `<tr><th scope="row">Air time${fitted ? '*' : ''}, s</th>${cell((tl) => num(tl.params.airTimeVideo, 2))}</tr>` +
      `<tr><th scope="row">Peak thrust, ${force.unit}</th>${cell((tl) => num(tl.summary.peakThrust.value * force.factor, force.factor < 1e-2 ? 1 : 0))}</tr>` +
      `<tr><th scope="row">Nitrogen, ${mass}</th>${cell((tl) => num(toDisplay('mass', tl.summary.gasMass), 0))}</tr>` +
      `<tr><th scope="row">Peak g-load</th>${cell((tl) => num(tl.summary.peakOccupantG.value, 1))}</tr>` +
      `<tr><th scope="row">Lands well</th>${cell(ok)}</tr>` +
      `</tbody></table>`;
    const text = `${note}${fitted ? ' *The air time was fitted so the hop still lands.' : ''}`;
    if (this.note.textContent !== text) this.note.textContent = text;
    // (While working, or with nothing to compare, the note shows folded too.)
    this.note.classList.toggle('explore-more', runs !== null && !message && runs.length > 0);
    this.root.hidden = false;
  }

  private setFolded(f: boolean) {
    this.folded = f;
    this.root.classList.toggle('folded', f);
    // In words: a bare ▸ reads as "play".
    this.fold.textContent = f ? 'Details ▾' : 'Less ▴';
    // (Starting with the word shown, so voice control finds it by what it says.)
    this.fold.setAttribute('aria-label', f ? 'Details: show the comparison’s details' : 'Less: hide the details');
    this.fold.setAttribute('aria-expanded', String(!f));
  }

  hide() {
    this.last = null;
    this.root.hidden = true;
  }
}
