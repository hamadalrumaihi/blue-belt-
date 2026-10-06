"use client";

import Link from "next/link";
import type { AthleteEta } from "@/lib/eta";
import { formatCountdown } from "@/lib/eta";
import { sourceHealth } from "@/lib/source-health";
import { formatStamp, formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PlatformBadge } from "./PlatformBadge";
import { RefreshButton } from "./RefreshButton";
import { SourceLinkButton } from "./SourceLinkButton";
import { StatusBadge } from "./StatusBadge";
import { EyeIcon } from "./icons";

type Props = {
  entry: AthleteEta | null;
  timezone: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Message explaining why there is no match (schedule not published etc). */
  note?: string | null;
  sticky?: boolean;
  /** Client clock; enables the "schedule not confirmed" warning. */
  now?: Date | null;
};

const BG: Record<string, string> = {
  "ON MAT": "from-danger to-red-700",
  "GO TO MAT": "from-danger to-red-700",
  "5 MIN": "from-orange to-orange-700",
  "15 MIN": "from-amber-500 to-amber-600",
  "30 MIN": "from-amber-500 to-amber-600",
};

/** The single most important element on the dashboard: who is next, where, how soon. */
export function NextClientCard({ entry, timezone, onRefresh, refreshing, note, sticky = true, now = null }: Props) {
  if (!entry || !entry.match) {
    return (
      <section aria-label="Next client" className={cn(sticky && "sticky top-14 z-10")}>
        <div className="card overflow-hidden bg-gradient-to-br from-navy to-navy-700 p-5 text-white shadow-hero">
          <p className="eyebrow text-white/60">Next client</p>
          {entry ? (
            <>
              <h2 className="mt-1 text-2xl font-extrabold">{entry.athlete.name}</h2>
              <p className="mt-1 text-sm text-white/70">{note ?? "Schedule not published yet."}</p>
              <div className="mt-4 flex gap-2">
                <SourceLinkButton url={entry.athlete.source_url} platform={entry.athlete.platform} variant="inverted" />
                {onRefresh && <RefreshButton onClick={onRefresh} loading={refreshing} variant="ghost" className="text-white hover:bg-white/10" />}
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-1 text-2xl font-extrabold">Nobody on deck</h2>
              <p className="mt-1 text-sm text-white/70">{note ?? "Add clients with their AJP or Smoothcomp links to start tracking."}</p>
            </>
          )}
        </div>
      </section>
    );
  }

  const { athlete, match, eta } = entry;
  const gradient = BG[eta.bucket] ?? "from-primary to-primary-700";
  const time = match.estimated_at ?? match.scheduled_at;
  const health = now ? sourceHealth(athlete, now, true) : null;
  const unconfirmed = health && (health.failedLast || health.attention === "stale");

  return (
    <section aria-label="Next client" className={cn(sticky && "sticky top-14 z-10")}>
      <div className={cn("card overflow-hidden bg-gradient-to-br p-5 text-white shadow-hero", gradient)}>
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow text-white/70">Next client</p>
          <StatusBadge bucket={eta.bucket} size="lg" className="bg-white/15 text-white ring-1 ring-white/30" />
        </div>

        <div className="mt-2 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/clients/${athlete.id}`} className="block truncate text-3xl font-extrabold leading-tight">
              {athlete.name}
            </Link>
            <p className="mt-1 truncate text-sm text-white/80">
              {[athlete.academy, athlete.division].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-4xl font-black leading-none tabular-nums">{eta.bucket === "ON MAT" ? "NOW" : formatCountdown(eta.minutesRemaining).replace(/^in /, "")}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-white/70">{eta.usesEstimate ? "estimated" : "scheduled"}</p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 rounded-2xl bg-white/12 p-3 text-center ring-1 ring-white/20">
          <Stat label="Mat" value={match.mat?.replace(/^Mat\s*/i, "") ?? "—"} big />
          <Stat label="Time" value={formatTime(time, timezone)} big />
          <Stat label="Match #" value={snapshotNumber(match) ?? (match.match_order ? `${match.match_order}` : "—")} big />
        </dl>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Opponent</p>
            <p className="truncate font-bold">{match.opponent ?? "Unknown"}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Scheduled · Estimated</p>
            <p className="font-bold tabular-nums">{formatTime(match.scheduled_at, timezone)} · {formatTime(match.estimated_at, timezone)}</p>
          </div>
        </div>

        {unconfirmed && now && (
          <p className="mt-4 rounded-xl bg-navy/40 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/30">
            {health.label}: {health.failedLast ? "the last check failed. " : ""}Schedule last confirmed {health.lastSuccessAt ? formatStamp(health.lastSuccessAt, timezone, now) : "never"}. Check the source before relying on it.
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <SourceLinkButton url={match.source_url ?? athlete.source_url} platform={athlete.platform} variant="inverted" className="flex-1" />
          <Link href="/watcher" className="btn bg-white/15 text-white ring-1 ring-white/30 hover:bg-white/25" aria-label="Open Match Watcher">
            <EyeIcon size={18} />
          </Link>
          {onRefresh && <RefreshButton onClick={onRefresh} loading={refreshing} variant="icon" className="text-white hover:bg-white/15" />}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-white/60">
          <PlatformBadge platform={athlete.platform} className="bg-white/15 text-white" />
          <span>Status: {match.status.replace("_", " ")}</span>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-white/60">{label}</dt>
      <dd className={cn("truncate font-black tabular-nums", big ? "text-2xl" : "text-base")}>{value}</dd>
    </div>
  );
}

export function snapshotNumber(match: { raw_snapshot: unknown }): string | null {
  const snap = match.raw_snapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    const n = (snap as Record<string, unknown>).matchNumber;
    if (typeof n === "string" && n) return n;
    if (typeof n === "number") return String(n);
  }
  return null;
}
