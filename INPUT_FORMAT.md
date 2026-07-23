# Input format

Everything the demo ingests is a stream of JSON **feed events**, one message per
transmission, modeled on the messages freight actually runs on. One side is
**Aequus Ops** (the forwarder's system: tenders, bookings, agreed rates,
appointments). The other side is the **Partner network** (motor carriers,
airlines, ocean lines, and customs: accepts, pickups, in-transit pings,
deliveries, PODs, invoices, customs status, and sailing changes). If you can
export your ops and partner traffic into this shape, the demo can reconcile it.

The canonical TypeScript definitions live in [`src/lib/types.ts`](src/lib/types.ts).
This file is the human-readable version.

## The envelope

Every message, from either side, arrives in the same envelope:

```json
{
  "messageId": "OPS-000031",
  "source": "OPS",
  "type": "shipment.tendered",
  "occurredAt": "2026-07-20T07:15:00Z",
  "payload": { }
}
```

| Field | Type | Notes |
|---|---|---|
| `messageId` | string | Unique per transmission. A repeated `messageId` is flagged as a duplicate. Ops messages start `OPS-`, partner messages start `PTR-`. |
| `source` | `"OPS"` \| `"PARTNER"` | Which side sent the message. Shown as "Aequus Ops" and "Partner network". |
| `type` | string | One of the event types below. |
| `occurredAt` | ISO 8601 datetime | When it happened. Drives the sim clock and all SLA checks. |
| `payload` | object | Shape depends on `type`. Every payload carries a `shipmentId`. |

## Modes

Every shipment has a `mode`: `"road"`, `"air"`, or `"ocean"`. The same events
carry all three. Road runs on the EDI documents (204/990/214/210). Air rides the
same milestone events under an air waybill (AWB). Ocean rides the booking and
bill of lading (B/L). Customs events mirror CBP entry status messages. Some
thresholds change by mode (see the exception table).

## Event types

| `type` | Source | Analog | Meaning |
|---|---|---|---|
| `shipment.tendered` | OPS | **204** / AWB / booking | A customer gave Aequus a shipment to move. |
| `shipment.assigned` | OPS | 204 out | Ops booked a partner at an agreed rate. |
| `shipment.cancelled` | OPS | 204 cancel | Shipment withdrawn. |
| `tender.accepted` | PARTNER | **990** | The partner said yes. |
| `tender.declined` | PARTNER | 990 | The partner said no. |
| `pickup.completed` | PARTNER | **214** | Freight picked up, tendered to the airline, or gated in at the port. |
| `status.update` | PARTNER | 214 | In-transit check call or ping. |
| `delivery.completed` | PARTNER | 214 | Freight delivered, recovered, or the container delivered. |
| `pod.filed` | PARTNER | n/a | Proof of delivery document on file. |
| `invoice.submitted` | PARTNER | **210** | The partner billed for the shipment. |
| `customs.hold` | PARTNER | CBP entry status | Customs put a hold on the entry. |
| `customs.cleared` | PARTNER | CBP entry status | Customs released the entry. |
| `booking.rolled` | PARTNER | booking change | The ocean line moved the box to a later sailing. |
| `connector.degraded` | OPS | sync layer | A connected app's feed is running behind. |
| `connector.restored` | OPS | sync layer | The feed caught back up. |
| `connector.auth_expiring` | OPS | sync layer | A connected app's login token is about to die. |

## Source apps

Every shipment message is attributed to the app it arrived through, so the UI
can name the source of every fact. Attribution is derived from the event type
and the shipment's mode (see [`src/lib/sources.ts`](src/lib/sources.ts)):

| App | Carries |
|---|---|
| Truckstop | Road loads, rate confirmations, and truck tracking |
| QuickBooks | Partner invoices and payments |
| ACE (CBP customs) | Customs entry status: holds, exams, and releases |
| Airline portal | Air waybill bookings and flight milestones |
| Ocean line portal | Ocean bookings, sailings, and container events |
| Email inbox | Customer bookings and paperwork like PODs |

## Partner reference

Partner events name the partner as a `PartnerRef`:

```json
{ "name": "Bayou City Freight", "code": "MC-771204" }
```

`code` holds the partner's identifier. It is an MC number for a motor carrier
(`MC-771204`), a SCAC for an ocean line (`SCAC-BGLU`), or an IATA code for an
airline (`IATA-618`).

## Payloads

### `shipment.tendered` (~ EDI 204 / AWB / booking)

