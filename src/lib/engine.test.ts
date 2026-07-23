import { describe, it, expect } from "vitest";
import { buildState } from "./engine";
import { SCENARIO_EVENTS, SCENARIO_END } from "./scenario";
import {
  PartnerRef,
  ExceptionType,
  FeedEvent,
  ISSUE_HISTORY,
  Stop,
  TransportMode,
  frequencyOf,
} from "./types";

// ── tiny builders for hand-authored event lists ──────────────────────────────

const ORIG: Stop = { name: "Origin Dock", city: "Houston", state: "TX" };
const DEST: Stop = { name: "Dest Depot", city: "Corpus Christi", state: "TX" };
const BAYOU: PartnerRef = { name: "Bayou City Freight", code: "MC-771204" };
const SAMHOU: PartnerRef = { name: "Sam Houston Carriers", code: "MC-448861" };
const BGL: PartnerRef = { name: "Blue Gulf Line", code: "SCAC-BGLU" };

const D = (t: string) => `2026-07-20T${t}:00Z`;
const D2 = (t: string) => `2026-07-21T${t}:00Z`;
const D3 = (t: string) => `2026-07-22T${t}:00Z`;
/** Compare two ISO strings by instant (engine mixes ":00Z" and ".000Z" forms). */
const sameInstant = (actual: string, iso: string) =>
  expect(Date.parse(actual)).toBe(Date.parse(iso));

function tender(
  id: string,
  at: string,
  shipmentId: string,
  opts?: {
    customer?: string;
    pickupAppt?: string;
    deliveryAppt?: string;
    customerRateUsd?: number;
    mode?: TransportMode;
    international?: boolean;
    equipment?: string;
  }
): FeedEvent {
  return {
    messageId: id,
    source: "OPS",
    type: "shipment.tendered",
    occurredAt: at,
    payload: {
      shipmentId,
      customer: opts?.customer ?? "Gulf Coast Polymers",
      origin: ORIG,
      destination: DEST,
      pickupAppt: opts?.pickupAppt ?? D("09:00"),
      deliveryAppt: opts?.deliveryAppt ?? D("14:00"),
      mode: opts?.mode ?? "road",
      international: opts?.international,
      equipment: opts?.equipment ?? "53' dry van",
      weightLbs: 30000,
      customerRateUsd: opts?.customerRateUsd ?? 1500,
    },
  };
}
const assign = (id: string, at: string, shipmentId: string, partner: PartnerRef, rate: number): FeedEvent => ({
  messageId: id, source: "OPS", type: "shipment.assigned", occurredAt: at,
  payload: { shipmentId, partner, partnerRateUsd: rate },
});
const accept = (id: string, at: string, shipmentId: string, partner: PartnerRef): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "tender.accepted", occurredAt: at,
  payload: { shipmentId, partner },
});
const decline = (id: string, at: string, shipmentId: string, partner: PartnerRef): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "tender.declined", occurredAt: at,
  payload: { shipmentId, partner },
});
const pickup = (id: string, at: string, shipmentId: string, location = "Houston, TX"): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "pickup.completed", occurredAt: at,
  payload: { shipmentId, at, location },
});
const status = (id: string, at: string, shipmentId: string, location = "San Antonio, TX"): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "status.update", occurredAt: at,
  payload: { shipmentId, at, location },
});
const delivery = (id: string, at: string, shipmentId: string, location = "Corpus Christi, TX"): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "delivery.completed", occurredAt: at,
  payload: { shipmentId, at, location },
});
const pod = (id: string, at: string, shipmentId: string, docId = "POD-X"): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "pod.filed", occurredAt: at,
  payload: { shipmentId, docId },
});
const invoice = (
  id: string, at: string, shipmentId: string, invoiceId: string, amountUsd: number,
  accessorials?: { desc: string; amountUsd: number }[]
): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "invoice.submitted", occurredAt: at,
  payload: { shipmentId, invoiceId, amountUsd, accessorials },
});
const cancel = (id: string, at: string, shipmentId: string): FeedEvent => ({
  messageId: id, source: "OPS", type: "shipment.cancelled", occurredAt: at,
  payload: { shipmentId, reason: "customer cancelled" },
});
const customsHold = (id: string, at: string, shipmentId: string, reason = "CBP exam hold on entry"): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "customs.hold", occurredAt: at,
  payload: { shipmentId, at, reason },
});
const customsCleared = (id: string, at: string, shipmentId: string, entryNumber = "ENT-77104"): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "customs.cleared", occurredAt: at,
  payload: { shipmentId, at, entryNumber },
});
const rolled = (
  id: string, at: string, shipmentId: string, newEtd: string,
  fromVessel = "BG Neptune 24W", toVessel = "BG Atlas 25W", partner: PartnerRef = BGL
): FeedEvent => ({
  messageId: id, source: "PARTNER", type: "booking.rolled", occurredAt: at,
  payload: { shipmentId, at, partner, fromVessel, toVessel, newEtd },
});

