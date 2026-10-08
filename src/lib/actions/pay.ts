"use server";

import { headers } from "next/headers";
import { createLogger } from "@/lib/log";
import { cardViewScriptUrl, getPaymentsConfig, isPaymentsEnabled } from "@/lib/payments/config";
import { createMyFatoorahClient } from "@/lib/payments/myfatoorah/client";
import { executeCardPayment as executeCardPaymentService, startCardSession as startCardSessionService, startHostedPayment as startHostedPaymentService, type PayActionError, type PayPageDeps } from "@/lib/payments/pay-page";
import { isPayTokenShape } from "@/lib/payments/pay-token";
import { rateLimit, RULES } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/studio/queries";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

/**
 * Server actions behind the public pay page. No session: the token in the
 * URL is the credential, every call is rate limited per client address, and
 * the amount is never read from the browser (see src/lib/payments/pay-page.ts).
 */

export type PaySessionState = { ok: true; sessionId: string; countryCode: string; scriptUrl: string } | { ok: false; error: string };
export type PayRedirectState = { ok: true; redirectUrl: string } | { ok: false; error: string };

const MESSAGES: Record<PayActionError, string> = {
  not_found: "This payment link is not valid.",
  expired: "This payment link has expired. Ask the studio for a new one.",
  not_payable: "This payment cannot be taken online right now. The page will show the current state when you reload it.",
  payments_off: "Online payment is being set up. We will send you the link when it is ready.",
  provider_error: "The payment service did not answer. Please try again in a moment.",
  conflict: "This payment changed while you were paying. Reload the page and try again.",
  invalid: "Something was missing from the request. Reload the page and try again.",
};

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

async function gate(token: unknown): Promise<{ ok: true; deps: PayPageDeps; token: string } | { ok: false; error: string }> {
  if (!isPayTokenShape(token)) return { ok: false, error: MESSAGES.not_found };
  const ip = await clientIp();
  const limit = rateLimit(`pay:${ip}`, RULES.signPerIp);
  if (!limit.ok) return { ok: false, error: `Too many attempts. Please wait ${Math.ceil(limit.retryAfterSeconds / 60)} minutes and try again.` };
  if (!isServiceClientConfigured()) return { ok: false, error: MESSAGES.provider_error };
  const enabled = isPaymentsEnabled();
  const config = getPaymentsConfig();
  return {
    ok: true,
    token,
    deps: {
      supabase: createServiceClient(),
      now: () => new Date(),
      log: createLogger({ route: "actions/pay" }),
      provider: enabled ? createMyFatoorahClient({ apiKey: config.apiKey, baseUrl: config.baseUrl }) : null,
      enabled,
      siteUrl: siteUrl(),
      scriptUrl: cardViewScriptUrl(config.baseUrl),
    },
  };
}

/** Opens a MyFatoorah card-view session for the payment request behind the token. */
export async function startCardSession(token: string): Promise<PaySessionState> {
  const g = await gate(token);
  if (!g.ok) return g;
  const res = await startCardSessionService(g.token, g.deps);
  if (!res.ok) return { ok: false, error: MESSAGES[res.error] };
  return { ok: true, sessionId: res.sessionId, countryCode: res.countryCode, scriptUrl: res.scriptUrl };
}

/** Charges the payment request's own amount against the card the customer entered; returns the 3-D Secure page to open. */
export async function executeCardPayment(token: string, sessionId: string): Promise<PayRedirectState> {
  const g = await gate(token);
  if (!g.ok) return g;
  const res = await executeCardPaymentService(g.token, typeof sessionId === "string" ? sessionId : "", g.deps);
  if (!res.ok) return { ok: false, error: MESSAGES[res.error] };
  return { ok: true, redirectUrl: res.redirectUrl };
}

/** Fallback: MyFatoorah's hosted payment page for the same amount. */
export async function startHostedPayment(token: string): Promise<PayRedirectState> {
  const g = await gate(token);
  if (!g.ok) return g;
  const res = await startHostedPaymentService(g.token, g.deps);
  if (!res.ok) return { ok: false, error: MESSAGES[res.error] };
  return { ok: true, redirectUrl: res.redirectUrl };
}
