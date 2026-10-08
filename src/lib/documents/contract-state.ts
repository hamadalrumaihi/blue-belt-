import type { BookingType, ContractState, DocumentKind, PhotoBookingRow, PhotoDocumentRow, SignerRole } from "@/lib/supabase/database.types";

/**
 * Pure rules linking a booking to its agreements. No I/O: the signing
 * service, the owner actions and the webhook all feed rows in and write
 * what comes out, so every path agrees on when a booking's contract gate
 * is satisfied.
 */

/** Which agreement a booking type needs. Clubs are covered at events, so they get the event agreement. */
export function agreementKindForBookingType(type: BookingType): DocumentKind {
  switch (type) {
    case "tournament_athlete":
    case "club":
      return "event_agreement";
    case "private_session":
      return "session_agreement";
    case "training_session":
    case "custom":
    default:
      return "services_agreement";
  }
}

export type GuardianContact = { name: string | null; email: string | null; phone: string | null };

/** The parent or guardian recorded on a booking ({name, email, phone, consent_at}); null when nothing usable is stored. */
export function guardianOf(booking: Pick<PhotoBookingRow, "guardian">): GuardianContact | null {
  const g = booking.guardian;
  if (!g || typeof g !== "object" || Array.isArray(g)) return null;
  const rec = g as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const out = { name: str(rec.name), email: str(rec.email)?.toLowerCase() ?? null, phone: str(rec.phone) };
  return out.name || out.email || out.phone ? out : null;
}

export function needsGuardianRelease(booking: Pick<PhotoBookingRow, "subject_is_minor" | "requires_guardian_release">): boolean {
  return Boolean(booking.subject_is_minor || booking.requires_guardian_release);
}

export type ContractDocument = Pick<PhotoDocumentRow, "id" | "status" | "signer_role" | "required_for_confirmation" | "kind">;
export type ContractBooking = Pick<PhotoBookingRow, "requires_contract" | "requires_guardian_release" | "subject_is_minor">;

/** Documents that still count: sent, viewed, signed or declined, and required for confirmation. Drafts, expired and voided ones do not. */
export function activeRequiredDocuments<T extends ContractDocument>(documents: T[]): T[] {
  return documents.filter((d) => d.required_for_confirmation && (d.status === "sent" || d.status === "viewed" || d.status === "signed" || d.status === "declined"));
}

/**
 * The booking's contract_state from its documents:
 *   not_required  the booking needs no agreement
 *   declined      any live required document was declined
 *   signed        every live required document is signed, at least one of
 *                 them by the client, and (for a minor) at least one
 *                 guardian release signed by the parent or guardian
 *   sent          something is out for signature (or partly signed)
 *   required      nothing live: never sent, or everything voided / expired
 */
export function contractStateFor(booking: ContractBooking, documents: ContractDocument[]): ContractState {
  if (!booking.requires_contract) return "not_required";
  const live = activeRequiredDocuments(documents);
  if (live.length === 0) return "required";
  if (live.some((d) => d.status === "declined")) return "declined";
  const allSigned = live.every((d) => d.status === "signed");
  const clientSigned = live.some((d) => d.status === "signed" && d.signer_role === "client");
  const guardianSigned = live.some((d) => d.status === "signed" && d.signer_role === "guardian");
  if (allSigned && clientSigned && (!needsGuardianRelease(booking) || guardianSigned)) return "signed";
  return "sent";
}

/** The document the booking's `contract_document_id` should point at: the signed client agreement, else the live one, else the newest. */
export function primaryContractDocument<T extends ContractDocument & { created_at: string }>(documents: T[]): T | null {
  const client = documents.filter((d) => d.signer_role === "client" && d.required_for_confirmation);
  const pick = (list: T[]) => [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
  return pick(client.filter((d) => d.status === "signed")) ?? pick(activeRequiredDocuments(client)) ?? pick(client) ?? pick(documents);
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Loose comparison of two person names: equal after normalisation, or every
 * token of the shorter name appears in the longer (so "Sara Khan" matches
 * "Sara A. Khan"). Used to make sure the guardian release is signed by the
 * parent or guardian on file, not by the athlete.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(" ");
  const ys = y.split(" ");
  const [short, long] = xs.length <= ys.length ? [xs, ys] : [ys, xs];
  if (short.length < 2) return false;
  return short.every((t) => long.includes(t));
}

export type SignerCheck = { ok: true } | { ok: false; error: "guardian_name_mismatch" | "minor_cannot_sign" };

/**
 * Who may sign a document of this role. A guardian release must be signed by
 * the guardian: never by the athlete (the minor), and when a guardian name is
 * on file the typed name has to be that person's.
 */
export function checkSignerForRole(role: SignerRole, typedName: string, ctx: { athleteName: string | null; guardianName: string | null }): SignerCheck {
  if (role !== "guardian") return { ok: true };
  if (ctx.athleteName && namesMatch(typedName, ctx.athleteName) && !(ctx.guardianName && namesMatch(typedName, ctx.guardianName))) return { ok: false, error: "minor_cannot_sign" };
  if (ctx.guardianName && !namesMatch(typedName, ctx.guardianName)) return { ok: false, error: "guardian_name_mismatch" };
  return { ok: true };
}
