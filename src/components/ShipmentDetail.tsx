"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Check } from "lucide-react";
import type {
  ExceptionRecord,
  FeedEvent,
  ShipmentEntity,
  DeliveryCompletedPayload,
  InvoiceSubmittedPayload,
} from "@/lib/types";
import { YOU, type Assignment, type AssignmentMap } from "@/lib/assignments";
import { EvidenceStitch } from "./EvidenceStitch";
import { StatusChip, SourceChip, SlaTag, FrequencyTag, ModeBadge } from "./chips";
import {
  docType,
  formatTime,
  summarize,
  eventVerb,
  money,
  laneOf,
  severityColor,
  softBg,
  systemColor,
  modeColor,
  isInternational,
  exceptionTypeLabel,
  pickupMilestoneLabel,
  deliveryMilestoneLabel,
} from "./util";

type RailNode =
  | { kind: "event"; ms: number; ev: FeedEvent }
  | { kind: "exception"; ms: number; ex: ExceptionRecord };

export function ShipmentDetail({
  shipment,
  exceptions,
  assignments,
  onClose,
}: {
  shipment: ShipmentEntity | null;
  exceptions: ExceptionRecord[];
  /** Who has picked up which issue, keyed by exception id. */
  assignments?: AssignmentMap;
  onClose: () => void;
}) {
  // Retain the last shipment during the slide-out so content doesn't blank.
  const [shown, setShown] = useState<ShipmentEntity | null>(shipment);
  useEffect(() => {
    if (shipment) setShown(shipment);
  }, [shipment]);

  const open = !!shipment;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* scrim */}
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-40 bg-foreground/25 backdrop-blur-[1px] transition-opacity duration-300 motion-reduce:transition-none ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={shown ? `Shipment ${shown.shipmentId}` : "Shipment detail"}
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[30rem] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-[350ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {shown && (
          <DetailBody
            shipment={shown}
            exceptions={exceptions}
            assignments={assignments}
            onClose={onClose}
          />
        )}
      </aside>
    </>
  );
}

