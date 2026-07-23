"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSimulation } from "@/hooks/useSimulation";
import { TopBar } from "@/components/TopBar";
import { KpiStrip } from "@/components/KpiStrip";
import {
  ServiceFilter,
  inService,
  type ServiceKey,
} from "@/components/ServiceFilter";
import { ConnectedSystems } from "@/components/ConnectedSystems";
import { CommandSearch } from "@/components/CommandSearch";
import { ShipmentBoard } from "@/components/ShipmentBoard";
import { SidePanel, type SideTab } from "@/components/SidePanel";
import { ShipmentDetail } from "@/components/ShipmentDetail";
import type { AgentRun } from "@/lib/agentTypes";
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
  // One platform, four services. Picking one focuses the whole screen.
  const [serviceFilter, setServiceFilter] = useState<ServiceKey | null>(null);

  // Whether the shipment behind an id falls under the picked service.
  // Undefined when the id is unknown, so the caller can keep the row.
  const inPickedService = useCallback(
    (id?: string) => {
      if (!serviceFilter) return true;
      const s = id ? sim.state.shipments[id] : undefined;
      return s ? inService(s, serviceFilter) : undefined;
    },
    [sim.state.shipments, serviceFilter]
  );

  // Scoping is a view filter, not retention: narrowing hides older rows from
  // the feeds, widening brings them straight back.
  const scopeStart = scopeStartMs(scope, sim.simTime);
  // The service filter hides rows tied to another service. Rows that cannot
  // be tied to a shipment stay visible; they are not about any one service.
  const scopedExceptions = useMemo(() => {
    let list = sim.state.exceptions;
    if (scopeStart !== -Infinity)
      list = list.filter((e) => Date.parse(e.detectedAt) >= scopeStart);
    if (serviceFilter)
      list = list.filter((e) => inPickedService(e.shipmentId) !== false);
    return list;
  }, [sim.state.exceptions, scopeStart, serviceFilter, inPickedService]);
  const scopedEvents = useMemo(() => {
    let list = sim.state.events;
    if (scopeStart !== -Infinity)
      list = list.filter((e) => Date.parse(e.occurredAt) >= scopeStart);
    if (serviceFilter)
      list = list.filter(
        (e) =>
          inPickedService(
            (e.payload as { shipmentId?: string }).shipmentId
          ) !== false
      );
    return list;
  }, [sim.state.events, scopeStart, serviceFilter, inPickedService]);

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
      <TopBar
        sim={sim}
        searchSlot={
          <CommandSearch state={sim.state} onOpenShipment={openShipment} />
        }
      />

      <div className="shrink-0 px-4 pt-3">
        <KpiStrip state={sim.state} agents={sim.agents} />
      </div>

      {/* filters: service menu and connected systems left, time scope right */}
      <div className="flex shrink-0 items-center justify-between gap-1.5 px-4 pt-2.5">
        <div className="flex items-center gap-1.5">
          <ServiceFilter
            state={sim.state}
            selected={serviceFilter}
            onSelect={setServiceFilter}
          />
          <ConnectedSystems
            connectors={sim.state.connectors}
            simTime={sim.simTime}
          />
        </div>
        <div className="flex items-center gap-1.5">
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
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-12 lg:grid-rows-1 lg:overflow-hidden">
        {/* left: the shipment board gets the whole column. Network traffic
            lives in the side panel now, so the main screen stays on shipments. */}
        <section className="flex h-[500px] flex-col lg:col-span-7 lg:h-auto lg:min-h-0 lg:overflow-hidden">
          <ShipmentBoard
            state={sim.state}
            selectedShipmentId={selectedShipmentId}
            onSelect={openShipment}
            serviceFilter={serviceFilter}
          />
        </section>

        {/* right: needs-attention feed, the agent window, network traffic */}
        <section className="flex h-[560px] lg:col-span-5 lg:h-auto lg:min-h-0 lg:overflow-hidden">
          <SidePanel
            tab={sideTab}
            onTabChange={setSideTab}
            events={scopedEvents}
            totalEvents={sim.state.events.length}
            shipments={sim.state.shipments}
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
