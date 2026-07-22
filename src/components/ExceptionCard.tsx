import { ArrowUpRight } from "lucide-react";
import type { ExceptionRecord } from "@/lib/types";
import type { AgentRun } from "@/lib/agentTypes";
import { AGENTS } from "@/lib/agentTypes";
import { YOU, type Assignment } from "@/lib/assignments";
import { EvidenceStitch } from "./EvidenceStitch";
import { FrequencyTag, SlaTag } from "./chips";
import {
  severityColor,
  softBg,
  compactMoney,
  formatTime,
  relativeSim,
  SEVERITY_WORD,
} from "./util";

export function ExceptionCard({
  ex,
  simTime,
  onOpenShipment,
  run,
  onOpenAgents,
  assignment,
  onAssign,
  onRelease,
}: {
  ex: ExceptionRecord;
  simTime: number;
  onOpenShipment: (shipmentId: string) => void;
  /** The agent run working this issue, when there is one. */
  run?: AgentRun;
  onOpenAgents?: () => void;
  /** Who has picked this issue up, when someone has. */
  assignment?: Assignment;
  onAssign?: () => void;
  onRelease?: () => void;
}) {
  const color = severityColor(ex.severity);

  return (
    <article
      className="event-enter relative overflow-hidden rounded-[var(--radius)] border border-border bg-card soft-shadow"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="p-3.5">
        {/* header: plain-language severity + frequency + time */}
        <div className="flex items-start justify-between gap-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
              style={{ color, backgroundColor: softBg(color, 12) }}
            >
              {SEVERITY_WORD[ex.severity]}
            </span>
            <FrequencyTag
              frequency={ex.frequency}
              timesSeenBefore={ex.timesSeenBefore}
            />
          </span>
          <span className="text-[0.72rem] text-muted-foreground tnum whitespace-nowrap">
            {relativeSim(ex.detectedAt, simTime)}
          </span>
        </div>

        {/* title + narrative */}
        <h3 className="mt-1.5 text-[0.95rem] font-semibold leading-snug text-foreground">
          {ex.title}
        </h3>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-muted-foreground">
          {ex.narrative}
        </p>

        {/* one quiet line on what the agent is doing about it */}
        {run && <AgentLine run={run} onOpenAgents={onOpenAgents} />}

        {/* who on the desk has this, so nobody works it twice */}
        {assignment && (
          <WorkLine assignment={assignment} onRelease={onRelease} />
        )}

        {/* the evidence stitch */}
        {ex.evidence.length > 0 && (
          <div className="mt-3">
            <EvidenceStitch evidence={ex.evidence} />
          </div>
        )}

        {/* footer: pickup + tags + impact + order link */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!assignment && onAssign && (
            <button
              type="button"
              onClick={onAssign}
              className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-[0.72rem] font-semibold text-muted-foreground transition-transform hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            >
              I&apos;ve got this
            </button>
          )}
          {ex.slaTag && <SlaTag label={ex.slaTag} />}
          {ex.estimatedImpactUsd != null && (
            <span
              className="text-[0.74rem] font-semibold tnum"
              style={{ color }}
            >
              ≈ {compactMoney(ex.estimatedImpactUsd)} at risk
            </span>
          )}
          <span className="grow" />
          {ex.shipmentId && (
            <button
              type="button"
              onClick={() => onOpenShipment(ex.shipmentId!)}
              className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[0.72rem] font-semibold text-accent transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            >
              {ex.shipmentId}
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-px group-hover:-translate-y-px" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * "In progress · M. Reyes picked it up at 09:38". The name goes on the issue
 * the moment someone takes it, which is what stops a second person starting
 * the same chase. Only your own pickups offer a release.
 */
function WorkLine({
  assignment,
  onRelease,
}: {
  assignment: Assignment;
  onRelease?: () => void;
}) {
  const mine = assignment.person === YOU;
  const color = "var(--color-partner)";
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.76rem] font-semibold">
      <span className="inline-flex items-center gap-1.5" style={{ color }}>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        In progress · {mine ? "you" : assignment.person} picked it up at{" "}
        {formatTime(assignment.at)}
      </span>
      {mine && onRelease && (
        <button
          type="button"
          onClick={onRelease}
          className="rounded-md px-1 py-0.5 text-[0.74rem] font-semibold text-muted-foreground underline underline-offset-2 transition-transform hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          Release
        </button>
      )}
    </p>
  );
}

function AgentLine({
  run,
  onOpenAgents,
}: {
  run: AgentRun;
  onOpenAgents?: () => void;
}) {
  // "AI agent" is spelled out so nobody reads these as a human teammate.
  const name = `AI agent ${
    AGENTS.find((a) => a.id === run.agentId)?.name ?? ""
  }`.trim();

  const color =
    run.status === "resolved" || run.status === "decided"
      ? "var(--color-healthy)"
      : run.status === "needs_you"
      ? "var(--color-critical)"
      : "var(--color-muted-foreground)";

  const text =
    run.status === "resolved"
      ? `Handled by ${name}`
      : run.status === "decided"
      ? `You handled it: ${run.decision?.optionLabel ?? "decision made"}`
      : run.status === "needs_you"
      ? `${name} needs you`
      : `${name} is on it`;

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.76rem] font-semibold">
      <span className="inline-flex items-center gap-1.5" style={{ color }}>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            run.status === "working" ? "pulse-dot" : ""
          }`}
          style={{ backgroundColor: color }}
        />
        {text}
      </span>
      {run.status === "needs_you" && onOpenAgents && (
        <button
          type="button"
          onClick={onOpenAgents}
          className="rounded-md px-1 py-0.5 text-[0.74rem] font-semibold text-accent underline underline-offset-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          See what it suggests
        </button>
      )}
    </p>
  );
}
