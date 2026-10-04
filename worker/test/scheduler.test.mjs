import { describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.WORKER_TOKEN = process.env.WORKER_TOKEN || "import-time-token-0123456789";
process.env.APP_URL = "https://app.test";
process.env.CRON_SECRET = "cron-secret-0123456789";
process.env.SCHEDULE_SECONDS = "60";
process.env.DELIVERY_SECONDS = "30";
const { startScheduler } = await import("../src/scheduler.mjs");

describe("scheduler", () => {
  test("ticks the refresh loop (following cursors) and the independent delivery runner, each with the cron secret", async () => {
    const calls = [];
    let refreshPages = 0;
    const fetchImpl = async (url, init) => {
      calls.push({ url, auth: init.headers.authorization, body: init.body });
      if (url.endsWith("/api/cron/refresh")) {
        refreshPages += 1;
        return new Response(JSON.stringify({ processed: 2, remaining: refreshPages < 2 ? 3 : 0, cursor: refreshPages < 2 ? "abc" : null }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, sent: 1, retried: 0, failed: 0, skipped: 0, reminders: { planned: 2 } }), { status: 200 });
    };
    const s = startScheduler({ fetch: fetchImpl });
    try {
      await s.tick();
      await s.tickDeliveries();
    } finally {
      s.stop();
    }
    const refresh = calls.filter((c) => c.url === "https://app.test/api/cron/refresh");
    assert.equal(refresh.length, 2);
    assert.equal(refresh[1].body, JSON.stringify({ cursor: "abc" }));
    const deliveries = calls.filter((c) => c.url === "https://app.test/api/cron/deliveries");
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].auth, "Bearer cron-secret-0123456789");
  });

  test("a delivery tick never overlaps itself", async () => {
    let inFlight = 0;
    let max = 0;
    const fetchImpl = async () => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return new Response("{}", { status: 200 });
    };
    const s = startScheduler({ fetch: fetchImpl });
    try {
      await Promise.all([s.tickDeliveries(), s.tickDeliveries(), s.tickDeliveries()]);
    } finally {
      s.stop();
    }
    assert.equal(max, 1);
  });
});
