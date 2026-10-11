"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { createLogger } from "@/lib/log";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { orderCardKeys, paidCard, supersededOrderKeys } from "@/lib/orders/cards";
import { parseOrderIntake } from "@/lib/orders/contract";
import { readOrderInvoicing, type InvoiceMode } from "@/lib/orders/eligibility";
import { recordIntakeOrder } from "@/lib/orders/intake";
import { checkOrderPaymentNow, fulfillOrder, loadStudioContext, resendOrderInvoiceEmail, runOrderInvoiceJobs, sendOrderInvoiceNow, type OrderServiceDeps } from "@/lib/orders/payment-link";
import { getPaymentsConfig, isAutoInvoiceEnabled, isPaymentsEnabled, isSandboxPayments } from "@/lib/payments/config";
import { createMyFatoorahClient } from "@/lib/payments/myfatoorah/client";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { requireOwner } from "@/lib/roles";
import { siteUrl } from "@/lib/studio/queries";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import { isValidEmail } from "@/lib/utils";
import { isUuid } from "@/lib/validation";

/**
 * Owner-only order actions. Bookkeeping (confirm an offline payment, mark
 * fulfilled, cancel) runs through the user client (RLS). The invoice actions
 * run the SAME shared services as the Telegram buttons and the cron, through
 * the service client after the owner check, so Telegram and the dashboard can
 * never disagree about what happened.
 */
export type OrderActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function owner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function revalidate(orderId: string) {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

/** Confirms that an offline payment (Fawran / bank transfer / cash) was received. */
export async function confirmOrderPayment(orderId: string, note?: string | null): Promise<OrderActionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Invalid order." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: order } = await supabase.from("photo_orders").select("*").eq("id", orderId).eq("owner_id", user.id).maybeSingle();
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
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "order", entityId: orderId, action: "order.payment_confirmed_manually", data: { amount_qr: order.amount_qr, currency: order.currency } });
  // The Telegram cards for this order lose their payment buttons.
  const card = paidCard({ ...order, payment_state: "paid" }, siteUrl(), { amountText: `${Number(order.amount_qr).toFixed(2)} ${order.currency}`, source: "owner" });
  await enqueueOwnerTelegram(supabase, { ownerId: user.id, kind: "PAYMENT_CONFIRMED", alertKey: orderCardKeys.paid(order), html: card.text, buttons: card.buttons, orderId: order.id, supersedes: supersededOrderKeys(order) });
  revalidate(orderId);
  return { ok: true };
}

/** Marks the order delivered (photos released in the gallery) or undoes it. */
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
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "order", entityId: orderId, action: fulfilled ? "order.fulfilled" : "order.fulfilled_undone", data: { via: "dashboard" } });
  revalidate(orderId);
  return { ok: true };
}

export async function cancelOrder(orderId: string): Promise<OrderActionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Invalid order." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data, error } = await supabase.from("photo_orders").update({ status: "cancelled" }).eq("id", orderId).eq("owner_id", user.id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Order not found." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, entity: "order", entityId: orderId, action: "order.cancelled", data: {} });
  revalidate(orderId);
  return { ok: true };
}

/**
 * The owner's own record that they sent the invoice text to the buyer by
 * hand (WhatsApp, their own e-mail). Stored on the order's metadata; nothing
 * is sent from here.
 */
