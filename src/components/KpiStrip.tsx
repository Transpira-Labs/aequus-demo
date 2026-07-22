"use client";

import { useMemo } from "react";
import { CircleCheck, CircleAlert } from "lucide-react";
import type { GraphState } from "@/lib/types";
import { SLA } from "@/lib/types";
import type { AgentState } from "@/lib/agentTypes";
import { InfoBubble } from "./InfoBubble";
import { compactMoney, int } from "./util";

/**
 * The day at a glance, in one sentence, not a wall of counters.
 * One status statement carries the meaning; two quiet facts back it up.
 */
export function KpiStrip({
  state,
  agents,
}: {
  state: GraphState;
  agents?: AgentState;
}) {
  const m = useMemo(() => {
    const shipments = Object.values(state.shipments);
    const total = shipments.length;

    let critical = 0;
    let warning = 0;
    let atRisk = 0;
    const serious = new Set<string>();
    for (const ex of state.exceptions) {
      if (ex.severity === "critical") critical++;
      else if (ex.severity === "warning") warning++;
      if (ex.severity !== "info") serious.add(ex.id);
      atRisk += ex.estimatedImpactUsd ?? 0;
    }
    const needsAttention = critical + warning;
    // A shipment with only FYI-level notes still counts as on track.
    const onTrack = shipments.filter(
      (s) => !s.exceptionIds.some((id) => serious.has(id))
    ).length;

    // On-time so far: of the shipments that have delivered, how many landed by
    // the appointment (with a short grace window).
    const grace = SLA.deliveryGraceMinutes * 60_000;
    let delivered = 0;
    let onTime = 0;
    for (const s of shipments) {
      if (!s.delivery || !s.tender) continue;
      delivered++;
      const arrived = Date.parse(s.delivery.at);
      const appt = Date.parse(s.tender.deliveryAppt);
      if (arrived <= appt + grace) onTime++;
    }

    return { total, critical, needsAttention, atRisk, onTrack, delivered, onTime };
  }, [state.shipments, state.exceptions]);

  const healthy = m.needsAttention === 0;
  const color = healthy
    ? "var(--color-healthy)"
    : m.critical > 0
    ? "var(--color-critical)"
    : "var(--color-warning)";

  const headline = healthy
    ? m.total === 0
      ? "Waiting for the day to start"
      : "All caught up"
    : m.needsAttention === 1
    ? "1 issue needs a look"
    : `${m.needsAttention} issues need a look`;

  const subline = healthy
    ? m.total === 0
      ? "Shipments will show up here once customers book them."
      : "Aequus Ops and the partners agree on every shipment."
    : m.critical > 0
    ? `${m.critical} of them ${m.critical === 1 ? "is" : "are"} urgent.`
    : "Nothing urgent yet.";

  const pct = m.total === 0 ? 100 : (m.onTrack / m.total) * 100;

  const handled = agents?.handledWithoutYou ?? 0;
  const saved = agents?.savedUsd ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[var(--radius)] border border-border bg-card px-5 py-4 soft-shadow">
      {/* the one thing to read */}
      <div className="flex min-w-0 items-center gap-3">
        {healthy ? (
          <CircleCheck className="h-6 w-6 shrink-0" style={{ color }} />
        ) : (
          <CircleAlert className="h-6 w-6 shrink-0" style={{ color }} />
        )}
        <div className="min-w-0">
          <p className="display-tight truncate text-[1.05rem] font-semibold text-foreground">
            {headline}
          </p>
          <p className="truncate text-[0.8rem] text-muted-foreground">
            {subline}
          </p>
        </div>
      </div>

      <span className="grow" />

      {/* quiet supporting facts */}
      <div className="flex items-center gap-8">
        <div>
          <p className="text-[0.72rem] font-medium text-muted-foreground">
            Shipments on track
          </p>
          <div className="mt-1 flex items-center gap-2.5">
            <span className="display-tight text-[0.95rem] font-semibold text-foreground tnum">
              {int(m.onTrack)} of {int(m.total)}
            </span>
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${pct}%`,
                  backgroundColor:
                    pct === 100 ? "var(--color-healthy)" : "var(--color-accent)",
                }}
              />
            </span>
          </div>
        </div>

        <div>
          <p className="flex items-center gap-1 text-[0.72rem] font-medium text-muted-foreground">
            At risk
            <InfoBubble label="How at risk is worked out" align="right">
              The money riding on the open issues. For a late or stuck
              shipment that is what the customer is paying for it. For an
              invoice it is
              the amount billed over the agreed rate. It is an estimate of
              exposure, not a loss you have taken.
            </InfoBubble>
          </p>
          <p
            className="display-tight mt-1 text-[0.95rem] font-semibold tnum"
            style={{
              color:
                m.atRisk > 0 ? "var(--color-warning)" : "var(--color-foreground)",
            }}
          >
            {m.atRisk > 0 ? `≈ ${compactMoney(m.atRisk)}` : "$0"}
          </p>
        </div>

        {m.delivered > 0 && (
          <div className="hidden xl:block">
            <p className="text-[0.72rem] font-medium text-muted-foreground">
              On time so far
            </p>
            <p className="mt-1 text-[0.95rem] font-semibold text-foreground tnum">
              {int(m.onTime)} of {int(m.delivered)} delivered
            </p>
          </div>
        )}

        {handled > 0 && (
          <div className="hidden xl:block">
            <p className="text-[0.72rem] font-medium text-muted-foreground">
              Handled by AI agents
            </p>
            <p
              className="mt-1 text-[0.95rem] font-semibold tnum"
              style={{ color: "var(--color-healthy)" }}
            >
              {int(handled)} {handled === 1 ? "issue" : "issues"}
              {saved > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · {compactMoney(saved)} saved
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
