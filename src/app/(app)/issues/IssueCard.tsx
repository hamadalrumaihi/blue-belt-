import Link from "next/link";
import { AlertIcon } from "@/components/icons";
import type { IssueRow } from "@/lib/incidents/queries";
import { incidentRef, KIND_ACTION, KIND_LABEL, KIND_REASON, type IncidentKind } from "@/lib/notifications/incidents";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { IssueDoneButton } from "./IssueDoneButton";

/** One watcher problem: what failed, for whom, when, the next step, and Done. */
export function IssueCard({ issue, now }: { issue: IssueRow; now: Date }) {
  const kind = (issue.kind in KIND_LABEL ? issue.kind : "SOURCE_ERROR") as IncidentKind;
  const state = issue.status === "resolved" ? "resolved" : issue.acknowledged_at ? "done" : "open";
  const label = KIND_LABEL[kind];
  const STATE = {
    open: { text: "Needs action", tone: "bg-danger-soft text-danger" },
    done: { text: "Done · still failing", tone: "bg-amber-50 text-amber-800" },
    resolved: { text: "Resolved", tone: "bg-success-soft text-success" },
  }[state];

  return (
    <article className={cn("card p-4", state === "open" && "border-danger/30")} aria-label={`${label}${issue.event_name ? `, ${issue.event_name}` : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-extrabold text-ink">
          <AlertIcon size={18} className={state === "resolved" ? "text-success" : "text-danger"} />
          <span className="break-words">{label}</span>
        </h3>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", STATE.tone)}>{STATE.text}</span>
      </div>
      <p className="mt-1 break-words text-sm text-muted">
        {issue.event_name ?? "No event"} · {issue.athlete_count} {issue.athlete_count === 1 ? "client" : "clients"}
        {issue.source_host ? ` · ${issue.source_host}` : ""}
      </p>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div><dt className="inline font-bold text-ink">What failed: </dt><dd className="inline text-ink">{KIND_REASON[kind]}</dd></div>
        {state !== "resolved" && <div><dt className="inline font-bold text-ink">Next step: </dt><dd className="inline text-ink">{KIND_ACTION[kind]}</dd></div>}
      </dl>

      <p className="mt-3 text-xs text-muted">
        First seen {formatStamp(issue.first_seen_at, undefined, now)} · last seen {formatStamp(issue.last_seen_at, undefined, now)} · {issue.occurrences} {issue.occurrences === 1 ? "check" : "checks"}
        {issue.resolved_at && state === "resolved" ? ` · resolved ${formatStamp(issue.resolved_at, undefined, now)}` : ""}
        {issue.acknowledged_at && state === "done" ? ` · marked done ${formatStamp(issue.acknowledged_at, undefined, now)}` : ""}
        <span className="ml-1 font-mono">· Ref {incidentRef(issue.incident_key)}</span>
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {state !== "resolved" && <IssueDoneButton id={issue.id} done={state === "done"} label={label} />}
        {issue.event_id && <Link href={`/watcher?event=${issue.event_id}`} className="btn-secondary min-h-11">Open watcher</Link>}
        {state !== "resolved" && (kind === "CHALLENGE" || kind === "PARSE_ERROR") && <Link href="/import" className="btn-secondary min-h-11">Import a page</Link>}
      </div>
    </article>
  );
}
