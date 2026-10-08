"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId } from "react";
import { FormError, FormField } from "@/components/FormField";
import { setBookingPrice, type BookingFormState } from "@/lib/actions/bookings";
import { formatQr } from "@/lib/bookings/state";

type Props = { bookingId: string; amountQr: number; currency: string; note: string | null; locked: boolean; depositPaid?: boolean };

/** Inline "Set the price" form. The 50% deposit and the balance are split on the server; after the deposit is paid only the balance follows. */
export function FinalAmountForm({ bookingId, amountQr, currency, note, locked, depositPaid = false }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(async (prev, fd) => {
    const res = await setBookingPrice(bookingId, prev, fd);
    if (res?.saved) router.refresh();
    return res;
  }, null);
  const fe = state?.fieldErrors ?? {};
  const ids = { amount: useId(), note: useId() };

  if (locked) return <p className="text-sm text-muted">Paid in full: {formatQr(amountQr)}. The amount can no longer change.</p>;

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormError message={state?.error} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <FormField label={`Total (${currency})`} htmlFor={ids.amount} required error={fe.amount_qr} hint={depositPaid ? "The deposit is paid and stays as it is; only the remaining balance changes." : "Split 50% deposit / 50% balance on save."}>
          <input id={ids.amount} name="amount_qr" className="input" inputMode="decimal" type="text" defaultValue={amountQr > 0 ? String(amountQr) : ""} placeholder="1000" autoComplete="off" required />
        </FormField>
        <FormField label="Note" htmlFor={ids.note} error={fe.note} hint="Optional, e.g. extra hour or travel.">
          <input id={ids.note} name="note" className="input" maxLength={300} defaultValue={note ?? ""} autoComplete="off" />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary min-h-11" disabled={pending} aria-busy={pending}>{pending ? "Saving..." : amountQr > 0 ? "Update price" : "Set price"}</button>
        <p role="status" aria-live="polite" className="text-xs text-muted">{state?.saved ? "Price saved. Deposit and balance updated." : ""}</p>
      </div>
    </form>
  );
}
