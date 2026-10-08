import "server-only";
import { formatMoney } from "@/lib/bookings/state";
import { isWebsitePayUrl } from "@/lib/payments/pay-token";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { ClientBookingView, ClientGalleryView, ClientPaymentRequestView, ClientPaymentView, ClientPersonView, PaymentStage, PhotoDocumentRow } from "@/lib/supabase/database.types";
import { formatDateTime } from "@/lib/time";
import { isUuid } from "@/lib/validation";

/**
 * What a client sees about money and paperwork on one booking. Plain words,
 * no vendor names, no provider ids, no internal states. The only link ever
 * offered is OUR pay page (`/pay/<token>`) from a pending payment request
 * for the stage that is open right now.
 */
export type ClientStageLine = { label: string; amount: string | null; paid: boolean; due: boolean };
export type ClientBookingSummary = {
  contract: { label: string; signed: boolean; needsAction: boolean };
  deposit: ClientStageLine;
  balance: ClientStageLine;
  /** The stage the client can pay right now, with our pay link; null when nothing is payable. */
  pay: { stage: PaymentStage; amount: string; payUrl: string } | null;
  /** One sentence for the card ("Deposit due", "Paid in full", ...). */
  headline: string;
};

type SummaryBooking = Pick<ClientBookingView, "amount_qr" | "currency" | "requires_contract" | "contract_state" | "deposit_qr" | "deposit_state" | "deposit_paid_at" | "balance_qr" | "balance_state" | "balance_paid_at" | "booking_status">;
type SummaryRequest = Pick<ClientPaymentRequestView, "stage" | "status" | "payment_url" | "amount_qr" | "currency">;

export function clientBookingSummary(b: SummaryBooking, requests: readonly SummaryRequest[] = []): ClientBookingSummary {
  const money = (n: number | null | undefined) => formatMoney(n, b.currency);
  const contractSigned = !b.requires_contract || b.contract_state === "signed" || b.contract_state === "not_required";
  const contract = {
    label: contractSigned ? "Agreement signed" : b.contract_state === "declined" ? "Agreement declined" : "Agreement to sign",
    signed: contractSigned,
    needsAction: !contractSigned && (b.contract_state === "sent" || b.contract_state === "required"),
  };
  const depositPaid = b.deposit_state === "paid";
  const depositOwed = b.deposit_state === "pending" && Number(b.deposit_qr) > 0;
  const deposit: ClientStageLine = depositPaid
    ? { label: `Deposit paid${b.deposit_paid_at ? ` on ${formatDateTime(b.deposit_paid_at)} Qatar time` : ""}`, amount: money(b.deposit_qr), paid: true, due: false }
    : depositOwed
      ? { label: "Deposit due", amount: money(b.deposit_qr), paid: false, due: true }
      : { label: "No deposit needed", amount: null, paid: false, due: false };
  const balancePaid = b.balance_state === "paid";
  const balanceDue = b.balance_state === "due" && Number(b.balance_qr) > 0;
  const balance: ClientStageLine = balancePaid
    ? { label: `Paid in full${b.balance_paid_at ? ` on ${formatDateTime(b.balance_paid_at)} Qatar time` : ""}`, amount: money(b.balance_qr), paid: true, due: false }
    : balanceDue
      ? { label: "Remaining balance due", amount: money(b.balance_qr), paid: false, due: true }
      : b.balance_state === "waived" || !(Number(b.balance_qr) > 0)
        ? { label: "Nothing more to pay", amount: null, paid: false, due: false }
        : { label: "Not due yet", amount: money(b.balance_qr), paid: false, due: false };

  // The pay button: a pending request for the stage that is open, our page only.
  const open: PaymentStage | null = depositOwed && contractSigned ? "deposit" : balanceDue ? "balance" : null;
  let pay: ClientBookingSummary["pay"] = null;
  if (open) {
    const r = requests.find((x) => x.stage === open && x.status === "pending" && isWebsitePayUrl(x.payment_url));
    if (r && r.payment_url) pay = { stage: open, amount: money(r.amount_qr), payUrl: r.payment_url };
  }

  const cancelled = b.booking_status === "cancelled";
  const headline = cancelled
    ? "Cancelled"
    : !(Number(b.amount_qr) > 0)
      ? "No payment due"
      : depositPaid && (balancePaid || b.balance_state === "waived" || !(Number(b.balance_qr) > 0))
        ? "Paid in full"
        : balanceDue
          ? "Remaining balance due"
          : depositOwed
            ? contractSigned
              ? "Deposit due"
              : "Agreement to sign, then deposit"
            : depositPaid
              ? "Deposit paid"
              : "Not due yet";
  return { contract, deposit, balance, pay, headline };
}

/**
 * Loaders for the client portal. Everything runs through the signed-in
 * user's client against the client-safe SECURITY DEFINER views
 * (photo_client_*_v): a client sees the people rows linked to their auth
 * user, the bookings of those people, their non-draft documents, galleries
 * that are ready or delivered, payment records and payment requests of
 * their bookings, never internal notes, metadata, assignments or provider
 * ids. Nothing here takes an owner id from the caller.
 */

export type PortalBooking = {
  booking: ClientBookingView;
  documents: Pick<PhotoDocumentRow, "id" | "kind" | "title" | "status" | "signed_at" | "sent_at" | "expires_at" | "created_at">[];
  gallery: ClientGalleryView | null;
  payments: ClientPaymentView[];
  requests: ClientPaymentRequestView[];
  summary: ClientBookingSummary;
};

/**
 * CRM people linked to this auth user. If none is linked yet but a person
 * with the user's verified e-mail exists (booked before signing in), link it
 * now, scoped by the auth user's own verified address, never by input.
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
  const [docs, galleriesByBooking, galleriesById, payments, requests] = await Promise.all([
    supabase.from("photo_documents").select("id,booking_id,kind,title,status,signed_at,sent_at,expires_at,created_at").in("booking_id", ids).neq("status", "draft").order("created_at", { ascending: false }),
    supabase.from("photo_client_galleries_v").select("*").in("booking_id", ids),
    galleryIds.length ? supabase.from("photo_client_galleries_v").select("*").in("id", galleryIds) : Promise.resolve({ data: [] as ClientGalleryView[] }),
    supabase.from("photo_client_payments_v").select("*").in("booking_id", ids).order("paid_at", { ascending: false }),
    supabase.from("photo_client_payment_requests_v").select("*").in("booking_id", ids).order("created_at", { ascending: false }),
  ]);
  const galleries = new Map<string, ClientGalleryView>();
  for (const g of galleriesById.data ?? []) galleries.set(g.id, g);
  for (const g of galleriesByBooking.data ?? []) galleries.set(g.id, g);
  const docRows = (docs.data ?? []) as Array<PortalBooking["documents"][number] & { booking_id?: string | null }>;
  return bookings.map((booking) => {
    const mine = (requests.data ?? []).filter((r) => r.booking_id === booking.id);
    return {
      booking,
      documents: docRows.filter((d) => d.booking_id === booking.id || docBookingId(d) === booking.id),
      gallery: (booking.gallery_id ? galleries.get(booking.gallery_id) : null) ?? [...galleries.values()].find((g) => g.booking_id === booking.id) ?? null,
      payments: (payments.data ?? []).filter((p) => p.booking_id === booking.id),
      requests: mine,
      summary: clientBookingSummary(booking, mine),
    };
  });
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