/** Mirror the real caller: only events visible so far are passed in. */
function at(events: FeedEvent[], iso: string) {
  const visible = events.filter((e) => Date.parse(e.occurredAt) <= Date.parse(iso));
  return buildState(visible, new Date(iso));
}
const types = (s: ReturnType<typeof buildState>): Set<ExceptionType> =>
  new Set(s.exceptions.map((e) => e.type));

// A full clean shipment, tender → completed, everything on time and matching.
const CLEAN: FeedEvent[] = [
  tender("m1", D("06:00"), "AEQ-1"),
  assign("m2", D("06:10"), "AEQ-1", BAYOU, 1150),
  accept("m3", D("06:20"), "AEQ-1", BAYOU),
  pickup("m4", D("08:55"), "AEQ-1"),
  status("m5", D("11:00"), "AEQ-1"),
  delivery("m6", D("13:50"), "AEQ-1"),
  pod("m7", D("14:30"), "AEQ-1", "POD-1"),
  invoice("m8", D("17:00"), "AEQ-1", "INV-1", 1150),
];

// ── status transitions ───────────────────────────────────────────────────────

describe("status derivation", () => {
  it("is tendered after only the customer tender", () => {
    expect(at(CLEAN, D("06:05")).shipments["AEQ-1"].status).toBe("tendered");
  });
  it("is assigned after a partner is booked but before they answer", () => {
    expect(at(CLEAN, D("06:15")).shipments["AEQ-1"].status).toBe("assigned");
  });
  it("is booked once the partner accepts (990)", () => {
    expect(at(CLEAN, D("06:25")).shipments["AEQ-1"].status).toBe("booked");
  });
  it("is picked_up after pickup", () => {
    expect(at(CLEAN, D("09:10")).shipments["AEQ-1"].status).toBe("picked_up");
  });
  it("is delivered after delivery but before POD", () => {
    expect(at(CLEAN, D("13:55")).shipments["AEQ-1"].status).toBe("delivered");
  });
  it("is completed once delivered with a POD on file", () => {
    expect(at(CLEAN, D("14:35")).shipments["AEQ-1"].status).toBe("completed");
  });
  it("walks the full tendered → completed path with no exceptions", () => {
    const s = at(CLEAN, D("18:00"));
    expect(s.shipments["AEQ-1"].status).toBe("completed");
    expect(s.shipments["AEQ-1"].exceptionIds).toEqual([]);
    expect(s.exceptions).toHaveLength(0);
  });
  it("cancelled overrides every other status", () => {
    const s = at([...CLEAN, cancel("mc", D("06:30"), "AEQ-1")], D("18:00"));
    expect(s.shipments["AEQ-1"].status).toBe("cancelled");
  });
  it("records an Unknown-customer entity when events arrive with no tender", () => {
    const s = at([assign("m2", D("06:10"), "AEQ-9", BAYOU, 900)], D("06:15"));
    expect(s.shipments["AEQ-9"].customer).toBe("Unknown");
    expect(s.shipments["AEQ-9"].status).toBe("assigned");
  });
  it("defaults the mode to road until a tender says otherwise", () => {
    const s = at([assign("m2", D("06:10"), "AEQ-9", BAYOU, 900)], D("06:15"));
    expect(s.shipments["AEQ-9"].mode).toBe("road");
  });
  it("carries the tendered mode onto the entity", () => {
    const evs = [tender("m1", D("06:00"), "AEQ-9", { mode: "ocean", international: true })];
    expect(at(evs, D("06:05")).shipments["AEQ-9"].mode).toBe("ocean");
  });
  it("carries revenue and partner cost onto the entity", () => {
    const s = at(CLEAN, D("18:00"));
    expect(s.shipments["AEQ-1"].revenueUsd).toBe(1500);
    expect(s.shipments["AEQ-1"].partnerCostUsd).toBe(1150);
  });
});

// ── TENDER_UNANSWERED ────────────────────────────────────────────────────────

