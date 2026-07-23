# Transpira · Freight Control Tower (Aequus Worldwide Logistics)

A focused demo of Transpira's intelligence layer, built for Aequus Worldwide
Logistics, a freight forwarder and licensed customs broker in Tomball, Texas.
Aequus moves freight over the road, by air, and by ocean, and clears it through
customs for shippers in oil and gas, chemicals, healthcare, automotive,
aviation, manufacturing, trade shows, and technology.

The problem it solves for them: Aequus promises a customer a routing, a
schedule, and a rate. Then the shipment lives in the partner world of motor
carriers, airlines, ocean lines, and customs. Problems there surface late and
cost money. A missed pickup or a late delivery hurts the service record. A
missing POD blocks billing. A partner invoice comes in over the agreed rate and
gets paid anyway. A container sits on a customs hold, or a booking rolls to a
later sailing, and the promised date slips. This layer sits between Aequus Ops
and the partner network and catches each gap as it opens.

The demo shows both halves of the pilot. The unified platform: one feed on top
of the tools Aequus already uses (Truckstop, QuickBooks, ACE, partner portals,
email) that the team can search, monitor, and act from. And the AI agents: a
layer that takes the repetitive chasing and checking off the team's plate,
while every critical decision stays with a person.

## What it does

- Ingests JSON feed events across all three modes. Road maps to the EDI
  documents freight runs on (204 tender, 990 accept, 214 status, 210 invoice).
  Air rides the same events under an AWB. Ocean rides booking and B/L. Customs
  events mirror CBP entry status. The format is documented in
  [INPUT_FORMAT.md](INPUT_FORMAT.md)
- Stitches every event to the shipment behind it, across both sides
- Names the app every message came through: Truckstop for road, QuickBooks for
  invoices, ACE for customs entries, partner portals for air and ocean, and
  email for bookings and paperwork. A connected systems panel shows each
  feed's health, what access it was granted, and flags a dying login early
- Detects 9 issue types: unanswered tenders, missed pickups, tracking
  blackouts, late deliveries, missing PODs, invoice overcharges, duplicate
  events, customs holds, and rolled bookings
- Runs a layer of 5 agents that gather, ask, and protect. An agent pulls
  status, builds the packet, and drafts the ask. It never commits money or
  talks to a customer. Those hand off to a person.
- Plays back a simulated Aequus ops day on a sim clock so you can watch the
  issues surface as they happen

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # engine and agent tests
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, click New Project and import the GitHub repo.
3. Keep the framework preset as Next.js. No env vars are needed.
4. Click Deploy.

## Architecture

- `src/lib/types.ts` holds the data contract (feed events, shipment graph,
  exceptions, transport modes)
- `src/lib/engine.ts` is the pure reconciliation function that turns events and
  a clock into a `GraphState`
- `src/lib/agents.ts` is the agent layer over the exceptions the engine finds
- `src/lib/scenario.ts` is one simulated Aequus ops day with planted problems
- `src/app` and `src/components` hold the Next.js UI: shipment board
  (`ShipmentBoard`), shipment detail (`ShipmentDetail`), partner traffic,
  needs-attention feed, and sim playback

Everything is client-side and deterministic. The engine is a pure function of
the event list and the clock, so playback, scrubbing, and custom data all go
through the same path.
