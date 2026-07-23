/**
 * One simulated ops day for Aequus Worldwide Logistics, a freight forwarder and
 * licensed customs broker in Tomball, Texas.
 *
 * Aequus moves freight for customers across road, air, and ocean, then hands
 * each shipment to the partner network: motor carriers, airlines, ocean lines,
 * and customs. The gap that costs money is the space between what Aequus Ops
 * promised and what the partner network actually did. This is a realistic
 * 06:00 to 20:00 day: tenders and bookings come in through the morning,
 * partners accept, freight picks up, pings roll in mid route, deliveries land
 * through the afternoon, PODs follow, and invoices arrive late in the day.
 * Two ocean bookings ride the same feed: one lands in a customs hold, one gets
 * rolled to a later sailing.
 *
 * Most shipments run clean end to end. Nine are planted so that playback
 * reveals exactly one clear instance of each exception type as the sim clock
 * advances, and all of them are still open at SCENARIO_END. (LATE_DELIVERY
 * shows twice, on AEQ-7302 and AEQ-7309.)
 *
 * Three more shipments carry an issue that opens and then closes itself later
 * in the day (a late tender accept, a four hour tracking gap, a late POD).
 * Those are the ones the agent layer clears without anyone touching them.
 *
 * `SCENARIO_EVENTS` is exported sorted by `occurredAt` ascending. Events are
 * authored grouped by shipment below for readability, then sorted once at load.
 */

import { FeedEvent, PartnerRef, SourceApp, Stop, TransportMode } from "./types";

export const SCENARIO_START = "2026-07-20T06:00:00Z";
export const SCENARIO_END = "2026-07-20T20:00:00Z";

// ── partner network (fictional) ──────────────────────────────────────────────

const BAYOU: PartnerRef = { name: "Bayou City Freight", code: "MC-771204" };
const SAMHOU: PartnerRef = { name: "Sam Houston Carriers", code: "MC-448861" };
const KATY: PartnerRef = { name: "Katy Freight Lines", code: "MC-305772" };
const LONE: PartnerRef = { name: "Lone Star Interstate", code: "MC-902114" };
const TGAC: PartnerRef = { name: "TransGlobal Air Cargo", code: "IATA-618" };
const BGL: PartnerRef = { name: "Blue Gulf Line", code: "SCAC-BGLU" };

// ── stops ────────────────────────────────────────────────────────────────────

const HOU_POLY: Stop = { name: "Gulf Coast Polymers Plant", city: "Houston", state: "TX" };
const CORPUS: Stop = { name: "Corpus Christi Distribution Center", city: "Corpus Christi", state: "TX" };
const APEX_HOU: Stop = { name: "Apex Trade Show Warehouse", city: "Houston", state: "TX" };
const LAS_VEGAS: Stop = { name: "Las Vegas Convention Center", city: "Las Vegas", state: "NV" };
const LAREDO: Stop = { name: "Laredo Inland Port", city: "Laredo", state: "TX" };
const LSA_SANANT: Stop = { name: "Lone Star Automotive Plant", city: "San Antonio", state: "TX" };
const IAH: Stop = { name: "George Bush Intercontinental (IAH)", city: "Houston", state: "TX" };
const MIA: Stop = { name: "Miami International Airport (MIA)", city: "Miami", state: "FL" };
const PERMIAN_HOU: Stop = { name: "Permian Energy Yard", city: "Houston", state: "TX" };
const MIDLAND: Stop = { name: "Midland Service Yard", city: "Midland", state: "TX" };
const MERIDIAN_TOM: Stop = { name: "Meridian Medical Distribution", city: "Tomball", state: "TX" };
const DALLAS: Stop = { name: "Dallas Regional DC", city: "Dallas", state: "TX" };
const OKC: Stop = { name: "Oklahoma City Depot", city: "Oklahoma City", state: "OK" };
const BATON: Stop = { name: "Baton Rouge Chemical Terminal", city: "Baton Rouge", state: "LA" };
const BRAZOS_BRYAN: Stop = { name: "Brazos Valley Manufacturing", city: "Bryan", state: "TX" };
const NOLA: Stop = { name: "New Orleans Distribution Center", city: "New Orleans", state: "LA" };
const FRANKFURT: Stop = { name: "Frankfurt Airport (FRA)", city: "Frankfurt", state: "DE" };
const ION_AUSTIN: Stop = { name: "Ion Semiconductor Fab", city: "Austin", state: "TX" };
const ION_HOU: Stop = { name: "Ion Semiconductor Houston Dock", city: "Houston", state: "TX" };
const LSA_HOU: Stop = { name: "Lone Star Automotive Houston", city: "Houston", state: "TX" };
const FORTWORTH: Stop = { name: "Fort Worth Assembly Plant", city: "Fort Worth", state: "TX" };
const APEX_AUSTIN: Stop = { name: "Apex Trade Show Austin", city: "Austin", state: "TX" };
const BEAUMONT: Stop = { name: "Beaumont Refinery Gate", city: "Beaumont", state: "TX" };
const ODESSA: Stop = { name: "Odessa Field Yard", city: "Odessa", state: "TX" };
const SHANGHAI: Stop = { name: "Port of Shanghai", city: "Shanghai", state: "CN" };
const HOUSTON_PORT: Stop = { name: "Port of Houston, Bayport", city: "Houston", state: "TX" };
const ROTTERDAM: Stop = { name: "Port of Rotterdam", city: "Rotterdam", state: "NL" };

