"use client";

import { useState, useTransition } from "react";
import { seedFirstEvent } from "@/lib/actions/events";
import { FIRST_EVENT } from "@/lib/first-event";

/** One-tap creation of the preconfigured AJP Qatar 2026 event (no match data). */
export function SeedFirstEventButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            const result = await seedFirstEvent();
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? "Creating…" : "Set up AJP Qatar 2026"}
      </button>
      <p className="mt-1.5 max-w-xs text-[11px] text-muted">{FIRST_EVENT.venue} · 16 Oct 2026</p>
      {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}
