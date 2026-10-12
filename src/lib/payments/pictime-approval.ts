import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PhotoOrderRow } from "@/lib/supabase/database.types";
import { enqueueOwnerTelegram } from "@/lib/notifications/owner";
import { getPaymentsConfig, isSandboxPayments } from "@/lib/payments/config";
import { createMyFatoorahClient, type PaymentProvider } from "@/lib/payments/myfatoorah/client";

type Command = { orderRef: string; amountMinor: number; currency: "QAR" };
type Config = { enabled: boolean; url: string; token: string; orderRefs: string[] };
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const minor = (v: unknown): number | null => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  const cents = Math.round(n * 100);
  return Number.isFinite(n) && n > 0 && Number.isSafeInteger(cents) && Math.abs(n * 100 - cents) < 0.00001 ? cents : null;
};

/** Paid in the studio is insufficient: require the provider's exact payment evidence. */
export function approvalCommand(order: PhotoOrderRow): Command | null {
  const metadata = record(order.metadata);
  const verified = record(metadata.payment_verified);
  const ref = order.pictime_order_id ?? order.external_ref;
  const amountMinor = minor(order.amount_qr);
  if (order.payment_state !== "paid" || order.fulfilled_at || order.approved_in_pictime_at || order.provider !== "MYFATOORAH" || metadata.payment_confirmed_source !== "MYFATOORAH") return null;
  if (!ref || !/^\d{1,20}$/.test(ref) || (order.external_ref && order.external_ref !== ref)) return null;
  if (!order.provider_invoice_id || verified.invoice_id !== order.provider_invoice_id || typeof verified.payment_id !== "string" || !verified.payment_id) return null;
  if (amountMinor === null || minor(verified.amount) !== amountMinor || order.currency !== "QAR" || verified.currency !== "QAR") return null;
  return { orderRef: ref, amountMinor, currency: "QAR" };
}

function configuration(): Config {
  return {
    enabled: process.env.PICTIME_APPROVAL_ENABLED === "1",
    url: process.env.WATCHER_WORKER_URL ?? "",
    token: process.env.WATCHER_WORKER_TOKEN ?? "",
    orderRefs: (process.env.PICTIME_APPROVAL_ORDER_ALLOWLIST ?? "").split(",").map(s => s.trim()).filter(Boolean),
  };
}

