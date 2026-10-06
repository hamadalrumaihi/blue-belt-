import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PhotoBookingRow, PhotoDocumentRow, PhotoGalleryRow, PhotoPaymentRecordRow, PhotoPersonRow } from "@/lib/supabase/database.types";
import { isUuid } from "@/lib/validation";

/**
 * Loaders for the client portal. Everything runs through the signed-in
 * user's client, so RLS does the gating: a client sees the people rows
 * linked to their auth user, the bookings of those people, their non-draft
 * documents, galleries that are ready or delivered, and payment records of
 * their bookings. Nothing here takes an owner id from the caller.
 */

export type PortalBooking = {
  booking: PhotoBookingRow;
  documents: PhotoDocumentRow[];
  gallery: PhotoGalleryRow | null;
  payments: PhotoPaymentRecordRow[];
};

/** CRM people linked to this auth user (usually one; several when the same e-mail books with more than one studio). */
export async function loadMyPeople(userId: string): Promise<PhotoPersonRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_people").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  return data ?? [];
}

async function attach(bookings: PhotoBookingRow[]): Promise<PortalBooking[]> {
  if (!bookings.length) return [];
  const supabase = await createClient();
  const ids = bookings.map((b) => b.id);
  const galleryIds = bookings.map((b) => b.gallery_id).filter((v): v is string => Boolean(v));
  const [docs, galleriesByBooking, galleriesById, payments] = await Promise.all([
    supabase.from("photo_documents").select("*").in("booking_id", ids).neq("status", "draft").order("created_at", { ascending: false }),
    supabase.from("photo_galleries").select("*").in("booking_id", ids),
    galleryIds.length ? supabase.from("photo_galleries").select("*").in("id", galleryIds) : Promise.resolve({ data: [] as PhotoGalleryRow[] }),
    supabase.from("photo_payment_records").select("*").in("booking_id", ids).order("paid_at", { ascending: false }),
  ]);
  const galleries = new Map<string, PhotoGalleryRow>();
  for (const g of galleriesById.data ?? []) galleries.set(g.id, g);
  for (const g of galleriesByBooking.data ?? []) galleries.set(g.id, g);
  return bookings.map((booking) => ({
    booking,
    documents: (docs.data ?? []).filter((d) => d.booking_id === booking.id),
    gallery: (booking.gallery_id ? galleries.get(booking.gallery_id) : null) ?? [...galleries.values()].find((g) => g.booking_id === booking.id) ?? null,
    payments: (payments.data ?? []).filter((p) => p.booking_id === booking.id),
  }));
}

/** Every booking for the viewer's linked people, newest first. */
export async function listMyBookings(personIds: string[]): Promise<PortalBooking[]> {
  if (!personIds.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("photo_bookings").select("*").in("client_id", personIds).order("created_at", { ascending: false });
  return attach(data ?? []);
}

/** One booking, only when it belongs to one of the viewer's people (RLS already enforces this; the filter makes it explicit). */
export async function getMyBooking(id: string, personIds: string[]): Promise<PortalBooking | null> {
  if (!isUuid(id) || !personIds.length) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("photo_bookings").select("*").eq("id", id).in("client_id", personIds).maybeSingle();
  if (!data) return null;
  const [item] = await attach([data]);
  return item ?? null;
}
