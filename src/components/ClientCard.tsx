"use client";

import Link from "next/link";
import type { AthleteEta } from "@/lib/eta";
import { isWatchFailure } from "@/lib/source-health";
import { formatTime } from "@/lib/time";
import { cn, initials } from "@/lib/utils";
import { EtaBadge } from "./EtaBadge";
import { PlatformBadge } from "./PlatformBadge";
import { SourceHealthBadge } from "./SourceHealthBadge";
import { StatusBadge } from "./StatusBadge";
import { ChevronRightIcon } from "./icons";

type Props = {
  entry: AthleteEta;
  timezone: string;
  /** Explains a missing match ("Schedule not published yet."). */
  note?: string | null;
  className?: string;
  now?: Date | null;
};

/** Compact upcoming-client card for the dashboard list. */
export function ClientCard({ entry, timezone, note, className, now = null }: Props) {
  const { athlete, match, eta } = entry;
  const time = match ? (match.estimated_at ?? match.scheduled_at) : null;
  return (
    <Link
      href={`/clients/${athlete.id}`}
      className={cn("card flex items-center gap-3 p-3.5 transition-colors hover:border-primary/40", className)}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lightblue text-sm font-extrabold text-primary">
        {initials(athlete.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-bold text-ink">{athlete.name}</span>
          <PlatformBadge platform={athlete.platform} />
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {athlete.academy ?? "—"}
          {match?.opponent ? ` · vs ${match.opponent}` : ""}
        </span>
        {match ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-ink">
            <span>{match.mat ?? "Mat —"}</span>
            <span className="tabular-nums">{formatTime(time, timezone)}</span>
            <EtaBadge eta={eta} />
            <SourceHealthBadge athlete={athlete} now={now} hasMatches={athlete.matches.length > 0} />
          </span>
        ) : (
          <span className={cn("mt-1.5 block text-xs font-semibold", isWatchFailure(athlete.last_watch_status) ? "text-danger" : "text-muted")}>{note ?? "Schedule not published yet."}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <StatusBadge bucket={eta.bucket} size="sm" />
        <ChevronRightIcon size={18} className="text-muted" />
      </span>
    </Link>
  );
}
