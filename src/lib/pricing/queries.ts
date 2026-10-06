import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BookingType, PhotoBookingRow, PhotoPriceReferenceRow, PhotoQuoteRow } from "@/lib/supabase/database.types";

/**
 * Owner reads for the pricing area. Always the signed-in user's client: RLS
 * (photo_is_owner_user) returns nothing for staff or client accounts, and the
 * pages call requireOwner() before rendering anyway.
 */

export async function listPriceReferences(opts: { serviceType?: BookingType | null; limit?: number } = {}): Promise<PhotoPriceReferenceRow[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_price_references").select("*");
  if (opts.serviceType) q = q.eq("service_type", opts.serviceType);
  const { data } = await q.order("service_type", { ascending: true }).order("checked_on", { ascending: false }).order("provider", { ascending: true }).limit(opts.limit ?? 300);
  return data ?? [];
}

export async function getPriceReference(id: string): Promise<PhotoPriceReferenceRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_price_references").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export type QuoteListRow = PhotoQuoteRow & { booking: Pick<PhotoBookingRow, "id" | "public_ref" | "customer_name" | "booking_status"> | null };

export async function listQuotes(opts: { bookingId?: string | null; limit?: number } = {}): Promise<QuoteListRow[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_quotes").select("*");
  if (opts.bookingId) q = q.eq("booking_id", opts.bookingId);
  const { data } = await q.order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.booking_id).filter((v): v is string => Boolean(v)))];
  const bookings = new Map<string, QuoteListRow["booking"]>();
  if (ids.length) {
    const { data: found } = await supabase.from("photo_bookings").select("id,public_ref,customer_name,booking_status").in("id", ids);
    for (const b of found ?? []) bookings.set(b.id, b);
  }
  return rows.map((r) => ({ ...r, booking: (r.booking_id && bookings.get(r.booking_id)) || null }));
}

export async function getQuote(id: string): Promise<QuoteListRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_quotes").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  let booking: QuoteListRow["booking"] = null;
  if (data.booking_id) {
    const { data: b } = await supabase.from("photo_bookings").select("id,public_ref,customer_name,booking_status").eq("id", data.booking_id).maybeSingle();
    booking = b ?? null;
  }
  return { ...data, booking };
}
