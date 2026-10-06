"use client";

import { ClientCard } from "@/components/ClientCard";
import { watchStateCopy } from "@/components/watchStateCopy";
import type { AthleteEta } from "@/lib/eta";

export function EventClientsList({ entries, timezone }: { entries: AthleteEta[]; timezone: string }) {
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.athlete.id}>
          <ClientCard entry={entry} timezone={timezone} note={watchStateCopy(entry.athlete.last_watch_status, entry.athlete.last_watch_message, entry.athlete.last_watch_code)} />
        </li>
      ))}
    </ul>
  );
}
