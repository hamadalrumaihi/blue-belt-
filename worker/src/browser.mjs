import { config, proxyOptions } from "./config.mjs";
import { log } from "./log.mjs";
import { assessReadiness, findPaginationHint } from "./readiness.mjs";

/** Loads the selected engine lazily so a missing optional package only fails when used. */
async function loadChromium() {
  const mod = config.engine === "patchright" ? await import("patchright") : await import("playwright");
  return mod.chromium;
}

/**
 * Owns a single Chromium instance (persistent profile) and renders pages.
 * The persistent profile keeps Cloudflare's `cf_clearance` cookie between
 * requests and restarts, so once a challenge is solved the site stays open
 * for the cookie's lifetime.
 */

const CHALLENGE_RE = /just a moment|attention required|cf-chl|challenge-platform|_cf_chl_opt/i;

let context = null;
let launching = null;
let shuttingDown = false;
let active = 0;
const queue = [];

const BLOCKED_RESOURCES = new Set(["image", "media", "font"]);
const CLOSED_RE = /Target page, context or browser has been closed|browser has been closed|Target closed|Session closed|has been closed/i;

function launchArgs() {
  const args = ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"];
  if (config.headless === "new") args.push("--headless=new");
  if (process.env.CHROMIUM_NO_SANDBOX === "1") args.push("--no-sandbox");
  args.push(...config.extraArgs);
  return args;
}

export async function getContext() {
  if (shuttingDown) throw new Error("Worker is shutting down; browser has been closed");
  if (context) return context;
  if (launching) return launching;
  launching = (async () => {
    const chromium = await loadChromium();
    if (config.browserWsEndpoint) {
      const browser = await chromium.connectOverCDP(config.browserWsEndpoint);
      context = browser.contexts()[0] ?? (await browser.newContext({ locale: config.locale, timezoneId: config.timezone }));
      browser.on("disconnected", () => { context = null; });
      return context;
    }
    // Patchright's guidance: persistent context, no custom user agent, no
    // viewport override, and no extra "stealth" flags; it patches the rest.
    const stealth = config.engine === "patchright";
    context = await chromium.launchPersistentContext(config.profileDir, {
      headless: config.headless !== "headed",
      args: stealth ? launchArgs().filter((a) => a !== "--disable-blink-features=AutomationControlled") : launchArgs(),
      ...(stealth ? { viewport: null } : { userAgent: config.userAgent, viewport: { width: 1280, height: 800 }, ignoreDefaultArgs: ["--enable-automation"] }),
      locale: config.locale,
      timezoneId: config.timezone,
      ignoreHTTPSErrors: config.extraArgs.includes("--ignore-certificate-errors"),
      proxy: proxyOptions() ?? undefined,
    });
    context.on("close", () => { context = null; });
    return context;
  })();
  try {
    return await launching;
  } finally {
    launching = null;
  }
}

function acquire() {
  if (active < config.maxConcurrency) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next();
  else active -= 1;
}

/**
 * Renders `url` and returns the page HTML once any bot challenge has cleared.
 * @returns {Promise<{ok:true, html:string, finalUrl:string, status:number|null, elapsedMs:number} | {ok:false, code:string, message:string, elapsedMs:number}>}
 */
export async function render(url, { waitForSelector } = {}) {
  const started = Date.now();
  await acquire();
  try {
    const first = await renderOnce(url, waitForSelector, started);
    // A closed context (browser crash, or the context closing under a
    // request) is not a verdict on the page: relaunch and try once more.
    if (!first.ok && first.code === "BROWSER_CLOSED" && !shuttingDown) {
      log.warn("browser.context_closed_retry", { host: safeHost(url) });
      await resetContext();
      return renderOnce(url, waitForSelector, started);
    }
    return first;
  } finally {
    release();
  }
}

async function resetContext() {
  const ctx = context;
  context = null;
  await ctx?.close().catch(() => undefined);
}

