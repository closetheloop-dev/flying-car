import * as THREE from 'three';
import type { VehicleKind } from '../physics/layout';
import { defaultClassify, makeSection, type BodySpec, type FaceInfo, type Surface } from './loft';
import { MAT, bodyMesh, paint, paintWithGlass, strip, wheel } from './parts';

/**
 * The parked line-up, lofted like the stunt car. Each builder works in a frame
 * facing +x with the ground (stage top) at y = 0; buildParked turns it so the
 * nose points toward −Z as in the footage.
 */
export function buildParked(kind: VehicleKind, length: number, width: number, height: number): THREE.Group {
  const g = new THREE.Group();
  ({ semi, cybertruck, cybercab, modelY: sedan, model3: sedan })[kind](g, length, width, height, kind);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.rotation.y = Math.PI / 2;
  const outer = new THREE.Group();
  outer.add(g);
  return outer;
}

/**
 * Swap a parked vehicle's procedural model for its GLB model (from glb.ts, normalized:
 * nose +x, ground at y = 0, at the vehicle's length); it turns with the rest to face −Z.
 */
export function dressParked(outer: THREE.Group, model: THREE.Group) {
  const inner = outer.children[0];
  for (const o of inner.children) o.visible = false;
  inner.add(model);
}

function addWheels(g: THREE.Group, xs: number[], r: number, w: number, track: number, dual = false) {
  for (const x of xs)
    for (const side of [-1, 1]) {
      const holder = new THREE.Group();
      holder.position.set(x, r, side * track);
      if (side < 0) holder.rotation.y = Math.PI;
      holder.add(wheel(r, w, { dual }));
      g.add(holder);
    }
}

/**
 * A car's greenhouse as flat panels: its side outline (windscreen base, up the windscreen,
 * along the roof, down the rear window; (x, y) points in order) extruded across the car,
 * narrowing from half-width wBase at the lowest point to wRoof at the highest (tumblehome).
 * Sits on the body's deck; dark glass, as on these cars' glass roofs and canopies.
 */
function cabin(outline: [number, number][], wBase: number, wRoof: number): THREE.Mesh {
  const ys = outline.map(([, y]) => y);
  const y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  const half = (y: number) => wBase + ((wRoof - wBase) * (y - y0)) / (y1 - y0);
  const right = outline.map(([x, y]) => new THREE.Vector3(x, y, half(y)));
  const left = outline.map(([x, y]) => new THREE.Vector3(x, y, -half(y)));
  const tris: THREE.Vector3[] = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push(right[i], right[j], left[j], right[i], left[j], left[i]); // panel between outline points
  }
  for (let i = 1; i < n - 1; i++) tris.push(right[0], right[i + 1], right[i], left[0], left[i], left[i + 1]); // sides
  const geo = new THREE.BufferGeometry().setFromPoints(tris);
  geo.computeVertexNormals(); // non-indexed: flat panels
  const glass = MAT.glass.clone();
  glass.side = THREE.DoubleSide;
  glass.userData.owned = true;
  const mesh = new THREE.Mesh(geo, glass);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ── Tesla Semi ────────────────────────────────────────────────────────────
