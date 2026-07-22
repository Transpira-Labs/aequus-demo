"use client";

import { useState } from "react";
import { ArrowUpRight, Bot, Check, Copy } from "lucide-react";
import type {
  AgentDef,
  AgentId,
  AgentRun,
  AgentState,
  AgentTally,
  AgentToggles,
  FixOption,
  RunStatus,
} from "@/lib/agentTypes";
import { AGENTS } from "@/lib/agentTypes";
import { InfoBubble } from "./InfoBubble";
import { compactMoney, formatTime, softBg } from "./util";

/**
 * The agent window. Two stacked sections in one scroll column: the roster,
 * where you switch agents on and off, and the activity feed, where you see
 * what they did and what they need from you.
 *
 * Everything here is simulated inside the demo. Nothing is sent anywhere.
 */
export function AgentPanel({
  agents,
  toggles,
  onToggle,
  onOpenShipment,
  onDecide,
  onUndoDecision,
}: {
  agents: AgentState;
  toggles: AgentToggles;
  onToggle: (id: AgentId) => void;
  onOpenShipment: (shipmentId: string) => void;
  onDecide: (runId: string, optionLabel: string) => void;
  onUndoDecision: (runId: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* a) the roster */}
      <section className="border-b border-border px-3 py-3">
        <header className="flex items-center gap-1.5 px-0.5">
          <h3 className="text-sm font-semibold text-foreground">AI agents</h3>
          <InfoBubble label="About AI agents">
            AI agents are software, not people. They watch the same issues you
            do, handle the routine follow ups on their own, and stop when a
            decision is really yours. Switch one off and its issues just wait
            for you. Nothing an AI agent does leaves this demo.
          </InfoBubble>
        </header>

        <div className="mt-2.5 space-y-1.5">
          {AGENTS.map((a) => (
            <RosterRow
              key={a.id}
              def={a}
              on={toggles[a.id]}
              tally={agents.byAgent[a.id]}
              onToggle={() => onToggle(a.id)}
            />
          ))}
        </div>
      </section>

      {/* b) the activity feed */}
      <section className="space-y-2.5 p-3">
        <div className="flex items-baseline justify-between px-0.5">
          <h3 className="text-sm font-semibold text-foreground">Activity</h3>
          <span className="font-mono tnum text-[0.7rem] text-muted-foreground">
            {agents.runs.length}
          </span>
        </div>

        {agents.runs.length === 0 ? (
          <EmptyRuns />
        ) : (
          agents.runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              onDecide={onDecide}
              onUndo={onUndoDecision}
              onOpenShipment={onOpenShipment}
            />
          ))
        )}
      </section>
    </div>
  );
}

// ── Roster ──────────────────────────────────────────────────────────────────

/**
 * "3 handled, 1 needs you". Plain words, never a bare number salad. Only the
 * part that wants a person carries color.
 */
function tallyParts(
  t: AgentTally | undefined
): { text: string; color?: string }[] {
  const parts: { text: string; color?: string }[] = [];
  if (!t) return [{ text: "Nothing to do yet" }];
  if (t.working > 0) parts.push({ text: `${t.working} in progress` });
  if (t.resolved > 0)
    parts.push({ text: `${t.resolved} handled`, color: "var(--color-healthy)" });
  if (t.needsYou > 0)
    parts.push({
      text: `${t.needsYou} needs you`,
      color: "var(--color-critical)",
    });
  if (t.decided && t.decided > 0)
    parts.push({
      text: `${t.decided} cleared by you`,
      color: "var(--color-healthy)",
    });
  return parts.length === 0 ? [{ text: "Nothing to do yet" }] : parts;
}

