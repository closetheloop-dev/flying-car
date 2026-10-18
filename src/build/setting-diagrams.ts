/**
 * Small labeled drawings for the Guide (/guide/, rendered at build time): the
 * Roadster and what a setting changes, with that part highlighted. One function per kind
 * of drawing (setting-docs.ts picks the kind and the highlighted part, `mark`).
 */
import type { Diagram } from '../physics/setting-docs';

const W = 320;
const H = 150;
const ON = '#3fd0ff'; // the highlighted part (the site's accent)
const OFF = '#6f7a8e'; // everything else
const INK = '#a9b4c7';
const CAR = '#f2f6ff';

/** A drawing's content, and what it shows (for its label). */
interface Drawing {
  body: string;
  label: string;
}
const svg = (body: string, label: string): Drawing => ({ body, label });

/** Arrowheads, one per color, defined once on the page (diagrams refer to them by id). */
export const DIAGRAM_DEFS =
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>` +
  [
    ['arrow-on', ON],
    ['arrow-off', OFF],
  ]
    .map(
      ([id, color]) =>
        `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`,
    )
    .join('') +
  `</defs></svg>`;
const head = (color: string) => `url(#${color === ON ? 'arrow-on' : 'arrow-off'})`;
const text = (x: number, y: number, s: string, color = INK, anchor = 'middle', size = 11) =>
  `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}">${s}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, color = OFF, w = 1.5, extra = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" ${extra}/>`;
const arrow = (x1: number, y1: number, x2: number, y2: number, color = ON, w = 1.8, both = false) =>
  line(x1, y1, x2, y2, color, w, `marker-end="${head(color)}"${both ? ` marker-start="${head(color)}"` : ''}`);
const pick = (on: boolean) => (on ? ON : OFF);

/** The Roadster from the side (the logo's outline), `w` wide, wheels on y = `ground`. */
function carSide(x: number, ground: number, w: number, opts: { flip?: boolean; angle?: number; fill?: string } = {}) {
  const s = w / 56; // the outline spans x 4..60 in the logo's 64×40 box
  const t = `translate(${x} ${ground - 28 * s}) ${opts.angle ? `rotate(${opts.angle} ${28 * s} ${14 * s})` : ''} scale(${opts.flip ? -s : s} ${s}) translate(${opts.flip ? -60 : -4} 0)`;
  return (
    `<g transform="${t}">` +
    `<path d="M4 24 C6 18 14 15 22 14 C27 9 36 8 43 12 C51 13 58 16 60 21 L60 25 C60 27 58 28 56 28 L8 28 C5 28 3.5 26.5 4 24 Z" fill="${opts.fill ?? CAR}" opacity="0.92"/>` +
    `<path d="M24 14.5 C28 10.5 35 10 40 12.6 L41 15.5 L25.5 15.8 Z" fill="#07090d"/>` +
    `<circle cx="16" cy="28" r="4" fill="#07090d" stroke="${OFF}" stroke-width="0.8"/><circle cx="48" cy="28" r="4" fill="#07090d" stroke="${OFF}" stroke-width="0.8"/>` +
    `</g>`
  );
}

/** The hop: liftoff, the arc over the parked cars, touchdown. */
function path(mark: string) {
  const g = 112;
  const [x0, x1, xa, ya] = [36, 288, 176, 26];
  const cars = [92, 124, 160, 196, 228]
    .map(
      (x, i) =>
        `<rect x="${x - 12}" y="${i === 2 ? g - 34 : g - 14}" width="24" height="${i === 2 ? 34 : 14}" rx="3" fill="#1a2231" stroke="${OFF}"/>`,
    )
    .join('');
  let s =
    line(10, g, W - 10, g, OFF, 1.2) +
    cars +
    text(160, g + 14, 'Semi', OFF, 'middle', 10) +
    `<path d="M${x0} ${g - 6} Q ${xa} ${2 * ya - g} ${x1} ${g - 6}" fill="none" stroke="${pick(mark !== 'apexX')}" stroke-width="2" stroke-dasharray="${mark === 'apex' || mark === 'range' ? '0' : '5 4'}"/>` +
    carSide(xa - 16, ya + 8, 32);
  // (Between two parked cars.)
  if (mark === 'apex')
    s += arrow(212, g, 212, ya + 2, ON, 1.8, true) + text(218, (g + ya) / 2, 'hop height', ON, 'start');
  if (mark === 'range') s += arrow(x0, g + 22, x1, g + 22, ON, 1.8, true) + text((x0 + x1) / 2, g + 34, 'range', ON);
  if (mark === 'apexX')
    s +=
      line(160, g - 34, 160, ya, OFF, 1, 'stroke-dasharray="3 3"') +
      arrow(160, ya - 6, xa, ya - 6, ON, 1.8) +
      text((160 + xa) / 2 + 4, ya - 12, 'apex past the Semi', ON);
  s += text(14, g + 14, 'liftoff', INK, 'start') + text(W - 14, g + 14, 'touchdown', INK, 'end');
  return svg(s, 'The hop over the parked cars');
}

/** Liftoff to touchdown: the burns and the roll, on the video's clock. */
function timeline(mark: string) {
  const [l, r, y] = [24, 296, 70];
  const T = 3;
  const x = (t: number) => l + ((r - l) * t) / T;
  // Short phases are labeled just above their bar (row 0 is empty there), the rest inside it.
  const seg = (a: number, b: number, row: number, name: string, key: string) => {
    const inside = x(b) - x(a) > 6 * name.length;
    return (
      `<rect x="${x(a)}" y="${y + row * 22 - 8}" width="${x(b) - x(a)}" height="14" rx="3" fill="${mark === key ? ON : '#1a2231'}" stroke="${mark === key ? ON : OFF}"/>` +
      (inside
        ? text((x(a) + x(b)) / 2, y + row * 22 + 3, name, mark === key ? '#04141c' : INK, 'middle', 10)
        : text((x(a) + x(b)) / 2, y + row * 22 - 11, name, mark === key ? ON : INK, 'middle', 10))
    );
  };
  let s =
    line(l, y + 50, r, y + 50, OFF) +
    [0, 1, 2, 3]
      .map((t) => line(x(t), y + 46, x(t), y + 54, OFF) + text(x(t), y + 66, `${t} s`, OFF, 'middle', 10))
      .join('') +
    seg(0, 0.32, 0, 'launch', 'launch') +
    seg(2.65, 3, 0, 'land', 'landing') +
    seg(0.52, 0.77, 1, 'spin up', 'ramp') +
    seg(0.77, 2.2, 1, 'roll', 'roll') +
    seg(2.2, 2.46, 1, 'stop', 'stop') +
    seg(2.46, 2.6, 1, '', 'settle');
  if (mark === 'settle') s += text(x(2.53), y + 40, 'back to level', ON, 'middle', 10);
  if (mark === 'rollStart')
    s += arrow(x(0), y + 34, x(0.52), y + 34, ON) + text(x(0.26), y + 44, 'roll start', ON, 'middle', 10);
  if (mark === 'air')
    s += arrow(x(0), y - 24, x(3), y - 24, ON, 1.8, true) + text(x(1.5), y - 30, 'air time (liftoff → touchdown)', ON);
  if (mark === 'slowmo') s += text(x(1.5), y - 26, 'on screen ÷ slow-mo factor = real time', ON);
  if (mark === 'landing') s += text(x(2.82), y - 14, 'brakes to the touchdown speed', ON, 'end', 10);
  return svg(s, 'The flight on the video clock');
}

/** The car end-on (looking along the line), rolling. */
function roll(mark: string) {
  const [cx, cy] = [160, 70];
  const body = (angle: number, color: string, x = cx) =>
    `<g transform="rotate(${angle} ${x} ${cy})"><rect x="${x - 34}" y="${cy - 10}" width="68" height="22" rx="8" fill="${color}" opacity="0.9"/>` +
    `<rect x="${x - 20}" y="${cy - 18}" width="40" height="10" rx="4" fill="#07090d" stroke="${OFF}"/></g>`;
  let s = '';
  if (mark === 'turns') {
    s +=
      body(0, CAR) +
      `<path d="M ${cx + 52} ${cy} A 52 52 0 1 1 ${cx + 44} ${cy - 28}" fill="none" stroke="${ON}" stroke-width="2" marker-end="${head(ON)}"/>` +
      text(cx, cy + 74, 'one full turn toward the parked cars (−1)', ON);
  } else if (mark === 'overshoot') {
    s +=
      line(cx - 70, cy + 1, cx + 70, cy + 1, OFF, 1, 'stroke-dasharray="4 3"') +
      body(-14, CAR) +
      `<path d="M ${cx + 60} ${cy + 1} A 60 60 0 0 0 ${cx + 58} ${cy - 13}" fill="none" stroke="${ON}" stroke-width="2"/>` +
      text(cx + 66, cy - 10, 'overshoot', ON, 'start') +
      text(cx, cy + 50, 'stops a few degrees past level, then rights itself', INK);
  } else if (mark === 'inverted') {
    s +=
      body(180, CAR) +
      [cx - 24, cx + 24].map((x) => arrow(x, cy - 20, x, cy - 46, ON)).join('') +
      arrow(cx, cy + 18, cx, cy + 52, ON) +
      text(cx + 12, cy + 52, 'pushed down', ON, 'start') +
      text(cx, cy - 54, 'jets point up when upside down', INK);
  } else {
    // inertia: mass spread out = harder to spin
    s +=
      body(-20, CAR) +
      [-30, 30].map((d) => `<circle cx="${cx + d}" cy="${cy + d * -0.36}" r="6" fill="${ON}"/>`).join('') +
      `<path d="M ${cx - 58} ${cy + 30} A 64 64 0 0 0 ${cx + 58} ${cy + 30}" fill="none" stroke="${ON}" stroke-width="2" marker-end="${head(ON)}"/>` +
      text(cx, 22, 'weight far from the middle → harder to spin', ON);
  }
  return svg(s, 'The car seen end-on, rolling');
}

/** The car from the side: center of mass, suspension, thrusters. */
function side(mark: string) {
  // The nose is on the left (as in the logo). Wheel centers on y = g, the road under the tires.
  const g = 104;
  const [x, w] = [70, 160];
  const road = g + w / 14;
  const flying = mark === 'lift' || mark === 'liftRating';
  let s = (flying ? '' : line(20, road, W - 20, road, OFF, 1.2)) + carSide(x, g, w);
  const cgx = x + w * 0.48;
  const cgy = g - 22;
  if (mark === 'cg' || mark === 'mass') {
    s += `<circle cx="${cgx}" cy="${cgy}" r="5" fill="${ON}" stroke="#07090d"/>`;
    if (mark === 'cg') {
      const ax = x + w + 14;
      s +=
        line(cgx + 6, cgy, ax + 4, cgy, ON, 1, 'stroke-dasharray="3 3"') +
        arrow(ax, road, ax, cgy, ON, 1.8, true) +
        text(ax + 8, (road + cgy) / 2 + 4, 'CG height', ON, 'start');
    } else s += arrow(cgx, cgy + 6, cgx, cgy + 48, ON) + text(cgx + 8, cgy + 44, 'weight', ON, 'start');
  }
  if (mark === 'suspension') {
    const wx = x + w * 0.214;
    s +=
      `<path d="M ${wx} ${g - 26} l 6 4 l -12 4 l 12 4 l -12 4 l 6 4" fill="none" stroke="${ON}" stroke-width="2"/>` +
      line(wx, g - 27, wx, g - 66, ON, 1) +
      text(wx - 4, g - 70, 'suspension travel', ON, 'start');
  }
  if (flying) {
    // Just inboard of the wheels; the far-side pair sits behind the near one.
    for (const fx of [0.3, 0.34, 0.66, 0.7]) s += arrow(x + w * fx, g - 4, x + w * fx, g + 18, ON, 1.6);
    s +=
      arrow(x + w * 0.5, g - 50, x + w * 0.5, g - 78, ON, 2.2) +
      text(x + w * 0.5 + 8, g - 70, mark === 'lift' ? 'lift' : 'up to its rating, each', ON, 'start');
    s += text(x + w * 0.5, g + 34, 'four lift jets fire out of the underside', INK);
  }
  if (mark === 'rcs') {
    // Pointing out of the page: a circled dot.
    const [fx, fy] = [x + w * 0.1, g - 12];
    s +=
      `<circle cx="${fx}" cy="${fy}" r="6" fill="#07090d" stroke="${ON}" stroke-width="1.8"/><circle cx="${fx}" cy="${fy}" r="2" fill="${ON}"/>` +
      line(fx, fy - 7, fx, g - 66, ON, 1) +
      text(fx - 4, g - 70, 'side thruster: pushes sideways', ON, 'start');
  }
  return svg(s, 'The car from the side');
}

/** The car from above: drag, the landing slide. */
function top(mark: string) {
  const [cx, cy] = [150, 72];
  const car = (angle: number, x = cx) =>
    `<g transform="rotate(${angle} ${x} ${cy})"><rect x="${x - 50}" y="${cy - 20}" width="100" height="40" rx="16" fill="${CAR}" opacity="0.9"/>` +
    `<rect x="${x - 14}" y="${cy - 15}" width="34" height="30" rx="8" fill="#07090d"/></g>`;
  let s = '';
  if (mark === 'cda') {
    s += `<g opacity="0.45">${car(0)}</g><rect x="${cx - 50}" y="${cy - 20}" width="100" height="40" rx="16" fill="none" stroke="${ON}" stroke-width="2" stroke-dasharray="5 3"/>`;
    s +=
      text(cx, cy + 44, 'drag area seen from above', ON) +
      text(cx, cy + 60, 'the air resists the climb and the fall', INK, 'middle', 10);
  } else if (mark === 'yaw') {
    s += `<g opacity="0.35">${car(0, 100)}</g>` + car(-60, 210);
    s +=
      `<path d="M 150 30 A 70 70 0 0 1 228 44" fill="none" stroke="${ON}" stroke-width="2" marker-end="${head(ON)}"/>` +
      text(190, 22, 'slide yaw', ON);
  } else {
    s +=
      car(0, 110) +
      arrow(170, cy, 290, cy, ON, 2) +
      text(230, cy - 10, 'slows at the braking rate', ON) +
      text(230, cy + 22, 'slide after touchdown', INK);
  }
  return svg(s, 'The car from above');
}

/** The nitrogen: tank, nozzle, what's usable. */
function gas(mark: string) {
  const [tx, ty, tw, th] = [60, 24, 70, 100];
  let s = `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="26" fill="#1a2231" stroke="${pick(mark === 'tank')}" stroke-width="${mark === 'tank' ? 2.5 : 1.5}"/>`;
  const usableTop = ty + th * 0.18;
  s += `<rect x="${tx + 4}" y="${usableTop}" width="${tw - 8}" height="${th * 0.67}" rx="20" fill="${mark === 'usable' ? ON : '#2a3852'}" opacity="0.8"/>`;
  s +=
    line(tx + tw, ty + th / 2, 190, ty + th / 2, OFF, 3) +
    `<path d="M 190 ${ty + th / 2 - 8} L 206 ${ty + th / 2 - 14} L 206 ${ty + th / 2 + 14} L 190 ${ty + th / 2 + 8} Z" fill="${OFF}"/>`;
  s += arrow(212, ty + th / 2, 290, ty + th / 2, pick(mark === 'isp'), 2.4);
  if (mark === 'isp') s += text(250, ty + th / 2 - 12, 'push per kg of gas', ON);
  if (mark === 'tank') s += text(tx + tw / 2, ty + th + 18, 'storage pressure', ON);
  if (mark === 'usable')
    s +=
      text(tx + tw + 8, ty + th * 0.88, 'usable part', ON, 'start') +
      text(tx + tw + 8, ty + th * 0.98, '(the rest stays in)', INK, 'start', 10);
  return svg(s, 'The nitrogen tank and a thruster');
}

/** The closed loop: plan → controller → thrusters → car, and back. */
function controller(mark: string) {
  const boxes: [string, number, string[]][] = [
    ['plan', 18, []],
    ['controller', 92, ['rate', 'pos', 'att', 'cg', 'inertia']],
    ['thrusters', 176, ['scatter', 'noise', 'valve', 'minOpen']],
    ['car', 252, ['gust', 'seed']],
  ];
  const y = 52;
  let s = '';
  for (const [name, x, marks] of boxes) {
    const on = marks.includes(mark);
    s +=
      `<rect x="${x}" y="${y}" width="58" height="30" rx="6" fill="${on ? ON : '#1a2231'}" stroke="${on ? ON : OFF}"/>` +
      text(x + 29, y + 19, name, on ? '#04141c' : INK);
  }
  s += arrow(76, y + 15, 90, y + 15, OFF) + arrow(150, y + 15, 174, y + 15, OFF) + arrow(234, y + 15, 250, y + 15, OFF);
  s +=
    `<path d="M 281 ${y + 32} V ${y + 56} H 121 V ${y + 34}" fill="none" stroke="${OFF}" stroke-width="1.5" marker-end="${head(OFF)}"/>` +
    text(200, y + 70, 'measured position and roll', OFF, 'middle', 10);
  const label: Record<string, string> = {
    gust: 'gusts push the car',
    seed: 'which random gusts and errors',
    scatter: 'each thruster a little off',
    noise: 'thrust flickers',
    valve: 'valves respond late',
    minOpen: 'small thrust is pulsed',
    cg: 'its idea of the center of mass',
    inertia: 'its idea of how hard to spin',
    rate: 'updates per second',
    pos: 'how hard it pulls back to the path',
    att: 'how hard it holds the roll',
  };
  if (label[mark]) s += text(160, 30, label[mark], ON);
  return svg(s, 'The closed-loop flight controller');
}

const DRAW: Record<Diagram, (mark: string) => Drawing> = { path, timeline, roll, side, top, gas, controller };

/** The parts each kind of drawing can highlight (a mark it doesn't know would draw a default). */
export const MARKS: Record<Diagram, string[]> = {
  path: ['apex', 'range', 'apexX'],
  timeline: ['launch', 'landing', 'ramp', 'roll', 'stop', 'settle', 'rollStart', 'air', 'slowmo'],
  roll: ['turns', 'overshoot', 'inverted', 'inertia'],
  side: ['cg', 'mass', 'suspension', 'lift', 'liftRating', 'rcs'],
  top: ['cda', 'yaw', 'brake'],
  gas: ['tank', 'usable', 'isp'],
  controller: ['gust', 'seed', 'scatter', 'noise', 'valve', 'minOpen', 'cg', 'inertia', 'rate', 'pos', 'att'],
};

/**
 * The drawing for a setting: its kind, with `mark` highlighted, labeled for screen readers
 * with the setting's name (`name`, plain text) and what the drawing shows.
 */
export function diagram(kind: Diagram, mark: string, name: string): string {
  if (!MARKS[kind].includes(mark)) throw new Error(`a ${kind} drawing has no part "${mark}"`);
  const { body, label } = DRAW[kind](mark);
  const aria = `${name}: ${label.charAt(0).toLowerCase()}${label.slice(1)}`.replace(
    /[&<>"]/g,
    (c) => `&#${c.charCodeAt(0)};`,
  );
  return `<svg class="diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
