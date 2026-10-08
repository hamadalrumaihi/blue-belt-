import "server-only";
import { effectivePayment, formatQr } from "@/lib/bookings/state";
import { isWebsitePayUrl } from "@/lib/payments/pay-token";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { ClientBookingView, ClientGalleryView, ClientPaymentView, ClientPersonView, PhotoDocumentRow } from "@/lib/supabase/database.types";
import { formatDateTime } from "@/lib/time";
import { isUuid } from "@/lib/validation";

export type ClientPaymentLine = { title: string; detail: string | null; /** Our pay page, never the provider's URL. */ payUrl: string | null };

/**
 * The payment sentence a client sees for a booking. Paid: when. Requested:
 * the website pay link. Otherwise the house wording: nothing is needed to
 * book, payment happens online after the shoot. A provider URL (MyFatoorah's
 * own invoice page) is never shown; only our `/pay/<token>` page is linked.
 */
export function clientPaymentLine(b: Pick<ClientBookingView, "status" | "amount_qr" | "amount_paid_qr" | "manual_paid_at" | "paid_at" | "payment_url" | "booking_status">): ClientPaymentLine {
  const pay = effectivePayment(b);
  const amount = Number(b.amount_qr) || 0;
  const when = b.status === "paid" ? b.paid_at : b.manual_paid_at;
  if (pay.state === "paid") return { title: `Paid${when ? ` on ${formatDateTime(when)} Qatar time` : ""}`, detail: "Thank you.", payUrl: null };
  if (pay.state === "refunded") return { title: "Refunded", detail: null, payUrl: null };
  if (b.booking_status === "cancelled") return { title: "Cancelled", detail: "Nothing to pay.", payUrl: null };
  if (amount <= 0) return { title: "No payment due", detail: null, payUrl: null };
  const link = isWebsitePayUrl(b.payment_url) ? b.payment_url : null;
  if (pay.state === "partial") return { title: `${formatQr(pay.paidQr)} received, ${formatQr(pay.dueQr)} still due`, detail: link ? "Payment requested. Pay the balance online through MyFatoorah." : null, payUrl: link };
  if (link) return { title: "Payment requested", detail: `Pay ${formatQr(amount)} online through MyFatoorah.`, payUrl: link };
  return { title: "Not due yet", detail: "No payment is needed to book. After the shoot you pay online through MyFatoorah.", payUrl: null };
}

/**
 * Loaders for the client portal. Everything runs through the signed-in
 * user's client against the client-safe SECURITY DEFINER views
 * (photo_client_*_v): a client sees the people rows linked to their auth
 * user, the bookings of those people, their non-draft documents, galleries
 * that are ready or delivered, and payment records of their bookings —
 * never internal notes, metadata, assignments or provider ids. Nothing here
 * takes an owner id from the caller.
 */

export type PortalBooking = {
  booking: ClientBookingView;
  documents: Pick<PhotoDocumentRow, "id" | "kind" | "title" | "status" | "signed_at" | "sent_at" | "expires_at" | "created_at">[];
  gallery: ClientGalleryView | null;
  payments: ClientPaymentView[];
};

/**
 * CRM people linked to this auth user. If none is linked yet but a person
 * with the user's verified e-mail exists (booked before signing in), link it
 * now — scoped by the auth user's own verified address, never by input.
 */
export async function loadMyPeople(userId: string, email: string | null): Promise<ClientPersonView[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_client_people_v").select("*").order("created_at", { ascending: true });
  if ((data ?? []).length || !email || !isServiceClientConfigured()) return data ?? [];
  const service = createServiceClient();
  const { data: linked } = await service.from("photo_people").update({ user_id: userId }).is("user_id", null).eq("email_key", email.trim().toLowerCase()).select("id");
  if (!(linked ?? []).length) return [];
  const { data: again } = await supabase.from("photo_client_people_v").select("*").order("created_at", { ascending: true });
  return again ?? [];
}

async function attach(bookings: ClientBookingView[]): Promise<PortalBooking[]> {
  if (!bookings.length) return [];
  const supabase = await createClient();
  const ids = bookings.map((b) => b.id);
  const galleryIds = bookings.map((b) => b.gallery_id).filter((v): v is string => Boolean(v));
  const [docs, galleriesByBooking, galleriesById, payments] = await Promise.all([
    supabase.from("photo_documents").select("id,booking_id,kind,title,status,signed_at,sent_at,expires_at,created_at").in("booking_id", ids).neq("status", "draft").order("created_at", { ascending: false }),
    supabase.from("photo_client_galleries_v").select("*").in("booking_id", ids),
    galleryIds.length ? supabase.from("photo_client_galleries_v").select("*").in("id", galleryIds) : Promise.resolve({ data: [] as ClientGalleryView[] }),
    supabase.from("photo_client_payments_v").select("*").in("booking_id", ids).order("paid_at", { ascending: false }),
  ]);
  const galleries = new Map<string, ClientGalleryView>();
  for (const g of galleriesById.data ?? []) galleries.set(g.id, g);
  for (const g of galleriesByBooking.data ?? []) galleries.set(g.id, g);
  const docRows = (docs.data ?? []) as Array<PortalBooking["documents"][number] & { booking_id?: string | null }>;
  return bookings.map((booking) => ({
    booking,
    documents: docRows.filter((d) => d.booking_id === booking.id || docBookingId(d) === booking.id),
    gallery: (booking.gallery_id ? galleries.get(booking.gallery_id) : null) ?? [...galleries.values()].find((g) => g.booking_id === booking.id) ?? null,
    payments: (payments.data ?? []).filter((p) => p.booking_id === booking.id),
  }));
}

function docBookingId(d: { booking_id?: string | null }): string | null {
  return d.booking_id ?? null;
}

/** Every booking for the viewer's linked people, newest first. */
export async function listMyBookings(personIds: string[]): Promise<PortalBooking[]> {
  if (!personIds.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("photo_client_bookings_v").select("*").in("client_id", personIds).order("created_at", { ascending: false });
  return attach(data ?? []);
}

/** One booking, only when it belongs to one of the viewer's people (the view already enforces this; the filter makes it explicit). */
export async function getMyBooking(id: string, personIds: string[]): Promise<PortalBooking | null> {
  if (!isUuid(id) || !personIds.length) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("photo_client_bookings_v").select("*").eq("id", id).in("client_id", personIds).maybeSingle();
  if (!data) return null;
  const [item] = await attach([data]);
  return item ?? null;
}
