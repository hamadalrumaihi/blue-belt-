"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChangeHistory } from "@/components/ChangeHistory";
import { DeleteDialog } from "@/components/DeleteDialog";
import { EtaBadge } from "@/components/EtaBadge";
import { snapshotNumber } from "@/components/NextClientCard";
import { PlatformBadge } from "@/components/PlatformBadge";
import { RefreshButton } from "@/components/RefreshButton";
import { SourceLinkButton } from "@/components/SourceLinkButton";
import { StatusBadge } from "@/components/StatusBadge";
import { EditIcon, MailIcon, PhoneIcon } from "@/components/icons";
import { isWatchFailure, watchStateCopy } from "@/components/watchStateCopy";
import { useLiveAthletes } from "@/hooks/useLiveAthletes";
import { deleteAthlete, deleteMatchDataForAthlete } from "@/lib/actions/danger";
import { computeEta, STATUS_LABEL, matchStatusOf } from "@/lib/eta";
import { formatDateTime, formatTime } from "@/lib/time";
import type { AthleteWithMatches, HistoryEntry } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

type Props = { athlete: AthleteWithMatches; history: HistoryEntry[] };

export function ClientDetail({ athlete: initialAthlete, history: initialHistory }: Props) {
  // Stable identity: the hook adopts new props by reference, so never pass a fresh array per render.
  const initialAthletes = useMemo(() => [initialAthlete], [initialAthlete]);
  const { ranked, history, states, now, refresh } = useLiveAthletes({ initialAthletes, initialHistory, autoRefresh: false });
  const entry = ranked[0];
  const athlete = entry?.athlete ?? initialAthlete;
  const state = states[athlete.id];
  const tz = athlete.event?.timezone ?? "Asia/Qatar";
  const current = entry?.match ?? null;
  const eta = entry?.eta ?? computeEta(null);
  const status = state?.status ?? athlete.last_watch_status;
  const failed = isWatchFailure(status);
  const matches = [...athlete.matches].sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {/* Next known match */}
        <section className={cn("card p-4", current && (eta.bucket === "ON MAT" || eta.bucket === "GO TO MAT") && "border-danger/50 ring-2 ring-danger/20")} aria-label="Next known match">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Next known match</p>
            {now && <StatusBadge bucket={eta.bucket} />}
          </div>
          {current ? (
            <>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-3xl font-black text-ink">{current.mat ?? "Mat —"}</p>
                  <p className="text-sm text-muted">vs <span className="font-bold text-ink">{current.opponent ?? "Unknown"}</span></p>
                </div>
                {now && <EtaBadge eta={eta} size="lg" />}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-page p-3 text-center">
                <div><dt className="eyebrow">Scheduled</dt><dd className="text-lg font-black tabular-nums">{formatTime(current.scheduled_at, tz)}</dd></div>
                <div><dt className="eyebrow">Estimated</dt><dd className="text-lg font-black tabular-nums">{formatTime(current.estimated_at, tz)}</dd></div>
                <div><dt className="eyebrow">Match #</dt><dd className="text-lg font-black tabular-nums">{snapshotNumber(current) ?? current.match_order ?? "—"}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-muted">Status: {STATUS_LABEL[matchStatusOf(current)]} · Checked {formatTime(state?.checkedAt ?? current.last_checked_at, tz)}</p>
            </>
          ) : (
            <p className={cn("mt-2 rounded-xl px-3 py-2 text-sm font-semibold", failed ? "bg-danger-soft text-danger" : "bg-page text-muted")}>{watchStateCopy(status, state?.message ?? athlete.last_watch_message)}</p>
          )}
          {current && failed && <p className="mt-2 text-xs font-semibold text-danger">{watchStateCopy(status, state?.message ?? athlete.last_watch_message)}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <RefreshButton onClick={() => refresh([athlete.id])} loading={state?.loading} label={failed ? "Retry refresh" : "Refresh Match Data"} variant="primary" disabled={!athlete.source_url} />
            <SourceLinkButton url={athlete.source_url} platform={athlete.platform} />
          </div>
        </section>

        {/* Profile */}
        <section className="card p-4" aria-label="Client profile">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lightblue text-base font-extrabold text-primary">{initials(athlete.name)}</span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-extrabold text-ink">{athlete.name}</h2>
              <p className="truncate text-sm text-muted">{[athlete.academy, athlete.belt ? `${athlete.belt} belt` : null].filter(Boolean).join(" · ") || "—"}</p>
            </div>
            <PlatformBadge platform={athlete.platform} className="ml-auto" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {athlete.phone && <a href={`tel:${athlete.phone}`} className="btn-secondary"><PhoneIcon size={16} /> Call</a>}
            {athlete.email && <a href={`mailto:${athlete.email}`} className="btn-secondary"><MailIcon size={16} /> Email</a>}
          </div>
          <dl className="mt-4 divide-y divide-line text-sm">
            <Row label="Phone" value={athlete.phone} />
            <Row label="Email" value={athlete.email} />
            <Row label="Academy" value={athlete.academy} />
            <Row label="Division" value={athlete.division} />
            <Row label="Weight" value={athlete.weight} />
            <Row label="Belt" value={athlete.belt} />
            <Row label="Gender" value={athlete.gender} />
            <Row label="Age category" value={athlete.age_category} />
            <Row label="Package" value={athlete.package_name} />
            <Row label="Tournament" value={athlete.event ? <Link href={`/events/${athlete.event.id}`} className="font-semibold text-primary hover:underline">{athlete.event.name}</Link> : null} />
            <Row label="Source URL" value={athlete.source_url ? <a href={athlete.source_url} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{athlete.source_url}</a> : null} />
            <Row label="Notes" value={athlete.notes} />
            <Row label="Internal notes" value={athlete.internal_notes} />
            <Row label="Tracking" value={athlete.active ? "Active" : "Paused"} />
          </dl>
          <div className="mt-4">
            <Link href={`/clients/${athlete.id}/edit`} className="btn-secondary w-full"><EditIcon size={16} /> Edit Client</Link>
          </div>
        </section>
      </div>

      <div className="space-y-4">
        {/* Schedule history */}
        <section aria-label="Schedule history">
          <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-muted">Schedule</h3>
          {matches.length === 0 ? (
            <p className="card px-4 py-3 text-sm text-muted">No matches tracked yet.</p>
          ) : (
            <ul className="card divide-y divide-line">
              {matches.map((m) => {
                const e = computeEta(m, now ?? new Date(0));
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink">{m.mat ?? "Mat —"} · {formatTime(m.estimated_at ?? m.scheduled_at, tz)}{snapshotNumber(m) ? ` · #${snapshotNumber(m)}` : ""}</p>
                      <p className="truncate text-xs text-muted">vs {m.opponent ?? "Unknown"} · {STATUS_LABEL[matchStatusOf(m)]} · changed {formatDateTime(m.last_changed_at, tz)}</p>
                    </div>
                    {now && <StatusBadge bucket={e.bucket} size="sm" />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Change history">
          <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-muted">Change history</h3>
          <ChangeHistory entries={history} timezone={tz} hideAthlete showDate />
        </section>

        <section className="card border-danger/20 p-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-danger">Danger zone</h3>
          <div className="mt-3 flex flex-col gap-2">
            <DeleteDialog
              trigger="Delete match data"
              title="Delete match data"
              summary={<p>Deletes <strong>{athlete.matches.length}</strong> tracked match{athlete.matches.length === 1 ? "" : "es"} and change history for <strong>{athlete.name}</strong>. The client record stays.</p>}
              confirmLabel="Delete match data"
              onConfirm={() => deleteMatchDataForAthlete(athlete.id)}
            />
            <DeleteDialog
              trigger="Delete Client"
              title="Delete client"
              summary={<p>Deletes <strong>{athlete.name}</strong>, their <strong>{athlete.matches.length}</strong> tracked match{athlete.matches.length === 1 ? "" : "es"} and change history. Their Pic-Time gallery is not affected.</p>}
              confirmLabel="Delete client"
              onConfirm={() => deleteAthlete(athlete.id)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-3 gap-2 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
