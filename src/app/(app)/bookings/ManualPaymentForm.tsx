"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { recordManualPayment, type BookingFormState } from "@/lib/actions/bookings";
import { formatQr, PAYMENT_METHOD_LABEL } from "@/lib/bookings/state";
import { todayInZone } from "@/lib/time";

type Props = { bookingId: string; providerPaid: boolean; dueQr: number; currency: string };

const METHODS = ["cash", "bank_transfer", "fawran", "other"] as const;

/**
 * "Record a payment" sheet for cash / bank transfer / Fawran. Disabled once
 * MyFatoorah has verified the booking as paid — a manual record never
 * overrides the provider's verdict.
 */
export function ManualPaymentForm({ bookingId, providerPaid, dueQr, currency }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(async (prev, fd) => {
    const res = await recordManualPayment(bookingId, prev, fd);
    if (res?.saved) {
      setOpen(false);
      router.refresh();
    }
    return res;
  }, null);
  const fe = state?.fieldErrors ?? {};
  const ids = { method: useId(), amount: useId(), paid: useId(), note: useId() };

  if (providerPaid) return <p className="text-xs text-muted">Paid online, verified by MyFatoorah. Manual records are not needed.</p>;

  return (
    <>
      <button type="button" className="btn-primary min-h-11" onClick={() => setOpen(true)}><PlusIcon size={16} /> Record a payment</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60 p-3 backdrop-blur-sm sm:items-center" onClick={() => !pending && setOpen(false)}>
          <form action={formAction} className="card w-full max-w-md space-y-4 p-5 safe-bottom" role="dialog" aria-modal="true" aria-labelledby={`${ids.method}-title`} onClick={(e) => e.stopPropagation()} noValidate>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={`${ids.method}-title`} className="text-lg font-extrabold text-ink">Record a payment</h2>
                {dueQr > 0 && <p className="text-sm text-muted">{formatQr(dueQr)} still due</p>}
              </div>
              <button type="button" className="btn-ghost h-9 w-9 p-0" onClick={() => setOpen(false)} aria-label="Close" disabled={pending}><CloseIcon size={18} /></button>
            </div>
            <FormError message={state?.error} />
            <FormField label="How did it arrive?" htmlFor={ids.method} required error={fe.method}>
              <select id={ids.method} name="method" className="input" defaultValue="cash" required>
                {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
              </select>
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={`Amount (${currency})`} htmlFor={ids.amount} required error={fe.amount_qr}>
                <input id={ids.amount} name="amount_qr" className="input" inputMode="decimal" type="text" defaultValue={dueQr > 0 ? String(dueQr) : ""} placeholder="350" autoComplete="off" required />
              </FormField>
              <FormField label="Received on" htmlFor={ids.paid} error={fe.paid_at}>
                <input id={ids.paid} name="paid_at" className="input" type="date" defaultValue={todayInZone()} />
              </FormField>
            </div>
            <FormField label="Note" htmlFor={ids.note} error={fe.note} hint="Optional, e.g. a Fawran reference">
              <input id={ids.note} name="note" className="input" maxLength={500} autoComplete="off" />
            </FormField>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save payment"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