describe("TENDER_UNANSWERED", () => {
  const base = [
    tender("m1", D("06:00"), "AEQ-2"),
    assign("m2", D("08:00"), "AEQ-2", BAYOU, 1150),
  ];
  it("fires once the 30 min response window passes with no answer", () => {
    const s = at(base, D("08:31"));
    const ex = s.exceptions.find((e) => e.type === "TENDER_UNANSWERED");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("TENDER_UNANSWERED:AEQ-2");
    sameInstant(ex!.detectedAt, D("08:30"));
    expect(ex!.severity).toBe("warning");
    expect(ex!.estimatedImpactUsd).toBe(1500);
  });
  it("does not fire before the window expires", () => {
    expect(types(at(base, D("08:20"))).has("TENDER_UNANSWERED")).toBe(false);
  });
  it("does not fire when the partner accepted in time", () => {
    const s = at([...base, accept("m3", D("08:15"), "AEQ-2", BAYOU)], D("09:00"));
    expect(types(s).has("TENDER_UNANSWERED")).toBe(false);
  });
  it("clears once the partner finally accepts", () => {
    const evs = [...base, accept("m3", D("08:45"), "AEQ-2", BAYOU)];
    expect(types(at(evs, D("08:31"))).has("TENDER_UNANSWERED")).toBe(true);
    expect(types(at(evs, D("09:00"))).has("TENDER_UNANSWERED")).toBe(false);
  });
  it("judges the latest assignment after a decline and reassign", () => {
    const evs = [
      tender("m1", D("06:00"), "AEQ-2"),
      assign("m2", D("07:00"), "AEQ-2", BAYOU, 1150),
      decline("m3", D("07:10"), "AEQ-2", BAYOU),
      assign("m4", D("07:30"), "AEQ-2", SAMHOU, 1200),
    ];
    const s = at(evs, D("08:05"));
    const ex = s.exceptions.find((e) => e.type === "TENDER_UNANSWERED");
    expect(ex).toBeTruthy();
    // clock runs from the *latest* assignment (07:30), not the first.
    sameInstant(ex!.detectedAt, D("08:00"));
    expect(ex!.partnerName).toBe("Sam Houston Carriers");
  });
});

// ── PICKUP_MISSED ────────────────────────────────────────────────────────────

describe("PICKUP_MISSED", () => {
  const base = [
    tender("m1", D("06:00"), "AEQ-3", { pickupAppt: D("09:00") }),
    assign("m2", D("06:10"), "AEQ-3", BAYOU, 1150),
    accept("m3", D("06:20"), "AEQ-3", BAYOU),
  ];
  it("fires 30 min past the pickup appointment with no pickup", () => {
    const s = at(base, D("09:31"));
    const ex = s.exceptions.find((e) => e.type === "PICKUP_MISSED");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("PICKUP_MISSED:AEQ-3");
    sameInstant(ex!.detectedAt, D("09:30"));
    expect(ex!.severity).toBe("critical");
  });
  it("does not fire within the grace window", () => {
    expect(types(at(base, D("09:20"))).has("PICKUP_MISSED")).toBe(false);
  });
  it("does not fire when the pickup happened on time", () => {
    const s = at([...base, pickup("m4", D("09:05"), "AEQ-3")], D("10:00"));
    expect(types(s).has("PICKUP_MISSED")).toBe(false);
  });
  it("clears once a late pickup finally happens", () => {
    const evs = [...base, pickup("m4", D("11:00"), "AEQ-3")];
    expect(types(at(evs, D("09:31"))).has("PICKUP_MISSED")).toBe(true);
    expect(types(at(evs, D("11:30"))).has("PICKUP_MISSED")).toBe(false);
  });
});

// ── LATE_DELIVERY ────────────────────────────────────────────────────────────

