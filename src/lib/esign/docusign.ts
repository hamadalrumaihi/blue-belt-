import { createSign } from "node:crypto";
import { docusignConfig, isDocusignConfigured, type DocusignConfig, type Env } from "./config";
import { verifyHmacSignature } from "./hmac";
import { headerOf, type CreateEnvelopeInput, type CreateEnvelopeResult, type EnvelopeStatusResult, type EsignEnvelopeStatus, type EsignEvent, type EsignEventType, type EsignFailure, type EsignProvider, type EsignResult, type WebhookInput, type WebhookParseResult } from "./types";

/**
 * DocuSign eSignature REST API scaffold.
 *
 * Auth: JWT grant (https://developers.docusign.com/platform/auth/jwt/).
 *   1. Build a JWT (RS256) with iss = integration key, sub = API user id,
 *      aud = auth host, scope "signature impersonation", 1 hour expiry.
 *   2. POST https://<authHost>/oauth/token with grant_type
 *      urn:ietf:params:oauth:grant-type:jwt-bearer and the assertion.
 *   3. Use the access token as a Bearer token against
 *      <baseUrl>/restapi/v2.1/accounts/<accountId>/...
 *   The integration key must have been granted consent once by the API user
 *   (the one-off "obtain consent" browser step); until then the token call
 *   answers consent_required.
 *
 * Envelopes: POST /envelopes with the agreement text as a base64 document,
 * one signer recipient with an anchor-string sign-here tab, status "sent"
 * (DocuSign e-mails the signer; we store the envelope id). Status: GET
 * /envelopes/<id>. Void: PUT /envelopes/<id> { status: "voided", voidedReason }.
 *
 * Webhooks: DocuSign Connect, JSON (SIM) format, with "Include HMAC
 * Signature" on. Connect computes HMAC-SHA256 of the raw body with each
 * configured secret key and sends it base64 in X-DocuSign-Signature-1 (…-2
 * for a second key). ESIGN_WEBHOOK_SECRET is that key.
 *
 * Every method returns a typed not_configured error until the DOCUSIGN_*
 * settings exist, and nothing here is called in tests with real credentials.
 */
export const DOCUSIGN_SIGNATURE_HEADERS = ["x-docusign-signature-1", "x-docusign-signature-2"] as const;
const JWT_TTL_SECONDS = 3600;
const MAX_WEBHOOK_BODY = 1024 * 1024;

export type DocusignDeps = { env?: Env; fetch?: typeof fetch; now?: () => Date };

