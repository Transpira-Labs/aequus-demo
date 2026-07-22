"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildState } from "@/lib/engine";
import { runAgents } from "@/lib/agents";
import { SCENARIO_START, SCENARIO_END, SCENARIO_EVENTS } from "@/lib/scenario";
import type { FeedEvent, GraphState, Severity } from "@/lib/types";
import type {
  AgentId,
  AgentState,
  AgentToggles,
  DecisionMap,
} from "@/lib/agentTypes";
import { ALL_ON } from "@/lib/agentTypes";
import { applyDecisions } from "@/lib/decisions";
import {
  SEEDED_ASSIGNMENTS,
  YOU,
  visibleAssignments,
  type AssignmentMap,
} from "@/lib/assignments";

export interface TimelineTick {
  ms: number;
  progress: number; // 0..1
  severity: Severity;
}

export type Speed = 1 | 10 | 60 | 300;
export const SPEEDS: Speed[] = [1, 10, 60, 300];

const START = Date.parse(SCENARIO_START);
const END = Date.parse(SCENARIO_END);
const INITIAL = Math.min(START + 90 * 60_000, END); // ~90 sim-min in
const FLUSH_MS = 80; // ~12 UI updates/sec while playing

export interface Simulation {
  simTime: number; // ms since epoch, sim clock
  simDate: Date;
  playing: boolean;
  speed: Speed;
  start: number;
  end: number;
  progress: number; // 0..1 across the scenario window
  atEnd: boolean;
  state: GraphState;
  visibleEvents: FeedEvent[];
  timelineTicks: TimelineTick[];
  /** What the software agents have done at this point on the sim clock. */
  agents: AgentState;
  /** Which agents are switched on. */
  toggles: AgentToggles;
  toggleAgent: (id: AgentId) => void;
  /** Choices the person has made on runs that were waiting on them. */
  decisions: DecisionMap;
  decide: (runId: string, optionLabel: string) => void;
  undoDecision: (runId: string) => void;
  /** Who has picked up which issue, as of the sim clock. */
  assignments: AssignmentMap;
  assign: (exceptionId: string) => void;
  release: (exceptionId: string) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: Speed) => void;
  seek: (ms: number) => void;
  seekProgress: (p: number) => void;
  nudge: (deltaMinutes: number) => void;
  jumpToEnd: () => void;
  jumpToStart: () => void;
}

