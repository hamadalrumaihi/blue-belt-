import "server-only";
import { peopleSearchTerm } from "@/lib/people/form";
import { createClient } from "@/lib/supabase/server";
import type { PhotoDocumentRow, PhotoGalleryRow, PhotoOrganizationRow, PhotoPersonRow } from "@/lib/supabase/database.types";

/** Owner reads for the CRM people module (user client, RLS). */

export type PersonListRow = PhotoPersonRow & { bookingCount: number };

export async function listPeople(opts: { q?: string | null; limit?: number } = {}): Promise<PersonListRow[]> {
  const supabase = await createClient();
  let query = supabase.from("photo_people").select("*");
  const q = peopleSearchTerm(opts.q);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,instagram.ilike.%${q}%`);
  const { data } = await query.order("full_name", { ascending: true }).limit(opts.limit ?? 300);
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: bookings } = await supabase.from("photo_bookings").select("client_id").in("client_id", rows.map((p) => p.id));
  const counts = new Map<string, number>();
  for (const b of bookings ?? []) if (b.client_id) counts.set(b.client_id, (counts.get(b.client_id) ?? 0) + 1);
  return rows.map((p) => ({ ...p, bookingCount: counts.get(p.id) ?? 0 }));
}

export async function countPeople(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("photo_people").select("id", { count: "exact", head: true });
  return count ?? 0;
}

export type PersonDocumentSummary = Pick<PhotoDocumentRow, "id" | "title" | "status" | "kind" | "signed_at" | "booking_id">;

export type PersonDetail = {
  person: PhotoPersonRow;
  organizations: PhotoOrganizationRow[];
  galleries: PhotoGalleryRow[];
  documents: PersonDocumentSummary[];
};

export async function getPerson(id: string): Promise<PersonDetail | null> {
  const supabase = await createClient();
  const { data: person } = await supabase.from("photo_people").select("*").eq("id", id).maybeSingle();
  if (!person) return null;
  const [orgs, galleries, documents] = await Promise.all([
    supabase.from("photo_organizations").select("*").eq("primary_contact_id", id).order("name", { ascending: true }),
    supabase.from("photo_galleries").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("photo_documents").select("id,title,status,kind,signed_at,booking_id").eq("client_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  return { person, organizations: orgs.data ?? [], galleries: galleries.data ?? [], documents: documents.data ?? [] };
}

/** Compact options for pickers (booking form, organisation contact). */
export async function listPeopleOptions(limit = 500): Promise<Array<Pick<PhotoPersonRow, "id" | "full_name" | "email" | "phone">>> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_people").select("id,full_name,email,phone").order("full_name", { ascending: true }).limit(limit);
  return data ?? [];
}