describe("LATE_DELIVERY", () => {
  const upToPickup = [
    tender("m1", D("06:00"), "AEQ-4", { deliveryAppt: D("14:00") }),
    assign("m2", D("06:10"), "AEQ-4", BAYOU, 1150),
    accept("m3", D("06:20"), "AEQ-4", BAYOU),
    pickup("m4", D("08:55"), "AEQ-4"),
  ];
  it("fires in overdue form when the appointment passes with no delivery", () => {
    const s = at(upToPickup, D("14:16"));
    const ex = s.exceptions.find((e) => e.type === "LATE_DELIVERY");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("LATE_DELIVERY:AEQ-4");
    sameInstant(ex!.detectedAt, D("14:15"));
  });
  it("fires in permanent form when it delivers late", () => {
    const evs = [...upToPickup, delivery("m5", D("15:30"), "AEQ-4")];
    const s = at(evs, D("16:00"));
    const ex = s.exceptions.find((e) => e.type === "LATE_DELIVERY");
    expect(ex).toBeTruthy();
    expect(ex!.detectedAt).toBe(D("15:30"));
    expect(ex!.narrative).toContain("1 h 30 min");
  });
  it("does not fire when delivery is within the grace window", () => {
    const evs = [...upToPickup, delivery("m5", D("14:10"), "AEQ-4")];
    expect(types(at(evs, D("15:00"))).has("LATE_DELIVERY")).toBe(false);
  });
  it("keeps the same id across the overdue and delivered-late phases", () => {
    const evs = [...upToPickup, delivery("m5", D("15:30"), "AEQ-4")];
    const overdue = at(upToPickup, D("14:16")).exceptions.find((e) => e.type === "LATE_DELIVERY")!;
    const delivered = at(evs, D("16:00")).exceptions.find((e) => e.type === "LATE_DELIVERY")!;
    expect(overdue.id).toBe(delivered.id);
    expect(overdue.detectedAt).not.toBe(delivered.detectedAt);
  });
});

// ── TRACKING_BLACKOUT ────────────────────────────────────────────────────────

describe("TRACKING_BLACKOUT", () => {
  const base = [
    tender("m1", D("06:00"), "AEQ-5", { deliveryAppt: D("20:00") }),
    assign("m2", D("06:10"), "AEQ-5", BAYOU, 1150),
    accept("m3", D("06:20"), "AEQ-5", BAYOU),
    pickup("m4", D("09:00"), "AEQ-5"),
    status("m5", D("10:00"), "AEQ-5", "San Antonio, TX"),
  ];
  it("fires when a road partner goes quiet for more than 3 hours", () => {
    const s = at(base, D("13:30"));
    const ex = s.exceptions.find((e) => e.type === "TRACKING_BLACKOUT");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("TRACKING_BLACKOUT:AEQ-5");
    sameInstant(ex!.detectedAt, D("13:00"));
    expect(ex!.estimatedImpactUsd).toBeUndefined();
  });
  it("does not fire while pings are recent", () => {
    expect(types(at(base, D("12:30"))).has("TRACKING_BLACKOUT")).toBe(false);
  });
  it("clears once the shipment delivers", () => {
    const evs = [...base, delivery("m6", D("14:00"), "AEQ-5")];
    expect(types(at(evs, D("15:00"))).has("TRACKING_BLACKOUT")).toBe(false);
  });
});

// ── mode-aware TRACKING_BLACKOUT ─────────────────────────────────────────────

describe("mode-aware TRACKING_BLACKOUT", () => {
  const oceanBase = [
    tender("m1", D("06:00"), "AEQ-9", { mode: "ocean", international: true, deliveryAppt: D3("20:00"), equipment: "40' FCL container" }),
    assign("m2", D("06:10"), "AEQ-9", BGL, 4200),
    accept("m3", D("06:20"), "AEQ-9", BGL),
    pickup("m4", D("09:00"), "AEQ-9", "Bayport Container Terminal"),
    status("m5", D("10:00"), "AEQ-9", "Bayport"),
  ];
  it("does not fire for an ocean shipment inside the 24 h window", () => {
    // Three hours quiet would trip a truck, but a vessel gets 24 hours.
    expect(types(at(oceanBase, D("13:30"))).has("TRACKING_BLACKOUT")).toBe(false);
  });
  it("fires for an ocean shipment once it is quiet past 24 h", () => {
    const s = at(oceanBase, D2("11:00"));
    const ex = s.exceptions.find((e) => e.type === "TRACKING_BLACKOUT");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("TRACKING_BLACKOUT:AEQ-9");
    // last ping 10:00 on day one, plus the 24 h ocean window.
    sameInstant(ex!.detectedAt, D2("10:00"));
  });
  it("counts a customs hold as partner contact", () => {
    const evs = [...oceanBase, customsHold("m6", D2("09:00"), "AEQ-9")];
    // Last contact is now the hold at 09:00 on day two, so only 2 h have passed.
    expect(types(at(evs, D2("11:00"))).has("TRACKING_BLACKOUT")).toBe(false);
  });
  it("counts a booking roll as partner contact", () => {
    const evs = [...oceanBase, rolled("m6", D2("09:00"), "AEQ-9", D3("06:00"))];
    expect(types(at(evs, D2("11:00"))).has("TRACKING_BLACKOUT")).toBe(false);
  });
});