export function useSimulation(): Simulation {
  const [simTime, setSimTime] = useState(INITIAL);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeedState] = useState<Speed>(60);
  const [toggles, setToggles] = useState<AgentToggles>(ALL_ON);

  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [assignmentLog, setAssignmentLog] =
    useState<AssignmentMap>(SEEDED_ASSIGNMENTS);

  const toggleAgent = useCallback((id: AgentId) => {
    setToggles((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const undoDecision = useCallback((runId: string) => {
    setDecisions((prev) => {
      if (!(runId in prev)) return prev;
      const next = { ...prev };
      delete next[runId];
      return next;
    });
  }, []);

  const simRef = useRef(INITIAL);
  const lastFrame = useRef<number | null>(null);
  const lastFlush = useRef(0);
  const rafId = useRef<number | null>(null);
  const playingRef = useRef(playing);
  const speedRef = useRef<Speed>(speed);
  playingRef.current = playing;
  speedRef.current = speed;

  // Advance the sim clock from wall-clock deltas. A rAF loop gives smooth
  // ~12Hz flushes while the tab is visible; a low-rate interval keeps the
  // clock honest when the tab is hidden and rAF stops firing. Both feed the
  // same advance() with a shared `last` timestamp, so double-driving is safe.
  useEffect(() => {
    const advance = (now: number) => {
      const dt = now - (lastFrame.current ?? now);
      lastFrame.current = now;
      if (!playingRef.current) return;

      let next = simRef.current + dt * speedRef.current;
      if (next >= END) {
        next = END;
        simRef.current = next;
        setSimTime(END);
        setPlaying(false);
        return;
      }
      simRef.current = next;
      if (now - lastFlush.current >= FLUSH_MS) {
        lastFlush.current = now;
        setSimTime(next);
      }
    };
    const tick = () => {
      rafId.current = requestAnimationFrame(tick);
      advance(performance.now());
    };
    rafId.current = requestAnimationFrame(tick);
    const interval = setInterval(() => advance(performance.now()), 250);
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      clearInterval(interval);
      lastFrame.current = null;
    };
  }, []);

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(START, Math.min(END, ms));
    simRef.current = clamped;
    lastFlush.current = 0; // let the next frame flush immediately
    setSimTime(clamped);
  }, []);

  const seekProgress = useCallback(
    (p: number) => {
      seek(START + Math.max(0, Math.min(1, p)) * (END - START));
    },
    [seek]
  );

  const nudge = useCallback(
    (deltaMinutes: number) => {
      seek(simRef.current + deltaMinutes * 60_000);
    },
    [seek]
  );

  const play = useCallback(() => {
    if (simRef.current >= END) simRef.current = START; // replay from top
    setSimTime(simRef.current);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    setPlaying((prev) => {
      if (!prev && simRef.current >= END) {
        simRef.current = START;
        setSimTime(START);
      }
      return !prev;
    });
  }, []);
  const setSpeed = useCallback((s: Speed) => setSpeedState(s), []);
  const jumpToEnd = useCallback(() => {
    setPlaying(false);
    seek(END);
  }, [seek]);
  const jumpToStart = useCallback(() => seek(START), [seek]);

  // Visible events: SCENARIO_EVENTS is ascending by occurredAt, so a binary
  // search gives the cut index cheaply. Key downstream memos on the count so
  // the slice keeps a stable identity between event boundaries.
  const cut = useMemo(() => {
    let lo = 0;
    let hi = SCENARIO_EVENTS.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(SCENARIO_EVENTS[mid].occurredAt) <= simTime) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }, [simTime]);

  const visibleEvents = useMemo(
    () => SCENARIO_EVENTS.slice(0, cut),
    [cut]
  );

  // Recompute the reconciled graph. Keyed on both the visible slice and the
  // clock because SLA-based exceptions (tracking blackout, overdue delivery)
  // become detectable purely from time passing, with no new event.
  const state = useMemo(
    () => buildState(visibleEvents, new Date(simTime)),
    [visibleEvents, simTime]
  );

  // What the agents have picked up, keyed the same way as the graph state plus
  // the on/off switches, so flipping an agent re-reads the board immediately.
  const agents = useMemo(
    () =>
      applyDecisions(
        runAgents(state, visibleEvents, new Date(simTime), toggles),
        decisions
      ),
    [state, visibleEvents, simTime, toggles, decisions]
  );

  // Assignments carry the sim clock too, so scrubbing back before a pickup
  // shows the issue unclaimed again.
  const assignments = useMemo(
    () => visibleAssignments(assignmentLog, simTime),
    [assignmentLog, simTime]
  );
  const assign = useCallback((exceptionId: string) => {
    setAssignmentLog((prev) => ({
      ...prev,
      [exceptionId]: {
        person: YOU,
        at: new Date(simRef.current).toISOString(),
      },
    }));
  }, []);
  const release = useCallback((exceptionId: string) => {
    setAssignmentLog((prev) => {
      if (!(exceptionId in prev)) return prev;
      const next = { ...prev };
      delete next[exceptionId];
      return next;
    });
  }, []);

  // Stamped with the sim clock, so the record reads in the same time frame as
  // everything else on screen.
  const decide = useCallback(
    (runId: string, optionLabel: string) => {
      setDecisions((prev) => ({
        ...prev,
        [runId]: { optionLabel, at: new Date(simRef.current).toISOString() },
      }));
    },
    []
  );

  // Full-day reconciliation, computed once, to place exception ticks along the
  // scrubber even before the clock reaches them.
  const timelineTicks = useMemo<TimelineTick[]>(() => {
    const full = buildState(SCENARIO_EVENTS, new Date(END));
    const span = END - START || 1;
    return full.exceptions
      .filter((e) => e.severity !== "info")
      .map((e) => {
        const ms = Date.parse(e.detectedAt);
        return {
          ms,
          progress: Math.max(0, Math.min(1, (ms - START) / span)),
          severity: e.severity,
        };
      });
  }, []);

  return {
    simTime,
    simDate: new Date(simTime),
    playing,
    speed,
    start: START,
    end: END,
    progress: (simTime - START) / (END - START),
    atEnd: simTime >= END,
    state,
    visibleEvents,
    timelineTicks,
    agents,
    toggles,
    toggleAgent,
    decisions,
    decide,
    undoDecision,
    assignments,
    assign,
    release,
    play,
    pause,
    toggle,
    setSpeed,
    seek,
    seekProgress,
    nudge,
    jumpToEnd,
    jumpToStart,
  };
}
