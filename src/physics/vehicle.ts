import type { Params } from './params';
import type { V3 } from './math';

/**
 * Body frame: +x forward, +y up, +z to the driver's right; origin at the CG.
 * `direction` is the unit force on the car — the exhaust leaves the opposite way.
 */
export interface Thruster {
  id: string;
  label: string;
  group: 'lift' | 'side';
  position: V3;
  direction: V3;
  maxForce: number;
}

/**
 * Six cold-gas nozzles, as the footage shows them (side-close view, 0:26.8):
 *  - 4 down-firing lift thrusters inboard of the wheels. They carry the launch, sustained
 *    and landing thrust, and steer by firing unevenly: left vs right pairs roll the car,
 *    front vs rear pitch it.
 *  - 2 front side thrusters at the front corners, exhausting outward and slightly down —
 *    the left one fires as the roll begins. Being low and forward, each one rolls the car
 *    (it pushes below the CG) and yaws it.
 * Nothing pushes the car downward: there is no up-firing nozzle.
 */
export function buildThrusters(p: Params): Thruster[] {
  // Lift nozzles sit just inboard of the wheels, behind the front pair and ahead of
  // the rear pair, exiting just under the floor — where the plumes appear in the footage.
  const lx = p.length * 0.22;
  const lz = p.width * 0.33;
  const ly = -(p.cgHeight - 0.12);
  // Front side thrusters: just behind the front bumper, low on each side.
  const sx = p.length * 0.4;
  const sy = -(p.cgHeight - 0.3);
  const sz = p.width * 0.48;
  const up: V3 = [0, 1, 0];
  // Exhaust leaves outward and ~20° downward, so the push is inward and slightly up.
  const tilt = (20 * Math.PI) / 180;
  const lift = (id: string, label: string, x: number, z: number): Thruster => ({
    id,
    label,
    group: 'lift',
    position: [x, ly, z],
    direction: up,
    maxForce: p.liftThrusterMax,
  });
  const side = (id: string, label: string, s: number): Thruster => ({
    id,
    label,
    group: 'side',
    position: [sx, sy, s * sz],
    direction: [0, Math.sin(tilt), -s * Math.cos(tilt)],
    maxForce: p.rcsThrusterMax,
  });
  return [
    lift('FL', 'Lift front-left', lx, -lz),
    lift('FR', 'Lift front-right', lx, lz),
    lift('RL', 'Lift rear-left', -lx, -lz),
    lift('RR', 'Lift rear-right', -lx, lz),
    side('SL', 'Front-left side, exhausts left', -1),
    side('SR', 'Front-right side, exhausts right', 1),
  ];
}

/** Principal moments of inertia about body x (roll), y (yaw), z (pitch) [kg·m²]. */
export function principalInertia(p: Params): V3 {
  const { mass: m, length: L, width: W, height: H, inertiaScale: k } = p;
  return [(k * m * (W * W + H * H)) / 12, (k * m * (L * L + W * W)) / 12, (k * m * (L * L + H * H)) / 12];
}

/** Driver's head/torso position in the body frame — where occupant g-load is evaluated. */
export function driverSeat(p: Params): V3 {
  return [-0.2, 0.1, -p.width * 0.2];
}
