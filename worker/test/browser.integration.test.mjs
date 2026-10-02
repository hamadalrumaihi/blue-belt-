import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Real-browser check: launches Chromium through worker/src/browser.mjs and
 * renders pages served by a local http server (render() itself does not
 * enforce the host allow-list; the HTTP layer does). Opt in with
 * BBM_WORKER_BROWSER_TESTS=1 — it needs Playwright's Chromium installed.
 */
const enabled = process.env.BBM_WORKER_BROWSER_TESTS === "1";

const BRACKET = `<!doctype html><html><head><title>Bracket</title></head><body>
<table><thead><tr><th>Match #</th><th>Mat</th><th>Time</th><th>Red</th><th>Blue</th><th>Status</th></tr></thead>
<tbody><tr><td>12</td><td>Mat 3</td><td>10:40</td><td>Hamad Al-Rumaihi</td><td>João Silva</td><td>Scheduled</td></tr></tbody></table>
<script>document.body.appendChild(Object.assign(document.createElement("p"), { id: "js", textContent: "rendered by script" }));</script>
</body></html>`;

const CHALLENGE = `<!doctype html><html><head><title>Just a moment...</title></head><body>
<div id="challenge-error-title">Enable JavaScript and cookies to continue</div>
<script>window._cf_chl_opt={cvId:'3'};</script></body></html>`;

test("render() returns the DOM of a local page after scripts ran, and reports an uncleared challenge", { skip: !enabled && "set BBM_WORKER_BROWSER_TESTS=1 to run the real-browser test" }, async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "bbm-worker-profile-"));
  process.env.HEADLESS = process.env.HEADLESS || "new";
  process.env.ENGINE = "playwright";
  process.env.PROFILE_DIR = profile;
  process.env.CHROMIUM_NO_SANDBOX = process.env.CHROMIUM_NO_SANDBOX || "1";
  process.env.CHALLENGE_WAIT_MS = "2000";
  process.env.NAV_TIMEOUT_MS = "30000";
  process.env.WORKER_TOKEN = process.env.WORKER_TOKEN || "integration-token-0123456789";

  const { render, shutdown, stats } = await import("../src/browser.mjs");

  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/bracket" });
      return res.end();
    }
    const challenge = req.url === "/challenge";
    res.writeHead(challenge ? 403 : 200, { "content-type": "text/html; charset=utf-8" });
    res.end(challenge ? CHALLENGE : BRACKET);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    assert.equal(stats().browserReady, false);

    const page = await render(`${base}/bracket`);
    assert.equal(page.ok, true, JSON.stringify(page));
    assert.match(page.html, /Mat 3/);
    assert.match(page.html, /rendered by script/);
    assert.equal(page.status, 200);
    assert.equal(page.finalUrl, `${base}/bracket`);
    assert.ok(page.elapsedMs >= 0);
    assert.equal(stats().browserReady, true);

    const redirected = await render(`${base}/redirect`);
    assert.equal(redirected.ok, true);
    assert.equal(redirected.finalUrl, `${base}/bracket`);

    const challenged = await render(`${base}/challenge`);
    assert.equal(challenged.ok, false);
    assert.equal(challenged.code, "CHALLENGE_NOT_CLEARED");
    assert.ok(challenged.elapsedMs >= 2000);

    const selected = await render(`${base}/bracket`, { waitForSelector: "#js" });
    assert.equal(selected.ok, true);
    assert.match(selected.html, /id="js"/);
  } finally {
    await shutdown();
    await new Promise((r) => server.close(r));
    rmSync(profile, { recursive: true, force: true });
  }
});
