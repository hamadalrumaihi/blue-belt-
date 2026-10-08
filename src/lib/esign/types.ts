import type { PhotoDocumentRow, SignerRole } from "@/lib/supabase/database.types";

/**
 * Provider-neutral e-signature contract. The studio never builds its own
 * cryptographic signature platform: the `internal` provider is the existing
 * typed-name signing page (`/sign/<token>`), `mock` is a development stand-in
 * the owner advances by hand, and `docusign` is a scaffold that talks to the
 * provider's REST API once credentials exist. Everything the rest of the app
 * needs goes through this interface, so switching providers is an env change.
 *
 * Pure types only: safe to import from client components and tests.
 */
export const ESIGN_PROVIDER_NAMES = ["internal", "mock", "docusign"] as const;
export type EsignProviderName = (typeof ESIGN_PROVIDER_NAMES)[number];

export function isEsignProviderName(v: unknown): v is EsignProviderName {
  return typeof v === "string" && (ESIGN_PROVIDER_NAMES as readonly string[]).includes(v);
}

/** Envelope states every provider is mapped onto (a subset of the document statuses). */
export type EsignEnvelopeStatus = "created" | "sent" | "viewed" | "signed" | "declined" | "voided" | "expired";

export type EsignEventType = "sent" | "viewed" | "signed" | "declined" | "voided" | "expired";

export const ESIGN_EVENT_TYPES: readonly EsignEventType[] = ["sent", "viewed", "signed", "declined", "voided", "expired"];

export function isEsignEventType(v: unknown): v is EsignEventType {
  return typeof v === "string" && (ESIGN_EVENT_TYPES as readonly string[]).includes(v);
}

/** One verified provider event, already authenticated by `parseWebhook`. */
export type EsignEvent = {
  /** Provider-unique id used for idempotency (photo_esign_events.event_id). */
  eventId: string;
  envelopeId: string;
  type: EsignEventType;
  /** ISO timestamp from the provider, or the receive time when the provider sends none. */
  occurredAt: string;
  /** Signer details when the provider reports them (used for the audit trail, never trusted for identity). */
  signer?: { name?: string | null; email?: string | null } | null;
  /** Free-text reason for declined / voided events. */
  reason?: string | null;
  /** Reference (provider id or URL) to the completed document and the completion certificate. */
  completedDocumentRef?: string | null;
  certificateRef?: string | null;
};

export type EsignErrorCode = "not_configured" | "unsupported" | "provider_error" | "invalid";

export type EsignFailure = { ok: false; error: EsignErrorCode; message: string };
export type EsignResult<T> = ({ ok: true } & T) | EsignFailure;

export type EsignDocument = Pick<PhotoDocumentRow, "id" | "owner_id" | "title" | "kind" | "body" | "body_hash" | "signer_role" | "document_version">;

export type EsignSigner = { name: string | null; email: string | null; phone: string | null; role: SignerRole };

export type CreateEnvelopeInput = {
  document: EsignDocument;
  signer: EsignSigner;
  /** Where the signer lands after signing (providers that host the signing session). */
  returnUrl: string;
};

export type CreateEnvelopeResult = {
  envelopeId: string;
  /** The link the signer opens. Absent when the provider delivers the request itself or when nothing is sent (mock). */
  signingUrl?: string;
  status: EsignEnvelopeStatus;
  /** Internal provider only: the sha256 of the minted signing token, to store on the document. */
  accessTokenHash?: string;
};

export type EnvelopeStatusResult = {
  envelopeId: string;
  status: EsignEnvelopeStatus;
  /** Raw provider status string for the admin screen. */
  providerStatus: string;
  completedDocumentRef?: string | null;
  certificateRef?: string | null;
};

export type WebhookInput = {
  /** Request headers (a `Headers` object or a plain lower-cased map). */
  headers: Headers | Record<string, string | undefined>;
  /** The raw request body, exactly as received, because HMAC schemes sign the bytes. */
  body: string;
};

export type WebhookParseResult = { ok: true; events: EsignEvent[] } | { ok: false; error: "unauthorized" | "invalid_payload" | "unsupported"; message: string };

export interface EsignProvider {
  readonly name: EsignProviderName;
  /** True when the provider can be used right now (credentials present). The internal provider is always ready. */
  isConfigured(): boolean;
  createEnvelope(input: CreateEnvelopeInput): Promise<EsignResult<CreateEnvelopeResult>>;
  getStatus(envelopeId: string): Promise<EsignResult<EnvelopeStatusResult>>;
  voidEnvelope(envelopeId: string, reason: string): Promise<EsignResult<{ envelopeId: string }>>;
  /** Verifies the delivery with `secret` and returns the events it carries, or an auth / payload error. Never throws. */
  parseWebhook(input: WebhookInput, secret: string): WebhookParseResult;
}

export function headerOf(headers: WebhookInput["headers"], name: string): string | null {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const map = headers as Record<string, string | undefined>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(map)) if (key.toLowerCase() === lower) return map[key] ?? null;
  return null;
}
