"use client";

import { useState, useTransition } from "react";
import { setAthleteActive } from "@/lib/actions/clients";
import { cn } from "@/lib/utils";

type Props = { athleteId: string; active: boolean; className?: string };

/**
 * Pause or resume automatic checks for one client. Pausing only stops
 * checks: the client, their matches and change history are kept.
 */
export function PauseWatchButton({ athleteId, active, className }: Props) {
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
            const result = await setAthleteActive(athleteId, !active);
            setError(result?.error ?? null);
          })
        }
      >
        {pending ? "Saving…" : active ? "Pause watching" : "Resume watching"}
      </button>
      <p className="hint">{active ? "Pausing stops automatic checks. Matches and history are kept." : "Paused: not checked automatically. Resume to check again on the next refresh."}</p>
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
