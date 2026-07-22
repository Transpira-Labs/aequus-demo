import { describe, expect, it } from "vitest";
import { applyDecisions } from "./decisions";
import type { AgentRun, AgentState, DecisionMap } from "./agentTypes";

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run:POD_MISSING:AEQ-7311",
    agentId: "docs-clerk",
    exceptionId: "POD_MISSING:AEQ-7311",
    exceptionType: "POD_MISSING",
    shipmentId: "AEQ-7311",
    title: "Chasing a POD on AEQ-7311",
    status: "needs_you",
    startedAt: "2026-07-20T16:52:00Z",
    steps: [],
    ask: { why: "why", options: [{ label: "Call them", detail: "d" }] },
    ...over,
  };
}

function state(runs: AgentRun[]): AgentState {
  const empty = { working: 0, resolved: 0, needsYou: 0 };
  const byAgent = {
    "partner-chaser": { ...empty },
    "docs-clerk": { ...empty },
    "billing-auditor": { ...empty },
    "service-watch": { ...empty },
    "customs-watch": { ...empty },
  };
  const totals = { ...empty };
  for (const r of runs) {
    const key = r.status === "needs_you" ? "needsYou" : r.status === "resolved" ? "resolved" : "working";
    if (key === "needsYou" || key === "resolved" || key === "working") {
      byAgent[r.agentId][key] += 1;
      totals[key] += 1;
    }
  }
  return { runs, byAgent, totals, handledWithoutYou: 0, savedUsd: 0 };
}

const pick: DecisionMap = {
  "run:POD_MISSING:AEQ-7311": { optionLabel: "Call them", at: "2026-07-20T18:00:00Z" },
};

describe("applyDecisions", () => {
  it("returns the same state when nothing has been decided", () => {
    const s = state([run()]);
    expect(applyDecisions(s, {})).toBe(s);
  });

  it("moves a decided run out of the queue", () => {
    const out = applyDecisions(state([run()]), pick);
    expect(out.runs[0].status).toBe("decided");
    expect(out.runs[0].decision?.optionLabel).toBe("Call them");
    expect(out.totals.needsYou).toBe(0);
    expect(out.totals.decided).toBe(1);
    expect(out.byAgent["docs-clerk"].needsYou).toBe(0);
    expect(out.byAgent["docs-clerk"].decided).toBe(1);
  });

  it("leaves other runs untouched", () => {
    const other = run({ id: "run:LATE_DELIVERY:AEQ-7309", agentId: "service-watch" });
    const out = applyDecisions(state([run(), other]), pick);
    expect(out.runs[1].status).toBe("needs_you");
    expect(out.totals.needsYou).toBe(1);
  });

  it("does not override a run the agent already closed", () => {
    // The clock moved on and the POD arrived, so the agent's outcome wins.
    const closed = run({ status: "resolved", resolution: "POD filed" });
    const out = applyDecisions(state([closed]), pick);
    expect(out.runs[0].status).toBe("resolved");
    expect(out.totals.decided ?? 0).toBe(0);
  });

  it("ignores decisions for runs that are not on the board", () => {
    const s = state([run({ id: "run:OTHER:AEQ-7000" })]);
    const out = applyDecisions(s, pick);
    expect(out).toBe(s);
  });

  it("is pure, leaving the input state alone", () => {
    const s = state([run()]);
    applyDecisions(s, pick);
    expect(s.runs[0].status).toBe("needs_you");
    expect(s.totals.needsYou).toBe(1);
  });
});
