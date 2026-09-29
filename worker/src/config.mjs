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
  /** Persistent Chromium profile so Cloudflare clearance cookies survive restarts. Mount a volume here on Railway. */
  profileDir: process.env.PROFILE_DIR ?? "/data/profile",
  /** Optional: connect to an external browser over CDP instead of launching Chromium (e.g. a browser-as-a-service with residential IPs). */
  browserWsEndpoint: process.env.BROWSER_WS_ENDPOINT ?? "",
  navTimeoutMs: int("NAV_TIMEOUT_MS", 45_000),
  /** How long to wait for a Cloudflare managed challenge to clear on its own. */
  challengeWaitMs: int("CHALLENGE_WAIT_MS", 35_000),
  maxConcurrency: int("MAX_CONCURRENCY", 2),
  maxHtmlBytes: int("MAX_HTML_BYTES", 3 * 1024 * 1024),
  userAgent:
    process.env.USER_AGENT ??
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  /** Extra Chromium flags, space separated (e.g. "--ignore-certificate-errors" behind a corporate proxy). */
  extraArgs: (process.env.CHROMIUM_EXTRA_ARGS ?? "").split(/\s+/).filter(Boolean),
  /** Optional HTTP(S) proxy for the browser, e.g. http://user:pass@host:port. */
  proxyServer: process.env.BROWSER_PROXY ?? "",
  locale: process.env.LOCALE ?? "en-GB",
  timezone: process.env.TZ_ID ?? "Asia/Qatar",
  /** Optional scheduler: call the app's cron endpoint every N seconds so refreshes run while phones are locked. */
  schedule: {
    seconds: int("SCHEDULE_SECONDS", 0),
    appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
    cronSecret: process.env.CRON_SECRET ?? "",
  },
};

export function validateConfig() {
  const problems = [];
  if (!config.token || config.token.length < 16) problems.push("WORKER_TOKEN must be set (16+ random characters)");
  if (!["new", "shell", "headed"].includes(config.headless)) problems.push("HEADLESS must be new, shell or headed");
  if (config.schedule.seconds && (!config.schedule.appUrl || !config.schedule.cronSecret)) {
    problems.push("SCHEDULE_SECONDS requires APP_URL and CRON_SECRET");
  }
  return problems;
}
