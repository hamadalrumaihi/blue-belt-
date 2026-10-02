"use client";

import { sourceHealth, type HealthInput } from "@/lib/source-health";
import { cn } from "@/lib/utils";

type Props = { athlete: HealthInput; now: Date | null; hasMatches: boolean; className?: string; showDetail?: boolean };

const TONE: Record<string, string> = {
  fresh: "bg-success-soft text-success",
  aging: "bg-amber-50 text-amber-700",
  stale: "bg-danger-soft text-danger",
  never: "bg-page text-muted border border-line",
};

/** "Live / Aging / Stale / Not checked" pill with the last successful update time. */
export function SourceHealthBadge({ athlete, now, hasMatches, className, showDetail }: Props) {
  if (!now) return null;
  const h = sourceHealth(athlete, now, hasMatches);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", TONE[h.freshness])} title={h.detail}>
        {h.label}
      </span>
      {showDetail && <span className={cn("text-[11px]", h.showingLastKnown || h.freshness === "stale" ? "font-semibold text-danger" : "text-muted")}>{h.detail}</span>}
    </span>
  );
}
