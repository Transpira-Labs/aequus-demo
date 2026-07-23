/**
 * Core data contract for the Transpira freight demo, targeted at Aequus.
 *
 * Aequus Worldwide Logistics coordinates shipments between customers (oil and
 * gas, chemicals, healthcare, automotive, and more) and a network of outside
 * partners: motor carriers, airlines, ocean lines, and customs. The gap that
 * costs them money is the space between what Aequus Ops promised and what the
 * partner network actually did. Everything this demo ingests is a `FeedEvent`,
 * a JSON message whose semantics mirror the messages freight actually runs on.
 *
 * Road freight rides EDI:
 *
 *   shipment.tendered   ~ EDI 204  (customer tender, into Aequus Ops)
 *   shipment.assigned   ~ EDI 204 out (Aequus Ops tenders to a network partner)
 *   shipment.cancelled  ~ 204 cancel
 *   tender.accepted     ~ EDI 990  (partner says yes)
 *   tender.declined     ~ EDI 990  (partner says no)
 *   pickup.completed    ~ EDI 214  (partner picked up the freight)
 *   status.update       ~ EDI 214  (in-transit check call / ping)
 *   delivery.completed  ~ EDI 214  (partner delivered)
 *   pod.filed           (proof of delivery document on file)
 *   invoice.submitted   ~ EDI 210  (partner freight invoice)
 *
 * Air milestones ride the same events, keyed on the air waybill (AWB). Ocean
 * rides the same events, keyed on the booking and bill of lading (B/L). Customs
 * events mirror CBP entry status messages:
 *
 *   customs.hold        (CBP put a hold on the entry)
 *   customs.cleared     (CBP released the entry)
 *   booking.rolled      (the ocean line rolled the container to a later sailing)
 *
 * See INPUT_FORMAT.md for the full schema documentation.
 */

export type SourceSystem = "OPS" | "PARTNER";

/**
 * The outside tool a message arrived through. Aequus runs its day across many
 * apps: Truckstop for road freight, QuickBooks for the money, ACE for customs
 * entries, partner portals for air and ocean, and plain email. The platform
 * connects to each one, and every message is attributed to the app it came
 * through, so every fact on screen can say where it came from.
 */
export type SourceApp =
  | "truckstop"
  | "quickbooks"
  | "ace"
  | "airline"
  | "oceanline"
  | "email";

/** How the freight moves. Drives labels, tracking windows, and customs events. */
export type TransportMode = "road" | "air" | "ocean";

export type EventType =
  | "shipment.tendered"
  | "shipment.assigned"
  | "shipment.cancelled"
  | "tender.accepted"
  | "tender.declined"
  | "pickup.completed"
  | "status.update"
  | "delivery.completed"
  | "pod.filed"
  | "invoice.submitted"
  | "customs.hold"
  | "customs.cleared"
  | "booking.rolled"
  | "connector.degraded"
  | "connector.restored"
  | "connector.auth_expiring";

export interface Stop {
  name: string; // e.g. "Bayport Container Terminal"
  city: string;
  state: string;
}

export interface PartnerRef {
  name: string; // e.g. "Bayou City Freight"
  code: string; // MC number, SCAC, or IATA code, e.g. "MC-771204"
}

/** ~ EDI 204 in: a customer gives Aequus a shipment to move. */
export interface ShipmentTenderedPayload {
  shipmentId: string; // e.g. "AEQ-7319"
  customer: string; // e.g. "Gulf Coast Polymers"
  origin: Stop;
  destination: Stop;
  pickupAppt: string; // ISO datetime the pickup is scheduled for
  deliveryAppt: string; // ISO datetime the delivery is scheduled for
  mode: TransportMode; // road, air, or ocean
  international?: boolean; // true when the shipment crosses a border
  equipment: string; // e.g. "53' dry van", "air freight, 2 pallets", "40' FCL container"
  weightLbs: number;
  customerRateUsd: number; // what the customer pays Aequus
  refNumber?: string; // customer PO / contract reference
}

/** Aequus Ops books a network partner on the shipment at an agreed rate. */
export interface ShipmentAssignedPayload {
  shipmentId: string;
  partner: PartnerRef;
  partnerRateUsd: number; // what Aequus agreed to pay the partner
}

export interface ShipmentCancelledPayload {
  shipmentId: string;
  reason?: string;
}

/** ~ EDI 990: the partner answers the tender. */
export interface TenderResponsePayload {
  shipmentId: string;
  partner: PartnerRef;
}

/** ~ EDI 214 events from the partner side. */
export interface PickupCompletedPayload {
  shipmentId: string;
  at: string; // ISO datetime the pickup actually happened
  location: string; // e.g. "Houston, TX"
}

