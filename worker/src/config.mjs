/** Worker configuration, all from environment variables. */

function int(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
}

export const config = {
  port: int("PORT", 8080),
  /** Shared secret; the app sends it as `Authorization: Bearer <token>`. */
  token: process.env.WORKER_TOKEN ?? "",
  /** Registrable domains the worker will ever open. */
  allowedHosts: (process.env.ALLOWED_HOSTS ?? "ajptour.com,smoothcomp.com")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
  /** "new" (Chromium new headless, least detectable), "shell" (Playwright headless shell) or "headed" (needs Xvfb). */
  headless: (process.env.HEADLESS ?? "new").toLowerCase(),
  /**
   * Browser automation engine: "playwright" (default) or "patchright", a
   * drop-in Playwright fork that hides the automation fingerprints Cloudflare
   * looks for. Patchright ships its own Chromium (installed in the Dockerfile).
   */
  engine: (process.env.ENGINE ?? "playwright").toLowerCase(),
  /** Persistent Chromium profile so Cloudflare clearance cookies survive restarts. Mount a volume here on Railway. */
  profileDir: process.env.PROFILE_DIR ?? "/data/profile",
  /** Optional: connect to an external browser over CDP instead of launching Chromium (e.g. a browser-as-a-service with residential IPs). */
  browserWsEndpoint: process.env.BROWSER_WS_ENDPOINT ?? "",
  navTimeoutMs: int("NAV_TIMEOUT_MS", 45_000),
  /** How long to wait for a Cloudflare managed challenge to clear on its own. */
  challengeWaitMs: int("CHALLENGE_WAIT_MS", 35_000),
  maxConcurrency: int("MAX_CONCURRENCY", 2),
  maxHtmlBytes: int("MAX_HTML_BYTES", 3 * 1024 * 1024),
  /** Bounded readiness: how long to wait for the app to hydrate a schedule after the challenge cleared. */
  readyWaitMs: int("READY_WAIT_MS", 15_000),
  /** Bounded expansion: extra pages (next / load more) and scroll passes (virtualised rows) per render. */
  maxExpandPages: int("MAX_EXPAND_PAGES", 4),
  maxScrollPasses: int("MAX_SCROLL_PASSES", 6),
  maxFrames: int("MAX_FRAMES", 4),
  userAgent:
    process.env.USER_AGENT ??
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  /** Extra Chromium flags, space separated (e.g. "--ignore-certificate-errors" behind a corporate proxy). */
  extraArgs: (process.env.CHROMIUM_EXTRA_ARGS ?? "").split(/\s+/).filter(Boolean),
  /** Optional HTTP(S) or SOCKS proxy for the browser, e.g. http://user:pass@host:port (residential IPs clear Cloudflare). */
  proxyServer: (process.env.BROWSER_PROXY ?? "").trim(),
  /** With a proxy: skip images, media and fonts so a per-GB residential plan is not spent on page chrome. */
  proxyBlockAssets: process.env.PROXY_BLOCK_ASSETS === "1",
  locale: process.env.LOCALE ?? "en-GB",
  timezone: process.env.TZ_ID ?? "Asia/Qatar",
  /** Optional scheduler: call the app's cron endpoint every N seconds so refreshes run while phones are locked. */
  schedule: {
    seconds: int("SCHEDULE_SECONDS", 0),
    /** Independent notification runner tick (reminders + Telegram sends). 0 disables; defaults to 30 s when the refresh loop is on. */
    deliverySeconds: process.env.DELIVERY_SECONDS === undefined ? (int("SCHEDULE_SECONDS", 0) ? 30 : 0) : int("DELIVERY_SECONDS", 0),
    /** Payment confirmation job tick (/api/cron/payments). 0 (default) disables; see docs/payments.md. */
    paymentsSeconds: int("PAYMENTS_SECONDS", 0),
    appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
    cronSecret: process.env.CRON_SECRET ?? "",
  },
};

/**
 * Playwright keeps only `protocol//host` of `proxy.server` and reads the
 * login from `username`/`password`, so credentials embedded in the URL must
 * be split out here or the proxy answers 407 to every request.
 * @returns {{server:string, username?:string, password?:string} | null}
 */
export function proxyOptions() {
  if (!config.proxyServer) return null;
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(config.proxyServer) ? config.proxyServer : `http://${config.proxyServer}`);
  const out = { server: `${url.protocol}//${url.host}` };
  if (url.username) out.username = decodeURIComponent(url.username);
  if (url.password) out.password = decodeURIComponent(url.password);
  return out;
}

/** Chromium rejects anything but an IANA zone id ("London" is not one; "Europe/London" is). */
export function isValidTimezone(id) {
  if (typeof id !== "string" || !id.includes("/") && id !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

export function validateConfig() {
  const problems = [];
  if (config.proxyServer) {
    try {
      proxyOptions();
    } catch {
      problems.push("BROWSER_PROXY must look like http://user:pass@host:port");
    }
  }
  if (!config.token || config.token.length < 16) problems.push("WORKER_TOKEN must be set (16+ random characters)");
  if (!["new", "shell", "headed"].includes(config.headless)) problems.push("HEADLESS must be new, shell or headed");
  if (!["playwright", "patchright"].includes(config.engine)) problems.push("ENGINE must be playwright or patchright");
  if (!isValidTimezone(config.timezone)) problems.push(`TZ_ID must be an IANA zone such as Europe/London (got "${config.timezone}")`);
  if ((config.schedule.seconds || config.schedule.deliverySeconds || config.schedule.paymentsSeconds) && (!config.schedule.appUrl || !config.schedule.cronSecret)) {
    problems.push("SCHEDULE_SECONDS / DELIVERY_SECONDS require APP_URL and CRON_SECRET");
  }
  return problems;
}
