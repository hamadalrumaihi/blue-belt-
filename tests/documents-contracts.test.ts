import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const db = new (await import("./payments/fake-supabase")).FakeSupabase();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.asClient() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => db.asClient(), isServiceClientConfigured: () => true }));
vi.mock("@/lib/roles", () => ({ requireStudioUser: async () => ({ ok: true, viewer: { userId: "owner-1", email: "owner@example.com", role: "owner" } }) }));
vi.mock("@/lib/studio/queries", () => ({ loadStudio: async () => ({ business_name: "Blue Belt Media" }), siteUrl: () => "https://studio.test", DEFAULT_STUDIO: { business_name: "Blue Belt Media" } }));

import { confirmationBlockers, gatedBookingStatus } from "@/lib/bookings/gates";
import { agreementKindForBookingType, checkSignerForRole, contractStateFor, guardianOf, namesMatch, needsGuardianRelease, primaryContractDocument } from "@/lib/documents/contract-state";
import { DEFAULT_TEMPLATES } from "@/lib/documents/templates";
import { advanceMockEnvelope, prepareBookingContracts, sendDocument, voidDocument } from "@/lib/actions/documents";
import { resetMockEnvelopes } from "@/lib/esign/mock";

const OWNER = "owner-1";
const BOOKING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEMPLATE_IDS = { event_agreement: "11111111-1111-4111-8111-111111111111", session_agreement: "22222222-2222-4222-8222-222222222222", services_agreement: "33333333-3333-4333-8333-333333333333", guardian_release: "44444444-4444-4444-8444-444444444444", print_release: "55555555-5555-4555-8555-555555555555" } as const;

type Row = Record<string, unknown>;

function bookingRow(overrides: Row = {}): Row {
  return { id: BOOKING, owner_id: OWNER, booking_type: "tournament_athlete", athlete_name: "Yousef", customer_name: "Parent Person", customer_email: "parent@example.com", customer_phone: "+97450000000", public_ref: "BB-7K3PQ2", package_name: "Gold", amount_qr: 1000, deposit_qr: 500, balance_qr: 500, session_at: null, location: "Lusail", academy: null, client_id: null, organization_id: null, service_id: null, event_id: null, status: "pending", booking_status: "quoted", quoted_at: null, confirmed_at: null, contract_document_id: null, requires_contract: true, requires_guardian_release: false, subject_is_minor: false, guardian: null, contract_state: "required", deposit_state: "pending", balance_state: "not_due", created_at: "2026-10-01T00:00:00.000Z", ...overrides };
}

function seedTemplates() {
  db.seed(
    "photo_document_templates",
    DEFAULT_TEMPLATES.filter((t) => t.kind in TEMPLATE_IDS).map((t) => ({ id: TEMPLATE_IDS[t.kind as keyof typeof TEMPLATE_IDS], owner_id: OWNER, kind: t.kind, name: t.name, body: t.body, version: 2, active: true })),
  );
}

function docOf(role: "client" | "guardian") {
  return db.tables.photo_documents.find((d) => d.signer_role === role) as Row;
}

const doc = (over: Row) => ({ id: "d", status: "sent", signer_role: "client", required_for_confirmation: true, kind: "event_agreement", created_at: "2026-10-01T00:00:00.000Z", ...over }) as Parameters<typeof primaryContractDocument>[0][number];

describe("agreementKindForBookingType", () => {
  it("picks the event, session or services agreement per booking type", () => {
    expect(agreementKindForBookingType("tournament_athlete")).toBe("event_agreement");
    expect(agreementKindForBookingType("club")).toBe("event_agreement");
    expect(agreementKindForBookingType("private_session")).toBe("session_agreement");
    expect(agreementKindForBookingType("training_session")).toBe("services_agreement");
    expect(agreementKindForBookingType("custom")).toBe("services_agreement");
  });
});

describe("guardianOf / needsGuardianRelease", () => {
  it("reads the guardian JSON defensively", () => {
    expect(guardianOf({ guardian: null })).toBeNull();
    expect(guardianOf({ guardian: "nope" })).toBeNull();
    expect(guardianOf({ guardian: {} })).toBeNull();
    expect(guardianOf({ guardian: { name: " Sara Khan ", email: "Sara@Example.com", phone: "+974", consent_at: "x" } })).toEqual({ name: "Sara Khan", email: "sara@example.com", phone: "+974" });
    expect(needsGuardianRelease({ subject_is_minor: true, requires_guardian_release: false })).toBe(true);
    expect(needsGuardianRelease({ subject_is_minor: false, requires_guardian_release: true })).toBe(true);
    expect(needsGuardianRelease({ subject_is_minor: false, requires_guardian_release: false })).toBe(false);
  });
});

