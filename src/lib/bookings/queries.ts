import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effectivePayment, type EffectivePayment } from "@/lib/bookings/state";
import { bookingSearchTerm } from "@/lib/bookings/form";
import { listStageRequests } from "@/lib/payments/requests";
import { createClient } from "@/lib/supabase/server";
import type {
  BookingStatus,
  BookingType,
  Database,
  PhotoAuditLogRow,
  PhotoBookingPaymentRequestRow,
  PhotoBookingRow,
  PhotoDocumentRow,
  PhotoEventRow,
  PhotoGalleryRow,
  PhotoOrganizationRow,
  PhotoPaymentRecordRow,
  PhotoPersonRow,
  PhotoServiceRow,
} from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Owner reads for the bookings module (user client, RLS). Related rows are
 * fetched by id instead of PostgREST embeds, so the hand-written Database
 * type stays simple and a missing relation never breaks a page.
 */

export type BookingFilter = "needs_action" | "awaiting_deposit" | "confirmed" | "balance_due" | "delivered" | "all";

export const NEEDS_ACTION_STATUSES: readonly BookingStatus[] = ["inquiry", "quoted", "awaiting_contract", "awaiting_payment"];
export const CONFIRMED_STATUSES: readonly BookingStatus[] = ["confirmed", "in_progress"];
export const DELIVERED_STATUSES: readonly BookingStatus[] = ["delivered", "completed"];

export type BookingListRow = PhotoBookingRow & {
  client: Pick<PhotoPersonRow, "id" | "full_name" | "email" | "phone"> | null;
  event: Pick<PhotoEventRow, "id" | "name" | "event_date"> | null;
  payment: EffectivePayment;
};

export type ListBookingsOptions = { filter?: BookingFilter; type?: BookingType | null; q?: string | null; limit?: number };

export async function listBookings(opts: ListBookingsOptions = {}): Promise<BookingListRow[]> {
  const supabase = await createClient();
  const filter = opts.filter ?? "all";
  let query = supabase.from("photo_bookings").select("*");
  if (filter === "needs_action") query = query.in("booking_status", NEEDS_ACTION_STATUSES);
  if (filter === "awaiting_deposit") query = query.eq("booking_status", "awaiting_payment").eq("deposit_state", "pending");
  if (filter === "confirmed") query = query.in("booking_status", CONFIRMED_STATUSES);
  if (filter === "balance_due") query = query.eq("balance_state", "due").neq("booking_status", "cancelled");
  if (filter === "delivered") query = query.in("booking_status", DELIVERED_STATUSES);
  if (opts.type) query = query.eq("booking_type", opts.type);
  const q = bookingSearchTerm(opts.q);
  if (q) query = query.or(`customer_name.ilike.%${q}%,athlete_name.ilike.%${q}%,public_ref.ilike.%${q}%,customer_email.ilike.%${q}%`);
  query = filter === "confirmed" ? query.order("session_at", { ascending: true, nullsFirst: false }) : filter === "balance_due" ? query.order("balance_due_at", { ascending: true, nullsFirst: false }) : query.order("created_at", { ascending: false });
  const { data } = await query.limit(opts.limit ?? 200);
  const rows = data ?? [];
  const [people, events] = await Promise.all([peopleById(supabase, rows.map((b) => b.client_id)), eventsById(supabase, rows.map((b) => b.event_id))]);
  return rows.map((b) => ({ ...b, client: (b.client_id && people.get(b.client_id)) || null, event: (b.event_id && events.get(b.event_id)) || null, payment: effectivePayment(b) }));
}

export type BookingCounts = Record<BookingFilter, number>;

export async function bookingCounts(): Promise<BookingCounts> {
  const supabase = await createClient();
  const head = (statuses?: readonly BookingStatus[]) => {
    let q = supabase.from("photo_bookings").select("id", { count: "exact", head: true });
    if (statuses) q = q.in("booking_status", statuses);
    return q;
  };
  const [all, needs, awaitingDeposit, confirmed, balanceDue, delivered] = await Promise.all([
    head(),
    head(NEEDS_ACTION_STATUSES),
    supabase.from("photo_bookings").select("id", { count: "exact", head: true }).eq("booking_status", "awaiting_payment").eq("deposit_state", "pending"),
    head(CONFIRMED_STATUSES),
    supabase.from("photo_bookings").select("id", { count: "exact", head: true }).eq("balance_state", "due").neq("booking_status", "cancelled"),
    head(DELIVERED_STATUSES),
  ]);
  return { all: all.count ?? 0, needs_action: needs.count ?? 0, awaiting_deposit: awaitingDeposit.count ?? 0, confirmed: confirmed.count ?? 0, balance_due: balanceDue.count ?? 0, delivered: delivered.count ?? 0 };
}

