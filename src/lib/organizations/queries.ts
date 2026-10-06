import "server-only";
import { peopleSearchTerm } from "@/lib/people/form";
import { createClient } from "@/lib/supabase/server";
import type { PhotoOrganizationRow, PhotoPersonRow } from "@/lib/supabase/database.types";

/** Owner reads for teams / clubs (user client, RLS). */

export type OrganizationListRow = PhotoOrganizationRow & { contact: Pick<PhotoPersonRow, "id" | "full_name"> | null; bookingCount: number };

export async function listOrganizations(opts: { q?: string | null; limit?: number } = {}): Promise<OrganizationListRow[]> {
  const supabase = await createClient();
  let query = supabase.from("photo_organizations").select("*");
  const q = peopleSearchTerm(opts.q);
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,instagram.ilike.%${q}%`);
  const { data } = await query.order("name", { ascending: true }).limit(opts.limit ?? 300);
  const rows = data ?? [];
  if (!rows.length) return [];
  const contactIds = [...new Set(rows.map((o) => o.primary_contact_id).filter((v): v is string => Boolean(v)))];
  const [contacts, bookings] = await Promise.all([
    contactIds.length ? supabase.from("photo_people").select("id,full_name").in("id", contactIds) : Promise.resolve({ data: [] as Array<Pick<PhotoPersonRow, "id" | "full_name">> }),
    supabase.from("photo_bookings").select("organization_id").in("organization_id", rows.map((o) => o.id)),
  ]);
  const contactMap = new Map((contacts.data ?? []).map((p) => [p.id, p]));
  const counts = new Map<string, number>();
  for (const b of bookings.data ?? []) if (b.organization_id) counts.set(b.organization_id, (counts.get(b.organization_id) ?? 0) + 1);
  return rows.map((o) => ({ ...o, contact: (o.primary_contact_id && contactMap.get(o.primary_contact_id)) || null, bookingCount: counts.get(o.id) ?? 0 }));
}

export type OrganizationDetail = {
  organization: PhotoOrganizationRow;
  primaryContact: PhotoPersonRow | null;
  /** People who booked under this organisation (plus the primary contact). */
  contacts: PhotoPersonRow[];
};

export async function getOrganization(id: string): Promise<OrganizationDetail | null> {
  const supabase = await createClient();
  const { data: organization } = await supabase.from("photo_organizations").select("*").eq("id", id).maybeSingle();
  if (!organization) return null;
  const { data: bookings } = await supabase.from("photo_bookings").select("client_id").eq("organization_id", id);
  const ids = new Set<string>();
  if (organization.primary_contact_id) ids.add(organization.primary_contact_id);
  for (const b of bookings ?? []) if (b.client_id) ids.add(b.client_id);
  const { data: people } = ids.size ? await supabase.from("photo_people").select("*").in("id", [...ids]).order("full_name", { ascending: true }) : { data: [] as PhotoPersonRow[] };
  const contacts = people ?? [];
  return { organization, primaryContact: contacts.find((p) => p.id === organization.primary_contact_id) ?? null, contacts };
}

export async function listOrganizationOptions(limit = 300): Promise<Array<Pick<PhotoOrganizationRow, "id" | "name" | "kind">>> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_organizations").select("id,name,kind").order("name", { ascending: true }).limit(limit);
  return data ?? [];
}
