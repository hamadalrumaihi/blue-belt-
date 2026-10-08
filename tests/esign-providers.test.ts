import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { docusignConfig, esignProviderName, esignStatus, isEsignConfigured } from "@/lib/esign/config";
import { buildJwtAssertion, createDocusignProvider, mapDocusignStatus, parseConnectPayload } from "@/lib/esign/docusign";
import { hmacSha256, verifyHmacSignature } from "@/lib/esign/hmac";
import { createInternalProvider } from "@/lib/esign/internal";
import { createMockProvider, isMockEnvelopeId, MOCK_LABEL, mockAdvanceEvent, resetMockEnvelopes } from "@/lib/esign/mock";
import type { CreateEnvelopeInput } from "@/lib/esign/types";

const DOC: CreateEnvelopeInput["document"] = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner_id: "owner-1", title: "Event agreement", kind: "event_agreement", body: "Agreement text", body_hash: "abc", signer_role: "client", document_version: "event_agreement@1" };
const SIGNER = { name: "Sara Khan", email: "sara@example.com", phone: null, role: "client" as const };
const RETURN = "https://studio.test/client";

describe("config", () => {
  it("defaults to internal, ignores unknown values, and refuses mock on a production deployment", () => {
    expect(esignProviderName({})).toBe("internal");
    expect(esignProviderName({ ESIGN_PROVIDER: "bogus" })).toBe("internal");
    expect(esignProviderName({ ESIGN_PROVIDER: "mock" })).toBe("mock");
    expect(esignProviderName({ ESIGN_PROVIDER: "MOCK", VERCEL_ENV: "preview" })).toBe("mock");
    expect(esignProviderName({ ESIGN_PROVIDER: "mock", VERCEL_ENV: "production" })).toBe("internal");
    expect(esignProviderName({ ESIGN_PROVIDER: "docusign" })).toBe("docusign");
  });

  it("reports configuration without leaking values", () => {
    expect(isEsignConfigured({})).toBe(true);
    expect(isEsignConfigured({ ESIGN_PROVIDER: "docusign" })).toBe(false);
    const full = { ESIGN_PROVIDER: "docusign", DOCUSIGN_INTEGRATION_KEY: "ik", DOCUSIGN_USER_ID: "u", DOCUSIGN_ACCOUNT_ID: "a", DOCUSIGN_PRIVATE_KEY: "-----BEGIN", ESIGN_WEBHOOK_SECRET: "s" };
    expect(isEsignConfigured(full)).toBe(true);
    const status = esignStatus({ ESIGN_PROVIDER: "docusign", DOCUSIGN_INTEGRATION_KEY: "ik" });
    expect(status).toMatchObject({ provider: "docusign", configured: false, webhookSecretSet: false, webhooks: true, mock: false });
    expect(status.missing).toEqual(["DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY"]);
    expect(JSON.stringify(status)).not.toContain("ik");
    expect(esignStatus({ ESIGN_PROVIDER: "mock", VERCEL_ENV: "production" }).notes.join(" ")).toMatch(/ignored on a production deployment/);
    expect(esignStatus({ ESIGN_PROVIDER: "mock" })).toMatchObject({ mock: true, configured: true });
    expect(esignStatus({ ESIGN_PROVIDER: "mock" }).notes.join(" ")).toContain(MOCK_LABEL);
    expect(docusignConfig({ DOCUSIGN_BASE_URL: "https://demo.docusign.net/" }).authHost).toBe("account-d.docusign.com");
    expect(docusignConfig({ DOCUSIGN_BASE_URL: "https://eu.docusign.net" }).authHost).toBe("account.docusign.com");
    expect(docusignConfig({ DOCUSIGN_PRIVATE_KEY: "a\\nb" }).privateKey).toBe("a\nb");
  });
});

describe("hmac", () => {
  it("verifies base64 or hex HMAC-SHA256 in constant time and rejects everything else", () => {
    const secret = "shh";
    const body = '{"a":1}';
    expect(verifyHmacSignature(secret, body, hmacSha256(secret, body, "base64"))).toBe(true);
    expect(verifyHmacSignature(secret, body, hmacSha256(secret, body, "hex").toUpperCase())).toBe(true);
    expect(verifyHmacSignature(secret, body, hmacSha256("other", body))).toBe(false);
    expect(verifyHmacSignature(secret, body + " ", hmacSha256(secret, body))).toBe(false);
    expect(verifyHmacSignature(secret, body, null)).toBe(false);
    expect(verifyHmacSignature(secret, body, "")).toBe(false);
    expect(verifyHmacSignature("", body, hmacSha256("", body))).toBe(false);
  });
});

