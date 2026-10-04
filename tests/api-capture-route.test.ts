import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ isServiceClientConfigured: vi.fn(() => true), createServiceClient: vi.fn() }));
vi.mock("@/lib/capture/credential-store", () => ({ findCredentialByToken: vi.fn(), touchCredential: vi.fn(async () => undefined), recordHeartbeat: vi.fn(async () => undefined) }));
vi.mock("@/lib/import-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/import-service")>("@/lib/import-service");
  return { failureStatus: actual.failureStatus, importPage: vi.fn() };
});

import { POST as heartbeat } from "@/app/api/capture/heartbeat/route";
import { GET as jobs } from "@/app/api/capture/jobs/route";
import { POST as capture } from "@/app/api/capture/route";
import { findCredentialByToken, recordHeartbeat, touchCredential } from "@/lib/capture/credential-store";
import { generateCaptureToken } from "@/lib/capture/credentials";
import { importPage } from "@/lib/import-service";
import { resetRateLimits, RULES } from "@/lib/rate-limit";
import type { PhotoCaptureCredentialRow } from "@/lib/supabase/database.types";
import { createServiceClient, isServiceClientConfigured } from "@/lib/supabase/service";

const findMock = vi.mocked(findCredentialByToken);
const importMock = vi.mocked(importPage);
const serviceMock = vi.mocked(createServiceClient);
const configuredMock = vi.mocked(isServiceClientConfigured);

const PAGE = "https://ajptour.com/en/event/1411/bracket/130617";
const KEY = "ajptour.com|/event/1411/bracket/130617";
const { token: TOKEN } = generateCaptureToken();
const OWNER = "11111111-1111-4111-8111-111111111111";

