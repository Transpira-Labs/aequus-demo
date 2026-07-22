/**
 * The agent layer.
 *
 * Some issues on a shipment board close themselves with a routine follow up.
 * Chasing a partner for a location, asking again for a POD, throwing away a
 * duplicate message: nobody needs to think about those. Other issues touch
 * money or a customer relationship, and a person has to decide.
 *
 * Agents handle the first kind and prepare the second kind. An agent never
 * pays, short pays, cancels, rebooks at a higher cost, files with customs,
 * takes a new sailing, or talks to a customer on its own. When it hits one of
 * those, it stops, explains what it found, and hands the human a short list of
 * ways to fix it.
 *
 * Everything here is simulated inside the demo. No real messages are sent.
 */

import type { ExceptionType, FeedEvent, GraphState } from "./types";

export type AgentId =
  | "partner-chaser"
  | "docs-clerk"
  | "billing-auditor"
  | "service-watch"
  | "customs-watch";

export interface AgentDef {
  id: AgentId;
  name: string;
  /** One plain line about what this agent does. */
  blurb: string;
  /** Which issue types this agent picks up. */
  handles: ExceptionType[];
  /** What it is allowed to do on its own, in plain words. */
  canDo: string;
  /** What it always hands back to a person, in plain words. */
  handsOff: string;
}

/**
 * The roster. Kept here so the UI and the logic agree on names and wording.
 */
export const AGENTS: AgentDef[] = [
  {
    id: "partner-chaser",
    name: "Partner Chaser",
    blurb: "Chases motor carriers, airlines, and ocean lines for answers and tracking.",
    handles: ["TENDER_UNANSWERED", "TRACKING_BLACKOUT"],
    canDo: "Send follow ups and ask for a check call.",
    handsOff: "Booking a different partner, because that costs money.",
  },
  {
    id: "docs-clerk",
    name: "Docs Clerk",
    blurb: "Collects proof of delivery and cleans up repeat messages.",
    handles: ["POD_MISSING", "DUPLICATE_EVENT"],
    canDo: "Request missing paperwork and drop duplicate messages.",
    handsOff: "Anything still missing after two asks.",
  },
  {
    id: "billing-auditor",
    name: "Billing Auditor",
    blurb: "Checks partner invoices against the agreed rate.",
    handles: ["INVOICE_MISMATCH"],
    canDo: "Hold an overbilled invoice and build the dispute file.",
    handsOff: "Approving or short paying the invoice.",
  },
  {
    id: "service-watch",
    name: "Service Watch",
    blurb: "Watches pickups and deliveries that are running late.",
    handles: ["PICKUP_MISSED", "LATE_DELIVERY"],
    canDo: "Ask the partner for a new time and draft the customer notice.",
    handsOff: "Telling the customer, because that is a relationship call.",
  },
  {
    id: "customs-watch",
    name: "Customs Watch",
    blurb: "Watches customs entries and ocean bookings.",
    handles: ["CUSTOMS_HOLD", "BOOKING_ROLLED"],
    canDo: "Pull entry status, build the doc packet, and ask the line for new sailing options.",
    handsOff: "Filing anything with customs, taking a new sailing, or telling the customer.",
  },
];

export const AGENT_BY_TYPE: Record<ExceptionType, AgentId> = {
  TENDER_UNANSWERED: "partner-chaser",
  TRACKING_BLACKOUT: "partner-chaser",
  POD_MISSING: "docs-clerk",
  DUPLICATE_EVENT: "docs-clerk",
  INVOICE_MISMATCH: "billing-auditor",
  PICKUP_MISSED: "service-watch",
  LATE_DELIVERY: "service-watch",
  CUSTOMS_HOLD: "customs-watch",
  BOOKING_ROLLED: "customs-watch",
};

/**
 * working  = the agent is mid follow up, nothing needed from a person yet
 * resolved = closed without a person
 * needs_you = stopped on purpose, a person has to decide
 * decided  = a person picked one of the choices, so it is off the queue
 *
 * Only the first three come out of runAgents. "decided" is layered on top from
 * what the person clicked, since that lives in the screen, not in the feed.
 */
export type RunStatus = "working" | "resolved" | "needs_you" | "decided";

export interface AgentStep {
  at: string; // ISO datetime, sim clock
  text: string; // "Asked Bayou City Freight for a location update."
}

/** One suggested way for a person to fix the issue. */
export interface FixOption {
  label: string; // short, e.g. "Short pay to the agreed rate"
  detail: string; // one plain sentence on what happens if they pick it
  recommended?: boolean;
}

export interface HumanAsk {
  why: string; // one plain sentence on why a person is needed
  options: FixOption[]; // 2 to 3 concrete ways to resolve it
  draft?: string; // optional prepared message the person can send
}

export interface AgentRun {
  id: string; // stable across recomputes, e.g. "run:POD_MISSING:AEQ-7311"
  agentId: AgentId;
  exceptionId: string;
  exceptionType: ExceptionType;
  shipmentId?: string;
  title: string; // short and plain, e.g. "Chasing a POD on AEQ-7311"
  status: RunStatus;
  startedAt: string; // when the agent picked the issue up
  steps: AgentStep[]; // what it has done so far, oldest first
  resolvedAt?: string;
  resolution?: string; // one plain sentence on what closed it
  ask?: HumanAsk; // present when status is needs_you
  /** What the person picked, once they have picked something. */
  decision?: Decision;
  /** Money protected or recovered, when that is meaningful. */
  savedUsd?: number;
}

/** A choice a person made on a run. Recorded here, not acted on anywhere. */
export interface Decision {
  optionLabel: string;
  /** Sim-clock time the choice was made. */
  at: string;
}

/** Decisions by run id. Lives in the screen so it can be undone. */
export type DecisionMap = Record<string, Decision>;

export interface AgentTally {
  working: number;
  resolved: number;
  needsYou: number;
  /** Cleared by a person picking a choice. Optional so runAgents can skip it. */
  decided?: number;
}

export interface AgentState {
  runs: AgentRun[]; // newest activity first
  byAgent: Record<AgentId, AgentTally>;
  /** Totals across every enabled agent. */
  totals: AgentTally;
  /** Issues closed by agents, so the UI can say what was handled for you. */
  handledWithoutYou: number;
  /** Money protected across resolved runs. */
  savedUsd: number;
}

export type AgentToggles = Record<AgentId, boolean>;

export const ALL_ON: AgentToggles = {
  "partner-chaser": true,
  "docs-clerk": true,
  "billing-auditor": true,
  "service-watch": true,
  "customs-watch": true,
};

/**
 * Pure function, same shape as the reconciliation engine. Given the reconciled
 * state, the raw events, the sim clock, and which agents are switched on, it
 * returns what every agent has done so far.
 *
 * Implemented in agents.ts.
 */
export type RunAgents = (
  state: GraphState,
  events: FeedEvent[],
  simTime: Date,
  enabled: AgentToggles
) => AgentState;

/** How long after an issue appears the agent picks it up and acts. */
export const AGENT_TIMING = {
  pickUpMinutes: 2,
  firstActionMinutes: 5,
  secondActionMinutes: 45,
  /** Past this with no fix, the agent stops and asks a person. */
  escalateMinutes: 90,
} as const;