/** Durable scan of verified, undelivered orders. One browser command per cron tick. */
export async function runPictimeApprovals(deps: {
  supabase: SupabaseClient<Database>;
  config?: Config;
  now?: () => Date;
  fetcher?: typeof fetch;
  provider?: Pick<PaymentProvider, "getPaymentStatus">;
}) {
  const config = deps.config ?? configuration();
  const result = { enabled: config.enabled, scanned: 0, shipped: 0, dryRun: 0, failed: 0 };
  if (!config.enabled) return result;
  if (isSandboxPayments()) throw new Error("Sandbox payments cannot release real Pic-Time orders.");
  const payments = getPaymentsConfig();
  const provider = deps.provider ?? createMyFatoorahClient({apiKey:payments.apiKey,baseUrl:payments.baseUrl,timeoutMs:5_000});
  let workerUrl: URL;
  try {
    workerUrl = new URL("/pictime/approve", config.url);
    if (workerUrl.protocol !== "https:" || workerUrl.username || workerUrl.password || !config.token || !config.orderRefs.length) throw new Error("configuration");
  } catch { throw new Error("Pic-Time approval requires an HTTPS worker, token and order allowlist."); }

  const { data, error } = await deps.supabase.from("photo_orders").select("*").eq("payment_state", "paid").eq("provider", "MYFATOORAH").is("fulfilled_at", null).is("approved_in_pictime_at", null).order("paid_at", { ascending: true }).limit(100);
  if (error) throw new Error("Cannot read orders for Pic-Time approval.");
  for (const candidate of data ?? []) {
    result.scanned++;
    const nowBefore = (deps.now ?? (() => new Date()))();
    if (candidate.approval_leased_until && Date.parse(candidate.approval_leased_until) > nowBefore.getTime()) continue;
    if (candidate.approval_next_attempt_at && Date.parse(candidate.approval_next_attempt_at) > nowBefore.getTime()) continue;
    const command = approvalCommand(candidate);
    if (!command || (!config.orderRefs.includes("*") && !config.orderRefs.includes(command.orderRef))) continue;
    // Re-read after selection so a refund/owner action does not use an old snapshot.
    const { data: fresh, error: readError } = await deps.supabase.from("photo_orders").select("*").eq("id", candidate.id).eq("owner_id", candidate.owner_id).maybeSingle();
    if (readError) throw new Error("Cannot verify the latest order payment state.");
    if (!fresh || JSON.stringify(approvalCommand(fresh)) !== JSON.stringify(command)) continue;
    if (fresh.approval_leased_until && Date.parse(fresh.approval_leased_until) > nowBefore.getTime()) continue;
    const leaseUntil = new Date(nowBefore.getTime() + 120_000).toISOString();
    let claim = deps.supabase.from("photo_orders").update({approval_leased_until:leaseUntil}).eq("id",fresh.id).eq("owner_id",fresh.owner_id).eq("payment_state","paid").eq("provider_invoice_id",fresh.provider_invoice_id!).is("fulfilled_at",null);
    claim = fresh.approval_leased_until ? claim.eq("approval_leased_until",fresh.approval_leased_until) : claim.is("approval_leased_until",null);
    const {data:claimed,error:claimError} = await claim.select("id");
    if (claimError) throw new Error("Cannot claim Pic-Time approval job.");
    if (!claimed?.length) continue;
    let body: Record<string, unknown> = {};
    try {
      // Recheck production before dispatch: stored evidence may predate a refund
      // or a change from sandbox to production configuration.
      const inquiry = await provider.getPaymentStatus({key:fresh.provider_invoice_id!,keyType:"InvoiceId"});
      const paymentId = record(record(fresh.metadata).payment_verified).payment_id;
      const transaction = inquiry.ok ? inquiry.data.transactions.find(t => t.paymentId === paymentId && /^(SUCCSS|SUCCESS)$/i.test(t.status)) : null;
      if (!inquiry.ok || inquiry.data.invoiceId !== fresh.provider_invoice_id || inquiry.data.customerReference !== fresh.id || inquiry.data.invoiceStatus.toUpperCase() !== "PAID" || minor(inquiry.data.invoiceValue) !== command.amountMinor || !transaction || minor(transaction.value) !== command.amountMinor || transaction.currency !== command.currency || inquiry.data.transactions.some(t=> /refund|disput|cancel/i.test(t.status))) throw new Error("PAYMENT_NOT_CURRENT");
      const response = await (deps.fetcher ?? fetch)(workerUrl, { method: "POST", headers: {authorization: `Bearer ${config.token}`, "content-type":"application/json"}, body: JSON.stringify(command), redirect: "error", signal: AbortSignal.timeout(32_000) });
      body = record(await response.json());
      if (!response.ok) body.ok = false;
    } catch (error) { body = {ok:false,code:error instanceof Error && error.message === "PAYMENT_NOT_CURRENT" ? "PAYMENT_NOT_CURRENT" : "WORKER_UNAVAILABLE"}; }
    const now = (deps.now ?? (() => new Date()))();
    if (body.ok === true && body.orderRef === command.orderRef && body.state === "shipped") {
      const stamp = now.toISOString();
      const { data: saved, error: saveError } = await deps.supabase.from("photo_orders").update({ approved_in_pictime_at: stamp, fulfilled_at: stamp }).eq("id", fresh.id).eq("owner_id", fresh.owner_id).eq("payment_state", "paid").eq("provider_invoice_id", fresh.provider_invoice_id!).is("fulfilled_at", null).select("id");
      if (saveError || !saved?.length) body = {ok:false,code:"DELIVERY_RECORD_NOT_SAVED"};
      else result.shipped++;
    } else if (body.ok === true && body.orderRef === command.orderRef && body.state === "dry_run") result.dryRun++;
    else body.ok = false;
    const failed = body.ok !== true;
    if (failed) result.failed++;
    const code = typeof body.code === "string" && /^[A-Z_]{1,64}$/.test(body.code) ? body.code : "APPROVAL_UNCONFIRMED";
    const {error:releaseError} = await deps.supabase.from("photo_orders").update({approval_leased_until:null,approval_next_attempt_at:failed || body.state === "dry_run" ? new Date(now.getTime()+300_000).toISOString() : null,approval_last_error:failed ? code : null}).eq("id",fresh.id).eq("owner_id",fresh.owner_id).eq("approval_leased_until",leaseUntil);
    if (releaseError) throw new Error("Cannot save Pic-Time approval job outcome.");
    await enqueueOwnerTelegram(deps.supabase, {
      ownerId: fresh.owner_id,
      kind: failed ? "INTEGRATION_FAILED" : "PAYMENT_CONFIRMED",
      alertKey: `pictime-approval:${fresh.id}:${failed ? code : body.state}`,
      title: failed ? "Photo delivery needs attention" : body.state === "dry_run" ? "Photo approval dry run matched" : "Photo order delivered",
      lines: [`Order #${command.orderRef}`, failed ? `Reason: ${code}. Verify this order in Pic-Time; delivery has not been confirmed.` : body.state === "dry_run" ? "The payment and order matched. No approval was clicked." : "Pic-Time reports Shipped to client."],
      orderId: fresh.id,
      now,
    });
    break;
  }
  return result;
}
