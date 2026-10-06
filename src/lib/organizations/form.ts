/** Pure parsing for the team / club form. No I/O. */
import { normalizeInstagram } from "@/lib/people/match";
import type { OrganizationKind } from "@/lib/supabase/database.types";
import { isValidEmail, trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";

export const ORGANIZATION_KINDS = ["club", "academy", "team", "federation", "other"] as const satisfies readonly OrganizationKind[];

export const ORGANIZATION_KIND_LABEL: Record<OrganizationKind, string> = { club: "Club", academy: "Academy", team: "Team", federation: "Federation", other: "Other" };

export function isOrganizationKind(v: unknown): v is OrganizationKind {
  return typeof v === "string" && (ORGANIZATION_KINDS as readonly string[]).includes(v);
}

export type ParsedOrganizationForm = {
  fieldErrors: Record<string, string>;
  values: { name: string; kind: OrganizationKind; primary_contact_id: string | null; email: string | null; phone: string | null; instagram: string | null; notes: string | null };
};

export function parseOrganizationForm(formData: FormData): ParsedOrganizationForm {
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(formData.get("name"));
  if (!name) fieldErrors.name = "Name is required.";
  else if (name.length > 120) fieldErrors.name = "Keep the name under 120 characters.";
  const kindRaw = trimOrNull(formData.get("kind"));
  const kind: OrganizationKind = isOrganizationKind(kindRaw) ? kindRaw : "club";
  if (kindRaw && !isOrganizationKind(kindRaw)) fieldErrors.kind = "Choose a valid type.";
  const primary_contact_id = trimOrNull(formData.get("primary_contact_id"));
  if (primary_contact_id && !isUuid(primary_contact_id)) fieldErrors.primary_contact_id = "Choose a valid contact.";
  const email = trimOrNull(formData.get("email"))?.toLowerCase() ?? null;
  if (email && !isValidEmail(email)) fieldErrors.email = "Enter a valid email.";
  const phone = trimOrNull(formData.get("phone"));
  if (phone && phone.length > 40) fieldErrors.phone = "That phone number is too long.";
  const instagramRaw = trimOrNull(formData.get("instagram"));
  const instagram = normalizeInstagram(instagramRaw);
  if (instagramRaw && !instagram) fieldErrors.instagram = "Enter an Instagram handle like @club.";
  const notes = trimOrNull(formData.get("notes"));
  if (notes && notes.length > 2000) fieldErrors.notes = "Keep notes under 2000 characters.";
  return { fieldErrors, values: { name: name ?? "", kind, primary_contact_id: primary_contact_id && isUuid(primary_contact_id) ? primary_contact_id : null, email, phone, instagram, notes } };
}