// Day cab with a tall, steeply raked aero nose and wrap-around windscreen;
// behind it the bare chassis with side fairings, fifth wheel and tandem drive axles.
function semi(g: THREE.Group, length: number, width: number, height: number) {
  const L = length / 2;
  const hw = width / 2;
  const cabBack = L - 3.1;
  const spec: BodySpec = {
    x0: cabBack,
    x1: L,
    stations: 130,
    cornerR: 0.14,
    sideRows: [12, 34],
    yb: [
      [cabBack, 0.6],
      [L - 1.2, 0.5],
      [L, 0.42],
    ],
    // Near-vertical lower nose, then a long raked windscreen sweeping into the roof.
    yTop: [
      [cabBack, height - 0.12],
      [cabBack + 0.3, height],
      [L - 2.1, height],
      [L - 1.7, height - 0.18],
      [L - 1.25, 3.45],
      [L - 0.8, 2.85],
      [L - 0.35, 2.15],
      [L - 0.08, 1.6],
      [L, 1.25],
    ],
    yBelt: [
      [cabBack, height - 0.45],
      [L - 2.1, height - 0.42],
      [L - 1.7, height - 0.6],
      [L - 1.25, 3.1],
      [L - 0.8, 2.55],
      [L - 0.35, 1.9],
      [L, 1.1],
    ],
    yCrease: [
      [cabBack, 1.4],
      [L, 0.95],
    ],
    wBottom: [
      [cabBack, hw - 0.06],
      [L, hw - 0.12],
    ],
    wCrease: [
      [cabBack, hw],
      [L - 0.7, hw],
      [L, hw - 0.14],
    ],
    // The cab tapers a little toward a flat roof with rounded edges (head-on frame at 0:12).
    wBelt: [
      [cabBack, hw - 0.18],
      [L - 0.7, hw - 0.2],
      [L, hw - 0.3],
    ],
    topExp: [[0, 8]],
    arches: [{ x: L - 0.95, y: 0.52, r: 0.6, inner: hw - 0.48 }],
    classify: (f: FaceInfo): Surface => {
      const { c, n } = f;
      if (c.y < 0.82 && n.y < 0.6) return 'trim';
      return defaultClassify(f, 0);
    },
  };
  const white = paint(0xeef0f2, { metalness: 0.15, roughness: 0.38 });
  const glass = /* glsl */ `
    // Wrap-around windscreen across the raked front, and the door windows behind it.
    float ws = min(min(p.y - 1.95, 3.55 - p.y), min(p.x - ${(L - 1.75).toFixed(3)}, ${(hw - 0.1).toFixed(3)} - abs(p.z)));
    float side = min(min(abs(n.z) - 0.6, p.y - 2.3), min(3.5 - p.y, min(p.x - ${(L - 2.35).toFixed(3)}, ${(L - 1.6).toFixed(3)} - p.x)));
    return max(ws, side);`;
  g.add(bodyMesh(spec, paintWithGlass(white.clone(), glass)));

  // Light bar across the near-vertical lower nose (whose face spans y 0.42–1.25), and
  // amber clearance lights just above the windscreen (whose glass ends at y 3.55), on
  // the raked nose where it is ~3.62 m high — as in the head-on frame at 0:12.
  g.add(strip(MAT.head, L + 0.005, 1.0, 0, width * 0.78, 0.035));
  for (const z of [-0.36, -0.12, 0.12, 0.36]) g.add(strip(MAT.marker, L - 1.45, 3.62, z, 0.07, 0.025, 0.05, [1, 0, 0]));
  // Camera "mirrors" on short arms at the A-pillars.
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.32), MAT.dark);
    arm.position.set(L - 1.35, 2.75, side * (hw + 0.12));
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.08), MAT.dark);
    pod.position.set(L - 1.3, 2.65, side * (hw + 0.28));
    g.add(arm, pod);
  }

  // Chassis: frame rails, white side fairings over the battery packs, fifth wheel, drive axles.
  const chassisLen = cabBack + L;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(chassisLen, 0.32, 0.9), MAT.dark);
  frame.position.set(-L + chassisLen / 2, 1.0, 0);
  g.add(frame);
  const fairingSpec: BodySpec = {
    x0: -L + 2.6,
    x1: cabBack + 0.02,
    stations: 30,
    cornerR: 0.1,
    yb: [[0, 0.42]],
    yTop: [[0, 1.22]],
    yBelt: [[0, 1.12]],
    yCrease: [[0, 0.8]],
    wBottom: [[0, hw - 0.1]],
    wCrease: [[0, hw - 0.04]],
    wBelt: [[0, hw - 0.1]],
    topExp: [[0, 6]],
  };
  g.add(bodyMesh(fairingSpec, white));
  const fifth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 28), MAT.dark);
  fifth.position.set(-L + 1.6, 1.22, 0);
  g.add(fifth);
  const fenderMat = MAT.trim.clone();
  fenderMat.side = THREE.DoubleSide;
  for (const x of [-L + 1.0, -L + 2.3]) {
    for (const side of [-1, 1]) {
      // Half-tube over each drive wheel, axis across the truck. The open half spans +z
      // before rotation; turning −90° about x carries it to +y, i.e. above the axle.
      const fender = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.62, 0.62, 24, 1, true, -Math.PI / 2, Math.PI),
        fenderMat,
      );
      fender.rotation.x = -Math.PI / 2;
      fender.position.set(x, 0.55, side * (hw - 0.3));
      g.add(fender);
    }
  }
  addWheels(g, [L - 0.95], 0.52, 0.4, hw - 0.27);
  addWheels(g, [-L + 1.0, -L + 2.3], 0.52, 0.28, hw - 0.18, true);
}

