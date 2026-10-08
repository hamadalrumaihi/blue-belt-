import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { DownloadIcon, EditIcon } from "@/components/icons";
import { BOOKING_STATUS_LABEL } from "@/lib/bookings/state";
import { shortHash } from "@/lib/documents/hash";
import { getDocument } from "@/lib/documents/queries";
import { DOCUMENT_KIND_LABEL, isDocumentKind, SIGNER_ROLE_LABEL } from "@/lib/documents/state";
import { esignStatus } from "@/lib/esign/config";
import { formatStamp } from "@/lib/time";
import { isUuid } from "@/lib/validation";
import { DocumentStatusPill } from "../DocumentStatusPill";
import { DocumentActions } from "./DocumentActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/documents/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = isUuid(id) ? await getDocument(id) : null;
  return { title: detail ? detail.doc.title : "Document" };
}

function evidenceRows(evidence: unknown): Array<[string, string]> {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const e = evidence as Record<string, unknown>;
  const rows: Array<[string, string]> = [];
  const push = (label: string, v: unknown) => {
    if (typeof v === "string" && v) rows.push([label, v]);
  };
  push("Method", e.method === "typed_name" ? "Typed name + agreement checkbox" : e.method === "mock" ? "Test signing, not a real signature" : String(e.method ?? ""));
  push("Typed name", e.typed_name);
  push("Signer role", e.signer_role === "guardian" ? "Parent or guardian" : e.signer_role === "client" ? "Client" : "");
  push("Envelope", e.envelope_id);
  push("Note", e.note);
  push("Agreed to", e.agreed_text);
  push("Network address", e.ip);
  push("Device", e.user_agent);
  push("Body hash at signing", e.body_hash);
  push("Token hash prefix", e.token_hash_prefix);
  push("Reason", e.reason);
  return rows;
}

