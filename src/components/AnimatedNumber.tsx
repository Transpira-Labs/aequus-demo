"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  format?: (n: number) => string;
  /** Animation duration in ms. */
  duration?: number;
  className?: string;
}

/**
 * Counts from the previous value to the new one with rAF easing. Respects
 * prefers-reduced-motion by snapping. Uses tabular numerals so width is stable.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString("en-US"),
  duration = 550,
  className = "",
}: Props) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    const to = value;
    if (reduce || from === to) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }
    const startT = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - startT) / duration);
      // easeOutCubic
      const e = 1 - Math.pow(1 - p, 3);
      const cur = from + (to - from) * e;
      setDisplay(cur);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      fromRef.current = to;
    };
  }, [value, duration]);

  return (
    <span className={`tnum ${className}`}>{format(display)}</span>
  );
}
