import * as THREE from 'three';
import type { Params } from '../physics/params';
import type { Thruster } from '../physics/vehicle';
import { defaultClassify, makeSection, type BodySpec, type FaceInfo, type Knots, type Surface } from './loft';
import { WHEEL_NAMES } from './glb';
import { MAT, bodyMesh, paint, paintWithGlass, strip, wheel } from './parts';

export const WHEEL_RADIUS = 0.35;

export interface StuntCar {
  root: THREE.Group;
  /** One nozzle per thruster, same order as the thruster list, positioned at the nozzle exit. */
  nozzles: THREE.Object3D[];
  /** Front-left, front-right, rear-left, rear-right. */
  wheels: THREE.Object3D[];
  /** The procedural body and wheels, shown until the GLB model replaces them. */
  placeholder: THREE.Object3D[];
}

/**
 * Swap the procedural body for the GLB model (from glb.ts, normalized: nose +x, ground at
 * y = 0, at the car's length): the nozzles stay, the wheels become the model's own.
 */
export function dressStuntCar(car: StuntCar, model: THREE.Group, p: Params) {
  for (const o of car.placeholder) o.visible = false;
  model.position.y = -p.cgHeight; // body frame: origin at the CG
  car.root.add(model);
  const pivots = WHEEL_NAMES.map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  if (pivots.length === 4) {
    pivots.forEach((w) => {
      w.userData.spinSign = 1;
      w.userData.rollRadius = (w.userData.radius as number) * model.scale.x; // meters
    });
    car.wheels.splice(0, car.wheels.length, ...pivots);
  } else {
    // No separate wheels in the model: keep the procedural ones turning, hidden inside its tires.
    car.wheels.forEach((w) => (w.parent!.visible = true));
  }
}

/*
 * Roadster body, traced from the side-on frame at 0:31.6 of the footage (4.3 m
 * long, ~1.13 m tall): a low wedge nose with a full-width light bar, long hood,
 * steeply raked windscreen, roof peak just behind the B-pillar, a long fastback
 * to a short ducktail, and a character line rising toward the rear haunch.
 * Knots are (x forward, value) in meters with the ground at y = 0.
 */
const L = 2.15;
const WHEEL_X = 1.35;
const ROADSTER = {
  yb: [
    [L, 0.22],
    [1.95, 0.15],
    [1.5, 0.13],
    [-1.6, 0.13],
    [-2.0, 0.2],
    [-L, 0.27],
  ],
  yTop: [
    [L, 0.58],
    [1.9, 0.65],
    [1.2, 0.73],
    [0.62, 0.8],
    [0.3, 0.97],
    [0.0, 1.1],
    [-0.45, 1.13],
    [-1.0, 1.08],
    [-1.6, 0.97],
    [-2.0, 0.9],
    [-L, 0.88],
  ],
  yBelt: [
    [L, 0.55],
    [1.6, 0.66],
    [1.3, 0.79],
    [0.6, 0.79],
    [-0.3, 0.82],
    [-1.3, 0.87],
    [-1.9, 0.88],
    [-L, 0.86],
  ],
  yCrease: [
    [L, 0.44],
    [1.3, 0.57],
    [0.0, 0.6],
    [-1.3, 0.66],
    [-L, 0.62],
  ],
  wBottom: [
    [L, 0.66],
    [1.8, 0.8],
    [0, 0.85],
    [-2.0, 0.84],
    [-L, 0.8],
  ],
  wCrease: [
    [L, 0.74],
    [1.8, 0.9],
    [1.3, 0.98],
    [0.6, 0.95],
    [0.0, 0.93],
    [-0.8, 0.96],
    [-1.3, 1.0],
    [-1.9, 0.97],
    [-L, 0.9],
  ],
  wBelt: [
    [L, 0.7],
    [1.3, 0.92],
    [0.7, 0.84],
    [0.3, 0.76],
    [-0.9, 0.76],
    [-1.35, 0.86],
    [-L, 0.84],
  ],
  topExp: [
    [L, 2.5],
    [0.7, 2.5],
    [0.35, 4.2],
    [-1.3, 4.2],
    [-1.75, 3],
    [-L, 2.5],
  ],
} satisfies Record<string, Knots>;

/** Window outlines, evaluated per pixel (see paintWithGlass). */
const ROADSTER_GLASS = /* glsl */ `
  // Windscreen between the cowl (x = 0.62) and the roof's leading edge, inside the A-pillars.
  float ws = min(min(0.62 - p.x, p.x), min(0.53 + 0.15 * p.x - abs(p.z), (n.y - 0.3) * 0.3));
  // Side window: lower edge rising toward the rear, raked A-pillar, upper edge closing
  // down to meet the lower edge in a point above the rear wheel.
  float lower = p.y - (0.86 + (0.55 - p.x) * 0.058);
  float upper = (p.x > -0.5 ? 1.25 : 1.08 + (p.x + 0.5) * 0.116) - p.y;
  float front = 0.56 - p.x - 0.55 * (p.y - 0.86);
  float side = min(min(lower, upper), min(front, (abs(n.z) - 0.3) * 0.3));
  // Rear glass in the fastback.
  float rear = min(min(p.x + 1.75, -0.95 - p.x), min(0.45 - abs(p.z), (n.y - 0.45) * 0.3));
  return max(ws, max(side, rear));
`;