// ── event builders (author-friendly, keep the data terse) ────────────────────

function tender(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  customer: string,
  origin: Stop,
  destination: Stop,
  pickupAppt: string,
  deliveryAppt: string,
  equipment: string,
  weightLbs: number,
  customerRateUsd: number,
  mode: TransportMode,
  refNumber?: string,
  international?: boolean
): FeedEvent {
  return {
    messageId,
    source: "OPS",
    type: "shipment.tendered",
    occurredAt,
    payload: {
      shipmentId,
      customer,
      origin,
      destination,
      pickupAppt,
      deliveryAppt,
      equipment,
      weightLbs,
      customerRateUsd,
      mode,
      refNumber,
      international,
    },
  };
}

function assign(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  partner: PartnerRef,
  partnerRateUsd: number
): FeedEvent {
  return {
    messageId,
    source: "OPS",
    type: "shipment.assigned",
    occurredAt,
    payload: { shipmentId, partner, partnerRateUsd },
  };
}

function accept(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  partner: PartnerRef
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "tender.accepted",
    occurredAt,
    payload: { shipmentId, partner },
  };
}

function pickup(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  location: string
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "pickup.completed",
    occurredAt,
    payload: { shipmentId, at: occurredAt, location },
  };
}

function status(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  location: string,
  note?: string
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "status.update",
    occurredAt,
    payload: { shipmentId, at: occurredAt, location, note },
  };
}

function delivery(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  location: string,
  receivedBy?: string
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "delivery.completed",
    occurredAt,
    payload: { shipmentId, at: occurredAt, location, receivedBy },
  };
}

function pod(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  docId: string
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "pod.filed",
    occurredAt,
    payload: { shipmentId, docId },
  };
}

function invoice(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  invoiceId: string,
  amountUsd: number,
  accessorials?: { desc: string; amountUsd: number }[]
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "invoice.submitted",
    occurredAt,
    payload: { shipmentId, invoiceId, amountUsd, accessorials },
  };
}

function customsHold(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  reason: string
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "customs.hold",
    occurredAt,
    payload: { shipmentId, at: occurredAt, reason },
  };
}

function customsCleared(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  entryNumber?: string
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "customs.cleared",
    occurredAt,
    payload: { shipmentId, at: occurredAt, entryNumber },
  };
}

function bookingRolled(
  messageId: string,
  occurredAt: string,
  shipmentId: string,
  partner: PartnerRef,
  fromVessel: string,
  toVessel: string,
  newEtd: string
): FeedEvent {
  return {
    messageId,
    source: "PARTNER",
    type: "booking.rolled",
    occurredAt,
    payload: { shipmentId, at: occurredAt, partner, fromVessel, toVessel, newEtd },
  };
}