function RosterRow({
  def,
  on,
  tally,
  onToggle,
}: {
  def: AgentDef;
  on: boolean;
  tally: AgentTally | undefined;
  onToggle: () => void;
}) {
  const parts = tallyParts(tally);

  return (
    <div
      className={`rounded-[var(--radius)] border border-border px-3 py-2.5 transition-opacity ${
        on ? "bg-card" : "bg-muted/40 opacity-60"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-[0.85rem] font-semibold leading-tight text-foreground">
            {def.name}
          </p>
          {/* what it does, and where it stops, one press away */}
          <InfoBubble label={`About ${def.name}`}>
            {def.blurb}
            <span className="mt-2 block">
              <span className="font-semibold text-foreground">On its own: </span>
              {def.canDo}
            </span>
            <span className="mt-1 block">
              <span className="font-semibold text-foreground">Hands back: </span>
              {def.handsOff}
            </span>
          </InfoBubble>
        </div>
        <Switch on={on} label={def.name} onToggle={onToggle} />
      </div>

      <p className="mt-1 text-[0.74rem] font-semibold text-muted-foreground">
        {on ? (
          parts.map((p, i) => (
            <span key={p.text} style={p.color ? { color: p.color } : undefined}>
              {i > 0 && <span className="text-muted-foreground">, </span>}
              {p.text}
            </span>
          ))
        ) : (
          <span>Off. Its issues wait for you.</span>
        )}
      </p>
    </div>
  );
}

function Switch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} on or off`}
      onClick={onToggle}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
      style={{
        backgroundColor: on ? "var(--color-accent)" : "var(--color-muted)",
        borderColor: on ? "var(--color-accent)" : "var(--color-border)",
      }}
    >
      <span
        className="pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out"
        style={{ transform: `translateX(${on ? "1.12rem" : "0.16rem"})` }}
      />
    </button>
  );
}

// ── Activity ────────────────────────────────────────────────────────────────

const STATUS_WORD: Record<RunStatus, string> = {
  working: "Working on it",
  resolved: "Handled",
  needs_you: "Needs you",
  decided: "You handled it",
};

function statusColor(s: RunStatus): string {
  return s === "resolved" || s === "decided"
    ? "var(--color-healthy)"
    : s === "needs_you"
    ? "var(--color-critical)"
    : "var(--color-accent)";
}

const MAX_STEPS = 4;

/**
 * Once a person picks a choice, the run collapses to a single line. It leaves
 * the queue but stays readable, so nothing quietly disappears.
 */
function DecidedRow({
  run,
  onUndo,
  onOpenShipment,
}: {
  run: AgentRun;
  onUndo: (runId: string) => void;
  onOpenShipment: (shipmentId: string) => void;
}) {
  const color = statusColor("decided");
  return (
    <div className="event-enter flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-2">
      <Check className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      <span className="text-[0.76rem] font-semibold" style={{ color }}>
        You handled it
      </span>
      {run.shipmentId && (
        <button
          type="button"
          onClick={() => onOpenShipment(run.shipmentId!)}
          className="font-mono rounded-md px-1 text-[0.72rem] font-semibold text-accent transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          {run.shipmentId}
        </button>
      )}
      <span className="min-w-0 flex-1 truncate text-[0.74rem] text-muted-foreground">
        {run.decision?.optionLabel}
      </span>
      <button
        type="button"
        onClick={() => onUndo(run.id)}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[0.72rem] font-semibold text-muted-foreground transition-transform hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
      >
        Undo
      </button>
    </div>
  );
}