function DetailBody({
  shipment,
  exceptions,
  assignments,
  onClose,
}: {
  shipment: ShipmentEntity;
  exceptions: ExceptionRecord[];
  assignments?: AssignmentMap;
  onClose: () => void;
}) {
  const shipmentExceptions = useMemo(
    () => exceptions.filter((e) => e.shipmentId === shipment.shipmentId),
    [exceptions, shipment.shipmentId]
  );

  const nodes = useMemo<RailNode[]>(() => {
    const evNodes: RailNode[] = shipment.events.map((ev) => ({
      kind: "event",
      ms: Date.parse(ev.occurredAt),
      ev,
    }));
    const exNodes: RailNode[] = shipmentExceptions.map((ex) => ({
      kind: "exception",
      ms: Date.parse(ex.detectedAt),
      ex,
    }));
    return [...evNodes, ...exNodes].sort((a, b) => a.ms - b.ms);
  }, [shipment.events, shipmentExceptions]);

  const t = shipment.tender;
  const partner =
    shipment.assignment?.partner ?? shipment.accepted?.partner;
  const partnerName = partner
    ? partner.code
      ? `${partner.name} · ${partner.code}`
      : partner.name
    : undefined;

  return (
    <>
      {/* header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold text-foreground">
              {shipment.shipmentId}
            </span>
            <StatusChip status={shipment.status} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ModeBadge
              mode={shipment.mode}
              international={isInternational(shipment)}
            />
            <p className="truncate text-sm text-muted-foreground">
              {shipment.customer}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-transform hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* the journey ribbon: origin to destination across the shipment's milestones */}
      <div className="border-b border-border px-5 py-4">
        <JourneyRibbon shipment={shipment} />
      </div>

      {/* facts */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border">
        <Fact label="Lane" value={laneOf(shipment)} wide />
        <Fact label="Equipment" value={t?.equipment ?? "Not listed"} />
        <Fact
          label="Pickup appt"
          value={t ? formatTime(t.pickupAppt) : "Not set"}
          mono
        />
        <Fact
          label="Delivery appt"
          value={t ? formatTime(t.deliveryAppt) : "Not set"}
          mono
        />
        <Fact label="Customer pays" value={money(shipment.revenueUsd)} mono />
        <Fact
          label="Partner gets"
          value={
            shipment.partnerCostUsd > 0
              ? money(shipment.partnerCostUsd)
              : "Not booked yet"
          }
          mono
        />
        {partnerName && <Fact label="Partner" value={partnerName} wide />}
      </div>

      {/* the cross-system rail */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="eyebrow mb-3">Aequus Ops and the partner, side by side</p>
        {nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages for this shipment yet.
          </p>
        ) : (
          <ol className="relative">
            {/* rail line */}
            <span
              className="absolute left-[7px] top-1 bottom-1 w-px bg-border"
              aria-hidden
            />
            {nodes.map((n, i) =>
              n.kind === "event" ? (
                <EventNode
                  key={`e-${n.ev.messageId}-${i}`}
                  ev={n.ev}
                  shipment={shipment}
                />
              ) : (
                <ExceptionNode
                  key={`x-${n.ex.id}`}
                  ex={n.ex}
                  assignment={assignments?.[n.ex.id]}
                />
              )
            )}
          </ol>
        )}
      </div>
    </>
  );
}

// ── Journey ribbon (signature element) ───────────────────────────────────────

type GateStatus = "hold" | "cleared" | "pending";

type RibbonNode =
  | { kind: "milestone"; label: string; reached: boolean }
  | { kind: "gate"; status: GateStatus };

/**
 * A quiet, precise ribbon from origin to destination. Milestone nodes fill in
 * the mode hue as the shipment moves. On an international shipment a customs
 * gate sits mid track: it pulses amber while a hold is open and settles to a
 * quiet check once the entry clears.
 */
function JourneyRibbon({ shipment }: { shipment: ShipmentEntity }) {
  const mode = shipment.mode;
  const hue = modeColor(mode);
  const intl = isInternational(shipment);

  const moving =
    shipment.statusUpdates.length > 0 || !!shipment.delivery;

  const milestones: RibbonNode[] = [
    { kind: "milestone", label: "Booked", reached: !!shipment.accepted },
    {
      kind: "milestone",
      label: pickupMilestoneLabel(mode),
      reached: !!shipment.pickup,
    },
    { kind: "milestone", label: "Moving", reached: moving },
    {
      kind: "milestone",
      label: deliveryMilestoneLabel(mode),
      reached: !!shipment.delivery,
    },
    { kind: "milestone", label: "POD", reached: !!shipment.pod },
  ];

  const gateStatus: GateStatus = shipment.customsCleared
    ? "cleared"
    : shipment.customsHold
    ? "hold"
    : "pending";

  const nodes: RibbonNode[] = intl
    ? [
        ...milestones.slice(0, 3),
        { kind: "gate", status: gateStatus },
        ...milestones.slice(3),
      ]
    : milestones;

  const isReached = (n: RibbonNode) =>
    n.kind === "gate" ? n.status === "cleared" : n.reached;

  // Fill runs to the last reached node. Node centers sit at (i+0.5)/N across
  // the track, so the connecting line insets by half a column at each end.
  const N = nodes.length;
  let lastReached = -1;
  nodes.forEach((n, i) => {
    if (isReached(n)) lastReached = i;
  });
  const insetPct = 50 / N;
  // Scale of the full track (node 0 center to node N-1 center) that is filled.
  const fillScale = lastReached > 0 ? lastReached / (N - 1) : 0;

  return (
    <div>
      <p className="eyebrow mb-3">Journey</p>
      <div className="relative">
        {/* base track */}
        <span
          aria-hidden
          className="absolute top-[9px] h-0.5 rounded-full bg-border"
          style={{ left: `${insetPct}%`, right: `${insetPct}%` }}
        />
        {/* filled track, tinted by mode */}
        <span
          aria-hidden
          className="absolute top-[9px] h-0.5 origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{
            left: `${insetPct}%`,
            right: `${insetPct}%`,
            transform: `scaleX(${fillScale})`,
            backgroundColor: hue,
          }}
        />
        <ol className="relative flex items-start">
          {nodes.map((n, i) =>
            n.kind === "gate" ? (
              <CustomsGate key={`gate-${i}`} status={n.status} />
            ) : (
              <MilestoneNode
                key={`m-${i}`}
                label={n.label}
                reached={n.reached}
                hue={hue}
              />
            )
          )}
        </ol>
      </div>
    </div>
  );
}

function MilestoneNode({
  label,
  reached,
  hue,
}: {
  label: string;
  reached: boolean;
  hue: string;
}) {
  return (
    <li className="flex flex-1 flex-col items-center gap-1.5 px-0.5">
      <span
        className="h-[18px] w-[18px] rounded-full border-2 bg-card"
        style={{
          borderColor: reached ? hue : "var(--color-border)",
          backgroundColor: reached ? hue : "var(--color-card)",
        }}
        aria-hidden
      />
      <span
        className={`text-center text-[0.62rem] font-semibold leading-tight ${
          reached ? "text-foreground" : "text-muted-foreground/70"
        }`}
      >
        {label}
      </span>
    </li>
  );
}

function CustomsGate({ status }: { status: GateStatus }) {
  const amber = "var(--color-warning)";
  const green = "var(--color-healthy)";

  if (status === "cleared") {
    return (
      <li className="flex flex-1 flex-col items-center gap-1.5 px-0.5">
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
          style={{ backgroundColor: green }}
          aria-hidden
        >
          <Check className="h-3 w-3 text-white" />
        </span>
        <span
          className="text-center text-[0.62rem] font-semibold leading-tight"
          style={{ color: green }}
        >
          Cleared
        </span>
      </li>
    );
  }

  const holdOpen = status === "hold";
  return (
    <li className="flex flex-1 flex-col items-center gap-1.5 px-0.5">
      <span
        className={`h-[18px] w-[18px] rounded-[5px] border-2 ${
          holdOpen ? "customs-gate-pulse" : ""
        }`}
        style={{
          borderColor: amber,
          backgroundColor: holdOpen ? amber : "var(--color-card)",
        }}
        aria-hidden
      />
      <span
        className="text-center text-[0.62rem] font-semibold leading-tight"
        style={{ color: holdOpen ? amber : "var(--color-muted-foreground)" }}
      >
        {holdOpen ? "Customs hold" : "Customs"}
      </span>
    </li>
  );
}

