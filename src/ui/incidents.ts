import { HARD_LANDING_LOAD, whenText, type Incident, type Timeline } from '../physics/timeline';
import { fmt } from './units';

/** An incident's one-line description, in the display units. */
export function incidentText(i: Incident): string {
  switch (i.kind) {
    case 'collision':
      return `Collision: the car hits the ${i.solid!.label} ${whenText(i.t, i.phase)}, up to ${fmt('length', i.depth!)} deep.`;
    case 'hard-landing':
      return `Hard landing: ${fmt('velocity', i.speed!)} at touchdown puts ${i.load!.toFixed(2)} × the car's weight on the tires (more than ${HARD_LANDING_LOAD} ×).`;
    default:
      return i.message;
  }
}

/** The short text on an incident's marker in the 3D view, in the display units. */
export function incidentLabel(i: Incident): string {
  return i.kind === 'hard-landing' ? `Hard landing · ${fmt('velocity', i.speed!)}` : i.label;
}

/**
 * The problems to list for a run, most important first: the incidents (which have a time
 * and place) in time order, then the warnings that aren't incidents. Collisions after the
 * first incident are mostly its consequences (a car that has gone through one vehicle
 * carries on into the next), so they are folded into it.
 */
export interface ProblemList {
  first: Incident | null;
  /** Incidents after the first one, shown as "then …". */
  later: Incident[];
  /** Warnings with no time or place (e.g. a thruster over its rating). */
  others: string[];
}

export function problemList(tl: Timeline): ProblemList {
  const located = new Set(tl.incidents.map((i) => i.message));
  const others = tl.warnings.filter((w) => !located.has(w));
  const [first = null, ...later] = tl.incidents;
  return { first, later, others };
}
