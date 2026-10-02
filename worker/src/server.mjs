import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config, validateConfig } from "./config.mjs";
import { getContext, render, shutdown, stats } from "./browser.mjs";
import { startScheduler } from "./scheduler.mjs";

/**
 * Blue Belt Media — Tournament Watcher render worker.
 *
 *   GET  /health            liveness + browser state
 *   POST /render            { url, waitForSelector? } -> { ok, html, finalUrl, status, elapsedMs }
 *
 * Every request needs `Authorization: Bearer <WORKER_TOKEN>`. Only the
 * allow-listed hosts are ever opened; anything else is refused before the
 * browser is touched.
 */

// Misconfiguration is reported on /health and blocks /render, but never
// prevents the process from starting: a crash-looping container is much
// harder to diagnose on Railway than a health response that names the problem.
const configErrors = validateConfig();
for (const p of configErrors) console.error(`[config] ${p}`);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function authorized(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length !== config.token.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(config.token));
}

export function hostAllowed(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return config.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: configErrors.length === 0, configErrors, ...stats(), uptimeSec: Math.round(process.uptime()) });
  }

  if (configErrors.length) return json(res, 503, { ok: false, code: "MISCONFIGURED", message: configErrors.join("; ") });
  if (!authorized(req)) return json(res, 401, { ok: false, code: "UNAUTHORIZED", message: "Missing or invalid worker token." });

  if (req.method === "POST" && url.pathname === "/render") {
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return json(res, 400, { ok: false, code: "BAD_REQUEST", message: "Invalid JSON body." });
    }
    let target;
    try {
      target = new URL(String(body.url ?? ""));
    } catch {
      return json(res, 400, { ok: false, code: "INVALID_URL", message: "url must be a valid absolute URL." });
    }
    if (target.protocol !== "https:") return json(res, 400, { ok: false, code: "INVALID_URL", message: "Only https URLs are allowed." });
    if (!hostAllowed(target.hostname)) return json(res, 403, { ok: false, code: "UNSUPPORTED_HOST", message: `Host ${target.hostname} is not allow-listed.` });
    target.hash = "";

    const result = await render(target.toString(), { waitForSelector: typeof body.waitForSelector === "string" ? body.waitForSelector : undefined });
    console.log(`[render] ${target.hostname}${target.pathname} -> ${result.ok ? `ok ${result.html.length}b` : result.code} ${result.elapsedMs}ms`);
    return json(res, result.ok ? 200 : 502, { ...result, fetchedAt: new Date().toISOString() });
  }

  return json(res, 404, { ok: false, code: "NOT_FOUND", message: "Unknown route." });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`[worker] listening on 0.0.0.0:${config.port} (mode=${config.browserWsEndpoint ? "cdp" : config.headless}, hosts=${config.allowedHosts.join(",")})`);
  if (configErrors.length) console.error(`[worker] NOT READY: fix the config errors above (see /health). /render will answer 503 until then.`);
  // Warm the browser so the first request is fast; failures surface in /health.
  getContext().then(
    () => console.log("[worker] browser ready"),
    (err) => console.error("[worker] browser launch failed:", err.message),
  );
  startScheduler();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`[worker] ${signal}, shutting down`);
    server.close();
    await shutdown();
    process.exit(0);
  });
}
