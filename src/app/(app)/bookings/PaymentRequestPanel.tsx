"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { ExternalIcon, LinkIcon } from "@/components/icons";
import { createPaymentRequest } from "@/lib/actions/bookings";

type Props = {
  bookingId: string;
  paymentsEnabled: boolean;
  /** The website pay link already on the booking, if any. */
  payUrl: string | null;
  canRequest: boolean;
  /** Why a link cannot be created yet (shown instead of the button). */
  blockerLabel: string | null;
  providerInvoiceId: string | null;
  hasEmail: boolean;
};

/**
 * The website payment link for one booking. Creating it is an explicit owner
 * action; e-mailing it to the client is a separate, opt-in tick. The link is
 * the Blue Belt pay page; MyFatoorah's own invoice is created only when the
 * client pays there.
 */
export function PaymentRequestPanel({ bookingId, paymentsEnabled, payUrl, canRequest, blockerLabel, providerInvoiceId, hasEmail }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notify, setNotify] = useState(hasEmail);
  const checkboxId = useId();

  function create() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await createPaymentRequest(bookingId, { notifyClient: notify });
      if (!res.ok) setError(res.error);
      else {
        setNotice(res.emailQueued ? "Payment link created and queued for the client by e-mail." : "Payment link created. Share it with the client yourself.");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {payUrl && (
        <div className="space-y-2">
          <p className="text-xs text-muted">Website pay link{providerInvoiceId ? ` · MyFatoorah invoice ${providerInvoiceId}` : ""}</p>
          <p className="break-all rounded-lg bg-page px-3 py-2 text-xs text-ink">{payUrl}</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={payUrl} label="Copy link" copiedLabel="Link copied" />
            <a href={payUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11"><ExternalIcon size={16} /> Open</a>
          </div>
        </div>
      )}
      {!paymentsEnabled ? (
        <p className="text-xs text-muted">Online payments (MyFatoorah) are not switched on yet. Record cash, bank or Fawran payments by hand.</p>
      ) : canRequest ? (
        <>
          <label htmlFor={checkboxId} className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            <input id={checkboxId} type="checkbox" className="h-5 w-5 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={pending || !hasEmail} />
            <span className="text-sm text-ink">Send to client by e-mail {hasEmail ? <span className="text-muted">(subject: Pay online for your booking)</span> : <span className="text-warning">(no e-mail on file)</span>}</span>
          </label>
          <button type="button" className="btn-primary min-h-11" disabled={pending} aria-busy={pending} onClick={create}><LinkIcon size={16} /> {pending ? "Creating…" : payUrl ? "Create a new payment link" : "Create payment link"}</button>
          {payUrl && <p className="text-xs text-muted">A new link replaces the current one; the old link stops working.</p>}
        </>
      ) : blockerLabel ? (
        <p className="text-sm text-muted">{blockerLabel}</p>
      ) : null}
      <p role="status" aria-live="polite" className="text-xs text-muted">{notice}</p>
      <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
