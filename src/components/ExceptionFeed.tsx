"use client";

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { ExceptionRecord, Severity } from "@/lib/types";
import type { AgentRun } from "@/lib/agentTypes";
import type { AssignmentMap } from "@/lib/assignments";
import { ExceptionCard } from "./ExceptionCard";
import { InfoBubble } from "./InfoBubble";

type Filter = "all" | Severity;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "critical", label: "Urgent" },
  { key: "warning", label: "Needs a look" },
  { key: "info", label: "FYI" },
];

const FILTER_COLOR: Record<Filter, string> = {
  all: "var(--color-foreground)",
  critical: "var(--color-critical)",
  warning: "var(--color-warning)",
  info: "var(--color-muted-foreground)",
};

export function ExceptionFeed({
  exceptions,
  simTime,
  onOpenShipment,
  runByException,
  onOpenAgents,
  embedded = false,
  totalToday,
  assignments,
  onAssign,
  onRelease,
}: {
  /** Issues inside the current time scope. */
  exceptions: ExceptionRecord[];
  simTime: number;
  onOpenShipment: (shipmentId: string) => void;
  /** What an agent is doing about each issue, keyed by exception id. */
  runByException?: Map<string, AgentRun>;
  onOpenAgents?: () => void;
  /** Inside the tabbed panel the card chrome and title come from the parent. */
  embedded?: boolean;
  /** Today's full issue count, so a narrowed scope can say what it hides. */
  totalToday?: number;
  /** Who has picked up which issue, keyed by exception id. */
  assignments?: AssignmentMap;
  onAssign?: (exceptionId: string) => void;
  onRelease?: (exceptionId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c = { all: exceptions.length, critical: 0, warning: 0, info: 0 };
    for (const e of exceptions) c[e.severity]++;
    return c as Record<Filter, number>;
  }, [exceptions]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? exceptions
        : exceptions.filter((e) => e.severity === filter),
    [exceptions, filter]
  );

  return (
    <div
      className={
        embedded
          ? "flex min-h-0 flex-1 flex-col"
          : "flex min-h-0 flex-1 flex-col rounded-[var(--radius)] border border-border bg-card soft-shadow"
      }
    >
      {/* header: the tab strip already names the panel when embedded */}
      {!embedded && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-foreground">
              Needs attention
            </h2>
            <InfoBubble label="About needs attention">
              <FeedExplainer />
            </InfoBubble>
          </div>
        </div>
      )}

      {/* filter row. When embedded, the bubble rides along here so the panel
          does not need a second header line. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const color = FILTER_COLOR[f.key];
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${
                active
                  ? "border-transparent"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
              style={
                active
                  ? {
                      color,
                      backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
                    }
                  : undefined
              }
              aria-pressed={active}
            >
              {f.label}
              <span className="font-mono tnum text-[0.7rem] opacity-80">
                {counts[f.key]}
              </span>
            </button>
          );
        })}
        {embedded && (
          <span className="ml-auto">
            <InfoBubble label="About needs attention" align="right">
              <FeedExplainer />
            </InfoBubble>
          </span>
        )}
      </div>

      {/* cards */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <EmptyState
            hasAny={exceptions.length > 0}
            scopedOut={(totalToday ?? exceptions.length) - exceptions.length}
          />
        ) : (
          visible.map((ex) => (
            <ExceptionCard
              key={ex.id}
              ex={ex}
              simTime={simTime}
              onOpenShipment={onOpenShipment}
              run={runByException?.get(ex.id)}
              onOpenAgents={onOpenAgents}
              assignment={assignments?.[ex.id]}
              onAssign={onAssign && (() => onAssign(ex.id))}
              onRelease={onRelease && (() => onRelease(ex.id))}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FeedExplainer() {
  return (
    <>
      Spots where what Aequus Ops promised and what the partner network did
      stopped lining up. Urgent means money or a customer promise is on the
      line right now. Needs a look means it is slipping. FYI is worth knowing
      but costs nothing today. Each issue also says how often the pattern comes
      up here: common and uncommon come from this operation&apos;s own history,
      and new pattern means the layer caught something it has not seen before.
      Press &ldquo;I&apos;ve got this&rdquo; to put your name on an issue; once
      a name is on it, nobody else on the desk starts the same chase.
    </>
  );
}

function EmptyState({
  hasAny,
  scopedOut,
}: {
  hasAny: boolean;
  /** Issues that exist today but sit outside the current time window. */
  scopedOut: number;
}) {
  const title = hasAny
    ? "Nothing here right now"
    : scopedOut > 0
    ? "Nothing in this time window"
    : "All clear";
  const body = hasAny
    ? "No issues in this bucket."
    : scopedOut > 0
    ? `${scopedOut} earlier ${
        scopedOut === 1 ? "issue is" : "issues are"
      } outside this window. Widen it to see them.`
    : "Aequus Ops and the partners agree. Every shipment matches what the partner actually did.";
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-healthy-soft">
        <ShieldCheck className="h-5 w-5" style={{ color: "var(--color-healthy)" }} />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-[16rem] text-[0.8rem] text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