// ── POD_MISSING ──────────────────────────────────────────────────────────────

describe("POD_MISSING", () => {
  const base = [
    tender("m1", D("06:00"), "AEQ-6"),
    assign("m2", D("06:10"), "AEQ-6", BAYOU, 1150),
    accept("m3", D("06:20"), "AEQ-6", BAYOU),
    pickup("m4", D("08:55"), "AEQ-6"),
    delivery("m5", D("12:00"), "AEQ-6"),
  ];
  it("fires 4 hours after delivery with no POD", () => {
    const s = at(base, D("16:01"));
    const ex = s.exceptions.find((e) => e.type === "POD_MISSING");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("POD_MISSING:AEQ-6");
    sameInstant(ex!.detectedAt, D("16:00"));
    expect(ex!.slaTag).toBe("billing blocked");
  });
  it("does not fire when the POD is on file", () => {
    const s = at([...base, pod("m6", D("13:00"), "AEQ-6")], D("18:00"));
    expect(types(s).has("POD_MISSING")).toBe(false);
  });
});

// ── INVOICE_MISMATCH ─────────────────────────────────────────────────────────

describe("INVOICE_MISMATCH", () => {
  const done = [
    tender("m1", D("06:00"), "AEQ-7"),
    assign("m2", D("06:10"), "AEQ-7", BAYOU, 1150),
    accept("m3", D("06:20"), "AEQ-7", BAYOU),
    pickup("m4", D("08:55"), "AEQ-7"),
    delivery("m5", D("13:50"), "AEQ-7"),
    pod("m6", D("14:30"), "AEQ-7", "POD-7"),
  ];
  it("fires when billed over the agreed rate beyond tolerance", () => {
    const evs = [...done, invoice("m7", D("16:30"), "AEQ-7", "INV-7", 1395, [
      { desc: "Detention 2 hr", amountUsd: 120 },
      { desc: "Fuel surcharge adj", amountUsd: 125 },
    ])];
    const s = at(evs, D("17:00"));
    const ex = s.exceptions.find((e) => e.type === "INVOICE_MISMATCH");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("INVOICE_MISMATCH:AEQ-7:INV-7");
    expect(ex!.detectedAt).toBe(D("16:30"));
    expect(ex!.estimatedImpactUsd).toBe(245);
    expect(ex!.narrative).toContain("Detention");
  });
  it("does not fire when the invoice matches the agreed rate", () => {
    const evs = [...done, invoice("m7", D("16:30"), "AEQ-7", "INV-7", 1150)];
    expect(types(at(evs, D("17:00"))).has("INVOICE_MISMATCH")).toBe(false);
  });
  it("does not fire for an overage within tolerance", () => {
    const evs = [...done, invoice("m7", D("16:30"), "AEQ-7", "INV-7", 1170)];
    expect(types(at(evs, D("17:00"))).has("INVOICE_MISMATCH")).toBe(false);
  });
});

// ── CUSTOMS_HOLD ─────────────────────────────────────────────────────────────

describe("CUSTOMS_HOLD", () => {
  const oceanToYard = [
    tender("m1", D("06:15"), "AEQ-9", { mode: "ocean", international: true, deliveryAppt: D2("14:00"), equipment: "40' FCL container" }),
    assign("m2", D("06:45"), "AEQ-9", BGL, 4200),
    accept("m3", D("06:50"), "AEQ-9", BGL),
    pickup("m4", D("09:00"), "AEQ-9", "Bayport Container Terminal"),
    status("m5", D("09:40"), "AEQ-9", "Bayport"),
  ];
  it("fires when a hold is on the entry with no clear", () => {
    const evs = [...oceanToYard, customsHold("m6", D("10:00"), "AEQ-9")];
    const s = at(evs, D("12:00"));
    const ex = s.exceptions.find((e) => e.type === "CUSTOMS_HOLD");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("CUSTOMS_HOLD:AEQ-9");
    expect(ex!.severity).toBe("critical");
    sameInstant(ex!.detectedAt, D("10:00"));
    expect(ex!.estimatedImpactUsd).toBe(850);
    expect(ex!.slaTag).toBe("clearance blocked");
  });
  it("resolves once the entry clears", () => {
    const evs = [
      ...oceanToYard,
      customsHold("m6", D("10:00"), "AEQ-9"),
      customsCleared("m7", D("15:00"), "AEQ-9"),
    ];
    expect(types(at(evs, D("12:00"))).has("CUSTOMS_HOLD")).toBe(true);
    expect(types(at(evs, D("16:00"))).has("CUSTOMS_HOLD")).toBe(false);
  });
});