describe("internal provider", () => {
  it("mints a /sign link and the token hash to store; status lives on the document; no webhooks", async () => {
    const p = createInternalProvider({ siteUrl: () => "https://studio.test/", mintToken: () => ({ token: "bbs_x", hash: "h".repeat(64) }) });
    expect(p.name).toBe("internal");
    expect(p.isConfigured()).toBe(true);
    const env = await p.createEnvelope({ document: DOC, signer: SIGNER, returnUrl: RETURN });
    expect(env).toEqual({ ok: true, envelopeId: DOC.id, signingUrl: "https://studio.test/sign/bbs_x", status: "sent", accessTokenHash: "h".repeat(64) });
    expect(await p.getStatus(DOC.id)).toMatchObject({ ok: false, error: "unsupported" });
    expect(await p.voidEnvelope(DOC.id, "x")).toEqual({ ok: true, envelopeId: DOC.id });
    expect(p.parseWebhook({ headers: {}, body: "{}" }, "s")).toMatchObject({ ok: false, error: "unsupported" });
  });
});

describe("mock provider", () => {
  it("creates a fake envelope with no link, advances it by hand and verifies its own signed webhook", async () => {
    resetMockEnvelopes();
    const p = createMockProvider();
    const env = await p.createEnvelope({ document: DOC, signer: SIGNER, returnUrl: RETURN });
    expect(env.ok).toBe(true);
    if (!env.ok) throw new Error("unreachable");
    expect(isMockEnvelopeId(env.envelopeId)).toBe(true);
    expect(env.signingUrl).toBeUndefined();
    expect(env.status).toBe("sent");
    expect(await p.getStatus(env.envelopeId)).toMatchObject({ ok: true, status: "sent", providerStatus: "mock:sent" });

    const now = new Date("2026-10-06T09:00:00.000Z");
    const viewed = mockAdvanceEvent(env.envelopeId, "viewed", now);
    expect(viewed).toMatchObject({ envelopeId: env.envelopeId, type: "viewed", occurredAt: now.toISOString(), completedDocumentRef: null });
    expect(await p.getStatus(env.envelopeId)).toMatchObject({ ok: true, status: "viewed" });
    const signed = mockAdvanceEvent(env.envelopeId, "signed", now);
    expect(signed.completedDocumentRef).toContain(env.envelopeId);
    expect(signed.certificateRef).toContain(env.envelopeId);
    expect(signed.eventId).not.toBe(viewed.eventId);
    expect(await p.getStatus(env.envelopeId)).toMatchObject({ ok: true, status: "signed" });
    expect(await p.voidEnvelope(env.envelopeId, "x")).toEqual({ ok: true, envelopeId: env.envelopeId });
    expect(await p.getStatus(env.envelopeId)).toMatchObject({ ok: true, status: "voided" });
    expect(await p.getStatus("not-an-id")).toMatchObject({ ok: false, error: "invalid" });

    const body = JSON.stringify({ events: [{ id: "evt-1", envelopeId: env.envelopeId, type: "signed", occurredAt: now.toISOString(), reason: null }] });
    const sig = createHmac("sha256", "secret").update(body).digest("base64");
    expect(p.parseWebhook({ headers: { "X-Esign-Signature": sig }, body }, "secret")).toEqual({ ok: true, events: [{ eventId: "evt-1", envelopeId: env.envelopeId, type: "signed", occurredAt: now.toISOString(), reason: null, completedDocumentRef: null, certificateRef: null }] });
    expect(p.parseWebhook({ headers: {}, body }, "secret")).toMatchObject({ ok: false, error: "unauthorized" });
    expect(p.parseWebhook({ headers: { "x-esign-signature": sig }, body }, "wrong")).toMatchObject({ ok: false, error: "unauthorized" });
    const bad = "not json";
    expect(p.parseWebhook({ headers: { "x-esign-signature": createHmac("sha256", "secret").update(bad).digest("base64") }, body: bad }, "secret")).toMatchObject({ ok: false, error: "invalid_payload" });
  });
});

