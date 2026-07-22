import { describe, expect, it } from "vitest";

import { runAgents } from "./agents";
import { ALL_ON, type AgentRun, type AgentToggles } from "./agentTypes";
import { buildState } from "./engine";
import { SCENARIO_END, SCENARIO_EVENTS } from "./scenario";
import type { FeedEvent, PartnerRef, Stop, TransportMode } from "./types";

// ── tiny fixture builders ───────────────────────────────────────────────────

const D = (t: string) => `2026-07-20T${t}:00Z`;

const BAYOU: PartnerRef = { name: "Bayou City Freight", code: "MC-771204" };
const BGL: PartnerRef = { name: "Blue Gulf Line", code: "SCAC-BGLU" };
const A: Stop = { name: "Origin Yard", city: "Houston", state: "TX" };
const B: Stop = { name: "Destination Depot", city: "Corpus Christi", state: "TX" };

const SHIP = "AEQ-9001";
const CUST = "Gulf Coast Polymers";

function tender(
  messageId: string,
  occurredAt: string,
  opts?: {
    pickupAppt?: string;
    deliveryAppt?: string;
    rate?: number;
    mode?: TransportMode;
    international?: boolean;
  }
): FeedEvent {
  return {
    messageId,
    source: "OPS",
    type: "shipment.tendered",
    occurredAt,
    payload: {
      shipmentId: SHIP,
      customer: CUST,
      origin: A,
      destination: B,
      pickupAppt: opts?.pickupAppt ?? D("09:00"),
      deliveryAppt: opts?.deliveryAppt ?? D("15:00"),
      equipment: "53' dry van",
      weightLbs: 30000,
      customerRateUsd: opts?.rate ?? 1500,
      mode: opts?.mode ?? "road",
      international: opts?.international,
    },
  };
}

const assign = (messageId: string, occurredAt: string, rate = 1200): FeedEvent => ({
  messageId,
  source: "OPS",
  type: "shipment.assigned",
  occurredAt,
  payload: { shipmentId: SHIP, partner: BAYOU, partnerRateUsd: rate },
});

const accept = (messageId: string, occurredAt: string): FeedEvent => ({
  messageId,
  source: "PARTNER",
  type: "tender.accepted",
  occurredAt,
  payload: { shipmentId: SHIP, partner: BAYOU },
});

const pickup = (messageId: string, occurredAt: string): FeedEvent => ({
  messageId,
  source: "PARTNER",
  type: "pickup.completed",
  occurredAt,
  payload: { shipmentId: SHIP, at: occurredAt, location: "Houston, TX" },
});

const ping = (messageId: string, occurredAt: string): FeedEvent => ({
  messageId,
  source: "PARTNER",
  type: "status.update",
  occurredAt,
  payload: { shipmentId: SHIP, at: occurredAt, location: "Victoria, TX" },
});

const deliver = (messageId: string, occurredAt: string): FeedEvent => ({
  messageId,
  source: "PARTNER",
  type: "delivery.completed",
  occurredAt,
  payload: { shipmentId: SHIP, at: occurredAt, location: "Corpus Christi, TX" },
});

const podFiled = (messageId: string, occurredAt: string): FeedEvent => ({
  messageId,
  source: "PARTNER",
  type: "pod.filed",
  occurredAt,
  payload: { shipmentId: SHIP, docId: "POD-9001" },
});

const bill = (messageId: string, occurredAt: string, amountUsd: number): FeedEvent => ({
  messageId,
  source: "PARTNER",
  type: "invoice.submitted",
  occurredAt,
  payload: {
    shipmentId: SHIP,
    invoiceId: "INV-9001",
    amountUsd,
    accessorials: [{ desc: "Detention 2 hr", amountUsd: 200 }],
  },
});

const customsHold = (
  messageId: string,
  occurredAt: string,
  reason: string
): FeedEvent => ({
  messageId,
  source: "PARTNER",
  type: "customs.hold",
  occurredAt,
  payload: { shipmentId: SHIP, at: occurredAt, reason },
});