export interface StatusUpdatePayload {
  shipmentId: string;
  at: string;
  location: string;
  note?: string; // e.g. "Rolling on I-45 N"
}

export interface DeliveryCompletedPayload {
  shipmentId: string;
  at: string; // ISO datetime the delivery actually happened
  location: string;
  receivedBy?: string;
}

/** Proof of delivery document landed. Required before Aequus can bill. */
export interface PodFiledPayload {
  shipmentId: string;
  docId: string; // e.g. "POD-7319"
}

/** ~ EDI 210: the partner bills Aequus for the shipment. */
export interface InvoiceSubmittedPayload {
  shipmentId: string;
  invoiceId: string; // e.g. "INV-88412"
  amountUsd: number; // total billed
  accessorials?: { desc: string; amountUsd: number }[]; // extras like detention
}

/** CBP put a hold on the entry. Nothing moves until it clears. */
export interface CustomsHoldPayload {
  shipmentId: string;
  at: string; // ISO datetime the hold went on the entry
  reason: string; // e.g. "CBP exam hold on entry"
}

/** CBP released the entry. */
export interface CustomsClearedPayload {
  shipmentId: string;
  at: string; // ISO datetime the entry cleared
  entryNumber?: string; // customs entry number
}

/** The ocean line rolled the container to a later sailing. */
export interface BookingRolledPayload {
  shipmentId: string;
  at: string; // ISO datetime the roll was confirmed
  partner: PartnerRef;
  fromVessel: string; // e.g. "BG Neptune 24W"
  toVessel: string; // e.g. "BG Atlas 25W"
  newEtd: string; // ISO datetime the new sailing departs
}

/**
 * A status message about one of the connected apps, from the platform's own
 * sync layer. Not tied to any shipment.
 */
export interface ConnectorStatusPayload {
  app: SourceApp;
  at: string; // ISO datetime
  note?: string; // e.g. "Status feed running behind"
  expiresAt?: string; // for auth_expiring: when the login token dies
}

export type EventPayload =
  | ShipmentTenderedPayload
  | ShipmentAssignedPayload
  | ShipmentCancelledPayload
  | TenderResponsePayload
  | PickupCompletedPayload
  | StatusUpdatePayload
  | DeliveryCompletedPayload
  | PodFiledPayload
  | InvoiceSubmittedPayload
  | CustomsHoldPayload
  | CustomsClearedPayload
  | BookingRolledPayload
  | ConnectorStatusPayload;

/** The envelope every message arrives in, regardless of source system. */
export interface FeedEvent {
  messageId: string; // unique per transmission; repeats are flagged
  source: SourceSystem;
  type: EventType;
  occurredAt: string; // ISO datetime
  payload: EventPayload;
}

// ── Reconciliation output ───────────────────────────────────────────────────

export type ExceptionType =
  | "TENDER_UNANSWERED" // partner never answered the tender in time
  | "PICKUP_MISSED" // pickup appointment passed with no pickup
  | "TRACKING_BLACKOUT" // picked up, then went quiet mid-route
  | "LATE_DELIVERY" // delivered after the appointment, or overdue now
  | "POD_MISSING" // delivered but no proof of delivery on file
  | "INVOICE_MISMATCH" // partner billed more than the agreed rate
  | "DUPLICATE_EVENT" // same message transmitted twice
  | "CUSTOMS_HOLD" // CBP put a hold on the entry, nothing moves
  | "BOOKING_ROLLED"; // the ocean line rolled the container to a later sailing

export type Severity = "critical" | "warning" | "info";

/**
 * How often this pattern has come up for this operation before. "common" and
 * "uncommon" mean the layer recognizes the pattern from the client's own
 * history; "new" means general monitoring caught something it has not seen
 * before. Shown on every issue so an ops planner can tell a routine catch from
 * a genuine surprise.
 */
export type IssueFrequency = "common" | "uncommon" | "new";

/** One side-by-side fact used to justify an exception. */
export interface Evidence {
  source: SourceSystem;
  label: string; // e.g. "Agreed rate"
  value: string; // e.g. "$1,850"
  /** The app the fact was read from, e.g. QuickBooks. Shown under the value. */
  via?: SourceApp;
}

export interface ExceptionRecord {
  id: string; // stable across recomputes, e.g. "PICKUP_MISSED:AEQ-7302"
  type: ExceptionType;
  severity: Severity;
  frequency: IssueFrequency;
  /** How many times this pattern came up last quarter, before today. */
  timesSeenBefore: number;
  detectedAt: string; // sim-clock ISO datetime when this became detectable
  shipmentId?: string;
  partnerName?: string;
  title: string; // short, e.g. "Pickup missed on AEQ-7302"
  narrative: string; // plain English, short sentences, no jargon
  evidence: Evidence[];
  estimatedImpactUsd?: number;
  slaTag?: string; // e.g. "on-time scorecard", "margin", "billing blocked"
}