/** Bookings with a session in the next `days` days that are still live (not cancelled, delivered or completed). */
export async function upcomingBookings(days = 7, now: Date = new Date()): Promise<BookingListRow[]> {
  const supabase = await createClient();
  const from = new Date(now.getTime() - 60 * 60_000).toISOString();
  const to = new Date(now.getTime() + days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("photo_bookings")
    .select("*")
    .gte("session_at", from)
    .lte("session_at", to)
    .not("booking_status", "in", "(cancelled,delivered,completed)")
    .order("session_at", { ascending: true })
    .limit(50);
  const rows = data ?? [];
  const [people, events] = await Promise.all([peopleById(supabase, rows.map((b) => b.client_id)), eventsById(supabase, rows.map((b) => b.event_id))]);
  return rows.map((b) => ({ ...b, client: (b.client_id && people.get(b.client_id)) || null, event: (b.event_id && events.get(b.event_id)) || null, payment: effectivePayment(b) }));
}

/** @deprecated the detail now carries full document rows (the agreement panel needs them). */
export type BookingDocumentSummary = Pick<PhotoDocumentRow, "id" | "title" | "status" | "kind" | "signed_at" | "sent_at">;

export type BookingDetail = {
  booking: PhotoBookingRow;
  client: PhotoPersonRow | null;
  organization: PhotoOrganizationRow | null;
  service: PhotoServiceRow | null;
  event: PhotoEventRow | null;
  gallery: PhotoGalleryRow | null;
  documents: PhotoDocumentRow[];
  paymentRecords: PhotoPaymentRecordRow[];
  /** Stage payment requests (deposit / balance), oldest generation first. */
  paymentRequests: PhotoBookingPaymentRequestRow[];
  payment: EffectivePayment;
  audit: PhotoAuditLogRow[];
  linkedAthlete: { id: string; name: string } | null;
};

export async function getBooking(id: string): Promise<BookingDetail | null> {
  const supabase = await createClient();
  const { data: booking } = await supabase.from("photo_bookings").select("*").eq("id", id).maybeSingle();
  if (!booking) return null;
  const [client, organization, service, event, gallery, documents, records, requests, audit, athlete] = await Promise.all([
    booking.client_id ? supabase.from("photo_people").select("*").eq("id", booking.client_id).maybeSingle() : null,
    booking.organization_id ? supabase.from("photo_organizations").select("*").eq("id", booking.organization_id).maybeSingle() : null,
    booking.service_id ? supabase.from("photo_services").select("*").eq("id", booking.service_id).maybeSingle() : null,
    booking.event_id ? supabase.from("photo_events").select("*").eq("id", booking.event_id).maybeSingle() : null,
    booking.gallery_id
      ? supabase.from("photo_galleries").select("*").eq("id", booking.gallery_id).maybeSingle()
      : supabase.from("photo_galleries").select("*").eq("booking_id", booking.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("photo_documents").select("*").eq("booking_id", booking.id).order("created_at", { ascending: false }),
    supabase.from("photo_payment_records").select("*").eq("booking_id", booking.id).order("paid_at", { ascending: false }),
    listStageRequests(supabase, booking.id),
    supabase.from("photo_audit_log").select("*").eq("entity", "booking").eq("entity_id", booking.id).order("created_at", { ascending: false }).limit(80),
    booking.watcher_athlete_id ? supabase.from("photo_athletes").select("id,name").eq("id", booking.watcher_athlete_id).maybeSingle() : null,
  ]);
  return {
    booking,
    client: client?.data ?? null,
    organization: organization?.data ?? null,
    service: service?.data ?? null,
    event: event?.data ?? null,
    gallery: gallery?.data ?? null,
    documents: documents.data ?? [],
    paymentRecords: records.data ?? [],
    paymentRequests: requests,
    payment: effectivePayment(booking),
    audit: audit.data ?? [],
    linkedAthlete: athlete?.data ?? null,
  };
}

/** Bookings for one CRM person, newest first (used by the person page and the client picker). */
export async function listBookingsForPerson(personId: string): Promise<BookingListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_bookings").select("*").eq("client_id", personId).order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  const events = await eventsById(supabase, rows.map((b) => b.event_id));
  return rows.map((b) => ({ ...b, client: null, event: (b.event_id && events.get(b.event_id)) || null, payment: effectivePayment(b) }));
}

export async function listBookingsForOrganization(organizationId: string): Promise<BookingListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_bookings").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  const [people, events] = await Promise.all([peopleById(supabase, rows.map((b) => b.client_id)), eventsById(supabase, rows.map((b) => b.event_id))]);
  return rows.map((b) => ({ ...b, client: (b.client_id && people.get(b.client_id)) || null, event: (b.event_id && events.get(b.event_id)) || null, payment: effectivePayment(b) }));
}

export type TeamOption = { userId: string; role: string; eventId: string };

/** People the owner can assign coverage to: collaborators on the booking's event, or on any of the owner's events. */
export async function listAssignableTeam(eventId: string | null): Promise<TeamOption[]> {
  const supabase = await createClient();
  let q = supabase.from("photo_event_members").select("user_id,role,event_id").limit(200);
  if (eventId) q = q.eq("event_id", eventId);
  const { data } = await q;
  const seen = new Set<string>();
  const out: TeamOption[] = [];
  for (const m of data ?? []) {
    if (seen.has(m.user_id)) continue;
    seen.add(m.user_id);
    out.push({ userId: m.user_id, role: m.role, eventId: m.event_id });
  }
  return out;
}

async function peopleById(supabase: Client, ids: Array<string | null>): Promise<Map<string, Pick<PhotoPersonRow, "id" | "full_name" | "email" | "phone">>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!unique.length) return new Map();
  const { data } = await supabase.from("photo_people").select("id,full_name,email,phone").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

async function eventsById(supabase: Client, ids: Array<string | null>): Promise<Map<string, Pick<PhotoEventRow, "id" | "name" | "event_date">>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!unique.length) return new Map();
  const { data } = await supabase.from("photo_events").select("id,name,event_date").in("id", unique);
  return new Map((data ?? []).map((e) => [e.id, e]));
}
