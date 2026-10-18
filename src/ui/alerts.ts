import type { Incident, Timeline } from '../physics/timeline';
import { formatTime } from './format';
import { incidentText, problemList } from './incidents';

/**
 * The red notice under the top bar: why the current settings don't give a
 * valid run. It shows the first problem in full — with a Show button that plays the
 * moment it happens, framed in the 3D view — and folds the rest (later collisions, which
 * are mostly its consequences, and warnings with no time or place) into "n more".
 */
export class AlertBanner {
  readonly root: HTMLElement;
  private signature = '';

  constructor(
    host: HTMLElement,
    private onShow: (incident: Incident) => void,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'alert-banner';
    this.root.setAttribute('aria-label', 'Problems with these settings');
    this.root.hidden = true;
    host.prepend(this.root);
  }

  /**
   * Rebuild only if the problem list changed (so screen readers aren't re-alerted).
   * `extra` are problems outside the run itself, e.g. URL parameters that were ignored.
   */
  update(tl: Timeline, extra: string[] = []) {
    const { first, later, others } = problemList(tl);
    const texts = [first, ...later].filter((i): i is Incident => !!i).map(incidentText);
    const signature = JSON.stringify([texts, others, extra, first?.t, later.map((i) => i.t)]);
    if (signature === this.signature) return;
    this.signature = signature;
    const count = texts.length + others.length;
    this.root.hidden = count + extra.length === 0;
    this.root.replaceChildren();
    if (this.root.hidden) {
      this.root.removeAttribute('role');
      return;
    }
    // An alert region: since it only changes when the problems do, it is announced once per change.
    this.root.setAttribute('role', 'alert');
    if (extra.length) {
      // Ignored URL parameters: always in view, above the run's own problems.
      const p = document.createElement('div');
      p.className = 'alert-url';
      p.innerHTML = '<h2><span class="status-icon" aria-hidden="true">⚠</span>Ignored in the URL</h2>';
      const ul = document.createElement('ul');
      for (const e of extra) {
        const li = document.createElement('li');
        li.textContent = e;
        ul.append(li);
      }
      p.append(ul);
      this.root.append(p);
    }
    if (!count) return;

    const title = document.createElement('h2');
    const blocking =
      first && (first.kind === 'infeasible-plan' || first.kind === 'no-flight' || first.kind === 'no-landing');
    title.innerHTML = `<span class="status-icon" aria-hidden="true">⚠</span>${
      blocking
        ? 'These settings can’t fly'
        : count === 1
          ? 'Problem with these settings'
          : `${count} problems with these settings`
    }`;
    this.root.append(title);

    const item = (text: string, incident?: Incident) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = text;
      li.append(span);
      if (incident) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = `Show ${formatTime(incident.t)}`;
        btn.title = 'Play the moment it happens, framed in the 3D view';
        btn.onclick = () => this.onShow(incident);
        li.append(btn);
      }
      return li;
    };

    const main = document.createElement('ul');
    main.append(first ? item(texts[0], first) : item(others[0]));
    this.root.append(main);
    const rest = [
      ...later.map((i, k) =>
        item(
          `Then ${texts[k + 1].replace(/^Collision: the car /, 'the car ').replace(/^(.)/, (c) => c.toLowerCase())}`,
          i,
        ),
      ),
      ...(first ? others : others.slice(1)).map((w) => item(w)),
    ];
    if (rest.length) {
      const more = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${rest.length} more`;
      const list = document.createElement('ul');
      list.append(...rest);
      more.append(summary, list);
      this.root.append(more);
    }
  }

  /** Draw attention as playback reaches an incident. */
  flash() {
    this.root.classList.remove('flash');
    void this.root.offsetWidth; // restart the animation
    this.root.classList.add('flash');
  }
}

/** Red ticks on the time scrubber at each incident, aligned with the slider thumb's travel. */
export function markScrubber(wrap: HTMLElement, tl: Timeline) {
  wrap.querySelectorAll('.scrub-mark').forEach((m) => m.remove());
  const span = tl.events.end - tl.events.start;
  for (const i of tl.incidents) {
    const mark = document.createElement('span');
    mark.className = 'scrub-mark';
    mark.style.setProperty('--f', String((i.t - tl.events.start) / span));
    wrap.append(mark);
  }
}
