"use client";

import { useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";
import type { GraphState, ShipmentEntity, Severity } from "@/lib/types";
import { StatusChip, ModeBadge } from "./chips";
import { InfoBubble } from "./InfoBubble";
import {
  inService,
  serviceName,
  type ServiceKey,
} from "./ServiceFilter";
import {
  int,
  laneOf,
  severityColor,
  SEVERITY_RANK,
  isInternational,
} from "./util";

function shipmentCreationMs(s: ShipmentEntity): number {
  const first = s.events[0];
  return first ? Date.parse(first.occurredAt) : 0;
}

export function ShipmentBoard({
  state,
  selectedShipmentId,
  onSelect,
  serviceFilter = null,
}: {
  state: GraphState;
  selectedShipmentId: string | null;
  onSelect: (shipmentId: string) => void;
  serviceFilter?: ServiceKey | null;
}) {
  // The happy path lives in the client's own systems. This board earns its
  // place by showing the gaps, so clean shipments stay hidden unless asked for.
  const [showClean, setShowClean] = useState(false);

  const severityById = useMemo(() => {
    const m = new Map<string, Severity>();
    for (const ex of state.exceptions) m.set(ex.id, ex.severity);
    return m;
  }, [state.exceptions]);

  const allShipments = useMemo(() => {
    return Object.values(state.shipments)
      .filter((s) => !serviceFilter || inService(s, serviceFilter))
      .sort((a, b) => shipmentCreationMs(b) - shipmentCreationMs(a));
  }, [state.shipments, serviceFilter]);

  const withIssues = useMemo(
    () => allShipments.filter((s) => s.exceptionIds.length > 0),
    [allShipments]
  );

  const shipments = showClean ? allShipments : withIssues;
  const cleanCount = allShipments.length - withIssues.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius)] border border-border bg-card soft-shadow">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-foreground">
            Shipments that need work
          </h2>
          <InfoBubble label="About the shipments board">
            Shipments where what Aequus Ops promised and what the partner
            network did have stopped matching. Shipments running clean are not
            repeated here; your own systems already show them. Flip the switch
            to see today&apos;s full list anyway.
          </InfoBubble>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[0.76rem] text-muted-foreground tnum">
            {showClean
              ? `${int(allShipments.length)} today`
              : `${int(withIssues.length)} of ${int(allShipments.length)} today`}
          </span>
          <button
            type="button"
            onClick={() => setShowClean((v) => !v)}
            aria-pressed={showClean}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${
              showClean
                ? "border-transparent bg-muted text-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {showClean
              ? "Hide clean shipments"
              : `Show ${int(cleanCount)} clean`}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shipments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <PackageSearch className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {allShipments.length === 0
                ? serviceFilter
                  ? `Nothing under ${serviceName(serviceFilter)} yet`
                  : "Waiting for the day to start"
                : "Every shipment is running clean"}
            </p>
            <p className="mt-1 max-w-[18rem] text-[0.8rem] text-muted-foreground">
              {allShipments.length === 0
                ? serviceFilter
                  ? "Pick another service in the filter menu, or All services to see the whole board."
                  : "When customers book shipments, they show up here."
                : "Nothing needs work. The full list stays in your own systems, or flip the switch above to see it here."}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                <Th className="pl-4">Shipment</Th>
                <Th>Customer</Th>
                <Th>Lane</Th>
                <Th>Status</Th>
                <Th className="pr-4 text-right">Attention</Th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const exSevs = s.exceptionIds
                  .map((id) => severityById.get(id))
                  .filter(Boolean) as Severity[];
                const top =
                  exSevs.length > 0
                    ? exSevs.reduce((a, b) =>
                        SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a
                      )
                    : null;
                const selected = selectedShipmentId === s.shipmentId;
                return (
                  <tr
                    key={s.shipmentId}
                    onClick={() => onSelect(s.shipmentId)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(s.shipmentId);
                      }
                    }}
                    className={`event-enter cursor-pointer border-b border-border/60 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                      selected ? "bg-accent/[0.06]" : "hover:bg-muted/60"
                    }`}
                  >
                    <Td className="pl-4">
                      <span className="flex flex-col gap-1">
                        <span className="font-mono text-[0.8rem] font-semibold text-foreground">
                          {s.shipmentId}
                        </span>
                        <ModeBadge
                          mode={s.mode}
                          international={isInternational(s)}
                        />
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[0.82rem] text-foreground">
                        {s.customer}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[0.8rem] text-muted-foreground whitespace-nowrap">
                        {laneOf(s)}
                      </span>
                    </Td>
                    <Td>
                      <StatusChip status={s.status} />
                    </Td>
                    <Td className="pr-4 text-right">
                      {top ? (
                        <span
                          className="inline-flex items-center gap-1.5 text-[0.76rem] font-semibold"
                          style={{ color: severityColor(top) }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: severityColor(top) }}
                          />
                          {exSevs.length === 1
                            ? "1 issue"
                            : `${exSevs.length} issues`}
                        </span>
                      ) : (
                        <span className="text-[0.76rem] text-muted-foreground/50">
                          All good
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-2 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-2 py-2.5 align-middle ${className}`}>{children}</td>;
}
