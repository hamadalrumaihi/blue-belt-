import Link from "next/link";
import { CHANGE_LABEL, isChangeType } from "@/lib/changes";
import { formatDateTime, formatTime } from "@/lib/time";
import type { HistoryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { HistoryIcon } from "./icons";

type Props = {
  entries: HistoryEntry[];
  timezone: string;
  /** Hide the athlete name (on a client's own page). */
  hideAthlete?: boolean;
  showDate?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
};

const DOT: Record<string, string> = {
  MAT_CHANGE: "bg-danger",
  TIME_CHANGE: "bg-warning",
  ETA_CHANGE: "bg-warning",
  OPPONENT_CHANGE: "bg-primary",
  STATUS_CHANGE: "bg-orange",
  ORDER_CHANGE: "bg-primary",
  MATCH_NUMBER_CHANGE: "bg-primary",
  MATCH_FOUND: "bg-success",
};

function labelOf(v: unknown): string {
  if (v && typeof v === "object" && "label" in v && typeof (v as { label: unknown }).label === "string") return (v as { label: string }).label;
  if (v === null || v === undefined) return "Unknown";
  return String(v);
}

/** Activity timeline: "10:15 · Ali Al-Marri moved Mat 3 → Mat 5". */
export function ChangeHistory({ entries, timezone, hideAthlete, showDate, emptyTitle = "No changes yet", emptyDescription = "Mat, time, opponent and status changes will appear here as the watcher detects them." }: Props) {
  if (!entries.length) {
    return <EmptyState compact title={emptyTitle} description={emptyDescription} icon={<HistoryIcon />} />;
  }
  return (
    <ol className="card divide-y divide-line">
      {entries.map((h) => {
        const type = isChangeType(h.change_type) ? h.change_type : null;
        const oldLabel = labelOf(h.old_value);
        const newLabel = labelOf(h.new_value);
        const who = h.athlete_name ?? "Client";
        return (
          <li key={h.id} className="flex gap-3 px-4 py-3">
            <div className="flex w-14 shrink-0 flex-col items-end pt-0.5 text-right">
              <span className="text-sm font-bold tabular-nums text-ink">{formatTime(h.detected_at, timezone)}</span>
              {showDate && <span className="text-[10px] text-muted">{formatDateTime(h.detected_at, timezone).split(",")[0]}</span>}
            </div>
            <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", DOT[h.change_type] ?? "bg-muted")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                {!hideAthlete && (
                  h.athlete_id ? (
                    <Link href={`/clients/${h.athlete_id}`} className="font-bold hover:text-primary">{who}</Link>
                  ) : (
                    <span className="font-bold">{who}</span>
                  )
                )}
                {!hideAthlete && " "}
                <span className="text-muted">{sentence(type)}</span>
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink">
                {type === "MATCH_FOUND" ? newLabel : <>{oldLabel} <span className="text-muted">→</span> {newLabel}</>}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{type ? CHANGE_LABEL[type] : h.change_type}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function sentence(type: string | null): string {
  switch (type) {
    case "MAT_CHANGE": return "moved mats";
    case "TIME_CHANGE": return "schedule time changed";
    case "ETA_CHANGE": return "estimated time changed";
    case "OPPONENT_CHANGE": return "opponent updated";
    case "STATUS_CHANGE": return "status changed";
    case "ORDER_CHANGE": return "match order changed";
    case "MATCH_NUMBER_CHANGE": return "match number changed";
    case "MATCH_FOUND": return "match found";
    default: return "updated";
  }
}
