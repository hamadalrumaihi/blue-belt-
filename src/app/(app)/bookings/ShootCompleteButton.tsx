"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CameraIcon } from "@/components/icons";
import { markShootComplete } from "@/lib/actions/bookings";

type Props = { bookingId: string; label: string; disabledReason?: string | null };

/** "Mark shoot complete" with an inline confirmation; stamps coverage_done_at and makes payment requestable. */
export function ShootCompleteButton({ bookingId, label, disabledReason }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    start(async () => {
      const res = await markShootComplete(bookingId);
      if (!res.ok) setError(res.error);
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  }

  if (disabledReason) return <p className="text-sm text-muted">{disabledReason}</p>;

  return (
    <div className="space-y-2">
      {!confirming ? (
        <button type="button" className="btn-primary min-h-11" onClick={() => setConfirming(true)}><CameraIcon size={16} /> Mark shoot complete</button>
      ) : (
        <div className="rounded-xl border border-primary/30 bg-lightblue/40 p-3">
          <p className="text-sm text-ink">The shoot for <span className="font-semibold">{label}</span> is done? The booking moves to &ldquo;In progress&rdquo; and you can record the final amount and request payment.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary min-h-11" onClick={confirm} disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Yes, shoot complete"}</button>
            <button type="button" className="btn-secondary min-h-11" onClick={() => setConfirming(false)} disabled={pending}>Not yet</button>
          </div>
        </div>
      )}
      <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
