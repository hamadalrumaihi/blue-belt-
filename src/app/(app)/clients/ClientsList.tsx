"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PlatformBadge } from "@/components/PlatformBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { ChevronRightIcon, SearchIcon } from "@/components/icons";
import { useNow } from "@/hooks/useNow";
import { computeEta, pickCurrentMatch } from "@/lib/eta";
import { formatTime } from "@/lib/time";
import type { AthleteWithMatches, EventRow } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

type Props = { athletes: AthleteWithMatches[]; events: EventRow[]; initialEventId: string | null; initialShowPaused?: boolean };

export function ClientsList({ athletes, events, initialEventId, initialShowPaused = false }: Props) {
  const [query, setQuery] = useState("");
  const [eventId, setEventId] = useState(initialEventId ?? "");
  const [showInactive, setShowInactive] = useState(initialShowPaused);
  const now = useNow(30_000);
  const eventName = useMemo(() => new Map(events.map((e) => [e.id, e.name])), [events]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return athletes.filter((a) => {
      if (!showInactive && !a.active) return false;
      if (eventId && a.event_id !== eventId) return false;
      if (!q) return true;
      const hay = [a.name, a.academy, a.division, a.belt, a.event?.name, a.email, a.phone].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [athletes, query, eventId, showInactive]);

  const pausedCount = useMemo(() => athletes.filter((a) => !a.active && (!eventId || a.event_id === eventId)).length, [athletes, eventId]);

  const grouped = useMemo(() => {
    const map = new Map<string, AthleteWithMatches[]>();
    for (const a of visible) {
      const key = a.event_id ?? "none";
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search athlete, academy, division, event" className="input pl-10" aria-label="Search clients" />
      </div>
      <div className="flex gap-2">
        <select className="input min-h-10 flex-1 py-0 text-sm" value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Filter by event">
          <option value="">All events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button type="button" aria-pressed={showInactive} onClick={() => setShowInactive((v) => !v)} className={cn("btn min-h-10 border px-3 text-xs", showInactive ? "border-primary bg-lightblue text-primary" : "border-line bg-white text-muted")}>
          {showInactive ? "Showing paused" : `Show paused (${pausedCount})`}
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState compact title="No clients match" description="Try a different search or event." />
      ) : (
        grouped.map(([key, list]) => (
          <section key={key}>
            <h2 className="mb-2 mt-2 truncate text-sm font-extrabold uppercase tracking-wider text-muted">{eventName.get(key) ?? "No event"} · {list.length}</h2>
            <ul className="card divide-y divide-line">
              {list.map((a) => {
                const match = pickCurrentMatch(a.matches, now ?? new Date(0));
                const eta = computeEta(match, now ?? new Date(0));
                const tz = a.event?.timezone ?? "Asia/Qatar";
                return (
                  <li key={a.id}>
                    <Link href={`/clients/${a.id}`} className={cn("flex items-center gap-3 px-3.5 py-3 hover:bg-page", !a.active && "opacity-60")}>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lightblue text-sm font-extrabold text-primary">{initials(a.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2"><span className="truncate text-sm font-bold text-ink">{a.name}</span><PlatformBadge platform={a.platform} />{!a.active && <span className="shrink-0 rounded-full border border-line bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">Paused</span>}</span>
                        <span className="block truncate text-xs text-muted">{[a.academy, a.division, a.belt].filter(Boolean).join(" · ") || "—"}</span>
                        {match && <span className="block text-xs font-semibold text-ink">{match.mat ?? "Mat —"} · {formatTime(match.estimated_at ?? match.scheduled_at, tz)}{match.opponent ? ` · vs ${match.opponent}` : ""}</span>}
                      </span>
                      {now && <StatusBadge bucket={eta.bucket} size="sm" />}
                      <ChevronRightIcon size={18} className="shrink-0 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
