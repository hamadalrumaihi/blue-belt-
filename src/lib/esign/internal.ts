import { createSigningToken } from "@/lib/documents/tokens";
import type { CreateEnvelopeInput, CreateEnvelopeResult, EnvelopeStatusResult, EsignProvider, EsignResult, WebhookParseResult } from "./types";

/**
 * The studio's own typed-name signing page. An "envelope" is the document
 * itself: the provider mints the `/sign/<token>` link and hands back the
 * token hash for the caller to store on photo_documents.access_token_hash.
 * Status lives on the document row (there is no remote system to ask), so
 * `getStatus` is answered by the caller from the row and `parseWebhook` is
 * unsupported: nothing external ever calls us about an internal envelope.
 */
export type InternalProviderDeps = { siteUrl: () => string; mintToken?: () => { token: string; hash: string } };

export function createInternalProvider(deps: InternalProviderDeps): EsignProvider {
  const mint = deps.mintToken ?? createSigningToken;
  return {
    name: "internal",
    isConfigured: () => true,
    async createEnvelope(input: CreateEnvelopeInput): Promise<EsignResult<CreateEnvelopeResult>> {
      const { token, hash } = mint();
      return { ok: true, envelopeId: input.document.id, signingUrl: `${deps.siteUrl().replace(/\/+$/, "")}/sign/${token}`, status: "sent", accessTokenHash: hash };
    },
    async getStatus(envelopeId: string): Promise<EsignResult<EnvelopeStatusResult>> {
      // The document row is the source of truth; the action layer reads it. Nothing remote exists.
      return { ok: false, error: "unsupported", message: `Internal envelope ${envelopeId}: status is read from the document itself.` };
    },
    async voidEnvelope(envelopeId: string): Promise<EsignResult<{ envelopeId: string }>> {
      // Voiding an internal document only needs the row update the caller performs.
      return { ok: true, envelopeId };
    },
    parseWebhook(): WebhookParseResult {
      return { ok: false, error: "unsupported", message: "The internal provider has no webhooks." };
    },
  };
}
