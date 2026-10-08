"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { approveQuote, transitionBooking } from "@/lib/actions/bookings";
import { BOOKING_STATUS_LABEL, BOOKING_TRANSITIONS } from "@/lib/bookings/state";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Props = { bookingId: string; status: BookingStatus; /** Confirmation is earned through the gates; when blocked the button explains why. */ confirmBlocked?: string | null; priced?: boolean };

/** Forward moves read as actions ("Confirm"), corrections as steps back; cancel asks for a reason. */
const VERB: Partial<Record<BookingStatus, string>> = {
  quoted: "Approve quote",
  awaiting_contract: "Needs agreement",
  awaiting_payment: "Needs deposit",
  confirmed: "Confirm booking",
  in_progress: "Start editing",
  delivered: "Mark delivered",
  completed: "Mark completed",
  cancelled: "Cancel booking",
  inquiry: "Reopen as inquiry",
};

const PRIMARY: readonly BookingStatus[] = ["confirmed", "in_progress", "delivered", "completed"];
/** Stages the gates own: the owner never clicks into them by hand. */
const GATED: readonly BookingStatus[] = ["awaiting_contract", "awaiting_payment"];

export function BookingActions({ bookingId, status, confirmBlocked = null, priced = true }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const targets = BOOKING_TRANSITIONS[status].filter((t) => !GATED.includes(t) && !(t === "confirmed" && confirmBlocked));

  function go(to: BookingStatus, why?: string) {
    setError(null);
    start(async () => {
      const res = to === "quoted" && status === "inquiry" ? await approveQuote(bookingId) : await transitionBooking(bookingId, to, why);
      if (!res.ok) setError(res.error);
      else {
        setCancelling(false);
        setReason("");
        router.refresh();
      }
    });
  }

  if (!BOOKING_TRANSITIONS[status].length) return <p className="text-sm text-muted">This booking is completed. Nothing more to do.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {targets.filter((t) => t !== "cancelled").map((to) => (
          <button key={to} type="button" disabled={pending || (to === "quoted" && !priced)} aria-busy={pending} onClick={() => go(to)} className={cn("min-h-11", PRIMARY.includes(to) || (to === "quoted" && status === "inquiry") ? "btn-primary" : "btn-secondary")} title={to === "quoted" && !priced ? "Set the price first." : undefined}>
            {VERB[to] ?? BOOKING_STATUS_LABEL[to]}
          </button>
        ))}
        {BOOKING_TRANSITIONS[status].includes("cancelled") && !cancelling && (
          <button type="button" className="btn-ghost min-h-11 text-danger" disabled={pending} onClick={() => setCancelling(true)}>Cancel booking</button>
        )}
      </div>
      {confirmBlocked && BOOKING_TRANSITIONS[status].includes("confirmed") && <p className="text-xs text-muted">Confirmation happens on its own once the agreement is signed and the deposit is paid.</p>}
      {cancelling && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/50 p-3">
          <label htmlFor={reasonId} className="label">Why is it cancelled? <span className="font-normal text-muted">(sent to the client)</span></label>
          <input id={reasonId} className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Athlete withdrew from the tournament" autoComplete="off" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-danger min-h-11" disabled={pending} aria-busy={pending} onClick={() => go("cancelled", reason)}>{pending ? "Cancelling..." : "Confirm cancellation"}</button>
            <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => setCancelling(false)}>Keep booking</button>
          </div>
        </div>
      )}
      <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
