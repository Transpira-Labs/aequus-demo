/**
 * The agent layer for the Transpira freight demo, built for Aequus.
 *
 * `runAgents(state, events, simTime, enabled)` is pure and deterministic. It
 * reads the reconciled graph, works out every issue an agent has picked up as
 * of the sim clock (including issues that have already closed themselves), and
 * returns what each agent did.
 *
 * There is no clock read, no randomness and no I/O, so the panel is stable when
 * the user scrubs the sim clock back and forth.
 *
 * An agent never pays, short pays, cancels, rebooks at a higher cost, files
 * with customs, takes a new sailing, or talks to a customer on its own. Those
 * stop and become a short list of choices for a person.
 */

import {
  AGENT_BY_TYPE,
  AGENT_TIMING,
  type AgentId,
  type AgentRun,
  type AgentState,
  type AgentTally,
  type AgentToggles,
  type AgentStep,
  type FixOption,
  type HumanAsk,
  type RunStatus,
} from "./agentTypes";
import {
  type ExceptionRecord,
  type ExceptionType,
  type FeedEvent,
  type GraphState,
  type InvoiceSubmittedPayload,
  type ShipmentEntity,
  SLA,
} from "./types";

// ── small helpers ───────────────────────────────────────────────────────────

const ms = (iso: string): number => new Date(iso).getTime();
const addMinutes = (iso: string, minutes: number): string =>
  new Date(ms(iso) + minutes * 60_000).toISOString();
const addHours = (iso: string, hours: number): string =>
  addMinutes(iso, hours * 60);

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
  const whole = Math.abs(Math.round(n)).toString();
  return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

const emptyTally = (): AgentTally => ({ working: 0, resolved: 0, needsYou: 0 });

// ── the internal notion of an issue an agent works ──────────────────────────

interface Issue {
  exceptionId: string;
  type: ExceptionType;
  /** Key used in the run id: the shipment id, or the message id for duplicates. */
  key: string;
  shipmentId?: string;
  detectedAt: string;
  /** Set when the issue closed on its own. */
  closedAt?: string;
  /** Plain sentence describing what closed it. */
  closeText?: string;
  /** Money freed up when it closed. */
  closeSavedUsd?: number;
  /** Extra context carried from the exception record. */
  invoiceId?: string;
}

/**
 * Types the agent is never allowed to close alone, with the offset (in minutes
 * from detection) at which it stops and asks a person. Everything else waits
 * the full escalate window before it gives up.
 *
 * LATE_DELIVERY and CUSTOMS_HOLD are time sensitive, so they hand off at the
 * first action. INVOICE_MISMATCH and BOOKING_ROLLED gather first (the dispute
 * file, the sailing options), so they hand off at the second action.
 */
const NEVER_AUTO: Partial<Record<ExceptionType, number>> = {
  LATE_DELIVERY: AGENT_TIMING.firstActionMinutes,
  CUSTOMS_HOLD: AGENT_TIMING.firstActionMinutes,
  INVOICE_MISMATCH: AGENT_TIMING.secondActionMinutes,
  BOOKING_ROLLED: AGENT_TIMING.secondActionMinutes,
};

// ── main ────────────────────────────────────────────────────────────────────

