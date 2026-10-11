import { NextResponse } from "next/server";
import { touchCredential } from "@/lib/capture/credential-store";
import { authenticateIntake } from "@/lib/capture/intake";
import { requestLogger } from "@/lib/log";
import { isOrdersIntakeEnabled } from "@/lib/orders/config";
import { parseOrderIntake } from "@/lib/orders/contract";
import { recordIntakeOrder } from "@/lib/orders/intake";
import { loadStudioContext, runOrderInvoiceJobs } from "@/lib/orders/payment-link";
import { getPaymentsConfig, isAutoInvoiceEnabled, isPaymentsEnabled } from "@/lib/payments/config";
import { createMyFatoorahClient } from "@/lib/payments/myfatoorah/client";
import { siteUrl } from "@/lib/studio/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 64 * 1024;
/** Time the intake may spend creating the invoice inline before leaving it to the cron runner. */
const KICK_BUDGET_MS = 9_000;

/**
 * POST /api/orders/intake   (JSON; Authorization: Bearer bbmo_…)
 *
 * Feature-flagged (ORDERS_INTAKE_ENABLED=1) intake for Pic-Time orders sent by
 * a Zap. Records the order with the payment situation Pic-Time reported and
 * queues the owner's [Orders] card. It is not a payment webhook: an offline
 * order ("pay the photographer directly") is "placed, payment not yet
 * confirmed" whatever the payload says. In the owner's Automatic mode an
 * eligible new order also gets its invoice job queued in the same
 * transaction and kicked right away (bounded); the payments cron is the
 * durable path for anything the kick could not finish. The owner is the
 * credential's owner; buyers never become tracked athletes.
 */
export async function POST(request: Request) {
  const { log, requestId } = requestLogger(request, "api/orders/intake");
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!isOrdersIntakeEnabled()) return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404, headers });

  const auth = await authenticateIntake(request, "api/orders/intake", requestId, log, "orders");
  if (!auth.ok) return auth.response;
  const { supabase, credential, now } = auth.ctx;

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "Body too large.", code: "TOO_LARGE" }, { status: 413, headers: auth.ctx.headers });
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Body too large.", code: "TOO_LARGE" }, { status: 413, headers: auth.ctx.headers });
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, { status: 400, headers: auth.ctx.headers });
  }
  const parsed = parseOrderIntake(raw);
  if (!parsed.ok) {
    auth.ctx.log.info("orders.rejected", { code: parsed.code });
    return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400, headers: auth.ctx.headers });
  }

  const site = siteUrl();
  const paymentsEnabled = isPaymentsEnabled();
  const studio = await loadStudioContext(supabase, credential.owner_id);
  const outcome = await recordIntakeOrder(supabase, {
    ownerId: credential.owner_id,
    order: parsed.order,
    raw,
    now,
    log: auth.ctx.log,
    siteUrl: site,
    plan: { settings: studio.invoicing, paymentsEnabled, autoEnabled: isAutoInvoiceEnabled() },
  });
  await touchCredential(supabase, credential, now);
  if (!outcome.ok) return NextResponse.json({ error: "Could not record the order.", code: "RECORD_FAILED" }, { status: 500, headers: auth.ctx.headers });

  // Automatic mode: run the queued job now (bounded). A failure here is not
  // an intake failure: the row is queued and the cron picks it up.
  let invoice: { queued: boolean; kicked: boolean; outcome?: string } = { queued: outcome.plan.kind === "auto" && !outcome.replayed, kicked: false };
  if (invoice.queued && paymentsEnabled) {
    try {
      const config = getPaymentsConfig();
      const provider = createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, timeoutMs: 8_000 });
      const s = await runOrderInvoiceJobs({ supabase, provider, now: () => new Date(), log: auth.ctx.log, siteUrl: site }, { orderId: outcome.orderId, limit: 1, budgetMs: KICK_BUDGET_MS });
      invoice = { queued: true, kicked: true, outcome: s.queued ? "queued" : s.exceptions ? "exception" : s.retried ? "retry_later" : "skipped" };
    } catch (err) {
      auth.ctx.log.warn("orders.invoice_kick_failed", { orderId: outcome.orderId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json(
    {
      ok: true,
      orderId: outcome.orderId,
      replayed: outcome.replayed,
      externalRef: parsed.order.externalRef,
      payment: { method: parsed.order.payment.method, state: parsed.order.payment.state },
      invoice: { plan: outcome.plan.kind, reason: "reason" in outcome.plan ? outcome.plan.reason : null, ...invoice },
      receivedAt: now.toISOString(),
    },
    { status: outcome.replayed ? 200 : 201, headers: auth.ctx.headers },
  );
}
