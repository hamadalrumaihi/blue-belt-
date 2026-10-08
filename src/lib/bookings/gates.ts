import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PhotoBookingRow } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Confirmation gates (round 3 policy): a booking is confirmed only when the
 * required agreement(s) are signed AND the 50% deposit is paid. The final
 * 50% never blocks confirmation; it becomes due after delivery.
 *
 * Pure helpers here are shared by the booking actions, the payment webhook,
 * the signing service and the client portal, so every surface agrees on
 * what "blocked" means. Writes happen only in `recomputeBookingGates`.
 */
export type GateBooking = Pick<
  PhotoBookingRow,
  "booking_status" | "requires_contract" | "requires_guardian_release" | "contract_state" | "deposit_state" | "balance_state" | "amount_qr" | "subject_is_minor"
>;

export type BookingBlocker =
  | { code: "contract_unsigned"; message: string }
  | { code: "guardian_release_unsigned"; message: string }
  | { code: "deposit_unpaid"; message: string }
  | { code: "price_not_set"; message: string };

export const BLOCKER_MESSAGE: Record<BookingBlocker["code"], string> = {
  contract_unsigned: "Blocked because the agreement has not been signed.",
  guardian_release_unsigned: "Blocked because the parent or guardian release has not been signed.",
  deposit_unpaid: "Blocked because the 50% deposit has not been paid.",
  price_not_set: "Blocked because the price has not been set.",
};

export function contractSatisfied(b: GateBooking): boolean {
  if (!b.requires_contract) return true;
  return b.contract_state === "signed" || b.contract_state === "not_required";
}

export function depositSatisfied(b: GateBooking): boolean {
  return b.deposit_state === "paid" || b.deposit_state === "not_required" || b.deposit_state === "waived";
}

/**
 * Everything that still stops this booking from being confirmed, in the
 * order the owner should resolve it. Empty means "ready to confirm".
 * The guardian release is tracked by the signing service through
 * `requires_guardian_release` + the guardian document; until that document
 * is signed the contract_state stays below "signed".
 */
export function confirmationBlockers(b: GateBooking): BookingBlocker[] {
  const out: BookingBlocker[] = [];
  if (Number(b.amount_qr) <= 0 && b.deposit_state === "pending") out.push({ code: "price_not_set", message: BLOCKER_MESSAGE.price_not_set });
  if (!contractSatisfied(b)) {
    out.push(
      b.requires_guardian_release && b.subject_is_minor
        ? { code: "guardian_release_unsigned", message: BLOCKER_MESSAGE.guardian_release_unsigned }
        : { code: "contract_unsigned", message: BLOCKER_MESSAGE.contract_unsigned },
    );
  }
  if (!depositSatisfied(b)) out.push({ code: "deposit_unpaid", message: BLOCKER_MESSAGE.deposit_unpaid });
  return out;
}

const PRE_CONFIRMATION = ["inquiry", "quoted", "awaiting_contract", "awaiting_payment"] as const;

/** The lifecycle stage a pre-confirmation booking should sit in given its gates. */
export function gatedBookingStatus(b: GateBooking): PhotoBookingRow["booking_status"] | null {
  if (!(PRE_CONFIRMATION as readonly string[]).includes(b.booking_status)) return null;
  const blockers = confirmationBlockers(b);
  if (blockers.length === 0) return "confirmed";
  if (blockers.some((x) => x.code === "price_not_set")) return b.booking_status === "inquiry" ? "inquiry" : "quoted";
  if (blockers.some((x) => x.code === "contract_unsigned" || x.code === "guardian_release_unsigned")) return "awaiting_contract";
  return "awaiting_payment";
}

/**
 * Re-reads the booking and moves it to the stage its gates allow. Called
 * after a deposit is confirmed by the provider, after an agreement is
 * signed, and after the owner changes contract or deposit requirements.
 * Never touches `status` (provider payment status) and never moves a
 * booking that is already confirmed or later.
 */
export async function recomputeBookingGates(supabase: Client, bookingId: string, now: Date = new Date()): Promise<{ ok: boolean; moved: boolean; to: PhotoBookingRow["booking_status"] | null; confirmed: boolean }> {
  const { data: booking } = await supabase.from("photo_bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!booking) return { ok: false, moved: false, to: null, confirmed: false };
  const target = gatedBookingStatus(booking);
  if (!target || target === booking.booking_status) return { ok: true, moved: false, to: target, confirmed: booking.booking_status === "confirmed" };
  const patch: Partial<PhotoBookingRow> = { booking_status: target };
  if (target === "confirmed" && !booking.confirmed_at) patch.confirmed_at = now.toISOString();
  if (target === "quoted" && !booking.quoted_at) patch.quoted_at = now.toISOString();
  const { error } = await supabase.from("photo_bookings").update(patch).eq("id", bookingId).eq("booking_status", booking.booking_status);
  if (error) return { ok: false, moved: false, to: target, confirmed: false };
  return { ok: true, moved: true, to: target, confirmed: target === "confirmed" };
}
