import { config } from "./config.mjs";

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
let active = 0;
const queue = [];

function launchArgs() {
  const args = ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"];
  if (config.headless === "new") args.push("--headless=new");
  if (process.env.CHROMIUM_NO_SANDBOX === "1") args.push("--no-sandbox");
  args.push(...config.extraArgs);
  return args;
}

export async function getContext() {
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
      proxy: config.proxyServer ? { server: config.proxyServer } : undefined,
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
  let page;
  try {
    const ctx = await getContext();
    page = await ctx.newPage();
    page.setDefaultNavigationTimeout(config.navTimeoutMs);
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });

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
    const code = /timeout/i.test(message) ? "TIMEOUT" : "NAVIGATION_ERROR";
    return { ok: false, code, message, elapsedMs: Date.now() - started };
  } finally {
    await page?.close().catch(() => undefined);
    release();
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
  const ctx = context;
  context = null;
  await ctx?.close().catch(() => undefined);
}

export function stats() {
  return { active, queued: queue.length, browserReady: Boolean(context), mode: config.browserWsEndpoint ? "cdp" : config.headless, engine: config.engine };
}
