/** Minimal vector / rotation helpers so the physics stays independent of three.js. */
export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
/** n zeros. */
export const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

/** Row-major 3×3 matrix. */
export type M3 = [number, number, number, number, number, number, number, number, number];

export const mulMV = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** Multiply by the transpose — for a rotation, world → body. */
export const mulMtV = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

/**
 * Body → world rotation for yaw ψ about world +Y followed by roll φ about body +X.
 * R = Ry(ψ) · Rx(φ).
 */
export function yawRollMatrix(yaw: number, roll: number): M3 {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const cr = Math.cos(roll),
    sr = Math.sin(roll);
  return [cy, sy * sr, sy * cr, 0, cr, -sr, -sy, cy * sr, cy * cr];
}

export const mulMM = (a: M3, b: M3): M3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
export const transpose = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
/** Vector of a skew-symmetric matrix (the inverse of the cross-product matrix). */
export const vee = (m: M3): V3 => [m[7], m[2], m[3]];
export const subM = (a: M3, b: M3): M3 => a.map((v, i) => v - b[i]) as M3;

/** Rotation by angle |w| about axis w (Rodrigues), as used to integrate R' = R·[ω]×. */
export function expSO3(w: V3): M3 {
  const th = norm(w);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = scale(w, 1 / th);
  const c = Math.cos(th),
    s = Math.sin(th),
    C = 1 - c;
  return [
    c + x * x * C,
    x * y * C - z * s,
    x * z * C + y * s,
    y * x * C + z * s,
    c + y * y * C,
    y * z * C - x * s,
    z * x * C - y * s,
    z * y * C + x * s,
    c + z * z * C,
  ];
}

/** Re-orthonormalize a rotation matrix that has drifted numerically (Gram–Schmidt on columns). */
export function orthonormalize(m: M3): M3 {
  let x: V3 = [m[0], m[3], m[6]];
  x = scale(x, 1 / norm(x));
  let y: V3 = [m[1], m[4], m[7]];
  y = sub(y, scale(x, dot(x, y)));
  y = scale(y, 1 / norm(y));
  const z = cross(x, y);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** Deterministic pseudo-random numbers (mulberry32) and a normal deviate from them. */
export function rng(seed: number): { uniform: () => number; gauss: () => number } {
  let a = Math.floor(seed) >>> 0 || 1;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(uniform(), 1e-12),
      v = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { uniform, gauss };
}

/** Quintic smoothstep s(u) on [0,1] with zero 1st and 2nd derivatives at both ends. */
export function quintic(u: number): { s: number; ds: number; dds: number } {
  if (u <= 0) return { s: 0, ds: 0, dds: 0 };
  if (u >= 1) return { s: 1, ds: 0, dds: 0 };
  const u2 = u * u,
    u3 = u2 * u;
  return {
    s: u3 * (10 - 15 * u + 6 * u2),
    ds: 30 * u2 * (1 - u) * (1 - u),
    dds: 60 * u * (1 - u) * (1 - 2 * u),
  };
}
