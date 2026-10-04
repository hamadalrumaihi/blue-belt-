/**
 * Booking / payment state machine.
 *
 * `photo_bookings.status` is the single source of truth for whether a booking
 * is paid. Every writer (webhook, reconciliation, manual admin action) must go
 * through `canTransition` / `applyTransition` so the timestamps stay
 * consistent and illegal jumps (e.g. refunded -> paid) are rejected rather
 * than silently applied.
 *
 *   pending   -> paid | failed | cancelled
 *   paid      -> refunded | disputed
 *   disputed  -> refunded | paid
 *   failed    -> pending | paid | cancelled   (the customer retries the same invoice;
 *                                             MyFatoorah then sends SUCCESS directly)
 *   refunded, cancelled           (terminal)
 *
 * A late FAILED after paid (out-of-order delivery of an earlier attempt) is an
 * illegal transition and is ignored: paid never regresses to failed.
 *
 * Self-transitions are never allowed; callers treat "same status" as a no-op.
 */
import type { PaymentStatus } from "@/lib/supabase/database.types";

export type { PaymentStatus };

export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["pending", "paid", "failed", "refunded", "disputed", "cancelled"];

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  pending: ["paid", "failed", "cancelled"],
  paid: ["refunded", "disputed"],
  disputed: ["refunded", "paid"],
  failed: ["pending", "paid", "cancelled"],
  refunded: [],
  cancelled: [],
};

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[status].length === 0;
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Columns of `photo_bookings` touched by a status transition. */
export type BookingTransitionColumns = {
  status: PaymentStatus;
  payment_status_updated_at: string;
  paid_at?: string | null;
  refunded_at?: string | null;
  disputed_at?: string | null;
};

export type TransitionResult = { ok: true; columns: BookingTransitionColumns } | { ok: false; reason: "same_status" | "illegal_transition" };

/**
 * Returns the booking columns to write for `from -> to` at time `now`, or a
 * typed refusal. It never mutates anything; the caller persists the columns.
 *
 * Timestamp rules:
 *  - entering `paid` sets `paid_at` (kept when a dispute is later resolved
 *    back to `paid`: the original payment moment is still the truth);
 *  - entering `refunded` sets `refunded_at`;
 *  - entering `disputed` sets `disputed_at`;
 *  - `failed -> pending` (retry) clears nothing; nothing was ever set.
 */
export function applyTransition(from: PaymentStatus, to: PaymentStatus, now: Date, current?: { paid_at?: string | null }): TransitionResult {
  if (from === to) return { ok: false, reason: "same_status" };
  if (!canTransition(from, to)) return { ok: false, reason: "illegal_transition" };
  const at = now.toISOString();
  const columns: BookingTransitionColumns = { status: to, payment_status_updated_at: at };
  if (to === "paid" && !current?.paid_at) columns.paid_at = at;
  if (to === "refunded") columns.refunded_at = at;
  if (to === "disputed") columns.disputed_at = at;
  return { ok: true, columns };
}
