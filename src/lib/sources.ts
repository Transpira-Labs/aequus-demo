/**
 * The source app layer.
 *
 * Aequus runs its day across many tools: Truckstop for road freight,
 * QuickBooks for invoices, ACE for customs entries, partner portals for air
 * and ocean, and plain email. This demo simulates those connections. Every
 * event is attributed to the app it would have arrived through, so every fact
 * on screen can say where it came from, and the connector panel can show the
 * health of each feed.
 */

import type { EventType, SourceApp, TransportMode } from "./types";

export interface SourceAppInfo {
  key: SourceApp;
  name: string;
  /** What flows from it, shown on the connector tile. */
  feeds: string;
  /** The access Aequus granted, in plain words. */
  scopes: string;
}

export const SOURCE_APPS: SourceAppInfo[] = [
  {
    key: "truckstop",
    name: "Truckstop",
    feeds: "Road loads, rate confirmations, and truck tracking",
    scopes: "Reads loads and tracking. Cannot post or edit anything.",
  },
  {
    key: "quickbooks",
    name: "QuickBooks",
    feeds: "Partner invoices and payments",
    scopes: "Reads invoices. Cannot pay or change the books.",
  },
  {
    key: "ace",
    name: "ACE (CBP customs)",
    feeds: "Customs entry status: holds, exams, and releases",
    scopes: "Reads entry status. Filings stay with the broker.",
  },
  {
    key: "airline",
    name: "Airline portal",
    feeds: "Air waybill bookings and flight milestones",
    scopes: "Reads bookings and milestones. Cannot book or cancel.",
  },
  {
    key: "oceanline",
    name: "Ocean line portal",
    feeds: "Ocean bookings, sailings, and container events",
    scopes: "Reads bookings and schedules. Cannot book or cancel.",
  },
  {
    key: "email",
    name: "Email inbox",
    feeds: "Customer bookings and paperwork like PODs",
    scopes: "Reads the ops inbox. Never sends mail on its own.",
  },
];

export function sourceAppInfo(key: SourceApp): SourceAppInfo {
  return SOURCE_APPS.find((a) => a.key === key)!;
}

export function sourceAppName(key: SourceApp): string {
  return sourceAppInfo(key).name;
}

/** The app that carries live movement messages for a transport mode. */
export function modeApp(mode: TransportMode): SourceApp {
  return mode === "air"
    ? "airline"
    : mode === "ocean"
    ? "oceanline"
    : "truckstop";
}

/**
 * Which app a message arrived through. Customer tenders and PODs land in the
 * inbox, invoices live in QuickBooks, customs entries in ACE, and everything
 * that moves rides the app for its mode. Connector status messages are about
 * an app, not through one, so they return undefined.
 */
export function appOf(
  type: EventType,
  mode: TransportMode
): SourceApp | undefined {
  switch (type) {
    case "shipment.tendered":
    case "shipment.cancelled":
    case "pod.filed":
      return "email";
    case "invoice.submitted":
      return "quickbooks";
    case "customs.hold":
    case "customs.cleared":
      return "ace";
    case "booking.rolled":
      return "oceanline";
    case "shipment.assigned":
    case "tender.accepted":
    case "tender.declined":
    case "pickup.completed":
    case "status.update":
    case "delivery.completed":
      return modeApp(mode);
    case "connector.degraded":
    case "connector.restored":
    case "connector.auth_expiring":
      return undefined;
  }
}