describe("docusign provider", () => {
  it("returns not_configured from every call without credentials and never touches the network", async () => {
    const fetchSpy = vi.fn();
    const p = createDocusignProvider({ env: {}, fetch: fetchSpy as unknown as typeof fetch });
    expect(p.name).toBe("docusign");
    expect(p.isConfigured()).toBe(false);
    expect(await p.createEnvelope({ document: DOC, signer: SIGNER, returnUrl: RETURN })).toMatchObject({ ok: false, error: "not_configured" });
    expect(await p.getStatus("abc")).toMatchObject({ ok: false, error: "not_configured" });
    expect(await p.voidEnvelope("abc", "why")).toMatchObject({ ok: false, error: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
    const partial = createDocusignProvider({ env: { DOCUSIGN_INTEGRATION_KEY: "ik", DOCUSIGN_USER_ID: "u", DOCUSIGN_ACCOUNT_ID: "a" }, fetch: fetchSpy as unknown as typeof fetch });
    expect(await partial.createEnvelope({ document: DOC, signer: SIGNER, returnUrl: RETURN })).toMatchObject({ ok: false, error: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps provider statuses onto the neutral states", () => {
    expect(mapDocusignStatus("created")).toBe("created");
    expect(mapDocusignStatus("sent")).toBe("sent");
    expect(mapDocusignStatus("Delivered")).toBe("viewed");
    expect(mapDocusignStatus("completed")).toBe("signed");
    expect(mapDocusignStatus("declined")).toBe("declined");
    expect(mapDocusignStatus("voided")).toBe("voided");
    expect(mapDocusignStatus("timedout")).toBe("expired");
    expect(mapDocusignStatus("whatever")).toBeNull();
  });

  it("verifies Connect deliveries with the HMAC header and turns them into events", () => {
    const now = new Date("2026-10-06T09:00:00.000Z");
    const p = createDocusignProvider({ env: {}, now: () => now });
    const payload = { event: "envelope-completed", generatedDateTime: "2026-10-06T08:59:00.000Z", data: { envelopeId: "ENV-123", envelopeSummary: { status: "completed", completedDateTime: "2026-10-06T08:58:00.000Z", recipients: { signers: [{ name: "Sara Khan", email: "sara@example.com" }] } } } };
    const body = JSON.stringify(payload);
    const sig = createHmac("sha256", "connect-secret").update(body).digest("base64");
    const ok = p.parseWebhook({ headers: { "X-DocuSign-Signature-1": sig }, body }, "connect-secret");
    expect(ok).toEqual({
      ok: true,
      events: [{ eventId: "ENV-123:signed:2026-10-06T08:58:00.000Z", envelopeId: "ENV-123", type: "signed", occurredAt: "2026-10-06T08:58:00.000Z", signer: { name: "Sara Khan", email: "sara@example.com" }, reason: null, completedDocumentRef: "envelopes/ENV-123/documents/combined", certificateRef: "envelopes/ENV-123/documents/certificate" }],
    });
    expect(p.parseWebhook({ headers: {}, body }, "connect-secret")).toMatchObject({ ok: false, error: "unauthorized" });
    expect(p.parseWebhook({ headers: { "x-docusign-signature-1": sig }, body }, "other")).toMatchObject({ ok: false, error: "unauthorized" });
    expect(p.parseWebhook({ headers: { "x-docusign-signature-2": sig }, body }, "connect-secret").ok).toBe(true);
    const junk = JSON.stringify({ hello: 1 });
    expect(p.parseWebhook({ headers: { "x-docusign-signature-1": createHmac("sha256", "connect-secret").update(junk).digest("base64") }, body: junk }, "connect-secret")).toMatchObject({ ok: false, error: "invalid_payload" });
    expect(parseConnectPayload(JSON.stringify({ event: "envelope-voided", data: { envelopeId: "E", envelopeSummary: { voidedReason: "wrong" } } }), now)?.[0]).toMatchObject({ type: "voided", reason: "wrong", occurredAt: now.toISOString() });
    expect(parseConnectPayload(JSON.stringify({ event: "envelope-created", data: { envelopeId: "E" } }), now)).toEqual([]);
    expect(parseConnectPayload("[]", now)).toBeNull();
  });

  it("builds an RS256 JWT assertion for the grant flow", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const config = docusignConfig({ DOCUSIGN_INTEGRATION_KEY: "ik", DOCUSIGN_USER_ID: "user", DOCUSIGN_ACCOUNT_ID: "acct", DOCUSIGN_PRIVATE_KEY: pem });
    const jwt = buildJwtAssertion(config, new Date("2026-10-06T09:00:00.000Z"));
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({ iss: "ik", sub: "user", aud: "account-d.docusign.com", scope: "signature impersonation" });
    expect(signature.length).toBeGreaterThan(100);
  });
});
