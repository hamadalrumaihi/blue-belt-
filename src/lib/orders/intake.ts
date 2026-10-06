import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "@/lib/log";
import type { Database, Json } from "@/lib/supabase/database.types";
import { orderMessage, redactRawOrder, type NormalizedOrder } from "./contract";
import { buildInvoiceDraft, invoiceNeed, invoiceTelegramLines, matchClient, type ClientMatch } from "./invoice-draft";

type Client = SupabaseClient<Database>;

export type RecordOrderOutcome = { ok: true; orderId: string; replayed: boolean } | { ok: false; error: string };

/**
 * Persists one intake order atomically with its Telegram outbox row through
 * photo_record_order (one transaction; a replay by owner + source +
 * externalRef returns the existing order and enqueues nothing). The owner id
 * comes from the authenticated credential, never from the payload.
 */
export async function recordIntakeOrder(supabase: Client, input: { ownerId: string; order: NormalizedOrder; raw: unknown; now: Date; log: Logger; appUrl?: string | null }): Promise<RecordOrderOutcome> {
  const { order, now } = input;
  // Is the buyer already a client? Only then is an invoice unnecessary. A
  // failed lookup never blocks the order; the message just says so.
  const client = await findClient(supabase, input.ownerId, order, input.log);
  const row: Record<string, Json> = {
    source: order.source,
    external_ref: order.externalRef,
    pictime_order_id: order.externalRef,
    customer_name: order.buyer.name,
    customer_email: order.buyer.email,
    customer_phone: order.buyer.phone,
    gallery_name: order.gallery.name,
    amount: order.amount.value,
    currency: order.amount.currency,
    status: "placed",
    provider: order.payment.method === "card" ? "PICTIME" : null,
    payment_method: order.payment.method,
    payment_state: order.payment.state,
    payment_reference: order.payment.reference,
    payment_reported_state: order.payment.reportedState,
    items: order.items as unknown as Json,
    placed_at: order.placedAt,
    received_at: now.toISOString(),
    buyer_note: order.notes,
    athlete_name_hint: order.athleteNameHint,
    raw: redactRawOrder(input.raw) as Json,
    metadata: { gallery_id: order.gallery.id, client_check: client.checked ? "done" : "failed", client_match: client.match } as Json,
  };
  const delivery: Record<string, Json> = {
    channel: "telegram",
    alert_key: `order:${order.source}:${order.externalRef}`,
    kind: "ORDER_PLACED",
    payload: { text: orderTelegramText(order, client, input.appUrl ?? null), category: "orders" } as Json,
  };
  const { data, error } = await supabase.rpc("photo_record_order", { p_owner_id: input.ownerId, p_order: row as Json, p_delivery: delivery as Json });
  if (error) {
    input.log.error("orders.record_failed", { error: error.message });
    return { ok: false, error: error.message };
  }
  const o = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  if (o.ok !== true || typeof o.order_id !== "string") return { ok: false, error: "photo_record_order returned an unexpected payload." };
  input.log.info(o.replayed ? "orders.replayed" : "orders.recorded", { orderId: o.order_id, method: order.payment.method, state: order.payment.state, amount: order.amount.value, currency: order.amount.currency });
  return { ok: true, orderId: o.order_id, replayed: o.replayed === true };
}

type ClientLookup = { checked: boolean; match: ClientMatch | null };

async function findClient(supabase: Client, ownerId: string, order: NormalizedOrder, log: Logger): Promise<ClientLookup> {
  if (!order.buyer.email && !order.buyer.phone) return { checked: true, match: null };
  try {
    const { data, error } = await supabase.from("photo_athletes").select("id,name,email,phone").eq("owner_id", ownerId).limit(5000);
    if (error) throw new Error(error.message);
    return { checked: true, match: matchClient(order.buyer, data ?? []) };
  } catch (err) {
    log.warn("orders.client_lookup_failed", { error: err instanceof Error ? err.message : String(err) });
    return { checked: false, match: null };
  }
}

/** The owner's [Orders] message: the order, plus who the buyer is and (for a new buyer) the invoice draft. */
export function orderTelegramText(order: NormalizedOrder, client: ClientLookup, appUrl: string | null): string {
  const base = orderMessage(order);
  const row = { payment_method: order.payment.method, payment_state: order.payment.state, status: "placed", amount: order.amount.value };
  const need = invoiceNeed(row, client.match);
  if (need.kind === "draft" && !client.checked) {
    return `${base}\nBuyer: could not check your client list — no invoice draft prepared. Check the order page.`;
  }
  const draft = need.kind === "draft"
    ? buildInvoiceDraft({ customer_name: order.buyer.name, customer_email: order.buyer.email, customer_phone: order.buyer.phone, gallery_name: order.gallery.name, external_ref: order.externalRef, amount: order.amount.value, currency: order.amount.currency, payment_method: order.payment.method, payment_state: order.payment.state, status: "placed", items: order.items })
    : null;
  const url = appUrl ? `${appUrl.replace(/\/$/, "")}/orders?ref=${encodeURIComponent(order.externalRef)}` : null;
  const extra = invoiceTelegramLines(need, draft, url);
  return extra.length ? `${base}\n${extra.join("\n")}` : base;
}