function notConfigured(): EsignFailure {
  return { ok: false, error: "not_configured", message: "DocuSign is not configured: set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID, DOCUSIGN_BASE_URL and DOCUSIGN_PRIVATE_KEY." };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** The signed JWT assertion for the token call. Pure apart from the key; exported for the scaffold's own tests. */
export function buildJwtAssertion(config: DocusignConfig, now: Date): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(now.getTime() / 1000);
  const payload = base64url(JSON.stringify({ iss: config.integrationKey, sub: config.userId, aud: config.authHost, iat, exp: iat + JWT_TTL_SECONDS, scope: "signature impersonation" }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(config.privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/** DocuSign envelope / recipient statuses mapped onto the neutral states. */
export function mapDocusignStatus(raw: string | null | undefined): EsignEnvelopeStatus | null {
  const s = (raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  switch (s) {
    case "created":
      return "created";
    case "sent":
    case "delivered":
      return s === "sent" ? "sent" : "viewed";
    case "completed":
    case "signed":
      return "signed";
    case "declined":
      return "declined";
    case "voided":
      return "voided";
    case "expired":
    case "timedout":
      return "expired";
    default:
      return null;
  }
}

function statusToEventType(status: EsignEnvelopeStatus): EsignEventType | null {
  if (status === "created") return null;
  return status;
}

type ConnectPayload = {
  event?: unknown;
  generatedDateTime?: unknown;
  data?: { envelopeId?: unknown; envelopeSummary?: { status?: unknown; voidedReason?: unknown; declinedReason?: unknown; completedDateTime?: unknown; statusChangedDateTime?: unknown; recipients?: { signers?: Array<{ name?: unknown; email?: unknown; declinedReason?: unknown }> } } };
};

/**
 * Turns one Connect JSON delivery into neutral events. Connect posts one
 * envelope-level event per delivery (envelope-sent, envelope-delivered,
 * envelope-completed, envelope-declined, envelope-voided, recipient-*).
 * The event id combines the envelope id, the status and the status change
 * time so a redelivery of the same change is a duplicate, while a genuine
 * later change is new.
 */
export function parseConnectPayload(body: string, receivedAt: Date): EsignEvent[] | null {
  if (body.length > MAX_WEBHOOK_BODY) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as ConnectPayload;
  const envelopeId = typeof p.data?.envelopeId === "string" ? p.data.envelopeId.trim() : "";
  if (!envelopeId) return null;
  const summary = p.data?.envelopeSummary ?? {};
  const eventName = typeof p.event === "string" ? p.event.toLowerCase() : "";
  // Prefer the explicit event name; fall back to the envelope status.
  const fromEvent = eventName.startsWith("envelope-") ? mapDocusignStatus(eventName.slice("envelope-".length)) : null;
  const status = fromEvent ?? mapDocusignStatus(typeof summary.status === "string" ? summary.status : null);
  if (!status) return null;
  const type = statusToEventType(status);
  if (!type) return [];
  const changedAtRaw = [summary.statusChangedDateTime, summary.completedDateTime, p.generatedDateTime].find((v) => typeof v === "string" && !Number.isNaN(Date.parse(v as string))) as string | undefined;
  const occurredAt = changedAtRaw ? new Date(changedAtRaw).toISOString() : receivedAt.toISOString();
  const signer = summary.recipients?.signers?.[0];
  const reason = [summary.voidedReason, summary.declinedReason, signer?.declinedReason].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  return [
    {
      eventId: `${envelopeId}:${type}:${occurredAt}`,
      envelopeId,
      type,
      occurredAt,
      signer: signer ? { name: typeof signer.name === "string" ? signer.name : null, email: typeof signer.email === "string" ? signer.email : null } : null,
      reason: reason ?? null,
      completedDocumentRef: type === "signed" ? `envelopes/${envelopeId}/documents/combined` : null,
      certificateRef: type === "signed" ? `envelopes/${envelopeId}/documents/certificate` : null,
    },
  ];
}

export function createDocusignProvider(deps: DocusignDeps = {}): EsignProvider {
  const env = () => deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function accessToken(config: DocusignConfig): Promise<EsignResult<{ token: string }>> {
    const assertion = buildJwtAssertion(config, now());
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
    try {
      const res = await doFetch(`https://${config.authHost}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
      const json = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
      if (!res.ok || !json?.access_token) return { ok: false, error: "provider_error", message: `DocuSign token request failed (${json?.error ?? res.status}).` };
      return { ok: true, token: json.access_token };
    } catch {
      return { ok: false, error: "provider_error", message: "DocuSign token request failed (network)." };
    }
  }

  async function api<T>(config: DocusignConfig, path: string, init: { method: string; body?: unknown }): Promise<EsignResult<{ data: T }>> {
    const auth = await accessToken(config);
    if (!auth.ok) return auth;
    try {
      const res = await doFetch(`${config.baseUrl}/restapi/v2.1/accounts/${encodeURIComponent(config.accountId)}${path}`, {
        method: init.method,
        headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json", accept: "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const data = (await res.json().catch(() => null)) as T | null;
      if (!res.ok || data === null) return { ok: false, error: "provider_error", message: `DocuSign request failed (${res.status}).` };
      return { ok: true, data };
    } catch {
      return { ok: false, error: "provider_error", message: "DocuSign request failed (network)." };
    }
  }

  return {
    name: "docusign",
    isConfigured: () => isDocusignConfigured(env()),
    async createEnvelope(input: CreateEnvelopeInput): Promise<EsignResult<CreateEnvelopeResult>> {
      if (!isDocusignConfigured(env())) return notConfigured();
      const config = docusignConfig(env());
      if (!input.signer.email || !input.signer.name) return { ok: false, error: "invalid", message: "DocuSign needs the signer's name and e-mail address." };
      const envelope = {
        emailSubject: `Please sign: ${input.document.title}`.slice(0, 100),
        status: "sent",
        documents: [{ documentBase64: Buffer.from(input.document.body, "utf8").toString("base64"), name: input.document.title.slice(0, 100), fileExtension: "txt", documentId: "1" }],
        recipients: {
          signers: [
            {
              email: input.signer.email,
              name: input.signer.name,
              recipientId: "1",
              routingOrder: "1",
              clientUserId: undefined,
              tabs: { signHereTabs: [{ anchorString: "Signed", anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "20" }] },
            },
          ],
        },
        customFields: { textCustomFields: [{ name: "documentId", value: input.document.id, show: "false" }] },
      };
      const res = await api<{ envelopeId?: string; status?: string }>(config, "/envelopes", { method: "POST", body: envelope });
      if (!res.ok) return res;
      const envelopeId = res.data.envelopeId;
      if (!envelopeId) return { ok: false, error: "provider_error", message: "DocuSign did not return an envelope id." };
      return { ok: true, envelopeId, status: mapDocusignStatus(res.data.status) ?? "sent" };
    },
    async getStatus(envelopeId: string): Promise<EsignResult<EnvelopeStatusResult>> {
      if (!isDocusignConfigured(env())) return notConfigured();
      if (!/^[0-9a-fA-F-]{10,64}$/.test(envelopeId)) return { ok: false, error: "invalid", message: "Not a DocuSign envelope id." };
      const config = docusignConfig(env());
      const res = await api<{ status?: string }>(config, `/envelopes/${encodeURIComponent(envelopeId)}`, { method: "GET" });
      if (!res.ok) return res;
      const status = mapDocusignStatus(res.data.status);
      if (!status) return { ok: false, error: "provider_error", message: `Unknown DocuSign status "${res.data.status ?? ""}".` };
      return { ok: true, envelopeId, status, providerStatus: String(res.data.status ?? ""), completedDocumentRef: status === "signed" ? `envelopes/${envelopeId}/documents/combined` : null, certificateRef: status === "signed" ? `envelopes/${envelopeId}/documents/certificate` : null };
    },
    async voidEnvelope(envelopeId: string, reason: string): Promise<EsignResult<{ envelopeId: string }>> {
      if (!isDocusignConfigured(env())) return notConfigured();
      const config = docusignConfig(env());
      const res = await api<unknown>(config, `/envelopes/${encodeURIComponent(envelopeId)}`, { method: "PUT", body: { status: "voided", voidedReason: reason.slice(0, 200) || "Voided by the studio" } });
      if (!res.ok) return res;
      return { ok: true, envelopeId };
    },
    parseWebhook(input: WebhookInput, secret: string): WebhookParseResult {
      const provided = DOCUSIGN_SIGNATURE_HEADERS.map((h) => headerOf(input.headers, h)).find((v) => Boolean(v)) ?? null;
      if (!verifyHmacSignature(secret, input.body, provided)) return { ok: false, error: "unauthorized", message: "Missing or invalid DocuSign Connect signature." };
      const events = parseConnectPayload(input.body, now());
      if (!events) return { ok: false, error: "invalid_payload", message: "Not a DocuSign Connect JSON payload." };
      return { ok: true, events };
    },
  };
}