// ── BOOKING_ROLLED ───────────────────────────────────────────────────────────

describe("BOOKING_ROLLED", () => {
  const oceanMoving = (deliveryAppt: string) => [
    tender("m1", D("07:00"), "AEQ-9", { mode: "ocean", international: true, deliveryAppt, equipment: "40' FCL container" }),
    assign("m2", D("07:30"), "AEQ-9", BGL, 5000),
    accept("m3", D("07:35"), "AEQ-9", BGL),
    pickup("m4", D("11:00"), "AEQ-9", "Barbours Cut Terminal"),
  ];
  it("fires critical when the new ETD lands after the promised delivery", () => {
    const evs = [...oceanMoving(D3("14:00")), rolled("m5", D("14:00"), "AEQ-9", D3("18:00"))];
    const s = at(evs, D("15:00"));
    const ex = s.exceptions.find((e) => e.type === "BOOKING_ROLLED");
    expect(ex).toBeTruthy();
    expect(ex!.id).toBe("BOOKING_ROLLED:AEQ-9");
    expect(ex!.severity).toBe("critical");
    sameInstant(ex!.detectedAt, D("14:00"));
    expect(ex!.estimatedImpactUsd).toBe(1200);
    expect(ex!.slaTag).toBe("schedule slip");
  });
  it("fires only a warning when the new ETD still fits the promise", () => {
    const evs = [...oceanMoving("2026-07-30T14:00:00Z"), rolled("m5", D("14:00"), "AEQ-9", D3("06:00"))];
    const s = at(evs, D("15:00"));
    const ex = s.exceptions.find((e) => e.type === "BOOKING_ROLLED");
    expect(ex).toBeTruthy();
    expect(ex!.severity).toBe("warning");
  });
  it("persists once the roll is on record", () => {
    const evs = [...oceanMoving(D3("14:00")), rolled("m5", D("14:00"), "AEQ-9", D3("18:00"))];
    expect(types(at(evs, D("14:30"))).has("BOOKING_ROLLED")).toBe(true);
    expect(types(at(evs, D("19:00"))).has("BOOKING_ROLLED")).toBe(true);
  });
});

// ── DUPLICATE_EVENT ──────────────────────────────────────────────────────────

describe("DUPLICATE_EVENT", () => {
  it("flags a repeated messageId once, at info severity", () => {
    const evs = [
      tender("OPS-000012", D("06:30"), "AEQ-8"),
      tender("OPS-000012", D("06:31"), "AEQ-8"),
      assign("m2", D("06:45"), "AEQ-8", BAYOU, 1150),
    ];
    const s = at(evs, D("07:00"));
    const dups = s.exceptions.filter((e) => e.type === "DUPLICATE_EVENT");
    expect(dups).toHaveLength(1);
    expect(dups[0].id).toBe("DUPLICATE_EVENT:OPS-000012");
    expect(dups[0].severity).toBe("info");
    expect(dups[0].detectedAt).toBe(D("06:31"));
  });
});

// ── frequency tags ───────────────────────────────────────────────────────────

describe("frequency tags", () => {
  it("stamps every exception with the frequency from the pattern history", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    expect(s.exceptions.length).toBeGreaterThan(0);
    for (const e of s.exceptions) {
      expect(e.frequency).toBe(frequencyOf(e.type));
      expect(e.timesSeenBefore).toBe(ISSUE_HISTORY[e.type]);
    }
  });
  it("labels a recurring pattern common and a never-seen one new", () => {
    expect(frequencyOf("TENDER_UNANSWERED")).toBe("common");
    expect(frequencyOf("INVOICE_MISMATCH")).toBe("uncommon");
    expect(frequencyOf("TRACKING_BLACKOUT")).toBe("new");
  });
});

// ── determinism & stability ──────────────────────────────────────────────────

