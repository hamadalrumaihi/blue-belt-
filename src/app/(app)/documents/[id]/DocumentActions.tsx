"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { DeleteDialog } from "@/components/DeleteDialog";
import { LinkIcon, SendIcon, WhatsAppIcon } from "@/components/icons";
import { deleteDraftAndGoBack, regenerateSigningLink, sendDocument, voidDocument } from "@/lib/actions/documents";
import type { DocumentStatus } from "@/lib/supabase/database.types";

type Props = { documentId: string; status: DocumentStatus; title: string };

/**
 * Owner actions for one document. The signing link is shown exactly once,
 * right after Send / Regenerate: it is never stored, so leaving the page
 * means generating a new one.
 */
export function DocumentActions({ documentId, status, title }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; emailQueued: boolean | null } | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string; signingUrl?: string; emailQueued?: boolean }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      if (res.signingUrl) setLink({ url: res.signingUrl, emailQueued: res.emailQueued ?? null });
      router.refresh();
    });
  }

  const waLink = link ? `https://wa.me/?text=${encodeURIComponent(`Please review and sign "${title}": ${link.url}`)}` : null;

  return (
    <div className="mt-4 space-y-3">
      {link && (
        <div className="rounded-xl border border-success/30 bg-success-soft p-3" role="status" aria-live="polite">
          <p className="text-sm font-bold text-success">Signing link ready{link.emailQueued ? " — e-mail queued to the client" : link.emailQueued === false ? " — no e-mail address on file, share it yourself" : ""}</p>
          <p className="mt-1 break-all font-mono text-xs text-ink">{link.url}</p>
          <p className="mt-1 text-xs text-muted">Shown once. Anyone with this link can sign as the client, so share it only with them.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton value={link.url} label="Copy link" />
            {waLink && <a href={waLink} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11"><WhatsAppIcon size={16} /> Share on WhatsApp</a>}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <>
            <button type="button" className="btn-primary min-h-11" disabled={pending} onClick={() => run(() => sendDocument(documentId))}><SendIcon size={16} /> Send for signature</button>
            <DeleteDialog trigger="Delete draft" title="Delete this draft?" summary={<span>“{title}” will be removed. Nothing has been sent to the client.</span>} onConfirm={async () => { const r = await deleteDraftAndGoBack(documentId); return r.ok ? null : { error: r.error }; }} />
          </>
        )}
        {(status === "sent" || status === "viewed") && (
          <>
            <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => regenerateSigningLink(documentId))}><LinkIcon size={16} /> New signing link</button>
            <button type="button" className="btn-ghost min-h-11 text-danger" disabled={pending} onClick={() => { if (confirm("Void this document? The signing link stops working and you will need to create a new document.")) run(() => voidDocument(documentId)); }}>Void</button>
          </>
        )}
      </div>
      {status === "draft" && <p className="text-xs text-muted">Sending creates the link, e-mails the client (if they have an address) and moves the booking to “Awaiting contract”.</p>}
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
