import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { Database, DocumentStatus, PhotoBookingRow, PhotoDocumentRow, PhotoDocumentTemplateRow, PhotoOrganizationRow, PhotoPersonRow } from "@/lib/supabase/database.types";
import { isUuid } from "@/lib/validation";

type Client = SupabaseClient<Database>;

/**
 * Studio-side loaders for contracts and templates. Everything here goes
 * through the user client, so RLS limits rows to the signed-in owner (or,
 * for the client policy, to the client's own non-draft documents). The one
 * service-role loader, getDocumentByTokenHash, exists for the public
 * signing page and the PDF route, which have no session.
 */

export type DocumentListFilter = "awaiting" | "signed" | "drafts" | "all";

export const DOCUMENT_LIST_STATUSES: Record<DocumentListFilter, readonly DocumentStatus[]> = {
  awaiting: ["sent", "viewed"],
  signed: ["signed"],
  drafts: ["draft"],
  all: ["draft", "sent", "viewed", "signed", "declined", "expired"],
};

export function isDocumentListFilter(v: unknown): v is DocumentListFilter {
  return v === "awaiting" || v === "signed" || v === "drafts" || v === "all";
}

export type DocumentListItem = PhotoDocumentRow & {
  client: Pick<PhotoPersonRow, "id" | "full_name"> | null;
  booking: Pick<PhotoBookingRow, "id" | "public_ref" | "athlete_name"> | null;
};

export async function listTemplates(): Promise<PhotoDocumentTemplateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_document_templates").select("*").order("kind", { ascending: true }).order("name", { ascending: true });
  return data ?? [];
}

export async function getTemplate(id: string): Promise<PhotoDocumentTemplateRow | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("photo_document_templates").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/** Attaches the client and booking rows (two small lookups; no FK joins needed). */
async function attachParties(supabase: Client, docs: PhotoDocumentRow[]): Promise<DocumentListItem[]> {
  const clientIds = [...new Set(docs.map((d) => d.client_id).filter((v): v is string => Boolean(v)))];
  const bookingIds = [...new Set(docs.map((d) => d.booking_id).filter((v): v is string => Boolean(v)))];
  const [people, bookings] = await Promise.all([
    clientIds.length ? supabase.from("photo_people").select("id,full_name").in("id", clientIds) : Promise.resolve({ data: [] as Array<Pick<PhotoPersonRow, "id" | "full_name">> }),
    bookingIds.length ? supabase.from("photo_bookings").select("id,public_ref,athlete_name").in("id", bookingIds) : Promise.resolve({ data: [] as Array<Pick<PhotoBookingRow, "id" | "public_ref" | "athlete_name">> }),
  ]);
  const peopleById = new Map((people.data ?? []).map((p) => [p.id, p]));
  const bookingsById = new Map((bookings.data ?? []).map((b) => [b.id, b]));
  return docs.map((d) => ({ ...d, client: d.client_id ? (peopleById.get(d.client_id) ?? null) : null, booking: d.booking_id ? (bookingsById.get(d.booking_id) ?? null) : null }));
}

export async function listDocuments(filter: { status?: DocumentListFilter; bookingId?: string } = {}): Promise<DocumentListItem[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_documents").select("*").order("created_at", { ascending: false }).limit(300);
  if (filter.status && filter.status !== "all") q = q.in("status", [...DOCUMENT_LIST_STATUSES[filter.status]]);
  if (filter.bookingId && isUuid(filter.bookingId)) q = q.eq("booking_id", filter.bookingId);
  const { data } = await q;
  return attachParties(supabase, data ?? []);
}

/** Every document attached to one booking (studio view). */
export async function listDocumentsForBooking(bookingId: string): Promise<PhotoDocumentRow[]> {
  if (!isUuid(bookingId)) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("photo_documents").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false });
  return data ?? [];
}

export type DocumentDetail = {
  doc: PhotoDocumentRow;
  client: PhotoPersonRow | null;
  booking: PhotoBookingRow | null;
  organization: PhotoOrganizationRow | null;
  template: Pick<PhotoDocumentTemplateRow, "id" | "name" | "version"> | null;
};

export async function getDocument(id: string): Promise<DocumentDetail | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data: doc } = await supabase.from("photo_documents").select("*").eq("id", id).maybeSingle();
  if (!doc) return null;
  const [client, booking, organization, template] = await Promise.all([
    doc.client_id ? supabase.from("photo_people").select("*").eq("id", doc.client_id).maybeSingle() : Promise.resolve({ data: null }),
    doc.booking_id ? supabase.from("photo_bookings").select("*").eq("id", doc.booking_id).maybeSingle() : Promise.resolve({ data: null }),
    doc.organization_id ? supabase.from("photo_organizations").select("*").eq("id", doc.organization_id).maybeSingle() : Promise.resolve({ data: null }),
    doc.template_id ? supabase.from("photo_document_templates").select("id,name,version").eq("id", doc.template_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return { doc, client: client.data ?? null, booking: booking.data ?? null, organization: organization.data ?? null, template: template.data ?? null };
}

/**
 * Service-role lookup by token hash for the public signing page and the
 * token-authenticated PDF download. No owner filter: the hash IS the
 * credential (unique index, 256-bit random token). Null when the server
 * has no service key.
 */
export async function getDocumentByTokenHash(hash: string, supabase?: Client): Promise<PhotoDocumentRow | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const client = supabase ?? (isServiceClientConfigured() ? createServiceClient() : null);
  if (!client) return null;
  const { data } = await client.from("photo_documents").select("*").eq("access_token_hash", hash).maybeSingle();
  return data ?? null;
}

export type BookingChoice = Pick<PhotoBookingRow, "id" | "public_ref" | "athlete_name" | "client_id" | "organization_id" | "booking_status" | "customer_name">;
export type PersonChoice = Pick<PhotoPersonRow, "id" | "full_name" | "email">;

/** Pick lists for the "New document" form. */
export async function listBookingChoices(): Promise<BookingChoice[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_bookings").select("id,public_ref,athlete_name,client_id,organization_id,booking_status,customer_name").neq("booking_status", "cancelled").order("created_at", { ascending: false }).limit(200);
  return data ?? [];
}

export async function listPersonChoices(): Promise<PersonChoice[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_people").select("id,full_name,email").order("full_name", { ascending: true }).limit(400);
  return data ?? [];
}

export function bookingChoiceLabel(b: Pick<BookingChoice, "id" | "public_ref" | "athlete_name">): string {
  return `${b.public_ref ?? b.id.slice(0, 8)} · ${b.athlete_name}`;
}
