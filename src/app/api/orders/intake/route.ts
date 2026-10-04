import { NextResponse } from "next/server";
import { touchCredential } from "@/lib/capture/credential-store";
import { authenticateIntake } from "@/lib/capture/intake";
import { requestLogger } from "@/lib/log";
import { isOrdersIntakeEnabled } from "@/lib/orders/config";
import { parseOrderIntake } from "@/lib/orders/contract";
import { recordIntakeOrder } from "@/lib/orders/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 64 * 1024;

/**
 * POST /api/orders/intake   (JSON; Authorization: Bearer bbmo_…)
 *
 * Feature-flagged (ORDERS_INTAKE_ENABLED=1) intake for Pic-Time orders sent by
 * a Zap. Deliberately distinct from the payment-provider webhooks: it carries
 * no provider signature and proves nothing about money — it records that an
 * order was placed, with the payment situation Pic-Time reported, and the
 * owner's Telegram gets an [Orders] message. Fawran / bank transfer orders are
 * stored as "placed — payment not yet confirmed" whatever the payload says.
 * The owner is the credential's owner; buyers never become tracked athletes.
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

  const outcome = await recordIntakeOrder(supabase, { ownerId: credential.owner_id, order: parsed.order, raw, now, log: auth.ctx.log });
  await touchCredential(supabase, credential, now);
  if (!outcome.ok) return NextResponse.json({ error: "Could not record the order.", code: "RECORD_FAILED" }, { status: 500, headers: auth.ctx.headers });
  return NextResponse.json(
    { ok: true, orderId: outcome.orderId, replayed: outcome.replayed, externalRef: parsed.order.externalRef, payment: { method: parsed.order.payment.method, state: parsed.order.payment.state }, receivedAt: now.toISOString() },
    { status: outcome.replayed ? 200 : 201, headers: auth.ctx.headers },
  );
}
