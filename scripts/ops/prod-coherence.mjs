#!/usr/bin/env node
// "Is production coherent?" One read-only check across Vercel, Railway and the
// worker, answered with exit code 0 (one line: the shared commit) or 1 (one
// line: the first thing that differs).
//
//   node scripts/ops/prod-coherence.mjs
//   npm run ops:coherence
//
// Checks, in order: GitHub `main` head (git ls-remote, or MAIN_SHA), the latest
// Vercel production deployment (READY, built from main), the latest Railway
// deployment of the worker (SUCCESS, built from main), the worker's public
// /health (ok and browserReady), and that all three name the same commit.
//
// Credentials come from the environment and are never printed:
//   VERCEL_TOKEN   Vercel token with read access to the project's deployments.
//   RAILWAY_TOKEN  Railway account / workspace token (sent as a Bearer token).
// Either may be omitted where a proxy injects the credential. Every id below
// can be overridden with the env var of the same name.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULTS = {
  VERCEL_TEAM_ID: "team_pIA1MXrlQGKiPGr5SAtdYMXi",
  VERCEL_PROJECT_ID: "prj_yBNZa9kYn2TSWDH4nUTWSurC2ICK",
  RAILWAY_PROJECT_ID: "1b9f1330-37dc-4545-8e2b-f7a0a6365b62",
  RAILWAY_ENVIRONMENT_ID: "d83f35b0-d727-48fc-b8a7-36acfc68b5e6",
  RAILWAY_SERVICE_ID: "b0bbd0d4-8cbc-44db-96dc-213ab8cac118",
  WORKER_URL: "https://blue-belt-production.up.railway.app",
  GIT_REMOTE: "origin",
};

const TIMEOUT_MS = 15_000;

function settings(env) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, env[k] || v]));
}

const short = (sha) => (sha ? String(sha).slice(0, 7) : "unknown");

async function getJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}${body?.error?.code ? ` (${body.error.code})` : ""}`);
  return body;
}

export async function readVercel(fetchImpl, s, env) {
  const url = `https://api.vercel.com/v6/deployments?projectId=${s.VERCEL_PROJECT_ID}&teamId=${s.VERCEL_TEAM_ID}&target=production&limit=1`;
  const headers = env.VERCEL_TOKEN ? { authorization: `Bearer ${env.VERCEL_TOKEN}` } : {};
  const body = await getJson(fetchImpl, url, { headers });
  const d = body?.deployments?.[0];
  if (!d) return null;
  return { id: d.uid, state: d.state ?? d.readyState ?? null, sha: d.meta?.githubCommitSha ?? null, ref: d.meta?.githubCommitRef ?? null };
}

export async function readRailway(fetchImpl, s, env) {
  const query = `query($input: DeploymentListInput!) { deployments(first: 1, input: $input) { edges { node { id status meta } } } }`;
  const variables = { input: { projectId: s.RAILWAY_PROJECT_ID, environmentId: s.RAILWAY_ENVIRONMENT_ID, serviceId: s.RAILWAY_SERVICE_ID } };
  const headers = { "content-type": "application/json", ...(env.RAILWAY_TOKEN ? { authorization: `Bearer ${env.RAILWAY_TOKEN}` } : {}) };
  const body = await getJson(fetchImpl, "https://backboard.railway.com/graphql/v2", { method: "POST", headers, body: JSON.stringify({ query, variables }) });
  if (body?.errors?.length) throw new Error(`Railway: ${body.errors[0].message}`);
  const n = body?.data?.deployments?.edges?.[0]?.node;
  if (!n) return null;
  return { id: n.id, status: n.status ?? null, sha: n.meta?.commitHash ?? null, ref: n.meta?.branch ?? null };
}

export async function readHealth(fetchImpl, s) {
  const res = await fetchImpl(`${s.WORKER_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: body?.ok === true, browserReady: body?.browserReady === true, mode: body?.mode ?? null };
}

export function readMainSha(env, s, exec = execFileSync) {
  if (env.MAIN_SHA) return env.MAIN_SHA.trim();
  const out = exec("git", ["ls-remote", s.GIT_REMOTE, "refs/heads/main"], { encoding: "utf8", timeout: TIMEOUT_MS });
  return out.split(/\s+/)[0] || null;
}

/** Pure verdict over what was read. The first problem wins; the order is the order a human would look. */
export function assess({ main, vercel, railway, health }) {
  if (!main) return { ok: false, reason: "could not read the main commit" };
  if (!vercel) return { ok: false, reason: "Vercel: no production deployment found" };
  if (vercel.state !== "READY") return { ok: false, reason: `Vercel: production deployment ${vercel.id} is ${vercel.state}` };
  if (!railway) return { ok: false, reason: "Railway: no deployment found for the worker" };
  if (railway.status !== "SUCCESS") return { ok: false, reason: `Railway: latest deployment ${railway.id} is ${railway.status}` };
  if (health.status !== 200 || !health.ok) return { ok: false, reason: `worker /health is not ok (HTTP ${health.status})` };
  if (!health.browserReady) return { ok: false, reason: "worker /health: browser not ready" };
  if (vercel.sha !== railway.sha) return { ok: false, reason: `Vercel is on ${short(vercel.sha)} but Railway is on ${short(railway.sha)}` };
  if (vercel.sha !== main) return { ok: false, reason: `production is on ${short(vercel.sha)} but main is ${short(main)}` };
  return { ok: true, reason: `coherent: Vercel and Railway both on main ${short(main)}, worker healthy (${health.mode ?? "unknown mode"})` };
}

/**
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, exec?: (cmd: string, args: string[], opts?: object) => string }} [opts]
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export async function run({ env = process.env, fetchImpl = fetch, exec = execFileSync } = {}) {
  const s = settings(env);
  const step = async (label, fn) => {
    try {
      return { value: await fn() };
    } catch (err) {
      return { error: `${label}: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
  const [main, vercel, railway, health] = await Promise.all([
    step("main", () => readMainSha(env, s, exec)),
    step("Vercel", () => readVercel(fetchImpl, s, env)),
    step("Railway", () => readRailway(fetchImpl, s, env)),
    step("worker /health", () => readHealth(fetchImpl, s)),
  ]);
  const failed = [main, vercel, railway, health].find((r) => r.error);
  if (failed) return { ok: false, reason: failed.error };
  return assess({ main: main.value, vercel: vercel.value, railway: railway.value, health: health.value });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const verdict = await run();
  (verdict.ok ? console.log : console.error)(verdict.reason);
  process.exit(verdict.ok ? 0 : 1);
}