const bookingRolled = (
  messageId: string,
  occurredAt: string,
  opts: { fromVessel: string; toVessel: string; newEtd: string }
): FeedEvent => ({
  messageId,
  source: "PARTNER",
  type: "booking.rolled",
  occurredAt,
  payload: {
    shipmentId: SHIP,
    at: occurredAt,
    partner: BGL,
    fromVessel: opts.fromVessel,
    toVessel: opts.toVessel,
    newEtd: opts.newEtd,
  },
});

/** Run the agents over a fixture at a sim time. */
function run(events: FeedEvent[], simTime: string, enabled: AgentToggles = ALL_ON) {
  const t = new Date(simTime);
  const visible = events.filter((e) => new Date(e.occurredAt) <= t);
  const state = buildState(visible, t);
  return runAgents(state, visible, t, enabled);
}

const byType = (runs: AgentRun[], type: string) =>
  runs.find((r) => r.exceptionType === type);

const BOOKED = [tender("m1", D("06:00")), assign("m2", D("06:10")), accept("m3", D("06:20"))];

// ── DUPLICATE_EVENT: always handled, never asks ─────────────────────────────

describe("duplicate messages", () => {
  const dupe = [tender("m1", D("06:00")), tender("m1", D("06:01"))];

  it("is always resolved on its own", () => {
    const r = byType(run(dupe, D("07:00")).runs, "DUPLICATE_EVENT")!;
    expect(r.status).toBe("resolved");
  });

  it("never asks a person", () => {
    const r = byType(run(dupe, D("20:00")).runs, "DUPLICATE_EVENT")!;
    expect(r.ask).toBeUndefined();
  });

  it("claims no dollars saved", () => {
    const r = byType(run(dupe, D("07:00")).runs, "DUPLICATE_EVENT")!;
    expect(r.savedUsd).toBeUndefined();
    expect(r.resolution).toBeTruthy();
  });

  it("uses the message id in the run id", () => {
    const r = byType(run(dupe, D("07:00")).runs, "DUPLICATE_EVENT")!;
    expect(r.id).toBe("run:DUPLICATE_EVENT:m1");
  });
});

// ── INVOICE_MISMATCH: hold first, then a person decides ─────────────────────

describe("invoice mismatch", () => {
  const overbilled = [
    ...BOOKED,
    pickup("m4", D("08:55")),
    deliver("m5", D("14:00")),
    podFiled("m6", D("14:30")),
    bill("m7", D("16:00"), 1500),
  ];

  it("always ends up needing a person", () => {
    const r = byType(run(overbilled, D("19:00")).runs, "INVOICE_MISMATCH")!;
    expect(r.status).toBe("needs_you");
  });

  it("shows the hold landing before the handoff", () => {
    const r = byType(run(overbilled, D("19:00")).runs, "INVOICE_MISMATCH")!;
    const holdStep = r.steps.find((s) => s.text.includes("on hold"));
    expect(holdStep).toBeDefined();
    expect(r.steps.indexOf(holdStep!)).toBeLessThan(r.steps.length - 1);
  });

  it("protects the overage even though it is not resolved", () => {
    const out = run(overbilled, D("19:00"));
    const r = byType(out.runs, "INVOICE_MISMATCH")!;
    expect(r.savedUsd).toBe(300);
    expect(out.savedUsd).toBeGreaterThanOrEqual(300);
  });

  it("offers a short pay option that is recommended", () => {
    const r = byType(run(overbilled, D("19:00")).runs, "INVOICE_MISMATCH")!;
    const rec = r.ask!.options.filter((o) => o.recommended);
    expect(rec).toHaveLength(1);
    expect(rec[0].label.toLowerCase()).toContain("short pay");
  });
});

// ── LATE_DELIVERY: never automatic, always drafts ───────────────────────────

