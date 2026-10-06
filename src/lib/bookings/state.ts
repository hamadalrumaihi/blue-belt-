import type { BookingStatus, BookingType, PaymentMethod, PaymentMode, PhotoBookingRow } from "@/lib/supabase/database.types";

/**
 * Booking lifecycle (photo_bookings.booking_status). Pure: no I/O, shared by
 * server actions, the public booking flow, the client portal and tests.
 *
 *   inquiry → quoted → awaiting_contract → awaiting_payment → confirmed
 *           → in_progress → delivered → completed            (+ cancelled)
 *
 * Steps may be skipped forwards (a cash booking goes inquiry → confirmed) and
 * stepped back one stage by the owner to correct a mistake. `completed` is
 * terminal; `cancelled` can be reopened to `inquiry`.
 */
export const BOOKING_STATUSES = ["inquiry", "quoted", "awaiting_contract", "awaiting_payment", "confirmed", "in_progress", "delivered", "completed", "cancelled"] as const satisfies readonly BookingStatus[];

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  inquiry: ["quoted", "awaiting_contract", "awaiting_payment", "confirmed", "cancelled"],
  quoted: ["inquiry", "awaiting_contract", "awaiting_payment", "confirmed", "cancelled"],
  awaiting_contract: ["quoted", "awaiting_payment", "confirmed", "cancelled"],
  awaiting_payment: ["awaiting_contract", "confirmed", "cancelled"],
  confirmed: ["awaiting_payment", "in_progress", "delivered", "cancelled"],
  in_progress: ["confirmed", "delivered", "completed", "cancelled"],
  delivered: ["in_progress", "completed"],
  completed: [],
  cancelled: ["inquiry"],
};

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  inquiry: "Inquiry",
  quoted: "Quote sent",
  awaiting_contract: "Awaiting contract",
  awaiting_payment: "Awaiting payment",
  confirmed: "Confirmed",
  in_progress: "In progress",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** What the client sees. Softer wording, no internal stages. */
export const BOOKING_STATUS_CLIENT_LABEL: Record<BookingStatus, string> = {
  inquiry: "Request received",
  quoted: "Quote ready",
  awaiting_contract: "Agreement to sign",
  awaiting_payment: "Payment pending",
  confirmed: "Confirmed",
  in_progress: "Coverage in progress",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const BOOKING_TYPES = ["tournament_athlete", "club", "training_session", "private_session", "custom"] as const satisfies readonly BookingType[];

export const BOOKING_TYPE_LABEL: Record<BookingType, string> = {
  tournament_athlete: "Tournament athlete coverage",
  club: "Team / club coverage",
  training_session: "Training session",
  private_session: "Private athlete session",
  custom: "Other / custom coverage",
};

export const PAYMENT_MODES = ["instant", "link_later", "manual", "quote"] as const satisfies readonly PaymentMode[];

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  instant: "Pay now (card)",
  link_later: "Payment link sent later",
  manual: "Cash / bank transfer / Fawran",
  quote: "Custom quote first",
};

export const PAYMENT_METHODS = ["myfatoorah", "cash", "bank_transfer", "fawran", "other"] as const satisfies readonly PaymentMethod[];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  myfatoorah: "MyFatoorah",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  fawran: "Fawran",
  other: "Other",
};

export function isBookingStatus(v: unknown): v is BookingStatus {
  return typeof v === "string" && (BOOKING_STATUSES as readonly string[]).includes(v);
}
export function isBookingType(v: unknown): v is BookingType {
  return typeof v === "string" && (BOOKING_TYPES as readonly string[]).includes(v);
}
export function isPaymentMode(v: unknown): v is PaymentMode {
  return typeof v === "string" && (PAYMENT_MODES as readonly string[]).includes(v);
}
export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function isTerminalBooking(status: BookingStatus): boolean {
  return status === "completed";
}

