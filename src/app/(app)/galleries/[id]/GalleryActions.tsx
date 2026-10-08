"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DeleteDialog } from "@/components/DeleteDialog";
import { EditIcon, ExternalIcon, SendIcon } from "@/components/icons";
import { deleteGallery, deliverGallery, markGalleryReady, transitionGallery, type GalleryActionResult } from "@/lib/actions/galleries";
import type { GalleryStatus } from "@/lib/supabase/database.types";

type Props = {
  id: string;
  name: string;
  status: GalleryStatus;
  pictimeUrl: string | null;
  /** Masked or plain address the "ready" e-mail would go to; null when none is on file. */
  clientEmail: string | null;
  emailEnabled: boolean;
  galleryReadyPrefOn: boolean;
  /** The linked booking's remaining balance (0 when none); shown in the delivery confirmation. */
  balanceQr?: number;
  hasBooking?: boolean;
};

/**
 * Owner actions for one gallery. "Mark ready" tells the client the gallery
 * is up (opt-in e-mail) and changes nothing on the booking. "Deliver
 * gallery" is the explicit step that marks the booking delivered and makes
 * the final balance due; its client e-mail is OFF by default and the final
 * payment link is never created here.
 */
export function GalleryActions({ id, name, status, pictimeUrl, clientEmail, emailEnabled, galleryReadyPrefOn, balanceQr = 0, hasBooking = false }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEmail = Boolean(clientEmail) && galleryReadyPrefOn;
  const [notifyReady, setNotifyReady] = useState(canEmail && emailEnabled);
  const [notifyDeliver, setNotifyDeliver] = useState(false);

  function run(action: () => Promise<GalleryActionResult>, done?: (r: Extract<GalleryActionResult, { ok: true }>) => string | null) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(done?.(res) ?? null);
      router.refresh();
    });
  }

  const canReady = Boolean(pictimeUrl) && (status === "pending" || status === "created");
  const canDeliver = Boolean(pictimeUrl) && status !== "delivered";
  const emailHint = !clientEmail ? "No e-mail address on file. Link a client or booking with an e-mail first." : !galleryReadyPrefOn ? "“Gallery ready” e-mails are switched off under Notifications." : emailEnabled ? `The client (${clientEmail}) receives the gallery link.` : `The client (${clientEmail}) receives the gallery link as soon as e-mail is switched on for this server.`;

  return (
    <section className="card space-y-4 p-4" aria-labelledby="gallery-actions-heading">
      <h2 id="gallery-actions-heading" className="text-sm font-extrabold uppercase tracking-wider text-muted">Actions</h2>

      {canReady && (
        <div className="space-y-3 rounded-xl border border-line bg-page p-3">
          <p className="text-sm font-semibold text-ink">Mark ready</p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={notifyReady} disabled={pending || !canEmail} onChange={(e) => setNotifyReady(e.target.checked)} />
            <span className="text-sm">
              <span className="block font-semibold text-ink">Notify the client by e-mail</span>
              <span className="block text-xs text-muted">{notifyReady ? emailHint : "Nothing is sent."} The booking and the final balance are not changed by this.</span>
            </span>
          </label>
          <button type="button" className="btn-secondary min-h-11 w-full sm:w-auto" disabled={pending} aria-busy={pending} onClick={() => run(() => markGalleryReady(id, { notifyClient: notifyReady }), (r) => (r.notified ? "Marked ready. The client e-mail is queued." : r.notifyReason ?? "Marked ready. No e-mail was sent."))}>
            Mark ready
          </button>
        </div>
      )}

      {canDeliver && (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-lightblue/40 p-3">
          <p className="text-sm font-semibold text-ink">Deliver gallery</p>
          <p className="text-xs text-muted">{hasBooking ? `The booking becomes delivered${balanceQr > 0 ? ` and the final balance (${balanceQr.toLocaleString("en-QA")} QAR) becomes due. The payment link is created and sent only by you, from the booking page.` : "."}` : "No booking is linked; only the gallery is marked delivered."}</p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={notifyDeliver} disabled={pending || !canEmail} onChange={(e) => setNotifyDeliver(e.target.checked)} />
            <span className="text-sm">
              <span className="block font-semibold text-ink">Notify the client by e-mail</span>
              <span className="block text-xs text-muted">{notifyDeliver ? emailHint : "Off by default. Nothing is sent unless you tick this."}</span>
            </span>
          </label>
          <button type="button" className="btn-primary min-h-11 w-full sm:w-auto" disabled={pending} aria-busy={pending} onClick={() => run(() => deliverGallery(id, { notifyClient: notifyDeliver }), (r) => `Delivered.${r.balanceDue ? " The final balance is now due." : ""} ${r.notified ? "Client e-mailed." : r.notifyReason ?? "Client not e-mailed."}`)}>
            <SendIcon size={16} /> Deliver gallery
          </button>
        </div>
      )}
      {!pictimeUrl && status !== "delivered" && <p className="text-xs text-muted">Add the gallery link (Edit) before marking this gallery ready or delivering it.</p>}

      <div className="flex flex-wrap gap-2">
        {status === "delivered" && (
          <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => run(() => transitionGallery(id, "ready"), () => "Back to ready. The booking keeps its delivery date.")}>Reopen as ready</button>
        )}
        {status === "ready" && (
          <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => run(() => transitionGallery(id, "created"), () => "Stepped back to created.")}>Not ready yet</button>
        )}
        {pictimeUrl && (
          <a href={pictimeUrl} target="_blank" rel="noreferrer noopener" className="btn-secondary min-h-11"><ExternalIcon size={16} /> Open in Pic-Time</a>
        )}
        <Link href={`/galleries/${id}/edit`} className="btn-secondary min-h-11"><EditIcon size={16} /> Edit</Link>
        <DeleteDialog
          trigger="Delete"
          triggerClassName="min-h-11"
          title="Delete this gallery?"
          summary={<p>“{name}” is removed from the studio record and unlinked from its booking. The photos on Pic-Time are not touched.</p>}
          onConfirm={async () => {
            const res = await deleteGallery(id);
            return res.ok ? null : { error: res.error };
          }}
        />
      </div>

      <div aria-live="polite" className="min-h-5">
        {error && <p className="text-sm font-semibold text-danger" role="alert">{error}</p>}
        {notice && !error && <p className="text-sm font-semibold text-success">{notice}</p>}
      </div>
    </section>
  );
}
