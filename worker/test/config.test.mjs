import { describe, test } from "node:test";
import assert from "node:assert/strict";

/**
 * config.mjs reads process.env at import time, so each scenario sets the
 * environment first and imports a fresh copy via a cache-busting query.
 */
let n = 0;
async function loadConfig(env) {
  for (const key of ["BROWSER_PROXY", "WORKER_TOKEN", "HEADLESS", "ENGINE", "SCHEDULE_SECONDS", "APP_URL", "CRON_SECRET", "ALLOWED_HOSTS", "PORT", "MAX_CONCURRENCY", "TZ_ID"]) delete process.env[key];
  Object.assign(process.env, env);
  n += 1;
  return import(`../src/config.mjs?case=${n}`);
}

describe("proxyOptions", () => {
  test("returns null without a proxy", async () => {
    const { proxyOptions } = await loadConfig({});
    assert.equal(proxyOptions(), null);
  });

  test("splits credentials out of the URL and percent-decodes them", async () => {
    const { proxyOptions } = await loadConfig({ BROWSER_PROXY: "http://us%40er:p%40ss%3Aword@proxy.example.com:8080" });
    assert.deepEqual(proxyOptions(), { server: "http://proxy.example.com:8080", username: "us@er", password: "p@ss:word" });
  });

  test("keeps a credential-less proxy as server only and defaults the scheme to http", async () => {
    const { proxyOptions } = await loadConfig({ BROWSER_PROXY: "proxy.example.com:3128" });
    assert.deepEqual(proxyOptions(), { server: "http://proxy.example.com:3128" });
    const socks = await loadConfig({ BROWSER_PROXY: "socks5://user:pw@127.0.0.1:1080" });
    assert.deepEqual(socks.proxyOptions(), { server: "socks5://127.0.0.1:1080", username: "user", password: "pw" });
  });

  test("trims whitespace", async () => {
    const { config, proxyOptions } = await loadConfig({ BROWSER_PROXY: "  http://proxy.example.com:8080  " });
    assert.equal(config.proxyServer, "http://proxy.example.com:8080");
    assert.deepEqual(proxyOptions(), { server: "http://proxy.example.com:8080" });
  });
});

describe("config + validateConfig", () => {
  test("defaults", async () => {
    const { config, validateConfig } = await loadConfig({});
    assert.equal(config.port, 8080);
    assert.deepEqual(config.allowedHosts, ["ajptour.com", "smoothcomp.com"]);
    assert.equal(config.headless, "new");
    assert.equal(config.engine, "playwright");
    assert.equal(config.maxConcurrency, 2);
    assert.equal(config.schedule.seconds, 0);
    assert.deepEqual(validateConfig(), ["WORKER_TOKEN must be set (16+ random characters)"]);
  });

  test("parses lists and integers, ignoring garbage", async () => {
    const { config, validateConfig } = await loadConfig({ WORKER_TOKEN: "x".repeat(24), ALLOWED_HOSTS: " Smoothcomp.com, ,ajptour.com ", PORT: "abc", MAX_CONCURRENCY: "-3" });
    assert.deepEqual(config.allowedHosts, ["smoothcomp.com", "ajptour.com"]);
    assert.equal(config.port, 8080);
    assert.equal(config.maxConcurrency, 2);
    assert.deepEqual(validateConfig(), []);
  });

  test("names every problem", async () => {
    const { validateConfig } = await loadConfig({ WORKER_TOKEN: "short", HEADLESS: "sometimes", ENGINE: "puppeteer", SCHEDULE_SECONDS: "60", BROWSER_PROXY: "http://[bad", TZ_ID: "London" });
    assert.deepEqual(validateConfig(), [
      "BROWSER_PROXY must look like http://user:pass@host:port",
      "WORKER_TOKEN must be set (16+ random characters)",
      "HEADLESS must be new, shell or headed",
      "ENGINE must be playwright or patchright",
      'TZ_ID must be an IANA zone such as Europe/London (got "London")',
      "SCHEDULE_SECONDS requires APP_URL and CRON_SECRET",
    ]);
  });

  test("accepts IANA time zones and rejects city names", async () => {
    const { isValidTimezone } = await loadConfig({ WORKER_TOKEN: "x".repeat(24) });
    for (const ok of ["Europe/London", "Asia/Qatar", "America/New_York", "UTC"]) assert.equal(isValidTimezone(ok), true, ok);
    for (const bad of ["London", "Qatar", "GMT+3", "", "Europe/Nowhere"]) assert.equal(isValidTimezone(bad), false, bad);
  });

  test("scheduler config is complete when all three values are set", async () => {
    const { config, validateConfig } = await loadConfig({ WORKER_TOKEN: "x".repeat(24), SCHEDULE_SECONDS: "60", APP_URL: "https://app.example.com/", CRON_SECRET: "s" });
    assert.deepEqual(validateConfig(), []);
    assert.equal(config.schedule.appUrl, "https://app.example.com");
  });
});
