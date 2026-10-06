"use client";

import { useActionState, useId, useState } from "react";
import { FormError, FormField } from "@/components/FormField";
import { applyQuoteForm } from "@/lib/actions/pricing";
import type { ActionState } from "@/lib/actions/types";
import { formatQr } from "@/lib/bookings/state";

type Props = { quoteId: string; defaultAmount: number };

/** The owner confirms (or edits) the amount before it touches the booking. */
export function ApplyQuoteForm({ quoteId, defaultAmount }: Props) {
  const action = applyQuoteForm.bind(null, quoteId);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const fe = state?.fieldErrors ?? {};
  const [amount, setAmount] = useState(String(defaultAmount));
  const ids = { amount: useId(), note: useId() };
  const n = Number(amount.replace(/,/g, ""));
  const preview = Number.isFinite(n) && n > 0 ? formatQr(n) : null;

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormError message={state?.error} />
      <FormField label="Amount (QAR)" htmlFor={ids.amount} required error={fe.amount_qr} hint={preview ? `The booking will show ${preview}.` : "Prefilled with the midpoint; change it as you see fit."}>
        <input id={ids.amount} name="amount_qr" className="input text-lg font-bold" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" required />
      </FormField>
      <FormField label="Note" htmlFor={ids.note} error={fe.note} hint="Why this amount. Kept with the quote, for you only.">
        <input id={ids.note} name="note" className="input" maxLength={500} autoComplete="off" />
      </FormField>
      <button type="submit" className="btn-primary min-h-11 w-full" disabled={pending} aria-busy={pending}>{pending ? "Applying…" : "Apply this amount to the booking"}</button>
      <p className="text-[11px] text-muted" aria-live="polite">No e-mail or message is sent. The client sees the new amount only where you show it.</p>
    </form>
  );
}