export default async function DocumentDetailPage({ params }: PageProps<"/documents/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getDocument(id);
  if (!detail) notFound();
  const { doc, client, booking, organization, template } = detail;
  const kindLabel = isDocumentKind(doc.kind) ? DOCUMENT_KIND_LABEL[doc.kind] : doc.kind;
  const evidence = evidenceRows(doc.signature_evidence);
  const hashMatches = doc.body_hash !== null;
  const esign = esignStatus();

  return (
    <>
      <BrandHeader title={doc.title} subtitle={`${kindLabel} · signer: ${SIGNER_ROLE_LABEL[doc.signer_role]}`} backHref="/documents" actions={doc.status === "draft" ? <Link href={`/documents/${doc.id}/edit`} className="btn-secondary min-h-10 px-3 text-xs"><EditIcon size={16} /> Edit text</Link> : undefined} />
      <PageBody className="max-w-3xl space-y-4">
        <section className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Status</p>
            <DocumentStatusPill status={doc.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
            <dt>Created</dt><dd className="text-ink">{formatStamp(doc.created_at)}</dd>
            {doc.sent_at && <><dt>Sent</dt><dd className="text-ink">{formatStamp(doc.sent_at)}</dd></>}
            {doc.viewed_at && <><dt>First opened</dt><dd className="text-ink">{formatStamp(doc.viewed_at)}</dd></>}
            {doc.signed_at && <><dt>Signed</dt><dd className="text-ink">{formatStamp(doc.signed_at)}</dd></>}
            {doc.declined_at && <><dt>Declined</dt><dd className="text-ink">{formatStamp(doc.declined_at)}</dd></>}
            {doc.voided_at && <><dt>Voided</dt><dd className="text-ink">{formatStamp(doc.voided_at)}</dd></>}
            {doc.expires_at && (doc.status === "draft" || doc.status === "sent" || doc.status === "viewed" || doc.status === "expired") && <><dt>{doc.status === "draft" ? "Valid for" : doc.status === "expired" ? "Expired" : "Expires"}</dt><dd className="text-ink">{doc.status === "draft" ? `${Math.max(1, Math.round((Date.parse(doc.expires_at) - Date.parse(doc.created_at)) / 86_400_000))} days after sending` : formatStamp(doc.expires_at)}</dd></>}
            <dt>Signer</dt><dd className="text-ink">{SIGNER_ROLE_LABEL[doc.signer_role]}{doc.required_for_confirmation ? "" : " · not needed for confirmation"}</dd>
            <dt>Template</dt><dd className="text-ink">{template ? `${template.name} · v${doc.template_version ?? template.version}` : "—"}{doc.document_version ? ` (${doc.document_version})` : ""}</dd>
            <dt>Body hash</dt><dd className="font-mono text-ink">{shortHash(doc.body_hash)}</dd>
            <dt>Provider</dt><dd className="break-all text-ink">{doc.provider}{doc.provider_envelope_id ? ` · envelope ${doc.provider_envelope_id}` : ""}{doc.provider_status ? ` · ${doc.provider_status}` : ""}</dd>
            {doc.provider_error && <><dt>Provider error</dt><dd className="break-all font-semibold text-danger">{doc.provider_error}</dd></>}
            {doc.completed_document_ref && <><dt>Completed document</dt><dd className="break-all text-ink">{doc.completed_document_ref}</dd></>}
            {doc.certificate_ref && <><dt>Certificate</dt><dd className="break-all text-ink">{doc.certificate_ref}</dd></>}
          </dl>
          <DocumentActions documentId={doc.id} status={doc.status} title={doc.title} provider={doc.provider} esign={{ provider: esign.provider, configured: esign.configured, mock: esign.mock, missing: esign.missing }} />
        </section>

        <section className="card p-4">
          <p className="eyebrow">Parties</p>
          <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Client</dt>
            <dd className="min-w-0 text-ink">{client ? <Link href={`/people/${client.id}`} className="font-semibold text-primary hover:underline">{client.full_name}</Link> : booking ? `${booking.customer_name} (booking contact)` : "—"}{client?.email ? <span className="block truncate text-xs text-muted">{client.email}</span> : null}</dd>
            {organization && <><dt className="text-muted">Organisation</dt><dd className="text-ink">{organization.name}</dd></>}
            <dt className="text-muted">Booking</dt>
            <dd className="min-w-0 text-ink">{booking ? <Link href={`/bookings/${booking.id}`} className="font-semibold text-primary hover:underline">{booking.public_ref ?? booking.id.slice(0, 8)} · {booking.athlete_name}</Link> : "—"}{booking ? <span className="block text-xs text-muted">{BOOKING_STATUS_LABEL[booking.booking_status]}</span> : null}</dd>
            {doc.signer_name && <><dt className="text-muted">Signed by</dt><dd className="text-ink">{doc.signer_name}{doc.signer_email ? <span className="block truncate text-xs text-muted">{doc.signer_email}</span> : null}{doc.signer_phone ? <span className="block text-xs text-muted">{doc.signer_phone}</span> : null}</dd></>}
          </dl>
        </section>

        {(doc.status === "signed" || doc.status === "declined" || doc.status === "void") && evidence.length > 0 && (
          <section className="card p-4">
            <p className="eyebrow">{doc.status === "signed" ? "Signature evidence" : doc.status === "void" ? "Void details" : "Decline details"}</p>
            <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1 text-xs">
              {evidence.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-all text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {doc.status === "signed" && <p className="mt-2 text-xs text-muted">{hashMatches ? "The stored body hash is embedded in the evidence and printed on the PDF footer, so the signed text can be verified." : "No body hash was stored for this document."}</p>}
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="eyebrow">Document text</p>
            <a href={`/api/documents/${doc.id}/pdf`} className="btn-secondary min-h-10 px-3 text-xs"><DownloadIcon size={16} /> Download PDF</a>
          </div>
          <article className="max-h-[70vh] overflow-y-auto px-4 py-4">
            <pre className="max-w-prose whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink">{doc.body}</pre>
          </article>
        </section>
      </PageBody>
    </>
  );
}
