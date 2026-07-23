/**
 * Transpira freight reconciliation engine.
 *
 * `buildState(events, simTime)` is a pure, deterministic function. It stitches
 * OPS (Aequus's TMS) and PARTNER (the network's event feeds) messages into one
 * shipment graph and surfaces every gap that is detectable as of `simTime`.
 *
 * There is no clock read, no randomness, no I/O. The same inputs always produce
 * the same output, so the UI can safely recompute it on every playback tick.
 * The caller passes only the events visible so far (occurredAt <= simTime); SLA
 * windows are judged against `simTime`.
 */

import {
  PartnerRef,
  BookingRolledPayload,
  ConnectorEntity,
  ConnectorStatusPayload,
  CustomsClearedPayload,
  CustomsHoldPayload,
  DeliveryCompletedPayload,
  Evidence,
  ExceptionRecord,
  FeedEvent,
  GraphState,
  InvoiceSubmittedPayload,
  ShipmentAssignedPayload,
  ShipmentCancelledPayload,
  ShipmentEntity,
  ShipmentStatus,
  ShipmentTenderedPayload,
  PickupCompletedPayload,
  PodFiledPayload,
  ISSUE_HISTORY,
  SLA,
  StatusUpdatePayload,
  SourceApp,
  TenderResponsePayload,
  frequencyOf,
} from "./types";
import { SOURCE_APPS, appOf, modeApp } from "./sources";

/** What a detector produces; the engine stamps the frequency fields on push. */
type ExceptionDraft = Omit<ExceptionRecord, "frequency" | "timesSeenBefore">;

// ── small time helpers ──────────────────────────────────────────────────────

const ms = (iso: string): number => new Date(iso).getTime();
const addMinutes = (iso: string, minutes: number): string =>
  new Date(ms(iso) + minutes * 60_000).toISOString();
const addHours = (iso: string, hours: number): string =>
  addMinutes(iso, hours * 60);

const round = (n: number): number => Math.round(n);

/** Compact UTC time, e.g. "09:00Z". */
function shortTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}Z`;
}

/** Whole-dollar amount with thousands separators, e.g. "$1,150". */
function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const whole = Math.abs(round(n)).toString();
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${withCommas}`;
}

