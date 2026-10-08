"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { ExternalIcon, LinkIcon, RefreshIcon, SendIcon } from "@/components/icons";
import { regenerateStagePayment, requestStagePayment, sendStagePaymentRequest } from "@/lib/actions/bookings";
import type { PaymentStage } from "@/lib/supabase/database.types";

export type StageRequestView = {
  id: string;
  status: "pending" | "paid" | "failed" | "cancelled" | "expired";
  provider: string;
  payUrl: string | null;
  createdAt: string;
  sentAt: string | null;
  paidAt: string | null;
  generation: number;
  /** Admin-only provider details (owner UI may name MyFatoorah). */
  providerInvoiceId: string | null;
  providerStatus: string | null;
  providerError: string | null;
};

type Props = {
  bookingId: string;
  stage: PaymentStage;
  /** The newest request for this stage, if any. */
  request: StageRequestView | null;
  /** True when a (new) link may be created right now. */
  canRequest: boolean;
  /** Why not (shown instead of the button). */
  blockerLabel: string | null;
  paymentsEnabled: boolean;
  hasEmail: boolean;
  /** Pretty timestamps are rendered on the server. */
  createdLabel: string | null;
  sentLabel: string | null;
};

/**
 * The owner's controls for one stage's payment link: Create payment link,
 * Copy, Send (explicit: nothing is ever sent on creation), Regenerate.
 * Without MyFatoorah configured the owner pastes a link from the provider
 * dashboard instead; nothing is faked.
 */
export function StageRequestPanel({ bookingId, stage, request, canRequest, blockerLabel, paymentsEnabled, hasEmail, createdLabel, sentLabel }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [pasting, setPasting] = useState(false);
  const linkId = useId();
  const active = request && request.status === "pending" ? request : null;

  function run(fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        setNotice(res.message);
        setPasting(false);
        router.refresh();
      }
    });
  }

  const create = (regenerate: boolean) =>
    run(async () => {
      const url = pasting ? manualUrl : null;
      const res = regenerate ? await regenerateStagePayment(bookingId, stage, { manualUrl: url }) : await requestStagePayment(bookingId, stage, { manualUrl: url });
      if (!res.ok) return res;
      return { ok: true, message: res.created ? (regenerate ? "New payment link created. The old link no longer works. Nothing was sent." : "Payment link created. Nothing was sent yet: use Send payment link, or copy it.") : "This stage already has a pending link; it was returned as is." };
    });

  const send = () =>
    run(async () => {
      if (!active) return { ok: false, error: "No pending link to send." };
      const res = await sendStagePaymentRequest(bookingId, active.id);
      if (!res.ok) return res;
      return { ok: true, message: res.emailQueued ? "Payment link queued for the client by e-mail." : res.reason ?? "Not e-mailed." };
    });

  return (
    <div className="space-y-3">
      {request && request.status !== "pending" && (
        <p className="text-xs text-muted">
          {request.status === "paid" ? `Paid online${request.paidAt ? ` · ${request.paidAt}` : ""}.` : request.status === "failed" ? "The last payment attempt failed." : request.status === "cancelled" ? "The previous link was cancelled." : "The previous link expired."}
          {request.generation > 1 ? ` Link ${request.generation}.` : ""}
        </p>
      )}
      {active && (
        <div className="space-y-2 rounded-xl border border-line bg-page p-3">
          <p className="text-xs text-muted">
            {active.provider === "MANUAL_LINK" ? "Pasted payment link" : "Website pay link"} · created {createdLabel ?? "just now"}
            {sentLabel ? ` · sent ${sentLabel}` : " · not sent yet"}
            {active.generation > 1 ? ` · link ${active.generation}` : ""}
          </p>
          {active.payUrl && <p className="break-all rounded-lg bg-white px-3 py-2 text-xs text-ink">{active.payUrl}</p>}
          <div className="flex flex-wrap gap-2">
            {active.payUrl && <CopyButton value={active.payUrl} label="Copy payment link" copiedLabel="Link copied" />}
            <button type="button" className="btn-primary min-h-11" disabled={pending} aria-busy={pending} onClick={send}><SendIcon size={16} /> {pending ? "Working..." : "Send payment link"}</button>
            {active.payUrl && <a href={active.payUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11"><ExternalIcon size={16} /> Open</a>}
            {canRequest && <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => create(true)}><RefreshIcon size={16} /> Regenerate</button>}
          </div>
          {!hasEmail && <p className="text-xs text-warning">No e-mail on file: Send queues nothing. Copy the link and share it yourself.</p>}
          <p className="text-xs text-muted">Provider: {active.providerStatus ? `MyFatoorah status ${active.providerStatus}` : "no checkout attempt yet"}{active.providerInvoiceId ? ` · invoice ${active.providerInvoiceId}` : ""}{active.providerError ? ` · ${active.providerError}` : ""}</p>
        </div>
      )}
      {!active && canRequest && (
        <div className="space-y-2">
          {!paymentsEnabled && (
            <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink" role="status">
              Online card payments are not configured. Paste a payment link from your payment provider dashboard, or set the keys.
            </p>
          )}
          {(pasting || !paymentsEnabled) && (
            <div>
              <label htmlFor={linkId} className="label">Payment link from the provider dashboard</label>
              <input id={linkId} className="input" type="url" inputMode="url" autoComplete="off" placeholder="https://" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} />
              <p className="hint">The client sees it as &ldquo;Payment link&rdquo;. https only.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {paymentsEnabled && !pasting && <button type="button" className="btn-primary min-h-11" disabled={pending} aria-busy={pending} onClick={() => create(false)}><LinkIcon size={16} /> {pending ? "Creating..." : "Create payment link"}</button>}
            {paymentsEnabled && !pasting && <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => setPasting(true)}>Paste a link instead</button>}
            {(pasting || !paymentsEnabled) && <button type="button" className="btn-primary min-h-11" disabled={pending || !manualUrl.trim()} aria-busy={pending} onClick={() => { setPasting(true); create(false); }}><LinkIcon size={16} /> {pending ? "Saving..." : "Save pasted link"}</button>}
            {pasting && paymentsEnabled && <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => setPasting(false)}>Cancel</button>}
          </div>
          <p className="text-xs text-muted">Creating a link never messages the client. Send it from here afterwards, or copy it.</p>
        </div>
      )}
      {!active && !canRequest && blockerLabel && <p className="text-sm text-muted">{blockerLabel}</p>}
      <p role="status" aria-live="polite" className="text-xs text-muted">{notice}</p>
      <p className="text-xs font-semibold text-danger" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