async function renderOnce(url, waitForSelector, started) {
  let page;
  let ctx = null;
  try {
    ctx = await getContext();
    page = await ctx.newPage();
    page.setDefaultNavigationTimeout(config.navTimeoutMs);
    if (config.proxyServer && config.proxyBlockAssets) {
      await page.route("**/*", (route) => (BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()));
    }
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (response?.status() === 407) {
      return { ok: false, code: "PROXY_AUTH_FAILED", message: "The proxy rejected the BROWSER_PROXY credentials (HTTP 407).", elapsedMs: Date.now() - started };
    }

    // Let a managed challenge resolve itself (it reloads the page when done).
    const deadline = Date.now() + config.challengeWaitMs;
    let challenged = await isChallenged(page);
    while (challenged && Date.now() < deadline) {
      await page.waitForTimeout(1500);
      challenged = await isChallenged(page);
    }
    if (challenged) {
      const kind = await challengeKind(page);
      const message =
        kind === "interactive"
          ? "The site shows an interactive CAPTCHA (Turnstile); it cannot be cleared automatically. Open the source page by hand."
          : "The site's automatic bot challenge did not clear in time.";
      return { ok: false, code: "CHALLENGE_NOT_CLEARED", message, challengeKind: kind, status: response?.status() ?? null, elapsedMs: Date.now() - started };
    }

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10_000 }).catch(() => undefined);
    } else {
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    }

    // Bounded readiness: the challenge cleared, but the page may still be an
    // empty app shell, a login form, an error page or another page entirely.
    const status = response?.status() ?? null;
    const ready = await waitForReady(page, { url, status, deadline: Date.now() + config.readyWaitMs });
    if (!ready.verdict.ready) {
      return { ok: false, code: "PAGE_NOT_READY", message: NOT_READY_MESSAGE[ready.verdict.reason] ?? `The page never became ready (${ready.verdict.reason}).`, readiness: ready.verdict.reason, status, elapsedMs: Date.now() - started };
    }

    // Bounded expansion: virtualised rows, "load more" / next pages and
    // same-origin frames, each capped by config. Labels what was captured.
    const expanded = ready.verdict.hasSchedule ? await expandSchedule(page, ready.html) : { html: ready.html, completeness: "complete", pages: 1, frames: 0 };
    if (expanded.html.length > config.maxHtmlBytes) {
      return { ok: false, code: "TOO_LARGE", message: `Page exceeded ${config.maxHtmlBytes} bytes.`, elapsedMs: Date.now() - started };
    }
    return { ok: true, html: expanded.html, finalUrl: page.url(), status, elapsedMs: Date.now() - started, readiness: ready.verdict.reason, completeness: expanded.completeness, pages: expanded.pages, frames: expanded.frames };
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    // The context's own close handler nulls `context`, so a context that is
    // no longer the live one died under this request (crash, or closed by a
    // restart), whatever error the aborted navigation reported.
    const contextGone = ctx !== null && (await isContextGone(ctx));
    const code = shuttingDown
      ? "WORKER_RESTARTING"
      : contextGone || CLOSED_RE.test(message)
        ? "BROWSER_CLOSED"
        : /ERR_PROXY_|ERR_TUNNEL_CONNECTION_FAILED|ERR_NO_SUPPORTED_PROXIES/.test(message)
          ? "PROXY_ERROR"
          : /timeout/i.test(message)
            ? "TIMEOUT"
            : "NAVIGATION_ERROR";
    return { ok: false, code, message, elapsedMs: Date.now() - started };
  } finally {
    await page?.close().catch(() => undefined);
  }
}

const NOT_READY_MESSAGE = {
  HTTP_ERROR: "The source returned an error status.",
  LOGIN_PAGE: "The page showed a login form instead of a schedule.",
  ERROR_PAGE: "The source showed an error page.",
  UNHYDRATED: "The page never rendered its schedule (empty application shell).",
  CHALLENGE: "The site's bot challenge did not clear.",
};

const READY_POLL_MS = 750;

/**
 * Polls readiness until the page is ready, a terminal verdict is reached or
 * the deadline passes. Returns the last verdict and the HTML it was based on.
 */
async function waitForReady(page, { url, status, deadline }) {
  let html = "";
  let verdict = { ready: false, reason: "UNHYDRATED", hasSchedule: false, terminal: false };
  for (;;) {
    html = await page.content();
    verdict = assessReadiness({ html, status, finalUrl: page.url(), requestedUrl: url });
    if (verdict.ready || verdict.terminal || Date.now() >= deadline) return { verdict, html };
    await page.waitForTimeout(READY_POLL_MS);
  }
}

