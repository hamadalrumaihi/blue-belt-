import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config, validateConfig } from "./config.mjs";
import { getContext, render, shutdown, stats } from "./browser.mjs";
import { log } from "./log.mjs";
import { startScheduler } from "./scheduler.mjs";
import { validateTargetUrl } from "./url-policy.mjs";

/**
 * Blue Belt Media — Tournament Watcher render worker.
 *
 *   GET  /health            liveness. Unauthenticated: { ok, browserReady, mode } only.
 *                           With the worker token: config problems, queue depth, uptime, engine, proxy host.
 *   POST /render            { url, waitForSelector? } -> { ok, html, finalUrl, status, elapsedMs, strategy, fetchedAt }
 *                           or { ok: false, code, message, status?, finalUrl?, elapsedMs }
 *
 * /render needs `Authorization: Bearer <WORKER_TOKEN>`. Only https URLs on
 * the allow-listed hosts (no credentials, no custom ports, no IP literals)
 * are ever opened, and the page the browser lands on after redirects must
 * pass the same policy or the HTML is discarded.
 */

// Misconfiguration is reported on /health and blocks /render, but never
// prevents the process from starting: a crash-looping container is much
// harder to diagnose on Railway than a health response that names the problem.
const configErrors = validateConfig();
for (const p of configErrors) log.error("config.invalid", { problem: p });

export function createServer(deps = {}) {
  const renderImpl = deps.render ?? render;
  const statsImpl = deps.stats ?? stats;
  const errors = deps.configErrors ?? configErrors;
  const token = deps.token ?? config.token;
  const allowedHosts = deps.allowedHosts ?? config.allowedHosts;

  function authorized(req) {
    const header = req.headers.authorization ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!supplied || !token || supplied.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  }

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const requestId = requestIdFrom(req);
    const url = new URL(req.url ?? "/", "http://localhost");
    const reqLog = log.child({ requestId, method: req.method, path: url.pathname });
    res.setHeader("x-request-id", requestId);

    if (req.method === "GET" && url.pathname === "/health") {
      const s = statsImpl();
      const publicView = { ok: errors.length === 0, browserReady: s.browserReady, mode: s.mode };
      if (!authorized(req)) return json(res, 200, publicView);
      return json(res, 200, { ...publicView, configErrors: errors, ...s, uptimeSec: Math.round(process.uptime()) });
    }

    if (errors.length) return json(res, 503, { ok: false, code: "MISCONFIGURED", message: "Worker is misconfigured; see /health with the worker token." });
    if (!authorized(req)) {
      reqLog.warn("auth.rejected");
      return json(res, 401, { ok: false, code: "UNAUTHORIZED", message: "Missing or invalid worker token." });
    }

    if (req.method === "POST" && url.pathname === "/render") {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch (err) {
        return json(res, err?.message === "Body too large" ? 413 : 400, { ok: false, code: "BAD_REQUEST", message: err?.message === "Body too large" ? "Body too large." : "Invalid JSON body." });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { ok: false, code: "BAD_REQUEST", message: "Body must be a JSON object." });
      const policy = validateTargetUrl(body.url, allowedHosts);
      if (!policy.ok) return json(res, policy.code === "UNSUPPORTED_HOST" ? 403 : 400, { ok: false, code: policy.code, message: policy.message });
      const waitForSelector = typeof body.waitForSelector === "string" && body.waitForSelector.length <= 200 ? body.waitForSelector : undefined;

      const target = policy.url;
      const result = await renderImpl(target.toString(), { waitForSelector });
      const elapsedMs = result.elapsedMs ?? Date.now() - started;

      if (result.ok) {
        const landed = validateTargetUrl(result.finalUrl, allowedHosts);
        if (!landed.ok) {
          reqLog.warn("render.redirect_blocked", { host: target.hostname, path: target.pathname, landedHost: safeHost(result.finalUrl), elapsedMs });
          return json(res, 502, { ok: false, code: "REDIRECT_BLOCKED", message: "Page redirected outside the allow-listed hosts.", status: result.status ?? null, elapsedMs, strategy: "browser" });
        }
        reqLog.info("render.ok", { host: target.hostname, path: target.pathname, status: result.status ?? null, bytes: result.html.length, elapsedMs, landedPath: landed.url.pathname });
        return json(res, 200, { ok: true, html: result.html, finalUrl: landed.url.toString(), status: result.status ?? null, elapsedMs, strategy: "browser", fetchedAt: new Date().toISOString() });
      }

      reqLog.info("render.failed", { host: target.hostname, path: target.pathname, code: result.code, status: result.status ?? null, elapsedMs });
      return json(res, 502, { ok: false, code: result.code, message: result.message, status: result.status ?? null, elapsedMs, strategy: "browser", fetchedAt: new Date().toISOString() });
    }

    return json(res, 404, { ok: false, code: "NOT_FOUND", message: "Unknown route." });
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        // Stop buffering but keep draining so the 413 can still be written on
        // the open connection instead of resetting it.
        tooLarge = true;
        chunks.length = 0;
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{4,128}$/;
function requestIdFrom(req) {
  const supplied = req.headers["x-request-id"];
  if (typeof supplied === "string" && REQUEST_ID_RE.test(supplied)) return supplied;
  return crypto.randomUUID();
}

function safeHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "-";
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const server = createServer();
  server.listen(config.port, "0.0.0.0", () => {
    log.info("worker.listening", { port: config.port, mode: config.browserWsEndpoint ? "cdp" : config.headless, engine: config.engine, hosts: config.allowedHosts, proxy: Boolean(config.proxyServer) });
    if (configErrors.length) log.error("worker.not_ready", { problems: configErrors });
    // Warm the browser so the first request is fast; failures surface in /health.
    getContext().then(
      () => log.info("browser.ready"),
      (err) => log.error("browser.launch_failed", { error: err.message }),
    );
    startScheduler();
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      log.info("worker.shutdown", { signal });
      server.close();
      await shutdown();
      process.exit(0);
    });
  }
}
