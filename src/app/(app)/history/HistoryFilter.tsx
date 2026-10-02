"use client";

import { useRouter } from "next/navigation";
import type { AthleteRow, EventRow } from "@/lib/types";

type Props = {
  events: EventRow[];
  athletes: Array<Pick<AthleteRow, "id" | "name" | "event_id">>;
  currentEventId: string;
  currentAthleteId: string;
  currentType: string;
  types: Array<{ value: string; label: string }>;
};

/** Event / athlete / change-type filters; each change navigates to page one. */
export function HistoryFilter({ events, athletes, currentEventId, currentAthleteId, currentType, types }: Props) {
  const router = useRouter();
  if (!events.length) return null;

  function navigate(next: { event?: string; athlete?: string; type?: string }) {
    const q = new URLSearchParams();
    q.set("event", next.event ?? currentEventId);
    const athlete = next.athlete ?? (next.event !== undefined ? "" : currentAthleteId);
    const type = next.type ?? currentType;
    if (athlete) q.set("athlete", athlete);
    if (type) q.set("type", type);
    router.push(`/history?${q.toString()}`);
  }

  return (
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Filter activity">
      <select className="input min-h-10 py-0 text-sm font-semibold" value={currentEventId} onChange={(e) => navigate({ event: e.target.value })} aria-label="Event">
        <option value="all">All events</option>
        {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <select className="input min-h-10 py-0 text-sm" value={currentAthleteId} onChange={(e) => navigate({ athlete: e.target.value })} aria-label="Client">
        <option value="">All clients</option>
        {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select className="input min-h-10 py-0 text-sm" value={currentType} onChange={(e) => navigate({ type: e.target.value })} aria-label="Change type">
        <option value="">All changes</option>
        {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
    </div>
  );
}
