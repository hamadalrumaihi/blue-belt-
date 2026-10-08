"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { DeleteDialog } from "@/components/DeleteDialog";
import { LinkIcon, RefreshIcon, SendIcon, WhatsAppIcon } from "@/components/icons";
import { advanceMockEnvelope, deleteDraftAndGoBack, refreshDocumentStatus, regenerateSigningLink, resendDocument, sendDocument, voidDocument, type MockAdvance } from "@/lib/actions/documents";
import type { DocumentStatus } from "@/lib/supabase/database.types";

type Props = { documentId: string; status: DocumentStatus; title: string; provider: string; esign: { provider: string; configured: boolean; mock: boolean; missing: string[] } };

type ActionResult = { ok: boolean; error?: string; signingUrl?: string | null; emailQueued?: boolean; status?: string; changed?: boolean };

/**
 * Owner actions for one document. The signing link is shown exactly once,
 * right after Send / Resend / Copy signing link: it is never stored, so
 * leaving the page means generating a new one. Void asks for a reason.
 */
export function DocumentActions({ documentId, status, title, provider, esign }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; emailQueued: boolean | null } | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");

  function run(action: () => Promise<ActionResult>, after?: (r: ActionResult) => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      after?.(res);
      router.refresh();
    });
  }

  const showLink = (r: ActionResult) => {
    if (r.signingUrl) setLink({ url: r.signingUrl, emailQueued: r.emailQueued ?? null });
    else setNotice(esign.mock ? "Test envelope created. Nothing was sent." : "Sent. The signer receives the request from the provider.");
  };
  const waiting = status === "sent" || status === "viewed";
  const internal = provider === "internal";
  const waLink = link ? `https://wa.me/?text=${encodeURIComponent(`Please review and sign "${title}": ${link.url}`)}` : null;

  return (
    <div className="mt-4 space-y-3">
      {link && (
        <div className="rounded-xl border border-success/30 bg-success-soft p-3" role="status" aria-live="polite">
          <p className="text-sm font-bold text-success">Signing link ready{link.emailQueued ? ". E-mail queued to the signer" : link.emailQueued === false ? ". No e-mail address on file, share it yourself" : ""}</p>
          <p className="mt-1 break-all font-mono text-xs text-ink">{link.url}</p>
          <p className="mt-1 text-xs text-muted">Shown once. Anyone with this link can sign, so share it only with the signer.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton value={link.url} label="Copy link" />
            {waLink && <a href={waLink} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11"><WhatsAppIcon size={16} /> Share on WhatsApp</a>}
          </div>
        </div>
      )}
      {esign.mock && <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">Test signing, not a real signature. The mock provider is on.</p>}
      {!esign.configured && status === "draft" && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">The {esign.provider} provider is not configured. Missing: {esign.missing.join(", ") || "settings"}.</p>}
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <>
            <button type="button" className="btn-primary min-h-11" disabled={pending || !esign.configured} onClick={() => run(() => sendDocument(documentId), showLink)}><SendIcon size={16} /> Send for signature</button>
            <DeleteDialog trigger="Delete draft" title="Delete this draft?" summary={<span>&ldquo;{title}&rdquo; will be removed. Nothing has been sent to the signer.</span>} onConfirm={async () => { const r = await deleteDraftAndGoBack(documentId); return r.ok ? null : { error: r.error }; }} />
          </>
        )}
        {waiting && internal && (
          <>
            <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => resendDocument(documentId), showLink)}><SendIcon size={16} /> Resend</button>
            <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => regenerateSigningLink(documentId), (r) => { if (r.signingUrl) setLink({ url: r.signingUrl, emailQueued: null }); })}><LinkIcon size={16} /> Copy signing link</button>
          </>
        )}
        {waiting && !internal && (
          <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => refreshDocumentStatus(documentId), (r) => setNotice(r.changed ? `Status updated: ${r.status}.` : "No change reported by the provider."))}><RefreshIcon size={16} /> Refresh status</button>
        )}
        {waiting && esign.mock && provider === "mock" && (["viewed", "signed", "declined"] as MockAdvance[]).filter((s) => !(s === "viewed" && status === "viewed")).map((step) => (
          <button key={step} type="button" className="btn-ghost min-h-11 border border-dashed border-warning/40 text-xs" disabled={pending} onClick={() => run(() => advanceMockEnvelope(documentId, step), () => setNotice(`Test envelope marked ${step}. Test signing, not a real signature.`))}>Test: mark {step}</button>
        ))}
        {(status === "draft" || waiting) && !voiding && (
          <button type="button" className="btn-ghost min-h-11 text-danger" disabled={pending} onClick={() => setVoiding(true)}>Void</button>
        )}
      </div>
      {voiding && (
        <div className="rounded-xl border border-line bg-page p-3">
          <label htmlFor="void-reason" className="label">Reason for voiding</label>
          <input id="void-reason" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="input min-h-11" placeholder="e.g. wrong date, re-issuing" />
          <p className="hint">The signing link stops working at once and the booking goes back to needing an agreement unless another signed one exists. Create a new document to re-issue.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-danger min-h-11" disabled={pending} onClick={() => run(() => voidDocument(documentId, reason), () => { setVoiding(false); setNotice("Document voided."); })}>Void document</button>
            <button type="button" className="btn-ghost min-h-11" onClick={() => setVoiding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {status === "draft" && <p className="text-xs text-muted">Sending creates the signing request, e-mails the signer (if they have an address) and marks the booking&apos;s agreement as sent.</p>}
      {notice && <p className="text-xs font-semibold text-success" role="status">{notice}</p>}
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
