"use client";

import Link from "next/link";
import type { AthleteEta } from "@/lib/eta";
import type { AthleteRefreshState } from "@/hooks/useLiveAthletes";
import { sourceHealth } from "@/lib/source-health";
import { formatStamp, formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { EtaBadge } from "./EtaBadge";
import { AlertIcon } from "./icons";
import { snapshotNumber } from "./NextClientCard";
import { RefreshButton } from "./RefreshButton";
import { SourceLinkButton } from "./SourceLinkButton";
import { healthTone } from "./SourceHealthBadge";
import { StatusBadge } from "./StatusBadge";
import { isWatchFailure, watchStateCopy } from "./watchStateCopy";

type Props = {
  entry: AthleteEta;
  timezone: string;
  state?: AthleteRefreshState;
  onRefresh: () => void;
  now?: Date | null;
};

const BORDER: Record<string, string> = {
  "ON MAT": "border-danger/60 ring-2 ring-danger/20",
  "GO TO MAT": "border-danger/60 ring-2 ring-danger/20",
  "5 MIN": "border-orange/50",
  "15 MIN": "border-warning/40",
  "30 MIN": "border-warning/30",
};

/** Dense Match Watcher row: athlete, opponent, mat, time, ETA, match #, status. */
export function MatchCard({ entry, timezone, state, onRefresh, now = null }: Props) {
  const { athlete, match, eta } = entry;
  const time = match ? (match.estimated_at ?? match.scheduled_at) : null;
  const status = state?.status ?? athlete.last_watch_status;
  const failed = isWatchFailure(status);
  const copy = watchStateCopy(status, state?.message ?? athlete.last_watch_message, state?.code ?? athlete.last_watch_code);
  const needsReview = match?.identity_confidence === "ambiguous";
  const manual = Boolean(match?.manual?.mat || match?.manual?.time);
  const health = now ? sourceHealth({ ...athlete, last_watch_status: status, last_watch_code: state?.code ?? athlete.last_watch_code }, now, athlete.matches.length > 0) : null;
  const blocked = health?.attention === "blocked";
  const notFound = health?.attention === "not_found";

  return (
    <article className={cn("card p-3.5", BORDER[eta.bucket] ?? "border-line", failed && !match && "border-danger/30")} aria-label={athlete.name}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/clients/${athlete.id}`} className="min-w-0 break-words text-base font-extrabold text-ink hover:text-primary">
              {athlete.name}
            </Link>
            <StatusBadge bucket={eta.bucket} size="sm" />
          </div>
          <p className="mt-0.5 break-words text-xs text-muted">
            {athlete.academy ?? "—"}
            {athlete.division ? ` · ${athlete.division}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <EtaBadge eta={eta} className="text-lg" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{eta.usesEstimate ? "est." : "sched."}</p>
        </div>
      </div>

      {match && (
        <dl className="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-page p-2.5 text-center">
          <Cell label={match.manual?.mat ? "Mat · manual" : "Mat"} value={match.mat?.replace(/^Mat\s*/i, "") ?? "—"} strong />
          <Cell label={match.manual?.time ? "Time · manual" : "Time"} value={formatTime(time, timezone)} strong />
          <Cell label="Match #" value={snapshotNumber(match) ?? (match.match_order ? String(match.match_order) : "—")} />
          <Cell label="Opponent" value={match.opponent ?? "Unknown"} />
        </dl>
      )}

      {failed ? (
        <div className="mt-2 flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertIcon size={16} className="mt-px shrink-0" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">{copy}</p>
            {match && (
              <p>
                Showing the last confirmed schedule{health?.lastSuccessAt && now ? ` from ${formatStamp(health.lastSuccessAt, timezone, now)}` : ""}. It may have changed since.
              </p>
            )}
          </div>
        </div>
      ) : !match ? (
        <p className={cn("mt-3 rounded-xl px-3 py-2 text-xs font-semibold", notFound ? "bg-amber-50 text-amber-800" : "bg-page text-muted")}>{copy}</p>
      ) : null}

      {needsReview && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">Needs review: similar matches were found, so this row was kept separate.</p>}
      {manual && <p className="mt-2 rounded-lg bg-lightblue px-2 py-1 text-[11px] font-semibold text-primary">Manual correction by the owner is in effect for this match.</p>}

      {health && now && (
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted">
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", healthTone(health))}>{health.label}</span>
          <span>{health.lastSuccessAt ? `Confirmed ${formatStamp(health.lastSuccessAt, timezone, now)}` : "Never confirmed from the source"}</span>
          {health.failedLast && health.lastAttemptAt && (
            <span className="font-semibold text-danger">
              · Last check failed {formatStamp(health.lastAttemptAt, timezone, now)}
              {health.consecutiveFailures > 1 ? ` (${health.consecutiveFailures} in a row)` : ""}
            </span>
          )}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SourceLinkButton url={match?.source_url ?? athlete.source_url} platform={athlete.platform} size="sm" />
        {blocked && athlete.source_url && (
          <Link href={`/import?url=${encodeURIComponent(athlete.source_url)}`} className="btn-secondary min-h-9 px-3 text-xs">Import page</Link>
        )}
        <RefreshButton onClick={onRefresh} loading={state?.loading} label={failed ? "Retry" : "Refresh"} className="min-h-9 px-3 text-xs" />
      </div>
    </article>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "truncate text-lg font-black text-ink" : "break-words text-sm font-semibold leading-tight text-ink")} title={value}>{value}</dd>
    </div>
  );
}
