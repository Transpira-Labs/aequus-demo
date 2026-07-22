"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

/**
 * A small "i" next to a heading. Press it to get the explanation, ignore it if
 * you already know. Keeps the screen quiet without hiding how things work.
 *
 * Opens on click rather than hover, so it behaves the same on a laptop and a
 * tablet, and so a stray cursor never pops something open.
 */
export function InfoBubble({
  label,
  align = "left",
  side = "auto",
  children,
}: {
  /** Accessible name for the button, e.g. "About the shipments board". */
  label: string;
  /** Which edge the bubble lines up with. Use "right" near the screen edge. */
  align?: "left" | "right";
  /**
   * Which way it opens. "auto" measures the room below and flips up when there
   * is not enough. Pass "top" for a panel that always sits near the bottom.
   */
  side?: "auto" | "top" | "bottom";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const opensUp = side === "top" || (side === "auto" && flipped);

  const toggle = () => {
    if (!open && side === "auto") {
      const r = buttonRef.current?.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      // Only flip when the viewport height is actually measurable. If it is
      // not, opening downward is the safer default.
      setFlipped(!!r && viewport > 0 && viewport - r.bottom < 220);
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;

    // Capture the key so closing the bubble does not also close whatever is
    // behind it, like the shipment panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.92] ${
          open
            ? "text-accent"
            : "text-muted-foreground/60 hover:text-muted-foreground"
        }`}
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open && (
        <span
          id={panelId}
          role="tooltip"
          className={`info-pop absolute z-30 block w-64 rounded-[var(--radius)] border border-border bg-card p-3 text-left text-[0.76rem] font-normal leading-relaxed text-muted-foreground soft-shadow ${
            opensUp ? "bottom-full mb-2 info-pop-up" : "top-full mt-2"
          } ${align === "right" ? "right-0 info-pop-right" : "left-0"}`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
