import type {
  FeedEvent,
  EventType,
  ExceptionType,
  SourceSystem,
  Severity,
  ShipmentStatus,
  Stop,
  ShipmentEntity,
  TransportMode,
  PartnerRef,
} from "@/lib/types";

// ── Sim-clock formatting (all in the scenario's own UTC frame) ───────────────
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** "Sun Jul 20 · 09:42" */
export function formatClock(d: Date): string {
  return `${WD[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}`;
}

/** "09:42" */
export function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Sim-relative elapsed time, e.g. "12m ago", "1h 4m ago", "just now". */
export function relativeSim(fromISO: string, nowMs: number): string {
  const diff = nowMs - Date.parse(fromISO);
  if (diff < 45_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

/** "$1,470", whole dollars. */
export function money(n: number | undefined): string {
  if (n == null) return "Not set";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Compact large counts unchanged; here just tabular integers. */
export function int(n: number): string {
  return n.toLocaleString("en-US");
}

/** "$5.3k" above a thousand, "$830" below, rounded for quick reading. */
export function compactMoney(n: number | undefined): string {
  if (n == null) return "Not set";
  if (n >= 1000) {
    const k = n / 1000;
    return `$${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return `$${Math.round(n / 10) * 10}`;
}

// ── Document-type labels (the EDI analog shown as mono chips) ─────────────────
// Road rides 204/990/214/210. Air milestones ride the same events on an AWB,
// ocean rides booking and B/L, customs events mirror CBP entry messages.
const DOC: Record<EventType, string> = {
  "shipment.tendered": "204",
  "shipment.assigned": "204",
  "shipment.cancelled": "204",
  "tender.accepted": "990",
  "tender.declined": "990",
  "pickup.completed": "214",
  "status.update": "214",
  "delivery.completed": "214",
  "pod.filed": "POD",
  "invoice.submitted": "210",
  "customs.hold": "CBP",
  "customs.cleared": "CBP",
  "booking.rolled": "B/L",
  "connector.degraded": "SYS",
  "connector.restored": "SYS",
  "connector.auth_expiring": "SYS",
};

export function docType(t: EventType): string {
  return DOC[t];
}

// ── Mode-aware milestone labels ──────────────────────────────────────────────
/** What "picked up" reads as for each mode. */
export function pickupMilestoneLabel(mode: TransportMode): string {
  return mode === "air"
    ? "Tendered to the airline"
    : mode === "ocean"
    ? "Gated in at the port"
    : "Picked up";
}

/** What "delivered" reads as for each mode. */
export function deliveryMilestoneLabel(mode: TransportMode): string {
  return mode === "air"
    ? "Recovered at destination"
    : mode === "ocean"
    ? "Container delivered"
    : "Delivered";
}

/**
 * Short verb for a feed event, used in ledgers and rails. Pass the shipment
 * mode so pickup and delivery read right for road, air, and ocean.
 */
export function eventVerb(t: EventType, mode: TransportMode = "road"): string {
  switch (t) {
    case "shipment.tendered":
      return "Shipment tendered";
    case "shipment.assigned":
      return "Partner booked";
    case "shipment.cancelled":
      return "Shipment cancelled";
    case "tender.accepted":
      return "Partner accepted";
    case "tender.declined":
      return "Partner declined";
    case "pickup.completed":
      return pickupMilestoneLabel(mode);
    case "status.update":
      return "Status update";
    case "delivery.completed":
      return deliveryMilestoneLabel(mode);
    case "pod.filed":
      return "POD filed";
    case "invoice.submitted":
      return "Invoice received";
    case "customs.hold":
      return "Customs hold";
    case "customs.cleared":
      return "Customs cleared";
    case "booking.rolled":
      return "Booking rolled";
    case "connector.degraded":
      return "Feed running behind";
    case "connector.restored":
      return "Feed caught up";
    case "connector.auth_expiring":
      return "Login expiring";
  }
}

// ── Exception type labels ────────────────────────────────────────────────────
/** Plain-language name for each issue type, shown wherever a type is named. */
export const EXCEPTION_TYPE_LABEL: Record<ExceptionType, string> = {
  TENDER_UNANSWERED: "Tender unanswered",
  PICKUP_MISSED: "Pickup missed",
  TRACKING_BLACKOUT: "Tracking blackout",
  LATE_DELIVERY: "Late delivery",
  POD_MISSING: "POD missing",
  INVOICE_MISMATCH: "Invoice mismatch",
  DUPLICATE_EVENT: "Duplicate event",
  CUSTOMS_HOLD: "Customs hold",
  BOOKING_ROLLED: "Booking rolled",
};

export function exceptionTypeLabel(t: ExceptionType): string {
  return EXCEPTION_TYPE_LABEL[t];
}

// ── Color helpers ────────────────────────────────────────────────────────────
export function systemColor(s: SourceSystem): string {
  return s === "OPS" ? "var(--color-ops)" : "var(--color-partner)";
}

/** Short mono label for a source chip. */
export function systemShort(s: SourceSystem): string {
  return s === "OPS" ? "OPS" : "PTR";
}

/** Full name for a source, as read on chips and headers. */
export function systemLabel(s: SourceSystem): string {
  return s === "OPS" ? "Aequus Ops" : "Partner network";
}

/** Translucent wash of a color, for chips/edges where no -soft token exists. */
export function softBg(c: string, pct = 12): string {
  return `color-mix(in oklab, ${c} ${pct}%, transparent)`;
}

export function severityColor(s: Severity): string {
  return s === "critical"
    ? "var(--color-critical)"
    : s === "warning"
    ? "var(--color-warning)"
    : "var(--color-muted-foreground)";
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/** Plain-language severity, used everywhere a human reads it. */
export const SEVERITY_WORD: Record<Severity, string> = {
  critical: "Urgent",
  warning: "Needs a look",
  info: "FYI",
};

// ── Transport mode presentation ──────────────────────────────────────────────
/** Mode hue token, for tinting the mode badge and journey ribbon. */
export function modeColor(mode: TransportMode): string {
  return mode === "air"
    ? "var(--mode-air)"
    : mode === "ocean"
    ? "var(--mode-ocean)"
    : "var(--mode-road)";
}

const MODE_LABEL: Record<TransportMode, string> = {
  road: "Road",
  air: "Air",
  ocean: "Ocean",
};

export function modeLabel(mode: TransportMode): string {
  return MODE_LABEL[mode];
}

/** Is this an international shipment, from customs events or the tender flag? */
export function isInternational(shipment: ShipmentEntity): boolean {
  return !!(
    shipment.customsHold ||
    shipment.customsCleared ||
    shipment.tender?.international
  );
}

// ── Status presentation ──────────────────────────────────────────────────────
const STATUS_LABEL: Record<ShipmentStatus, string> = {
  tendered: "Tendered",
  assigned: "Waiting on partner",
  booked: "Booked",
  picked_up: "In transit",
  delivered: "Delivered",
  completed: "Done",
  cancelled: "Cancelled",
};

export function statusLabel(s: ShipmentStatus): string {
  return STATUS_LABEL[s];
}

// ── Lane presentation ────────────────────────────────────────────────────────
/** "Houston, TX" */
export function stopLabel(stop: Stop | undefined): string {
  if (!stop) return "Not set";
  return `${stop.city}, ${stop.state}`;
}

/** "Houston, TX → Corpus Christi, TX" built from the tender stops. */
export function laneOf(shipment: ShipmentEntity): string {
  const t = shipment.tender;
  if (!t) return "Lane not set";
  return `${stopLabel(t.origin)} → ${stopLabel(t.destination)}`;
}

/** A stable one-line summary of a feed event, for the shipment rail. */
export function summarize(ev: FeedEvent): string {
  const p = ev.payload as unknown as Record<string, unknown>;
  switch (ev.type) {
    case "shipment.tendered": {
      const origin = p.origin as Stop | undefined;
      const destination = p.destination as Stop | undefined;
      const rate = p.customerRateUsd as number | undefined;
      return `${stopLabel(origin)} → ${stopLabel(destination)} · pays ${money(
        rate
      )}`;
    }
    case "shipment.assigned": {
      const partner = p.partner as { name?: string } | undefined;
      const rate = p.partnerRateUsd as number | undefined;
      return `${partner?.name ?? "Partner"} · gets ${money(rate)}`;
    }
    case "shipment.cancelled": {
      const reason = p.reason as string | undefined;
      return reason ? `Cancelled: ${reason}` : "Shipment cancelled";
    }
    case "tender.accepted": {
      const partner = p.partner as { name?: string } | undefined;
      return `${partner?.name ?? "Partner"} said yes`;
    }
    case "tender.declined": {
      const partner = p.partner as { name?: string } | undefined;
      return `${partner?.name ?? "Partner"} said no`;
    }
    case "pickup.completed": {
      const loc = p.location as string | undefined;
      return loc ? `Picked up in ${loc}` : "Picked up";
    }
    case "status.update": {
      const loc = p.location as string | undefined;
      const note = p.note as string | undefined;
      if (loc && note) return `${loc} · ${note}`;
      return note ?? (loc ? `Near ${loc}` : "Status update");
    }
    case "delivery.completed": {
      const loc = p.location as string | undefined;
      return loc ? `Delivered in ${loc}` : "Delivered";
    }
    case "pod.filed": {
      const docId = p.docId as string | undefined;
      return docId ? `${docId} on file` : "Proof of delivery on file";
    }
    case "invoice.submitted": {
      const amt = p.amountUsd as number | undefined;
      return `Billed ${money(amt)}`;
    }
    case "customs.hold": {
      const reason = p.reason as string | undefined;
      return reason ? `Hold: ${reason}` : "Customs put a hold on the entry";
    }
    case "customs.cleared": {
      const entry = p.entryNumber as string | undefined;
      return entry ? `Cleared on entry ${entry}` : "Customs cleared the entry";
    }
    case "booking.rolled": {
      const from = p.fromVessel as string | undefined;
      const to = p.toVessel as string | undefined;
      const etd = p.newEtd as string | undefined;
      const roll =
        from && to ? `Rolled ${from} to ${to}` : "Booking rolled to a new vessel";
      return etd ? `${roll} · new ETD ${formatTime(etd)}` : roll;
    }
    case "connector.degraded": {
      const note = p.note as string | undefined;
      return note ?? "Feed running behind";
    }
    case "connector.restored":
      return "Feed caught up";
    case "connector.auth_expiring": {
      const note = p.note as string | undefined;
      return note ?? "Login token expiring soon";
    }
  }
}

/** Primary shipment id a feed event references, if any. */
export function eventShipmentId(ev: FeedEvent): string | undefined {
  const p = ev.payload as unknown as Record<string, unknown>;
  return (p.shipmentId as string) ?? undefined;
}

/** Partner code (MC, SCAC, or IATA) shown next to a partner name, if any. */
export function partnerCode(ref: PartnerRef | undefined): string | undefined {
  return ref?.code;
}

// ── time scope ──────────────────────────────────────────────────────────────

/**
 * How far back the dashboard looks from the current sim clock. Scoping is a
 * view filter only. Nothing is deleted, widening the scope brings it back.
 */
export type TimeScope = "day" | "4h" | "1h";

export const TIME_SCOPES: {
  key: TimeScope;
  label: string;
  /** Lookback window; undefined means the whole day. */
  hours?: number;
}[] = [
  { key: "day", label: "Full day" },
  { key: "4h", label: "Last 4 hours", hours: 4 },
  { key: "1h", label: "Last hour", hours: 1 },
];

/** Earliest timestamp (ms) still inside the scope, given the sim clock. */
export function scopeStartMs(scope: TimeScope, simTime: number): number {
  const def = TIME_SCOPES.find((s) => s.key === scope);
  return def?.hours ? simTime - def.hours * 3_600_000 : -Infinity;
}