// ── Entity graph ────────────────────────────────────────────────────────────

export type ShipmentStatus =
  | "tendered" // customer gave us the shipment, no partner booked yet
  | "assigned" // partner tendered, waiting on their answer
  | "booked" // partner accepted
  | "picked_up" // freight is moving
  | "delivered" // freight arrived
  | "completed" // delivered with POD on file
  | "cancelled";

/** Everything the layer knows about one shipment, stitched across both sides. */
export interface ShipmentEntity {
  shipmentId: string;
  customer: string;
  status: ShipmentStatus;
  mode: TransportMode; // "road" until a tender says otherwise
  tender?: ShipmentTenderedPayload;
  assignment?: ShipmentAssignedPayload;
  accepted?: TenderResponsePayload;
  declined?: TenderResponsePayload[];
  pickup?: PickupCompletedPayload;
  statusUpdates: StatusUpdatePayload[];
  delivery?: DeliveryCompletedPayload;
  pod?: PodFiledPayload;
  invoices: InvoiceSubmittedPayload[];
  cancelled?: ShipmentCancelledPayload;
  customsHold?: CustomsHoldPayload;
  customsCleared?: CustomsClearedPayload;
  rolled?: BookingRolledPayload;
  events: FeedEvent[]; // the cross-system timeline, in occurredAt order
  exceptionIds: string[];
  revenueUsd: number; // customer rate on the tender
  partnerCostUsd: number; // agreed partner rate, 0 until assigned
}

/** How a connected app is doing right now. */
export type ConnectorStatus = "connected" | "slow" | "attention";

/**
 * One connected outside system, derived from the feed like everything else.
 * "slow" means the feed is running behind right now. "attention" means the
 * login token is about to die and someone should renew it.
 */
export interface ConnectorEntity {
  app: SourceApp;
  status: ConnectorStatus;
  lastEventAt?: string; // newest message that arrived through this app
  eventsToday: number;
  /** Set while the feed is degraded, e.g. "Status feed running behind". */
  note?: string;
  /** Set when the app's login token is about to die. */
  authExpiresAt?: string;
  /** A degraded window that already recovered, kept for the panel. */
  incident?: { from: string; to: string; note: string };
}

/** The full reconciled state at a moment in (simulated) time. */
export interface GraphState {
  simTime: string; // ISO datetime the state was computed at
  events: FeedEvent[]; // everything ingested so far, occurredAt order
  shipments: Record<string, ShipmentEntity>;
  exceptions: ExceptionRecord[]; // newest first
  connectors: ConnectorEntity[]; // one per connected app, fixed order
}

// ── Issue pattern history ───────────────────────────────────────────────────

/**
 * How many times each issue pattern came up last quarter. In production this
 * comes from the client's own history; the demo ships a plausible quarter for
 * Aequus. Drives the frequency tag stamped on every detected issue.
 */
export const ISSUE_HISTORY: Record<ExceptionType, number> = {
  TENDER_UNANSWERED: 12,
  DUPLICATE_EVENT: 10,
  POD_MISSING: 8,
  LATE_DELIVERY: 6,
  CUSTOMS_HOLD: 5,
  BOOKING_ROLLED: 4,
  PICKUP_MISSED: 3,
  INVOICE_MISMATCH: 2,
  TRACKING_BLACKOUT: 0,
};

/** Five or more last quarter is common, at least one is uncommon, never seen is new. */
export function frequencyOf(type: ExceptionType): IssueFrequency {
  const seen = ISSUE_HISTORY[type] ?? 0;
  return seen >= 5 ? "common" : seen >= 1 ? "uncommon" : "new";
}

// ── SLA / tolerance configuration ───────────────────────────────────────────

export const SLA = {
  /** A partner must answer a tender within this window. */
  tenderResponseMinutes: 30,
  /** Minutes past the pickup appointment before it counts as missed. */
  pickupGraceMinutes: 30,
  /** A moving road shipment with no partner update for this long has gone dark. */
  trackingBlackoutHours: 3,
  /**
   * Blackout window by mode. A truck should check in often; a vessel does not
   * ping every three hours, so ocean gets a much wider window.
   */
  trackingBlackoutHoursByMode: { road: 3, air: 6, ocean: 24 },
  /** Minutes past the delivery appointment before it counts as late. */
  deliveryGraceMinutes: 15,
  /** Hours after delivery before a missing POD blocks billing. */
  podHours: 4,
  /** Dollars over the agreed partner rate before an invoice is flagged. */
  invoiceToleranceUsd: 25,
} as const;
