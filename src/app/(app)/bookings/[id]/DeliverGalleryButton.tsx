"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { SendIcon } from "@/components/icons";
import { deliverGallery } from "@/lib/actions/galleries";

type Props = { galleryId: string; galleryName: string; balanceQr: number; hasEmail: boolean; disabledReason?: string | null };

/**
 * "Deliver gallery": the explicit owner action that marks the booking
 * delivered and makes the final balance due. The client e-mail is an opt-in
 * tick, OFF by default. The final payment link is never created here.
 */
export function DeliverGalleryButton({ galleryId, galleryName, balanceQr, hasEmail, disabledReason }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [notify, setNotify] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const checkboxId = useId();

  function deliver() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await deliverGallery(galleryId, { notifyClient: notify });
      if (!res.ok) setError(res.error);
      else {
        setConfirming(false);
        setNotice(`Gallery delivered.${res.balanceDue ? " The final balance is now due; create its payment link below when you are ready." : ""}${res.notified ? " Client e-mailed." : res.notifyReason ? ` ${res.notifyReason}` : " Client not e-mailed."}`);
        router.refresh();
      }
    });
  }

  if (disabledReason) return <p className="text-sm text-muted">{disabledReason}</p>;

  return (
    <div className="space-y-2">
      {!confirming ? (
        <button type="button" className="btn-primary min-h-11" onClick={() => setConfirming(true)}><SendIcon size={16} /> Deliver gallery</button>
      ) : (
        <div className="rounded-xl border border-primary/30 bg-lightblue/40 p-3">
          <p className="text-sm text-ink">Deliver <span className="font-semibold">{galleryName}</span>? The booking becomes delivered{balanceQr > 0 ? ` and the final balance (${balanceQr.toLocaleString("en-QA")} QAR) becomes due. The payment link is not created or sent until you do it yourself.` : "."}</p>
          <label htmlFor={checkboxId} className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-line bg-white px-3">
            <input id={checkboxId} type="checkbox" className="h-5 w-5 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={pending || !hasEmail} />
            <span className="text-sm text-ink">Notify the client by e-mail {hasEmail ? <span className="text-muted">(subject: Your private gallery is ready)</span> : <span className="text-warning">(no e-mail on file)</span>}</span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary min-h-11" onClick={deliver} disabled={pending} aria-busy={pending}>{pending ? "Delivering..." : "Yes, deliver"}</button>
            <button type="button" className="btn-secondary min-h-11" onClick={() => setConfirming(false)} disabled={pending}>Not yet</button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className="text-xs text-muted">{notice}</p>
      <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
