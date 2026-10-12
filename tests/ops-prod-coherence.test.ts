import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assess, run } from "../scripts/ops/prod-coherence.mjs";

const SHA = "916d7e2d0218b2b72bec9d0055eec6d0307d76f3";
const OLD = "75b0bd4e3b845a4889739bbf4d8479dadfe6ae85";
const VERCEL = "https://api.vercel.com/v6/deployments";
const RAILWAY = "https://backboard.railway.com/graphql/v2";
const HEALTH = "https://blue-belt-production.up.railway.app/health";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function platforms({ vercelSha = SHA, vercelState = "READY", railwaySha = SHA, railwayStatus = "SUCCESS", health = { ok: true, browserReady: true, mode: "headed" }, healthStatus = 200 } = {}) {
  const seen: { vercelAuth: string | null; railwayAuth: string | null; railwayBody: unknown } = { vercelAuth: null, railwayAuth: null, railwayBody: null };
  server.use(
    http.get(VERCEL, ({ request }) => {
      seen.vercelAuth = request.headers.get("authorization");
      const u = new URL(request.url);
      expect(u.searchParams.get("target")).toBe("production");
      expect(u.searchParams.get("projectId")).toBe("prj_yBNZa9kYn2TSWDH4nUTWSurC2ICK");
      return HttpResponse.json({ deployments: [{ uid: "dpl_1", state: vercelState, meta: { githubCommitSha: vercelSha, githubCommitRef: "main" } }] });
    }),
    http.post(RAILWAY, async ({ request }) => {
      seen.railwayAuth = request.headers.get("authorization");
      seen.railwayBody = await request.json();
      return HttpResponse.json({ data: { deployments: { edges: [{ node: { id: "rw_1", status: railwayStatus, meta: { commitHash: railwaySha, branch: "main" } } }] } } });
    }),
    http.get(HEALTH, () => HttpResponse.json(health, { status: healthStatus })),
  );
  return seen;
}

const env = { MAIN_SHA: SHA };

describe("prod-coherence", () => {
  it("is coherent when both platforms are on main and the worker is healthy", async () => {
    const seen = platforms();
    const verdict = await run({ env: { ...env, VERCEL_TOKEN: "vt", RAILWAY_TOKEN: "rt" } });
    expect(verdict).toEqual({ ok: true, reason: "coherent: Vercel and Railway both on main 916d7e2, worker healthy (headed)" });
    expect(seen.vercelAuth).toBe("Bearer vt");
    expect(seen.railwayAuth).toBe("Bearer rt");
    expect(seen.railwayBody).toMatchObject({ variables: { input: { serviceId: "b0bbd0d4-8cbc-44db-96dc-213ab8cac118" } } });
  });

  it("sends no authorization header when no token is set (proxy-injected credentials)", async () => {
    const seen = platforms();
    expect((await run({ env })).ok).toBe(true);
    expect(seen.vercelAuth).toBeNull();
    expect(seen.railwayAuth).toBeNull();
  });

  it("names the platforms when they are on different commits", async () => {
    platforms({ railwaySha: OLD });
    expect(await run({ env })).toEqual({ ok: false, reason: "Vercel is on 916d7e2 but Railway is on 75b0bd4" });
  });

  it("fails when production lags main", async () => {
    platforms({ vercelSha: OLD, railwaySha: OLD });
    expect(await run({ env })).toEqual({ ok: false, reason: "production is on 75b0bd4 but main is 916d7e2" });
  });

  it("fails on a non-ready deployment on either platform", async () => {
    platforms({ vercelState: "ERROR" });
    expect((await run({ env })).reason).toBe("Vercel: production deployment dpl_1 is ERROR");
    server.resetHandlers();
    platforms({ railwayStatus: "CRASHED" });
    expect((await run({ env })).reason).toBe("Railway: latest deployment rw_1 is CRASHED");
  });

  it("fails on an unhealthy worker", async () => {
    platforms({ health: { ok: false, browserReady: false, mode: "headed" }, healthStatus: 200 });
    expect((await run({ env })).reason).toBe("worker /health is not ok (HTTP 200)");
    server.resetHandlers();
    platforms({ health: { ok: true, browserReady: false, mode: "headed" } });
    expect((await run({ env })).reason).toBe("worker /health: browser not ready");
  });

  it("reports an API refusal in one line without leaking the token", async () => {
    platforms();
    server.use(http.get(VERCEL, () => HttpResponse.json({ error: { code: "forbidden" } }, { status: 403 })));
    const verdict = await run({ env: { ...env, VERCEL_TOKEN: "secret-token-value" } });
    expect(verdict).toEqual({ ok: false, reason: "Vercel: api.vercel.com answered 403 (forbidden)" });
    expect(verdict.reason).not.toContain("secret-token-value");
  });

  it("reads main from git ls-remote when MAIN_SHA is not set", async () => {
    platforms();
    const calls: string[][] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return `${SHA}\trefs/heads/main\n`;
    };
    expect((await run({ env: {}, exec })).ok).toBe(true);
    expect(calls).toEqual([["git", "ls-remote", "origin", "refs/heads/main"]]);
  });

  it("assess rejects a missing main commit first", () => {
    expect(assess({ main: null, vercel: null, railway: null, health: { status: 200, ok: true, browserReady: true } })).toEqual({ ok: false, reason: "could not read the main commit" });
  });
});
