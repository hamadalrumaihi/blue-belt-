import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PhotoPersonRow } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** Last 8 digits: tolerant of +974 / 00974 / spaces. Null when there are not enough digits. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
}

export function normalizeInstagram(handle: string | null | undefined): string | null {
  const t = (handle ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "");
  return t && /^[A-Za-z0-9._]{1,30}$/.test(t) ? t.toLowerCase() : null;
}

export type PersonInput = {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  instagram?: string | null;
  whatsapp?: string | null;
  kind?: PhotoPersonRow["kind"];
  source?: string;
};

export type FoundPerson = { person: PhotoPersonRow; created: boolean; matchedBy: "email" | "phone" | "created" };

/**
 * Find the CRM person for a contact (e-mail first, then phone) or create one.
 * Never merges two different people: a phone match with a different e-mail
 * on file is still a match (people change e-mails), but nothing on the
 * existing row is overwritten except empty contact fields.
 */
export async function findOrCreatePerson(supabase: Client, ownerId: string, input: PersonInput): Promise<{ ok: true; found: FoundPerson } | { ok: false; error: string }> {
  const email = input.email?.trim().toLowerCase() || null;
  const pk = phoneKey(input.phone);
  let person: PhotoPersonRow | null = null;
  let matchedBy: FoundPerson["matchedBy"] = "created";

  if (email) {
    const { data, error } = await supabase.from("photo_people").select("*").eq("owner_id", ownerId).eq("email_key", email).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (data) {
      person = data;
      matchedBy = "email";
    }
  }
  if (!person && pk) {
    const { data, error } = await supabase.from("photo_people").select("*").eq("owner_id", ownerId).eq("phone_key", pk).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (data) {
      person = data;
      matchedBy = "phone";
    }
  }

  if (person) {
    const patch: Partial<Omit<PhotoPersonRow, "email_key">> = {};
    if (!person.email && email) patch.email = email;
    if (!person.phone && input.phone?.trim()) {
      patch.phone = input.phone.trim();
      patch.phone_key = pk;
    }
    if (!person.instagram && normalizeInstagram(input.instagram)) patch.instagram = normalizeInstagram(input.instagram);
    if (!person.whatsapp && input.whatsapp?.trim()) patch.whatsapp = input.whatsapp.trim();
    if (Object.keys(patch).length) {
      const { data } = await supabase.from("photo_people").update(patch).eq("id", person.id).eq("owner_id", ownerId).select("*").maybeSingle();
      if (data) person = data;
    }
    return { ok: true, found: { person, created: false, matchedBy } };
  }

  const { data, error } = await supabase
    .from("photo_people")
    .insert({
      owner_id: ownerId,
      full_name: input.fullName.trim(),
      email,
      phone: input.phone?.trim() || null,
      phone_key: pk,
      instagram: normalizeInstagram(input.instagram),
      whatsapp: input.whatsapp?.trim() || null,
      kind: input.kind ?? "person",
      source: input.source ?? "manual",
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the contact." };
  return { ok: true, found: { person: data, created: true, matchedBy: "created" } };
}
