import { Truck, Plane, Ship, Globe } from "lucide-react";
import type {
  SourceSystem,
  ShipmentStatus,
  Severity,
  IssueFrequency,
  TransportMode,
} from "@/lib/types";
import {
  systemColor,
  systemShort,
  systemLabel,
  softBg,
  statusLabel,
  severityColor,
  modeColor,
  modeLabel,
} from "./util";

/** OPS / PARTNER provenance chip, cobalt vs teal, mono. */
export function SourceChip({
  source,
  short = false,
}: {
  source: SourceSystem;
  short?: boolean;
}) {
  const c = systemColor(source);
  return (
    <span
      className="font-mono inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wider"
      style={{ color: c, backgroundColor: softBg(c, 12) }}
    >
      {short ? systemShort(source) : systemLabel(source)}
    </span>
  );
}

const MODE_ICON: Record<TransportMode, typeof Truck> = {
  road: Truck,
  air: Plane,
  ocean: Ship,
};

/**
 * Transport mode badge: a truck, plane, or ship glyph plus the mode name,
 * tinted with the mode hue. An "Intl" mark rides along on cross-border moves.
 */
export function ModeBadge({
  mode,
  international = false,
}: {
  mode: TransportMode;
  international?: boolean;
}) {
  const c = modeColor(mode);
  const Icon = MODE_ICON[mode];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
        style={{ color: c, backgroundColor: softBg(c, 12) }}
      >
        <Icon className="h-3.5 w-3.5" />
        {modeLabel(mode)}
      </span>
      {international && (
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.66rem] font-semibold"
          style={{
            color: "var(--color-partner)",
            backgroundColor: softBg("var(--color-partner)", 12),
          }}
        >
          <Globe className="h-3 w-3" />
          Intl
        </span>
      )}
    </span>
  );
}

const STATUS_STYLE: Record<
  ShipmentStatus,
  { fg: string; bg: string; dot: string }
> = {
  tendered: {
    fg: "var(--color-muted-foreground)",
    bg: "var(--color-muted)",
    dot: "var(--color-muted-foreground)",
  },
  assigned: {
    fg: "var(--color-ops)",
    bg: softBg("var(--color-ops)", 10),
    dot: "var(--color-ops)",
  },
  booked: {
    fg: "var(--color-partner)",
    bg: softBg("var(--color-partner)", 12),
    dot: "var(--color-partner)",
  },
  picked_up: {
    fg: "var(--color-accent)",
    bg: softBg("var(--color-accent)", 12),
    dot: "var(--color-accent)",
  },
  delivered: {
    fg: "var(--color-healthy)",
    bg: "var(--color-healthy-soft)",
    dot: "var(--color-healthy)",
  },
  completed: {
    fg: "var(--color-healthy)",
    bg: "var(--color-healthy-soft)",
    dot: "var(--color-healthy)",
  },
  cancelled: {
    fg: "var(--color-muted-foreground)",
    bg: "var(--color-muted)",
    dot: "var(--color-muted-foreground)",
  },
};

export function StatusChip({ status }: { status: ShipmentStatus }) {
  const s = STATUS_STYLE[status];
  // picked_up is the in-motion state, so its dot pulses.
  const pulsing = status === "picked_up";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
      style={{ color: s.fg, backgroundColor: s.bg }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${pulsing ? "pulse-dot" : ""}`}
        style={{ backgroundColor: s.dot }}
      />
      {status === "cancelled" ? (
        <span className="line-through opacity-80">{statusLabel(status)}</span>
      ) : (
        statusLabel(status)
      )}
    </span>
  );
}

/** Exception count indicator: a filled dot in the highest severity, plus count. */
export function ExceptionDot({
  severity,
  count,
}: {
  severity: Severity;
  count: number;
}) {
  const c = severityColor(severity);
  return (
    <span
      className="font-mono inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold tnum"
      style={{ color: c, backgroundColor: softBg(c, 13) }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      {count}
    </span>
  );
}

const FREQUENCY_WORD: Record<IssueFrequency, string> = {
  common: "Common",
  uncommon: "Uncommon",
  new: "New pattern",
};

function frequencyTitle(frequency: IssueFrequency, seen: number): string {
  if (frequency === "new")
    return "First time this pattern has come up. Caught by general monitoring.";
  const times = seen === 1 ? "once" : `${seen} times`;
  return frequency === "common"
    ? `Came up ${times} last quarter. A pattern the layer knows well.`
    : `Came up ${times} last quarter. Known, but it does not happen often.`;
}

/**
 * Frequency tag pill: is this issue a routine catch or a genuine surprise?
 * New patterns get the accent color so they read as noteworthy, not alarming.
 */
export function FrequencyTag({
  frequency,
  timesSeenBefore,
}: {
  frequency: IssueFrequency;
  timesSeenBefore: number;
}) {
  const isNew = frequency === "new";
  return (
    <span
      title={frequencyTitle(frequency, timesSeenBefore)}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${
        isNew ? "" : "border border-border bg-muted text-muted-foreground"
      }`}
      style={
        isNew
          ? {
              color: "var(--color-accent)",
              backgroundColor: softBg("var(--color-accent)", 12),
            }
          : undefined
      }
    >
      {FREQUENCY_WORD[frequency]}
    </span>
  );
}

/** SLA / exposure tag pill. */
export function SlaTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[0.68rem] font-semibold text-muted-foreground">
      {label}
    </span>
  );
}
