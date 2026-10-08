import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { recomputeBookingGates } from "@/lib/bookings/gates";
import { contractStateFor, guardianOf, primaryContractDocument } from "@/lib/documents/contract-state";
import { DOCUMENT_STATUSES, DOCUMENT_TRANSITIONS } from "@/lib/documents/state";
import type { EsignEvent, EsignEventType } from "@/lib/esign/types";
import { buildEmail } from "@/lib/notifications/email/templates";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { DEFAULT_STUDIO, siteUrl } from "@/lib/studio/queries";
import type { AuditActorKind, ContractState, Database, DocumentStatus, Json, PhotoBookingRow, PhotoDocumentRow } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * ONE code path for every status change a signature provider can report:
 * the public signing page (internal provider), the owner's buttons (void,
 * refresh, mock advance) and the webhook route all call `applyProviderEvent`.
 * It moves the document, writes the audit row, re-derives the booking's
 * contract_state and lets the booking gates decide whether the booking can
 * move on (it confirms only when the deposit is also paid; nothing here
 * ever writes `confirmed`).
 */

export const EVENT_TO_STATUS: Record<EsignEventType, DocumentStatus> = { sent: "sent", viewed: "viewed", signed: "signed", declined: "declined", voided: "void", expired: "expired" };

export const EVENT_AUDIT_ACTION: Record<EsignEventType, string> = {
  sent: "contract.sent",
  viewed: "contract.viewed",
  signed: "contract.signed",
  declined: "contract.declined",
  voided: "contract.voided",
  expired: "contract.expired",
};

const MAX_REASON = 500;

export type SignerRecord = { name: string; email: string | null; phone: string | null; evidence: Record<string, Json> };

export type ApplyEventInput = {
  doc: PhotoDocumentRow;
  event: Pick<EsignEvent, "type"> & Partial<EsignEvent>;
  actor: { kind: AuditActorKind; id?: string | null };
  /** For `signed`: who signed, as recorded by the internal page or reported by the provider. */
  signer?: SignerRecord | null;
  /** For `declined` / `voided`. */
  reason?: string | null;
  /** Extra columns written with the status change (provider_status, provider_error, ...). */
  columns?: Partial<PhotoDocumentRow>;
  /** Owner Telegram + client e-mail on signed / declined. Default true. */
  notify?: boolean;
};

export type BookingSync = { bookingId: string; previous: ContractState; state: ContractState; changed: boolean; bookingStatus: PhotoBookingRow["booking_status"] | null; confirmed: boolean };

export type ApplyEventResult =
  | { ok: true; applied: true; status: DocumentStatus; booking: BookingSync | null }
  | { ok: true; applied: false; reason: "already" | "not_allowed"; status: DocumentStatus }
  | { ok: false; error: string };

/** Statuses a document may be in for `to` to be a legal next step. */
function sourcesFor(to: DocumentStatus): DocumentStatus[] {
  return DOCUMENT_STATUSES.filter((from) => DOCUMENT_TRANSITIONS[from].includes(to));
}