function classifyRoadster(f: FaceInfo): Surface {
  const { c, n, at } = f;
  if (n.y < -0.6) return 'under';
  if (c.x > 2.0 && c.y < 0.32) return 'trim'; // black chin
  if (Math.abs(n.y) < 0.75 && c.y < at.yb + 0.15) return 'trim'; // black lower sill
  return defaultClassify(f, 0);
}

export function roadsterSpec(): BodySpec {
  return {
    x0: -L,
    x1: L,
    stations: 140,
    cornerR: 0.07,
    ...ROADSTER,
    arches: [WHEEL_X, -WHEEL_X].map((x) => ({ x, y: WHEEL_RADIUS, r: WHEEL_RADIUS + 0.05, inner: 0.68 })),
    classify: classifyRoadster,
  };
}

/**
 * The stunt car, built in its body frame with the origin at the CG
 * (+x forward, +y up, +z right), so the physics pose applies directly.
 * Authored at the default 4.3 × 2.0 m footprint and scaled to the params.
 */
export function buildStuntCar(p: Params, thrusters: Thruster[]): StuntCar {
  const root = new THREE.Group();
  const shell = new THREE.Group();
  const sx = p.length / 4.3,
    sz = p.width / 2.0,
    sy = p.height / 1.2;
  shell.position.y = -p.cgHeight;
  root.add(shell);

  const spec = roadsterSpec();
  // Two paints from the same base: the body's carries the per-pixel window mask, the
  // lip's must not (the mask would be evaluated in the lip's own coordinates).
  const plainPaint = paint(0xe6e8eb, { metalness: 0.35, roughness: 0.3 });
  plainPaint.userData.owned = true;
  const bodyPaint = paintWithGlass(plainPaint.clone(), ROADSTER_GLASS);
  bodyPaint.userData.owned = true;
  const body = bodyMesh(spec, bodyPaint);
  body.scale.set(sx, sy, sz);
  shell.add(body);
  const sec = makeSection(spec);

  // Light signature: a full-width bar across the nose with upturned "eyes" at the corners,
  // a full-width red bar under the ducktail, and amber side markers behind the front wheels.
  const noseW = sec(L).wCrease * sz;
  shell.add(strip(MAT.head, L * sx + 0.004, 0.43 * sy, 0, noseW * 1.86, 0.022));
  for (const side of [-1, 1]) {
    const eye = strip(MAT.head, (L - 0.06) * sx, 0.52 * sy, side * noseW * 0.82, 0.3, 0.018, 0.12, [0, 1, 0]);
    eye.rotation.x = side * 0.5;
    eye.rotation.z = -0.35;
    shell.add(eye);
    const marker = strip(MAT.marker, 0.88 * sx, 0.6 * sy, side * (sec(0.88).wCrease * sz + 0.004), 0.004, 0.025, 0.07, [
      0,
      0,
      side,
    ]);
    shell.add(marker);
  }
  const tailW = sec(-L).wCrease * sz;
  shell.add(strip(MAT.tail, -L * sx - 0.004, 0.66 * sy, 0, tailW * 1.8, 0.03));
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, tailW * 1.7), plainPaint);
  lip.position.set((-L + 0.04) * sx, 0.895 * sy, 0);
  lip.rotation.z = -0.18;
  shell.add(lip);

  // Underside: a flat pan with ribs — visible when the car is inverted in the roll.
  const ribGeo = new THREE.BoxGeometry(3.2 * sx, 0.03, 0.06);
  for (const z of [-0.45, 0, 0.45]) {
    const rib = new THREE.Mesh(ribGeo, MAT.dark);
    rib.position.set(0, 0.115, z * sz);
    shell.add(rib);
  }
  const crossGeo = new THREE.BoxGeometry(0.06, 0.03, 1.3 * sz);
  for (const x of [-0.6, 0, 0.6]) {
    const rib = new THREE.Mesh(crossGeo, MAT.dark);
    rib.position.set(x * sx, 0.115, 0);
    shell.add(rib);
  }

  const wheels: THREE.Object3D[] = [];
  const placeholder: THREE.Object3D[] = [shell];
  for (const x of [WHEEL_X, -WHEEL_X])
    for (const z of [-0.86, 0.86]) {
      const w = wheel(WHEEL_RADIUS, 0.3);
      const holder = new THREE.Group();
      holder.position.set(x * sx, -p.cgHeight + WHEEL_RADIUS, z * sz);
      // Turbine vanes face outward on both sides; the flipped wheels spin the other way locally.
      if (z < 0) holder.rotation.y = Math.PI;
      w.userData.spinSign = z < 0 ? -1 : 1;
      holder.add(w);
      root.add(holder);
      wheels.push(w);
      placeholder.push(holder);
    }

  const nozzles = thrusters.map((t) => {
    const n = new THREE.Group();
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.065, 0.1, 16, 1, true), MAT.dark);
    const throat = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.008, 6, 16), MAT.rimFace);
    throat.rotation.x = Math.PI / 2;
    throat.position.y = -0.05;
    n.add(bell, throat);
    n.position.set(...t.position);
    // Cylinder axis is +y; point the bell's open end along the exhaust (−direction).
    n.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...t.direction).negate());
    root.add(n);
    return n;
  });
  return { root, nozzles, wheels, placeholder };
}
