import "server-only";
import type { PhotoOrderRow } from "@/lib/supabase/database.types";
import type { ClientCandidate } from "./invoice-draft";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner-only reads of photo_orders through the user's client (RLS: owner_id =
 * auth.uid()). Collaborators have no policy on this table and never reach
 * these pages' data; see supabase/tests/orders_rls.test.sql.
 */
export type OrderFilter = "all" | "needs_confirmation" | "paid" | "fulfilled";

export async function listOrders(filter: OrderFilter = "all", limit = 100): Promise<PhotoOrderRow[]> {
  const supabase = await createClient();
  let query = supabase.from("photo_orders").select("*").order("received_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(limit);
  // Includes `failed`: those orders are highlighted in the list and need owner
  // attention (retry / confirm), so they belong under this filter and its count.
  if (filter === "needs_confirmation") query = query.in("payment_state", ["pending", "unknown", "failed"]).neq("status", "cancelled");
  if (filter === "paid") query = query.eq("payment_state", "paid");
  if (filter === "fulfilled") query = query.eq("status", "fulfilled");
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getOrder(id: string): Promise<PhotoOrderRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_orders").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export async function orderCounts(): Promise<{ total: number; needsConfirmation: number }> {
  const supabase = await createClient();
  const [{ count: total }, { count: needs }] = await Promise.all([
    supabase.from("photo_orders").select("id", { count: "exact", head: true }),
    supabase.from("photo_orders").select("id", { count: "exact", head: true }).in("payment_state", ["pending", "unknown", "failed"]).neq("status", "cancelled"),
  ]);
  return { total: total ?? 0, needsConfirmation: needs ?? 0 };
}

/** The owner's own clients' contact details, to tell a new buyer from an existing client. */
export async function listClientContacts(): Promise<ClientCandidate[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase.from("photo_athletes").select("id,name,email,phone").eq("owner_id", user.id).limit(5000);
  return data ?? [];
}

/** Resolves a Pic-Time order reference (from a Telegram link) to the order id. */
export async function findOrderIdByRef(ref: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_orders").select("id").eq("external_ref", ref.slice(0, 120)).order("created_at", { ascending: false }).limit(1);
  return data?.[0]?.id ?? null;
}
