"use client";

import { useCallback, useRef } from "react";
import type { TimelineTick } from "@/hooks/useSimulation";

export function Scrubber({
  progress,
  ticks,
  onScrubStart,
  onScrub,
}: {
  progress: number;
  ticks: TimelineTick[];
  onScrubStart: () => void;
  onScrub: (progress: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const posFromEvent = useCallback((clientX: number) => {
    const el = railRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      onScrubStart();
      onScrub(posFromEvent(e.clientX));
    },
    [onScrub, onScrubStart, posFromEvent]
  );

  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      onScrub(posFromEvent(e.clientX));
    },
    [onScrub, posFromEvent]
  );

  const handleUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const pct = `${Math.max(0, Math.min(1, progress)) * 100}%`;

  return (
    <div
      ref={railRef}
      role="slider"
      aria-label="Simulation timeline"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onScrub(Math.max(0, progress - 0.02));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onScrub(Math.min(1, progress + 0.02));
        }
      }}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      className="group relative flex h-6 w-full cursor-pointer touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
    >
      {/* base rail */}
      <div className="relative h-1 w-full rounded-full bg-border">
        {/* elapsed fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: pct }}
        />
        {/* exception ticks */}
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${t.progress * 100}%`,
              backgroundColor:
                t.severity === "critical"
                  ? "var(--color-critical)"
                  : "var(--color-warning)",
            }}
          />
        ))}
      </div>
      {/* playhead */}
      <div
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-card shadow-sm transition-transform group-active:scale-110"
        style={{ left: pct }}
      />
    </div>
  );
}
