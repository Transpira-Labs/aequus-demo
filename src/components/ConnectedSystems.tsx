"use client";

import { useEffect, useRef, useState } from "react";
import {
  Cable,
  Landmark,
  Mail,
  Plane,
  Receipt,
  Ship,
  Truck,
} from "lucide-react";
import type { ConnectorEntity, SourceApp } from "@/lib/types";
import { sourceAppInfo } from "@/lib/sources";
import { formatTime, relativeSim, int, softBg } from "./util";

/**
 * The connected systems panel. Aequus already runs its day across Truckstop,
 * QuickBooks, ACE, partner portals, and email. This panel shows each of those
 * feeds in one place: what it carries, what it is allowed to touch, when it
 * last spoke, and whether a login is about to die. This is the answer to the
 * two things that killed past connectors: nobody could see the permissions,
 * and nobody heard when a feed quietly broke.
 */

const APP_ICON: Record<SourceApp, typeof Truck> = {
  truckstop: Truck,
  quickbooks: Receipt,
  ace: Landmark,
  airline: Plane,
  oceanline: Ship,
  email: Mail,
};

export function ConnectedSystems({
  connectors,
  simTime,
}: {
  connectors: ConnectorEntity[];
  simTime: number;
}) {
  const [open, setOpen] = useState(false);
  // Demo-local: renewing a login is a one-click fix, so clicking Renew just
  // marks the app healthy again in this view.
  const [renewed, setRenewed] = useState<Set<SourceApp>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const needsLook = connectors.some(
    (c) => c.status !== "connected" && !renewed.has(c.app)
  );
  const dotColor = needsLook
    ? "var(--color-warning)"
    : "var(--color-healthy)";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[0.72rem] font-semibold text-muted-foreground transition-transform hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
      >
        <Cable className="h-3.5 w-3.5" />
        Connected systems
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: dotColor }}
          aria-label={needsLook ? "One system needs a look" : "All systems connected"}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Connected systems"
          className="info-pop absolute left-0 top-[calc(100%+6px)] z-40 w-[22.5rem] rounded-[var(--radius)] border border-border bg-card p-1.5 shadow-xl"
        >
          <div className="px-2.5 pb-1.5 pt-2">
            <p className="eyebrow">One login</p>
            <p className="mt-0.5 text-[0.76rem] text-muted-foreground">
              The platform signs in to each tool Aequus already uses and
              watches every feed. Each tile shows what the tool can touch and
              when it last spoke.
            </p>
          </div>

          <ul>
            {connectors.map((c) => (
              <ConnectorRow
                key={c.app}
                c={c}
                simTime={simTime}
                renewed={renewed.has(c.app)}
                onRenew={() =>
                  setRenewed((prev) => new Set(prev).add(c.app))
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConnectorRow({
  c,
  simTime,
  renewed,
  onRenew,
}: {
  c: ConnectorEntity;
  simTime: number;
  renewed: boolean;
  onRenew: () => void;
}) {
  const info = sourceAppInfo(c.app);
  const Icon = APP_ICON[c.app];
  const status = renewed ? "connected" : c.status;

  const statusWord =
    status === "connected"
      ? "Connected"
      : status === "slow"
      ? "Running behind"
      : "Needs a look";
  const statusColor =
    status === "connected" ? "var(--color-healthy)" : "var(--color-warning)";

  const authDaysLeft = c.authExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(c.authExpiresAt) - simTime) / 86_400_000))
    : null;

  return (
    <li className="flex gap-2.5 rounded-[calc(var(--radius)-6px)] px-2.5 py-2 hover:bg-muted/40">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: softBg(statusColor, 10) }}
      >
        <Icon className="h-4 w-4" style={{ color: statusColor }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[0.8rem] font-semibold text-foreground">
            {info.name}
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-1 text-[0.68rem] font-semibold"
            style={{ color: statusColor }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: statusColor }}
            />
            {statusWord}
          </span>
        </div>
        <p className="text-[0.72rem] text-muted-foreground">{info.feeds}</p>
        <p className="text-[0.68rem] text-muted-foreground/80 tnum">
          {c.lastEventAt
            ? `Last message ${relativeSim(c.lastEventAt, simTime)} · ${int(
                c.eventsToday
              )} today`
            : "Nothing yet today"}
        </p>
        <p className="mt-0.5 text-[0.68rem] text-muted-foreground/80">
          {info.scopes}
        </p>

        {status === "slow" && c.note && (
          <p
            className="mt-1 text-[0.7rem] font-medium"
            style={{ color: "var(--color-warning)" }}
          >
            {c.note}. The platform is watching and will say when it catches up.
          </p>
        )}

        {c.incident && status === "connected" && (
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            Slowed {formatTime(c.incident.from)} to {formatTime(c.incident.to)}
            , then caught up on its own.
          </p>
        )}

        {status === "attention" && authDaysLeft !== null && (
          <div className="mt-1 flex items-center gap-2">
            <span
              className="text-[0.7rem] font-medium"
              style={{ color: "var(--color-warning)" }}
            >
              {authDaysLeft === 0
                ? "Login runs out today."
                : `Login runs out in ${authDaysLeft} ${
                    authDaysLeft === 1 ? "day" : "days"
                  }.`}
            </span>
            <button
              type="button"
              onClick={onRenew}
              className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[0.68rem] font-semibold text-foreground transition-transform hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            >
              Renew now
            </button>
          </div>
        )}

        {renewed && (
          <p
            className="mt-1 text-[0.7rem] font-medium"
            style={{ color: "var(--color-healthy)" }}
          >
            Renewed. Good for another 90 days.
          </p>
        )}
      </div>
    </li>
  );
}
