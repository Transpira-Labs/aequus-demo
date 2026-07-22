"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSimulation } from "@/hooks/useSimulation";
import { TopBar } from "@/components/TopBar";
import { KpiStrip } from "@/components/KpiStrip";
import { ModeStrip } from "@/components/ModeStrip";
import { ShipmentBoard } from "@/components/ShipmentBoard";
import { SidePanel, type SideTab } from "@/components/SidePanel";
import { ShipmentDetail } from "@/components/ShipmentDetail";
import type { AgentRun } from "@/lib/agentTypes";
import type { TransportMode } from "@/lib/types";
import {
  TIME_SCOPES,
  scopeStartMs,
  type TimeScope,
} from "@/components/util";

export default function ControlTower() {
  const sim = useSimulation();
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(
    null
  );
  const [sideTab, setSideTab] = useState<SideTab>("issues");
  const [scope, setScope] = useState<TimeScope>("day");
  // One platform, three services. Picking a mode focuses the whole screen.
  const [modeFilter, setModeFilter] = useState<TransportMode | null>(null);

  // Mode of the shipment behind an id. Undefined when the id is unknown.
  const modeOf = useCallback(
    (id?: string) => (id ? sim.state.shipments[id]?.mode : undefined),
    [sim.state.shipments]
  );

  // Scoping is a view filter, not retention: narrowing hides older rows from
  // the feeds, widening brings them straight back.
  const scopeStart = scopeStartMs(scope, sim.simTime);
  // The mode filter hides rows tied to another mode. Rows that cannot be tied
  // to a shipment stay visible; they are not about any one mode.
  const scopedExceptions = useMemo(() => {
    let list = sim.state.exceptions;
    if (scopeStart !== -Infinity)
      list = list.filter((e) => Date.parse(e.detectedAt) >= scopeStart);
    if (modeFilter)
      list = list.filter((e) => {
        const m = modeOf(e.shipmentId);
        return m === undefined || m === modeFilter;
      });
    return list;
  }, [sim.state.exceptions, scopeStart, modeFilter, modeOf]);
  const scopedEvents = useMemo(() => {
    let list = sim.state.events;
    if (scopeStart !== -Infinity)
      list = list.filter((e) => Date.parse(e.occurredAt) >= scopeStart);
    if (modeFilter)
      list = list.filter((e) => {
        const m = modeOf(
          (e.payload as { shipmentId?: string }).shipmentId
        );
        return m === undefined || m === modeFilter;
      });
    return list;
  }, [sim.state.events, scopeStart, modeFilter, modeOf]);

  // One lookup so every exception card can say what its agent is doing.
  const runByException = useMemo(() => {
    const m = new Map<string, AgentRun>();
    for (const run of sim.agents.runs) m.set(run.exceptionId, run);
    return m;
  }, [sim.agents.runs]);

  const selectedShipment = selectedShipmentId
    ? sim.state.shipments[selectedShipmentId] ?? null
    : null;

  const openShipment = useCallback(
    (id: string) => setSelectedShipmentId(id),
    []
  );
  const closeShipment = useCallback(() => setSelectedShipmentId(null), []);

  // Global keyboard shortcuts: space toggles play, arrows nudge sim time ±15m.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable ||
        target?.getAttribute("role") === "slider";
      if (typing) return;
      // Space already activates a focused button (tab, filter chip, agent
      // switch). Let it, instead of also toggling playback.
      if (tag === "BUTTON" && (e.key === " " || e.code === "Space")) return;

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        sim.toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        sim.nudge(-15);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        sim.nudge(15);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sim]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TopBar sim={sim} />

      <div className="shrink-0 px-4 pt-3">
        <KpiStrip state={sim.state} agents={sim.agents} />
      </div>

      {/* one platform: air, land, and sea feeding the same board */}
      <div className="shrink-0 px-4 pt-2.5">
        <ModeStrip
          state={sim.state}
          selected={modeFilter}
          onSelect={setModeFilter}
        />
      </div>

      {/* time scope: how far back the feeds look from the sim clock */}
      <div className="flex shrink-0 items-center justify-end gap-1.5 px-4 pt-2.5">
        <span className="text-[0.72rem] font-medium text-muted-foreground">
          Showing
        </span>
        {TIME_SCOPES.map((s) => {
          const active = scope === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setScope(s.key)}
              aria-pressed={active}
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${
                active
                  ? "border-transparent bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-12 lg:grid-rows-1 lg:overflow-hidden">
        {/* left: the shipment board gets the whole column. Network traffic
            lives in the side panel now, so the main screen stays on shipments. */}
        <section className="flex h-[500px] flex-col lg:col-span-7 lg:h-auto lg:min-h-0 lg:overflow-hidden">
          <ShipmentBoard
            state={sim.state}
            selectedShipmentId={selectedShipmentId}
            onSelect={openShipment}
            modeFilter={modeFilter}
          />
        </section>

        {/* right: needs-attention feed, the agent window, network traffic */}
        <section className="flex h-[560px] lg:col-span-5 lg:h-auto lg:min-h-0 lg:overflow-hidden">
          <SidePanel
            tab={sideTab}
            onTabChange={setSideTab}
            events={scopedEvents}
            totalEvents={sim.state.events.length}
            exceptions={scopedExceptions}
            totalExceptions={sim.state.exceptions.length}
            simTime={sim.simTime}
            onOpenShipment={openShipment}
            agents={sim.agents}
            toggles={sim.toggles}
            onToggleAgent={sim.toggleAgent}
            runByException={runByException}
            onDecide={sim.decide}
            onUndoDecision={sim.undoDecision}
            assignments={sim.assignments}
            onAssign={sim.assign}
            onRelease={sim.release}
          />
        </section>
      </main>

      <ShipmentDetail
        shipment={selectedShipment}
        exceptions={sim.state.exceptions}
        assignments={sim.assignments}
        onClose={closeShipment}
      />
    </div>
  );
}
