/**
 * Single-series time chart (small multiple). Canvas-drawn line + 10% area wash,
 * hairline grid, clean ticks, labeled reference lines and event markers, a
 * playback cursor, and a hover crosshair with tooltip. Click or drag to scrub.
 */
export interface ChartSpec {
  title: string;
  unit: string;
  digits: number;
  /** Fixed reference lines, e.g. the car's weight. Labeled in text ink, never by color alone. */
  refs?: { value: number; label: string }[];
}

export interface ChartEvent {
  t: number;
  label: string;
  /** A collision or other incident: drawn as a red line, labeled at the top. */
  critical?: boolean;
}

/** The site's palette (src/style.css), for drawing on canvas. */
const C = {
  surface: '#0e131c',
  grid: '#1d2533',
  axis: '#6f7a8e',
  text: '#a9b4c7',
  textPrimary: '#f2f6ff',
  series: '#3fd0ff',
  cursor: '#f2f6ff',
  critical: '#ff5a6e',
};
const FONT = "'Inter Variable', system-ui, sans-serif";

const PAD = { l: 44, r: 10, t: 22, b: 18 };

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export class TimeChart {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private t: Float64Array = new Float64Array();
  private v: Float64Array = new Float64Array();
  private events: ChartEvent[] = [];
  private t0 = 0;
  private t1 = 1;
  private yMin = 0;
  private yMax = 1;
  private cursorT = 0;
  private hoverX: number | null = null;

  constructor(
    private spec: ChartSpec,
    private onScrub: (t: number) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'chart';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `${spec.title} over time`);
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.el.append(this.canvas, this.tip);

    let dragging = false;
    const scrubAt = (e: PointerEvent) => this.onScrub(this.xToT(e.offsetX));
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      scrubAt(e);
    });
    this.canvas.addEventListener('pointerup', () => (dragging = false));
    this.canvas.addEventListener('pointermove', (e) => {
      this.hoverX = e.offsetX;
      if (dragging) scrubAt(e);
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.draw();
    });
    new ResizeObserver(() => this.draw()).observe(this.el);
  }

  setData(t: Float64Array, v: Float64Array, window: [number, number], events: ChartEvent[]) {
    this.t = t;
    this.v = v;
    [this.t0, this.t1] = window;
    this.events = events;
    let lo = 0,
      hi = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < this.t0 || t[i] > this.t1) continue;
      lo = Math.min(lo, v[i]);
      hi = Math.max(hi, v[i]);
    }
    for (const r of this.spec.refs ?? []) hi = Math.max(hi, r.value);
    if (hi - lo < 1e-9) hi = lo + 1;
    const step = niceStep(hi - lo, 4);
    this.yMin = Math.floor(lo / step) * step;
    this.yMax = Math.ceil((hi * 1.05) / step) * step;
    this.draw();
  }

  setRefs(refs: { value: number; label: string }[]) {
    this.spec = { ...this.spec, refs };
  }

  setUnit(unit: string, digits: number) {
    this.spec = { ...this.spec, unit, digits };
  }

  setCursor(t: number) {
    this.cursorT = t;
    this.draw();
  }

  private xToT(x: number): number {
    const w = this.canvas.clientWidth - PAD.l - PAD.r;
    return this.t0 + ((x - PAD.l) / w) * (this.t1 - this.t0);
  }

  private valueAt(t: number): number {
    if (!this.t.length) return NaN;
    const dt = this.t[1] - this.t[0];
    const i = Math.max(0, Math.min(this.t.length - 1, Math.round((t - this.t[0]) / dt)));
    return this.v[i];
  }

  draw() {
    const cv = this.canvas;
    const W = this.el.clientWidth,
      H = this.el.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.surface;
    g.fillRect(0, 0, W, H);

    const pw = W - PAD.l - PAD.r,
      ph = H - PAD.t - PAD.b;
    const X = (t: number) => PAD.l + ((t - this.t0) / (this.t1 - this.t0)) * pw;
    const Y = (v: number) => PAD.t + (1 - (v - this.yMin) / (this.yMax - this.yMin)) * ph;
    const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: this.spec.digits });

    g.font = `600 12px ${FONT}`;
    g.fillStyle = C.textPrimary;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillText(`${this.spec.title} (${this.spec.unit})`, PAD.l, 4);

    // Grid + y ticks.
    g.font = `11px ${FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    const step = niceStep(this.yMax - this.yMin, 4);
    for (let v = this.yMin; v <= this.yMax + step * 0.01; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = C.grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(PAD.l, y);
      g.lineTo(W - PAD.r, y);
      g.stroke();
      g.fillStyle = C.text;
      g.fillText(fmt.format(v), PAD.l - 6, y);
    }
    // x ticks every second.
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let t = Math.ceil(this.t0); t <= this.t1; t += 1) {
      g.fillStyle = C.text;
      g.fillText(`${t} s`, X(t), H - PAD.b + 4);
    }

    // Event markers.
    g.textBaseline = 'top';
    for (const e of this.events) {
      if (e.t < this.t0 || e.t > this.t1) continue;
      const x = Math.round(X(e.t)) + 0.5;
      g.strokeStyle = e.critical ? C.critical : '#3a3a37';
      g.lineWidth = e.critical ? 2 : 1;
      g.beginPath();
      g.moveTo(x, PAD.t);
      g.lineTo(x, H - PAD.b);
      g.stroke();
    }
    g.lineWidth = 1;

    // Area wash + line.
    if (this.t.length) {
      g.beginPath();
      let started = false;
      let lastX = 0;
      for (let i = 0; i < this.t.length; i++) {
        if (this.t[i] < this.t0 || this.t[i] > this.t1) continue;
        const x = X(this.t[i]),
          y = Y(this.v[i]);
        if (!started) {
          g.moveTo(x, Y(Math.max(this.yMin, 0)));
          g.lineTo(x, y);
          started = true;
        } else g.lineTo(x, y);
        lastX = x;
      }
      g.lineTo(lastX, Y(Math.max(this.yMin, 0)));
      g.closePath();
      g.fillStyle = 'rgba(57,135,229,0.10)';
      g.fill();

      g.beginPath();
      started = false;
      for (let i = 0; i < this.t.length; i++) {
        if (this.t[i] < this.t0 || this.t[i] > this.t1) continue;
        const x = X(this.t[i]),
          y = Y(this.v[i]);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      }
      g.strokeStyle = C.series;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.stroke();
    }

    // Reference lines, labeled in text ink.
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.font = `11px ${FONT}`;
    const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const r of this.spec.refs ?? []) {
      const y = Math.round(Y(r.value)) + 0.5;
      g.strokeStyle = C.axis;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(PAD.l, y);
      g.lineTo(W - PAD.r, y);
      g.stroke();
      // On a backing in the chart's color, so it stays legible where the curve passes under it.
      const w = g.measureText(r.label).width;
      g.fillStyle = 'rgba(14, 19, 28, 0.85)';
      g.fillRect(W - PAD.r - 5 - w, y - 15, w + 6, 13);
      g.fillStyle = C.text;
      g.fillText(r.label, W - PAD.r - 2, y - 2);
      taken.push({ x0: W - PAD.r - 2 - w, x1: W - PAD.r - 2, y0: y - 15, y1: y - 2 });
    }

    // Incident labels along the top, skipped wherever they would overprint another label.
    g.font = `600 11px ${FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    for (const e of [...this.events].filter((ev) => ev.critical).sort((a, b) => a.t - b.t)) {
      if (e.t < this.t0 || e.t > this.t1) continue;
      const x = Math.round(X(e.t)) + 0.5;
      const text = `⚠ ${e.label}`;
      const w = g.measureText(text).width;
      const x0 = x + 4 + w <= W - PAD.r ? x + 4 : x - 4 - w;
      const box = { x0, x1: x0 + w, y0: PAD.t + 1, y1: PAD.t + 15 };
      const clash =
        box.x0 < PAD.l || taken.some((b) => box.x0 < b.x1 + 6 && box.x1 > b.x0 - 6 && box.y0 < b.y1 && box.y1 > b.y0);
      if (clash) continue;
      g.fillStyle = C.critical;
      g.fillText(text, x0, box.y0 + 1);
      taken.push(box);
    }

    // Playback cursor.
    if (this.cursorT >= this.t0 && this.cursorT <= this.t1) {
      const x = Math.round(X(this.cursorT)) + 0.5;
      g.strokeStyle = C.cursor;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, PAD.t);
      g.lineTo(x, H - PAD.b);
      g.stroke();
      this.dot(g, x, Y(this.valueAt(this.cursorT)));
    }

    // Hover crosshair + tooltip.
    if (this.hoverX !== null && this.hoverX >= PAD.l && this.hoverX <= W - PAD.r) {
      const t = this.xToT(this.hoverX);
      const v = this.valueAt(t);
      const x = Math.round(X(t)) + 0.5;
      g.strokeStyle = C.axis;
      g.beginPath();
      g.moveTo(x, PAD.t);
      g.lineTo(x, H - PAD.b);
      g.stroke();
      this.dot(g, x, Y(v));
      const ev = this.events.find((e) => Math.abs(e.t - t) < (this.t1 - this.t0) * 0.012);
      this.tip.innerHTML =
        `<div class="tip-t">${t.toFixed(2)} s${ev ? ` · ${ev.label}` : ''}</div>` +
        `<div class="tip-v"><span class="key" style="background:${C.series}"></span>${fmt.format(v)} ${this.spec.unit}</div>`;
      this.tip.style.display = 'block';
      const tw = this.tip.offsetWidth;
      this.tip.style.left = `${Math.min(Math.max(x + 10, 0), W - tw - 4)}px`;
      this.tip.style.top = `${PAD.t}px`;
    } else {
      this.tip.style.display = 'none';
    }
  }

  private dot(g: CanvasRenderingContext2D, x: number, y: number) {
    if (!Number.isFinite(y)) return;
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fillStyle = C.surface;
    g.fill();
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fillStyle = C.series;
    g.fill();
  }
}
