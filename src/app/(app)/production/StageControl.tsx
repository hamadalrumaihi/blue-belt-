"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setProductionStage } from "@/lib/actions/studio";
import { PRODUCTION_STAGE_LABEL, type StoredStage } from "@/lib/bookings/production";

type Props = { bookingId: string; current: StoredStage | "shoot_complete"; options: StoredStage[] };

/** Move a card between the stored editing stages (culling / editing / review) or back to Shoot complete. */
export function StageControl({ bookingId, current, options }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!options.length) return null;
  return (
    <div className="mt-2">
      <label className="sr-only" htmlFor={`stage-${bookingId}`}>Editing stage</label>
      <select
        id={`stage-${bookingId}`}
        className="input min-h-9 w-full px-2 text-xs"
        value={current}
        disabled={pending}
        aria-busy={pending}
        onChange={(e) => {
          const v = e.target.value;
          setError(null);
          start(async () => {
            const r = await setProductionStage(bookingId, v === "shoot_complete" ? null : (v as StoredStage));
            if (!r.ok) setError(r.error);
            else router.refresh();
          });
        }}
      >
        <option value="shoot_complete">{PRODUCTION_STAGE_LABEL.shoot_complete}</option>
        {options.map((s) => (
          <option key={s} value={s}>{PRODUCTION_STAGE_LABEL[s]}</option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
