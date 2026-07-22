"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphState, ShipmentEntity, TransportMode } from "@/lib/types";
import { Check, Landmark, ListFilter, Plane, Ship, Truck } from "lucide-react";
import { int, isInternational, modeColor, softBg } from "./util";

/**
 * The service filter. Aequus sells four services: over the road, air freight,
 * ocean freight, and customs brokerage. All four land in the same feed, and
 * this menu focuses the whole screen on one of them. The service names here
 * are the ones Aequus uses.
 */

export type ServiceKey = TransportMode | "customs";

export const SERVICES: {
  key: ServiceKey;
  name: string;
  Icon: typeof Truck;
}[] = [
  { key: "road", name: "Over the road", Icon: Truck },
  { key: "air", name: "Air freight", Icon: Plane },
  { key: "ocean", name: "Ocean freight", Icon: Ship },
  { key: "customs", name: "Customs broker", Icon: Landmark },
];

export function serviceName(key: ServiceKey): string {
  return SERVICES.find((s) => s.key === key)!.name;
}

export function serviceColor(key: ServiceKey): string {
  return key === "customs" ? "var(--color-accent)" : modeColor(key);
}

/** Does a shipment fall under a service? Customs means international moves. */
export function inService(s: ShipmentEntity, key: ServiceKey): boolean {
  return key === "customs" ? isInternational(s) : s.mode === key;
}

export function ServiceFilter({
  state,
  selected,
  onSelect,
}: {
  state: GraphState;
  selected: ServiceKey | null;
  onSelect: (key: ServiceKey | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Live tallies per service, from the same reconciled state as everything
  // else on the screen. Customs counts the international moves.
  const tallies = useMemo(() => {
    const t = new Map<ServiceKey, { total: number; needWork: number }>(
      SERVICES.map((s) => [s.key, { total: 0, needWork: 0 }])
    );
    for (const s of Object.values(state.shipments)) {
      for (const svc of SERVICES) {
        if (!inService(s, svc.key)) continue;
        const row = t.get(svc.key)!;
        row.total += 1;
        if (s.exceptionIds.length > 0) row.needWork += 1;
      }
    }
    return t;
  }, [state.shipments]);

  // Escape and outside clicks close the menu; focus goes back to the button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const active = selected !== null;
  const activeColor = active ? serviceColor(selected) : undefined;

  const pick = (key: ServiceKey | null) => {
    onSelect(key);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${
          active
            ? "border-transparent"
            : "border-border text-muted-foreground hover:bg-muted/60"
        }`}
        style={
          active
            ? { color: activeColor, backgroundColor: softBg(activeColor!, 10) }
            : undefined
        }
      >
        <ListFilter className="h-3.5 w-3.5" />
        {active ? serviceName(selected) : "All services"}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Filter by service"
          className="info-pop absolute left-0 top-[calc(100%+6px)] z-40 w-[19rem] rounded-[var(--radius)] border border-border bg-card p-1.5 shadow-xl"
        >
          <div className="px-2.5 pb-1.5 pt-2">
            <p className="eyebrow">One platform</p>
            <p className="mt-0.5 text-[0.76rem] text-muted-foreground">
              Every Aequus service lands in this one feed. Pick one to focus
              the board on it.
            </p>
          </div>

          <MenuRow
            label="All services"
            sub="The whole operation"
            checked={selected === null}
            onPick={() => pick(null)}
          />
          {SERVICES.map(({ key, name, Icon }) => {
            const tally = tallies.get(key)!;
            const c = serviceColor(key);
            return (
              <MenuRow
                key={key}
                label={name}
                sub={
                  tally.total === 0
                    ? "Nothing yet today"
                    : `${int(tally.total)} today${
                        tally.needWork > 0
                          ? ` · ${int(tally.needWork)} need work`
                          : " · all clean"
                      }`
                }
                icon={<Icon className="h-4 w-4" style={{ color: c }} />}
                checked={selected === key}
                onPick={() => pick(key)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  label,
  sub,
  icon,
  checked,
  onPick,
}: {
  label: string;
  sub: string;
  icon?: React.ReactNode;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onPick}
      autoFocus={checked}
      className={`flex w-full items-center gap-2.5 rounded-[calc(var(--radius)-6px)] px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] ${
        checked ? "bg-muted" : "hover:bg-muted/60"
      }`}
    >
      {icon ?? <span className="h-4 w-4" aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[0.8rem] font-semibold text-foreground">
          {label}
        </span>
        <span className="text-[0.72rem] text-muted-foreground tnum">
          {sub}
        </span>
      </span>
      {checked && <Check className="h-4 w-4 shrink-0 text-foreground" />}
    </button>
  );
}