function RunCard({
  run,
  onDecide,
  onUndo,
  onOpenShipment,
}: {
  run: AgentRun;
  onDecide: (runId: string, optionLabel: string) => void;
  onUndo: (runId: string) => void;
  onOpenShipment: (shipmentId: string) => void;
}) {
  const [showAllSteps, setShowAllSteps] = useState(false);
  const color = statusColor(run.status);
  const agentName =
    AGENTS.find((a) => a.id === run.agentId)?.name ?? "AI agent";

  if (run.status === "decided") {
    return (
      <DecidedRow run={run} onUndo={onUndo} onOpenShipment={onOpenShipment} />
    );
  }

  const hidden = Math.max(0, run.steps.length - MAX_STEPS);
  const steps =
    hidden > 0 && !showAllSteps ? run.steps.slice(-MAX_STEPS) : run.steps;

  return (
    <article
      className="event-enter overflow-hidden rounded-[var(--radius)] border border-border bg-card soft-shadow"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
            style={{ color, backgroundColor: softBg(color, 12) }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                run.status === "working" ? "pulse-dot" : ""
              }`}
              style={{ backgroundColor: color }}
            />
            {STATUS_WORD[run.status]}
          </span>
          {run.shipmentId && (
            <button
              type="button"
              onClick={() => onOpenShipment(run.shipmentId!)}
              className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[0.72rem] font-semibold text-accent transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            >
              {run.shipmentId}
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-px group-hover:-translate-y-px" />
            </button>
          )}
        </div>

        <h4 className="mt-1.5 text-[0.9rem] font-semibold leading-snug text-foreground">
          {run.title}
        </h4>
        <p className="mt-0.5 text-[0.72rem] text-muted-foreground">
          AI agent · {agentName}
        </p>

        {/* what it actually did */}
        {steps.length > 0 && (
          <div className="mt-2.5">
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAllSteps((v) => !v)}
                className="mb-1.5 rounded-md px-1 py-0.5 text-[0.7rem] font-semibold text-accent transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
              >
                {showAllSteps ? "Show less" : `Show all ${run.steps.length} steps`}
              </button>
            )}
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={`${s.at}-${i}`} className="flex gap-2">
                  <span className="font-mono tnum shrink-0 text-[0.7rem] leading-relaxed text-muted-foreground">
                    {formatTime(s.at)}
                  </span>
                  <span className="min-w-0 text-[0.76rem] leading-relaxed text-foreground/85">
                    {s.text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {run.status === "resolved" && run.resolution && (
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p
              className="text-[0.78rem] font-semibold leading-snug"
              style={{ color: "var(--color-healthy)" }}
            >
              {run.resolution}
            </p>
            {run.savedUsd != null && run.savedUsd > 0 && (
              <span
                className="font-mono tnum text-[0.74rem] font-semibold"
                style={{ color: "var(--color-healthy)" }}
              >
                Saved {compactMoney(run.savedUsd)}
              </span>
            )}
          </div>
        )}

        {run.status === "needs_you" && run.ask && (
          <AskBlock
            ask={run.ask}
            runId={run.id}
            onDecide={(optionLabel) => onDecide(run.id, optionLabel)}
          />
        )}
      </div>
    </article>
  );
}

function AskBlock({
  ask,
  runId,
  onDecide,
}: {
  ask: NonNullable<AgentRun["ask"]>;
  runId: string;
  onDecide: (optionLabel: string) => void;
}) {
  return (
    <div className="mt-3 rounded-[var(--radius)] border border-border bg-muted/40 p-3">
      <p className="text-[0.8rem] font-semibold leading-snug text-foreground">
        {ask.why}
      </p>

      <p className="eyebrow mt-2.5">Your choices</p>
      <ul className="mt-1.5 space-y-1.5">
        {ask.options.map((o, i) => (
          <OptionRow
            key={`${runId}-opt-${i}`}
            option={o}
            onPick={() => onDecide(o.label)}
          />
        ))}
      </ul>

      <p className="mt-1.5 text-[0.68rem] text-muted-foreground">
        Picking one clears this from the queue and notes what you chose. It does
        not call, pay, or send anything.
      </p>

      {ask.draft && <DraftBlock draft={ask.draft} />}
    </div>
  );
}

/**
 * Pick a choice and the run leaves the queue. The click records the decision,
 * it does not carry it out, so the label says what you are choosing to do
 * rather than promising the screen will do it.
 */
function OptionRow({
  option,
  onPick,
}: {
  option: FixOption;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={`w-full rounded-lg border bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] ${
          option.recommended ? "border-foreground/25" : "border-border"
        }`}
      >
        <span className="flex items-baseline gap-2">
          <span className="text-[0.78rem] font-semibold leading-snug text-foreground">
            {option.label}
          </span>
          {option.recommended && (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Suggested
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[0.74rem] leading-snug text-muted-foreground">
          {option.detail}
        </span>
      </button>
    </li>
  );
}

function DraftBlock({ draft }: { draft: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      // clipboard can be blocked; the text is on screen either way
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Drafted for you</p>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[0.7rem] font-semibold text-muted-foreground transition-transform hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          {copied ? (
            <Check className="h-3 w-3" style={{ color: "var(--color-healthy)" }} />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1 rounded-lg border border-border bg-card px-2.5 py-2 text-[0.76rem] leading-relaxed text-foreground/85">
        {draft}
      </p>
      <p className="mt-1 text-[0.68rem] text-muted-foreground">
        Nothing is sent from this demo. Copy it if you want to use it.
      </p>
    </div>
  );
}

function EmptyRuns() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Bot
          className="h-5 w-5"
          style={{ color: "var(--color-muted-foreground)" }}
        />
      </div>
      <p className="text-sm font-semibold text-foreground">
        Nothing for the AI agents yet
      </p>
      <p className="mt-1 max-w-[18rem] text-[0.8rem] text-muted-foreground">
        They pick up issues as they appear.
      </p>
    </div>
  );
}
