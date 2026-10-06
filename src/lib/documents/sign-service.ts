import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { bookingTransitionColumns, canTransitionBooking, effectivePayment } from "@/lib/bookings/state";
import { bodyHash } from "@/lib/documents/hash";
import { isAcceptableSignerName, isSignable } from "@/lib/documents/state";
import { hashSigningToken, isSigningTokenShape } from "@/lib/documents/tokens";
import { buildEmail } from "@/lib/notifications/email/templates";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { DEFAULT_STUDIO, siteUrl } from "@/lib/studio/queries";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { Database, Json, PhotoBookingRow, PhotoDocumentRow } from "@/lib/supabase/database.types";
import { isValidEmail } from "@/lib/utils";

type Client = SupabaseClient<Database>;

/**
 * The public signing flow. There is no session on /sign/<token>: the token
 * is the credential, so every function here runs with the service client
 * and looks the document up by the token's hash. Nothing is written that the
 * token holder could not already see, and a signed document is immutable:
 * the update is guarded by status so two taps (or two devices) cannot both
 * sign, and the body hash is re-checked right before the signature lands.
 *
 * Evidence stored with the signature (signature_evidence): the typed name,
 * the exact agreement sentence, the client's network address and user agent
 * (kept in full, as evidence of who signed — see the privacy page), the body
 * hash and a prefix of the token hash that was used.
 */

export type SigningDeps = { supabase?: Client; now?: Date };

export const AGREED_TEXT = "I have read this agreement and I agree to sign it electronically.";
const MAX_USER_AGENT = 300;
const MAX_REASON = 500;

export type SigningNotice = "expired" | "already_signed" | "declined";

export type SafeSigningDocument = Pick<PhotoDocumentRow, "id" | "title" | "kind" | "body" | "status" | "signer_name" | "signed_at" | "declined_at" | "expires_at" | "sent_at"> & {
  prefill: { name: string | null; email: string | null; phone: string | null };
};

export type SigningView = { ok: true; doc: SafeSigningDocument; studioName: string; notice: SigningNotice | null } | { ok: false; error: "not_found" };

function clientOf(deps: SigningDeps): Client | null {
  if (deps.supabase) return deps.supabase;
  return isServiceClientConfigured() ? createServiceClient() : null;
}

async function findByToken(supabase: Client, token: string): Promise<PhotoDocumentRow | null> {
  if (!isSigningTokenShape(token)) return null;
  const { data } = await supabase.from("photo_documents").select("*").eq("access_token_hash", hashSigningToken(token)).maybeSingle();
  return data ?? null;
}

async function studioNameOf(supabase: Client, ownerId: string): Promise<string> {
  const { data } = await supabase.from("photo_studio").select("business_name").eq("owner_id", ownerId).maybeSingle();
  return data?.business_name ?? DEFAULT_STUDIO.business_name;
}

async function prefillOf(supabase: Client, doc: PhotoDocumentRow): Promise<SafeSigningDocument["prefill"]> {
  if (doc.client_id) {
    const { data } = await supabase.from("photo_people").select("full_name,email,phone").eq("id", doc.client_id).maybeSingle();
    if (data) return { name: data.full_name, email: data.email, phone: data.phone };
  }
  if (doc.booking_id) {
    const { data } = await supabase.from("photo_bookings").select("customer_name,customer_email,customer_phone").eq("id", doc.booking_id).maybeSingle();
    if (data) return { name: data.customer_name, email: data.customer_email, phone: data.customer_phone };
  }
  return { name: null, email: null, phone: null };
}

function safe(doc: PhotoDocumentRow, prefill: SafeSigningDocument["prefill"]): SafeSigningDocument {
  return { id: doc.id, title: doc.title, kind: doc.kind, body: doc.body, status: doc.status, signer_name: doc.signer_name, signed_at: doc.signed_at, declined_at: doc.declined_at, expires_at: doc.expires_at, sent_at: doc.sent_at, prefill };
}

/**
 * The document behind a signing link. The first open of a sent document
 * marks it viewed (once); a document past its expiry is marked expired on
 * the way out so the studio list agrees with what the client saw.
 */
