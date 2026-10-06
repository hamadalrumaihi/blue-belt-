import type { Metadata } from "next";
import { headers } from "next/headers";
import { ShieldIcon } from "@/components/icons";
import { DOCUMENT_KIND_LABEL, isDocumentKind } from "@/lib/documents/state";
import { loadSigningDocument } from "@/lib/documents/sign-service";
import { isSigningTokenShape } from "@/lib/documents/tokens";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { formatDateTime } from "@/lib/time";
import { SignForm } from "./SignForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review and sign", robots: { index: false, follow: false } };

/**
 * The page a client opens from the e-mail / WhatsApp link. No account
 * needed: the token in the URL is the credential. Reads the whole agreement
 * on one scrollable page, then signs by typing a name. Rate limited per
 * address so a leaked link cannot be brute-forced or hammered.
 */
export default async function SignPage({ params }: PageProps<"/sign/[token]">) {
  const { token } = await params;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const limit = rateLimit(`sign:${ip}`, RULES.signPerIp);
  if (!limit.ok) return <Notice title="Too many requests" text={`Please wait ${Math.ceil(limit.retryAfterSeconds / 60)} minutes and open the link again.`} />;
  if (!isSigningTokenShape(token)) return <Notice title="This link is not valid" text="Check that the whole link was copied, or ask the studio to send it again." />;

  const view = await loadSigningDocument(token);
  if (!view.ok) return <Notice title="This link is not valid" text="It may have been replaced by a newer link. Ask the studio to send the agreement again." />;
  const { doc, studioName, notice } = view;
  const kindLabel = isDocumentKind(doc.kind) ? DOCUMENT_KIND_LABEL[doc.kind] : "Agreement";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="eyebrow">{studioName}</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{doc.title}</h1>
        <p className="mt-1 text-sm text-muted">{kindLabel}{doc.sent_at ? ` · sent ${formatDateTime(doc.sent_at)} Qatar time` : ""}</p>
      </header>

      {notice === "already_signed" && (
        <div className="mb-6 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-ink" role="status">
          <p className="font-bold text-success">Signed</p>
          <p className="mt-1">This agreement was signed{doc.signer_name ? ` by ${doc.signer_name}` : ""}{doc.signed_at ? ` on ${formatDateTime(doc.signed_at)} Qatar time` : ""}. Nothing more to do.</p>
          <a href={`/api/documents/${doc.id}/pdf?token=${encodeURIComponent(token)}`} className="btn-secondary mt-3 min-h-11">Download PDF copy</a>
        </div>
      )}
      {notice === "declined" && (
        <div className="mb-6 rounded-2xl border border-line bg-page p-4 text-sm text-ink" role="status">
          <p className="font-bold">Declined</p>
          <p className="mt-1">You declined this agreement{doc.declined_at ? ` on ${formatDateTime(doc.declined_at)} Qatar time` : ""}. If that was a mistake, contact the studio and they can send a new one.</p>
        </div>
      )}
      {notice === "expired" && (
        <div className="mb-6 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-ink" role="status">
          <p className="font-bold text-warning">This link has expired</p>
          <p className="mt-1">Ask {studioName} to send a fresh signing link. The text below is shown for reference only.</p>
        </div>
      )}

      <section aria-labelledby="agreement-heading" className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line bg-page px-4 py-3 text-xs font-semibold text-muted">
          <ShieldIcon size={16} />
          <span id="agreement-heading">Read the whole agreement, then sign below.</span>
        </div>
        <article className="max-h-[60vh] overflow-y-auto px-4 py-5 sm:px-6" style={{ overscrollBehavior: "contain" }}>
          <pre className="max-w-prose whitespace-pre-wrap break-words font-sans text-base leading-7 text-ink">{doc.body}</pre>
        </article>
      </section>

      {notice === null && <SignForm token={token} studioName={studioName} prefill={doc.prefill} documentId={doc.id} />}

      <p className="mt-8 text-center text-xs text-muted">Questions about this agreement? Contact {studioName} before signing.</p>
    </main>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-extrabold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
    </main>
  );
}