describe("contractStateFor", () => {
  const adult = { requires_contract: true, requires_guardian_release: false, subject_is_minor: false };
  const minor = { requires_contract: true, requires_guardian_release: true, subject_is_minor: true };

  it("is not_required when the booking needs no agreement and required when nothing live exists", () => {
    expect(contractStateFor({ ...adult, requires_contract: false }, [doc({ status: "signed" })])).toBe("not_required");
    expect(contractStateFor(adult, [])).toBe("required");
    expect(contractStateFor(adult, [doc({ status: "draft" })])).toBe("required");
    expect(contractStateFor(adult, [doc({ status: "void" }), doc({ id: "e", status: "expired" })])).toBe("required");
    expect(contractStateFor(adult, [doc({ status: "sent", required_for_confirmation: false })])).toBe("required");
  });

  it("is sent while waiting, declined on any decline, signed when every required document is signed", () => {
    expect(contractStateFor(adult, [doc({ status: "sent" })])).toBe("sent");
    expect(contractStateFor(adult, [doc({ status: "viewed" })])).toBe("sent");
    expect(contractStateFor(adult, [doc({ status: "declined" }), doc({ id: "e", status: "signed" })])).toBe("declined");
    expect(contractStateFor(adult, [doc({ status: "signed" })])).toBe("signed");
    expect(contractStateFor(adult, [doc({ status: "signed" }), doc({ id: "e", status: "sent", kind: "print_release" })])).toBe("sent");
    expect(contractStateFor(adult, [doc({ status: "signed" }), doc({ id: "e", status: "void" })])).toBe("signed");
  });

  it("never reaches signed for a minor until the guardian release is signed by the guardian", () => {
    expect(contractStateFor(minor, [doc({ status: "signed" })])).toBe("sent");
    expect(contractStateFor(minor, [doc({ status: "signed" }), doc({ id: "g", status: "sent", signer_role: "guardian", kind: "guardian_release" })])).toBe("sent");
    expect(contractStateFor(minor, [doc({ status: "signed" }), doc({ id: "g", status: "signed", signer_role: "guardian", kind: "guardian_release" })])).toBe("signed");
    // A guardian release alone is not a client agreement.
    expect(contractStateFor(minor, [doc({ id: "g", status: "signed", signer_role: "guardian", kind: "guardian_release" })])).toBe("sent");
  });

  it("points the booking at the signed client agreement first", () => {
    const list = [doc({ id: "old", status: "void" }), doc({ id: "g", status: "signed", signer_role: "guardian" }), doc({ id: "new", status: "signed", created_at: "2026-10-02T00:00:00.000Z" })];
    expect(primaryContractDocument(list)?.id).toBe("new");
    expect(primaryContractDocument([doc({ id: "s", status: "sent" }), doc({ id: "old", status: "void" })])?.id).toBe("s");
    expect(primaryContractDocument([])).toBeNull();
  });
});

describe("gates agree with the columns the signing code writes", () => {
  const base = { booking_status: "awaiting_contract" as const, requires_contract: true, requires_guardian_release: false, contract_state: "sent" as const, deposit_state: "pending" as const, balance_state: "not_due" as const, amount_qr: 1000, subject_is_minor: false };

  it("a required unsigned contract blocks confirmation; a signed one clears the contract gate, leaving the deposit", () => {
    expect(confirmationBlockers(base).map((b) => b.code)).toEqual(["contract_unsigned", "deposit_unpaid"]);
    expect(gatedBookingStatus(base)).toBe("awaiting_contract");
    const signed = { ...base, contract_state: "signed" as const };
    expect(confirmationBlockers(signed).map((b) => b.code)).toEqual(["deposit_unpaid"]);
    expect(gatedBookingStatus(signed)).toBe("awaiting_payment");
    expect(gatedBookingStatus({ ...signed, deposit_state: "paid" })).toBe("confirmed");
  });

  it("names the guardian release for a minor while the contract_state is below signed", () => {
    const minor = { ...base, requires_guardian_release: true, subject_is_minor: true };
    expect(confirmationBlockers(minor).map((b) => b.code)).toEqual(["guardian_release_unsigned", "deposit_unpaid"]);
    expect(gatedBookingStatus(minor)).toBe("awaiting_contract");
    expect(gatedBookingStatus({ ...minor, contract_state: "signed", deposit_state: "paid" })).toBe("confirmed");
  });
});

