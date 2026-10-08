"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { AlertIcon, DownloadIcon, FileTextIcon, LinkIcon, RefreshIcon, SendIcon, WhatsAppIcon } from "@/components/icons";
import { advanceMockEnvelope, prepareBookingContracts, refreshDocumentStatus, regenerateSigningLink, resendDocument, sendDocument, voidDocument, type MockAdvance } from "@/lib/actions/documents";
import { confirmationBlockers, type GateBooking } from "@/lib/bookings/gates";
import { BOOKING_TYPE_LABEL } from "@/lib/bookings/state";
import { agreementKindForBookingType } from "@/lib/documents/contract-state";
import { DOCUMENT_KIND_LABEL, isDocumentKind, SIGNER_ROLE_LABEL } from "@/lib/documents/state";
import { DocumentStatusPill } from "./DocumentStatusPill";
import type { BookingType, ContractState, DocumentStatus, SignerRole } from "@/lib/supabase/database.types";
import { formatStamp } from "@/lib/time";

export type ContractPanelDocument = {
  id: string;
  kind: string;
  title: string;
  status: DocumentStatus;
  signer_role: SignerRole;
  signer_name: string | null;
  required_for_confirmation: boolean;
  provider: string;
  provider_envelope_id: string | null;
  provider_status: string | null;
  provider_error: string | null;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  voided_at: string | null;
  expires_at: string | null;
};

export type ContractPanelBooking = GateBooking & { id: string; booking_type: BookingType; athlete_name: string; contract_state: ContractState; guardianName: string | null };

export type ContractPanelEsign = { provider: string; configured: boolean; mock: boolean; missing: string[]; notes: string[] };

const CONTRACT_STATE_LABEL: Record<ContractState, string> = {
  not_required: "No agreement needed",
  required: "Agreement required",
  sent: "Waiting for signature",
  signed: "All required documents signed",
  declined: "Declined by the signer",
  void: "Voided",
};

type ActionResult = { ok: boolean; error?: string; signingUrl?: string | null; emailQueued?: boolean; created?: Array<{ id: string }>; skipped?: string[]; warnings?: string[]; status?: string; changed?: boolean };