function connectorEvent(
  messageId: string,
  occurredAt: string,
  type: "connector.degraded" | "connector.restored" | "connector.auth_expiring",
  app: SourceApp,
  note?: string,
  expiresAt?: string
): FeedEvent {
  return {
    messageId,
    source: "OPS",
    type,
    occurredAt,
    payload: { app, at: occurredAt, note, expiresAt },
  };
}

// customer names
const GCP = "Gulf Coast Polymers";
const PERMIAN = "Permian Energy Services";
const MERIDIAN = "Meridian Medical Supply";
const LSA = "Lone Star Automotive Group";
const APEX = "Apex Trade Show Services";
const HALCYON = "Halcyon Aviation Parts";
const BRAZOS = "Brazos Valley Manufacturing";
const ION = "Ion Semiconductor Devices";

const T = (t: string) => `2026-07-20T${t}:00Z`;
const NEXT = (t: string) => `2026-07-21T${t}:00Z`;

// ── the day, grouped by shipment ─────────────────────────────────────────────

const RAW: FeedEvent[] = [
  // ── CONNECTOR: QuickBooks login token runs out in three days ────────────────
  // The platform holds the keys to each connected app and flags a dying login
  // early, instead of the feed just going quiet the way old connectors did.
  connectorEvent("SYS-000010", T("08:15"), "connector.auth_expiring", "quickbooks", "Login token runs out in 3 days", "2026-07-23T08:15:00Z"),

  // ── CONNECTOR: Truckstop feed slows for half an hour, then catches up ───────
  // The feed slows mid morning. The platform says so while it is happening,
  // then confirms when the feed catches up on its own.
  connectorEvent("SYS-000020", T("09:40"), "connector.degraded", "truckstop", "Status feed running behind"),
  connectorEvent("SYS-000021", T("10:10"), "connector.restored", "truckstop"),

  // ── CLEAN: AEQ-7301, Gulf Coast Polymers, Houston TX → Corpus Christi TX ────
  tender("OPS-000010", T("06:15"), "AEQ-7301", GCP, HOU_POLY, CORPUS, T("08:30"), T("12:00"), "53' dry van", 32400, 1450, "road", "PO-GC-20441"),
  assign("OPS-000011", T("06:25"), "AEQ-7301", BAYOU, 1150),
  accept("PTR-000010", T("06:40"), "AEQ-7301", BAYOU),
  pickup("PTR-000011", T("08:25"), "AEQ-7301", "Houston, TX"),
  status("PTR-000012", T("09:30"), "AEQ-7301", "Victoria, TX", "Rolling south on US-59"),
  delivery("PTR-000013", T("11:45"), "AEQ-7301", "Corpus Christi, TX", "R. Vasquez"),
  pod("PTR-000014", T("12:30"), "AEQ-7301", "POD-7301"),
  invoice("PTR-000015", T("16:00"), "AEQ-7301", "INV-90101", 1150),

  // ── PICKUP_MISSED + LATE_DELIVERY: AEQ-7302, Apex Trade Show ────────────────
  // Sam Houston accepted the tender, then no-showed at the dock. The shipment
  // never moves, so the missed morning pickup becomes an overdue afternoon
  // delivery.
  tender("OPS-000020", T("06:20"), "AEQ-7302", APEX, APEX_HOU, LAS_VEGAS, T("09:00"), T("14:00"), "53' dry van", 28600, 1600, "road", "PO-AX-55210"),
  assign("OPS-000021", T("06:35"), "AEQ-7302", SAMHOU, 1250),
  accept("PTR-000020", T("06:55"), "AEQ-7302", SAMHOU),

  // ── TENDER_UNANSWERED: AEQ-7303, Lone Star Automotive, late-day tender ──────
  // Tendered near end of shift; Lone Star Interstate has not answered by close
  // of day. Appointments are next morning.
  tender("OPS-000030", T("17:30"), "AEQ-7303", LSA, LAREDO, LSA_SANANT, NEXT("08:00"), NEXT("16:00"), "48' flatbed", 41200, 2400, "road", "PO-LA-33017"),
  assign("OPS-000031", T("17:45"), "AEQ-7303", LONE, 1950),

  // ── CLEAN (air): AEQ-7304, Halcyon Aviation Parts, Houston IAH → Miami FL ───
  tender("OPS-000040", T("06:45"), "AEQ-7304", HALCYON, IAH, MIA, T("09:30"), T("13:30"), "air freight, 2 pallets", 880, 1200, "air", "PO-HA-71144"),
  assign("OPS-000041", T("06:55"), "AEQ-7304", TGAC, 950),
  accept("PTR-000040", T("07:10"), "AEQ-7304", TGAC),
  pickup("PTR-000041", T("09:20"), "AEQ-7304", "Houston, TX (IAH)"),
  status("PTR-000042", T("11:00"), "AEQ-7304", "In transit", "Wheels up on TransGlobal Air Cargo"),
  delivery("PTR-000043", T("13:10"), "AEQ-7304", "Miami, FL (MIA)", "T. Nguyen"),
  pod("PTR-000044", T("14:00"), "AEQ-7304", "POD-7304"),
  invoice("PTR-000045", T("17:00"), "AEQ-7304", "INV-90104", 950),

  // ── INVOICE_MISMATCH: AEQ-7305, Permian Energy, billed over the agreed rate ─
  tender("OPS-000050", T("07:00"), "AEQ-7305", PERMIAN, PERMIAN_HOU, MIDLAND, T("09:30"), T("13:30"), "53' dry van", 30500, 1500, "road", "PO-PE-20455"),
  assign("OPS-000051", T("07:10"), "AEQ-7305", BAYOU, 1150),
  accept("PTR-000050", T("07:25"), "AEQ-7305", BAYOU),
  pickup("PTR-000051", T("09:25"), "AEQ-7305", "Houston, TX"),
  status("PTR-000052", T("11:15"), "AEQ-7305", "Columbus, TX"),
  delivery("PTR-000053", T("13:20"), "AEQ-7305", "Midland, TX", "C. Boudreaux"),
  pod("PTR-000054", T("14:10"), "AEQ-7305", "POD-7305"),
  invoice("PTR-000055", T("16:30"), "AEQ-7305", "INV-88412", 1395, [
    { desc: "Detention 2 hr", amountUsd: 120 },
    { desc: "Fuel surcharge adj", amountUsd: 125 },
  ]),

  // ── DUPLICATE_EVENT: AEQ-7306, Meridian Medical, 204 tender sent twice ──────
  tender("OPS-000012", T("06:30"), "AEQ-7306", MERIDIAN, MERIDIAN_TOM, DALLAS, T("09:00"), T("13:00"), "53' dry van", 22800, 1350, "road", "PO-MM-40912"),
  tender("OPS-000012", T("06:31"), "AEQ-7306", MERIDIAN, MERIDIAN_TOM, DALLAS, T("09:00"), T("13:00"), "53' dry van", 22800, 1350, "road", "PO-MM-40912"),
  assign("OPS-000061", T("06:45"), "AEQ-7306", KATY, 1050),
  accept("PTR-000060", T("07:00"), "AEQ-7306", KATY),
  pickup("PTR-000061", T("08:45"), "AEQ-7306", "Tomball, TX"),
  status("PTR-000062", T("10:30"), "AEQ-7306", "Huntsville, TX", "On I-45 N"),
  delivery("PTR-000063", T("12:40"), "AEQ-7306", "Dallas, TX", "D. Carter"),
  pod("PTR-000064", T("13:30"), "AEQ-7306", "POD-7306"),
  invoice("PTR-000065", T("16:15"), "AEQ-7306", "INV-90106", 1050),

  // ── CLEAN: AEQ-7307, Meridian Medical, Tomball TX → Oklahoma City OK ────────
  tender("OPS-000070", T("06:50"), "AEQ-7307", MERIDIAN, MERIDIAN_TOM, OKC, T("08:00"), T("16:00"), "53' dry van", 38900, 2200, "road", "PO-MM-33008"),
  assign("OPS-000071", T("07:00"), "AEQ-7307", SAMHOU, 1750),
  accept("PTR-000070", T("07:15"), "AEQ-7307", SAMHOU),
  pickup("PTR-000071", T("07:55"), "AEQ-7307", "Tomball, TX"),
  status("PTR-000072", T("10:20"), "AEQ-7307", "Huntsville, TX", "On US-75 N"),
  status("PTR-000073", T("13:00"), "AEQ-7307", "Denison, TX"),
  delivery("PTR-000074", T("15:40"), "AEQ-7307", "Oklahoma City, OK", "A. Okafor"),
  pod("PTR-000075", T("16:30"), "AEQ-7307", "POD-7307"),
  invoice("PTR-000076", T("18:30"), "AEQ-7307", "INV-90107", 1750),

  // ── TRACKING_BLACKOUT: AEQ-7308, Gulf Coast Polymers, Houston → Baton Rouge ─
  // Katy Freight Lines picks up and pings once near Beaumont, then goes dark
  // for the rest of the day. The delivery appt is late evening, so it is not
  // overdue yet, just silent.
  tender("OPS-000080", T("07:05"), "AEQ-7308", GCP, HOU_POLY, BATON, T("09:00"), T("20:30"), "53' dry van", 26400, 2800, "road", "PO-GC-88120"),
  assign("OPS-000081", T("07:20"), "AEQ-7308", KATY, 2300),
  accept("PTR-000080", T("07:40"), "AEQ-7308", KATY),
  pickup("PTR-000081", T("09:30"), "AEQ-7308", "Houston, TX"),
  status("PTR-000082", T("12:00"), "AEQ-7308", "Beaumont, TX", "On I-10 E"),

  // ── LATE_DELIVERY: AEQ-7309, Brazos Valley Mfg, delivered 1.5 h late ───────
  tender("OPS-000090", T("07:15"), "AEQ-7309", BRAZOS, BRAZOS_BRYAN, NOLA, T("09:00"), T("13:00"), "53' dry van", 33700, 1700, "road", "PO-BV-71160"),
  assign("OPS-000091", T("07:25"), "AEQ-7309", BAYOU, 1350),
  accept("PTR-000090", T("07:45"), "AEQ-7309", BAYOU),
  pickup("PTR-000091", T("09:10"), "AEQ-7309", "Bryan, TX"),
  status("PTR-000092", T("11:00"), "AEQ-7309", "Huntsville, TX"),
  status("PTR-000093", T("13:00"), "AEQ-7309", "Lake Charles, LA", "Traffic delay on I-10 E"),
  delivery("PTR-000094", T("14:30"), "AEQ-7309", "New Orleans, LA", "R. Vasquez"),
  pod("PTR-000095", T("15:15"), "AEQ-7309", "POD-7309"),
  invoice("PTR-000096", T("18:00"), "AEQ-7309", "INV-90109", 1350),

  // ── CLEAN (air, intl export): AEQ-7310, Permian Energy, Houston IAH → FRA ───
  // Export clears customs about an hour after the airline takes the cargo, then
  // the shipment runs clean to recovery in Frankfurt.
  tender("OPS-000100", T("07:20"), "AEQ-7310", PERMIAN, IAH, FRANKFURT, T("08:30"), T("17:00"), "air freight, 2 pallets", 740, 2100, "air", "PO-PE-40930", true),
  assign("OPS-000101", T("07:30"), "AEQ-7310", TGAC, 1650),
  accept("PTR-000100", T("07:50"), "AEQ-7310", TGAC),
  pickup("PTR-000101", T("08:25"), "AEQ-7310", "Houston, TX (IAH)"),
  customsCleared("PTR-000108", T("09:25"), "AEQ-7310", "AES-X20726"),
  status("PTR-000102", T("10:50"), "AEQ-7310", "Departed IAH", "Wheels up on TransGlobal Air Cargo"),
  status("PTR-000103", T("13:20"), "AEQ-7310", "In transit over the Atlantic"),
  status("PTR-000104", T("15:40"), "AEQ-7310", "On approach to FRA"),
  delivery("PTR-000105", T("16:40"), "AEQ-7310", "Frankfurt, DE (FRA)", "A. Okafor"),
  pod("PTR-000106", T("17:30"), "AEQ-7310", "POD-7310"),
  invoice("PTR-000107", T("19:00"), "AEQ-7310", "INV-90110", 1650),

  // ── POD_MISSING: AEQ-7311, Ion Semiconductor, delivered but no POD all day ─
  tender("OPS-000110", T("07:25"), "AEQ-7311", ION, ION_AUSTIN, ION_HOU, T("09:30"), T("13:00"), "53' dry van", 27300, 1550, "road", "PO-IO-55240"),
  assign("OPS-000111", T("07:35"), "AEQ-7311", SAMHOU, 1200),
  accept("PTR-000110", T("07:55"), "AEQ-7311", SAMHOU),
  pickup("PTR-000111", T("09:25"), "AEQ-7311", "Austin, TX"),
  status("PTR-000112", T("11:10"), "AEQ-7311", "Bastrop, TX"),
  delivery("PTR-000113", T("12:50"), "AEQ-7311", "Houston, TX", "C. Boudreaux"),
  invoice("PTR-000114", T("16:00"), "AEQ-7311", "INV-90111", 1200),

  // ── CLEAN: AEQ-7312, Lone Star Automotive, San Antonio TX → Houston TX ──────
  tender("OPS-000120", T("08:00"), "AEQ-7312", LSA, LSA_SANANT, LSA_HOU, T("10:00"), T("14:00"), "53' dry van", 31800, 1400, "road", "PO-LA-20470"),
  assign("OPS-000121", T("08:10"), "AEQ-7312", KATY, 1100),
  accept("PTR-000120", T("08:30"), "AEQ-7312", KATY),
  pickup("PTR-000121", T("09:55"), "AEQ-7312", "San Antonio, TX"),
  status("PTR-000122", T("11:30"), "AEQ-7312", "Seguin, TX"),
  delivery("PTR-000123", T("13:40"), "AEQ-7312", "Houston, TX", "R. Vasquez"),
  pod("PTR-000124", T("14:20"), "AEQ-7312", "POD-7312"),
  invoice("PTR-000125", T("17:30"), "AEQ-7312", "INV-90112", 1100),

  // ── CLEAN: AEQ-7313, Brazos Valley Mfg, Bryan TX → Fort Worth TX ───────────
  tender("OPS-000130", T("08:15"), "AEQ-7313", BRAZOS, BRAZOS_BRYAN, FORTWORTH, T("10:30"), T("13:30"), "hotshot", 9800, 900, "road", "PO-BV-88140"),
  assign("OPS-000131", T("08:25"), "AEQ-7313", BAYOU, 700),
  accept("PTR-000130", T("08:40"), "AEQ-7313", BAYOU),
  pickup("PTR-000131", T("10:25"), "AEQ-7313", "Bryan, TX"),
  status("PTR-000132", T("11:15"), "AEQ-7313", "Waco, TX"),
  delivery("PTR-000133", T("12:45"), "AEQ-7313", "Fort Worth, TX", "K. Ellison"),
  pod("PTR-000134", T("13:20"), "AEQ-7313", "POD-7313"),
  invoice("PTR-000135", T("17:45"), "AEQ-7313", "INV-90113", 700),

  // ── CLEAN: AEQ-7314, Apex Trade Show, Austin TX → Houston TX ───────────────
  tender("OPS-000140", T("08:30"), "AEQ-7314", APEX, APEX_AUSTIN, APEX_HOU, T("11:00"), T("16:00"), "53' dry van", 35600, 1650, "road", "PO-AX-71182"),
  assign("OPS-000141", T("08:40"), "AEQ-7314", SAMHOU, 1300),
  accept("PTR-000140", T("09:00"), "AEQ-7314", SAMHOU),
  pickup("PTR-000141", T("10:55"), "AEQ-7314", "Austin, TX"),
  status("PTR-000142", T("13:00"), "AEQ-7314", "Columbus, TX", "On I-10 E"),
  delivery("PTR-000143", T("15:30"), "AEQ-7314", "Houston, TX", "J. Pearson"),
  pod("PTR-000144", T("16:15"), "AEQ-7314", "POD-7314"),
  invoice("PTR-000145", T("19:15"), "AEQ-7314", "INV-90114", 1300),

  // ── AGENT WIN: AEQ-7315, Gulf Coast Polymers, tender sat 45 min then accepted
  // Lone Star Interstate took 45 min to answer, past the 30 min window. Partner
  // Chaser follows up, the accept lands, and the shipment runs clean from there.
  tender("OPS-000150", T("09:00"), "AEQ-7315", GCP, HOU_POLY, BEAUMONT, T("12:00"), T("16:00"), "53' dry van", 30900, 1450, "road", "PO-GC-20488"),
  assign("OPS-000151", T("09:10"), "AEQ-7315", LONE, 1150),
  accept("PTR-000150", T("09:55"), "AEQ-7315", LONE),
  pickup("PTR-000151", T("11:55"), "AEQ-7315", "Houston, TX"),
  status("PTR-000152", T("13:30"), "AEQ-7315", "Baytown, TX"),
  delivery("PTR-000153", T("15:40"), "AEQ-7315", "Beaumont, TX", "R. Vasquez"),
  pod("PTR-000154", T("16:20"), "AEQ-7315", "POD-7315"),
  invoice("PTR-000155", T("18:15"), "AEQ-7315", "INV-90115", 1150),

  // ── AGENT WIN: AEQ-7316, Permian Energy, four quiet hours then back on the map
  // Katy Freight Lines pings from Big Spring, goes dark for four hours, then
  // checks in after the chase and still delivers ahead of the appointment.
  tender("OPS-000160", T("08:45"), "AEQ-7316", PERMIAN, ODESSA, PERMIAN_HOU, T("10:30"), T("17:00"), "53' dry van", 23600, 1300, "road", "PO-PE-40955"),
  assign("OPS-000161", T("08:55"), "AEQ-7316", KATY, 1000),
  accept("PTR-000160", T("09:10"), "AEQ-7316", KATY),
  pickup("PTR-000161", T("10:25"), "AEQ-7316", "Odessa, TX"),
  status("PTR-000162", T("11:00"), "AEQ-7316", "Big Spring, TX", "On I-20 E"),
  status("PTR-000163", T("15:00"), "AEQ-7316", "Brookshire, TX", "Back on the map after a dead zone"),
  delivery("PTR-000164", T("16:30"), "AEQ-7316", "Houston, TX", "D. Carter"),
  pod("PTR-000165", T("17:10"), "AEQ-7316", "POD-7316"),
  invoice("PTR-000166", T("19:30"), "AEQ-7316", "INV-90116", 1000),

  // ── AGENT WIN: AEQ-7317, Meridian Medical, POD landed six hours after delivery
  // Delivered on time, paperwork lagged. Docs Clerk asks twice and the POD comes
  // in, so billing is unblocked without anyone touching it.
  tender("OPS-000170", T("08:50"), "AEQ-7317", MERIDIAN, DALLAS, MERIDIAN_TOM, T("10:00"), T("13:30"), "53' reefer", 26900, 1550, "road", "PO-MM-55265"),
  assign("OPS-000171", T("09:00"), "AEQ-7317", SAMHOU, 1200),
  accept("PTR-000170", T("09:15"), "AEQ-7317", SAMHOU),
  pickup("PTR-000171", T("09:55"), "AEQ-7317", "Dallas, TX"),
  status("PTR-000172", T("11:20"), "AEQ-7317", "Corsicana, TX"),
  delivery("PTR-000173", T("13:10"), "AEQ-7317", "Tomball, TX", "C. Boudreaux"),
  pod("PTR-000174", T("19:10"), "AEQ-7317", "POD-7317"),
  invoice("PTR-000175", T("19:40"), "AEQ-7317", "INV-90117", 1200),

  // ── CLEAN: AEQ-7318, Ion Semiconductor, Houston TX → Austin TX ─────────────
  tender("OPS-000180", T("09:10"), "AEQ-7318", ION, ION_HOU, ION_AUSTIN, T("11:00"), T("18:00"), "53' dry van", 37400, 2150, "road", "PO-IO-33025"),
  assign("OPS-000181", T("09:20"), "AEQ-7318", KATY, 1700),
  accept("PTR-000180", T("09:35"), "AEQ-7318", KATY),
  pickup("PTR-000181", T("10:55"), "AEQ-7318", "Houston, TX"),
  status("PTR-000182", T("13:00"), "AEQ-7318", "Brenham, TX", "On US-290 W"),
  status("PTR-000183", T("15:30"), "AEQ-7318", "Elgin, TX"),
  delivery("PTR-000184", T("17:40"), "AEQ-7318", "Austin, TX", "A. Okafor"),
  pod("PTR-000185", T("18:20"), "AEQ-7318", "POD-7318"),
  invoice("PTR-000186", T("19:45"), "AEQ-7318", "INV-90118", 1700),

  // ── CUSTOMS_HOLD: AEQ-7319, Brazos Valley Mfg, Shanghai CN → Port of Houston
  // Ocean import on Blue Gulf Line. The box discharges and sits in the yard,
  // then CBP puts an exam hold on the entry. Nothing moves until it clears.
  // Delivery appt is next day, so no late delivery fires. Ocean blackout window
  // is 24 hours, so no blackout fires either.
  tender("OPS-000190", T("06:15"), "AEQ-7319", BRAZOS, SHANGHAI, HOUSTON_PORT, T("09:00"), NEXT("14:00"), "40' FCL container", 38000, 4200, "ocean", "PO-BV-71190", true),
  assign("OPS-000191", T("06:30"), "AEQ-7319", BGL, 3600),
  accept("PTR-000190", T("06:45"), "AEQ-7319", BGL),
  pickup("PTR-000191", T("09:00"), "AEQ-7319", "Bayport Container Terminal, Houston, TX"),
  status("PTR-000192", T("09:40"), "AEQ-7319", "Bayport, Houston, TX", "Container in the yard at Bayport"),
  customsHold("PTR-000193", T("10:00"), "AEQ-7319", "CBP exam hold on entry"),

  // ── BOOKING_ROLLED: AEQ-7320, Gulf Coast Polymers, Houston TX → Rotterdam NL
  // Ocean export on Blue Gulf Line. The box gates in on time, then the line
  // rolls the booking off the BG Neptune 24W to the BG Atlas 25W. The new ETD
  // is days after the promised delivery, so this is critical.
  tender("OPS-000200", T("07:00"), "AEQ-7320", GCP, HOU_POLY, ROTTERDAM, T("11:00"), NEXT("18:00"), "40' FCL container", 41000, 5200, "ocean", "PO-GC-71200", true),
  assign("OPS-000201", T("07:15"), "AEQ-7320", BGL, 4400),
  accept("PTR-000200", T("07:30"), "AEQ-7320", BGL),
  pickup("PTR-000201", T("11:00"), "AEQ-7320", "Barbours Cut Terminal, Houston, TX"),
  bookingRolled("PTR-000202", T("14:00"), "AEQ-7320", BGL, "BG Neptune 24W", "BG Atlas 25W", "2026-07-25T06:00:00Z"),
  status("PTR-000203", T("16:30"), "AEQ-7320", "Barbours Cut, Houston, TX", "Container in the yard, holding for the next sailing"),
];

export const SCENARIO_EVENTS: FeedEvent[] = [...RAW].sort(
  (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
);
