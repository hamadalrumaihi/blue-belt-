import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/import-service", () => ({ importPage: vi.fn() }));

import { POST as receive } from "@/app/api/import/receive/route";
import { POST, dynamic, maxDuration, runtime } from "@/app/api/import/route";
import { importPage } from "@/lib/import-service";
import { RULES, resetRateLimits } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { MAX_IMPORT_HTML_BYTES } from "@/lib/validation";

const createClientMock = vi.mocked(createClient);
const importPageMock = vi.mocked(importPage);
const USER = { id: "user-1", email: "photographer@example.com" };
const PAGE = "https://ajptour.com/en/event/1411/bracket/130617";

function install(user: typeof USER | null) {
  createClientMock.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) } } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function post(body: string | undefined) {
  return POST(new Request("http://localhost/api/import", { method: "POST", body, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  resetRateLimits();
  install(USER);
  importPageMock.mockReset();
  importPageMock.mockResolvedValue({ ok: true, url: PAGE, matched: 1, results: [], checkedAt: "2026-03-14T06:00:00.000Z" });
});

describe("POST /api/import", () => {
  it("exports the Node runtime config", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });

  it("requires a session", async () => {
    install(null);
    const res = await post(JSON.stringify({ url: PAGE, html: "<p>" }));
    expect(res.status).toBe(401);
    expect(importPageMock).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies with 400 and oversized pages with 413", async () => {
    expect((await post("{")).status).toBe(400);
    expect(await (await post(JSON.stringify({ url: PAGE }))).json()).toMatchObject({ code: "INVALID_HTML" });
    expect((await post(JSON.stringify({ url: PAGE, html: "<p>" + "x".repeat(MAX_IMPORT_HTML_BYTES) }))).status).toBe(413);
    expect(importPageMock).not.toHaveBeenCalled();
  });

  it("applies the page through the import service and returns its outcome", async () => {
    const res = await post(JSON.stringify({ url: PAGE, html: "<html><body>ok</body></html>" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matched: 1 });
    expect(importPageMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ url: PAGE, html: "<html><body>ok</body></html>" }));
    expect(res.headers.get("x-ratelimit-limit")).toBe(String(RULES.importPerUser.max));
  });

  it("maps service failures to 404 / 400 / 500", async () => {
    importPageMock.mockResolvedValueOnce({ ok: false, code: "NO_ATHLETES", message: "none", url: PAGE, candidates: ["https://ajptour.com/x"] });
    const nf = await post(JSON.stringify({ url: PAGE, html: "<p>" }));
    expect(nf.status).toBe(404);
    expect(await nf.json()).toMatchObject({ code: "NO_ATHLETES", candidates: ["https://ajptour.com/x"] });
    importPageMock.mockResolvedValueOnce({ ok: false, code: "UNSUPPORTED_HOST", message: "no", url: PAGE });
    expect((await post(JSON.stringify({ url: PAGE, html: "<p>" }))).status).toBe(400);
    importPageMock.mockResolvedValueOnce({ ok: false, code: "QUERY_FAILED", message: "db", url: PAGE });
    expect((await post(JSON.stringify({ url: PAGE, html: "<p>" }))).status).toBe(500);
  });

  it("rate limits per user with Retry-After", async () => {
    for (let i = 0; i < RULES.importPerUser.max; i += 1) await post(JSON.stringify({ url: PAGE, html: "<p>" }));
    const res = await post(JSON.stringify({ url: PAGE, html: "<p>" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /api/import/receive (hand-over)", () => {
  function form(fields: Record<string, string>, origin: string | null, extraHeaders: Record<string, string> = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const headers: Record<string, string> = { ...extraHeaders };
    if (origin) headers.origin = origin;
    return receive(new Request("https://tournament-watcher.vercel.app/api/import/receive", { method: "POST", body: fd, headers }));
  }

  it("accepts only pages on the allow-listed source hosts (or itself)", async () => {
    expect((await form({ url: PAGE, html: "<p>" }, null)).status).toBe(403);
    expect((await form({ url: PAGE, html: "<p>" }, "https://evil.example")).status).toBe(403);
    expect((await form({ url: PAGE, html: "<p>" }, "http://ajptour.com")).status).toBe(403);
    expect((await form({ url: PAGE, html: "<p>" }, "https://ajptour.com")).status).toBe(200);
    expect((await form({ url: PAGE, html: "<p>" }, "https://www.smoothcomp.com")).status).toBe(200);
    expect((await form({ url: PAGE, html: "<p>" }, "https://tournament-watcher.vercel.app")).status).toBe(200);
  });

  it("returns a first-party page that parks the payload in sessionStorage and moves to /import, under a strict CSP", async () => {
    const res = await form({ url: PAGE, html: "<html><body></script><p>hi</p></body></html>" }, "https://ajptour.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'nonce-[0-9a-f-]+'/);
    const page = await res.text();
    expect(page).toContain('sessionStorage.setItem("bbm:pending-import"');
    expect(page).toContain('location.replace("/import")');
    // The payload is JSON inside a data script; a closing tag in the HTML cannot break out of it.
    const payload = /<script type="application\/json" id="p">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? "";
    expect(payload).not.toContain("</script>");
    expect(JSON.parse(payload)).toMatchObject({ url: PAGE, html: "<html><body></script><p>hi</p></body></html>" });
  });

  it("rejects missing fields and oversized pages", async () => {
    expect((await form({ url: PAGE }, "https://ajptour.com")).status).toBe(400);
    expect((await form({ url: PAGE, html: "<p>" + "x".repeat(MAX_IMPORT_HTML_BYTES) }, "https://ajptour.com")).status).toBe(413);
  });

  it("rate limits per client address", async () => {
    for (let i = 0; i < RULES.importReceivePerIp.max; i += 1) await form({ url: PAGE, html: "<p>" }, "https://ajptour.com", { "x-forwarded-for": "203.0.113.9" });
    expect((await form({ url: PAGE, html: "<p>" }, "https://ajptour.com", { "x-forwarded-for": "203.0.113.9" })).status).toBe(429);
    expect((await form({ url: PAGE, html: "<p>" }, "https://ajptour.com", { "x-forwarded-for": "203.0.113.10" })).status).toBe(200);
  });
});
