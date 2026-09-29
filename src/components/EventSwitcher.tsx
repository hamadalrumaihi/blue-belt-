"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSettings } from "@/hooks/useSettings";
import type { EventRow } from "@/lib/types";

/** Select which event the dashboard / watcher focuses on (persists per device). */
export function EventSwitcher({ events, currentId }: { events: EventRow[]; currentId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, update] = useSettings();
  if (events.length < 2) return null;
  return (
    <label className="block">
      <span className="sr-only">Event</span>
      <select
        className="input min-h-10 max-w-[220px] truncate py-0 text-sm font-semibold"
        value={currentId ?? ""}
        onChange={(e) => {
          update({ currentEventId: e.target.value || null });
          router.push(`${pathname}?event=${encodeURIComponent(e.target.value)}`);
        }}
      >
        {events.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
    </label>
  );
}
