"use client";

import { Pause, Play, SkipForward } from "lucide-react";
import type { Simulation, Speed } from "@/hooks/useSimulation";
import { SPEEDS } from "@/hooks/useSimulation";
import { Scrubber } from "./Scrubber";
import { formatClock } from "./util";

export function TopBar({
  sim,
  searchSlot,
}: {
  sim: Simulation;
  /** The global search trigger and palette, owned by the page. */
  searchSlot?: React.ReactNode;
}) {
  return (
    <header className="material-bar relative z-20 shrink-0 border-b border-border">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        {/* wordmark + context */}
        <div className="flex items-center gap-3">
          <span className="flex items-baseline gap-1.5">
            <span className="font-display text-lg text-foreground">
              Transpira
            </span>
            <span className="hidden text-[0.72rem] font-medium text-muted-foreground sm:block">
              for Aequus Worldwide Logistics
            </span>
          </span>
          <span className="hidden h-4 w-px bg-border md:block" />
          <span className="eyebrow hidden md:block">
            Freight Control Tower · Aequus Ops · Tomball, TX
          </span>
        </div>

        <span className="grow" />

        {searchSlot}

        {/* clock */}
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              sim.playing ? "pulse-dot" : "opacity-40"
            }`}
            style={{ backgroundColor: "var(--color-healthy)" }}
          />
          <span className="display-tight font-mono text-sm font-semibold text-foreground tnum whitespace-nowrap">
            {formatClock(sim.simDate)}
          </span>
        </div>

        {/* transport controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={sim.toggle}
            aria-label={sim.playing ? "Pause" : "Play"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]"
          >
            {sim.playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="ml-0.5 h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={sim.jumpToEnd}
            aria-label="Jump to end of day"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-transform hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          {/* speed selector */}
          <div className="ml-1 flex items-center rounded-full border border-border bg-muted p-0.5">
            {SPEEDS.map((s) => (
              <SpeedButton
                key={s}
                speed={s}
                active={sim.speed === s}
                onClick={() => sim.setSpeed(s)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* timeline scrubber */}
      <div className="px-4 pb-2">
        <Scrubber
          progress={sim.progress}
          ticks={sim.timelineTicks}
          onScrubStart={sim.pause}
          onScrub={sim.seekProgress}
        />
      </div>
    </header>
  );
}

function SpeedButton({
  speed,
  active,
  onClick,
}: {
  speed: Speed;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`font-mono rounded-full px-2 py-0.5 text-[0.72rem] font-semibold tnum transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {speed}×
    </button>
  );
}