export function runAgents(
  state: GraphState,
  events: FeedEvent[],
  simTime: Date,
  enabled: AgentToggles
): AgentState {
  const now = simTime.getTime();

  const issues = new Map<string, Issue>();
  const put = (i: Issue) => {
    const id = runId(i);
    if (!issues.has(id)) issues.set(id, i);
  };

  // Issues that are open right now come straight off the reconciled state.
  for (const ex of state.exceptions) {
    const i = fromException(ex);
    if (i) put(i);
  }

  // Issues that happened earlier in the day and have since closed are not in
  // state.exceptions any more, so they are derived from the shipment itself.
  const shipmentIds = Object.keys(state.shipments).sort();
  for (const shipmentId of shipmentIds) {
    for (const i of closedIssuesOf(state.shipments[shipmentId])) put(i);
  }

  const runs: AgentRun[] = [];
  for (const issue of issues.values()) {
    if (ms(issue.detectedAt) > now) continue; // not visible yet
    const agentId = AGENT_BY_TYPE[issue.type];
    if (!enabled[agentId]) continue; // agent is switched off
    const shipment = issue.shipmentId
      ? state.shipments[issue.shipmentId]
      : undefined;
    runs.push(buildRun(issue, agentId, shipment, events, now));
  }

  // Newest activity first, stable id tiebreak so the panel never reorders.
  runs.sort((a, b) => {
    const d = activityAt(b) - activityAt(a);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  const byAgent: Record<AgentId, AgentTally> = {
    "partner-chaser": emptyTally(),
    "docs-clerk": emptyTally(),
    "billing-auditor": emptyTally(),
    "service-watch": emptyTally(),
    "customs-watch": emptyTally(),
  };
  const totals = emptyTally();
  let handledWithoutYou = 0;
  let savedUsd = 0;

  for (const r of runs) {
    const bucket =
      r.status === "resolved"
        ? "resolved"
        : r.status === "needs_you"
          ? "needsYou"
          : "working";
    byAgent[r.agentId][bucket] += 1;
    totals[bucket] += 1;
    if (r.status === "resolved") {
      handledWithoutYou += 1;
      savedUsd += r.savedUsd ?? 0;
    } else if (r.exceptionType === "INVOICE_MISMATCH" && holdLanded(r, now)) {
      // The hold protects the money the moment it lands, even though the
      // approve or short pay call is still open.
      savedUsd += r.savedUsd ?? 0;
    }
  }

  return { runs, byAgent, totals, handledWithoutYou, savedUsd };
}

// ── issue discovery ─────────────────────────────────────────────────────────

function runId(i: Issue): string {
  return `run:${i.type}:${i.key}`;
}

function fromException(ex: ExceptionRecord): Issue | undefined {
  if (!ex.detectedAt) return undefined;

  if (ex.type === "DUPLICATE_EVENT") {
    // The id is DUPLICATE_EVENT:<messageId>.
    const messageId = ex.id.slice("DUPLICATE_EVENT:".length);
    return {
      exceptionId: ex.id,
      type: ex.type,
      key: messageId,
      shipmentId: ex.shipmentId,
      detectedAt: ex.detectedAt,
      // Always handled the instant it is seen.
      closedAt: ex.detectedAt,
      closeText: `Dropped the repeat of ${messageId} so this shipment cannot be worked twice.`,
    };
  }

  if (!ex.shipmentId) return undefined;

  const issue: Issue = {
    exceptionId: ex.id,
    type: ex.type,
    key: ex.shipmentId,
    shipmentId: ex.shipmentId,
    detectedAt: ex.detectedAt,
  };
  if (ex.type === "INVOICE_MISMATCH") {
    // The id is INVOICE_MISMATCH:<shipmentId>:<invoiceId>.
    issue.invoiceId = ex.id.split(":")[2];
  }
  return issue;
}

/**
 * Partner events on a shipment, in time order: pickup, pings, delivery, plus
 * customs and booking events. Matches the engine's idea of partner contact,
 * so a vessel that just posted a customs hold does not read as a blackout.
 */
function partnerPings(o: ShipmentEntity): { at: string; where: string }[] {
  const out: { at: string; where: string }[] = [];
  if (o.pickup) out.push({ at: o.pickup.at, where: o.pickup.location });
  for (const s of o.statusUpdates) out.push({ at: s.at, where: s.location });
  if (o.delivery) out.push({ at: o.delivery.at, where: o.delivery.location });
  if (o.customsHold) out.push({ at: o.customsHold.at, where: "customs" });
  if (o.customsCleared)
    out.push({ at: o.customsCleared.at, where: "customs" });
  if (o.rolled) out.push({ at: o.rolled.at, where: "the ocean line" });
  return out.sort((a, b) => ms(a.at) - ms(b.at));
}

/** occurredAt of the first event of a given type on a shipment. */
function firstEventAt(
  o: ShipmentEntity,
  type: FeedEvent["type"]
): string | undefined {
  for (const e of o.events) if (e.type === type) return e.occurredAt;
  return undefined;
}

/** occurredAt of the last event of a given type on a shipment. */
function lastEventAt(
  o: ShipmentEntity,
  type: FeedEvent["type"]
): string | undefined {
  let out: string | undefined;
  for (const e of o.events) if (e.type === type) out = e.occurredAt;
  return out;
}

/**
 * Issues that happened on this shipment and have already closed themselves.
 * These are the wins, so they matter as much as the open ones. Only the six
 * self-closing types are derived here. Customs holds and rolled bookings
 * persist until a person acts, so they never show up as a win.
 */
function closedIssuesOf(o: ShipmentEntity): Issue[] {
  const out: Issue[] = [];
  const partner = o.assignment?.partner.name ?? "the partner";

  // Tender answered, but answered late.
  const assignedAt = lastEventAt(o, "shipment.assigned");
  const acceptedAt = firstEventAt(o, "tender.accepted");
  if (o.assignment && assignedAt && acceptedAt) {
    const deadline = addMinutes(assignedAt, SLA.tenderResponseMinutes);
    if (ms(acceptedAt) > ms(deadline)) {
      out.push({
        exceptionId: `TENDER_UNANSWERED:${o.shipmentId}`,
        type: "TENDER_UNANSWERED",
        key: o.shipmentId,
        shipmentId: o.shipmentId,
        detectedAt: deadline,
        closedAt: acceptedAt,
        closeText: `${partner} accepted the tender at ${shortTime(acceptedAt)}. ${o.shipmentId} is covered.`,
      });
    }
  }

  // Went dark mid route, then came back. Ocean and air get a longer window.
  if (o.pickup) {
    const blackoutHours =
      SLA.trackingBlackoutHoursByMode[o.mode] ?? SLA.trackingBlackoutHours;
    const pings = partnerPings(o);
    for (let i = 1; i < pings.length; i++) {
      const prev = pings[i - 1];
      const next = pings[i];
      const deadline = addHours(prev.at, blackoutHours);
      if (ms(next.at) > ms(deadline)) {
        out.push({
          exceptionId: `TRACKING_BLACKOUT:${o.shipmentId}`,
          type: "TRACKING_BLACKOUT",
          key: o.shipmentId,
          shipmentId: o.shipmentId,
          detectedAt: deadline,
          closedAt: next.at,
          closeText: `${partner} checked in from ${next.where} at ${shortTime(next.at)}. Tracking is live again.`,
        });
        break; // one blackout run per shipment keeps the ids stable
      }
    }
  }

  // POD landed, just late.
  const podAt = firstEventAt(o, "pod.filed");
  if (o.delivery && o.pod && podAt) {
    const deadline = addHours(o.delivery.at, SLA.podHours);
    if (ms(podAt) > ms(deadline)) {
      out.push({
        exceptionId: `POD_MISSING:${o.shipmentId}`,
        type: "POD_MISSING",
        key: o.shipmentId,
        shipmentId: o.shipmentId,
        detectedAt: deadline,
        closedAt: podAt,
        closeText: `${partner} filed ${o.pod.docId} at ${shortTime(podAt)}. ${o.shipmentId} is clear to bill.`,
        closeSavedUsd: Math.round(o.revenueUsd),
      });
    }
  }

  // Pickup happened, just late.
  if (o.tender && o.pickup) {
    const deadline = addMinutes(o.tender.pickupAppt, SLA.pickupGraceMinutes);
    if (ms(o.pickup.at) > ms(deadline)) {
      out.push({
        exceptionId: `PICKUP_MISSED:${o.shipmentId}`,
        type: "PICKUP_MISSED",
        key: o.shipmentId,
        shipmentId: o.shipmentId,
        detectedAt: deadline,
        closedAt: o.pickup.at,
        closeText: `${partner} picked up at ${shortTime(o.pickup.at)}. The freight is moving.`,
      });
    }
  }

  return out;
}

// ── run assembly ────────────────────────────────────────────────────────────

interface Scripted {
  offset: number;
  text: string;
}

function buildRun(
  issue: Issue,
  agentId: AgentId,
  shipment: ShipmentEntity | undefined,
  events: FeedEvent[],
  now: number
): AgentRun {
  const detected = issue.detectedAt;
  const closed =
    issue.closedAt && ms(issue.closedAt) <= now ? issue.closedAt : undefined;
  const stopAt = NEVER_AUTO[issue.type] ?? AGENT_TIMING.escalateMinutes;
  const escalateAt = addMinutes(detected, stopAt);

  let status: RunStatus;
  if (closed) status = "resolved";
  else if (now >= ms(escalateAt)) status = "needs_you";
  else status = "working";

  const partner = shipment?.assignment?.partner.name ?? "the partner";
  const scripted = script(issue, shipment, partner);

  const cutoff = closed ? Math.min(now, ms(closed)) : now;
  const steps: AgentStep[] = [];
  for (const s of scripted) {
    const at = addMinutes(detected, s.offset);
    if (ms(at) <= cutoff) steps.push({ at, text: s.text });
  }

  const run: AgentRun = {
    id: runId(issue),
    agentId,
    exceptionId: issue.exceptionId,
    exceptionType: issue.type,
    shipmentId: issue.shipmentId,
    title: titleOf(issue, shipment),
    status,
    startedAt: addMinutes(detected, AGENT_TIMING.pickUpMinutes),
    steps,
  };

  if (status === "resolved" && closed) {
    const text = issue.closeText ?? "Closed without anyone touching it.";
    run.steps = [...steps, { at: closed, text }];
    run.resolvedAt = closed;
    run.resolution = text;
    const saved = savedOnClose(issue, shipment);
    if (saved !== undefined) run.savedUsd = saved;
  }

  if (status === "needs_you") {
    run.steps = [
      ...steps,
      { at: escalateAt, text: handoffText(issue.type, partner) },
    ];
    run.ask = askFor(issue, shipment, partner, events);
    const held = heldMoney(issue, shipment);
    if (held !== undefined) run.savedUsd = held;
  }

  return run;
}

function activityAt(r: AgentRun): number {
  const last = r.steps.length ? r.steps[r.steps.length - 1].at : r.startedAt;
  return Math.max(ms(last), ms(r.startedAt));
}

function holdLanded(r: AgentRun, now: number): boolean {
  return now >= ms(r.startedAt); // the hold lands on the first action
}

function titleOf(issue: Issue, shipment?: ShipmentEntity): string {
  const id = issue.shipmentId ?? "";
  switch (issue.type) {
    case "TENDER_UNANSWERED":
      return `Chasing an answer on ${id}`;
    case "TRACKING_BLACKOUT":
      return `Chasing a location on ${id}`;
    case "POD_MISSING":
      return `Chasing a POD on ${id}`;
    case "PICKUP_MISSED":
      return `Chasing a pickup on ${id}`;
    case "LATE_DELIVERY":
      return `Late delivery on ${id}`;
    case "INVOICE_MISMATCH":
      return `Checking an invoice on ${id}`;
    case "CUSTOMS_HOLD":
      return `Customs hold on ${id}`;
    case "BOOKING_ROLLED":
      return `Rolled booking on ${id}`;
    case "DUPLICATE_EVENT":
      return id
        ? `Clearing a repeat message on ${id}`
        : `Clearing repeat message ${issue.key}`;
  }
  return shipment ? `Working ${shipment.shipmentId}` : "Working an issue";
}

function invoiceOf(
  issue: Issue,
  shipment?: ShipmentEntity
): InvoiceSubmittedPayload | undefined {
  if (!shipment) return undefined;
  if (issue.invoiceId) {
    const hit = shipment.invoices.find((i) => i.invoiceId === issue.invoiceId);
    if (hit) return hit;
  }
  return shipment.invoices.find(
    (i) => i.amountUsd - shipment.partnerCostUsd > SLA.invoiceToleranceUsd
  );
}

function overageOf(issue: Issue, shipment?: ShipmentEntity): number {
  const inv = invoiceOf(issue, shipment);
  if (!inv || !shipment) return 0;
  return Math.round(inv.amountUsd - shipment.partnerCostUsd);
}

function savedOnClose(
  issue: Issue,
  shipment?: ShipmentEntity
): number | undefined {
  if (issue.type === "DUPLICATE_EVENT") return undefined;
  if (issue.type === "POD_MISSING") {
    return (
      issue.closeSavedUsd ??
      (shipment ? Math.round(shipment.revenueUsd) : undefined)
    );
  }
  return issue.closeSavedUsd;
}

function heldMoney(issue: Issue, shipment?: ShipmentEntity): number | undefined {
  if (issue.type !== "INVOICE_MISMATCH") return undefined;
  const over = overageOf(issue, shipment);
  return over > 0 ? over : undefined;
}

// ── what each agent does, step by step ──────────────────────────────────────

function script(
  issue: Issue,
  shipment: ShipmentEntity | undefined,
  partner: string
): Scripted[] {
  const id = issue.shipmentId ?? issue.key;
  const P = AGENT_TIMING.pickUpMinutes;
  const F = AGENT_TIMING.firstActionMinutes;
  const S = AGENT_TIMING.secondActionMinutes;

  switch (issue.type) {
    case "DUPLICATE_EVENT":
      return [
        { offset: 0, text: `Checked ${issue.key} against the messages already processed.` },
      ];

    case "POD_MISSING":
      return [
        { offset: P, text: `Picked up the missing POD on ${id}.` },
        { offset: F, text: `Asked ${partner} to send the POD for ${id}.` },
        { offset: S, text: `Asked ${partner} a second time, copying their billing contact.` },
      ];

    case "TRACKING_BLACKOUT":
      return [
        { offset: P, text: `Picked up the tracking gap on ${id}.` },
        { offset: F, text: `Asked ${partner} for a check call on ${id}.` },
        { offset: S, text: `Asked ${partner} for a check call again, no answer yet.` },
      ];

    case "TENDER_UNANSWERED":
      return [
        { offset: P, text: `Picked up the unanswered tender on ${id}.` },
        { offset: F, text: `Sent ${partner} a follow up on the tender for ${id}.` },
        { offset: S, text: `Sent ${partner} a final follow up on ${id}.` },
      ];

    case "PICKUP_MISSED":
      return [
        { offset: P, text: `Picked up the missed pickup on ${id}.` },
        { offset: F, text: `Asked ${partner} for a new pickup time on ${id}.` },
        { offset: S, text: `Asked ${partner} again, still no truck at the dock.` },
      ];

    case "LATE_DELIVERY": {
      const cust = shipment?.customer ?? "the customer";
      return [
        { offset: P, text: `Picked up the late delivery on ${id}.` },
        {
          offset: F,
          text: `Pulled the delivery facts together and drafted a note to ${cust}.`,
        },
      ];
    }

    case "CUSTOMS_HOLD":
      // Hands off at the first action, so the packet is ready by then.
      return [
        { offset: P, text: `Picked up the customs hold on ${id}.` },
        { offset: F, text: `Pulled the entry status from the broker desk on ${id}.` },
        {
          offset: F,
          text: `Built the doc packet: commercial invoice, packing list, and entry number.`,
        },
      ];

    case "BOOKING_ROLLED":
      return [
        { offset: P, text: `Picked up the rolled booking on ${id}.` },
        { offset: F, text: `Confirmed the new vessel and ETD with ${partner}.` },
        { offset: S, text: `Pulled the next two sailing options with cutoffs.` },
      ];

    case "INVOICE_MISMATCH": {
      const inv = invoiceOf(issue, shipment);
      const invId = inv?.invoiceId ?? issue.invoiceId ?? "the invoice";
      const over = overageOf(issue, shipment);
      const agreed = shipment ? usd(shipment.partnerCostUsd) : "the agreed rate";
      const billed = inv ? usd(inv.amountUsd) : "the billed amount";
      return [
        { offset: P, text: `Picked up invoice ${invId} on ${id}.` },
        {
          offset: F,
          text: `Put ${invId} on hold so nothing pays out. ${usd(over)} is protected.`,
        },
        {
          offset: S,
          text: `Built the dispute file: agreed ${agreed}, billed ${billed}, over by ${usd(over)}.`,
        },
      ];
    }
  }
  return [];
}

function handoffText(type: ExceptionType, partner: string): string {
  switch (type) {
    case "POD_MISSING":
      return `No POD after two asks. Handing this to you.`;
    case "TRACKING_BLACKOUT":
      return `${partner} is still dark after two asks. Handing this to you.`;
    case "TENDER_UNANSWERED":
      return `${partner} is still silent. Booking anyone else costs money, so this is your call.`;
    case "PICKUP_MISSED":
      return `Still no pickup and no new time. Handing this to you.`;
    case "LATE_DELIVERY":
      return `The draft is ready. Telling the customer is your call.`;
    case "INVOICE_MISMATCH":
      return `Hold is on and the file is built. Approving or short paying is your call.`;
    case "CUSTOMS_HOLD":
      return `Only a person talks to customs. The packet is ready.`;
    case "BOOKING_ROLLED":
      return `Taking a new sailing changes the promise to the customer. That is your call.`;
    default:
      return `Handing this to you.`;
  }
}

// ── the ask: what a person actually has to decide ───────────────────────────

function askFor(
  issue: Issue,
  shipment: ShipmentEntity | undefined,
  partner: string,
  events: FeedEvent[]
): HumanAsk {
  const id = issue.shipmentId ?? issue.key;
  const cust = shipment?.customer ?? "the customer";
  const revenue = shipment ? usd(shipment.revenueUsd) : "the shipment revenue";
  const cost = shipment ? usd(shipment.partnerCostUsd) : "the agreed rate";

  switch (issue.type) {
    case "TENDER_UNANSWERED": {
      const backup = backupPartner(partner, events);
      const pickupAppt = shipment?.tender?.pickupAppt;
      const opts: FixOption[] = [
        {
          label: `Book ${backup} instead`,
          detail: `They run this lane and would cover ${id} today. Budget on this shipment is ${cost}, so expect to pay a little over.`,
          recommended: true,
        },
        {
          label: `Give ${partner} one more hour`,
          detail: pickupAppt
            ? `Pickup is not until ${shortTime(pickupAppt)}, so there is still room.`
            : `There may still be room before pickup, but you are betting on silence.`,
        },
        {
          label: `Call ${partner} dispatch`,
          detail: `A phone call gets a yes or no faster than another message.`,
        },
      ];
      return {
        why: `${partner} has not answered, and booking anyone else costs money, so that call is yours.`,
        options: opts,
      };
    }

    case "TRACKING_BLACKOUT": {
      const appt = shipment?.tender?.deliveryAppt;
      return {
        why: `${partner} has not checked in after two asks, so nobody can tell ${cust} where ${id} is.`,
        options: [
          {
            label: `Call ${partner} dispatch for a location`,
            detail: appt
              ? `Delivery on ${id} is due ${shortTime(appt)}, so you need a real location now.`
              : `You need a real location before ${cust} asks for one.`,
            recommended: true,
          },
          {
            label: `Tell ${cust} the shipment is running dark`,
            detail: `Get ahead of it before ${cust} calls you about ${id}.`,
          },
          {
            label: `Wait for the next check call`,
            detail: `Costs nothing, but you stay blind on ${revenue} of freight.`,
          },
        ],
      };
    }

    case "POD_MISSING":
      return {
        why: `${partner} has not sent the POD after two asks, and ${cust} cannot be billed without it.`,
        options: [
          {
            label: `Call ${partner} for the POD on ${id}`,
            detail: `${revenue} of billing is sitting until that paperwork lands.`,
            recommended: true,
          },
          {
            label: `Hold ${partner} payment until the POD arrives`,
            detail: `Gives ${partner} a reason to send it today instead of next week.`,
          },
          {
            label: `Bill ${cust} without the POD`,
            detail: `Faster, but ${cust} can sit on the invoice until the proof shows up.`,
          },
        ],
      };

    case "PICKUP_MISSED": {
      const appt = shipment?.tender?.deliveryAppt;
      return {
        why: `${partner} has not given a new pickup time, and the freight for ${cust} is still on the dock.`,
        options: [
          {
            label: `Reassign ${id} to another partner`,
            detail: appt
              ? `Delivery is due ${shortTime(appt)}. A replacement will cost more than the ${cost} agreed, but it saves the appointment.`
              : `A replacement will cost more than the ${cost} agreed, but it saves the appointment.`,
            recommended: true,
          },
          {
            label: `Call ${partner} dispatch first`,
            detail: `Find out if a truck is actually coming before you spend money.`,
          },
          {
            label: `Push the pickup and reset ${cust}`,
            detail: `Move the appointment and give ${cust} a new delivery time today.`,
          },
        ],
      };
    }

    case "LATE_DELIVERY": {
      const appt = shipment?.tender?.deliveryAppt;
      const delivered = shipment?.delivery?.at;
      const when = delivered
        ? `It was delivered at ${shortTime(delivered)}.`
        : `We do not have a confirmed new time yet and will send one as soon as ${partner} gives it.`;
      const draft =
        `Hello ${cust} team, shipment ${id} did not make its ${appt ? shortTime(appt) : "scheduled"} ` +
        `appointment. ${when} We are in direct contact with ${partner} and will confirm every update ` +
        `as it comes in. Thank you for your patience, and please tell us if this changes anything on ` +
        `your side. Aequus Ops, Tomball, Texas.`;
      return {
        why: `Telling ${cust} that ${id} is late is a relationship call, so it is yours.`,
        draft,
        options: [
          {
            label: `Send the notice to ${cust} now`,
            detail: `The draft is ready and it gives ${cust} the facts with no excuses.`,
            recommended: true,
          },
          {
            label: `Wait for a new ETA from ${partner}`,
            detail: `You may end up telling ${cust} twice.`,
          },
          {
            label: `Call ${cust} instead of sending the note`,
            detail: `On ${revenue} of freight, a phone call usually lands better.`,
          },
        ],
      };
    }

    case "CUSTOMS_HOLD": {
      const appt = shipment?.tender?.deliveryAppt;
      const reason = shipment?.customsHold?.reason ?? "a CBP exam";
      const draft =
        `Hello ${cust} team, shipment ${id} is held at customs. The reason on the entry is ${reason}. ` +
        `Nothing moves until the hold clears, so the delivery date is at risk. We have the doc packet ` +
        `ready for the broker desk and will confirm every update as it comes in. Thank you for your ` +
        `patience. Aequus Ops, Tomball, Texas.`;
      return {
        why: `Only a person can talk to customs, so clearing ${id} is your call. The packet is ready.`,
        draft,
        options: [
          {
            label: `Send the doc packet to the broker desk now`,
            detail: `The commercial invoice, packing list, and entry number are ready to file.`,
            recommended: true,
          },
          {
            label: `Ask CBP for exam status`,
            detail: `Find out where ${id} sits in the exam line before you tell ${cust} anything.`,
          },
          {
            label: `Warn ${cust} the delivery date is at risk`,
            detail: appt
              ? `Delivery was set for ${shortTime(appt)}. The draft gives ${cust} the facts with no excuses.`
              : `The draft gives ${cust} the facts with no excuses.`,
          },
        ],
      };
    }

    case "BOOKING_ROLLED": {
      const rolled = shipment?.rolled;
      const toVessel = rolled?.toVessel ?? "the next vessel";
      const draft =
        `Hello ${cust} team, the ocean booking for shipment ${id} was rolled to ${toVessel}. ` +
        `We are holding the confirmed slot at the agreed rate and will confirm the new sailing date ` +
        `as it firms up. Please tell us if this changes anything on your side. Aequus Ops, Tomball, Texas.`;
      return {
        why: `Taking a new sailing changes the promise to ${cust}, so that call is yours.`,
        draft,
        options: [
          {
            label: `Hold the confirmed slot on ${toVessel}`,
            detail: `Keeps the cost at the agreed ${cost} and takes the space you already have.`,
            recommended: true,
          },
          {
            label: `Pay for the earlier premium sailing`,
            detail: `Gets ${id} moving sooner, but it adds around $1,400 to the cost.`,
          },
          {
            label: `Call ${partner} first`,
            detail: `Ask what other space is open before you decide.`,
          },
        ],
      };
    }

    case "INVOICE_MISMATCH": {
      const inv = invoiceOf(issue, shipment);
      const invId = inv?.invoiceId ?? issue.invoiceId ?? "this invoice";
      const over = overageOf(issue, shipment);
      const margin = shipment
        ? Math.round(shipment.revenueUsd - shipment.partnerCostUsd)
        : 0;
      const acc = inv?.accessorials?.[0]?.desc;
      return {
        why: `Approving or short paying ${invId} moves money, so a person has to decide.`,
        options: [
          {
            label: `Short pay to the agreed rate`,
            detail: `Pay ${cost}, the rate ${partner} agreed to, and send them the dispute file. Saves ${usd(over)}.`,
            recommended: true,
          },
          {
            label: `Pay it in full`,
            detail: `Costs ${usd(over)} of margin on a shipment that made ${usd(margin)}.`,
          },
          {
            label: `Call ${partner} first`,
            detail: acc
              ? `Ask whether the ${acc.toLowerCase()} was real before you decide.`
              : `Ask about the extra charges before you decide.`,
          },
        ],
      };
    }
  }

  return {
    why: `This one needs a person.`,
    options: [
      { label: `Review ${id}`, detail: `Open the shipment and decide.`, recommended: true },
      { label: `Leave it for now`, detail: `Nothing changes until someone looks.` },
    ],
  };
}

/**
 * Pick a partner from the network that is not the silent one, deterministically:
 * the first other partner seen in the feed.
 */
function backupPartner(silent: string, events: FeedEvent[]): string {
  const names: string[] = [];
  for (const e of events) {
    const p = (e.payload as { partner?: { name?: string } }).partner;
    const name = p?.name;
    if (name && name !== silent && !names.includes(name)) names.push(name);
  }
  names.sort();
  return names[0] ?? "a backup partner";
}
