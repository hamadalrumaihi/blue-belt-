/**
 * Pure parsing for the CRM person form (people/new, people/[id]/edit).
 * No I/O; the "use server" actions file imports it.
 */
import { normalizeInstagram, phoneKey } from "@/lib/people/match";
import type { PersonKind } from "@/lib/supabase/database.types";
import { isValidEmail, trimOrNull } from "@/lib/utils";

export const PERSON_KINDS = ["person", "parent", "coach", "club_contact"] as const satisfies readonly PersonKind[];

export const PERSON_KIND_LABEL: Record<PersonKind, string> = { person: "Client", parent: "Parent / guardian", coach: "Coach", club_contact: "Club contact" };

export function isPersonKind(v: unknown): v is PersonKind {
  return typeof v === "string" && (PERSON_KINDS as readonly string[]).includes(v);
}

export type ParsedPersonForm = {
  fieldErrors: Record<string, string>;
  values: {
    full_name: string;
    email: string | null;
    phone: string | null;
    phone_key: string | null;
    instagram: string | null;
    whatsapp: string | null;
    kind: PersonKind;
    tags: string[];
    notes: string | null;
  };
};

const MAX_NAME = 120;
const MAX_NOTES = 2000;
const MAX_TAGS = 12;

/** "vip, parent , repeat" → ["vip", "parent", "repeat"]; lower-cased, deduped, at most MAX_TAGS. */
export function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim().toLowerCase().slice(0, 30);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function parsePersonForm(formData: FormData): ParsedPersonForm {
  const fieldErrors: Record<string, string> = {};
  const full_name = trimOrNull(formData.get("full_name"));
  if (!full_name) fieldErrors.full_name = "Full name is required.";
  else if (full_name.length > MAX_NAME) fieldErrors.full_name = `Keep the name under ${MAX_NAME} characters.`;
  const email = trimOrNull(formData.get("email"))?.toLowerCase() ?? null;
  if (email && !isValidEmail(email)) fieldErrors.email = "Enter a valid email.";
  const phone = trimOrNull(formData.get("phone"));
  if (phone && phone.length > 40) fieldErrors.phone = "That phone number is too long.";
  const instagramRaw = trimOrNull(formData.get("instagram"));
  const instagram = normalizeInstagram(instagramRaw);
  if (instagramRaw && !instagram) fieldErrors.instagram = "Enter an Instagram handle like @bluebeltmedia.";
  const whatsapp = trimOrNull(formData.get("whatsapp"));
  if (whatsapp && whatsapp.length > 40) fieldErrors.whatsapp = "That WhatsApp number is too long.";
  const kindRaw = trimOrNull(formData.get("kind"));
  const kind: PersonKind = isPersonKind(kindRaw) ? kindRaw : "person";
  if (kindRaw && !isPersonKind(kindRaw)) fieldErrors.kind = "Choose a valid type.";
  const notes = trimOrNull(formData.get("notes"));
  if (notes && notes.length > MAX_NOTES) fieldErrors.notes = `Keep notes under ${MAX_NOTES} characters.`;
  return {
    fieldErrors,
    values: { full_name: full_name ?? "", email, phone, phone_key: phoneKey(phone), instagram, whatsapp, kind, tags: parseTags(trimOrNull(formData.get("tags"))), notes },
  };
}

/** wa.me wants digits with the country code; a bare 8-digit number is treated as Qatar (+974). */
export function whatsappDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 8) return `974${digits}`;
  return digits.length >= 10 ? digits : null;
}

/** Keeps a search term safe for a PostgREST `or(ilike)` filter. */
export function peopleSearchTerm(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/[^\p{L}\p{N}\s.@'+-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || null;
}
