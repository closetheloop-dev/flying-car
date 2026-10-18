/**
 * Picture-in-picture footage panel: shows the source video in sync with the
 * simulation clock, so the simulation can be compared with the real thing.
 *
 * The video shows the stunt four times, from four camera views. Each shot is aligned
 * on its own liftoff, so simulation time t (seconds from liftoff) maps to video time
 * `liftoff + t × footageSlowdown`.
 *
 * Frames are drawn from still images served under /footage/ (frames.json says which there
 * are) rather than by playing a <video>: hardware video decoding stalls on seek and play
 * on some GPUs, and a page cannot turn it off. Images are also
 * frame-accurate and scrub instantly at any playback speed. The frames are extracted from
 * the video separately and aren't part of this source; without them the panel and its
 * toggle hide themselves.
 */
import { FOOTAGE_URL } from './about';
import { SMALL_SCREEN } from './tweak';

export interface Shot {
  label: string;
  /** Shot boundaries and liftoff, in video seconds. */
  start: number;
  end: number;
  liftoff: number;
}

/**
 * One run seen by four cameras. Liftoff (the start of the launch burn, when the body
 * starts to rise) is measured frame by frame in the side-wide view (0:19.00); the others
 * follow from synchronizing the roll, which every view shows, so the same moment of the
 * flight plays in every view (±0.04 s).
 */
export const SHOTS: Record<string, Shot> = {
  '1': { label: 'End-on (0:03–0:11)', start: 3.3, end: 11.55, liftoff: 8.08 },
  '2': { label: 'Front (0:11–0:17)', start: 11.55, end: 17.35, liftoff: 12.81 },
  '3': { label: 'Side, wide (0:17–0:25)', start: 17.35, end: 25.48, liftoff: 19.0 },
  '4': { label: 'Side, close (0:25–0:31)', start: 25.48, end: 31.28, liftoff: 25.93 },
};

const BASE = '/footage';
/** Loaded frames kept in memory (~25 s of footage). */
const CACHE_SIZE = 600;
/** Frames requested ahead of the current one while playing. */
const PREFETCH = 36;