export function ContractPanelClient({ booking, documents, esign }: { booking: ContractPanelBooking; documents: ContractPanelDocument[]; esign: ContractPanelEsign }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<{ docId: string; url: string; emailQueued: boolean | null } | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

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

  const blockers = confirmationBlockers(booking);
  const contractBlocked = blockers.some((b) => b.code === "contract_unsigned" || b.code === "guardian_release_unsigned");
  const minor = Boolean(booking.subject_is_minor || booking.requires_guardian_release);
  const cancelled = booking.booking_status === "cancelled";
  const live = documents.filter((d) => d.status !== "void" && d.status !== "expired");
  const hasClient = live.some((d) => d.signer_role === "client" && d.required_for_confirmation);
  const hasGuardian = live.some((d) => d.signer_role === "guardian" && d.required_for_confirmation);
  const canPrepare = !cancelled && booking.requires_contract && (!hasClient || (minor && !hasGuardian));
  const expectedKind = agreementKindForBookingType(booking.booking_type);

  return (
    <div className="card p-4 sm:p-5" data-contract-state={booking.contract_state}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">Agreement</p>
          <p className="mt-0.5 text-sm text-muted">{CONTRACT_STATE_LABEL[booking.contract_state]}</p>
        </div>
        {canPrepare && (
          <button type="button" className="btn-primary min-h-11" disabled={pending} onClick={() => run(() => prepareBookingContracts(booking.id), (r) => setNotice(summaryOfPrepare(r)))}>
            <FileTextIcon size={16} /> Prepare contracts
          </button>
        )}
      </div>

      {contractBlocked && !cancelled && (
        <ul className="mt-3 space-y-1 text-xs text-muted" aria-label="Confirmation blockers">
          {blockers.filter((b) => b.code === "contract_unsigned" || b.code === "guardian_release_unsigned").map((b) => (
            <li key={b.code} className="flex items-start gap-2"><AlertIcon size={14} className="mt-0.5 shrink-0 text-warning" /><span>{b.message}</span></li>
          ))}
        </ul>
      )}

      {documents.length === 0 && (
        <p className="mt-3 text-xs text-muted">
          {booking.requires_contract ? `Prepare contracts creates a ${DOCUMENT_KIND_LABEL[expectedKind]} for this ${BOOKING_TYPE_LABEL[booking.booking_type].toLowerCase()}${minor ? ` and a ${DOCUMENT_KIND_LABEL.guardian_release} for ${booking.guardianName ?? "the parent or guardian"}` : ""}.` : "This booking does not need a signed agreement."}
        </p>
      )}
      {minor && !booking.guardianName && booking.requires_contract && <p className="mt-2 text-xs font-semibold text-warning">No parent or guardian is recorded on this booking. Add their name and e-mail before sending the guardian release.</p>}

      {esign.mock && <p className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">Test signing, not a real signature. The mock provider is on: nothing is sent to anyone and the buttons below advance envelopes by hand.</p>}
      {!esign.configured && <p className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">The {esign.provider} provider is not configured. Missing: {esign.missing.join(", ") || "settings"}. Documents cannot be sent until it is.</p>}

      {link && (
        <div className="mt-3 rounded-xl border border-success/30 bg-success-soft p-3" role="status" aria-live="polite">
          <p className="text-sm font-bold text-success">Signing link ready{link.emailQueued ? ". E-mail queued to the signer" : link.emailQueued === false ? ". No e-mail address on file, share it yourself" : ""}</p>
          <p className="mt-1 break-all font-mono text-xs text-ink">{link.url}</p>
          <p className="mt-1 text-xs text-muted">Shown once. Anyone with this link can sign, so share it only with the signer.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton value={link.url} label="Copy link" />
            <a href={`https://wa.me/?text=${encodeURIComponent(`Please review and sign your agreement: ${link.url}`)}`} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11"><WhatsAppIcon size={16} /> Share on WhatsApp</a>
          </div>
        </div>
      )}
      {notice && <p className="mt-3 text-xs font-semibold text-success" role="status">{notice}</p>}
      {error && <p className="mt-3 text-xs font-semibold text-danger" role="alert">{error}</p>}

      {documents.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {documents.map((d) => {
            const waiting = d.status === "sent" || d.status === "viewed";
            const internal = d.provider === "internal";
            return (
              <li key={d.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/documents/${d.id}`} className="block truncate text-sm font-bold text-primary hover:underline">{d.title}</Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {isDocumentKind(d.kind) ? DOCUMENT_KIND_LABEL[d.kind] : d.kind} · signer: {SIGNER_ROLE_LABEL[d.signer_role]}{d.signer_role === "guardian" && booking.guardianName ? ` (${booking.guardianName})` : ""}{d.signer_name ? ` · signed by ${d.signer_name}` : ""}{d.required_for_confirmation ? "" : " · not needed for confirmation"}
                    </p>
                  </div>
                  <DocumentStatusPill status={d.status} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted sm:grid-cols-3">
                  <Stamp label="Created" at={d.created_at} />
                  <Stamp label="Sent" at={d.sent_at} />
                  <Stamp label="Viewed" at={d.viewed_at} />
                  <Stamp label="Signed" at={d.signed_at} />
                  <Stamp label="Declined" at={d.declined_at} />
                  <Stamp label="Voided" at={d.voided_at} />
                  {waiting && <Stamp label="Expires" at={d.expires_at} />}
                </dl>
                <p className="mt-1 break-all text-[11px] text-muted">
                  Provider: {d.provider}{d.provider_envelope_id ? ` · envelope ${d.provider_envelope_id}` : ""}{d.provider_status ? ` · ${d.provider_status}` : ""}
                </p>
                {d.provider_error && <p className="mt-1 text-[11px] font-semibold text-danger">Provider error: {d.provider_error}</p>}

                {!cancelled && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {d.status === "draft" && (
                      <button type="button" className="btn-primary min-h-11" disabled={pending || !esign.configured} onClick={() => run(() => sendDocument(d.id), (r) => { if (r.signingUrl) setLink({ docId: d.id, url: r.signingUrl, emailQueued: r.emailQueued ?? null }); else setNotice(esign.mock ? "Test envelope created. Nothing was sent." : "Sent. The signer receives the request from the provider."); })}>
                        <SendIcon size={16} /> Send
                      </button>
                    )}
                    {waiting && internal && (
                      <>
                        <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => resendDocument(d.id), (r) => { if (r.signingUrl) setLink({ docId: d.id, url: r.signingUrl, emailQueued: r.emailQueued ?? null }); })}>
                          <SendIcon size={16} /> Resend
                        </button>
                        <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => regenerateSigningLink(d.id), (r) => { if (r.signingUrl) setLink({ docId: d.id, url: r.signingUrl, emailQueued: null }); })}>
                          <LinkIcon size={16} /> Copy signing link
                        </button>
                      </>
                    )}
                    {waiting && !internal && (
                      <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => run(() => refreshDocumentStatus(d.id), (r) => setNotice(r.changed ? `Status updated: ${r.status}.` : "No change reported by the provider."))}>
                        <RefreshIcon size={16} /> Refresh status
                      </button>
                    )}
                    {waiting && esign.mock && d.provider === "mock" && (
                      <>
                        {(["viewed", "signed", "declined"] as MockAdvance[]).filter((step) => !(step === "viewed" && d.status === "viewed")).map((step) => (
                          <button key={step} type="button" className="btn-ghost min-h-11 border border-dashed border-warning/40 text-xs" disabled={pending} onClick={() => run(() => advanceMockEnvelope(d.id, step), () => setNotice(`Test envelope marked ${step}. Test signing, not a real signature.`))}>
                            Test: mark {step}
                          </button>
                        ))}
                      </>
                    )}
                    {(d.status === "draft" || waiting) && voiding !== d.id && (
                      <button type="button" className="btn-ghost min-h-11 text-danger" disabled={pending} onClick={() => { setVoiding(d.id); setVoidReason(""); }}>Void</button>
                    )}
                    {d.status === "signed" && <a href={`/api/documents/${d.id}/pdf`} className="btn-secondary min-h-11"><DownloadIcon size={16} /> Signed PDF</a>}
                  </div>
                )}
                {voiding === d.id && (
                  <div className="mt-2 rounded-xl border border-line bg-page p-3">
                    <label htmlFor={`void-${d.id}`} className="label">Reason for voiding</label>
                    <input id={`void-${d.id}`} type="text" maxLength={500} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="input min-h-11" placeholder="e.g. wrong date, re-issuing" />
                    <p className="hint">The signing link stops working at once. Create a new document to re-issue.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-danger min-h-11" disabled={pending} onClick={() => run(() => voidDocument(d.id, voidReason), () => { setVoiding(null); setNotice("Document voided."); })}>Void document</button>
                      <button type="button" className="btn-ghost min-h-11" onClick={() => setVoiding(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!cancelled && (
        <p className="mt-3 text-xs text-muted">
          Need a different document? <Link href={`/documents/new?booking=${booking.id}`} className="font-semibold text-primary hover:underline">Create one from a template</Link>.
        </p>
      )}
    </div>
  );
}

function Stamp({ label, at }: { label: string; at: string | null }) {
  if (!at) return null;
  return (
    <div className="contents">
      <dt className="sr-only">{label}</dt>
      <dd><span className="font-semibold text-ink">{label}</span> {formatStamp(at)}</dd>
    </div>
  );
}

function summaryOfPrepare(r: ActionResult): string {
  const parts: string[] = [];
  if (r.created?.length) parts.push(`${r.created.length} draft${r.created.length === 1 ? "" : "s"} created. Review the text, then press Send.`);
  if (r.skipped?.length) parts.push(`Already prepared for: ${r.skipped.join(", ")}.`);
  if (r.warnings?.length) parts.push(r.warnings.join(" "));
  return parts.join(" ") || "Nothing to prepare.";
}
