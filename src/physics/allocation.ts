import { cross, zeros, type V3 } from './math';
import { nnls } from './nnls';
import type { Thruster } from './vehicle';

/** Body-frame force [N] and torque about the CG [N·m]. */
export interface Wrench {
  force: V3;
  torque: V3;
}

export interface Allocation {
  /** Force of each thruster [N], same order as the thruster list. */
  forces: number[];
  /** Wrench the thrusters actually deliver. */
  achieved: Wrench;
  /** Largest mismatch between required and achieved, as a fraction of the required magnitude. */
  residual: number;
  /** Indices of thrusters asked for more than their rated force. */
  saturated: number[];
}

const UNIT = 1000; // solve in kN / kN·m so forces and torques are comparably scaled
const REGULARIZATION = 1e-6;
/**
 * Relative cost of using each group. Attitude nozzles cost more, so lift force comes from
 * the lift nozzles (where the footage shows the jets) and the sill and bumper nozzles are
 * left for torque and sideways force.
 */
const GROUP_WEIGHT: Record<Thruster['group'], number> = { lift: 1, side: 30 };

/**
 * Split a required body-frame wrench across thrusters that can only push (u ≥ 0).
 * Solves  min ‖B·u − w‖² + λ Σ wⱼ uⱼ²  with u ≥ 0; as λ → 0 this is the weighted
 * minimum-norm exact solution, which spreads load evenly within each group rather than
 * maxing out one nozzle.
 */
export function allocate(thrusters: Thruster[], required: Wrench): Allocation {
  const cols = thrusters.map((t) => {
    const torque = cross(t.position, t.direction);
    return [...t.direction, ...torque];
  });
  const w = [...required.force, ...required.torque].map((v) => v / UNIT);
  const n = thrusters.length;
  const A: number[][] = [];
  for (let r = 0; r < 6; r++) A.push(cols.map((c) => c[r]));
  for (let j = 0; j < n; j++) {
    const s = Math.sqrt(REGULARIZATION * GROUP_WEIGHT[thrusters[j].group]);
    A.push(cols.map((_, k) => (k === j ? s : 0)));
  }
  const b = [...w, ...zeros(n)];

  const u = nnls(A, b).map((v) => v * UNIT);
  const achievedVec = [0, 1, 2, 3, 4, 5].map((r) => u.reduce((s, uj, j) => s + uj * cols[j][r], 0));
  const achieved: Wrench = {
    force: achievedVec.slice(0, 3) as V3,
    torque: achievedVec.slice(3, 6) as V3,
  };
  const reqVec = [...required.force, ...required.torque];
  const reqMag = Math.hypot(...reqVec);
  const errMag = Math.hypot(...reqVec.map((v, i) => v - achievedVec[i]));
  return {
    forces: u,
    achieved,
    residual: reqMag > 1 ? errMag / reqMag : errMag / 1000,
    saturated: u.flatMap((f, j) => (f > thrusters[j].maxForce * 1.0001 ? [j] : [])),
  };
}
