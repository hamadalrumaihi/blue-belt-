"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

/**
 * Owner-only order actions (user client, RLS). These change the owner's own
 * bookkeeping of an order — whether an offline payment was received, whether
 * it was fulfilled — and never touch prices, amounts or tracked athletes.
 */
export type OrderActionResult = { ok: true } | { ok: false; error: string };

async function owner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Confirms that an offline payment (Fawran / bank transfer / cash) was received. */
export async function confirmOrderPayment(orderId: string, note?: string | null): Promise<OrderActionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Invalid order." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: order } = await supabase.from("photo_orders").select("id,payment_state,status,metadata").eq("id", orderId).eq("owner_id", user.id).maybeSingle();
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status === "cancelled") return { ok: false, error: "This order is cancelled." };
  if (order.payment_state === "paid") return { ok: true };
  const now = new Date().toISOString();
  const metadata = order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata) ? (order.metadata as Record<string, unknown>) : {};
  const { error } = await supabase
    .from("photo_orders")
    .update({ payment_state: "paid", paid_at: now, payment_confirmed_at: now, payment_confirmed_by: user.id, metadata: { ...metadata, payment_confirmation_note: (note ?? "").trim().slice(0, 200) || null } })
    .eq("id", orderId)
    .eq("owner_id", user.id)
    .neq("payment_state", "paid");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

/** Marks the order delivered (photos sent / approved in Pic-Time). */
export async function markOrderFulfilled(orderId: string, fulfilled = true): Promise<OrderActionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Invalid order." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("photo_orders")
    .update(fulfilled ? { status: "fulfilled", fulfilled_at: now } : { status: "placed", fulfilled_at: null })
    .eq("id", orderId)
    .eq("owner_id", user.id)
    .neq("status", "cancelled")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Order not found or cancelled." };
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

export async function cancelOrder(orderId: string): Promise<OrderActionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Invalid order." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data, error } = await supabase.from("photo_orders").update({ status: "cancelled" }).eq("id", orderId).eq("owner_id", user.id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Order not found." };
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
