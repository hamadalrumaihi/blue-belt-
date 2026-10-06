"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { convertLeadToBooking, setLeadStatus } from "@/lib/actions/leads";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@/lib/leads/labels";
import type { LeadStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const TONE: Record<LeadStatus, string> = {
  new: "bg-lightblue text-primary border-primary/20",
  contacted: "bg-warning-soft text-warning border-warning/30",
  quoted: "bg-warning-soft text-warning border-warning/30",
  converted: "bg-success-soft text-success border-success/30",
  lost: "bg-page text-muted border-line",
};

/** Status select + convert button for one lead; the row itself is rendered by the server page. */
export function LeadControls({ id, status, bookingId }: { id: string; status: LeadStatus; bookingId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`status-${id}`}>Lead status</label>
      <select
        id={`status-${id}`}
        className={cn("input min-h-10 w-auto rounded-full border px-3 text-xs font-bold uppercase tracking-wide", TONE[status])}
        value={status}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as LeadStatus;
          setError(null);
          startTransition(async () => {
            const r = await setLeadStatus(id, next);
            if (!r.ok) setError(r.error);
          });
        }}
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>
        ))}
      </select>
      {bookingId ? (
        <Link href={`/bookings/${bookingId}`} className="btn-secondary min-h-10">Open booking</Link>
      ) : (
        <button
          type="button"
          className="btn-primary min-h-10"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await convertLeadToBooking(id);
              if (!r.ok) setError(r.error);
              else if (r.bookingId) router.push(`/bookings/${r.bookingId}`);
            });
          }}
        >
          {pending ? "Working…" : "Create booking"}
        </button>
      )}
      {error && <p className="w-full text-xs font-semibold text-danger" role="alert">{error}</p>}
      <p className="sr-only" aria-live="polite">{pending ? "Saving" : ""}</p>
    </div>
  );
}