/** Human gap between two ISO times, e.g. "45 min" or "1 h 30 min". */
function humanGap(fromIso: string, toIso: string): string {
  const mins = Math.max(0, Math.round((ms(toIso) - ms(fromIso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ── narrow payload accessors ─────────────────────────────────────────────────

const asTender = (e: FeedEvent) => e.payload as ShipmentTenderedPayload;
const asAssigned = (e: FeedEvent) => e.payload as ShipmentAssignedPayload;
const asCancel = (e: FeedEvent) => e.payload as ShipmentCancelledPayload;
const asResponse = (e: FeedEvent) => e.payload as TenderResponsePayload;
const asPickup = (e: FeedEvent) => e.payload as PickupCompletedPayload;
const asStatus = (e: FeedEvent) => e.payload as StatusUpdatePayload;
const asDelivery = (e: FeedEvent) => e.payload as DeliveryCompletedPayload;
const asPod = (e: FeedEvent) => e.payload as PodFiledPayload;
const asInvoice = (e: FeedEvent) => e.payload as InvoiceSubmittedPayload;
const asCustomsHold = (e: FeedEvent) => e.payload as CustomsHoldPayload;
const asCustomsCleared = (e: FeedEvent) => e.payload as CustomsClearedPayload;
const asRolled = (e: FeedEvent) => e.payload as BookingRolledPayload;

/** Best-effort shipmentId off any payload that carries one. */
function shipmentIdOfEvent(e: FeedEvent): string | undefined {
  return (e.payload as { shipmentId?: string }).shipmentId;
}

// ── internal per-shipment bookkeeping (not exposed) ──────────────────────────

interface ShipmentCtx {
  entity: ShipmentEntity;
  /** Latest shipment.assigned event time (drives the tender clock). */
  latestAssignAt?: string;
  latestPartner?: PartnerRef;
  /** occurredAt of each invoice, keyed by invoiceId (for detectedAt). */
  invoiceAt: Map<string, string>;
  /** Partners that answered (accepted or declined), by partner code. */
  answeredCodes: Set<string>;
}

// ── main ─────────────────────────────────────────────────────────────────────

export function buildState(events: FeedEvent[], simTime: Date): GraphState {
  const simIso = simTime.toISOString();
  const now = ms(simIso);

  // Defensive, stable sort by occurredAt (ties keep original order).
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const d = ms(a.e.occurredAt) - ms(b.e.occurredAt);
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.e);

  const ctx: Record<string, ShipmentCtx> = {};
  const exceptions: ExceptionRecord[] = [];

  // Duplicate detection runs on the raw stream, before per-shipment routing.
  const seenMessageIds = new Map<string, FeedEvent>();
  const duplicateEvents: { first: FeedEvent; repeat: FeedEvent }[] = [];

  const ensure = (shipmentId: string, customer?: string): ShipmentCtx => {
    let c = ctx[shipmentId];
    if (!c) {
      c = {
        entity: {
          shipmentId,
          customer: customer ?? "Unknown",
          status: "tendered",
          mode: "road",
          statusUpdates: [],
          invoices: [],
          events: [],
          exceptionIds: [],
          revenueUsd: 0,
          partnerCostUsd: 0,
        },
        invoiceAt: new Map(),
        answeredCodes: new Set(),
      };
      ctx[shipmentId] = c;
    }
    if (customer && c.entity.customer === "Unknown") c.entity.customer = customer;
    return c;
  };

  // ── pass 1: ingest ─────────────────────────────────────────────────────────
  for (const e of sorted) {
    const prior = seenMessageIds.get(e.messageId);
    if (prior) {
      duplicateEvents.push({ first: prior, repeat: e });
      continue; // process the first, flag the repeat
    }
    seenMessageIds.set(e.messageId, e);

    const shipmentId = shipmentIdOfEvent(e);
    if (!shipmentId) continue;

    switch (e.type) {
      case "shipment.tendered": {
        const p = asTender(e);
        const c = ensure(shipmentId, p.customer);
        c.entity.tender = p;
        c.entity.customer = p.customer;
        c.entity.mode = p.mode;
        c.entity.revenueUsd = p.customerRateUsd;
        c.entity.events.push(e);
        break;
      }
      case "shipment.assigned": {
        const p = asAssigned(e);
        const c = ensure(shipmentId);
        c.entity.assignment = p; // latest wins (stream is sorted)
        c.entity.partnerCostUsd = p.partnerRateUsd;
        c.latestAssignAt = e.occurredAt;
        c.latestPartner = p.partner;
        c.entity.events.push(e);
        break;
      }
      case "shipment.cancelled": {
        const p = asCancel(e);
        const c = ensure(shipmentId);
        c.entity.cancelled = p;
        c.entity.events.push(e);
        break;
      }
      case "tender.accepted": {
        const p = asResponse(e);
        const c = ensure(shipmentId);
        c.entity.accepted = p;
        c.answeredCodes.add(p.partner.code);
        c.entity.events.push(e);
        break;
      }
      case "tender.declined": {
        const p = asResponse(e);
        const c = ensure(shipmentId);
        (c.entity.declined ??= []).push(p);
        c.answeredCodes.add(p.partner.code);
        c.entity.events.push(e);
        break;
      }
      case "pickup.completed": {
        const p = asPickup(e);
        const c = ensure(shipmentId);
        c.entity.pickup = p;
        c.entity.events.push(e);
        break;
      }
      case "status.update": {
        const p = asStatus(e);
        const c = ensure(shipmentId);
        c.entity.statusUpdates.push(p);
        c.entity.events.push(e);
        break;
      }
      case "delivery.completed": {
        const p = asDelivery(e);
        const c = ensure(shipmentId);
        c.entity.delivery = p;
        c.entity.events.push(e);
        break;
      }
      case "pod.filed": {
        const p = asPod(e);
        const c = ensure(shipmentId);
        c.entity.pod = p;
        c.entity.events.push(e);
        break;
      }
      case "invoice.submitted": {
        const p = asInvoice(e);
        const c = ensure(shipmentId);
        c.entity.invoices.push(p);
        if (!c.invoiceAt.has(p.invoiceId)) c.invoiceAt.set(p.invoiceId, e.occurredAt);
        c.entity.events.push(e);
        break;
      }
      case "customs.hold": {
        const p = asCustomsHold(e);
        const c = ensure(shipmentId);
        c.entity.customsHold = p;
        c.entity.events.push(e);
        break;
      }
      case "customs.cleared": {
        const p = asCustomsCleared(e);
        const c = ensure(shipmentId);
        c.entity.customsCleared = p; // clears the hold; nothing else changes
        c.entity.events.push(e);
        break;
      }
      case "booking.rolled": {
        const p = asRolled(e);
        const c = ensure(shipmentId);
        c.entity.rolled = p;
        c.entity.events.push(e);
        break;
      }
    }
  }

  // ── keep each timeline ordered, derive status ────────────────────────────────
  const shipments: Record<string, ShipmentEntity> = {};
  for (const c of Object.values(ctx)) {
    c.entity.events.sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt));
    c.entity.status = deriveStatus(c.entity);
    shipments[c.entity.shipmentId] = c.entity;
  }

  // ── pass 2: exceptions ──────────────────────────────────────────────────────
  // Detectors describe the gap; the frequency tag is stamped here from the
  // client's pattern history so every issue carries it.
  const push = (draft: ExceptionDraft) => {
    const rec: ExceptionRecord = {
      ...draft,
      frequency: frequencyOf(draft.type),
      timesSeenBefore: ISSUE_HISTORY[draft.type] ?? 0,
    };
    exceptions.push(rec);
    const o = rec.shipmentId ? shipments[rec.shipmentId] : undefined;
    if (o && !o.exceptionIds.includes(rec.id)) o.exceptionIds.push(rec.id);
  };

  for (const c of Object.values(ctx)) {
    detectTenderUnanswered(c, now, push);
    detectPickupMissed(c, now, push);
    detectTrackingBlackout(c, now, push);
    detectLateDelivery(c, now, push);
    detectPodMissing(c, now, push);
    detectInvoiceMismatch(c, push);
    detectCustomsHold(c, push);
    detectBookingRolled(c, push);
  }
  detectDuplicateEvents(duplicateEvents, push);

  // Newest detectedAt first, stable id tiebreak for determinism.
  exceptions.sort((a, b) => {
    const d = ms(b.detectedAt) - ms(a.detectedAt);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  const connectors = deriveConnectors(sorted, shipments);

  return { simTime: simIso, events: sorted, shipments, exceptions, connectors };
}

// ── connected apps ───────────────────────────────────────────────────────────

/**
 * Health of each connected app, derived from the same stream. Every shipment
 * message counts toward the app it arrived through; connector status messages
 * flip an app to slow, back to connected, or to needing a login renewal.
 */
function deriveConnectors(
  events: FeedEvent[],
  shipments: Record<string, ShipmentEntity>
): ConnectorEntity[] {
  const by = new Map<SourceApp, ConnectorEntity>(
    SOURCE_APPS.map((a) => [
      a.key,
      { app: a.key, status: "connected" as const, eventsToday: 0 },
    ])
  );
  const openSince = new Map<SourceApp, { from: string; note: string }>();

  for (const e of events) {
    if (
      e.type === "connector.degraded" ||
      e.type === "connector.restored" ||
      e.type === "connector.auth_expiring"
    ) {
      const p = e.payload as ConnectorStatusPayload;
      const c = by.get(p.app);
      if (!c) continue;
      if (e.type === "connector.degraded") {
        openSince.set(p.app, {
          from: p.at,
          note: p.note ?? "Feed running behind",
        });
        c.status = "slow";
        c.note = p.note ?? "Feed running behind";
      } else if (e.type === "connector.restored") {
        const open = openSince.get(p.app);
        if (open) {
          c.incident = { from: open.from, to: p.at, note: open.note };
          openSince.delete(p.app);
        }
        c.note = undefined;
        c.status = c.authExpiresAt ? "attention" : "connected";
      } else {
        c.authExpiresAt = p.expiresAt;
        if (c.status === "connected") c.status = "attention";
      }
      continue;
    }

    const shipmentId = shipmentIdOfEvent(e);
    const mode = shipmentId ? shipments[shipmentId]?.mode ?? "road" : "road";
    const app = appOf(e.type, mode);
    if (!app) continue;
    const c = by.get(app)!;
    c.eventsToday += 1;
    if (!c.lastEventAt || ms(e.occurredAt) > ms(c.lastEventAt))
      c.lastEventAt = e.occurredAt;
  }

  return SOURCE_APPS.map((a) => by.get(a.key)!);
}

// ── status derivation ────────────────────────────────────────────────────────

function deriveStatus(o: ShipmentEntity): ShipmentStatus {
  if (o.cancelled) return "cancelled";
  if (o.delivery && o.pod) return "completed";
  if (o.delivery) return "delivered";
  if (o.pickup) return "picked_up";
  if (o.accepted) return "booked";
  if (o.assignment) return "assigned";
  return "tendered";
}

// ── shared evidence bits ─────────────────────────────────────────────────────

function partnerName(c: ShipmentCtx): string | undefined {
  return c.latestPartner?.name ?? c.entity.assignment?.partner.name;
}

/**
 * Latest partner contact time. Any partner-side event counts: pickup, a status
 * update, or a customs or booking message. A vessel that just posted a customs
 * hold is not in a blackout.
 */
function lastPartnerPing(o: ShipmentEntity): { at: string; where: string } | undefined {
  let best: { at: string; where: string } | undefined;
  const consider = (at: string, where: string) => {
    if (!best || ms(at) > ms(best.at)) best = { at, where };
  };
  if (o.pickup) consider(o.pickup.at, o.pickup.location);
  for (const s of o.statusUpdates) consider(s.at, s.location);
  if (o.customsHold) consider(o.customsHold.at, "customs hold");
  if (o.customsCleared) consider(o.customsCleared.at, "customs cleared");
  if (o.rolled) consider(o.rolled.at, `rolled to ${o.rolled.toVessel}`);
  return best;
}

// ── TENDER_UNANSWERED (warning) ──────────────────────────────────────────────

function detectTenderUnanswered(
  c: ShipmentCtx,
  now: number,
  push: (r: ExceptionDraft) => void
) {
  const o = c.entity;
  if (o.cancelled || o.pickup || o.delivery) return;
  if (!o.assignment || !c.latestAssignAt || !c.latestPartner) return;

  // Resolved once the currently-assigned partner has answered either way.
  if (c.answeredCodes.has(c.latestPartner.code)) return;

  const deadline = addMinutes(c.latestAssignAt, SLA.tenderResponseMinutes);
  if (now < ms(deadline)) return;

  const partner = c.latestPartner.name;
  const cust = o.customer;
  const waited = humanGap(c.latestAssignAt, new Date(now).toISOString());
  push({
    id: `TENDER_UNANSWERED:${o.shipmentId}`,
    type: "TENDER_UNANSWERED",
    severity: "warning",
    detectedAt: deadline,
    shipmentId: o.shipmentId,
    partnerName: partner,
    title: `No answer from partner on ${o.shipmentId}`,
    narrative:
      `Aequus tendered ${o.shipmentId} to ${partner} for ${cust}, but ${partner} still has not said yes or no ` +
      `after ${waited}. The limit is ${SLA.tenderResponseMinutes} min. Until a partner accepts, nobody is ` +
      `committed to move this shipment, so the pickup is at risk.`,
    evidence: [
      { source: "OPS", label: "Tendered to partner", value: shortTime(c.latestAssignAt), via: modeApp(o.mode) },
      { source: "PARTNER", label: "Accept or decline", value: "none yet", via: modeApp(o.mode) },
      { source: "OPS", label: "Response SLA", value: `${SLA.tenderResponseMinutes} min` },
    ],
    estimatedImpactUsd: round(o.revenueUsd),
    slaTag: "coverage risk",
  });
}

// ── PICKUP_MISSED (critical) ─────────────────────────────────────────────────

function detectPickupMissed(
  c: ShipmentCtx,
  now: number,
  push: (r: ExceptionDraft) => void
) {
  const o = c.entity;
  if (o.cancelled || o.pickup) return;
  if (!o.tender) return;

  const deadline = addMinutes(o.tender.pickupAppt, SLA.pickupGraceMinutes);
  if (now <= ms(deadline)) return;

  const partner = partnerName(c) ?? "the assigned partner";
  const late = humanGap(o.tender.pickupAppt, new Date(now).toISOString());
  push({
    id: `PICKUP_MISSED:${o.shipmentId}`,
    type: "PICKUP_MISSED",
    severity: "critical",
    detectedAt: deadline,
    shipmentId: o.shipmentId,
    partnerName: partnerName(c),
    title: `Pickup missed on ${o.shipmentId}`,
    narrative:
      `${partner} was supposed to pick up ${o.shipmentId} for ${o.customer} at ` +
      `${shortTime(o.tender.pickupAppt)}, but there is still no pickup ${late} later. The freight is sitting ` +
      `at the dock. If this shipment delivers late, it hits the on-time score that Aequus is graded on.`,
    evidence: [
      { source: "OPS", label: "Pickup appt", value: shortTime(o.tender.pickupAppt), via: "email" },
      { source: "PARTNER", label: "Picked up", value: "none yet", via: modeApp(o.mode) },
      { source: "OPS", label: "Grace window", value: `${SLA.pickupGraceMinutes} min` },
    ],
    estimatedImpactUsd: round(o.revenueUsd),
    slaTag: "on-time scorecard",
  });
}

// ── TRACKING_BLACKOUT (warning) ──────────────────────────────────────────────

function detectTrackingBlackout(
  c: ShipmentCtx,
  now: number,
  push: (r: ExceptionDraft) => void
) {
  const o = c.entity;
  if (o.cancelled || !o.pickup || o.delivery) return;

  const ping = lastPartnerPing(o);
  if (!ping) return;

  // The window depends on how the freight moves. A truck should check in every
  // few hours; a vessel does not, so ocean gets a much wider window.
  const limitHours = SLA.trackingBlackoutHoursByMode[o.mode];
  const deadline = addHours(ping.at, limitHours);
  if (now < ms(deadline)) return;

  const partner = partnerName(c) ?? "the partner";
  const quiet = humanGap(ping.at, new Date(now).toISOString());
  push({
    id: `TRACKING_BLACKOUT:${o.shipmentId}`,
    type: "TRACKING_BLACKOUT",
    severity: "warning",
    detectedAt: deadline,
    shipmentId: o.shipmentId,
    partnerName: partnerName(c),
    title: `Partner went quiet on ${o.shipmentId}`,
    narrative:
      `${partner} picked up ${o.shipmentId} for ${o.customer} and then went silent. The last update was from ` +
      `${ping.where} at ${shortTime(ping.at)}, which is ${quiet} ago. The limit is ` +
      `${limitHours} hours. Right now Aequus cannot tell the customer where the freight is.`,
    evidence: [
      { source: "PARTNER", label: "Last ping", value: `${shortTime(ping.at)} (${ping.where})`, via: modeApp(o.mode) },
      { source: "PARTNER", label: "Newer update", value: "none yet", via: modeApp(o.mode) },
      { source: "OPS", label: "Blackout limit", value: `${limitHours} h` },
    ],
    slaTag: "customer visibility",
  });
}

// ── LATE_DELIVERY (critical) ─────────────────────────────────────────────────

function detectLateDelivery(
  c: ShipmentCtx,
  now: number,
  push: (r: ExceptionDraft) => void
) {
  const o = c.entity;
  if (o.cancelled || !o.tender) return;

  const appt = o.tender.deliveryAppt;
  const deadline = addMinutes(appt, SLA.deliveryGraceMinutes);
  const partner = partnerName(c) ?? "the partner";
  const id = `LATE_DELIVERY:${o.shipmentId}`;

  if (o.delivery) {
    // Permanent form: it delivered, and it delivered late.
    if (ms(o.delivery.at) <= ms(deadline)) return;
    const late = humanGap(appt, o.delivery.at);
    push({
      id,
      type: "LATE_DELIVERY",
      severity: "critical",
      detectedAt: o.delivery.at,
      shipmentId: o.shipmentId,
      partnerName: partnerName(c),
      title: `Late delivery on ${o.shipmentId}`,
      narrative:
        `${partner} delivered ${o.shipmentId} for ${o.customer} at ${shortTime(o.delivery.at)}, but the ` +
        `appointment was ${shortTime(appt)}. That is ${late} late. A late delivery counts against the ` +
        `on-time score that Aequus is graded on by the customer.`,
      evidence: [
        { source: "OPS", label: "Delivery appt", value: shortTime(appt), via: "email" },
        { source: "PARTNER", label: "Delivered", value: shortTime(o.delivery.at), via: modeApp(o.mode) },
        { source: "OPS", label: "Late by", value: late },
      ],
      estimatedImpactUsd: round(o.revenueUsd),
      slaTag: "on-time scorecard",
    });
    return;
  }

  // Overdue form: no delivery yet and the appointment has passed.
  if (now <= ms(deadline)) return;
  const over = humanGap(appt, new Date(now).toISOString());
  push({
    id,
    type: "LATE_DELIVERY",
    severity: "critical",
    detectedAt: deadline,
    shipmentId: o.shipmentId,
    partnerName: partnerName(c),
    title: `Late delivery on ${o.shipmentId}`,
    narrative:
      `${o.shipmentId} for ${o.customer} was due to deliver at ${shortTime(appt)}, but it is now ${over} past ` +
      `that and there is still no delivery. This shipment is going to miss its appointment. A late delivery ` +
      `counts against the on-time score that Aequus is graded on.`,
    evidence: [
      { source: "OPS", label: "Delivery appt", value: shortTime(appt), via: "email" },
      { source: "PARTNER", label: "Delivered", value: "none yet", via: modeApp(o.mode) },
      { source: "OPS", label: "Overdue by", value: over },
    ],
    estimatedImpactUsd: round(o.revenueUsd),
    slaTag: "on-time scorecard",
  });
}

// ── POD_MISSING (warning) ────────────────────────────────────────────────────

function detectPodMissing(
  c: ShipmentCtx,
  now: number,
  push: (r: ExceptionDraft) => void
) {
  const o = c.entity;
  if (o.cancelled || !o.delivery || o.pod) return;

  const deadline = addHours(o.delivery.at, SLA.podHours);
  if (now < ms(deadline)) return;

  const partner = partnerName(c) ?? "the partner";
  const since = humanGap(o.delivery.at, new Date(now).toISOString());
  push({
    id: `POD_MISSING:${o.shipmentId}`,
    type: "POD_MISSING",
    severity: "warning",
    detectedAt: deadline,
    shipmentId: o.shipmentId,
    partnerName: partnerName(c),
    title: `No POD for ${o.shipmentId}`,
    narrative:
      `${partner} delivered ${o.shipmentId} for ${o.customer} at ${shortTime(o.delivery.at)}, which was ${since} ` +
      `ago, but the proof of delivery is still not on file. The limit is ${SLA.podHours} hours. Aequus ` +
      `cannot bill ${o.customer} for this shipment until the POD comes in.`,
    evidence: [
      { source: "PARTNER", label: "Delivered", value: shortTime(o.delivery.at), via: modeApp(o.mode) },
      { source: "PARTNER", label: "POD on file", value: "no record", via: "email" },
      { source: "OPS", label: "POD SLA", value: `${SLA.podHours} h` },
    ],
    estimatedImpactUsd: round(o.revenueUsd),
    slaTag: "billing blocked",
  });
}

// ── INVOICE_MISMATCH (critical) ──────────────────────────────────────────────

function detectInvoiceMismatch(c: ShipmentCtx, push: (r: ExceptionDraft) => void) {
  const o = c.entity;
  if (!o.assignment || o.partnerCostUsd <= 0) return;

  for (const inv of o.invoices) {
    const overage = inv.amountUsd - o.partnerCostUsd;
    if (overage <= SLA.invoiceToleranceUsd) continue;

    const partner = partnerName(c) ?? "the partner";
    const accText = (inv.accessorials ?? [])
      .map((a) => `${a.desc} ${usd(a.amountUsd)}`)
      .join(", ");
    const accSentence = accText
      ? `The extra charges are ${accText}, and those were never agreed. `
      : "";
    push({
      id: `INVOICE_MISMATCH:${o.shipmentId}:${inv.invoiceId}`,
      type: "INVOICE_MISMATCH",
      severity: "critical",
      detectedAt: c.invoiceAt.get(inv.invoiceId) ?? o.delivery?.at ?? o.tender?.pickupAppt ?? "",
      shipmentId: o.shipmentId,
      partnerName: partnerName(c),
      title: `Invoice too high on ${o.shipmentId}`,
      narrative:
        `${partner} billed ${usd(inv.amountUsd)} on ${o.shipmentId} for ${o.customer}, but the agreed rate was ` +
        `${usd(o.partnerCostUsd)}. That is ${usd(overage)} over. ${accSentence}` +
        `If Aequus pays this, the extra ${usd(overage)} comes straight out of the margin on this shipment.`,
      evidence: [
        { source: "OPS", label: "Agreed rate", value: usd(o.partnerCostUsd), via: modeApp(o.mode) },
        { source: "PARTNER", label: `Invoice ${inv.invoiceId}`, value: usd(inv.amountUsd), via: "quickbooks" },
        ...(accText
          ? [{ source: "PARTNER" as const, label: "Accessorials", value: accText, via: "quickbooks" as const }]
          : []),
        { source: "OPS", label: "Over agreed by", value: usd(overage) },
      ],
      estimatedImpactUsd: round(overage),
      slaTag: "margin",
    });
  }
}

// ── CUSTOMS_HOLD (critical) ──────────────────────────────────────────────────

function detectCustomsHold(c: ShipmentCtx, push: (r: ExceptionDraft) => void) {
  const o = c.entity;
  if (!o.customsHold || o.customsCleared) return;

  const hold = o.customsHold;
  const appt = o.tender?.deliveryAppt;
  push({
    id: `CUSTOMS_HOLD:${o.shipmentId}`,
    type: "CUSTOMS_HOLD",
    severity: "critical",
    detectedAt: hold.at,
    shipmentId: o.shipmentId,
    partnerName: partnerName(c),
    title: `Customs hold on ${o.shipmentId}`,
    narrative:
      `Customs put a hold on ${o.shipmentId} for ${o.customer}. The reason on the entry is ${hold.reason}. ` +
      `Storage charges start after today. Nothing moves until the hold clears, and Aequus cannot promise a ` +
      `delivery date while it is on.`,
    evidence: [
      { source: "OPS", label: "Promised delivery", value: appt ? shortTime(appt) : "not set", via: "email" },
      { source: "OPS", label: "Customer", value: o.customer },
      { source: "PARTNER", label: "Hold placed", value: shortTime(hold.at), via: "ace" },
      { source: "PARTNER", label: "Reason", value: hold.reason, via: "ace" },
    ],
    estimatedImpactUsd: 850,
    slaTag: "clearance blocked",
  });
}

// ── BOOKING_ROLLED (critical or warning) ─────────────────────────────────────

function detectBookingRolled(c: ShipmentCtx, push: (r: ExceptionDraft) => void) {
  const o = c.entity;
  if (!o.rolled) return;

  const rolled = o.rolled;
  const appt = o.tender?.deliveryAppt;
  // Critical only when the new sailing lands the box after the promised date.
  const late = appt ? ms(rolled.newEtd) > ms(appt) : false;
  const partner = rolled.partner.name;
  push({
    id: `BOOKING_ROLLED:${o.shipmentId}`,
    type: "BOOKING_ROLLED",
    severity: late ? "critical" : "warning",
    detectedAt: rolled.at,
    shipmentId: o.shipmentId,
    partnerName: partner,
    title: `Rolled booking on ${o.shipmentId}`,
    narrative:
      `${partner} rolled ${o.shipmentId} for ${o.customer} off ${rolled.fromVessel} and onto ` +
      `${rolled.toVessel}. The new sailing leaves at ${shortTime(rolled.newEtd)}. ` +
      (late
        ? `That is past the delivery date Aequus promised, so the customer date is at risk.`
        : `The new date still fits the promise, but the schedule has slipped and needs a look.`),
    evidence: [
      { source: "OPS", label: "Booked vessel", value: rolled.fromVessel, via: "oceanline" },
      { source: "OPS", label: "Promised delivery", value: appt ? shortTime(appt) : "not set", via: "email" },
      { source: "PARTNER", label: "Rolled to vessel", value: rolled.toVessel, via: "oceanline" },
      { source: "PARTNER", label: "New ETD", value: shortTime(rolled.newEtd), via: "oceanline" },
    ],
    estimatedImpactUsd: 1200,
    slaTag: "schedule slip",
  });
}

// ── DUPLICATE_EVENT (info) ───────────────────────────────────────────────────

function detectDuplicateEvents(
  duplicateEvents: { first: FeedEvent; repeat: FeedEvent }[],
  push: (r: ExceptionDraft) => void
) {
  for (const { first, repeat } of duplicateEvents) {
    const shipmentId = shipmentIdOfEvent(repeat);
    push({
      id: `DUPLICATE_EVENT:${repeat.messageId}`,
      type: "DUPLICATE_EVENT",
      severity: "info",
      detectedAt: repeat.occurredAt,
      shipmentId,
      title: `Duplicate message ${repeat.messageId}`,
      narrative:
        `Message ${repeat.messageId} (${repeat.type}) came in twice, first at ${shortTime(first.occurredAt)} ` +
        `and again at ${shortTime(repeat.occurredAt)}. The system used the first one and ignored the repeat. ` +
        `It is still worth flagging, because a shipment that gets read twice can be worked twice by mistake.`,
      evidence: [
        { source: first.source, label: "First seen", value: shortTime(first.occurredAt) },
        { source: repeat.source, label: "Sent again", value: shortTime(repeat.occurredAt) },
      ],
      slaTag: "data quality",
    });
  }
}
