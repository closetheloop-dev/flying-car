import { runReport } from '../physics/report';
import type { FlightMode } from '../physics/settings';
import type { Timeline } from '../physics/timeline';
import { incidentLabel, problemList } from './incidents';
import { fmt, num } from './units';

/** How long the whole result shows before the strip shrinks to its headline. */
const COMPACT_AFTER_MS = 3500;

export interface EndCardActions {
  share: () => void;
  openLab: () => void;
  /** After the card is hidden, by any path (so the page can update its own buttons). */
  hidden: () => void;
}

/**
 * How a run went — stuck the landing, crash, hard landing, grounded — with a few headline
 * numbers: a strip at the bottom of the view, shown the first time a run finishes (playback
 * loops on). It doesn't take focus, and fades after a while unless the pointer is on it.
 */
export class EndCard {
  private timer = 0;
  private holdMs = 0;

  constructor(
    private root: HTMLElement,
    private actions: EndCardActions,
  ) {
    root.addEventListener('pointerenter', () => {
      clearTimeout(this.timer);
      clearTimeout(this.compactTimer);
      root.classList.remove('compact'); // the numbers back while the pointer is on it
    });
    root.addEventListener('pointerleave', () => this.arm());
  }
  private compactTimer = 0;

  get visible() {
    return !this.root.hidden;
  }

  /**
   * Show the result of this run; it hides itself after `seconds` (0: stays until closed).
   * Without `seconds`, it only redraws (e.g. in other units) and keeps its running timer.
   */
  show(tl: Timeline, model: FlightMode, seconds?: number) {
    const r = runReport(tl, model);
    const { first, others } = problemList(tl);
    let title: string,
      sub: string,
      good = false;
    if (!first && others.length === 0) {
      good = true;
      title = 'Stuck the landing!';
      const semi = r.clearanceBySolid?.find((c) => c.solid === 'Semi');
      sub = semi?.gap_m != null ? `Cleared the Semi by ${fmt('length', semi.gap_m)}.` : 'A clean hop.';
    } else if (!first) {
      title = 'Landed, but';
      sub = others[0];
    } else {
      const heads: Record<string, string> = {
        collision: 'Crash!',
        'hard-landing': 'Hard landing',
        'tilted-landing': 'Landed crooked',
        'infeasible-plan': 'Grounded',
        'no-flight': 'Can’t climb',
        'no-landing': 'Never came down',
      };
      title = heads[first.kind] ?? 'Not quite';
      sub =
        first.kind === 'infeasible-plan'
          ? 'No flight meets these settings. Nudge them back toward the real stunt.'
          : `${incidentLabel(first)}.`;
    }
    const stat = (label: string, value: string) =>
      `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
    // Highest the car got (its underside above the ground), whatever happened.
    const top = tl.samples.reduce((m, s) => Math.max(m, s.pos[1]), 0) - tl.params.cgHeight;
    // (A redraw keeps it as small as it was; a new result shows in full.)
    const compact = seconds === undefined && this.root.classList.contains('compact');
    this.root.className = `endcard ${good ? 'good' : 'bad'}${compact ? ' compact' : ''}`;
    this.root.innerHTML = `
      <div class="endcard-head">
        <h2>${title}</h2>
        <p class="sub"></p>
        <button class="icon-btn close" aria-label="Close">✕</button>
      </div>
      <div class="stats">
        ${stat('Peak thrust', r.peakThrust_N != null ? fmt('force', r.peakThrust_N) : '—')}
        ${stat('Driver peak', r.driverPeak_g != null ? `${num(r.driverPeak_g, 1)} g` : '—')}
        ${stat('Nitrogen used', r.nitrogen_kg != null ? fmt('mass', r.nitrogen_kg) : '—')}
        ${stat('Highest', r.flies ? fmt('length', top) : '—')}
      </div>
      <div class="endcard-actions">
        <button class="chip" data-act="share">Share</button>
        <button class="chip" data-act="lab">Open the Lab</button>
      </div>`;
    this.root.querySelector('.sub')!.textContent = sub; // may contain user-derived text
    this.root.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.hide();
    this.root.querySelector<HTMLButtonElement>('[data-act=share]')!.onclick = () => this.actions.share();
    this.root.querySelector<HTMLButtonElement>('[data-act=lab]')!.onclick = () => this.actions.openLab();
    this.root.hidden = false;
    if (seconds !== undefined) {
      this.holdMs = seconds * 1000;
      this.arm();
    }
  }

  hide() {
    clearTimeout(this.timer);
    clearTimeout(this.compactTimer);
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.actions.hidden();
  }

  private arm() {
    clearTimeout(this.timer);
    clearTimeout(this.compactTimer);
    if (this.root.hidden) return;
    if (this.holdMs > 0) this.timer = window.setTimeout(() => this.hide(), this.holdMs);
    // After a moment, just the headline and buttons, so the replay underneath shows.
    this.compactTimer = window.setTimeout(() => this.root.classList.add('compact'), COMPACT_AFTER_MS);
  }
}