const NEXT_SELECTOR = "a[rel='next'], .pagination a[href*='page='], button[class*='load-more'], button[class*='show-more'], a[class*='load-more']";

/**
 * Expands a schedule page within fixed bounds and reports completeness:
 *   complete  no further rows/pages were offered and every bound was respected
 *   partial   a bound stopped the expansion (more rows or pages may exist)
 *   unknown   expansion threw; the first page's HTML is returned
 * Extra pages are appended inside the first document's body so the app's
 * parser sees all rows in one HTML.
 */
async function expandSchedule(page, firstHtml) {
  const parts = [];
  let pages = 1;
  let frames = 0;
  let partial = false;
  try {
    // Virtualised / lazy rows: scroll to the bottom until the height settles.
    let lastHeight = -1;
    let passes = 0;
    for (; passes < config.maxScrollPasses; passes += 1) {
      const height = await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); return document.body.scrollHeight; });
      if (height === lastHeight) break;
      lastHeight = height;
      await page.waitForTimeout(400);
    }
    if (passes >= config.maxScrollPasses) partial = true;
    let html = await page.content();

    // Next / load-more pages.
    while (pages < config.maxExpandPages + 1 && findPaginationHint(html)) {
      const control = page.locator(NEXT_SELECTOR).first();
      if ((await control.count()) === 0) break;
      const before = html;
      await control.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      html = await page.content();
      if (html === before) break;
      pages += 1;
      parts.push(`<section data-bbm-page="${pages}">${bodyOf(html)}</section>`);
    }
    if (findPaginationHint(html) && pages >= config.maxExpandPages + 1) partial = true;

    // Same-origin frames that may hold the schedule.
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (frames >= config.maxFrames) { partial = true; break; }
      if (!sameOrigin(frame.url(), page.url())) continue;
      const fhtml = await frame.content().catch(() => "");
      if (!fhtml) continue;
      frames += 1;
      parts.push(`<section data-bbm-frame="${frames}">${bodyOf(fhtml)}</section>`);
    }

    const base = pages > 1 || passes > 0 ? html : firstHtml;
    return { html: parts.length ? inject(base, parts.join("")) : base, completeness: partial ? "partial" : "complete", pages, frames };
  } catch {
    return { html: firstHtml, completeness: "unknown", pages, frames };
  }
}

function bodyOf(html) {
  const m = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return m ? m[1] : html;
}

function inject(html, extra) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${extra}</body>`) : html + extra;
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * True when `ctx` can no longer open pages. A navigation aborted by a closing
 * context can reject before the context's own close event has run, so this
 * waits a beat for that handler and then probes the context directly.
 */
async function isContextGone(ctx) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (context !== ctx) return true;
  try {
    const probe = await Promise.race([
      ctx.newPage(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("probe timeout")), 3_000)),
    ]);
    await probe.close().catch(() => undefined);
    return false;
  } catch (err) {
    return CLOSED_RE.test(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Classifies a challenge page that did not clear: "interactive" when a
 * Turnstile widget (user must click / solve) is present, "managed" for the
 * automatic JavaScript check, "unknown" when the page could not be read.
 * Diagnostic only; nothing here attempts to solve either.
 */
async function challengeKind(page) {
  try {
    const found = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const turnstile = /challenges\.cloudflare\.com\/turnstile|cf-turnstile|turnstile_|data-sitekey/i.test(html) || Boolean(document.querySelector("iframe[src*='challenges.cloudflare.com']"));
      const managed = /cf-chl|challenge-platform|_cf_chl_opt|just a moment/i.test(html);
      return { turnstile, managed };
    });
    if (found.turnstile) return "interactive";
    if (found.managed) return "managed";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function isChallenged(page) {
  try {
    const title = await page.title();
    if (CHALLENGE_RE.test(title)) return true;
    const head = await page.evaluate(() => document.documentElement.outerHTML.slice(0, 20000));
    return CHALLENGE_RE.test(head);
  } catch {
    return true;
  }
}

function safeHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "-";
  }
}

export async function shutdown() {
  shuttingDown = true;
  await resetContext();
}

export function stats() {
  return {
    active,
    queued: queue.length,
    browserReady: Boolean(context),
    mode: config.browserWsEndpoint ? "cdp" : config.headless,
    engine: config.engine,
    proxy: config.proxyServer ? proxyOptions()?.server ?? "invalid" : null,
  };
}