describe("determinism", () => {
  it("produces identical exception ids on repeated recomputes", () => {
    const a = at(SCENARIO_EVENTS, SCENARIO_END).exceptions.map((e) => e.id);
    const b = at(SCENARIO_EVENTS, SCENARIO_END).exceptions.map((e) => e.id);
    expect(a).toEqual(b);
  });
  it("keeps a stable id for a persistent exception across sim times", () => {
    const evs = [
      tender("m1", D("06:00"), "AEQ-7"),
      assign("m2", D("06:10"), "AEQ-7", BAYOU, 1150),
      accept("m3", D("06:20"), "AEQ-7", BAYOU),
      pickup("m4", D("08:55"), "AEQ-7"),
      delivery("m5", D("13:50"), "AEQ-7"),
      pod("m6", D("14:30"), "AEQ-7", "POD-7"),
      invoice("m7", D("16:30"), "AEQ-7", "INV-7", 1395),
    ];
    const early = at(evs, D("16:31")).exceptions.find((e) => e.type === "INVOICE_MISMATCH")!;
    const late = at(evs, D("19:00")).exceptions.find((e) => e.type === "INVOICE_MISMATCH")!;
    expect(early.id).toBe(late.id);
  });
  it("sorts events by occurredAt even when handed them out of order", () => {
    const s = buildState([...CLEAN].reverse(), new Date(D("18:00")));
    const stamps = s.events.map((e) => e.occurredAt);
    expect(stamps).toEqual([...stamps].sort());
    expect(s.shipments["AEQ-1"].status).toBe("completed");
  });
  it("orders exceptions newest detectedAt first", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    for (let i = 1; i < s.exceptions.length; i++) {
      expect(Date.parse(s.exceptions[i - 1].detectedAt))
        .toBeGreaterThanOrEqual(Date.parse(s.exceptions[i].detectedAt));
    }
  });
});

// ── integration over the seeded day ──────────────────────────────────────────

describe("scenario integration", () => {
  it("surfaces all nine exception types at end of day", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    const present = types(s);
    for (const t of [
      "TENDER_UNANSWERED",
      "PICKUP_MISSED",
      "TRACKING_BLACKOUT",
      "LATE_DELIVERY",
      "POD_MISSING",
      "INVOICE_MISMATCH",
      "DUPLICATE_EVENT",
      "CUSTOMS_HOLD",
      "BOOKING_ROLLED",
    ] as ExceptionType[]) {
      expect(present.has(t)).toBe(true);
    }
  });
  it("opens exactly the expected exception ids at end of day", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    const ids = new Set(s.exceptions.map((e) => e.id));
    expect(ids).toEqual(
      new Set([
        "TENDER_UNANSWERED:AEQ-7303",
        "PICKUP_MISSED:AEQ-7302",
        "TRACKING_BLACKOUT:AEQ-7308",
        "LATE_DELIVERY:AEQ-7302",
        "LATE_DELIVERY:AEQ-7309",
        "POD_MISSING:AEQ-7311",
        "INVOICE_MISMATCH:AEQ-7305:INV-88412",
        "CUSTOMS_HOLD:AEQ-7319",
        "BOOKING_ROLLED:AEQ-7320",
        "DUPLICATE_EVENT:OPS-000012",
      ])
    );
  });
  it("lands the clean shipments at completed with no exceptions", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    for (const id of ["AEQ-7301", "AEQ-7304", "AEQ-7307", "AEQ-7310", "AEQ-7312", "AEQ-7313", "AEQ-7314", "AEQ-7318"]) {
      expect(s.shipments[id].status).toBe("completed");
      expect(s.shipments[id].exceptionIds).toEqual([]);
    }
  });
  it("chains the missed pickup on AEQ-7302 into an overdue late delivery", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    const ids = s.shipments["AEQ-7302"].exceptionIds;
    expect(ids).toContain("PICKUP_MISSED:AEQ-7302");
    expect(ids).toContain("LATE_DELIVERY:AEQ-7302");
  });
  it("holds AEQ-7308 in a tracking blackout, still picked_up and undelivered", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    expect(s.shipments["AEQ-7308"].status).toBe("picked_up");
    expect(s.shipments["AEQ-7308"].exceptionIds).toContain("TRACKING_BLACKOUT:AEQ-7308");
  });
  it("has no info-only noise on the invoice mismatch shipment beyond the mismatch", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    expect(s.shipments["AEQ-7305"].exceptionIds).toEqual(["INVOICE_MISMATCH:AEQ-7305:INV-88412"]);
  });
  it("holds AEQ-7319 on a critical customs hold, still picked_up", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    expect(s.shipments["AEQ-7319"].status).toBe("picked_up");
    expect(s.shipments["AEQ-7319"].exceptionIds).toEqual(["CUSTOMS_HOLD:AEQ-7319"]);
    const ex = s.exceptions.find((e) => e.id === "CUSTOMS_HOLD:AEQ-7319")!;
    expect(ex.severity).toBe("critical");
  });
  it("flags AEQ-7320 as a critical rolled booking", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    expect(s.shipments["AEQ-7320"].exceptionIds).toEqual(["BOOKING_ROLLED:AEQ-7320"]);
    const ex = s.exceptions.find((e) => e.id === "BOOKING_ROLLED:AEQ-7320")!;
    expect(ex.severity).toBe("critical");
  });
  it("flags exactly one duplicate message on the day", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    const dups = s.exceptions.filter((e) => e.type === "DUPLICATE_EVENT");
    expect(dups).toHaveLength(1);
    expect(dups[0].id).toBe("DUPLICATE_EVENT:OPS-000012");
  });
  it("covers 20 shipments in the seeded day", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    expect(Object.keys(s.shipments)).toHaveLength(20);
  });
});

