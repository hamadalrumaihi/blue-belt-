import { config, proxyOptions } from "./config.mjs";

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
      console.warn(`[browser] context was closed mid-render; relaunching and retrying ${url}`);
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
      return { ok: false, code: "CHALLENGE_NOT_CLEARED", message: "The site's bot challenge did not clear in time.", elapsedMs: Date.now() - started };
    }

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10_000 }).catch(() => undefined);
    } else {
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    }

    const html = await page.content();
    if (html.length > config.maxHtmlBytes) {
      return { ok: false, code: "TOO_LARGE", message: `Page exceeded ${config.maxHtmlBytes} bytes.`, elapsedMs: Date.now() - started };
    }
    return { ok: true, html, finalUrl: page.url(), status: response?.status() ?? null, elapsedMs: Date.now() - started };
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
