import { isEsignProviderName, type EsignProviderName } from "./types";

/**
 * E-signature configuration, read from the environment at call time (tests
 * flip variables between cases). Values are never exported; only "set / not
 * set" reaches the admin screen through `esignStatus()`.
 *
 *   ESIGN_PROVIDER            internal (default) | mock | docusign
 *   ESIGN_WEBHOOK_SECRET      shared secret the provider signs webhook deliveries with
 *   DOCUSIGN_INTEGRATION_KEY  the app's integration key (client id)
 *   DOCUSIGN_USER_ID          the API user's GUID (JWT impersonation subject)
 *   DOCUSIGN_ACCOUNT_ID       the account GUID envelopes are created in
 *   DOCUSIGN_BASE_URL         e.g. https://demo.docusign.net (developer) or the account's production base
 *   DOCUSIGN_PRIVATE_KEY      RSA private key (PEM) that signs the JWT grant; "\n" escapes are accepted
 *
 * Pure apart from process.env: safe to import from route handlers and tests.
 */
export const DOCUSIGN_ENV_NAMES = ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_BASE_URL", "DOCUSIGN_PRIVATE_KEY"] as const;

export const DOCUSIGN_DEFAULT_BASE_URL = "https://demo.docusign.net";
export const DOCUSIGN_DEFAULT_AUTH_HOST = "account-d.docusign.com";

export type Env = Record<string, string | undefined>;

function env(name: string, source: Env): string {
  return (source[name] ?? "").trim();
}

/** The provider named by ESIGN_PROVIDER. Unknown values fall back to internal so a typo never turns signing off. */
export function esignProviderName(source: Env = process.env): EsignProviderName {
  const raw = env("ESIGN_PROVIDER", source).toLowerCase();
  if (!raw) return "internal";
  if (!isEsignProviderName(raw)) return "internal";
  // The mock provider records fake signatures. It is a development aid and is
  // refused on a production deployment even when the variable says so.
  if (raw === "mock" && isProductionDeployment(source)) return "internal";
  return raw;
}

export function isProductionDeployment(source: Env = process.env): boolean {
  return env("VERCEL_ENV", source) === "production";
}

export function esignWebhookSecret(source: Env = process.env): string {
  return env("ESIGN_WEBHOOK_SECRET", source);
}

export type DocusignConfig = {
  integrationKey: string;
  userId: string;
  accountId: string;
  baseUrl: string;
  privateKey: string;
  /** OAuth host derived from the base URL: demo accounts authenticate at account-d, production at account. */
  authHost: string;
};

export function docusignConfig(source: Env = process.env): DocusignConfig {
  const baseUrl = (env("DOCUSIGN_BASE_URL", source) || DOCUSIGN_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const authHost = /demo\.docusign\.net/i.test(baseUrl) ? DOCUSIGN_DEFAULT_AUTH_HOST : "account.docusign.com";
  return {
    integrationKey: env("DOCUSIGN_INTEGRATION_KEY", source),
    userId: env("DOCUSIGN_USER_ID", source),
    accountId: env("DOCUSIGN_ACCOUNT_ID", source),
    baseUrl,
    privateKey: env("DOCUSIGN_PRIVATE_KEY", source).replace(/\\n/g, "\n"),
    authHost,
  };
}

export function isDocusignConfigured(source: Env = process.env): boolean {
  const c = docusignConfig(source);
  return Boolean(c.integrationKey && c.userId && c.accountId && c.privateKey);
}

/** Missing DocuSign settings by name (never values), for the admin screen. */
export function docusignMissing(source: Env = process.env): string[] {
  return DOCUSIGN_ENV_NAMES.filter((name) => name !== "DOCUSIGN_BASE_URL" && !env(name, source));
}

/**
 * True when the selected provider can create envelopes right now. The
 * internal and mock providers need nothing; DocuSign needs its credentials.
 */
export function isEsignConfigured(source: Env = process.env): boolean {
  const name = esignProviderName(source);
  if (name === "docusign") return isDocusignConfigured(source);
  return true;
}

export type EsignStatus = {
  provider: EsignProviderName;
  /** What ESIGN_PROVIDER literally says, so the admin sees when a value was overridden. */
  requested: string;
  configured: boolean;
  webhookSecretSet: boolean;
  /** Whether the provider receives webhooks at all (internal does not). */
  webhooks: boolean;
  mock: boolean;
  missing: string[];
  notes: string[];
};

/** Safe summary for the owner's screens: names of settings, never values. */
export function esignStatus(source: Env = process.env): EsignStatus {
  const provider = esignProviderName(source);
  const requested = env("ESIGN_PROVIDER", source) || "internal";
  const notes: string[] = [];
  if (requested.toLowerCase() === "mock" && provider !== "mock") notes.push("ESIGN_PROVIDER=mock is ignored on a production deployment; the internal signing page is used.");
  if (requested && !isEsignProviderName(requested.toLowerCase())) notes.push(`ESIGN_PROVIDER="${requested}" is not internal, mock or docusign; the internal signing page is used.`);
  const missing = provider === "docusign" ? docusignMissing(source) : [];
  const webhookSecretSet = Boolean(esignWebhookSecret(source));
  if (provider !== "internal" && !webhookSecretSet) notes.push("ESIGN_WEBHOOK_SECRET is not set; the webhook endpoint answers 404 until it is.");
  if (provider === "mock") notes.push("Test signing, not a real signature. Nothing is sent to anyone.");
  return { provider, requested, configured: isEsignConfigured(source), webhookSecretSet, webhooks: provider !== "internal", mock: provider === "mock", missing, notes };
}