// ── Cybertruck ────────────────────────────────────────────────────────────
// Faceted stainless wedge: flat sides, a single ridge at the B-pillar, light bars front and rear.
function cybertruck(g: THREE.Group, length: number, width: number, height: number) {
  const L = length / 2;
  const hw = width / 2;
  const peak = 0.25;
  const spec: BodySpec = {
    x0: -L,
    x1: L,
    stations: 120,
    cornerR: 0.03,
    faceted: true,
    yb: [
      [L, 0.55],
      [L - 0.5, 0.42],
      [-L + 0.5, 0.42],
      [-L, 0.6],
    ],
    yTop: [
      [L, 1.02],
      [L - 0.85, 1.12],
      [peak, height],
      [-L, 1.3],
    ],
    yBelt: [
      [L, 0.98],
      [L - 0.85, 1.04],
      [peak, height - 0.2],
      [-L, 1.22],
    ],
    yCrease: [
      [L, 0.9],
      [-L, 1.0],
    ],
    wBottom: [[0, hw - 0.12]],
    wCrease: [
      [L, hw - 0.06],
      [L - 0.6, hw],
      [-L, hw],
    ],
    wBelt: [
      [L, hw - 0.14],
      [peak, hw - 0.3],
      [-L, hw - 0.12],
    ],
    topExp: [[0, 8]],
    arches: [L - 1.0, -L + 1.25].map((x) => ({ x, y: 0.43, r: 0.52, inner: hw - 0.36 })),
    classify: (f: FaceInfo): Surface => {
      const { c, n } = f;
      if (c.y < 0.62 && n.y < 0.6) return 'trim';
      return defaultClassify(f, 0);
    },
  };
  const steel = paint(0xb9bdc3, { metalness: 0.95, roughness: 0.28, clearcoat: 0.2 });
  const glass = /* glsl */ `
    float ws = min(min(p.y - 1.12, p.x - ${(peak + 0.05).toFixed(3)}), min(${(L - 0.9).toFixed(3)} - p.x, n.y - 0.2));
    float side = min(min(p.y - 1.15, abs(n.z) - 0.25), min(p.x + 1.0, ${(L - 1.0).toFixed(3)} - p.x));
    return max(ws, side);`;
  g.add(bodyMesh(spec, paintWithGlass(steel, glass)));
  g.add(strip(MAT.head, L + 0.005, 1.0, 0, width * 0.92, 0.03));
  g.add(strip(MAT.tail, -L - 0.005, 1.26, 0, width * 0.92, 0.035));
  addWheels(g, [L - 1.0, -L + 1.25], 0.43, 0.32, hw - 0.18);
}

// ── Cybercab ──────────────────────────────────────────────────────────────
// Two-seat champagne-gold pod: a low body with a glass fastback canopy, full-width light bars.
function cybercab(g: THREE.Group, length: number, width: number, height: number) {
  const L = length / 2;
  const hw = width / 2;
  const spec: BodySpec = {
    x0: -L,
    x1: L,
    stations: 120,
    cornerR: 0.1,
    yb: [
      [L, 0.3],
      [L - 0.45, 0.18],
      [-L + 0.45, 0.18],
      [-L, 0.32],
    ],
    // Hood, then a deck just above the beltline under the canopy, then the short tail.
    yTop: [
      [L, 0.76],
      [L - 0.55, 0.88],
      [L - 1.15, 0.93],
      [0, 0.95],
      [-1.5, 0.97],
      [-L + 0.25, 0.96],
      [-L, 0.92],
    ],
    yBelt: [
      [L, 0.7],
      [1.0, 0.86],
      [0, 0.9],
      [-1.2, 0.93],
      [-L, 0.88],
    ],
    yCrease: [
      [L, 0.55],
      [-L, 0.6],
    ],
    wBottom: [
      [L, hw - 0.2],
      [0, hw - 0.1],
      [-L, hw - 0.17],
    ],
    wCrease: [
      [L, hw - 0.13],
      [1.4, hw - 0.02],
      [0, hw - 0.05],
      [-1.4, hw],
      [-L, hw - 0.1],
    ],
    wBelt: [
      [L, hw - 0.17],
      [0, hw - 0.13],
      [-L, hw - 0.15],
    ],
    topExp: [[0, 2.5]],
    arches: [1.42, -1.42].map((x) => ({ x, y: 0.36, r: 0.41, inner: hw - 0.35 })),
    classify: (f: FaceInfo): Surface => {
      const { c, n, at } = f;
      if (c.y < at.yb + 0.12 && n.y < 0.6) return 'trim';
      return defaultClassify(f, 0);
    },
  };
  g.add(bodyMesh(spec, paint(0xcbb48a, { metalness: 0.8, roughness: 0.3 })));
  // Raked windscreen, a short roof, and a long fastback down to the tail.
  g.add(
    cabin(
      [
        [L - 1.1, 0.91],
        [0.35, height - 0.05],
        [-0.2, height],
        [-0.95, height - 0.1],
        [-L + 0.35, 0.94],
      ],
      hw - 0.14,
      hw - 0.36,
    ),
  );
  const sec = makeSection(spec);
  g.add(strip(MAT.head, L + 0.004, 0.66, 0, sec(L).wCrease * 1.8, 0.025));
  g.add(strip(MAT.tail, -L - 0.004, 0.78, 0, sec(-L).wCrease * 1.8, 0.03));
  addWheels(g, [1.42, -1.42], 0.36, 0.26, hw - 0.2);
}

