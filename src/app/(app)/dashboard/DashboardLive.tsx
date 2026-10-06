"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertBanners } from "@/components/AlertBanners";
import { ClientCard } from "@/components/ClientCard";
import { EmptyState } from "@/components/EmptyState";
import { eventStatus } from "@/components/EventCard";
import { LiveIndicator } from "@/components/LiveIndicator";
import { LiveToolbar } from "@/components/LiveToolbar";
import { NextClientCard } from "@/components/NextClientCard";
import { PlatformBadge } from "@/components/PlatformBadge";
import { SourceLinkButton } from "@/components/SourceLinkButton";
import { MapPinIcon, PlusIcon, UsersIcon } from "@/components/icons";
import { watchStateCopy } from "@/components/watchStateCopy";
import { useLiveAthletes } from "@/hooks/useLiveAthletes";
import { buildAlerts } from "@/lib/alerts";
import { formatEventDate } from "@/lib/time";
import type { AthleteWithMatches, EventRow, HistoryEntry } from "@/lib/types";

type Props = { event: EventRow; athletes: AthleteWithMatches[]; history: HistoryEntry[] };

export function DashboardLive({ event, athletes: initialAthletes, history: initialHistory }: Props) {
  const { ranked, history, states, now, lastCheckedAt, refreshingAll, globalError, refresh, settings, connectivity } = useLiveAthletes({
    initialAthletes,
    initialHistory,
  });
  const tz = event.timezone || settings.timezone;

  const active = useMemo(() => ranked.filter((r) => r.athlete.active), [ranked]);
  const next =active.find((r) => r.match && r.eta.bucket !== "COMPLETE" && r.eta.bucket !== "UNKNOWN") ?? active.find((r) => r.match) ?? active[0] ?? null;
  const upcoming = active.filter((r) => r !== next && (settings.showCompleted || r.eta.bucket !== "COMPLETE"));
  const tracked = active.filter((r) => r.athlete.source_url).length;

  const alerts = useMemo(() => (now ? buildAlerts(active, history, settings.notifications, now) : []), [active, history, settings.notifications, now]);

  const status = eventStatus(event);

  return (
    <div className="space-y-4">
      <AlertBanners alerts={alerts} />

      <section aria-label="Current event" className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Current event</p>
            <Link href={`/events/${event.id}`} className="mt-1 block text-lg font-extrabold leading-snug text-ink hover:text-primary">{event.name}</Link>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted"><MapPinIcon size={14} /> {event.venue ?? "Venue TBC"}</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{formatEventDate(event.event_date)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <LiveIndicator status={status} />
            <PlatformBadge platform={event.platform} />
          </div>
        </div>
        {event.source_url && (
          <div className="mt-3">
            <SourceLinkButton url={event.source_url} platform={event.platform} label="Open event page" size="sm" />
          </div>
        )}
      </section>

      <NextClientCard
        entry={next}
        timezone={tz}
        onRefresh={next ? () => refresh([next.athlete.id]) : undefined}
        refreshing={next ? states[next.athlete.id]?.loading : false}
        now={now}
        note={next ? watchStateCopy(states[next.athlete.id]?.status ?? next.athlete.last_watch_status, states[next.athlete.id]?.message ?? next.athlete.last_watch_message, states[next.athlete.id]?.code ?? next.athlete.last_watch_code) : undefined}
      />

      {active.length > 0 && (
        <LiveToolbar lastCheckedAt={lastCheckedAt} refreshing={refreshingAll} onRefreshAll={() => refresh()} error={globalError} trackedCount={tracked} connectivity={connectivity} />
      )}

      <section aria-label="Upcoming clients">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted">Upcoming clients</h2>
          <Link href={`/clients/new?event=${event.id}`} className="btn-ghost min-h-9 px-2 text-xs text-primary"><PlusIcon size={16} /> Add client</Link>
        </div>
        {active.length === 0 && ranked.length > 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="Every client for this event is paused."
            description="Paused clients are not checked. Resume a client from their page to watch them again."
            action={<Link href={`/clients?event=${event.id}&paused=1`} className="btn-primary">Show paused clients</Link>}
          />
        ) : active.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No clients added yet."
            description="Add each pre-booked athlete with their AJP or Smoothcomp link."
            action={<Link href={`/clients/new?event=${event.id}`} className="btn-primary"><PlusIcon size={18} /> Add First Client</Link>}
          />
        ) : upcoming.length === 0 ? (
          <EmptyState compact title="Everyone else is done" description="No other upcoming clients for this event." />
        ) : (
          <ul className="space-y-2">
            {upcoming.map((entry) => (
              <li key={entry.athlete.id}>
                <ClientCard entry={entry} timezone={tz} note={watchStateCopy(states[entry.athlete.id]?.status ?? entry.athlete.last_watch_status, states[entry.athlete.id]?.message ?? entry.athlete.last_watch_message, states[entry.athlete.id]?.code ?? entry.athlete.last_watch_code)} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
