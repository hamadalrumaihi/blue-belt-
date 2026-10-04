import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { assessReadiness, findPaginationHint } from "../src/readiness.mjs";

const URL_ = "https://ajptour.com/en/event/1411/bracket/130617";
const TABLE = `<!doctype html><html><head><title>Bracket</title></head><body><main>
<table><thead><tr><th>#</th><th>Mat</th><th>Time</th><th>Red</th><th>Blue</th></tr></thead>
<tbody><tr><td>12</td><td>Mat 3</td><td>10:40</td><td>Hamad Al-Rumaihi</td><td>João Silva</td></tr>
<tr><td>13</td><td>Mat 3</td><td>11:00</td><td>A B</td><td>C D</td></tr></tbody></table></main></body></html>`;

function assess(overrides = {}) {
  return assessReadiness({ html: TABLE, status: 200, finalUrl: URL_, requestedUrl: URL_, ...overrides });
}

describe("assessReadiness", () => {
  test("a rendered schedule table is ready", () => {
    const r = assess();
    assert.equal(r.ready, true);
    assert.equal(r.reason, "SCHEDULE_FOUND");
    assert.equal(r.hasSchedule, true);
  });

  test("HTTP error statuses are never ready", () => {
    assert.deepEqual(assess({ status: 503 }), { ready: false, reason: "HTTP_ERROR", hasSchedule: false, terminal: true, redirected: false });
    assert.equal(assess({ status: 404, html: "<html><body>Not found</body></html>" }).reason, "HTTP_ERROR");
  });

  test("challenge, login and error pages are rejected", () => {
    assert.equal(assess({ html: "<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>" }).reason, "CHALLENGE");
    assert.equal(assess({ html: "<html><body><form action='/login'><input type='email'><input type='password'><button>Sign in</button></form></body></html>" }).reason, "LOGIN_PAGE");
    assert.equal(assess({ html: "<html><head><title>Server Error</title></head><body><h1>Whoops, something went wrong.</h1></body></html>" }).reason, "ERROR_PAGE");
  });

  test("a JS bootstrap shell with no content is not ready yet (not terminal)", () => {
    const r = assess({ html: "<html><body><div id='app'></div><script src='/app.js'></script></body></html>" });
    assert.equal(r.ready, false);
    assert.equal(r.reason, "UNHYDRATED");
    assert.equal(r.terminal, false);
  });

  test("a redirect to another path is reported, not failed: the content still decides, and the app checks the landed URL", () => {
    const r = assess({ finalUrl: "https://ajptour.com/en/event/9999/bracket/1" });
    assert.equal(r.ready, true);
    assert.equal(r.reason, "SCHEDULE_FOUND");
    assert.equal(r.redirected, true);
    // A locale redirect of the same page is not even a redirect for this purpose.
    const locale = assess({ finalUrl: "https://ajptour.com/ar/event/1411/bracket/130617/" });
    assert.equal(locale.ready, true);
    assert.equal(locale.redirected, false);
  });

  test("an unpublished-schedule page is ready but empty", () => {
    const r = assess({ html: "<html><body><h1>Qatar Open</h1><p>Schedule not published yet. Check back later for the brackets and mats.</p></body></html>" });
    assert.equal(r.ready, true);
    assert.equal(r.reason, "NO_SCHEDULE_YET");
    assert.equal(r.hasSchedule, false);
  });
});

describe("findPaginationHint", () => {
  test("detects common next / load-more controls and nothing on a flat page", () => {
    assert.equal(findPaginationHint(TABLE), null);
    assert.equal(findPaginationHint(`${TABLE}<a rel="next" href="?page=2">Next</a>`), "next-link");
    assert.equal(findPaginationHint(`${TABLE}<button class="btn-load-more">Load more</button>`), "load-more");
    assert.equal(findPaginationHint(`${TABLE}<ul class="pagination"><li class="active">1</li><li><a href="?page=2">2</a></li></ul>`), "pagination");
  });
});
