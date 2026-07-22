import { Unlink } from "lucide-react";
import type { Evidence } from "@/lib/types";
import { systemColor, softBg } from "./util";

/**
 * The signature element: the same fact as each system reports it, rendered as
 * two columns joined by a broken-link glyph in the gutter, the visual of two
 * systems disagreeing across a seam.
 */
export function EvidenceStitch({ evidence }: { evidence: Evidence[] }) {
  const ops = evidence.filter((e) => e.source === "OPS");
  const partner = evidence.filter((e) => e.source === "PARTNER");
  const rows = Math.max(ops.length, partner.length, 1);

  return (
    <div className="rounded-[var(--radius)] border border-border bg-muted/40">
      <div className="grid grid-cols-[1fr_2.25rem_1fr]">
        {/* Column headers */}
        <div className="px-3 pt-2.5">
          <SideHeader label="Aequus Ops says" color={systemColor("OPS")} />
        </div>
        <div aria-hidden />
        <div className="px-3 pt-2.5">
          <SideHeader
            label="Partner network says"
            color={systemColor("PARTNER")}
          />
        </div>

        {/* Rows: Ops cell · seam · Partner cell */}
        {Array.from({ length: rows }).map((_, i) => (
          <StitchRow
            key={i}
            first={i === 0}
            last={i === rows - 1}
            ops={ops[i]}
            partner={partner[i]}
          />
        ))}
      </div>
    </div>
  );
}

function SideHeader({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span
        className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em]"
        style={{ color }}
      >
        {label}
      </span>
    </div>
  );
}

function StitchRow({
  ops,
  partner,
  first,
  last,
}: {
  ops?: Evidence;
  partner?: Evidence;
  first: boolean;
  last: boolean;
}) {
  return (
    <>
      <EvidenceCell ev={ops} align="left" />
      {/* Seam gutter: a faint dashed rail with the broken-link glyph centered */}
      <div className="relative flex items-stretch justify-center">
        <span
          className="absolute inset-y-0 w-px border-l border-dashed border-border"
          aria-hidden
        />
        {first && (
          <span
            className="relative z-10 mt-3 flex h-5 w-5 items-center justify-center rounded-full border border-border"
            style={{ backgroundColor: softBg("var(--color-critical)", 8) }}
          >
            <Unlink
              className="h-3 w-3"
              style={{ color: "var(--color-critical)" }}
            />
          </span>
        )}
      </div>
      <EvidenceCell ev={partner} align="right" />
      {/* row spacing bottom padding handled by cell */}
      {last && <span className="col-span-3 h-2" aria-hidden />}
    </>
  );
}

function EvidenceCell({
  ev,
  align,
}: {
  ev?: Evidence;
  align: "left" | "right";
}) {
  if (!ev) return <div className="px-3 py-1.5" aria-hidden />;
  return (
    <div
      className={`px-3 py-1.5 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <div className="text-[0.62rem] font-medium text-muted-foreground">
        {ev.label}
      </div>
      <div className="font-mono text-sm font-semibold text-foreground tnum">
        {ev.value}
      </div>
    </div>
  );
}
