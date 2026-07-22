"use client";

import { useMemo } from "react";
import type { GraphState, TransportMode } from "@/lib/types";
import { Plane, Ship, Truck } from "lucide-react";
import { InfoBubble } from "./InfoBubble";
import { int, modeColor, modeLabel, softBg } from "./util";

/**
 * The one-platform band. Aequus sells three services: air freight, over the
 * road, and ocean freight. This strip shows all three feeding one board, and
 * each tile filters the screen to its mode. Air, land, and sea, one feed.
 */

const SERVICES: {
  mode: TransportMode;
  service: string;
  Icon: typeof Truck;
}[] = [
  { mode: "air", service: "Air freight", Icon: Plane },
  { mode: "road", service: "Over the road", Icon: Truck },
  { mode: "ocean", service: "Ocean freight", Icon: Ship },
];

interface ModeTally {
  total: number;
  needWork: number;
}

export function ModeStrip({
  state,
  selected,
  onSelect,
}: {
  state: GraphState;
  selected: TransportMode | null;
  onSelect: (mode: TransportMode | null) => void;
}) {
  const tallies = useMemo(() => {
    const t: Record<TransportMode, ModeTally> = {
      road: { total: 0, needWork: 0 },
      air: { total: 0, needWork: 0 },
      ocean: { total: 0, needWork: 0 },
    };
    for (const s of Object.values(state.shipments)) {
      t[s.mode].total += 1;
      if (s.exceptionIds.length > 0) t[s.mode].needWork += 1;
    }
    return t;
  }, [state.shipments]);

  return (
    <div className="rounded-[var(--radius)] border border-border bg-card px-4 pt-3 soft-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <p className="eyebrow">One platform</p>
          <InfoBubble label="About the one-platform strip">
            Aequus quotes air, land, and sea. This layer reads all three
            through one feed, so a truck, an air pallet, and a container get
            the same watch on the same board. Pick a mode to focus the screen
            on it.
          </InfoBubble>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selected === null}
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${
            selected === null
              ? "border-transparent bg-muted text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/60"
          }`}
        >
          All modes
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2.5">
        {SERVICES.map(({ mode, service, Icon }) => {
          const c = modeColor(mode);
          const tally = tallies[mode];
          const active = selected === mode;
          const dimmed = selected !== null && !active;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onSelect(active ? null : mode)}
              aria-pressed={active}
              className={`rounded-[calc(var(--radius)-4px)] border px-3 py-2 text-left transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] ${
                active ? "" : "hover:bg-muted/50"
              } ${dimmed ? "opacity-45" : ""}`}
              style={{
                borderColor: active ? c : "var(--color-border)",
                backgroundColor: active ? softBg(c, 7) : undefined,
              }}
            >
              <span className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" style={{ color: c }} />
                <span className="text-[0.8rem] font-semibold text-foreground">
                  {modeLabel(mode)}
                </span>
                <span className="hidden text-[0.7rem] text-muted-foreground sm:inline">
                  {service}
                </span>
              </span>
              <span className="mt-0.5 block text-[0.72rem] text-muted-foreground tnum">
                {tally.total === 0
                  ? "Nothing yet today"
                  : `${int(tally.total)} today${
                      tally.needWork > 0
                        ? ` · ${int(tally.needWork)} need work`
                        : " · all clean"
                    }`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Three threads, one feed. Each service line drops out of its tile and
          merges into the single line the board reads from. */}
      <div aria-hidden>
        <svg
          viewBox="0 0 600 30"
          preserveAspectRatio="none"
          className="block h-[26px] w-full"
        >
          {SERVICES.map(({ mode }, i) => {
            const x = 100 + i * 200;
            const active = selected === mode;
            const dimmed = selected !== null && !active;
            return (
              <path
                key={mode}
                d={`M ${x} 0 C ${x} 16, 300 10, 300 24`}
                fill="none"
                stroke={modeColor(mode)}
                strokeWidth={active ? 2.5 : 1.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="transition-opacity"
                style={{ opacity: dimmed ? 0.2 : 0.75 }}
              />
            );
          })}
          <circle cx="300" cy="25" r="3" fill="var(--color-accent)" />
        </svg>
        <p className="eyebrow pb-2 text-center">One feed</p>
      </div>
    </div>
  );
}
