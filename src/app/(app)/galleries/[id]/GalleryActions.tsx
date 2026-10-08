"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DeleteDialog } from "@/components/DeleteDialog";
import { EditIcon, ExternalIcon, SendIcon } from "@/components/icons";
import { deleteGallery, markGalleryDelivered, markGalleryReady, transitionGallery, type GalleryActionResult } from "@/lib/actions/galleries";
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
};

/**
 * Owner actions for one gallery. "Mark ready" is the only path that e-mails
 * a client, and only when the box is ticked — the effect is spelled out next
 * to it so nothing goes out by surprise.
 */
export function GalleryActions({ id, name, status, pictimeUrl, clientEmail, emailEnabled, galleryReadyPrefOn }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEmail = Boolean(clientEmail) && galleryReadyPrefOn;
  const [notify, setNotify] = useState(canEmail && emailEnabled);

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

  const canReady = Boolean(pictimeUrl) && (status === "pending" || status === "created" || status === "ready");
  const canDeliver = status === "ready" && Boolean(pictimeUrl);

  return (
    <section className="card space-y-4 p-4" aria-labelledby="gallery-actions-heading">
      <h2 id="gallery-actions-heading" className="text-sm font-extrabold uppercase tracking-wider text-muted">Actions</h2>

      {canReady && (
        <div className="space-y-3 rounded-xl border border-line bg-page p-3">
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={notify} disabled={pending || !canEmail} onChange={(e) => setNotify(e.target.checked)} />
            <span className="text-sm">
              <span className="block font-semibold text-ink">Notify the client by e-mail</span>
              <span className="block text-xs text-muted">
                {!clientEmail
                  ? "No e-mail address on file. Link a client or booking with an e-mail first."
                  : !galleryReadyPrefOn
                    ? "“Gallery ready” e-mails are switched off under Notifications."
                    : notify
                      ? `The client (${clientEmail}) receives the Pic-Time link${emailEnabled ? "" : " as soon as e-mail is switched on for this server"}. The gallery and its booking then count as delivered.`
                      : "Nothing is sent. Mark it delivered yourself once you have shared the link."}
              </span>
            </span>
          </label>
          <button type="button" className="btn-primary min-h-11 w-full sm:w-auto" disabled={pending} aria-busy={pending} onClick={() => run(() => markGalleryReady(id, { notifyClient: notify }), (r) => (r.notified ? "Marked ready. The client e-mail is queued." : r.notifyReason ?? "Marked ready. No e-mail was sent."))}>
            <SendIcon size={16} /> {status === "ready" ? (notify ? "Send the gallery e-mail" : "Already ready") : "Mark ready"}
          </button>
        </div>
      )}
      {!pictimeUrl && status !== "delivered" && <p className="text-xs text-muted">Add the Pic-Time link (Edit) before marking this gallery ready.</p>}

      <div className="flex flex-wrap gap-2">
        {canDeliver && (
          <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => markGalleryDelivered(id), () => "Marked delivered. No e-mail was sent.")}>Mark delivered (no e-mail)</button>
        )}
        {status === "delivered" && (
          <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => run(() => transitionGallery(id, "ready"), () => "Back to ready.")}>Reopen as ready</button>
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
