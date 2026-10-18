import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loftBody, smoothCurve, type BodySpec } from '../src/scene/loft';

const box: BodySpec = {
  x0: -2,
  x1: 2,
  stations: 24,
  yb: [[0, 0.2]],
  yTop: [[0, 1.2]],
  yBelt: [[0, 1.0]],
  yCrease: [[0, 0.6]],
  wBottom: [[0, 0.8]],
  wCrease: [[0, 0.9]],
  wBelt: [[0, 0.85]],
  arches: [{ x: 1.2, y: 0.35, r: 0.4, inner: 0.5 }],
};

describe('smoothCurve', () => {
  it('passes through its knots without overshooting', () => {
    const f = smoothCurve([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]);
    expect(f(1)).toBeCloseTo(1, 9);
    for (let x = 1; x <= 2; x += 0.05) expect(f(x)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('loftBody', () => {
  const geo = loftBody(box);

  it('produces outward-facing triangles (positive enclosed volume)', () => {
    const pos = geo.getAttribute('position');
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    let vol = 0;
    const tri = (i: number, j: number, k: number) => {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, j);
      c.fromBufferAttribute(pos, k);
      vol += a.dot(b.clone().cross(c)) / 6;
    };
    const idx = geo.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    // Roughly a 4 m × 1.7 m × 1 m box, minus the arch notches.
    expect(vol).toBeGreaterThan(4);
    expect(vol).toBeLessThan(8);
  });

  it('notches the wheel arch: the body is pulled in to the well width inside the arch', () => {
    const pos = geo.getAttribute('position');
    let maxW = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = Math.abs(pos.getZ(i));
      if (Math.abs(x - 1.2) < 0.1 && y < 0.6) maxW = Math.max(maxW, z);
    }
    expect(maxW).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it('assigns every triangle to a material group', () => {
    const total = geo.groups.reduce((s, g) => s + g.count, 0);
    expect(total).toBe(geo.getIndex()!.count);
  });
});