interface Manifest {
  fps: number;
  /** The frames there are, numbered as in the video (1-based): just the shots' span. */
  first: number;
  last: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class FootagePanel {
  readonly root = el('div', 'footage');
  private canvas = el('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private select = el('select');
  private status = el('div', 'footage-status');
  private stamp = el('div', 'footage-stamp');
  private matchBtn = el('button', 'match', 'Match camera');
  private view = '2';
  private manifest: Manifest | null = null;
  private failed = false;
  /** Frame index → image; Map iteration order doubles as LRU order. */
  private cache = new Map<number, HTMLImageElement>();
  private shown = -1;
  private want = -1;

  constructor(onMatchCamera: (view: string) => void) {
    this.root.setAttribute('aria-label', 'Source footage, synced to the simulation');
    const bar = el('div', 'footage-bar');
    for (const [key, shot] of Object.entries(SHOTS)) {
      // Just the view's name, so it fits the bar (the stamp shows the video's time).
      const o = el('option', undefined, shot.label.replace(/\s*\(.*\)$/, ''));
      o.title = shot.label;
      o.value = key;
      this.select.append(o);
    }
    this.select.value = this.view;
    this.select.title = 'Camera view in the footage';
    this.select.onchange = () => this.setView(this.select.value);
    // ("Match" alone where the bar is short.)
    this.matchBtn.innerHTML = 'Match<span class="match-more"> camera</span>';
    this.matchBtn.title = 'Put the 3D camera where the footage camera was (solved for the front view)';
    this.matchBtn.onclick = () => onMatchCamera(this.view);
    const size = el('button', undefined, '⤢');
    size.title = 'Larger / smaller';
    size.onclick = () => {
      this.root.classList.toggle('large');
      this.keepOnScreen(); // a moved window may now reach past the edge
    };
    const hide = el('button', undefined, '✕');
    hide.title = 'Hide footage';
    // Let the page update its own Footage toggle as well.
    hide.onclick = () => this.root.dispatchEvent(new Event('footage-hidden'));
    const grip = el('span', 'footage-grip', '⠿');
    grip.title = 'Drag to move (double-click to put it back)';
    grip.setAttribute('aria-hidden', 'true');
    bar.append(grip, this.select, this.matchBtn, size, hide);

    this.canvas.width = 640;
    this.canvas.height = 360;
    const frame = el('div', 'footage-frame');
    frame.append(this.canvas, this.stamp, this.status);
    // The window moves by its grip or the picture itself (a big target for a finger).
    for (const handle of [grip, frame]) this.draggable(handle);
    const credit = el('a', 'footage-credit', 'Footage: @Tesla on X ↗');
    (credit as HTMLAnchorElement).href = FOOTAGE_URL;
    (credit as HTMLAnchorElement).target = '_blank';
    (credit as HTMLAnchorElement).rel = 'noopener';
    this.root.append(bar, frame, credit);
    this.updateMatchButton();

    fetch(`${BASE}/frames.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      // (A manifest may give `count` instead of `first`/`last`: frames 1 to count.)
      .then(
        (m: Manifest & { count?: number }) =>
          (this.manifest = { fps: m.fps, first: m.first ?? 1, last: m.last ?? m.count ?? 0 }),
      )
      .catch(() => {
        // No frames (they aren't part of the source): the page hides the footage option.
        this.failed = true;
        this.showStatus('The footage isn’t available here.');
        console.info('Footage frames not found under /footage/: the footage panel is hidden.');
        this.root.dispatchEvent(new Event('footage-unavailable'));
      });
  }

  /** Whether the frames could not be loaded (the footage option should be hidden). */
  get unavailable() {
    return this.failed;
  }

  /** Called after the window has been dragged somewhere else, or put back. */
  onMoved: () => void = () => {};

  /** Whether the window has been dragged away from its usual place (until the page reloads). */
  get moved() {
    return this.root.classList.contains('moved');
  }

  /** Keep a moved window fully on screen (after a resize, a rotation or a size change). */
  keepOnScreen() {
    if (!this.moved || this.root.hidden) return;
    const r = this.root.getBoundingClientRect();
    this.place(r.left, r.top);
  }

  /**
   * Put the window here, kept on screen below the top bar (the page's --top-h), so it never
   * covers its buttons, and above the dock (--dock-h). On a phone, where the view between
   * them is small, it may go over the dock's controls and charts too.
   */
  private place(left: number, top: number) {
    const r = this.root.getBoundingClientRect();
    const css = getComputedStyle(document.body); // (body: the collapsed charts change --dock-h there)
    const above = parseFloat(css.getPropertyValue('--top-h')) || 0;
    const below = matchMedia(SMALL_SCREEN).matches
      ? innerHeight
      : innerHeight - (parseFloat(css.getPropertyValue('--dock-h')) || 0);
    const x = Math.min(Math.max(left, 0), Math.max(0, innerWidth - r.width));
    const y = Math.min(Math.max(top, above), Math.max(above, below - r.height));
    this.root.style.left = `${Math.round(x)}px`;
    this.root.style.top = `${Math.round(y)}px`;
  }

  /** The pointer dragging the window (one at a time: a second finger doesn't take over). */
  private dragPointer: number | null = null;

  /** Drag the window by `handle` (mouse, pen or finger); a double-click puts it back. */
  private draggable(handle: HTMLElement) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.dragPointer !== null) return;
      this.dragPointer = e.pointerId;
      const start = this.root.getBoundingClientRect();
      const [x0, y0] = [e.clientX, e.clientY];
      let dragging = false;
      handle.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        if (m.pointerId !== this.dragPointer) return;
        if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
        dragging = true;
        this.root.classList.add('moved', 'dragging');
        this.place(start.left + m.clientX - x0, start.top + m.clientY - y0);
      };
      const end = (u: PointerEvent) => {
        if (u.pointerId !== this.dragPointer) return;
        this.dragPointer = null;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        this.root.classList.remove('dragging');
        if (dragging) this.onMoved();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
    handle.addEventListener('dblclick', () => {
      if (!this.moved) return;
      this.root.classList.remove('moved');
      this.root.style.left = this.root.style.top = '';
      this.onMoved();
    });
  }

  setVisible(v: boolean) {
    this.root.hidden = !v;
  }

  get visible() {
    return !this.root.hidden;
  }

  setView(view: string) {
    if (!SHOTS[view]) return;
    this.view = view;
    this.select.value = view;
    this.updateMatchButton();
  }

  /** Called every frame with the simulation clock (seconds from liftoff). */
  sync(t: number, playing: boolean, slowdown: number) {
    if (this.root.hidden || this.failed || !this.manifest) return;
    const { fps, first, last } = this.manifest;
    const shot = SHOTS[this.view];
    const target = shot.liftoff + t * slowdown;
    const inShot = target >= shot.start && target <= shot.end;
    const clamped = Math.min(Math.max(target, shot.start + 0.02), shot.end - 0.05);
    const frame = (i: number) => Math.min(last, Math.max(first, i));
    const idx = frame(Math.round(clamped * fps) + 1);

    const signed = (v: number, digits: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`;
    this.stamp.textContent = `video ${clamped.toFixed(2)} s · t ${signed(t, 2)} s`;
    if (inShot) this.hideStatus();
    else {
      // The shot's span in simulation time (video time runs `slowdown` × as fast).
      const from = (shot.start - shot.liftoff) / slowdown,
        to = (shot.end - shot.liftoff) / slowdown;
      this.showStatus(`t ${signed(t, 2)} s is outside this shot (${signed(from, 1)} to ${signed(to, 1)} s)`);
    }

    this.want = idx;
    this.request(idx);
    // Prefetch ahead while playing, and a little on both sides while scrubbing.
    const ahead = playing ? PREFETCH : 6;
    for (let k = 1; k <= ahead; k++) this.request(frame(idx + k));
    if (!playing) for (let k = 1; k <= 6; k++) this.request(frame(idx - k));
    this.draw();
  }

  private request(i: number) {
    const hit = this.cache.get(i);
    if (hit) {
      this.cache.delete(i); // refresh LRU position
      this.cache.set(i, hit);
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (i === this.want) this.draw();
    };
    img.src = `${BASE}/frames/${String(i).padStart(5, '0')}.jpg`;
    this.cache.set(i, img);
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Draw the wanted frame, or the nearest loaded one while it arrives. */
  private draw() {
    let best = -1;
    for (let d = 0; d <= 12 && best < 0; d++) {
      for (const i of [this.want - d, this.want + d]) {
        const img = this.cache.get(i);
        if (img && img.complete && img.naturalWidth > 0) {
          best = i;
          break;
        }
      }
    }
    if (best < 0 || best === this.shown) return;
    this.ctx.drawImage(this.cache.get(best)!, 0, 0, this.canvas.width, this.canvas.height);
    this.shown = best;
  }

  private showStatus(text: string) {
    this.status.textContent = text;
    this.status.classList.add('show');
  }

  private hideStatus() {
    this.status.classList.remove('show');
  }

  private updateMatchButton() {
    // Only the front view has a camera solved against the line-up.
    this.matchBtn.disabled = this.view !== '2';
  }
}