describe("late delivery", () => {
  const late = [
    ...BOOKED,
    tender("m1b", D("06:00"), { deliveryAppt: D("12:00") }),
    pickup("m4", D("08:55")),
    deliver("m5", D("13:30")),
  ];

  it("is never resolved by the agent", () => {
    const r = byType(run(late, D("18:00")).runs, "LATE_DELIVERY")!;
    expect(r.status).toBe("needs_you");
    expect(r.resolvedAt).toBeUndefined();
  });

  it("hands off quickly instead of waiting the full window", () => {
    // Detected at 13:30, first action at 13:35.
    const r = byType(run(late, D("13:40")).runs, "LATE_DELIVERY")!;
    expect(r.status).toBe("needs_you");
  });

  it("carries a draft naming the shipment and the customer", () => {
    const r = byType(run(late, D("18:00")).runs, "LATE_DELIVERY")!;
    expect(r.ask!.draft).toBeTruthy();
    expect(r.ask!.draft).toContain(SHIP);
    expect(r.ask!.draft).toContain(CUST);
  });

  it("signs the draft from Aequus Ops in Tomball", () => {
    const r = byType(run(late, D("18:00")).runs, "LATE_DELIVERY")!;
    expect(r.ask!.draft).toContain("Aequus Ops, Tomball, Texas.");
  });

  it("keeps the draft free of dashes and excuses", () => {
    const r = byType(run(late, D("18:00")).runs, "LATE_DELIVERY")!;
    expect(r.ask!.draft).not.toContain("—");
  });
});

// ── POD_MISSING ─────────────────────────────────────────────────────────────

describe("missing POD", () => {
  const base = [...BOOKED, pickup("m4", D("08:55")), deliver("m5", D("12:00"))];
  const podLate = [...base, podFiled("m6", D("18:00"))];

  it("resolves when the POD finally lands", () => {
    const r = byType(run(podLate, D("19:00")).runs, "POD_MISSING")!;
    expect(r.status).toBe("resolved");
    expect(r.resolvedAt).toBe(D("18:00"));
  });

  it("counts the unblocked revenue as money saved", () => {
    const out = run(podLate, D("19:00"));
    const r = byType(out.runs, "POD_MISSING")!;
    expect(r.savedUsd).toBe(1500);
    expect(out.handledWithoutYou).toBeGreaterThanOrEqual(1);
  });

  it("escalates when the POD never shows up", () => {
    // Detected at 16:00, escalates at 17:30.
    const r = byType(run(base, D("18:00")).runs, "POD_MISSING")!;
    expect(r.status).toBe("needs_you");
    expect(r.ask!.options.length).toBeGreaterThanOrEqual(2);
  });

  it("is still working between the two asks", () => {
    const r = byType(run(base, D("16:30")).runs, "POD_MISSING")!;
    expect(r.status).toBe("working");
  });
});

// ── TRACKING_BLACKOUT ───────────────────────────────────────────────────────

describe("tracking blackout", () => {
  const dark = [...BOOKED, pickup("m4", D("09:00"))];
  const backOnline = [...dark, ping("m5", D("13:00"))];

  it("resolves when the partner pings again", () => {
    const r = byType(run(backOnline, D("14:00")).runs, "TRACKING_BLACKOUT")!;
    expect(r.status).toBe("resolved");
    expect(r.resolvedAt).toBe(D("13:00"));
  });

  it("escalates when the partner stays dark", () => {
    // Detected at 12:00, escalates at 13:30.
    const r = byType(run(dark, D("14:00")).runs, "TRACKING_BLACKOUT")!;
    expect(r.status).toBe("needs_you");
    expect(r.ask!.why).toContain("Bayou City Freight");
  });
});

// ── TENDER_UNANSWERED ───────────────────────────────────────────────────────

