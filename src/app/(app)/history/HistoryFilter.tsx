"use client";

import { useRouter } from "next/navigation";
import type { EventRow } from "@/lib/types";

export function HistoryFilter({ events, currentId }: { events: EventRow[]; currentId: string }) {
  const router = useRouter();
  if (!events.length) return null;
  return (
    <select className="input min-h-10 max-w-[220px] py-0 text-sm font-semibold" value={currentId} onChange={(e) => router.push(`/history?event=${encodeURIComponent(e.target.value)}`)} aria-label="Event">
      <option value="all">All events</option>
      {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
    </select>
  );
}
