/**
 * The parked line-up the car flies over, as seen at 0:12 in the footage: five
 * vehicles side by side on a low stage, noses toward −Z, spaced ~3.6 m apart.
 * The stunt car flies along +X across them with its apex over the Semi at x = 0.
 * Viewed from the front camera, left to right: Model 3, Model Y, Semi, Cybertruck,
 * Cybercab. Dimensions (width without mirrors) are official figures except the
 * Semi (estimated) and the Cybercab's length (unpublished; estimated here).
 */
export type VehicleKind = 'semi' | 'cybertruck' | 'cybercab' | 'modelY' | 'model3';

export interface Obstacle {
  kind: VehicleKind;
  label: string;
  /** Center along X [m]. */
  x: number;
  /** Extent along X (the vehicle's width) [m]. */
  width: number;
  /** Extent along Z (the vehicle's length) [m]. */
  length: number;
  /** Height above the stage [m]. */
  height: number;
}

export const LINEUP: Obstacle[] = [
  { kind: 'cybercab', label: 'Cybercab', x: -6.6, width: 1.754, length: 4.3, height: 1.408 }, // length estimated
  { kind: 'cybertruck', label: 'Cybertruck', x: -3.64, width: 2.032, length: 5.683, height: 1.794 },
  { kind: 'semi', label: 'Semi', x: 0, width: 2.59, length: 6.32, height: 3.96 }, // estimated
  { kind: 'modelY', label: 'Model Y', x: 3.64, width: 1.92, length: 4.79, height: 1.624 },
  { kind: 'model3', label: 'Model 3', x: 6.6, width: 1.85, length: 4.72, height: 1.44 },
];

/** Z offset of the line-up's center; the car's approach runs along z = 0. */
export const LINEUP_Z = 0;

/** The low stage the line-up stands on (its top is the vehicles' ground level). */
export const STAGE = { x0: -9.5, x1: 9.5, z0: -3.9, z1: 3.9, height: 0.15 };