describe("namesMatch / checkSignerForRole", () => {
  it("matches names loosely but never lets the athlete sign a guardian release", () => {
    expect(namesMatch("Sara Khan", "sara  khan")).toBe(true);
    expect(namesMatch("Sara Khan", "Sara A. Khan")).toBe(true);
    expect(namesMatch("Sara Khan", "Yousef Khan")).toBe(false);
    expect(namesMatch("Sara", "Sara Khan")).toBe(false);
    expect(namesMatch(null, "x")).toBe(false);
    expect(checkSignerForRole("client", "Anyone", { athleteName: "Yousef", guardianName: "Sara Khan" })).toEqual({ ok: true });
    expect(checkSignerForRole("guardian", "Yousef Khan", { athleteName: "Yousef Khan", guardianName: "Sara Khan" })).toEqual({ ok: false, error: "minor_cannot_sign" });
    expect(checkSignerForRole("guardian", "Other Person", { athleteName: "Yousef Khan", guardianName: "Sara Khan" })).toEqual({ ok: false, error: "guardian_name_mismatch" });
    expect(checkSignerForRole("guardian", "Sara Khan", { athleteName: "Yousef Khan", guardianName: "Sara Khan" })).toEqual({ ok: true });
    // No guardian on file: only the athlete is refused.
    expect(checkSignerForRole("guardian", "Yousef Khan", { athleteName: "Yousef Khan", guardianName: null })).toEqual({ ok: false, error: "minor_cannot_sign" });
    expect(checkSignerForRole("guardian", "Someone Else", { athleteName: "Yousef Khan", guardianName: null })).toEqual({ ok: true });
  });
});