function Fact({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`bg-card px-4 py-2.5 ${wide ? "col-span-2" : ""}`}>
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-0.5 text-sm font-semibold text-foreground ${
          mono ? "font-mono tnum" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Compare an actual delivery time to the appointment, in plain words. */
function deliveryVsAppt(actualISO: string, apptISO: string): string {
  const diffMin = Math.round(
    (Date.parse(actualISO) - Date.parse(apptISO)) / 60_000
  );
  const abs = Math.abs(diffMin);
  const span =
    abs >= 60
      ? `${Math.floor(abs / 60)}h ${abs % 60 ? `${abs % 60}m` : ""}`.trim()
      : `${abs}m`;
  if (diffMin > 15) return `${span} late`;
  if (diffMin < -15) return `${span} early`;
  return "on time";
}

function EventNode({
  ev,
  shipment,
}: {
  ev: FeedEvent;
  shipment: ShipmentEntity;
}) {
  const color = systemColor(ev.source);

  // A few event types get a richer, shipment-aware one-liner in the rail.
  let detail = summarize(ev);
  if (ev.type === "delivery.completed" && shipment.tender) {
    const p = ev.payload as DeliveryCompletedPayload;
    const cmp = deliveryVsAppt(p.at, shipment.tender.deliveryAppt);
    detail = `${summarize(ev)} · ${cmp}`;
  } else if (ev.type === "invoice.submitted" && shipment.partnerCostUsd > 0) {
    const p = ev.payload as InvoiceSubmittedPayload;
    const over = Math.round(p.amountUsd - shipment.partnerCostUsd);
    if (over > 0) detail = `${summarize(ev)} · ${money(over)} over agreed`;
    else if (over < 0)
      detail = `${summarize(ev)} · ${money(-over)} under agreed`;
    else detail = `${summarize(ev)} · matches agreed`;
  }

  return (
    <li className="relative flex gap-3 pb-4 pl-6">
      <span
        className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 bg-card"
        style={{ borderColor: color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <SourceChip source={ev.source} short />
          <span className="font-mono text-[0.72rem] font-semibold text-foreground">
            {docType(ev.type)}
          </span>
          <span className="text-[0.82rem] font-semibold text-foreground">
            {eventVerb(ev.type, shipment.mode)}
          </span>
          <span className="grow" />
          <span className="font-mono text-[0.72rem] text-muted-foreground tnum">
            {formatTime(ev.occurredAt)}
          </span>
        </div>
        <p className="mt-0.5 text-[0.8rem] text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

function ExceptionNode({
  ex,
  assignment,
}: {
  ex: ExceptionRecord;
  assignment?: Assignment;
}) {
  const color = severityColor(ex.severity);
  return (
    <li className="relative flex gap-3 pb-4 pl-6">
      <span
        className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2"
        style={{ borderColor: color, backgroundColor: color }}
        aria-hidden
      />
      <div
        className="min-w-0 flex-1 rounded-[var(--radius)] border p-3"
        style={{
          borderColor: softBg(color, 35),
          backgroundColor: softBg(color, 7),
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em]"
            style={{ color }}
          >
            {exceptionTypeLabel(ex.type)}
          </span>
          <span className="grow" />
          <span className="font-mono text-[0.72rem] text-muted-foreground tnum">
            {formatTime(ex.detectedAt)}
          </span>
        </div>
        <p className="mt-1 text-[0.82rem] font-semibold text-foreground">
          {ex.title}
        </p>
        <p className="mt-0.5 text-[0.8rem] leading-relaxed text-muted-foreground">
          {ex.narrative}
        </p>
        {ex.evidence.length > 0 && (
          <div className="mt-2.5">
            <EvidenceStitch evidence={ex.evidence} />
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <FrequencyTag
            frequency={ex.frequency}
            timesSeenBefore={ex.timesSeenBefore}
          />
          {ex.slaTag && <SlaTag label={ex.slaTag} />}
          {assignment && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold"
              style={{
                color: "var(--color-partner)",
                backgroundColor: softBg("var(--color-partner)", 12),
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--color-partner)" }}
              />
              In progress ·{" "}
              {assignment.person === YOU ? "you" : assignment.person}
            </span>
          )}
          {ex.estimatedImpactUsd != null && (
            <span
              className="font-mono text-[0.72rem] font-semibold tnum"
              style={{ color }}
            >
              ≈ {money(ex.estimatedImpactUsd)} at risk
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