// ── connected apps ───────────────────────────────────────────────────────────

describe("connectors", () => {
  it("derives one connector per app, in a fixed order", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    expect(s.connectors.map((c) => c.app)).toEqual([
      "truckstop",
      "quickbooks",
      "ace",
      "airline",
      "oceanline",
      "email",
    ]);
  });

  it("attributes each message to the app it arrived through", () => {
    const evs = [
      tender("m1", D("08:00"), "AEQ-1"), // email
      assign("m2", D("08:10"), "AEQ-1", BAYOU, 1000), // road → truckstop
      tender("m3", D("08:00"), "AEQ-2", { mode: "ocean", international: true }),
      status("m4", D("09:00"), "AEQ-2"), // ocean → oceanline
      customsHold("m5", D("10:00"), "AEQ-2"), // ace
      invoice("m6", D("11:00"), "AEQ-1", "INV-1", 1000), // quickbooks
      tender("m7", D("08:00"), "AEQ-3", { mode: "air" }),
      pickup("m8", D("09:30"), "AEQ-3"), // air → airline
    ];
    const s = at(evs, D("12:00"));
    const by = Object.fromEntries(s.connectors.map((c) => [c.app, c]));
    expect(by.email.eventsToday).toBe(3);
    expect(by.truckstop.eventsToday).toBe(1);
    expect(by.oceanline.eventsToday).toBe(1);
    expect(by.ace.eventsToday).toBe(1);
    expect(by.quickbooks.eventsToday).toBe(1);
    expect(by.airline.eventsToday).toBe(1);
    sameInstant(by.quickbooks.lastEventAt!, D("11:00"));
  });

  it("marks a feed slow while degraded, then keeps the incident after recovery", () => {
    const s1 = at(SCENARIO_EVENTS, D("10:00"));
    const tsSlow = s1.connectors.find((c) => c.app === "truckstop")!;
    expect(tsSlow.status).toBe("slow");
    expect(tsSlow.note).toBe("Status feed running behind");

    const s2 = at(SCENARIO_EVENTS, SCENARIO_END);
    const ts = s2.connectors.find((c) => c.app === "truckstop")!;
    expect(ts.status).toBe("connected");
    expect(ts.note).toBeUndefined();
    sameInstant(ts.incident!.from, D("09:40"));
    sameInstant(ts.incident!.to, D("10:10"));
  });

  it("flags a dying login as needing attention", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    const qb = s.connectors.find((c) => c.app === "quickbooks")!;
    expect(qb.status).toBe("attention");
    sameInstant(qb.authExpiresAt!, "2026-07-23T08:15:00Z");
  });

  it("does not attach connector messages to any shipment", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    for (const o of Object.values(s.shipments)) {
      for (const e of o.events) {
        expect(e.type.startsWith("connector.")).toBe(false);
      }
    }
  });

  it("stamps the app on invoice mismatch evidence", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    const ex = s.exceptions.find(
      (e) => e.id === "INVOICE_MISMATCH:AEQ-7305:INV-88412"
    )!;
    const agreed = ex.evidence.find((v) => v.label === "Agreed rate")!;
    const billed = ex.evidence.find((v) => v.label.startsWith("Invoice"))!;
    expect(agreed.via).toBe("truckstop");
    expect(billed.via).toBe("quickbooks");
  });

  it("stamps ACE on customs hold evidence", () => {
    const s = at(SCENARIO_EVENTS, SCENARIO_END);
    const ex = s.exceptions.find((e) => e.id === "CUSTOMS_HOLD:AEQ-7319")!;
    const hold = ex.evidence.find((v) => v.label === "Hold placed")!;
    expect(hold.via).toBe("ace");
  });
});
