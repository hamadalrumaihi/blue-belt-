import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, GalleryStatus, PhotoBookingRow, PhotoGalleryRow, PhotoPersonRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

type Client = SupabaseClient<Database>;

/**
 * Owner reads of photo_galleries through the user client (RLS). Related
 * rows are fetched by id rather than embedded, so no relationship typing
 * is needed and a client who can see a gallery never sees other people.
 */
export type GalleryClientLite = Pick<PhotoPersonRow, "id" | "full_name" | "email">;
export type GalleryBookingLite = Pick<PhotoBookingRow, "id" | "public_ref" | "athlete_name" | "customer_name" | "customer_email" | "booking_status" | "event_id" | "session_at" | "package_name">;

export type GalleryListItem = PhotoGalleryRow & { client: GalleryClientLite | null; booking: GalleryBookingLite | null };

export type GalleryDetail = { gallery: PhotoGalleryRow; client: GalleryClientLite | null; booking: GalleryBookingLite | null; eventName: string | null };

async function relatedFor(supabase: Client, galleries: PhotoGalleryRow[]): Promise<{ clients: Map<string, GalleryClientLite>; bookings: Map<string, GalleryBookingLite> }> {
  const clientIds = [...new Set(galleries.map((g) => g.client_id).filter((v): v is string => Boolean(v)))];
  const bookingIds = [...new Set(galleries.map((g) => g.booking_id).filter((v): v is string => Boolean(v)))];
  const [people, bookings] = await Promise.all([
    clientIds.length ? supabase.from("photo_people").select("id,full_name,email").in("id", clientIds) : Promise.resolve({ data: [] as GalleryClientLite[] }),
    bookingIds.length ? supabase.from("photo_bookings").select("id,public_ref,athlete_name,customer_name,customer_email,booking_status,event_id,session_at,package_name").in("id", bookingIds) : Promise.resolve({ data: [] as GalleryBookingLite[] }),
  ]);
  return {
    clients: new Map((people.data ?? []).map((p) => [p.id, p])),
    bookings: new Map((bookings.data ?? []).map((b) => [b.id, b])),
  };
}

export async function listGalleries(opts: { status?: GalleryStatus | null; limit?: number } = {}): Promise<GalleryListItem[]> {
  const supabase = await createClient();
  let query = supabase.from("photo_galleries").select("*").order("updated_at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const related = await relatedFor(supabase, rows);
  return rows.map((g) => ({ ...g, client: g.client_id ? related.clients.get(g.client_id) ?? null : null, booking: g.booking_id ? related.bookings.get(g.booking_id) ?? null : null }));
}

export async function getGallery(id: string): Promise<GalleryDetail | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data: gallery } = await supabase.from("photo_galleries").select("*").eq("id", id).maybeSingle();
  if (!gallery) return null;
  const related = await relatedFor(supabase, [gallery]);
  let eventName: string | null = null;
  if (gallery.event_id) {
    const { data: ev } = await supabase.from("photo_events").select("name").eq("id", gallery.event_id).maybeSingle();
    eventName = ev?.name ?? null;
  }
  return { gallery, client: gallery.client_id ? related.clients.get(gallery.client_id) ?? null : null, booking: gallery.booking_id ? related.bookings.get(gallery.booking_id) ?? null : null, eventName };
}

export async function galleriesForBooking(bookingId: string): Promise<PhotoGalleryRow[]> {
  if (!isUuid(bookingId)) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("photo_galleries").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false });
  return data ?? [];
}

export type GalleryCounts = Record<GalleryStatus, number> & { total: number };

export async function galleryCounts(): Promise<GalleryCounts> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_galleries").select("status").limit(5000);
  const counts: GalleryCounts = { pending: 0, created: 0, ready: 0, delivered: 0, total: 0 };
  for (const row of data ?? []) {
    counts[row.status] += 1;
    counts.total += 1;
  }
  return counts;
}

/** Bookings the owner can attach a gallery to (for the form's picker), newest first. */
export async function listBookingsForGalleryPicker(limit = 100): Promise<GalleryBookingLite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("photo_bookings")
    .select("id,public_ref,athlete_name,customer_name,customer_email,booking_status,event_id,session_at,package_name")
    .not("booking_status", "in", "(cancelled,completed)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
