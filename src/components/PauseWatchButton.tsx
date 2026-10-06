"use client";

import { useState, useTransition } from "react";
import { setAthleteActive } from "@/lib/actions/clients";
import { setEventActive } from "@/lib/actions/events";
import { cn } from "@/lib/utils";

type Props = { athleteId?: string; eventId?: string; active: boolean; className?: string };

/**
 * Pause or resume automatic checks for one client, or for a whole tournament
 * (eventId). Pausing only stops checks: clients, matches and change history
 * are kept, and resuming picks up from the last confirmed result.
 */
export function PauseWatchButton({ athleteId, eventId, active, className }: Props) {
  const isEvent = Boolean(eventId);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={cn("space-y-1", className)}>
      <button
        type="button"
        className="btn-secondary w-full"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            const result = eventId ? await setEventActive(eventId, !active) : await setAthleteActive(athleteId ?? "", !active);
            setError(result?.error ?? null);
          })
        }
      >
        {pending ? "Saving…" : active ? (isEvent ? "Pause this tournament" : "Pause watching") : isEvent ? "Resume this tournament" : "Resume watching"}
      </button>
      <p className="hint">
        {active
          ? isEvent ? "Pausing stops scheduled checks for every client in this tournament. Nothing is deleted." : "Pausing stops automatic checks. Matches and history are kept."
          : isEvent ? "Paused: the scheduled refresh skips this tournament. Resume to check it again." : "Paused: not checked automatically. Resume to check again on the next refresh."}
      </p>
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