describe("unanswered tender", () => {
  const silent = [tender("m1", D("06:00")), assign("m2", D("09:00"))];
  const lateAccept = [...silent, accept("m3", D("09:45"))];

  it("resolves when the partner finally accepts", () => {
    const r = byType(run(lateAccept, D("10:00")).runs, "TENDER_UNANSWERED")!;
    expect(r.status).toBe("resolved");
    expect(r.resolvedAt).toBe(D("09:45"));
  });

  it("never rebooks on its own", () => {
    // Detected at 09:30, escalates at 11:00.
    const r = byType(run(silent, D("11:30")).runs, "TENDER_UNANSWERED")!;
    expect(r.status).toBe("needs_you");
    expect(r.ask!.why.toLowerCase()).toContain("money");
  });
});

// ── PICKUP_MISSED ───────────────────────────────────────────────────────────

describe("missed pickup", () => {
  const noShow = [tender("m1", D("06:00")), assign("m2", D("06:10")), accept("m3", D("06:20"))];
  const latePickup = [...noShow, pickup("m4", D("10:00"))];

  it("resolves when the truck finally shows", () => {
    const r = byType(run(latePickup, D("11:00")).runs, "PICKUP_MISSED")!;
    expect(r.status).toBe("resolved");
    expect(r.resolvedAt).toBe(D("10:00"));
  });

  it("escalates when there is still no truck", () => {
    // Detected at 09:30, escalates at 11:00.
    const r = byType(run(noShow, D("11:30")).runs, "PICKUP_MISSED")!;
    expect(r.status).toBe("needs_you");
    expect(r.agentId).toBe("service-watch");
  });
});

// ── CUSTOMS_HOLD: customs-watch, time sensitive, never automatic ────────────

describe("customs hold", () => {
  const farAppt = "2026-07-21T14:00:00Z"; // next day, so nothing else fires
  const oceanBooked = [
    tender("h1", D("06:15"), { mode: "ocean", deliveryAppt: farAppt, international: true }),
    assign("h2", D("06:30")),
    accept("h3", D("06:45")),
    pickup("h4", D("09:00")),
  ];
  const held = [...oceanBooked, customsHold("h5", D("10:00"), "CBP exam hold on entry")];

  it("routes to Customs Watch", () => {
    const r = byType(run(held, D("11:00")).runs, "CUSTOMS_HOLD")!;
    expect(r.agentId).toBe("customs-watch");
  });

  it("is still working before the first action", () => {
    // Detected at 10:00, first action at 10:05.
    const r = byType(run(held, D("10:03")).runs, "CUSTOMS_HOLD")!;
    expect(r.status).toBe("working");
  });

  it("hands off at the first action instead of waiting", () => {
    // Detected at 10:00, hands off at 10:05.
    const r = byType(run(held, D("10:10")).runs, "CUSTOMS_HOLD")!;
    expect(r.status).toBe("needs_you");
    expect(r.resolvedAt).toBeUndefined();
  });

  it("hands the packet over with exactly one recommended option", () => {
    const r = byType(run(held, D("11:00")).runs, "CUSTOMS_HOLD")!;
    expect(r.ask!.options.filter((o) => o.recommended)).toHaveLength(1);
    expect(r.ask!.options.length).toBeGreaterThanOrEqual(2);
    expect(r.ask!.options.length).toBeLessThanOrEqual(3);
  });

  it("carries a customer draft signed from Aequus Ops in Tomball", () => {
    const r = byType(run(held, D("11:00")).runs, "CUSTOMS_HOLD")!;
    expect(r.ask!.draft).toContain(SHIP);
    expect(r.ask!.draft).toContain("Aequus Ops, Tomball, Texas.");
  });
});

// ── BOOKING_ROLLED: customs-watch, gathers options first ────────────────────

