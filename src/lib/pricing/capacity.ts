import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingStatus, Database } from "@/lib/supabase/database.types";
import type { CapacityCheck } from "./engine/types";

/**
 * Other bookings of the same owner on the same calendar day (Qatar wall
 * clock). Confirmed / in-progress bookings are conflicts; bookings still
 * waiting on an agreement or a deposit are tentative. The engine only sees
 * ids, public refs and statuses: no customer data enters a snapshot.
 */
const CONFIRMED: readonly BookingStatus[] = ["confirmed", "in_progress"];
const TENTATIVE: readonly BookingStatus[] = ["awaiting_contract", "awaiting_payment"];

export async function findCapacityConflicts(supabase: SupabaseClient<Database>, ownerId: string, date: string | null, excludeBookingId: string | null): Promise<CapacityCheck> {
  if (!date) return { date: null, conflicts: [], tentative: [] };
  // The day in Qatar (UTC+3, no DST) as a UTC window.
  const start = new Date(`${date}T00:00:00+03:00`).toISOString();
  const end = new Date(`${date}T23:59:59+03:00`).toISOString();
  const { data } = await supabase
    .from("photo_bookings")
    .select("id,public_ref,booking_status,session_at")
    .eq("owner_id", ownerId)
    .in("booking_status", [...CONFIRMED, ...TENTATIVE])
    .gte("session_at", start)
    .lte("session_at", end)
    .limit(50);
  const rows = (data ?? []).filter((b) => b.id !== excludeBookingId);
  const map = (b: (typeof rows)[number]) => ({ bookingId: b.id, publicRef: b.public_ref, status: b.booking_status, sessionAt: b.session_at });
  return {
    date,
    conflicts: rows.filter((b) => CONFIRMED.includes(b.booking_status)).map(map),
    tentative: rows.filter((b) => TENTATIVE.includes(b.booking_status)).map(map),
  };
}
