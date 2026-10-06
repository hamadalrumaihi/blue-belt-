"use client";

import { sourceHealth, type HealthInput, type SourceHealthView } from "@/lib/source-health";
import { cn } from "@/lib/utils";

type Props = { athlete: HealthInput; now: Date | null; hasMatches: boolean; className?: string; showDetail?: boolean };

/** Tone follows what to do, not just age: failures are red, old or missing data amber. */
export function healthTone(h: Pick<SourceHealthView, "attention" | "freshness">): string {
  switch (h.attention) {
    case "blocked":
    case "failing":
      return "bg-danger-soft text-danger";
    case "stale":
    case "not_found":
      return "bg-amber-50 text-amber-800";
    case "unchecked":
      return "bg-page text-muted border border-line";
    default:
      return h.freshness === "aging" ? "bg-amber-50 text-amber-800" : "bg-success-soft text-success";
  }
}

/** "Live / Aging / Stale / Blocked / Not found / Not checked" pill; the label is text, never colour alone. */
export function SourceHealthBadge({ athlete, now, hasMatches, className, showDetail }: Props) {
  if (!now) return null;
  const h = sourceHealth(athlete, now, hasMatches);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", healthTone(h))} title={h.detail}>
        {h.label}
      </span>
      {showDetail && <span className={cn("text-[11px]", h.failedLast || h.attention === "stale" ? "font-semibold text-danger" : "text-muted")}>{h.detail}</span>}
    </span>
  );
}
