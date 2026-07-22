/**
 * Who is working what, layered on top of the issue feed.
 *
 * Picking an issue up does not fix anything by itself. It puts a name on the
 * issue so the rest of the desk can see it is being handled and nobody chases
 * the same problem twice. Like decisions, this lives in the screen and not in
 * the engine: the engine reports the world, this records who took which part
 * of it.
 */

export interface Assignment {
  /** Display name; YOU when it is the person at this screen. */
  person: string;
  /** Sim-clock ISO datetime they picked the issue up. */
  at: string;
}

/** Assignments keyed by exception id. */
export type AssignmentMap = Record<string, Assignment>;

export const YOU = "You";

/**
 * The demo seeds one issue already picked up by a teammate, so the board
 * shows what stops duplicate effort: the name is on the issue before you
 * ever get to it.
 */
export const SEEDED_ASSIGNMENTS: AssignmentMap = {
  "PICKUP_MISSED:AEQ-7302": {
    person: "R. Vasquez",
    at: "2026-07-20T09:38:00Z",
  },
};

/**
 * Assignments that exist as of the sim clock. Scrubbing backwards makes a
 * pickup un-happen, same as every other sim-time-stamped record on screen.
 */
export function visibleAssignments(
  all: AssignmentMap,
  simTime: number
): AssignmentMap {
  const out: AssignmentMap = {};
  for (const [id, a] of Object.entries(all)) {
    if (Date.parse(a.at) <= simTime) out[id] = a;
  }
  return out;
}