```json
{
  "shipmentId": "AEQ-7319",
  "customer": "Brazos Valley Manufacturing",
  "origin": { "name": "Port of Shanghai", "city": "Shanghai", "state": "CN" },
  "destination": { "name": "Port of Houston, Bayport", "city": "Houston", "state": "TX" },
  "pickupAppt": "2026-07-20T09:00:00Z",
  "deliveryAppt": "2026-07-21T14:00:00Z",
  "equipment": "40' FCL container",
  "weightLbs": 38000,
  "customerRateUsd": 4200,
  "mode": "ocean",
  "refNumber": "PO-BV-71190",
  "international": true
}
```

`mode` is required. `international` is optional and marks a shipment that crosses
a border. `equipment` reads by mode: road `"53' dry van"`, air
`"air freight, 2 pallets"`, ocean `"40' FCL container"`.

### `shipment.assigned`

```json
{
  "shipmentId": "AEQ-7319",
  "partner": { "name": "Blue Gulf Line", "code": "SCAC-BGLU" },
  "partnerRateUsd": 3600
}
```

### `tender.accepted` / `tender.declined` (~ EDI 990)

```json
{ "shipmentId": "AEQ-7319", "partner": { "name": "Blue Gulf Line", "code": "SCAC-BGLU" } }
```

### `pickup.completed`, `status.update`, `delivery.completed` (~ EDI 214)

```json
{ "shipmentId": "AEQ-7319", "at": "2026-07-20T09:00:00Z", "location": "Bayport Container Terminal, Houston, TX" }
```

`status.update` may add a `note`. `delivery.completed` may add `receivedBy`.

### `pod.filed`

```json
{ "shipmentId": "AEQ-7319", "docId": "POD-7319" }
```

### `invoice.submitted` (~ EDI 210)

```json
{
  "shipmentId": "AEQ-7305",
  "invoiceId": "INV-88412",
  "amountUsd": 1395,
  "accessorials": [
    { "desc": "Detention 2 hr", "amountUsd": 120 },
    { "desc": "Fuel surcharge adj", "amountUsd": 125 }
  ]
}
```

### `customs.hold`

```json
{ "shipmentId": "AEQ-7319", "at": "2026-07-20T10:00:00Z", "reason": "CBP exam hold on entry" }
```

### `customs.cleared`

```json
{ "shipmentId": "AEQ-7310", "at": "2026-07-20T09:25:00Z", "entryNumber": "AES-X20726" }
```

### `booking.rolled`

```json
{
  "shipmentId": "AEQ-7320",
  "at": "2026-07-20T14:00:00Z",
  "partner": { "name": "Blue Gulf Line", "code": "SCAC-BGLU" },
  "fromVessel": "BG Neptune 24W",
  "toVessel": "BG Atlas 25W",
  "newEtd": "2026-07-25T06:00:00Z"
}
```

### `connector.degraded` / `connector.restored` / `connector.auth_expiring`

Status messages about a connected app, from the platform's own sync layer.
They are not tied to any shipment. `app` is one of `truckstop`, `quickbooks`,
`ace`, `airline`, `oceanline`, or `email`. `expiresAt` only appears on
`connector.auth_expiring`.

```json
{ "app": "truckstop", "at": "2026-07-20T09:40:00Z", "note": "Status feed running behind" }
```

```json
{ "app": "quickbooks", "at": "2026-07-20T08:15:00Z", "note": "Login token runs out in 3 days", "expiresAt": "2026-07-23T08:15:00Z" }
```

## What the engine detects

| Exception | Trigger |
|---|---|
| `TENDER_UNANSWERED` | Partner has not answered the tender within 30 min |
| `PICKUP_MISSED` | Pickup appointment passed by 30+ min with no pickup |
| `TRACKING_BLACKOUT` | Shipment is moving but the partner has gone quiet past the mode window (road 3 h, air 6 h, ocean 24 h) |
| `LATE_DELIVERY` | Delivered late, or the delivery appointment has passed with no delivery |
| `POD_MISSING` | Delivered 4+ hours ago with no POD, so the customer cannot be billed |
| `INVOICE_MISMATCH` | Partner invoice is more than $25 over the agreed rate |
| `DUPLICATE_EVENT` | Same `messageId` transmitted twice |
| `CUSTOMS_HOLD` | Customs put a hold on the entry and it has not cleared |
| `BOOKING_ROLLED` | The ocean line moved the box to a later sailing |

SLA windows and tolerances are constants in
[`src/lib/types.ts`](src/lib/types.ts) (`SLA`) and easy to adjust. The tracking
blackout window is mode aware: a vessel does not check in every three hours.

## Feeding the demo

The demo ships with one simulated ops day
([`src/lib/scenario.ts`](src/lib/scenario.ts)) that plays back on the sim
clock. To test with your own data, replace or extend the exported event list
with events in the format above. The engine is a pure function of
`(events, time)`, so anything you feed it is reconciled the same way.