function credential(overrides: Partial<PhotoCaptureCredentialRow> = {}): PhotoCaptureCredentialRow {
  return {
    id: "cccccccc-0000-4000-8000-000000000001",
    owner_id: OWNER,
    name: "Event laptop",
    kind: "capture",
    token_hash: "h",
    token_prefix: "bbmc_xxxxxxxx",
    scope_source_keys: null,
    scope_event_id: null,
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
    last_used_at: null,
    use_count: 0,
    last_heartbeat_at: null,
    agent_version: null,
    agent_status: {},
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Service client stand-in for the jobs route: events + athletes with filter recording. */
function fakeService(data: { events?: unknown[]; athletes?: unknown[] }) {
  const filters: Array<{ table: string; op: string; args: unknown[] }> = [];
  function builder(table: string) {
    const chain = {
      select: () => chain,
      eq: (...a: unknown[]) => (filters.push({ table, op: "eq", args: a }), chain),
      not: (...a: unknown[]) => (filters.push({ table, op: "not", args: a }), chain),
      in: (...a: unknown[]) => (filters.push({ table, op: "in", args: a }), chain),
      limit: () => chain,
      then: (res: (v: unknown) => void) => Promise.resolve({ data: table === "photo_events" ? data.events ?? [] : data.athletes ?? [], error: null }).then(res),
    };
    return chain;
  }
  return { client: { from: builder }, filters };
}

const CAPTURE_OK = { id: "row-1", captureId: "cap-00000001", sourceKey: KEY, transport: "agent" as const, capturedAt: "2026-03-14T05:59:00.000Z", completeness: "complete" as const, replayed: false };

function post(path: string, body: unknown, auth: string | null = `Bearer ${TOKEN}`, ip = "203.0.113.5") {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (auth) headers.authorization = auth;
  return new Request(`http://localhost${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });
}

beforeEach(() => {
  resetRateLimits();
  configuredMock.mockReturnValue(true);
  serviceMock.mockReturnValue(fakeService({}).client as never);
  findMock.mockReset();
  findMock.mockResolvedValue({ ok: true, credential: credential() });
  importMock.mockReset();
  importMock.mockResolvedValue({ ok: true, url: PAGE, matched: 2, checkedAt: "2026-03-14T06:00:00.000Z", capture: CAPTURE_OK, results: [] });
  vi.mocked(touchCredential).mockClear();
  vi.mocked(recordHeartbeat).mockClear();
});

const body = { url: PAGE, html: "<html><body><table><tr><td>Mat 1</td></tr></table></body></html>", capture: { captureId: "cap-00000001", capturedAt: "2026-03-14T05:59:00.000Z", completeness: "complete" } };

describe("POST /api/capture (machine intake)", () => {
  it("is unavailable without the service client and rejects missing / malformed / unknown credentials", async () => {
    configuredMock.mockReturnValueOnce(false);
    expect((await capture(post("/api/capture", body))).status).toBe(503);
    expect((await capture(post("/api/capture", body, null))).status).toBe(401);
    expect((await capture(post("/api/capture", body, "Bearer not-a-capture-token"))).status).toBe(401);
    // A Supabase service-role JWT is never accepted here.
    expect((await capture(post("/api/capture", body, "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig"))).status).toBe(401);
    findMock.mockResolvedValueOnce({ ok: false, reason: "UNKNOWN" });
    expect((await capture(post("/api/capture", body))).status).toBe(401);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("refuses an orders intake credential on the capture endpoints", async () => {
    findMock.mockResolvedValueOnce({ ok: true, credential: credential({ kind: "orders" }) });
    const res = await capture(post("/api/capture", body));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "WRONG_CREDENTIAL_KIND" });
    expect(importMock).not.toHaveBeenCalled();
  });

  it("names expiry and revocation so the agent can stop cleanly", async () => {
    findMock.mockResolvedValueOnce({ ok: false, reason: "expired" });
    const expired = await capture(post("/api/capture", body));
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: "CREDENTIAL_EXPIRED" });
    findMock.mockResolvedValueOnce({ ok: false, reason: "revoked" });
    expect(await (await capture(post("/api/capture", body))).json()).toMatchObject({ code: "CREDENTIAL_REVOKED" });
  });

  it("applies the page as the credential's owner with transport=agent and returns a compact verdict", async () => {
    const res = await capture(post("/api/capture", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matched: 2, capture: { captureId: "cap-00000001" }, results: [] });
    expect(importMock).toHaveBeenCalledTimes(1);
    expect(importMock.mock.calls[0][1]).toMatchObject({ url: PAGE, ownerId: OWNER, eventId: null, transport: "agent", capture: { captureId: "cap-00000001", capturedAt: "2026-03-14T05:59:00.000Z", completeness: "complete", transport: "agent" } });
    expect(touchCredential).toHaveBeenCalledTimes(1);
    expect(res.headers.get("x-ratelimit-limit")).toBe(String(RULES.capturePerCredential.max));
  });

  it("a client-supplied transport or owner cannot override the credential", async () => {
    const res = await capture(post("/api/capture", { ...body, capture: { ...body.capture, transport: "import" } }));
    expect(res.status).toBe(200);
    expect(importMock.mock.calls[0][1]).toMatchObject({ ownerId: OWNER, capture: { transport: "agent" } });
    expect((await capture(post("/api/capture", { ...body, ownerId: "x" }))).status).toBe(400);
  });

  it("requires captureId and capturedAt for machine intake", async () => {
    const res = await capture(post("/api/capture", { url: PAGE, html: "<p>x</p>" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_CAPTURE" });
    expect(importMock).not.toHaveBeenCalled();
  });

  it("enforces the credential's source scope and event scope", async () => {
    findMock.mockResolvedValue({ ok: true, credential: credential({ scope_source_keys: ["ajptour.com|/event/1411/bracket/999"], scope_event_id: "33333333-3333-4333-8333-333333333333" }) });
    const out = await capture(post("/api/capture", body));
    expect(out.status).toBe(403);
    expect(await out.json()).toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(importMock).not.toHaveBeenCalled();

    findMock.mockResolvedValue({ ok: true, credential: credential({ scope_source_keys: [KEY], scope_event_id: "33333333-3333-4333-8333-333333333333" }) });
    expect((await capture(post("/api/capture", body))).status).toBe(200);
    expect(importMock.mock.calls[0][1]).toMatchObject({ eventId: "33333333-3333-4333-8333-333333333333" });
  });

  it("maps capture refusals with the shared status table", async () => {
    importMock.mockResolvedValueOnce({ ok: false, code: "STALE_CAPTURE", message: "older", url: PAGE, capture: CAPTURE_OK });
    expect((await capture(post("/api/capture", body))).status).toBe(409);
    importMock.mockResolvedValueOnce({ ok: false, code: "NO_ATHLETES", message: "none", url: PAGE, candidates: [] });
    expect((await capture(post("/api/capture", body))).status).toBe(404);
    importMock.mockResolvedValueOnce({ ok: false, code: "CHALLENGE_PAGE", message: "check", url: PAGE });
    expect((await capture(post("/api/capture", body))).status).toBe(422);
  });

  it("rate limits token probes per address and captures per credential", async () => {
    for (let i = 0; i < RULES.captureAuthPerIp.max; i += 1) await capture(post("/api/capture", body, "Bearer nope", "198.51.100.7"));
    const probe = await capture(post("/api/capture", body, "Bearer nope", "198.51.100.7"));
    expect(probe.status).toBe(429);
    resetRateLimits();
    for (let i = 0; i < RULES.capturePerCredential.max; i += 1) await capture(post("/api/capture", body, `Bearer ${TOKEN}`, `203.0.113.${i % 20}`));
    const limited = await capture(post("/api/capture", body, `Bearer ${TOKEN}`, "203.0.113.99"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});

describe("GET /api/capture/jobs", () => {
  const EVENT = "33333333-3333-4333-8333-333333333333";
  const today = new Date().toISOString().slice(0, 10);

  it("lists one job per source identity of today's events, scoped to the owner and the credential", async () => {
    const fake = fakeService({
      events: [{ id: EVENT, owner_id: OWNER, name: "Qatar Open", active: true, event_date: today, timezone: "Asia/Qatar" }],
      athletes: [
        { id: "a1", event_id: EVENT, source_url: PAGE, name: "A" },
        { id: "a2", event_id: EVENT, source_url: `${PAGE}?tab=2`, name: "B" },
        { id: "a3", event_id: EVENT, source_url: `${PAGE}?category=7`, name: "C" },
        { id: "a4", event_id: EVENT, source_url: "https://evil.example/x", name: "D" },
      ],
    });
    serviceMock.mockReturnValue(fake.client as never);
    const res = await jobs(new Request("http://localhost/api/capture/jobs", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intervalSeconds).toBe(60);
    expect(body.jobs).toEqual([
      { sourceKey: KEY, url: PAGE, eventId: EVENT, eventName: "Qatar Open", clients: 2 },
      { sourceKey: `${KEY}|category=7`, url: `${PAGE}?category=7`, eventId: EVENT, eventName: "Qatar Open", clients: 1 },
    ]);
    expect(fake.filters).toContainEqual({ table: "photo_events", op: "eq", args: ["owner_id", OWNER] });
    expect(fake.filters).toContainEqual({ table: "photo_athletes", op: "eq", args: ["owner_id", OWNER] });
  });

  it("returns no jobs when no event is today, and honours the source scope", async () => {
    serviceMock.mockReturnValue(fakeService({ events: [{ id: EVENT, owner_id: OWNER, name: "Old", active: true, event_date: "2020-01-01", timezone: "Asia/Qatar" }] }).client as never);
    expect(await (await jobs(new Request("http://localhost/api/capture/jobs", { headers: { authorization: `Bearer ${TOKEN}` } }))).json()).toMatchObject({ jobs: [], reason: "no events today" });

    findMock.mockResolvedValue({ ok: true, credential: credential({ scope_source_keys: [`${KEY}|category=7`] }) });
    serviceMock.mockReturnValue(fakeService({ events: [{ id: EVENT, owner_id: OWNER, name: "Qatar Open", active: true, event_date: today, timezone: "Asia/Qatar" }], athletes: [{ id: "a1", event_id: EVENT, source_url: PAGE }, { id: "a3", event_id: EVENT, source_url: `${PAGE}?category=7` }] }).client as never);
    const scoped = await (await jobs(new Request("http://localhost/api/capture/jobs", { headers: { authorization: `Bearer ${TOKEN}` } }))).json();
    expect(scoped.jobs.map((j: { sourceKey: string }) => j.sourceKey)).toEqual([`${KEY}|category=7`]);
  });
});

describe("POST /api/capture/heartbeat", () => {
  it("stores only allow-listed scalar status and answers with the credential's expiry", async () => {
    const res = await heartbeat(post("/api/capture/heartbeat", { agentVersion: "1.0.0", status: { state: "paused", pausedReason: "human check", spooled: 3, html: "<b>no</b>", nested: { x: 1 }, lastError: "<script>" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, credential: { name: "Event laptop" } });
    expect(recordHeartbeat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: credential().id }), expect.objectContaining({ agentVersion: "1.0.0", status: { state: "paused", pausedReason: "human check", spooled: 3 } }));
  });
});
