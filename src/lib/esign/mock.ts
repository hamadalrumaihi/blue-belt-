import { randomBytes } from "node:crypto";
import { verifyHmacSignature } from "./hmac";
import { headerOf, isEsignEventType, type CreateEnvelopeResult, type EnvelopeStatusResult, type EsignEnvelopeStatus, type EsignEvent, type EsignEventType, type EsignProvider, type EsignResult, type WebhookInput, type WebhookParseResult } from "./types";

/**
 * Development stand-in. "Test signing, not a real signature": it creates a
 * fake envelope id, never contacts anyone and never produces a signing link.
 * The owner advances the envelope from the admin screen (viewed / signed /
 * declined), which goes through exactly the same `applyProviderEvent` path a
 * real provider's webhook would, so the booking logic is exercised end to end.
 *
 * It also accepts a signed JSON webhook (`X-Esign-Signature`, HMAC-SHA256 of
 * the raw body with ESIGN_WEBHOOK_SECRET) so the webhook route can be tested
 * without a provider account:
 *   { "events": [{ "id": "...", "envelopeId": "mock_...", "type": "signed", "occurredAt": "..." }] }
 */
export const MOCK_ENVELOPE_PREFIX = "mock_";
export const MOCK_SIGNATURE_HEADER = "x-esign-signature";
export const MOCK_LABEL = "Test signing, not a real signature";

const MAX_WEBHOOK_EVENTS = 50;

/** In-process memory of envelope states so `getStatus` answers something sensible during a dev session. */
const memory = new Map<string, EsignEnvelopeStatus>();

export function isMockEnvelopeId(v: unknown): v is string {
  return typeof v === "string" && /^mock_[A-Za-z0-9]{16}$/.test(v);
}

export function mockEnvelopeId(): string {
  return `${MOCK_ENVELOPE_PREFIX}${randomBytes(12).toString("base64url").replace(/[^A-Za-z0-9]/g, "a").slice(0, 16).padEnd(16, "a")}`;
}

/** Builds the event the admin "advance" buttons feed into applyProviderEvent. */
export function mockAdvanceEvent(envelopeId: string, type: Exclude<EsignEventType, "sent">, now: Date = new Date()): EsignEvent {
  memory.set(envelopeId, type === "voided" ? "voided" : type);
  return {
    eventId: `${envelopeId}:${type}:${now.getTime()}`,
    envelopeId,
    type,
    occurredAt: now.toISOString(),
    completedDocumentRef: type === "signed" ? `${envelopeId}/completed.pdf` : null,
    certificateRef: type === "signed" ? `${envelopeId}/certificate.pdf` : null,
  };
}

export function resetMockEnvelopes(): void {
  memory.clear();
}

function parseEvents(body: string): EsignEvent[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = (parsed as { events?: unknown }).events;
  if (!Array.isArray(raw) || raw.length > MAX_WEBHOOK_EVENTS) return null;
  const out: EsignEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id || typeof e.envelopeId !== "string" || !e.envelopeId || !isEsignEventType(e.type)) return null;
    const occurredAt = typeof e.occurredAt === "string" && !Number.isNaN(Date.parse(e.occurredAt)) ? new Date(e.occurredAt).toISOString() : new Date().toISOString();
    out.push({
      eventId: e.id.slice(0, 200),
      envelopeId: e.envelopeId.slice(0, 200),
      type: e.type,
      occurredAt,
      reason: typeof e.reason === "string" ? e.reason.slice(0, 500) : null,
      completedDocumentRef: typeof e.completedDocumentRef === "string" ? e.completedDocumentRef.slice(0, 500) : null,
      certificateRef: typeof e.certificateRef === "string" ? e.certificateRef.slice(0, 500) : null,
    });
  }
  return out;
}

export function createMockProvider(): EsignProvider {
  return {
    name: "mock",
    isConfigured: () => true,
    async createEnvelope(): Promise<EsignResult<CreateEnvelopeResult>> {
      const envelopeId = mockEnvelopeId();
      memory.set(envelopeId, "sent");
      // No signingUrl on purpose: nothing is sent and nobody can sign it except the owner's test buttons.
      return { ok: true, envelopeId, status: "sent" };
    },
    async getStatus(envelopeId: string): Promise<EsignResult<EnvelopeStatusResult>> {
      if (!isMockEnvelopeId(envelopeId)) return { ok: false, error: "invalid", message: "Not a mock envelope id." };
      const status = memory.get(envelopeId) ?? "sent";
      return { ok: true, envelopeId, status, providerStatus: `mock:${status}` };
    },
    async voidEnvelope(envelopeId: string): Promise<EsignResult<{ envelopeId: string }>> {
      if (!isMockEnvelopeId(envelopeId)) return { ok: false, error: "invalid", message: "Not a mock envelope id." };
      memory.set(envelopeId, "voided");
      return { ok: true, envelopeId };
    },
    parseWebhook(input: WebhookInput, secret: string): WebhookParseResult {
      if (!verifyHmacSignature(secret, input.body, headerOf(input.headers, MOCK_SIGNATURE_HEADER))) return { ok: false, error: "unauthorized", message: "Missing or invalid signature." };
      const events = parseEvents(input.body);
      if (!events) return { ok: false, error: "invalid_payload", message: "Body must be a JSON object with an events array." };
      return { ok: true, events };
    },
  };
}