/** Columns to write when a booking enters `to` at `now` (timestamps are set once). */
export function bookingTransitionColumns(booking: Pick<PhotoBookingRow, "quoted_at" | "confirmed_at" | "delivered_at" | "completed_at" | "cancelled_at">, to: BookingStatus, now: Date): Partial<PhotoBookingRow> {
  const iso = now.toISOString();
  const cols: Partial<PhotoBookingRow> = { booking_status: to };
  if (to === "quoted" && !booking.quoted_at) cols.quoted_at = iso;
  if (to === "confirmed" && !booking.confirmed_at) cols.confirmed_at = iso;
  if (to === "delivered" && !booking.delivered_at) cols.delivered_at = iso;
  if (to === "completed" && !booking.completed_at) cols.completed_at = iso;
  if (to === "cancelled") cols.cancelled_at = iso;
  if (to === "inquiry") {
    cols.cancelled_at = null;
    cols.cancel_reason = null;
  }
  return cols;
}

/**
 * Where a brand-new booking starts, from how it will be paid. A quote always
 * starts as an inquiry; a priced service waits for the contract when one is
 * required, otherwise for payment; a free (0 QAR) service is confirmed at once.
 */
export function initialBookingStatus(input: { paymentMode: PaymentMode; amountQr: number; requiresContract: boolean }): BookingStatus {
  if (input.paymentMode === "quote") return "inquiry";
  if (input.requiresContract) return "awaiting_contract";
  if (input.amountQr <= 0) return "confirmed";
  return "awaiting_payment";
}

export type EffectivePayment = { state: "unpaid" | "partial" | "paid" | "refunded"; source: "provider" | "manual" | "none"; paidQr: number; dueQr: number };

/**
 * One answer to "is this booking paid?". The provider status (MyFatoorah
 * webhook) wins; manual records fill in cash / bank / Fawran. Partial means
 * something was received but less than the booking amount.
 */
export function effectivePayment(b: Pick<PhotoBookingRow, "status" | "amount_qr" | "amount_paid_qr" | "manual_paid_at">): EffectivePayment {
  const amount = Number(b.amount_qr) || 0;
  if (b.status === "refunded") return { state: "refunded", source: "provider", paidQr: 0, dueQr: amount };
  if (b.status === "paid") return { state: "paid", source: "provider", paidQr: amount, dueQr: 0 };
  const paid = Number(b.amount_paid_qr) || 0;
  if (paid <= 0) return { state: "unpaid", source: "none", paidQr: 0, dueQr: amount };
  if (paid >= amount) return { state: "paid", source: "manual", paidQr: paid, dueQr: 0 };
  return { state: "partial", source: "manual", paidQr: paid, dueQr: Math.max(0, amount - paid) };
}

export const PAYMENT_STATE_LABEL: Record<EffectivePayment["state"], string> = { unpaid: "Unpaid", partial: "Partly paid", paid: "Paid", refunded: "Refunded" };

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short human reference for clients and receipts, e.g. BB-7K3PQ2. Uniqueness is enforced by the DB index; callers retry on collision. */
export function makePublicRef(random: () => number = Math.random): string {
  let out = "BB-";
  for (let i = 0; i < 6; i += 1) out += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return out;
}

export function formatQr(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-QA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} QAR`;
}

/** Typed view of photo_bookings.details (free-form per booking type). All keys optional. */
export type BookingDetails = {
  instagram?: string;
  athlete_name?: string;
  academy?: string;
  belt?: string;
  age_division?: string;
  weight_division?: string;
  gi?: "gi" | "no-gi" | "both";
  coverage?: "photo" | "video" | "both";
  source_url?: string;
  competition_date?: string;
  athlete_count?: number;
  wants_photographer?: boolean;
  wants_videographer?: boolean;
  requested_date?: string;
  requested_time?: string;
  consent_accepted_at?: string;
  booked_for?: "self" | "child" | "athlete" | "club";
};

export function bookingDetails(b: Pick<PhotoBookingRow, "details">): BookingDetails {
  const d = b.details;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as BookingDetails) : {};
}