// ── Model Y / Model 3 ────────────────────────────────────────────────────
// Shared sedan/crossover body up to the beltline, with a flat-paneled glass cabin on it:
// full-width front light bar (2025 refresh), short trunk deck (3) or hatch (Y) tail.
function sedan(g: THREE.Group, length: number, width: number, height: number, kind: VehicleKind) {
  const L = length / 2;
  const hw = width / 2;
  const hatch = kind === 'modelY';
  const lift = hatch ? 0.1 : 0;
  const fa = L - 0.95; // front axle
  const ra = fa - (hatch ? 2.89 : 2.875); // wheelbases: Model Y 2.890 m, Model 3 2.875 m
  const spec: BodySpec = {
    x0: -L,
    x1: L,
    stations: 120,
    cornerR: 0.1,
    yb: [
      [L, 0.3],
      [L - 0.4, 0.17 + lift / 2],
      [-L + 0.5, 0.17 + lift / 2],
      [-L, 0.32],
    ],
    // Hood, then a deck just above the beltline under the cabin, then the trunk lid.
    yTop: [
      [L, 0.64 + lift],
      [L - 0.5, 0.78 + lift],
      [L - 1.3, 0.9 + lift],
      [0, 0.96 + lift],
      [-L + 0.5, 1.02 + lift],
      [-L + 0.1, 1.0 + lift],
      [-L, 0.95 + lift],
    ],
    yBelt: [
      [L, 0.62 + lift],
      [L - 1.3, 0.87 + lift],
      [0, 0.93 + lift],
      [-L + 0.5, 0.99 + lift],
      [-L, 0.93 + lift],
    ],
    yCrease: [
      [L, 0.56 + lift],
      [-L, 0.7 + lift],
    ],
    wBottom: [[0, hw - 0.1]],
    wCrease: [
      [L, hw - 0.14],
      [L - 0.9, hw],
      [-L + 0.9, hw],
      [-L, hw - 0.09],
    ],
    wBelt: [
      [L, hw - 0.17],
      [0, hw - 0.1],
      [-L, hw - 0.14],
    ],
    topExp: [[0, 2.5]],
    arches: [fa, ra].map((x) => ({ x, y: 0.36 + lift / 3, r: 0.42 + lift / 3, inner: hw - 0.32 })),
    classify: (f: FaceInfo): Surface => {
      const { c, n, at } = f;
      if (c.y < at.yb + 0.12 && n.y < 0.6) return 'trim';
      return defaultClassify(f, 0);
    },
  };
  const color = kind === 'modelY' ? 0x3d4046 : 0x0f1013;
  g.add(bodyMesh(spec, paint(color, { metalness: 0.6 })));
  // Windscreen from the cowl to the roof, roof peaking behind the B-pillar, then the rear
  // window down to the trunk (3) or the steeper hatch glass nearly to the tail (Y).
  g.add(
    cabin(
      hatch
        ? [
            [L - 1.3, 0.98],
            [L - 2.15, height - 0.05],
            [-0.5, height],
            [-L + 0.85, height - 0.07],
            [-L + 0.15, 1.05],
          ]
        : [
            [L - 1.25, 0.88],
            [L - 2.1, height - 0.06],
            [-0.4, height],
            [-L + 1.3, height - 0.06],
            [-L + 0.55, 0.98],
          ],
      hw - 0.14,
      hw - 0.38,
    ),
  );
  const sec = makeSection(spec);
  // Within the nose face (y 0.30–0.64 + lift) and tail face (0.32–0.93), not above them.
  g.add(strip(MAT.head, L + 0.004, 0.58 + lift, 0, sec(L).wCrease * 1.75, 0.02));
  g.add(strip(MAT.tail, -L - 0.004, 0.84 + lift, 0, sec(-L).wCrease * 1.8, 0.025));
  addWheels(g, [fa, ra], 0.36 + lift / 3, 0.26, hw - 0.2);
}
