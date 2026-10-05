import "server-only";

/**
 * MyFatoorah configuration. Everything here is server-only; none of these
 * values may ever be prefixed NEXT_PUBLIC_.
 *
 * Base URLs (https://docs.myfatoorah.com/docs/api-key):
 *   test        https://apitest.myfatoorah.com/   (portal: https://demo.myfatoorah.com/)
 *   production  https://api.myfatoorah.com/       Kuwait, Bahrain, Jordan, Oman
 *               https://api-qa.myfatoorah.com/    Qatar   <- Blue Belt Media's account
 *               https://api-sa.myfatoorah.com/    Saudi Arabia
 *               https://api-ae.myfatoorah.com/    UAE
 *               https://api-eg.myfatoorah.com/    Egypt
 */
export const MYFATOORAH_TEST_BASE_URL = "https://apitest.myfatoorah.com";
export const MYFATOORAH_PRODUCTION_BASE_URLS = {
  KWT: "https://api.myfatoorah.com",
  QAT: "https://api-qa.myfatoorah.com",
  SAU: "https://api-sa.myfatoorah.com",
  ARE: "https://api-ae.myfatoorah.com",
  EGY: "https://api-eg.myfatoorah.com",
} as const;

export const PAYMENT_PROVIDER = "MYFATOORAH" as const;

export type PaymentsConfig = {
  enabled: boolean;
  apiKey: string;
  webhookSecret: string;
  baseUrl: string;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** True only when the flag is on AND both secrets are present. */
export function isPaymentsEnabled(): boolean {
  return env("PAYMENTS_MYFATOORAH_ENABLED") === "1" && env("MYFATOORAH_API_KEY") !== "" && env("MYFATOORAH_WEBHOOK_SECRET") !== "";
}

/**
 * Gate for the AUTOMATIC "Pic-Time order creates a MyFatoorah invoice" path in
 * the payments cron. Independent of, and in addition to, isPaymentsEnabled():
 * payments can be live (webhook + reconcile) without auto-invoicing every
 * unpaid offline order. Off by default — no invoices are created automatically
 * until it is explicitly set.
 */
export function isAutoInvoiceEnabled(): boolean {
  return isPaymentsEnabled() && env("PAYMENTS_AUTO_INVOICE_ENABLED") === "1";
}

export function getPaymentsConfig(): PaymentsConfig {
  const baseUrl = (env("MYFATOORAH_BASE_URL") || MYFATOORAH_TEST_BASE_URL).replace(/\/+$/, "");
  return { enabled: isPaymentsEnabled(), apiKey: env("MYFATOORAH_API_KEY"), webhookSecret: env("MYFATOORAH_WEBHOOK_SECRET"), baseUrl };
}
