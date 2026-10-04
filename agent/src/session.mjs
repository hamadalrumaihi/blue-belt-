import { assessReadiness } from "./readiness.mjs";

/**
 * One browser session for the whole event day: a single persistent context
 * (dedicated profile, outside the user's normal Chrome profile) and one tab
 * per source, kept open between captures so cookies, the solved bot check and
 * the page's own state survive. The window is visible on purpose: when the
 * site asks for a human check, the photographer solves it in that window and
 * the agent resumes by itself.
 */
const CHALLENGE_RE = /just a moment|attention required|cf-chl|challenge-platform|_cf_chl_opt|enable javascript and cookies to continue/i;
const READY_POLL_MS = 750;

export function createSession(config, log) {
  let context = null;
  const tabs = new Map(); // sourceKey -> page

  async function ensureContext() {
    if (context) return context;
    const { chromium } = await import("playwright");
    const launch = {
      headless: config.headless,
      viewport: config.headless ? { width: 1280, height: 900 } : null,
      args: ["--no-first-run", "--no-default-browser-check"],
    };
    if (config.browserChannel !== "chromium") launch.channel = config.browserChannel;
    context = await chromium.launchPersistentContext(config.profileDir, launch);
    context.on("close", () => {
      context = null;
      tabs.clear();
    });
    log.info("session.started", { channel: config.browserChannel, headless: config.headless });
    return context;
  }

  async function tabFor(sourceKey) {
    const ctx = await ensureContext();
    const existing = tabs.get(sourceKey);
    if (existing && !existing.isClosed()) return existing;
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(config.navTimeoutMs);
    tabs.set(sourceKey, page);
    return page;
  }

  return {
    /**
     * Loads (or reloads) the source in its tab and waits, bounded, for a ready
     * page. Returns { ok, html, finalUrl, status, readiness, completeness }
     * or { ok:false, code, readiness } where code is CHALLENGE (needs a human),
     * PAGE_NOT_READY (login/error/wrong page) or NAVIGATION_ERROR.
     */
    async capture(job) {
      const page = await tabFor(job.sourceKey);
      let status = null;
      try {
        const response = page.url() === "about:blank" || !sameOrigin(page.url(), job.url) ? await page.goto(job.url, { waitUntil: "domcontentloaded" }) : await page.reload({ waitUntil: "domcontentloaded" });
        status = response?.status() ?? null;
      } catch (err) {
        return { ok: false, code: "NAVIGATION_ERROR", message: err instanceof Error ? err.message.split("\n")[0] : String(err) };
      }
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);

      const deadline = Date.now() + config.readyWaitMs;
      let html = "";
      let verdict;
      for (;;) {
        html = await page.content().catch(() => "");
        if (CHALLENGE_RE.test(html.slice(0, 30_000))) return { ok: false, code: "CHALLENGE", readiness: "CHALLENGE" };
        verdict = assessReadiness({ html, status, finalUrl: page.url(), requestedUrl: job.url });
        if (verdict.ready || verdict.terminal || Date.now() >= deadline) break;
        await page.waitForTimeout(READY_POLL_MS);
      }
      if (!verdict.ready) return { ok: false, code: "PAGE_NOT_READY", readiness: verdict.reason };
      if (html.length > config.maxHtmlBytes) return { ok: false, code: "TOO_LARGE", readiness: verdict.reason };
      // The agent captures what one tab shows; pagination is the worker's job. Label honestly.
      return { ok: true, html, finalUrl: page.url(), status, readiness: verdict.reason, completeness: verdict.hasSchedule ? "unknown" : "complete" };
    },

    /** True once the tab no longer shows the challenge (the human solved it). */
    async challengeCleared(sourceKey) {
      const page = tabs.get(sourceKey);
      if (!page || page.isClosed()) return true;
      const html = await page.content().catch(() => "");
      return !CHALLENGE_RE.test(html.slice(0, 30_000));
    },

    async bringToFront(sourceKey) {
      const page = tabs.get(sourceKey);
      if (page && !page.isClosed()) await page.bringToFront().catch(() => undefined);
    },

    async close() {
      const ctx = context;
      context = null;
      tabs.clear();
      await ctx?.close().catch(() => undefined);
    },

    isOpen() {
      return Boolean(context);
    },
  };
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
