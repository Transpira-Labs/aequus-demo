"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { ExceptionRecord, GraphState, ShipmentEntity } from "@/lib/types";
import {
  laneOf,
  severityColor,
  statusLabel,
  SEVERITY_WORD,
} from "./util";

/**
 * One search across every connected feed. The proposal promise is a single
 * place the team can search, monitor, and act from; this is the search part.
 * It looks across shipments, customers, partners, lanes, and open issues,
 * and lands on the shipment so the next click is an action.
 */

type Hit =
  | { kind: "shipment"; shipment: ShipmentEntity }
  | { kind: "issue"; issue: ExceptionRecord };

function matches(haystack: (string | undefined)[], q: string): boolean {
  return haystack.some((h) => h?.toLowerCase().includes(q));
}

export function CommandSearch({
  state,
  onOpenShipment,
}: {
  state: GraphState;
  onOpenShipment: (shipmentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Cmd+K or Ctrl+K from anywhere; Escape closes and hands focus back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after the pop-in frame so the browser does not scroll-jump.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    const shipments = Object.values(state.shipments);
    if (!q) {
      // Before typing: the shipments that need work, most issues first.
      return shipments
        .filter((s) => s.exceptionIds.length > 0)
        .sort((a, b) => b.exceptionIds.length - a.exceptionIds.length)
        .slice(0, 6)
        .map((shipment) => ({ kind: "shipment" as const, shipment }));
    }
    const shipmentHits: Hit[] = shipments
      .filter((s) =>
        matches(
          [
            s.shipmentId,
            s.customer,
            s.assignment?.partner.name,
            s.tender?.origin.city,
            s.tender?.destination.city,
            statusLabel(s.status),
            s.mode,
          ],
          q
        )
      )
      .slice(0, 6)
      .map((shipment) => ({ kind: "shipment" as const, shipment }));
    const issueHits: Hit[] = state.exceptions
      .filter(
        (ex) =>
          ex.shipmentId &&
          matches([ex.title, ex.partnerName, ex.slaTag, ex.shipmentId], q)
      )
      .slice(0, 5)
      .map((issue) => ({ kind: "issue" as const, issue }));
    return [...shipmentHits, ...issueHits];
  }, [state, query]);

  const pick = (hit: Hit) => {
    const id =
      hit.kind === "shipment" ? hit.shipment.shipmentId : hit.issue.shipmentId;
    if (id) onOpenShipment(id);
    setOpen(false);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[0.76rem] font-medium text-muted-foreground transition-transform hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:block">Search</span>
        <kbd className="font-mono hidden rounded border border-border bg-muted px-1 text-[0.66rem] text-muted-foreground sm:block">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/15 px-4 pt-[14vh]"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-label="Search everything"
            className="info-pop w-full max-w-[34rem] overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-xl"
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
                placeholder="Search shipments, customers, partners, issues"
                aria-label="Search shipments, customers, partners, issues"
                className="w-full bg-transparent text-[0.9rem] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
              <kbd className="font-mono shrink-0 rounded border border-border bg-muted px-1 text-[0.66rem] text-muted-foreground">
                ESC
              </kbd>
            </div>

            <div className="max-h-[19rem] overflow-y-auto p-1.5">
              {!query && hits.length > 0 && (
                <p className="eyebrow px-2.5 pb-1 pt-1.5">Needs work now</p>
              )}
              {hits.length === 0 ? (
                <p className="px-4 py-8 text-center text-[0.82rem] text-muted-foreground">
                  Nothing matches that. Try a shipment id, a customer, or a
                  partner name.
                </p>
              ) : (
                <ul>
                  {hits.map((hit, i) => (
                    <ResultRow
                      key={
                        hit.kind === "shipment"
                          ? hit.shipment.shipmentId
                          : hit.issue.id
                      }
                      hit={hit}
                      active={i === active}
                      onHover={() => setActive(i)}
                      onPick={() => pick(hit)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <p className="border-t border-border px-4 py-2 text-[0.7rem] text-muted-foreground">
              One search across every connected feed. Pick a result to open
              the shipment and act on it.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function ResultRow({
  hit,
  active,
  onHover,
  onPick,
}: {
  hit: Hit;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  if (hit.kind === "shipment") {
    const s = hit.shipment;
    const issueCount = s.exceptionIds.length;
    return (
      <li>
        <button
          type="button"
          onClick={onPick}
          onPointerMove={onHover}
          className={`flex w-full items-center gap-2.5 rounded-[calc(var(--radius)-6px)] px-2.5 py-2 text-left ${
            active ? "bg-muted" : ""
          }`}
        >
          <span className="font-mono w-20 shrink-0 text-[0.78rem] font-semibold text-foreground">
            {s.shipmentId}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.8rem] text-muted-foreground">
            {s.customer} · {laneOf(s)}
          </span>
          <span className="shrink-0 text-[0.72rem] text-muted-foreground">
            {issueCount > 0
              ? `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`
              : statusLabel(s.status)}
          </span>
        </button>
      </li>
    );
  }
  const ex = hit.issue;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        onPointerMove={onHover}
        className={`flex w-full items-center gap-2.5 rounded-[calc(var(--radius)-6px)] px-2.5 py-2 text-left ${
          active ? "bg-muted" : ""
        }`}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: severityColor(ex.severity) }}
        />
        <span className="min-w-0 flex-1 truncate text-[0.8rem] text-foreground">
          {ex.title}
        </span>
        <span
          className="shrink-0 text-[0.72rem] font-semibold"
          style={{ color: severityColor(ex.severity) }}
        >
          {SEVERITY_WORD[ex.severity]}
        </span>
      </button>
    </li>
  );
}
