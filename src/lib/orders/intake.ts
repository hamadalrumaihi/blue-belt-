import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "@/lib/log";
import type { Database, Json } from "@/lib/supabase/database.types";
import { placedCard, type CardOrder } from "./cards";
import { type NormalizedOrder, redactRawOrder } from "./contract";
import { planInvoice, type InvoicePlan, type PlanContext } from "./eligibility";
import { matchClient, type ClientMatch } from "./invoice-draft";

type Client = SupabaseClient<Database>;

export type RecordOrderOutcome = { ok: true; orderId: string; replayed: boolean; plan: InvoicePlan } | { ok: false; error: string };

export type RecordOrderInput = {
  ownerId: string;
  order: NormalizedOrder;
  raw: unknown;
  now: Date;
  log: Logger;
  /** Public site origin for the "View order" button. */
  siteUrl: string;
  /** Owner's invoicing mode and server flags; decides whether the invoice job is queued in the same transaction. */
  plan: PlanContext;
  /** Overrides the source (e.g. "test" for an owner's controlled test order). */
  source?: string;
};

/**
 * Persists one intake order atomically with its [Orders] Telegram card and,
 * in automatic mode, the queued invoice job, through photo_record_order (one
 * transaction; a replay by owner + source + externalRef returns the existing
 * order and enqueues nothing). The owner id comes from the authenticated
 * credential, never from the payload. The order id is minted here so the
 * card's buttons can name it.
 */
export async function recordIntakeOrder(supabase: Client, input: RecordOrderInput): Promise<RecordOrderOutcome> {
  const { order, now } = input;
  const id = randomUUID();
  const source = input.source ?? order.source;
  const client = await findClient(supabase, input.ownerId, order, input.log);
  const candidate = {
    id,
    owner_id: input.ownerId,
    source,
    external_ref: order.externalRef,
    pictime_order_id: order.externalRef,
    customer_name: order.buyer.name,
    customer_email: order.buyer.email,
    gallery_name: order.gallery.name,
    amount_qr: order.amount.value,
    currency: order.amount.currency,
    status: "placed",
    payment_method: order.payment.method,
    payment_state: order.payment.state,
    provider_invoice_id: null,
    payment_url: null,
    fulfilled_at: null,
    received_at: now.toISOString(),
    created_at: now.toISOString(),
    invoice_requested_at: null,
    invoice_completed_at: null,
    invoice_exception: null,
    invoice_email_state: "none",
    invoice_email_count: 0,
  };
  const plan = planInvoice(candidate, input.plan);
  const cardOrder: CardOrder = {
    ...candidate,
    invoice_requested_at: plan.kind === "auto" ? now.toISOString() : null,
    invoice_exception: plan.kind === "exception" ? plan.reason : null,
  };
  const row: Record<string, Json> = {
    id,
    source,
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
    metadata: { gallery_id: order.gallery.id, client_check: client.checked ? "done" : "failed", client_match: client.match, invoice_plan: plan } as Json,
    invoice_requested_at: plan.kind === "auto" ? now.toISOString() : null,
    invoice_requested_by: plan.kind === "auto" ? "auto" : null,
    invoice_exception: plan.kind === "exception" ? plan.reason : null,
  };
  const card = placedCard(cardOrder, plan, input.siteUrl);
  const delivery: Record<string, Json> = {
    channel: "telegram",
    alert_key: `order:${source}:${order.externalRef}`,
    kind: "ORDER_PLACED",
    payload: { text: card.text, category: "orders", buttons: card.buttons as unknown as Json, order_id: id } as Json,
  };
  const { data, error } = await supabase.rpc("photo_record_order", { p_owner_id: input.ownerId, p_order: row as Json, p_delivery: delivery as Json });
  if (error) {
    input.log.error("orders.record_failed", { error: error.message });
    return { ok: false, error: error.message };
  }
  const o = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  if (o.ok !== true || typeof o.order_id !== "string") return { ok: false, error: "photo_record_order returned an unexpected payload." };
  const replayed = o.replayed === true;
  input.log.info(replayed ? "orders.replayed" : "orders.recorded", { orderId: o.order_id, method: order.payment.method, state: order.payment.state, amount: order.amount.value, currency: order.amount.currency, plan: plan.kind, planReason: "reason" in plan ? plan.reason : undefined });
  return { ok: true, orderId: o.order_id, replayed, plan };
}

type ClientLookup = { checked: boolean; match: ClientMatch | null };

/** Is the buyer already a tracked client? Informational only (the order page shows it); a failed lookup never blocks the order. */
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
