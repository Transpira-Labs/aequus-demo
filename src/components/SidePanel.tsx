"use client";

import type { ExceptionRecord, FeedEvent } from "@/lib/types";
import type { AssignmentMap } from "@/lib/assignments";
import type {
  AgentId,
  AgentRun,
  AgentState,
  AgentToggles,
} from "@/lib/agentTypes";
import { ExceptionFeed } from "./ExceptionFeed";
import { AgentPanel } from "./AgentPanel";
import { EventLedger } from "./EventLedger";
import { softBg } from "./util";

export type SideTab = "issues" | "agents" | "network";

/**
 * The right column: the issue feed, the agent window, and the network traffic
 * ledger, behind three tabs. The panel owns the card chrome and scrolls inside
 * itself, so the fixed height below lg keeps holding.
 */
export function SidePanel({
  tab,
  onTabChange,
  events,
  totalEvents,
  exceptions,
  totalExceptions,
  simTime,
  onOpenShipment,
  agents,
  toggles,
  onToggleAgent,
  runByException,
  onDecide,
  onUndoDecision,
  assignments,
  onAssign,
  onRelease,
}: {
  tab: SideTab;
  onTabChange: (t: SideTab) => void;
  /** Feed messages inside the current time scope. */
  events: FeedEvent[];
  /** Everything ingested today, regardless of scope. */
  totalEvents: number;
  /** Issues inside the current time scope. */
  exceptions: ExceptionRecord[];
  /** Today's full issue count, regardless of scope. */
  totalExceptions: number;
  simTime: number;
  onOpenShipment: (shipmentId: string) => void;
  agents: AgentState;
  toggles: AgentToggles;
  onToggleAgent: (id: AgentId) => void;
  runByException: Map<string, AgentRun>;
  onDecide: (runId: string, optionLabel: string) => void;
  onUndoDecision: (runId: string) => void;
  /** Who has picked up which issue, keyed by exception id. */
  assignments: AssignmentMap;
  onAssign: (exceptionId: string) => void;
  onRelease: (exceptionId: string) => void;
}) {
  const needsYou = agents.totals.needsYou;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card soft-shadow">
      <div
        role="tablist"
        aria-label="Control tower panels"
        className="flex shrink-0 gap-1.5 border-b border-border px-3 py-2"
      >
        <Tab
          id="issues"
          label="Needs attention"
          count={exceptions.length}
          selected={tab === "issues"}
          onSelect={onTabChange}
        />
        <Tab
          id="agents"
          label="AI agents"
          count={needsYou}
          countColor={
            needsYou > 0 ? "var(--color-critical)" : "var(--color-muted-foreground)"
          }
          selected={tab === "agents"}
          onSelect={onTabChange}
        />
        <Tab
          id="network"
          label="Network"
          count={events.length}
          selected={tab === "network"}
          onSelect={onTabChange}
        />
      </div>

      <div
        role="tabpanel"
        id="panel-issues"
        aria-labelledby="tab-issues"
        hidden={tab !== "issues"}
        className={tab === "issues" ? "flex min-h-0 flex-1 flex-col" : ""}
      >
        {tab === "issues" && (
          <ExceptionFeed
            exceptions={exceptions}
            totalToday={totalExceptions}
            simTime={simTime}
            onOpenShipment={onOpenShipment}
            runByException={runByException}
            onOpenAgents={() => onTabChange("agents")}
            assignments={assignments}
            onAssign={onAssign}
            onRelease={onRelease}
            embedded
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-agents"
        aria-labelledby="tab-agents"
        hidden={tab !== "agents"}
        className={tab === "agents" ? "flex min-h-0 flex-1 flex-col" : ""}
      >
        {tab === "agents" && (
          <AgentPanel
            agents={agents}
            toggles={toggles}
            onToggle={onToggleAgent}
            onOpenShipment={onOpenShipment}
            onDecide={onDecide}
            onUndoDecision={onUndoDecision}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-network"
        aria-labelledby="tab-network"
        hidden={tab !== "network"}
        className={tab === "network" ? "flex min-h-0 flex-1 flex-col" : ""}
      >
        {tab === "network" && (
          <EventLedger events={events} totalToday={totalEvents} embedded />
        )}
      </div>
    </div>
  );
}

function Tab({
  id,
  label,
  count,
  countColor,
  selected,
  onSelect,
}: {
  id: SideTab;
  label: string;
  count: number;
  countColor?: string;
  selected: boolean;
  onSelect: (t: SideTab) => void;
}) {
  const badgeColor = countColor ?? "var(--color-muted-foreground)";
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={selected}
      aria-controls={`panel-${id}`}
      onClick={() => onSelect(id)}
      className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.78rem] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${
        selected
          ? "bg-muted font-semibold text-foreground"
          : "font-medium text-muted-foreground hover:bg-muted/60"
      }`}
    >
      {label}
      <span
        className="font-mono tnum rounded-full px-1.5 py-px text-[0.68rem] font-semibold"
        style={{
          color: badgeColor,
          backgroundColor: softBg(badgeColor, 14),
        }}
      >
        {count}
      </span>
      {selected && (
        <span
          aria-hidden
          className="absolute inset-x-3 -bottom-2 h-0.5 rounded-full"
          style={{ backgroundColor: "var(--color-accent)" }}
        />
      )}
    </button>
  );
}
