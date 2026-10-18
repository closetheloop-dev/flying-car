import * as THREE from 'three';

/**
 * Lofted vehicle bodies. A body is a stack of cross-sections along x (forward),
 * each described by a handful of heights and half-widths that vary smoothly
 * along the car: underside, crease, beltline and center-line top. Wheel arches
 * are notched out of the lower sides. Faces are sorted into material groups
 * (paint / glass / trim / underside / light) by a per-vehicle classifier.
 */

export type Knots = readonly (readonly [number, number])[];

/** Monotone cubic (Fritsch–Carlson) through (x, value) knots — smooth, no overshoot. */
export function smoothCurve(knots: Knots): (x: number) => number {
  const k = [...knots].sort((a, b) => a[0] - b[0]);
  const n = k.length;
  if (n === 1) return () => k[0][1];
  const xs = k.map((p) => p[0]);
  const ys = k.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = Array.from({ length: n }, () => 0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

/** Piecewise-linear through knots — for faceted bodies with straight edges. */
export function linearCurve(knots: Knots): (x: number) => number {
  const k = [...knots].sort((a, b) => a[0] - b[0]);
  return (x: number) => {
    if (x <= k[0][0]) return k[0][1];
    for (let i = 0; i < k.length - 1; i++) {
      if (x <= k[i + 1][0]) {
        const t = (x - k[i][0]) / (k[i + 1][0] - k[i][0]);
        return k[i][1] + (k[i + 1][1] - k[i][1]) * t;
      }
    }
    return k[k.length - 1][1];
  };
}

export type Surface = 'paint' | 'glass' | 'trim' | 'under' | 'light';
export const SURFACES: Surface[] = ['paint', 'glass', 'trim', 'under', 'light'];

export interface Arch {
  /** Wheel center along x and above the ground. */
  x: number;
  y: number;
  /** Arch opening radius. */
  r: number;
  /** Half-width of the body inside the arch (the wheel-well wall). */
  inner: number;
}

export interface FaceInfo {
  c: THREE.Vector3;
  n: THREE.Vector3;
  /** The section values at the face's x, for classifiers that need them. */
  at: Section;
}

export interface Section {
  yb: number;
  yTop: number;
  yBelt: number;
  yCrease: number;
  wBottom: number;
  wCrease: number;
  wBelt: number;
  topExp: number;
}

export interface BodySpec {
  /** Rear and front extents along x. */
  x0: number;
  x1: number;
  stations?: number;
  /** Height of the underside. */
  yb: Knots;
  /** Center-line top (hood, windscreen, roof, deck). */
  yTop: Knots;
  /** Where the side meets the top surface. */
  yBelt: Knots;
  /** Height of the widest point of the side. */
  yCrease: Knots;
  wBottom: Knots;
  wCrease: Knots;
  wBelt: Knots;
  /** Exponent of the top surface: lower = more domed greenhouse. Default 2.5. */
  topExp?: Knots;
  cornerR?: number;
  arches?: Arch[];
  classify?: (f: FaceInfo) => Surface;
  /** Flat-shaded facets with straight-line interpolation between knots (Cybertruck). */
  faceted?: boolean;
  /** Side rows from corner to crease and crease to belt. Default [9, 6]. */
  sideRows?: [number, number];
}

const B = 4; // bottom samples
const C = 3; // bottom corner
const W = 4; // wheel-well wall (collapses to a point outside the arches)
/** Default side rows (corner → crease, crease → belt); tall bodies need more. */
const SIDE_ROWS: [number, number] = [9, 6];
const T = 22; // top surface

/** Index range [first, last) of half-section segments that form the wheel well and its lip. */
export const WELL_SEGMENTS: [number, number] = [B + C - 1, B + C + W];

export function defaultClassify(f: FaceInfo, trimHeight = 0.12): Surface {
  if (f.n.y < -0.6) return 'under';
  if (f.c.y < f.at.yb + trimHeight) return 'trim';
  return 'paint';
}

export function makeSection(spec: BodySpec) {
  const curve = spec.faceted ? linearCurve : smoothCurve;
  const fns = {
    yb: curve(spec.yb),
    yTop: curve(spec.yTop),
    yBelt: curve(spec.yBelt),
    yCrease: curve(spec.yCrease),
    wBottom: curve(spec.wBottom),
    wCrease: curve(spec.wCrease),
    wBelt: curve(spec.wBelt),
    topExp: curve(spec.topExp ?? [[0, 2.5]]),
  };
  return (x: number): Section => ({
    yb: fns.yb(x),
    yTop: fns.yTop(x),
    yBelt: fns.yBelt(x),
    yCrease: fns.yCrease(x),
    wBottom: fns.wBottom(x),
    wCrease: fns.wCrease(x),
    wBelt: fns.wBelt(x),
    topExp: fns.topExp(x),
  });
}

/**
 * Right-hand half of a cross-section, bottom center → top center, as (w, y) pairs.
 * Always the same number of points, so neighboring sections connect one-to-one.
 *
 * Inside a wheel arch (archTop > bottom) the outer skin starts exactly at the arch
 * height: below it the section runs up the wheel-well wall at `archInner`, then
 * steps out along a horizontal lip. Side rows sit at fixed heights, so creases
 * and trim lines stay straight across the arch.
 */
function halfSection(
  s: Section,
  cornerR: number,
  archTop: number,
  archInner: number,
  [S1, S2]: [number, number],
): [number, number][] {
  const inArch = archTop > -Infinity;
  const wB = inArch ? Math.min(s.wBottom, archInner) : s.wBottom;
  const r = Math.min(cornerR, wB * 0.5, Math.max(s.yCrease - s.yb, 0.01) * 0.5);
  const y0 = s.yb + r;
  const yc = Math.max(s.yCrease, y0 + 0.005);
  const yBelt = Math.max(s.yBelt, yc + 0.005);
  // Outer skin width at height y, from the corner up to the belt.
  const sideW = (y: number): number => {
    if (y <= yc) {
      const t = (y - y0) / (yc - y0);
      return s.wBottom + (s.wCrease - s.wBottom) * Math.sin((Math.max(t, 0) * Math.PI) / 2);
    }
    const t = (y - yc) / (yBelt - yc);
    return s.wCrease + (s.wBelt - s.wCrease) * t * t;
  };
  const yCut = inArch ? Math.min(Math.max(archTop, y0), yBelt - 0.01) : y0;

  const pts: [number, number][] = [];
  for (let i = 0; i < B; i++) pts.push([((wB - r) * i) / (B - 1), s.yb]);
  for (let j = 1; j <= C; j++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (j / C);
    pts.push([wB - r + r * Math.cos(a), y0 + r * Math.sin(a)]);
  }
  for (let k = 1; k <= W; k++) pts.push([wB, y0 + ((yCut - y0) * k) / W]);
  const rows: number[] = [];
  for (let k = 0; k < S1; k++) rows.push(y0 + ((yc - y0) * k) / S1);
  for (let k = 0; k <= S2; k++) rows.push(yc + ((yBelt - yc) * k) / S2);
  for (const y of rows) {
    const yy = Math.max(y, yCut);
    pts.push([sideW(yy), yy]);
  }
  for (let k = 1; k <= T; k++) {
    const sw = Math.cos(((k / T) * Math.PI) / 2); // dense near the shoulder
    pts.push([s.wBelt * sw, s.yTop + (yBelt - s.yTop) * Math.pow(sw, s.topExp)]);
  }
  return pts;
}

export function loftBody(spec: BodySpec): THREE.BufferGeometry {
  const N = spec.stations ?? 120;
  const section = makeSection(spec);
  const classify = spec.classify ?? ((f: FaceInfo) => defaultClassify(f));
  const cornerR = spec.cornerR ?? 0.08;
  const arches = spec.arches ?? [];

  const rings: THREE.Vector3[][] = [];
  const xs: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = spec.x0 + ((spec.x1 - spec.x0) * i) / (N - 1);
    xs.push(x);
    let archTop = -Infinity,
      inner = Infinity;
    for (const a of arches) {
      const dx = x - a.x;
      if (Math.abs(dx) < a.r) {
        archTop = Math.max(archTop, a.y + Math.sqrt(a.r * a.r - dx * dx));
        inner = Math.min(inner, a.inner);
      }
    }
    const half = halfSection(section(x), cornerR, archTop, inner, spec.sideRows ?? SIDE_ROWS);
    const ring: THREE.Vector3[] = half.map(([w, y]) => new THREE.Vector3(x, y, w));
    for (let j = half.length - 2; j >= 1; j--) ring.push(new THREE.Vector3(x, half[j][1], -half[j][0]));
    rings.push(ring);
  }

  const R = rings[0].length;
  const halfLen = R / 2 + 1; // points in a half-section
  const positions: number[] = [];
  rings.forEach((ring) => ring.forEach((v) => positions.push(v.x, v.y, v.z)));
  const groups = new Map<Surface, number[]>(SURFACES.map((s) => [s, []]));
  const vid = (i: number, j: number) => i * R + (j % R);
  const tmpA = new THREE.Vector3(),
    tmpB = new THREE.Vector3();

  const faceInfo = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d?: THREE.Vector3): FaceInfo => {
    const cen = a.clone().add(b).add(c);
    if (d) cen.add(d).multiplyScalar(0.25);
    else cen.multiplyScalar(1 / 3);
    const n = tmpA.subVectors(b, a).cross(tmpB.subVectors(c, a)).normalize().clone();
    return { c: cen, n, at: section(cen.x) };
  };

  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = rings[i][j],
        b = rings[i + 1][j],
        c = rings[i + 1][(j + 1) % R],
        d = rings[i][(j + 1) % R];
      if (a.distanceToSquared(d) < 1e-12 && b.distanceToSquared(c) < 1e-12) continue;
      // Half-section segment index (the left side mirrors the right).
      const h = j < halfLen - 1 ? j : R - j - 1;
      const well = h >= WELL_SEGMENTS[0] && h < WELL_SEGMENTS[1];
      const g = groups.get(well ? 'trim' : classify(faceInfo(a, b, c, d)))!;
      g.push(vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j), vid(i + 1, j + 1), vid(i, j + 1));
    }
  }

  // End caps get their own vertices so their normals stay flat.
  const cap = (ring: THREE.Vector3[], front: boolean) => {
    const base = positions.length / 3;
    const cen = ring.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / ring.length);
    positions.push(cen.x, cen.y, cen.z);
    ring.forEach((v) => positions.push(v.x, v.y, v.z));
    for (let j = 0; j < R; j++) {
      const p = base + 1 + j,
        q = base + 1 + ((j + 1) % R);
      // Ring runs bottom → +z side → top → −z side, which is clockwise seen from +x.
      const tri = front ? [base, q, p] : [base, p, q];
      const info = faceInfo(cen, ring[j], ring[(j + 1) % R]);
      info.n.set(front ? 1 : -1, 0, 0);
      groups.get(classify(info))!.push(...tri);
    }
  };
  cap(rings[N - 1], true);
  cap(rings[0], false);

  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const index: number[] = [];
  SURFACES.forEach((s, gi) => {
    const idx = groups.get(s)!;
    geo.addGroup(index.length, idx.length, gi);
    index.push(...idx);
  });
  geo.setIndex(index);
  if (spec.faceted) geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  return geo;
}
