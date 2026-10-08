import "server-only";
import { effectivePayment, type EffectivePayment } from "@/lib/bookings/state";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus, PhotoBookingRow, PhotoPaymentRecordRow } from "@/lib/supabase/database.types";
import { dateInZone, DEFAULT_TIMEZONE, zonedToUtc } from "@/lib/time";

/**
 * The money view: every payment record (provider + manual) and what is
 * still owed on live bookings. Queries use the owner's client; the
 * summarisers are pure and unit-tested.
 */

export type LedgerKind = "provider" | "manual";
export type LedgerFilter = { kind?: LedgerKind | null; method?: PhotoPaymentRecordRow["method"] | null; limit?: number };

export type LedgerRow = PhotoPaymentRecordRow & { booking: Pick<PhotoBookingRow, "id" | "customer_name" | "public_ref" | "package_name"> | null };

export async function listPaymentRecords(filter: LedgerFilter = {}): Promise<LedgerRow[]> {
  const supabase = await createClient();
  let query = supabase.from("photo_payment_records").select("*");
  if (filter.kind) query = query.eq("kind", filter.kind);
  if (filter.method) query = query.eq("method", filter.method);
  const { data } = await query.order("paid_at", { ascending: false }).limit(filter.limit ?? 200);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.booking_id).filter((v): v is string => Boolean(v)))];
  const bookings = ids.length ? (await supabase.from("photo_bookings").select("id,customer_name,public_ref,package_name").in("id", ids)).data ?? [] : [];
  const map = new Map(bookings.map((b) => [b.id, b]));
  return rows.map((r) => ({ ...r, booking: (r.booking_id && map.get(r.booking_id)) || null }));
}

/** Lifecycle stages where money can still be owed. */
export const OUTSTANDING_STATUSES: readonly BookingStatus[] = ["awaiting_payment", "confirmed", "in_progress", "delivered"];

/** Round 3 stage columns: a booking whose provider status is "paid" (the deposit) can still owe its balance. */
type StageCols = Partial<Pick<PhotoBookingRow, "deposit_state" | "deposit_qr" | "balance_state" | "balance_qr">>;

export type OutstandingBooking = Pick<PhotoBookingRow, "id" | "customer_name" | "public_ref" | "package_name" | "booking_status" | "session_at" | "amount_qr" | "amount_paid_qr" | "status" | "manual_paid_at" | "payment_url"> & StageCols & { payment: EffectivePayment };

/** Bookings (live stages) that are unpaid or partly paid, largest balance first. */
export async function listOutstandingBookings(limit = 100): Promise<OutstandingBooking[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("photo_bookings")
    .select("id,customer_name,public_ref,package_name,booking_status,session_at,amount_qr,amount_paid_qr,status,manual_paid_at,payment_url,deposit_state,deposit_qr,balance_state,balance_qr")
    .in("booking_status", OUTSTANDING_STATUSES)
    .gt("amount_qr", 0)
    .limit(500);
  return outstandingOf(data ?? []).slice(0, limit);
}

/** Pure: keeps bookings with a balance due and attaches the effective payment, largest balance first. */
export function outstandingOf<T extends Pick<PhotoBookingRow, "status" | "amount_qr" | "amount_paid_qr" | "manual_paid_at"> & StageCols>(rows: T[]): Array<T & { payment: EffectivePayment }> {
  return rows
    .map((b) => ({ ...b, payment: effectivePayment(b) }))
    .filter((b) => b.payment.state === "unpaid" || b.payment.state === "partial")
    .sort((a, b) => b.payment.dueQr - a.payment.dueQr);
}

export type MonthRange = { start: string; end: string; label: string };

/** The calendar month containing `now` in the studio's zone, as ISO bounds [start, end). */
export function monthRange(now: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): MonthRange {
  const { year, month } = dateInZone(now, timeZone);
  const start = zonedToUtc({ year, month, day: 1, hour: 0, minute: 0 }, timeZone);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const end = zonedToUtc({ ...next, day: 1, hour: 0, minute: 0 }, timeZone);
  const label = new Intl.DateTimeFormat("en-GB", { timeZone, month: "long", year: "numeric" }).format(start);
  return { start: start.toISOString(), end: end.toISOString(), label };
}

export function inRange(iso: string | null | undefined, range: MonthRange): boolean {
  if (!iso) return false;
  return iso >= range.start && iso < range.end;
}

export type MoneySummary = { bookedQr: number; receivedQr: number; outstandingQr: number; recordCount: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pure month summary.
 *   booked      = amount of bookings confirmed (or later) whose confirmation falls in the month
 *   received    = payment records whose paid_at falls in the month (provider + manual)
 *   outstanding = balance still due on live bookings, regardless of month
 */
export function summariseMoney(
  bookings: Array<Pick<PhotoBookingRow, "booking_status" | "confirmed_at" | "amount_qr" | "status" | "amount_paid_qr" | "manual_paid_at"> & StageCols>,
  records: Array<Pick<PhotoPaymentRecordRow, "amount_qr" | "paid_at">>,
  range: MonthRange,
): MoneySummary {
  const BOOKED: readonly BookingStatus[] = ["confirmed", "in_progress", "delivered", "completed"];
  const booked = bookings.filter((b) => BOOKED.includes(b.booking_status) && inRange(b.confirmed_at, range)).reduce((s, b) => s + Number(b.amount_qr || 0), 0);
  const inMonth = records.filter((r) => inRange(r.paid_at, range));
  const received = inMonth.reduce((s, r) => s + Number(r.amount_qr || 0), 0);
  const outstanding = bookings.filter((b) => OUTSTANDING_STATUSES.includes(b.booking_status)).reduce((s, b) => s + effectivePayment(b).dueQr, 0);
  return { bookedQr: round2(booked), receivedQr: round2(received), outstandingQr: round2(outstanding), recordCount: inMonth.length };
}

export async function monthMoney(now: Date = new Date()): Promise<MoneySummary & { range: MonthRange }> {
  const supabase = await createClient();
  const range = monthRange(now);
  const [bookings, records] = await Promise.all([
    supabase.from("photo_bookings").select("booking_status,confirmed_at,amount_qr,status,amount_paid_qr,manual_paid_at,deposit_state,deposit_qr,balance_state,balance_qr").neq("booking_status", "cancelled").limit(2000),
    supabase.from("photo_payment_records").select("amount_qr,paid_at").gte("paid_at", range.start).lt("paid_at", range.end).limit(2000),
  ]);
  return { ...summariseMoney(bookings.data ?? [], records.data ?? [], range), range };
}
