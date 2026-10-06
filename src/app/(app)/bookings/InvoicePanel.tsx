"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { ExternalIcon, CreditCardIcon } from "@/components/icons";
import { requestBookingInvoice } from "@/lib/actions/bookings";

type Props = { bookingId: string; paymentsEnabled: boolean; paymentUrl: string | null; canInvoice: boolean; invoiceId: string | null };

/**
 * MyFatoorah payment link for one booking. Creating the link is an explicit
 * owner action; sending it to the client is a separate, opt-in tick.
 */
export function InvoicePanel({ bookingId, paymentsEnabled, paymentUrl, canInvoice, invoiceId }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const checkboxId = useId();

  function create() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await requestBookingInvoice(bookingId, notify);
      if (!res.ok) setError(res.error);
      else {
        setNotice(res.alreadyInvoiced ? "A payment link already exists for this booking." : res.emailQueued ? "Payment link created and queued for the client by e-mail." : "Payment link created. Share it with the client yourself.");
        router.refresh();
      }
    });
  }

  if (paymentUrl) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">MyFatoorah link{invoiceId ? ` · invoice ${invoiceId}` : ""}</p>
        <p className="break-all rounded-lg bg-page px-3 py-2 text-xs text-ink">{paymentUrl}</p>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={paymentUrl} label="Copy link" copiedLabel="Link copied" />
          <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11"><ExternalIcon size={16} /> Open</a>
        </div>
        <p role="status" aria-live="polite" className="text-xs text-muted">{notice}</p>
      </div>
    );
  }

  if (!paymentsEnabled) return <p className="text-xs text-muted">Online payments (MyFatoorah) are not switched on. Record cash, bank or Fawran payments by hand.</p>;
  if (!canInvoice) return null;

  return (
    <div className="space-y-3">
      <label htmlFor={checkboxId} className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
        <input id={checkboxId} type="checkbox" className="h-5 w-5 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={pending} />
        <span className="text-sm text-ink">Send to client by e-mail <span className="text-muted">(off by default — you decide when the link goes out)</span></span>
      </label>
      <button type="button" className="btn-secondary min-h-11" disabled={pending} aria-busy={pending} onClick={create}><CreditCardIcon size={16} /> {pending ? "Creating…" : "Create MyFatoorah link"}</button>
      <p role="status" aria-live="polite" className="text-xs text-muted">{notice}</p>
      <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
