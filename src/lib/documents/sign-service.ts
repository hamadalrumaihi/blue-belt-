import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkSignerForRole } from "@/lib/documents/contract-state";
import { applyProviderEvent, signerContactFor, studioNameOf } from "@/lib/documents/events";
import { bodyHash } from "@/lib/documents/hash";
import { isAcceptableSignerName, isSignable } from "@/lib/documents/state";
import { hashSigningToken, isSigningTokenShape } from "@/lib/documents/tokens";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { Database, Json, PhotoDocumentRow, SignerRole } from "@/lib/supabase/database.types";
import { isValidEmail } from "@/lib/utils";

type Client = SupabaseClient<Database>;

/**
 * The public signing flow (the `internal` e-signature provider). There is
 * no session on /sign/<token>: the token is the credential, so every
 * function here runs with the service client and looks the document up by
 * the token's hash. Nothing is written that the token holder could not
 * already see, and a signed document is immutable: the update is guarded by
 * status so two taps (or two devices) cannot both sign, and the body hash
 * is re-checked right before the signature lands.
 *
 * Evidence stored with the signature (signature_evidence): the typed name,
 * the exact agreement sentence, the client's network address and user agent
 * (kept in full, as evidence of who signed; see the privacy page), the body
 * hash and a prefix of the token hash that was used.
 *
 * Every status change goes through `applyProviderEvent`, the same path a
 * provider webhook takes, so the booking's contract_state and gates are
 * updated identically. The booking is never confirmed from here: the gates
 * confirm it only when the deposit is also paid.
 */

export type SigningDeps = { supabase?: Client; now?: Date };

export const AGREED_TEXT = "I have read this agreement and I agree to sign it electronically.";
const MAX_USER_AGENT = 300;

export type SigningNotice = "expired" | "already_signed" | "declined" | "voided";

export type SafeSigningDocument = Pick<PhotoDocumentRow, "id" | "title" | "kind" | "body" | "status" | "signer_name" | "signed_at" | "declined_at" | "expires_at" | "sent_at"> & {
  prefill: { name: string | null; email: string | null; phone: string | null };
  signer: { role: SignerRole; athleteName: string | null; guardianName: string | null };
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

function safe(doc: PhotoDocumentRow, contact: Awaited<ReturnType<typeof signerContactFor>>): SafeSigningDocument {
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    body: doc.body,
    status: doc.status,
    signer_name: doc.signer_name,
    signed_at: doc.signed_at,
    declined_at: doc.declined_at,
    expires_at: doc.expires_at,
    sent_at: doc.sent_at,
    prefill: { name: contact.name, email: contact.email, phone: contact.phone },
    signer: { role: doc.signer_role, athleteName: contact.athleteName, guardianName: contact.guardianName },
  };
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
  else if (doc.status === "void") notice = "voided";
  else if (doc.status === "expired" || !isSignable(doc, now)) {
    notice = "expired";
    if (doc.status !== "expired") {
      const res = await applyProviderEvent(supabase, { doc, event: { type: "expired", occurredAt: now.toISOString() }, actor: { kind: "system" }, notify: false }, now);
      if (res.ok && res.applied) doc.status = "expired";
    }
  } else if (doc.status === "sent") {
    const res = await applyProviderEvent(supabase, { doc, event: { type: "viewed", occurredAt: now.toISOString() }, actor: { kind: "client" }, notify: false }, now);
    if (res.ok && res.applied) {
      doc.status = "viewed";
      doc.viewed_at = now.toISOString();
    }
  }
  const [studioName, contact] = await Promise.all([studioNameOf(supabase, doc.owner_id), signerContactFor(supabase, doc)]);
  return { ok: true, doc: safe(doc, contact), studioName, notice };
}

export type SignInput = { signerName: string; signerEmail?: string | null; signerPhone?: string | null; agreed: boolean; ip: string | null; userAgent: string | null; now?: Date };

export type SignError = "not_found" | "expired" | "already_signed" | "declined" | "voided" | "invalid_name" | "invalid_email" | "not_agreed" | "hash_mismatch" | "conflict" | "guardian_name_mismatch" | "minor_cannot_sign";

export type SignResult = { ok: true; documentId: string; signedAt: string; contractState: string | null } | { ok: false; error: SignError };

/**
 * Records a typed-name signature. Atomic against double submission: the
 * update only matches while the row is still sent/viewed. A guardian
 * release must be signed by the parent or guardian on file, never by the
 * athlete. After the row is signed: audit (actor 'client'), booking
 * contract_state re-derived, gates recomputed, owner Telegram, client copy
 * e-mail. Never touches photo_athletes and never confirms the booking
 * itself.
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
  if (doc.status === "void") return { ok: false, error: "voided" };
  if (!isSignable(doc, now)) return { ok: false, error: "expired" };
  const currentHash = bodyHash(doc.body);
  if (!doc.body_hash || doc.body_hash !== currentHash) return { ok: false, error: "hash_mismatch" };

  if (doc.signer_role === "guardian") {
    const contact = await signerContactFor(supabase, doc);
    const check = checkSignerForRole("guardian", signerName, { athleteName: contact.athleteName, guardianName: contact.guardianName });
    if (!check.ok) return { ok: false, error: check.error };
  }

  const signedAt = now.toISOString();
  const evidence: Record<string, Json> = {
    method: "typed_name",
    typed_name: signerName,
    signer_role: doc.signer_role,
    agreed_text: AGREED_TEXT,
    ip: input.ip ?? null,
    user_agent: (input.userAgent ?? "").slice(0, MAX_USER_AGENT) || null,
    body_hash: currentHash,
    token_hash_prefix: hashSigningToken(token).slice(0, 8),
    signed_at: signedAt,
  };
  const res = await applyProviderEvent(
    supabase,
    { doc, event: { type: "signed", occurredAt: signedAt, envelopeId: doc.provider_envelope_id ?? doc.id }, actor: { kind: "client" }, signer: { name: signerName, email: signerEmail, phone: signerPhone, evidence } },
    now,
  );
  if (!res.ok) return { ok: false, error: "conflict" };
  if (!res.applied) return { ok: false, error: "already_signed" };
  return { ok: true, documentId: doc.id, signedAt, contractState: res.booking?.state ?? null };
}

export type DeclineResult = { ok: true; documentId: string } | { ok: false; error: "not_found" | "expired" | "already_signed" | "declined" | "voided" | "conflict" };

/** The client says no: the document is closed (declined) and the owner is told why. */
export async function declineDocument(token: string, reason: string | null | undefined, deps: SigningDeps = {}): Promise<DeclineResult> {
  const supabase = clientOf(deps);
  if (!supabase) return { ok: false, error: "not_found" };
  const now = deps.now ?? new Date();
  const doc = await findByToken(supabase, token);
  if (!doc || doc.status === "draft") return { ok: false, error: "not_found" };
  if (doc.status === "signed") return { ok: false, error: "already_signed" };
  if (doc.status === "declined") return { ok: false, error: "declined" };
  if (doc.status === "void") return { ok: false, error: "voided" };
  if (!isSignable(doc, now)) return { ok: false, error: "expired" };
  const res = await applyProviderEvent(supabase, { doc, event: { type: "declined", occurredAt: now.toISOString(), envelopeId: doc.provider_envelope_id ?? doc.id }, actor: { kind: "client" }, reason: reason ?? null }, now);
  if (!res.ok) return { ok: false, error: "conflict" };
  if (!res.applied) return { ok: false, error: "already_signed" };
  return { ok: true, documentId: doc.id };
}
