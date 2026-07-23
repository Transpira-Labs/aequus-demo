"use client";

import { useMemo } from "react";
import type {
  ConnectorStatusPayload,
  FeedEvent,
  ShipmentEntity,
} from "@/lib/types";
import { appOf, sourceAppName } from "@/lib/sources";
import { SourceChip } from "./chips";
import { InfoBubble } from "./InfoBubble";
import { docType, formatTime, eventShipmentId, eventVerb } from "./util";

/** The app a row arrived through, so every message can name its source. */
function appLabelOf(
  ev: FeedEvent,
  shipments: Record<string, ShipmentEntity>
): string | undefined {
  if (ev.type.startsWith("connector.")) {
    return sourceAppName((ev.payload as ConnectorStatusPayload).app);
  }
  const id = eventShipmentId(ev);
  const mode = id ? shipments[id]?.mode ?? "road" : "road";
  const app = appOf(ev.type, mode);
  return app ? sourceAppName(app) : undefined;
}

// Its own tab now, with the full panel height, so it can hold more history.
const MAX_ROWS = 50;

export function EventLedger({
  events,
  totalToday,
  shipments,
  embedded = false,
}: {
  /** Messages inside the current time scope, in occurredAt order. */
  events: FeedEvent[];
  /** Everything ingested today, so a narrowed scope can say what it hides. */
  totalToday: number;
  /** For resolving which app carried each message (mode decides the portal). */
  shipments: Record<string, ShipmentEntity>;
  /** Inside the tabbed panel the card chrome and title come from the parent. */
  embedded?: boolean;
}) {
  const scoped = events.length < totalToday;
  // events is in occurredAt order (oldest→newest); show newest first.
  const rows = useMemo(
    () => events.slice(-MAX_ROWS).reverse(),
    [events]
  );

  return (
    <div
      className={
        embedded
          ? "flex min-h-0 flex-1 flex-col"
          : "flex min-h-0 flex-1 flex-col rounded-[var(--radius)] border border-border bg-card soft-shadow"
      }
    >
      {/* header: the tab strip already names the panel when embedded */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {!embedded && (
            <h2 className="text-sm font-semibold text-foreground">
              Network traffic
            </h2>
          )}
          <span className="text-[0.76rem] text-muted-foreground tnum">
            {scoped ? `${events.length} of ${totalToday} today` : `${totalToday} today`}
          </span>
        </div>
        <InfoBubble label="About network traffic" side="top" align="right">
          Every message between Aequus Ops and the partner network, newest
          first. OPS is the Aequus desk, PTR is a partner. The number is the
          freight document type: 204 is a shipment tender, 990 is the partner
          answering yes or no, 214 is a status update, 210 is an invoice, and
          CBP is a customs entry message. Each row also names the app the
          message came through, like Truckstop or QuickBooks.
        </InfoBubble>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[0.8rem] text-muted-foreground">
            {scoped
              ? "Nothing in this time window. Widen it to see earlier messages."
              : "Nothing yet. Messages show up here as Aequus Ops and the partners talk."}
          </p>
        ) : (
          <ul>
            {rows.map((ev) => {
              const shipmentId = eventShipmentId(ev);
              return (
                <li
                  key={ev.messageId}
                  className="event-enter flex items-center gap-2.5 border-b border-border/50 px-4 py-1.5 last:border-b-0"
                >
                  <SourceChip source={ev.source} short />
                  <span className="font-mono w-9 shrink-0 text-[0.72rem] font-semibold text-foreground tnum">
                    {docType(ev.type)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.76rem] text-muted-foreground">
                    {eventVerb(ev.type)}
                    {shipmentId && (
                      <span className="font-mono text-foreground">
                        {" · "}
                        {shipmentId}
                      </span>
                    )}
                    {appLabelOf(ev, shipments) && (
                      <span className="text-muted-foreground/70">
                        {" · "}
                        {appLabelOf(ev, shipments)}
                      </span>
                    )}
                  </span>
                  <span className="font-mono shrink-0 text-[0.72rem] text-muted-foreground tnum">
                    {formatTime(ev.occurredAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