export async function markInvoiceSent(orderId: string, sent = true): Promise<OrderActionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Invalid order." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: order } = await supabase.from("photo_orders").select("id,metadata").eq("id", orderId).eq("owner_id", user.id).maybeSingle();
  if (!order) return { ok: false, error: "Order not found." };
  const metadata = order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata) ? (order.metadata as Record<string, unknown>) : {};
  const { error } = await supabase
    .from("photo_orders")
    .update({ metadata: { ...metadata, invoice_sent_at: sent ? new Date().toISOString() : null } })
    .eq("id", orderId)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidate(orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Invoice workflow (shared services; owner-gated; service client)
// ---------------------------------------------------------------------------

type Gate = { ok: true; deps: OrderServiceDeps; userId: string } | { ok: false; error: string };

async function gate(orderId: string): Promise<Gate> {
  if (!isUuid(orderId)) return { ok: false, error: "Invalid order." };
  const who = await requireOwner();
  if (!who.ok) return { ok: false, error: who.error };
  const limit = rateLimit(`order-action:${who.viewer.userId}`, RULES.providerActionPerUser);
  if (!limit.ok) return { ok: false, error: `Too many actions. Wait ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
  if (!isServiceClientConfigured()) return { ok: false, error: "The server is not configured for this (service role key missing)." };
  const supabase = createServiceClient();
  // Ownership: the service client sees every order, so the owner check is explicit.
  const { data } = await supabase.from("photo_orders").select("owner_id").eq("id", orderId).maybeSingle();
  if (!data || data.owner_id !== who.viewer.userId) return { ok: false, error: "Order not found." };
  const enabled = isPaymentsEnabled();
  const config = getPaymentsConfig();
  return {
    ok: true,
    userId: who.viewer.userId,
    deps: { supabase, provider: enabled ? createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl }) : null, now: () => new Date(), log: createLogger({ route: "actions/orders", orderId }), siteUrl: siteUrl() },
  };
}

/** Creates the private payment link and provider invoice (once) and queues the customer e-mail. */
export async function sendOrderInvoice(orderId: string): Promise<OrderActionResult> {
  const g = await gate(orderId);
  if (!g.ok) return g;
  if (!g.deps.provider) return { ok: false, error: "Online payments are not configured on the server, so no payment link can be created." };
  const res = await sendOrderInvoiceNow(g.deps, orderId, { kind: "owner", userId: g.userId });
  revalidate(orderId);
  return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error };
}

/** Another e-mail with the same link; never a second invoice. */
export async function resendOrderInvoice(orderId: string): Promise<OrderActionResult> {
  const g = await gate(orderId);
  if (!g.ok) return g;
  const res = await resendOrderInvoiceEmail(g.deps, orderId, { kind: "owner", userId: g.userId });
  revalidate(orderId);
  return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error };
}

/** Asks the payment provider about the order's invoice and applies the verified result. */
export async function checkOrderPayment(orderId: string): Promise<OrderActionResult> {
  const g = await gate(orderId);
  if (!g.ok) return g;
  const res = await checkOrderPaymentNow(g.deps, orderId, { kind: "owner", userId: g.userId });
  revalidate(orderId);
  return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error };
}

/** "Done" from the dashboard, through the same service as the Telegram button. */
export async function markOrderDone(orderId: string): Promise<OrderActionResult> {
  const g = await gate(orderId);
  if (!g.ok) return g;
  const res = await fulfillOrder(g.deps, orderId, { kind: "owner", userId: g.userId });
  revalidate(orderId);
  return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error };
}

/**
 * Legacy owner button kept for orders invoiced before the workflow existed:
 * now the same thing as Send invoice.
 */
export async function requestOrderInvoice(orderId: string): Promise<{ ok: true; paymentUrl: string | null; alreadyInvoiced?: boolean } | { ok: false; error: string }> {
  const res = await sendOrderInvoice(orderId);
  if (!res.ok) return res;
  const supabase = await createClient();
  const { data } = await supabase.from("photo_orders").select("payment_url,provider_invoice_id").eq("id", orderId).maybeSingle();
  return { ok: true, paymentUrl: data?.payment_url ?? null, alreadyInvoiced: Boolean(data?.provider_invoice_id) };
}

// ---------------------------------------------------------------------------
// Settings: invoicing mode and controlled test orders
// ---------------------------------------------------------------------------

/**
 * Automatic / Review. Switching to Automatic stamps the activation time:
 * only orders that arrive AFTER it are ever billed without a click, so
 * history (and anything that came in while in Review) stays manual.
 */
export async function setOrderInvoicingMode(mode: InvoiceMode): Promise<OrderActionResult> {
  if (mode !== "auto" && mode !== "review") return { ok: false, error: "Unknown mode." };
  const who = await requireOwner();
  if (!who.ok) return { ok: false, error: who.error };
  const supabase = await createClient();
  const { data: current } = await supabase.from("photo_studio").select("settings,business_name").eq("owner_id", who.viewer.userId).maybeSingle();
  const previous = current?.settings && typeof current.settings === "object" && !Array.isArray(current.settings) ? (current.settings as Record<string, Json | undefined>) : {};
  const before = readOrderInvoicing(current?.settings ?? null);
  const now = new Date().toISOString();
  const orderInvoicing = { mode, autoSince: mode === "auto" ? now : before.autoSince, changedAt: now };
  const settings = { ...previous, orderInvoicing } as Json;
  const { error } = current
    ? await supabase.from("photo_studio").update({ settings }).eq("owner_id", who.viewer.userId)
    : await supabase.from("photo_studio").upsert({ owner_id: who.viewer.userId, business_name: "Blue Belt Media", settings }, { onConflict: "owner_id" });
  if (error) return { ok: false, error: error.message };
  await writeAudit(supabase, { ownerId: who.viewer.userId, actorId: who.viewer.userId, entity: "studio", entityId: who.viewer.userId, action: "orders.invoicing_mode", data: { mode, auto_since: orderInvoicing.autoSince } });
  revalidatePath("/settings");
  revalidatePath("/orders");
  return { ok: true, message: mode === "auto" ? `Automatic mode on. Orders received from now (${now}) get their payment link automatically.` : "Review mode on. New orders wait for Send invoice." };
}

/**
 * A controlled test order for the owner: goes through the real intake,
 * invoice, e-mail and Telegram path with a recipient the owner typed. Only
 * allowed against the payment sandbox (or with ORDERS_TEST_ORDERS_ENABLED=1),
 * never silently against live keys; the source is "test", never "pictime".
 */
export async function createTestOrder(input: { email: string; amount: number; name?: string | null }): Promise<OrderActionResult & { orderId?: string }> {
  const who = await requireOwner();
  if (!who.ok) return { ok: false, error: who.error };
  if (!isSandboxPayments() && process.env.ORDERS_TEST_ORDERS_ENABLED !== "1") return { ok: false, error: "Test orders are allowed only against the payment sandbox (or with ORDERS_TEST_ORDERS_ENABLED=1)." };
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false, error: "Enter the test recipient's e-mail address." };
  const amount = Number(input.amount);
  if (!(amount > 0 && amount <= 1000)) return { ok: false, error: "Amount must be between 0.01 and 1000." };
  if (!isServiceClientConfigured()) return { ok: false, error: "The server is not configured for this (service role key missing)." };
  const limit = rateLimit(`order-test:${who.viewer.userId}`, RULES.providerActionPerUser);
  if (!limit.ok) return { ok: false, error: `Too many test orders. Wait ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };

  const supabase = createServiceClient();
  const now = new Date();
  const ref = `TEST-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const parsed = parseOrderIntake({ externalRef: ref, buyerName: (input.name ?? "").trim() || "Test Buyer", buyerEmail: email, total: amount, currency: "QAR", paymentMethod: "photographer", paymentStatus: "approved", galleryName: "Test gallery", items: [{ name: "Test photo download", quantity: 1, unitAmount: amount }] });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const studio = await loadStudioContext(supabase, who.viewer.userId);
  const log = createLogger({ route: "actions/orders-test" });
  const site = siteUrl();
  const outcome = await recordIntakeOrder(supabase, { ownerId: who.viewer.userId, order: parsed.order, raw: { test: true }, now, log, siteUrl: site, source: "test", plan: { settings: studio.invoicing, paymentsEnabled: isPaymentsEnabled(), autoEnabled: isAutoInvoiceEnabled() } });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  await writeAudit(supabase, { ownerId: who.viewer.userId, actorId: who.viewer.userId, entity: "order", entityId: outcome.orderId, action: "order.test_created", data: { amount_qr: amount, plan: outcome.plan.kind } });
  let note = `Test order ${ref} recorded (${outcome.plan.kind === "auto" ? "automatic mode: invoice queued" : "review mode: press Send invoice on the order"}).`;
  if (outcome.plan.kind === "auto" && isPaymentsEnabled()) {
    const config = getPaymentsConfig();
    const provider = createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const s = await runOrderInvoiceJobs({ supabase, provider, now: () => new Date(), log, siteUrl: site }, { orderId: outcome.orderId, limit: 1, budgetMs: 15_000 });
    note += s.queued ? " Payment link created and e-mail queued." : s.exceptions ? " The job ended in an exception; see the order." : s.retried ? " The payment service did not answer; the cron will retry." : "";
  }
  revalidatePath("/orders");
  return { ok: true, message: note, orderId: outcome.orderId };
}