export async function applyProviderEvent(supabase: Client, input: ApplyEventInput, now: Date = new Date()): Promise<ApplyEventResult> {
  const { doc, event } = input;
  const to = EVENT_TO_STATUS[event.type];
  if (doc.status === to) return { ok: true, applied: false, reason: "already", status: doc.status };
  const sources = sourcesFor(to);
  if (!sources.includes(doc.status)) return { ok: true, applied: false, reason: "not_allowed", status: doc.status };

  const at = event.occurredAt && !Number.isNaN(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toISOString() : now.toISOString();
  const reason = (input.reason ?? event.reason ?? "").trim().slice(0, MAX_REASON) || null;
  const patch: Partial<PhotoDocumentRow> = { ...(input.columns ?? {}), status: to, provider_status: event.type, updated_at: now.toISOString() };
  if (event.envelopeId && !doc.provider_envelope_id) patch.provider_envelope_id = event.envelopeId;
  switch (event.type) {
    case "sent":
      patch.sent_at = at;
      break;
    case "viewed":
      patch.viewed_at = at;
      break;
    case "signed": {
      patch.signed_at = at;
      if (input.signer) {
        patch.signer_name = input.signer.name;
        patch.signer_email = input.signer.email;
        patch.signer_phone = input.signer.phone;
        patch.signature_evidence = input.signer.evidence as Json;
      } else if (event.signer?.name) {
        patch.signer_name = event.signer.name;
        patch.signer_email = event.signer.email ?? null;
        patch.signature_evidence = { method: `provider:${doc.provider}`, envelope_id: event.envelopeId ?? doc.provider_envelope_id, event_id: event.eventId ?? null, signed_at: at } as Json;
      }
      if (event.completedDocumentRef) patch.completed_document_ref = event.completedDocumentRef;
      if (event.certificateRef) patch.certificate_ref = event.certificateRef;
      break;
    }
    case "declined":
      patch.declined_at = at;
      patch.signature_evidence = { method: "declined", reason, declined_at: at, envelope_id: event.envelopeId ?? doc.provider_envelope_id ?? null } as Json;
      break;
    case "voided":
      patch.voided_at = at;
      // The link must stop working at once, whatever the provider.
      patch.expires_at = at;
      break;
    case "expired":
      if (!doc.expires_at || Date.parse(doc.expires_at) > now.getTime()) patch.expires_at = at;
      break;
  }

  // Guarded by the statuses that may legally move to `to`, so two deliveries
  // (or a tap on two devices) cannot both land.
  const { data: updated, error } = await supabase.from("photo_documents").update(patch).eq("id", doc.id).in("status", sources).select("id");
  if (error) return { ok: false, error: error.message };
  if (!(updated ?? []).length) return { ok: true, applied: false, reason: "already", status: doc.status };

  await writeAudit(supabase, {
    ownerId: doc.owner_id,
    actorId: input.actor.id ?? null,
    actorKind: input.actor.kind,
    entity: "document",
    entityId: doc.id,
    action: EVENT_AUDIT_ACTION[event.type],
    data: {
      bookingId: doc.booking_id,
      kind: doc.kind,
      signerRole: doc.signer_role,
      provider: doc.provider,
      envelopeId: event.envelopeId ?? doc.provider_envelope_id ?? null,
      eventId: event.eventId ?? null,
      signerName: input.signer?.name ?? event.signer?.name ?? null,
      reason,
    },
  });

  const booking = doc.booking_id ? await syncBookingContractState(supabase, doc.booking_id, now) : null;

  if (input.notify !== false) await notify(supabase, { ...doc, ...patch } as PhotoDocumentRow, event.type, { signerName: input.signer?.name ?? event.signer?.name ?? null, reason }, now);

  return { ok: true, applied: true, status: to, booking };
}

/**
 * Re-derives photo_bookings.contract_state from the booking's documents and
 * lets the gates move the lifecycle. Idempotent; safe to call after any
 * document change. Never touches deposit, balance or `status`.
 */
export async function syncBookingContractState(supabase: Client, bookingId: string, now: Date = new Date()): Promise<BookingSync | null> {
  const { data: booking } = await supabase.from("photo_bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!booking) return null;
  const { data: docs } = await supabase.from("photo_documents").select("id,status,signer_role,required_for_confirmation,kind,created_at").eq("booking_id", bookingId);
  const documents = docs ?? [];
  const state = contractStateFor(booking, documents);
  const primary = primaryContractDocument(documents);
  const patch: Partial<PhotoBookingRow> = {};
  if (state !== booking.contract_state) patch.contract_state = state;
  if (primary && primary.id !== booking.contract_document_id) patch.contract_document_id = primary.id;
  if (Object.keys(patch).length) {
    patch.updated_at = now.toISOString();
    await supabase.from("photo_bookings").update(patch).eq("id", bookingId);
  }
  const gates = await recomputeBookingGates(supabase, bookingId, now);
  return { bookingId, previous: booking.contract_state, state, changed: state !== booking.contract_state, bookingStatus: gates.moved ? gates.to : booking.booking_status, confirmed: gates.confirmed };
}

export type SignerContact = { name: string | null; email: string | null; phone: string | null; athleteName: string | null; guardianName: string | null };

/**
 * Who a document is addressed to. A guardian release goes to the parent or
 * guardian recorded on the booking, never to the athlete; a client document
 * goes to the CRM person, else the booking contact.
 */
export async function signerContactFor(supabase: Client, doc: Pick<PhotoDocumentRow, "booking_id" | "client_id" | "signer_role">): Promise<SignerContact> {
  let booking: Pick<PhotoBookingRow, "customer_name" | "customer_email" | "customer_phone" | "athlete_name" | "guardian"> | null = null;
  if (doc.booking_id) {
    const { data } = await supabase.from("photo_bookings").select("customer_name,customer_email,customer_phone,athlete_name,guardian").eq("id", doc.booking_id).maybeSingle();
    booking = data ?? null;
  }
  const guardian = booking ? guardianOf(booking) : null;
  const athleteName = booking?.athlete_name ?? null;
  if (doc.signer_role === "guardian") {
    return { name: guardian?.name ?? null, email: guardian?.email ?? null, phone: guardian?.phone ?? null, athleteName, guardianName: guardian?.name ?? null };
  }
  if (doc.client_id) {
    const { data } = await supabase.from("photo_people").select("full_name,email,phone").eq("id", doc.client_id).maybeSingle();
    if (data) return { name: data.full_name, email: data.email, phone: data.phone, athleteName, guardianName: guardian?.name ?? null };
  }
  return { name: booking?.customer_name ?? null, email: booking?.customer_email ?? null, phone: booking?.customer_phone ?? null, athleteName, guardianName: guardian?.name ?? null };
}

export async function studioNameOf(supabase: Client, ownerId: string): Promise<string> {
  const { data } = await supabase.from("photo_studio").select("business_name").eq("owner_id", ownerId).maybeSingle();
  return data?.business_name ?? DEFAULT_STUDIO.business_name;
}

async function notify(supabase: Client, doc: PhotoDocumentRow, type: EsignEventType, detail: { signerName: string | null; reason: string | null }, now: Date): Promise<void> {
  if (type !== "signed" && type !== "declined") return;
  const bookingRef = doc.booking_id ? await bookingLine(supabase, doc.booking_id) : null;
  if (type === "declined") {
    await enqueueOwnerTelegram(supabase, {
      ownerId: doc.owner_id,
      kind: "CONTRACT_DECLINED",
      alertKey: `document:${doc.id}:declined`,
      title: `Agreement declined: ${doc.title}`,
      lines: [detail.reason ? `Reason: ${detail.reason}` : "No reason given.", bookingRef],
      url: `${siteUrl()}/documents/${doc.id}`,
      now,
    });
    return;
  }
  const signerName = detail.signerName ?? doc.signer_name ?? "the signer";
  await enqueueOwnerTelegram(supabase, {
    ownerId: doc.owner_id,
    kind: "CONTRACT_SIGNED",
    alertKey: `document:${doc.id}:signed`,
    title: `Agreement signed: ${doc.title}`,
    lines: [`Signed by ${signerName}${doc.signer_role === "guardian" ? " (parent or guardian)" : ""}`, bookingRef],
    url: `${siteUrl()}/documents/${doc.id}`,
    now,
  });

  // The copy goes to the address on file for the signer's role; a typed address is evidence only.
  const [studioName, contact] = await Promise.all([studioNameOf(supabase, doc.owner_id), signerContactFor(supabase, doc)]);
  const to = contact.email ?? doc.signer_email;
  if (!to) return;
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now);
  const draft = buildEmail(to, {
    kind: "CONTRACT_SIGNED",
    subject: `${studioName}: your signed copy of "${doc.title}"`,
    greeting: `Hello ${signerName},`,
    paragraphs: [`Thank you. Your agreement with ${studioName} was signed on ${when} (Qatar time).`, "You can download a PDF copy from your client portal at any time; sign in with this e-mail address."],
    cta: { label: "Download your copy", url: `${siteUrl()}/client` },
    facts: [["Document", doc.title], ...(bookingRef ? [["Booking", bookingRef] as [string, string]] : [])],
    businessName: studioName,
  });
  await enqueueClientEmail(supabase, { ownerId: doc.owner_id, kind: "CONTRACT_SIGNED", alertKey: `email:document:${doc.id}:signed`, draft, personId: doc.client_id, bookingId: doc.booking_id, now });
}

async function bookingLine(supabase: Client, bookingId: string): Promise<string | null> {
  const { data } = await supabase.from("photo_bookings").select("id,public_ref,athlete_name").eq("id", bookingId).maybeSingle();
  if (!data) return null;
  return `Booking ${data.public_ref ?? data.id.slice(0, 8)} · ${data.athlete_name}`;
}
