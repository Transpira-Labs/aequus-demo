/**
 * What the person clicked, layered on top of what the agents did.
 *
 * Picking a choice does not place a call, pay an invoice, or send anything. It
 * records the decision so the issue leaves the queue and the next person knows
 * it is being handled. That is why this lives here and not in the agent engine:
 * the agents report the world, this records what we decided about it.
 */

import type { AgentRun, AgentState, AgentTally, DecisionMap } from "./agentTypes";

const EMPTY: AgentTally = { working: 0, resolved: 0, needsYou: 0, decided: 0 };

/**
 * Pure, like everything else in the pipeline. A run that has a decision moves
 * from "needs you" to "decided" and stops counting against the queue.
 */
export function applyDecisions(
  state: AgentState,
  decisions: DecisionMap
): AgentState {
  if (Object.keys(decisions).length === 0) return state;

  let changed = false;
  const runs: AgentRun[] = state.runs.map((run) => {
    const decision = decisions[run.id];
    // Only a run that was actually waiting on a person can be decided. If the
    // clock moved and the agent already closed it, the agent's outcome wins.
    if (!decision || run.status !== "needs_you") return run;
    changed = true;
    return { ...run, status: "decided" as const, decision };
  });

  if (!changed) return state;

  const byAgent = {} as AgentState["byAgent"];
  for (const [agentId, tally] of Object.entries(state.byAgent)) {
    byAgent[agentId as keyof AgentState["byAgent"]] = { ...EMPTY, ...tally };
  }
  const totals: AgentTally = { ...EMPTY, ...state.totals };

  for (const run of runs) {
    if (run.status !== "decided") continue;
    const t = byAgent[run.agentId];
    if (t) {
      t.needsYou = Math.max(0, t.needsYou - 1);
      t.decided = (t.decided ?? 0) + 1;
    }
    totals.needsYou = Math.max(0, totals.needsYou - 1);
    totals.decided = (totals.decided ?? 0) + 1;
  }

  return { ...state, runs, byAgent, totals };
}