export async function loadSigningDocument(token: string, deps: SigningDeps = {}): Promise<SigningView> {
  const supabase = clientOf(deps);
  if (!supabase) return { ok: false, error: "not_found" };
  const now = deps.now ?? new Date();
  const doc = await findByToken(supabase, token);
  if (!doc || doc.status === "draft") return { ok: false, error: "not_found" };

  let notice: SigningNotice | null = null;
  if (doc.status === "signed") notice = "already_signed";
  else if (doc.status === "declined") notice = "declined";
  else if (doc.status === "expired" || !isSignable(doc, now)) {
    notice = "expired";
    if (doc.status !== "expired") {
      await supabase.from("photo_documents").update({ status: "expired", updated_at: now.toISOString() }).eq("id", doc.id).in("status", ["sent", "viewed"]);
      doc.status = "expired";
    }
  } else if (doc.status === "sent") {
    const { data } = await supabase.from("photo_documents").update({ status: "viewed", viewed_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", doc.id).eq("status", "sent").select("id");
    if ((data ?? []).length) {
      doc.status = "viewed";
      doc.viewed_at = now.toISOString();
      await writeAudit(supabase, { ownerId: doc.owner_id, actorKind: "client", entity: "document", entityId: doc.id, action: "document.viewed" });
    }
  }
  const [studioName, prefill] = await Promise.all([studioNameOf(supabase, doc.owner_id), prefillOf(supabase, doc)]);
  return { ok: true, doc: safe(doc, prefill), studioName, notice };
}

export type SignInput = { signerName: string; signerEmail?: string | null; signerPhone?: string | null; agreed: boolean; ip: string | null; userAgent: string | null; now?: Date };

export type SignError = "not_found" | "expired" | "already_signed" | "declined" | "invalid_name" | "invalid_email" | "not_agreed" | "hash_mismatch" | "conflict";

export type SignResult = { ok: true; documentId: string; signedAt: string } | { ok: false; error: SignError };

function bookingTargetAfterSignature(booking: PhotoBookingRow): "awaiting_payment" | "confirmed" {
  const amount = Number(booking.amount_qr) || 0;
  return amount > 0 && effectivePayment(booking).state !== "paid" ? "awaiting_payment" : "confirmed";
}

/**
 * Records a typed-name signature. Atomic against double submission: the
 * update only matches while the row is still sent/viewed. After the row is
 * signed: audit (actor 'client'), owner Telegram, client copy e-mail, and
 * the booking moves on from awaiting_contract (to payment when money is
 * still due, otherwise confirmed). Never touches photo_athletes.
 */
export async function signDocument(token: string, input: SignInput, deps: SigningDeps = {}): Promise<SignResult> {
  const supabase = clientOf(deps);
  if (!supabase) return { ok: false, error: "not_found" };
  const now = input.now ?? deps.now ?? new Date();
  const signerName = input.signerName.trim();
  if (!isAcceptableSignerName(signerName)) return { ok: false, error: "invalid_name" };
  const signerEmail = input.signerEmail?.trim().toLowerCase() || null;
  if (signerEmail && !isValidEmail(signerEmail)) return { ok: false, error: "invalid_email" };
  const signerPhone = input.signerPhone?.trim().slice(0, 40) || null;
  if (input.agreed !== true) return { ok: false, error: "not_agreed" };

  const doc = await findByToken(supabase, token);
  if (!doc || doc.status === "draft") return { ok: false, error: "not_found" };
  if (doc.status === "signed") return { ok: false, error: "already_signed" };
  if (doc.status === "declined") return { ok: false, error: "declined" };
  if (!isSignable(doc, now)) return { ok: false, error: "expired" };
  const currentHash = bodyHash(doc.body);
  if (!doc.body_hash || doc.body_hash !== currentHash) return { ok: false, error: "hash_mismatch" };

  const signedAt = now.toISOString();
  const evidence: Record<string, Json> = {
    method: "typed_name",
    typed_name: signerName,
    agreed_text: AGREED_TEXT,
    ip: input.ip ?? null,
    user_agent: (input.userAgent ?? "").slice(0, MAX_USER_AGENT) || null,
    body_hash: currentHash,
    token_hash_prefix: hashSigningToken(token).slice(0, 8),
    signed_at: signedAt,
  };
  const { data: updated, error } = await supabase
    .from("photo_documents")
    .update({ status: "signed", signed_at: signedAt, signer_name: signerName, signer_email: signerEmail, signer_phone: signerPhone, signature_evidence: evidence, updated_at: signedAt })
    .eq("id", doc.id)
    .in("status", ["sent", "viewed"])
    .select("id");
  if (error) return { ok: false, error: "conflict" };
  if (!(updated ?? []).length) return { ok: false, error: "already_signed" };

  await writeAudit(supabase, { ownerId: doc.owner_id, actorKind: "client", entity: "document", entityId: doc.id, action: "document.signed", data: { signerName, bookingId: doc.booking_id } });

  // Booking lifecycle: the contract step is done.
  let booking: PhotoBookingRow | null = null;
  if (doc.booking_id) {
    const { data } = await supabase.from("photo_bookings").select("*").eq("id", doc.booking_id).maybeSingle();
    booking = data ?? null;
    if (booking && booking.booking_status === "awaiting_contract") {
      const target = bookingTargetAfterSignature(booking);
      if (canTransitionBooking(booking.booking_status, target)) {
        await supabase.from("photo_bookings").update({ ...bookingTransitionColumns(booking, target, now), contract_document_id: doc.id }).eq("id", booking.id).eq("booking_status", "awaiting_contract");
      }
    }
  }

  const studioName = await studioNameOf(supabase, doc.owner_id);
  await enqueueOwnerTelegram(supabase, {
    ownerId: doc.owner_id,
    kind: "CONTRACT_SIGNED",
    alertKey: `document:${doc.id}:signed`,
    title: `Agreement signed: ${doc.title}`,
    lines: [`Signed by ${signerName}`, booking ? `Booking ${booking.public_ref ?? booking.id.slice(0, 8)} · ${booking.athlete_name}` : null],
    url: `${siteUrl()}/documents/${doc.id}`,
    now,
  });

  const to = signerEmail ?? (await prefillOf(supabase, doc)).email;
  if (to) {
    const draft = buildEmail(to, {
      kind: "CONTRACT_SIGNED",
      subject: `${studioName}: your signed copy of "${doc.title}"`,
      greeting: `Hello ${signerName},`,
      paragraphs: [`Thank you — your agreement with ${studioName} was signed on ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now)} (Qatar time).`, "You can download a PDF copy from your client portal at any time; sign in with this e-mail address."],
      cta: { label: "Download your copy", url: `${siteUrl()}/client` },
      facts: [["Document", doc.title], ...(booking?.public_ref ? [["Booking", booking.public_ref] as [string, string]] : [])],
      businessName: studioName,
    });
    await enqueueClientEmail(supabase, { ownerId: doc.owner_id, kind: "CONTRACT_SIGNED", alertKey: `email:document:${doc.id}:signed`, draft, personId: doc.client_id, bookingId: doc.booking_id, now });
  }
  return { ok: true, documentId: doc.id, signedAt };
}

export type DeclineResult = { ok: true; documentId: string } | { ok: false; error: "not_found" | "expired" | "already_signed" | "declined" | "conflict" };

/** The client says no: the document is closed (declined) and the owner is told why. */
export async function declineDocument(token: string, reason: string | null | undefined, deps: SigningDeps = {}): Promise<DeclineResult> {
  const supabase = clientOf(deps);
  if (!supabase) return { ok: false, error: "not_found" };
  const now = deps.now ?? new Date();
  const doc = await findByToken(supabase, token);
  if (!doc || doc.status === "draft") return { ok: false, error: "not_found" };
  if (doc.status === "signed") return { ok: false, error: "already_signed" };
  if (doc.status === "declined") return { ok: false, error: "declined" };
  if (!isSignable(doc, now)) return { ok: false, error: "expired" };
  const text = (reason ?? "").trim().slice(0, MAX_REASON) || null;
  const { data: updated, error } = await supabase
    .from("photo_documents")
    .update({ status: "declined", declined_at: now.toISOString(), signature_evidence: { method: "declined", reason: text, declined_at: now.toISOString() }, updated_at: now.toISOString() })
    .eq("id", doc.id)
    .in("status", ["sent", "viewed"])
    .select("id");
  if (error) return { ok: false, error: "conflict" };
  if (!(updated ?? []).length) return { ok: false, error: "already_signed" };
  await writeAudit(supabase, { ownerId: doc.owner_id, actorKind: "client", entity: "document", entityId: doc.id, action: "document.declined", data: { reason: text } });
  await enqueueOwnerTelegram(supabase, {
    ownerId: doc.owner_id,
    kind: "CONTRACT_DECLINED",
    alertKey: `document:${doc.id}:declined`,
    title: `Agreement declined: ${doc.title}`,
    lines: [text ? `Reason: ${text}` : "No reason given."],
    url: `${siteUrl()}/documents/${doc.id}`,
    now,
  });
  return { ok: true, documentId: doc.id };
}
