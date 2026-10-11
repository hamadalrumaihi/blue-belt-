import "server-only";
import type { PhotoOrderRow } from "@/lib/supabase/database.types";
import type { ClientCandidate } from "./invoice-draft";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner-only reads of photo_orders through the user's client (RLS: owner_id =
 * auth.uid()). Collaborators have no policy on this table and never reach
 * these pages' data; see supabase/tests/orders_rls.test.sql.
 */
export type OrderFilter = "all" | "needs_confirmation" | "attention" | "paid" | "fulfilled";

export async function listOrders(filter: OrderFilter = "all", limit = 100): Promise<PhotoOrderRow[]> {
  const supabase = await createClient();
  let query = supabase.from("photo_orders").select("*").order("received_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(limit);
  // Includes `failed`: those orders are highlighted in the list and need owner
  // attention (retry / confirm), so they belong under this filter and its count.
  if (filter === "needs_confirmation") query = query.in("payment_state", ["pending", "unknown", "failed"]).neq("status", "cancelled");
  // Unpaid orders whose payment link did not go out: exception, e-mail failed, or never requested.
  if (filter === "attention") query = query.in("payment_state", ["pending", "unknown", "failed"]).neq("status", "cancelled").gt("amount_qr", 0).neq("payment_method", "card").or("invoice_exception.not.is.null,invoice_email_state.in.(failed,exception),and(invoice_requested_at.is.null,invoice_email_state.eq.none)");
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

export type OrderQueueOverview = { waiting: number; oldestWaitingAt: string | null; exceptions: number; emailFailed: number };

/** Invoice backlog for the Orders page header (owner's rows only, via RLS). */
export async function orderQueueOverview(): Promise<OrderQueueOverview> {
  const supabase = await createClient();
  const live = supabase.from("photo_orders").select("id", { count: "exact", head: true }).neq("status", "cancelled").in("payment_state", ["pending", "unknown", "failed"]);
  const [waiting, exceptions, failed] = await Promise.all([
    supabase.from("photo_orders").select("invoice_requested_at").not("invoice_requested_at", "is", null).is("invoice_completed_at", null).order("invoice_requested_at", { ascending: true }).limit(200),
    live.not("invoice_exception", "is", null),
    supabase.from("photo_orders").select("id", { count: "exact", head: true }).neq("status", "cancelled").in("payment_state", ["pending", "unknown", "failed"]).eq("invoice_email_state", "failed"),
  ]);
  const rows = waiting.data ?? [];
  return { waiting: rows.length, oldestWaitingAt: rows[0]?.invoice_requested_at ?? null, exceptions: exceptions.count ?? 0, emailFailed: failed.count ?? 0 };
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