describe("rolled booking", () => {
  const farAppt = "2026-07-21T14:00:00Z";
  const oceanBooked = [
    tender("b1", D("07:00"), { mode: "ocean", deliveryAppt: farAppt, international: true }),
    assign("b2", D("08:00")),
    accept("b3", D("08:15")),
    pickup("b4", D("11:00")),
  ];
  const rolled = [
    ...oceanBooked,
    bookingRolled("b5", D("14:00"), {
      fromVessel: "BG Neptune 24W",
      toVessel: "BG Atlas 25W",
      newEtd: "2026-07-25T06:00:00Z",
    }),
  ];

  it("routes to Customs Watch", () => {
    const r = byType(run(rolled, D("16:00")).runs, "BOOKING_ROLLED")!;
    expect(r.agentId).toBe("customs-watch");
  });

  it("is still working before the second action", () => {
    // Detected at 14:00, second action at 14:45.
    const r = byType(run(rolled, D("14:30")).runs, "BOOKING_ROLLED")!;
    expect(r.status).toBe("working");
  });

  it("hands off at the second action after gathering options", () => {
    // Detected at 14:00, hands off at 14:45.
    const r = byType(run(rolled, D("15:00")).runs, "BOOKING_ROLLED")!;
    expect(r.status).toBe("needs_you");
    expect(r.resolvedAt).toBeUndefined();
  });

  it("names the rolled vessel and offers exactly one recommended option", () => {
    const r = byType(run(rolled, D("16:00")).runs, "BOOKING_ROLLED")!;
    expect(r.ask!.options.filter((o) => o.recommended)).toHaveLength(1);
    expect(r.ask!.options.some((o) => o.label.includes("BG Atlas 25W"))).toBe(true);
    expect(r.ask!.draft).toContain("Aequus Ops, Tomball, Texas.");
  });
});

// ── toggles, ids, timing, determinism ───────────────────────────────────────

describe("toggles", () => {
  const overbilled = [
    ...BOOKED,
    pickup("m4", D("08:55")),
    deliver("m5", D("14:00")),
    podFiled("m6", D("14:30")),
    bill("m7", D("16:00"), 1500),
  ];

  it("drops every run from an agent that is switched off", () => {
    const off: AgentToggles = { ...ALL_ON, "billing-auditor": false };
    const out = run(overbilled, D("19:00"), off);
    expect(out.runs.some((r) => r.agentId === "billing-auditor")).toBe(false);
  });

  it("zeroes the tallies and the money for a switched off agent", () => {
    const off: AgentToggles = { ...ALL_ON, "billing-auditor": false };
    const out = run(overbilled, D("19:00"), off);
    expect(out.byAgent["billing-auditor"]).toEqual({
      working: 0,
      resolved: 0,
      needsYou: 0,
    });
    expect(out.savedUsd).toBe(0);
  });

  it("produces nothing at all when every agent is off", () => {
    const allOff: AgentToggles = {
      "partner-chaser": false,
      "docs-clerk": false,
      "billing-auditor": false,
      "service-watch": false,
      "customs-watch": false,
    };
    const out = run(SCENARIO_EVENTS, SCENARIO_END, allOff);
    expect(out.runs).toHaveLength(0);
    expect(out.totals).toEqual({ working: 0, resolved: 0, needsYou: 0 });
    expect(out.handledWithoutYou).toBe(0);
    expect(out.savedUsd).toBe(0);
  });
});

