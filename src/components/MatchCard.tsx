"use client";

import Link from "next/link";
import type { AthleteEta } from "@/lib/eta";
import type { AthleteRefreshState } from "@/hooks/useLiveAthletes";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { EtaBadge } from "./EtaBadge";
import { snapshotNumber } from "./NextClientCard";
import { RefreshButton } from "./RefreshButton";
import { SourceLinkButton } from "./SourceLinkButton";
import { StatusBadge } from "./StatusBadge";
import { watchStateCopy } from "./watchStateCopy";

type Props = {
  entry: AthleteEta;
  timezone: string;
  state?: AthleteRefreshState;
  onRefresh: () => void;
};

const BORDER: Record<string, string> = {
  "ON MAT": "border-danger/60 ring-2 ring-danger/20",
  "GO TO MAT": "border-danger/60 ring-2 ring-danger/20",
  "5 MIN": "border-orange/50",
  "15 MIN": "border-warning/40",
  "30 MIN": "border-warning/30",
};

/** Dense Match Watcher row: athlete, opponent, mat, time, ETA, match #, status. */
export function MatchCard({ entry, timezone, state, onRefresh }: Props) {
  const { athlete, match, eta } = entry;
  const time = match ? (match.estimated_at ?? match.scheduled_at) : null;
  const failed = state?.status && state.status !== "OK" && state.status !== "NO_MATCHES" && state.status !== null;
  const copy = watchStateCopy(state?.status ?? athlete.last_watch_status, state?.message ?? athlete.last_watch_message);

  return (
    <article className={cn("card p-3.5", BORDER[eta.bucket] ?? "border-line", failed && !match && "border-danger/30")} aria-label={athlete.name}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/clients/${athlete.id}`} className="truncate text-base font-extrabold text-ink hover:text-primary">
              {athlete.name}
            </Link>
            <StatusBadge bucket={eta.bucket} size="sm" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {athlete.academy ?? "—"}
            {athlete.division ? ` · ${athlete.division}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <EtaBadge eta={eta} className="text-lg" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{eta.usesEstimate ? "est." : "sched."}</p>
        </div>
      </div>

      {match ? (
        <dl className="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-page p-2.5 text-center">
          <Cell label="Mat" value={match.mat?.replace(/^Mat\s*/i, "") ?? "—"} strong />
          <Cell label="Time" value={formatTime(time, timezone)} strong />
          <Cell label="Match #" value={snapshotNumber(match) ?? (match.match_order ? String(match.match_order) : "—")} />
          <Cell label="Opponent" value={match.opponent ?? "Unknown"} />
        </dl>
      ) : (
        <p className={cn("mt-3 rounded-xl px-3 py-2 text-xs font-semibold", failed ? "bg-danger-soft text-danger" : "bg-page text-muted")}>
          {copy}
        </p>
      )}

      {match && failed && <p className="mt-2 text-xs font-semibold text-danger">{copy}</p>}

      <div className="mt-3 flex items-center gap-2">
        <SourceLinkButton url={match?.source_url ?? athlete.source_url} platform={athlete.platform} size="sm" />
        <RefreshButton onClick={onRefresh} loading={state?.loading} label={failed ? "Retry" : "Refresh"} className="min-h-9 px-3 text-xs" />
        <span className="ml-auto text-[11px] text-muted">
          {state?.checkedAt || athlete.last_checked_at ? `Checked ${formatTime(state?.checkedAt ?? athlete.last_checked_at, timezone)}` : "Not checked yet"}
        </span>
      </div>
    </article>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className={cn("truncate tabular-nums", strong ? "text-lg font-black text-ink" : "text-sm font-semibold text-ink")} title={value}>{value}</dd>
    </div>
  );
}