describe("prepareBookingContracts (owner action)", () => {
  const ENV_KEYS = ["ESIGN_PROVIDER", "VERCEL_ENV", "ESIGN_WEBHOOK_SECRET"];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    for (const t of Object.keys(db.tables)) db.tables[t] = [];
    db.calls = [];
    resetMockEnvelopes();
    seedTemplates();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("creates the event agreement for a tournament athlete and nothing for the guardian when the athlete is an adult", async () => {
    db.seed("photo_bookings", [bookingRow()]);
    const res = await prepareBookingContracts(BOOKING);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.created.map((c) => [c.kind, c.signerRole])).toEqual([["event_agreement", "client"]]);
    expect(res.warnings).toEqual([]);
    const d = docOf("client");
    expect(d).toMatchObject({ kind: "event_agreement", status: "draft", provider: "internal", required_for_confirmation: true, template_id: TEMPLATE_IDS.event_agreement, template_version: 2, document_version: "event_agreement@2", booking_id: BOOKING, owner_id: OWNER });
    expect(String(d.body)).toContain("Parent Person");
    expect(String(d.body)).toContain("500 QAR");
    expect(db.tables.photo_audit_log.filter((a) => a.action === "contract.created")).toHaveLength(1);
    expect(db.tables.photo_audit_log[0]).toMatchObject({ actor_id: OWNER, actor_kind: "owner" });
    // Drafts do not change the booking's state.
    expect(db.tables.photo_bookings[0].contract_state).toBe("required");

    // Idempotent: a second press skips the live draft.
    const again = await prepareBookingContracts(BOOKING);
    expect(again.ok && again.created).toEqual([]);
    expect(again.ok && again.skipped).toEqual(["client"]);
    expect(db.tables.photo_documents).toHaveLength(1);
  });

  it("picks the session agreement for a private session and the services agreement for training / custom", async () => {
    db.seed("photo_bookings", [bookingRow({ booking_type: "private_session" })]);
    const session = await prepareBookingContracts(BOOKING);
    expect(session.ok && session.created[0].kind).toBe("session_agreement");
    db.tables.photo_documents = [];
    db.tables.photo_bookings[0].booking_type = "training_session";
    const training = await prepareBookingContracts(BOOKING);
    expect(training.ok && training.created[0].kind).toBe("services_agreement");
    db.tables.photo_documents = [];
    db.tables.photo_bookings[0].booking_type = "club";
    const club = await prepareBookingContracts(BOOKING);
    expect(club.ok && club.created[0].kind).toBe("event_agreement");
  });

  it("also creates a guardian release addressed to the guardian when the athlete is a minor", async () => {
    db.seed("photo_bookings", [bookingRow({ subject_is_minor: true, requires_guardian_release: true, guardian: { name: "Sara Khan", email: "sara@example.com", phone: "+97455555555" } })]);
    const res = await prepareBookingContracts(BOOKING);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.created.map((c) => [c.kind, c.signerRole])).toEqual([
      ["event_agreement", "client"],
      ["guardian_release", "guardian"],
    ]);
    const g = docOf("guardian");
    expect(g).toMatchObject({ kind: "guardian_release", signer_role: "guardian", required_for_confirmation: true, template_id: TEMPLATE_IDS.guardian_release });
    expect(String(g.title)).toContain("Yousef");
    expect(String(g.body)).toContain("Given by Sara Khan");
    expect(String(g.body)).toContain("parent or legal guardian of Yousef");
    expect(res.warnings).toEqual([]);
  });

  it("warns when a minor has no guardian on file, but still creates the drafts", async () => {
    db.seed("photo_bookings", [bookingRow({ subject_is_minor: true })]);
    const res = await prepareBookingContracts(BOOKING);
    expect(res.ok && res.created).toHaveLength(2);
    expect(res.ok && res.warnings[0]).toMatch(/No parent or guardian/);
  });

  it("refuses an unknown booking id and a cancelled booking", async () => {
    expect(await prepareBookingContracts("nope")).toEqual({ ok: false, error: "Invalid booking id." });
    expect((await prepareBookingContracts(BOOKING)).ok).toBe(false);
    db.seed("photo_bookings", [bookingRow({ booking_status: "cancelled" })]);
    expect((await prepareBookingContracts(BOOKING)).ok).toBe(false);
    expect(db.tables.photo_documents).toHaveLength(0);
  });

  it("send (internal provider) mints a link, e-mails the signer, audits contract.sent and marks the booking sent; void returns it to required", async () => {
    db.seed("photo_bookings", [bookingRow()]);
    const prep = await prepareBookingContracts(BOOKING);
    if (!prep.ok) throw new Error("unreachable");
    const id = String(docOf("client").id);
    // The fake assigns numeric ids; the action validates uuids, so re-key the row.
    const uuid = "99999999-9999-4999-8999-999999999999";
    docOf("client").id = uuid;
    expect(id).not.toBe(uuid);

    const sent = await sendDocument(uuid);
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error("unreachable");
    expect(sent.provider).toBe("internal");
    expect(sent.signingUrl).toMatch(/^https:\/\/studio\.test\/sign\/bbs_[A-Za-z0-9]{40}$/);
    expect(sent.emailQueued).toBe(true);
    const d = docOf("client");
    expect(d).toMatchObject({ status: "sent", provider: "internal", provider_envelope_id: uuid, provider_status: "sent" });
    expect(d.access_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(db.tables.photo_audit_log.find((a) => a.action === "contract.sent")).toMatchObject({ actor_id: OWNER, entity_id: uuid });
    const booking = db.tables.photo_bookings[0];
    expect(booking.contract_state).toBe("sent");
    expect(booking.contract_document_id).toBe(uuid);
    // Price is set and the contract is out, so the gates move the booking on.
    expect(booking.booking_status).toBe("awaiting_contract");
    const mail = db.tables.photo_notification_deliveries.find((x) => x.channel === "email" && x.alert_key === `email:document:${uuid}:ready`);
    expect((mail?.payload as { to: string }).to).toBe("parent@example.com");
    expect(JSON.stringify(mail?.payload)).not.toMatch(/docusign|fatoorah|pic-?time/i);

    const voided = await voidDocument(uuid, "Wrong date");
    expect(voided).toEqual({ ok: true, contractState: "required" });
    expect(docOf("client")).toMatchObject({ status: "void", provider_status: "voided" });
    expect(docOf("client").voided_at).toBeTruthy();
    expect(db.tables.photo_audit_log.find((a) => a.action === "contract.voided")).toMatchObject({ data: { reason: "Wrong date" } });
    expect(booking.contract_state).toBe("required");
  });

  it("send (mock provider) creates a test envelope without a link or e-mail, and the test buttons advance it through the same path", async () => {
    process.env.ESIGN_PROVIDER = "mock";
    db.seed("photo_bookings", [bookingRow({ deposit_state: "paid" })]);
    await prepareBookingContracts(BOOKING);
    const uuid = "99999999-9999-4999-8999-999999999999";
    docOf("client").id = uuid;
    const sent = await sendDocument(uuid);
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error("unreachable");
    expect(sent.provider).toBe("mock");
    expect(sent.signingUrl).toBeNull();
    expect(sent.emailQueued).toBe(false);
    expect(docOf("client").provider_envelope_id).toMatch(/^mock_/);
    expect(docOf("client").access_token_hash).toBeNull();
    expect(db.tables.photo_notification_deliveries.filter((x) => x.channel === "email")).toHaveLength(0);

    expect(await advanceMockEnvelope(uuid, "viewed")).toMatchObject({ ok: true, status: "viewed" });
    const signed = await advanceMockEnvelope(uuid, "signed");
    expect(signed).toEqual({ ok: true, status: "signed", contractState: "signed" });
    expect(docOf("client").signature_evidence).toMatchObject({ method: "mock", note: "Test signing, not a real signature" });
    expect(db.tables.photo_bookings[0].contract_state).toBe("signed");
    expect(db.tables.photo_bookings[0].booking_status).toBe("confirmed");
    expect(await advanceMockEnvelope(uuid, "declined")).toMatchObject({ ok: false });
  });

  it("the test buttons are refused when the mock provider is not selected", async () => {
    db.seed("photo_bookings", [bookingRow()]);
    expect(await advanceMockEnvelope("99999999-9999-4999-8999-999999999999", "signed")).toMatchObject({ ok: false, error: expect.stringMatching(/ESIGN_PROVIDER=mock/) });
  });
});