describe("stability", () => {
  it("keeps run ids identical across two calls at different times", () => {
    const a = run(SCENARIO_EVENTS, "2026-07-20T18:00:00Z");
    const b = run(SCENARIO_EVENTS, SCENARIO_END);
    const early = new Set(a.runs.map((r) => r.id));
    for (const id of early) expect(b.runs.some((r) => r.id === id)).toBe(true);
  });

  it("uses the documented run id shape", () => {
    const out = run(SCENARIO_EVENTS, SCENARIO_END);
    for (const r of out.runs) {
      expect(r.id).toMatch(/^run:[A-Z_]+:[A-Za-z0-9-]+$/);
    }
  });

  it("returns the same output for the same input", () => {
    const a = run(SCENARIO_EVENTS, SCENARIO_END);
    const b = run(SCENARIO_EVENTS, SCENARIO_END);
    expect(a).toEqual(b);
  });

  it("never shows a step before its time", () => {
    const base = [...BOOKED, pickup("m4", D("08:55")), deliver("m5", D("12:00"))];
    // Detected at 16:00. Pick up at 16:02, first ask at 16:05, second at 16:45.
    const early = byType(run(base, D("16:03")).runs, "POD_MISSING")!;
    const later = byType(run(base, D("16:50")).runs, "POD_MISSING")!;
    expect(early.steps.length).toBeLessThan(later.steps.length);
    expect(early.steps).toHaveLength(1);
    for (const s of later.steps) {
      expect(Date.parse(s.at)).toBeLessThanOrEqual(Date.parse(D("16:50")));
    }
  });

  it("does not open a run before the issue is detectable", () => {
    const base = [...BOOKED, pickup("m4", D("08:55")), deliver("m5", D("12:00"))];
    expect(byType(run(base, D("15:00")).runs, "POD_MISSING")).toBeUndefined();
  });

  it("sorts runs by newest activity first", () => {
    const out = run(SCENARIO_EVENTS, SCENARIO_END);
    const activity = (r: AgentRun) =>
      Date.parse(r.steps.length ? r.steps[r.steps.length - 1].at : r.startedAt);
    for (let i = 1; i < out.runs.length; i++) {
      expect(activity(out.runs[i - 1])).toBeGreaterThanOrEqual(activity(out.runs[i]));
    }
  });
});

// ── integration over the seeded day ─────────────────────────────────────────

describe("scenario integration", () => {
  const out = run(SCENARIO_EVENTS, SCENARIO_END);

  it("closes some issues without a person and stops on others", () => {
    expect(out.totals.resolved).toBeGreaterThan(0);
    expect(out.totals.needsYou).toBeGreaterThan(0);
    expect(out.handledWithoutYou).toBe(out.totals.resolved);
  });

  it("shows a partner chaser win and a docs clerk win", () => {
    const resolved = out.runs.filter((r) => r.status === "resolved");
    const agents = new Set(resolved.map((r) => r.agentId));
    expect(agents.has("partner-chaser")).toBe(true);
    expect(agents.has("docs-clerk")).toBe(true);
  });

  it("puts the customs hold and the rolled booking on Customs Watch", () => {
    const customs = out.runs.filter((r) => r.agentId === "customs-watch");
    const types = new Set(customs.map((r) => r.exceptionType));
    expect(types.has("CUSTOMS_HOLD")).toBe(true);
    expect(types.has("BOOKING_ROLLED")).toBe(true);
  });

  it("gives every needs_you run a clear ask with exactly one recommendation", () => {
    const needs = out.runs.filter((r) => r.status === "needs_you");
    expect(needs.length).toBeGreaterThan(0);
    for (const r of needs) {
      expect(r.ask).toBeDefined();
      expect(r.ask!.why.length).toBeGreaterThan(10);
      expect(r.ask!.options.length).toBeGreaterThanOrEqual(2);
      expect(r.ask!.options.length).toBeLessThanOrEqual(3);
      expect(r.ask!.options.filter((o) => o.recommended)).toHaveLength(1);
      for (const o of r.ask!.options) {
        expect(o.label.length).toBeGreaterThan(0);
        expect(o.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses no em dashes anywhere in any run", () => {
    const text = JSON.stringify(out.runs);
    expect(text).not.toContain("—");
    expect(text).not.toContain("–");
  });

  it("reports money protected across the day", () => {
    expect(out.savedUsd).toBeGreaterThan(0);
  });

  it("only counts runs from enabled agents in the totals", () => {
    const sum =
      out.totals.working + out.totals.resolved + out.totals.needsYou;
    expect(sum).toBe(out.runs.length);
  });
});
