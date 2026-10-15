import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildIntakePayload, intakeDecision, resetAcknowledged, runPictimeIntake, settingsProblems, intakeSettings } from "../src/pictime-intake.mjs";

const ORIGIN = "https://bluebeltmedia.pic-time.com";
const pendingOrder = { orderRef: "1484532733", amount: "60.00", currency: "QAR", digital: true, pending: true, shipped: false, approveVisible: true };
const shippedOrder = { ...pendingOrder, orderRef: "1475080675", amount: "240.00", pending: false, shipped: true, approveVisible: false };

const quiet = { info() {}, warn() {}, error() {} };
const baseEnv = {
  PICTIME_INTAKE_ENABLED: "1",
  PICTIME_ORIGIN: ORIGIN,
  PICTIME_STORAGE_STATE_PATH: "/data/pictime/state.json",
  PICTIME_INTAKE_BUYER_SELECTOR: ".buyer",
  APP_URL: "https://app.test",
};
const postEnv = { ...baseEnv, PICTIME_INTAKE_POST: "1", PICTIME_INTAKE_TOKEN: "bbmo_0123456789abcdef" };

/** A fake Playwright page over a fixed dashboard: list -> refs, order page -> snapshot + buyer. */
function fakeDashboard({ refs = [pendingOrder.orderRef], orders = { [pendingOrder.orderRef]: pendingOrder }, buyers = { [pendingOrder.orderRef]: ["Buyer Name"] }, landOn = null } = {}) {
  let current = "";
  const visits = [];
  const page = {
    url: () => landOn ?? `${ORIGIN}/professional`,
    goto: async (url) => { visits.push(url); current = url.match(/order_(\d+)$/)?.[1] ?? ""; },
    waitForTimeout: async () => {},
    evaluate: async (_fn, arg) => (arg !== undefined ? refs : current ? orders[current] : { orderTextLeaves: 0, orderAttrLinks: 0, orderClassTokens: ["orderRow:3"] }),
    getByText: (text) => ({ waitFor: async () => { if (!orders[current] || text !== `Order #${current}`) throw new Error("not visible"); } }),
    locator: () => ({ allTextContents: async () => buyers[current] ?? [] }),
  };
  let closed = 0;
  return { open: async () => ({ page, close: async () => { closed += 1; } }), visits, closed: () => closed };
}

function fakeFetch(status = 201) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    return new Response("{}", { status: typeof status === "function" ? status(calls.length) : status });
  };
  return { fn, calls };
}

beforeEach(() => resetAcknowledged());

describe("pure decisions", () => {
  test("only a pending (Offline Payment) order with a readable amount is recordable", () => {
    const snap = { ...pendingOrder, amountMinor: 6000 };
    assert.deepEqual(intakeDecision(snap), { action: "record" });
    assert.equal(intakeDecision({ ...snap, pending: false, shipped: true }).code, "NOT_PENDING");
    assert.equal(intakeDecision({ ...snap, shipped: true }).code, "NOT_PENDING");
    assert.equal(intakeDecision({ ...snap, amountMinor: null }).code, "AMOUNT_UNREADABLE");
    assert.equal(intakeDecision({ ...snap, currency: null }).code, "CURRENCY_UNREADABLE");
    assert.equal(intakeDecision({ ...snap, orderRef: null }).code, "ORDER_UNREADABLE");
  });

  test("the payload matches the Zap's flat shape and says pending, never paid", () => {
    assert.deepEqual(buildIntakePayload({ ...pendingOrder, amountMinor: 6000 }, "Buyer Name"), {
      source: "pictime",
      externalRef: "1484532733",
      buyerName: "Buyer Name",
      total: "60.00",
      currency: "QAR",
      paymentMethod: "photographer",
      paymentStatus: "pending approval",
    });
  });

  test("POST mode needs an orders credential and an https app URL; observe mode does not", () => {
    assert.deepEqual(settingsProblems(intakeSettings(baseEnv)), []);
    assert.deepEqual(settingsProblems(intakeSettings({ ...baseEnv, PICTIME_INTAKE_POST: "1" })), ["PICTIME_INTAKE_TOKEN"]);
    assert.deepEqual(settingsProblems(intakeSettings({ ...postEnv, PICTIME_INTAKE_TOKEN: "bbmc_capture0123456" })), ["PICTIME_INTAKE_TOKEN"]);
    assert.deepEqual(settingsProblems(intakeSettings({ ...postEnv, APP_URL: "http://app.test" })), ["APP_URL"]);
    assert.deepEqual(settingsProblems(intakeSettings({ ...baseEnv, PICTIME_ORIGIN: "https://evil.example" })), ["PICTIME_ORIGIN"]);
  });
});

describe("runPictimeIntake", () => {
  test("is off unless PICTIME_INTAKE_ENABLED=1, and never opens a browser then", async () => {
    let opened = false;
    const out = await runPictimeIntake({ env: { ...baseEnv, PICTIME_INTAKE_ENABLED: "0" }, open: async () => { opened = true; }, log: quiet });
    assert.equal(out.code, "DISABLED");
    assert.equal(opened, false);
  });

  test("observe mode (default) reads and counts but never POSTs", async () => {
    const dash = fakeDashboard({ refs: [pendingOrder.orderRef, shippedOrder.orderRef], orders: { [pendingOrder.orderRef]: pendingOrder, [shippedOrder.orderRef]: shippedOrder } });
    const f = fakeFetch();
    const out = await runPictimeIntake({ env: baseEnv, open: dash.open, fetch: f.fn, log: quiet });
    assert.equal(out.ok, true);
    assert.equal(out.mode, "observe");
    assert.deepEqual({ listed: out.listed, opened: out.opened, pending: out.pending, recordable: out.recordable, buyerReadable: out.buyerReadable }, { listed: 2, opened: 2, pending: 1, recordable: 1, buyerReadable: 1 });
    assert.deepEqual(out.skipped, { NOT_PENDING: 1 });
    assert.equal(f.calls.length, 0);
    assert.equal(dash.closed(), 1);
  });

  test("POST mode sends only pending orders, with the orders credential, and skips them once acknowledged", async () => {
    const dash = fakeDashboard({ refs: [pendingOrder.orderRef, shippedOrder.orderRef], orders: { [pendingOrder.orderRef]: pendingOrder, [shippedOrder.orderRef]: shippedOrder } });
    const f = fakeFetch(201);
    const out = await runPictimeIntake({ env: postEnv, open: dash.open, fetch: f.fn, log: quiet });
    assert.equal(out.recorded, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "https://app.test/api/orders/intake");
    assert.equal(f.calls[0].auth, "Bearer bbmo_0123456789abcdef");
    assert.equal(f.calls[0].body.paymentStatus, "pending approval");

    const again = await runPictimeIntake({ env: postEnv, open: dash.open, fetch: f.fn, log: quiet });
    assert.equal(again.listed, 0, "neither the acknowledged nor the shipped order is reopened");
    assert.equal(f.calls.length, 1);
  });

  test("never invents a buyer: without a readable name the order is skipped, not sent", async () => {
    for (const env of [{ ...postEnv, PICTIME_INTAKE_BUYER_SELECTOR: "" }, postEnv]) {
      const dash = fakeDashboard({ buyers: { [pendingOrder.orderRef]: env.PICTIME_INTAKE_BUYER_SELECTOR ? ["A", "B"] : [] } });
      const f = fakeFetch();
      const out = await runPictimeIntake({ env, open: dash.open, fetch: f.fn, log: quiet });
      assert.deepEqual(out.skipped, { BUYER_UNREADABLE: 1 });
      assert.equal(f.calls.length, 0);
    }
  });

  test("a refused credential or unreachable app stops the pass and retries next tick", async () => {
    for (const [status, code] of [[401, "INTAKE_HTTP_401"], [404, "INTAKE_HTTP_404"], [503, "INTAKE_HTTP_503"]]) {
      resetAcknowledged();
      const out = await runPictimeIntake({ env: postEnv, open: fakeDashboard().open, fetch: fakeFetch(status).fn, log: quiet });
      assert.equal(out.ok, false);
      assert.equal(out.code, code);
    }
    const again = await runPictimeIntake({ env: postEnv, open: fakeDashboard().open, fetch: fakeFetch(200).fn, log: quiet });
    assert.equal(again.replayed, 1);
  });

  test("a login page instead of the dashboard reports SESSION_REQUIRED", async () => {
    const out = await runPictimeIntake({ env: postEnv, open: fakeDashboard({ landOn: "https://accounts.google.com/signin" }).open, fetch: fakeFetch().fn, log: quiet });
    assert.equal(out.code, "SESSION_REQUIRED");
  });

  test("browser errors become a code; nothing from the page leaks", async () => {
    const out = await runPictimeIntake({ env: postEnv, open: async () => { throw new Error("https://x/?token=secret"); }, log: quiet });
    assert.equal(out.code, "PAGE_OR_SESSION_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(out), /secret/);
  });

  test("the logged summary carries counts only, never the buyer name", async () => {
    const lines = [];
    const log = { info: (msg, f) => lines.push([msg, f]), warn: (msg, f) => lines.push([msg, f]), error() {} };
    await runPictimeIntake({ env: postEnv, open: fakeDashboard().open, fetch: fakeFetch().fn, log });
    assert.ok(lines.length > 0);
    assert.doesNotMatch(JSON.stringify(lines), /Buyer Name|bbmo_/);
  });
});

test("an empty listing logs its result code and markup facts (counts and class tokens only)", async () => {
  const lines = [];
  const log = { info: (msg, f) => lines.push([msg, f]), warn: () => {}, error() {} };
  const out = await runPictimeIntake({ env: baseEnv, open: fakeDashboard({ refs: [] }).open, log });
  assert.equal(out.ok, true);
  const [, fields] = lines.find(([m]) => m === "pictime_intake.run");
  assert.equal(fields.listed, 0);
  assert.equal(fields.code, null);
  assert.deepEqual(fields.facts, { landedPath: "/professional", landedHash: "", orderTextLeaves: 0, orderAttrLinks: 0, orderClassTokens: ["orderRow:3"] });
});

test("a refused session logs the code and where it landed, without query or digits", async () => {
  const lines = [];
  const log = { info: (msg, f) => lines.push([msg, f]), warn: () => {}, error() {} };
  await runPictimeIntake({ env: baseEnv, open: fakeDashboard({ landOn: "https://bluebeltmedia.pic-time.com/login/123?token=secret" }).open, log });
  const [, fields] = lines.find(([m]) => m === "pictime_intake.run");
  assert.equal(fields.code, "SESSION_REQUIRED");
  assert.deepEqual(fields.facts, { landedHost: "bluebeltmedia.pic-time.com", landedPath: "/login/N" });
  assert.doesNotMatch(JSON.stringify(fields), /secret|123/);
});

test("an order page without its heading logs digit-count facts once, never values", async () => {
  const lines = [];
  const log = { info: (msg, f) => lines.push([msg, f]), warn: () => {}, error() {} };
  const dash = fakeDashboard({ refs: ["1234567", "7654321"], orders: {} });
  const out = await runPictimeIntake({ env: baseEnv, open: dash.open, log });
  assert.deepEqual(out.skipped, { ORDER_NOT_SHOWN: 2 });
  const [, fields] = lines.find(([m]) => m === "pictime_intake.run");
  assert.equal(fields.facts.stage, "order_page");
  assert.equal(fields.facts.refDigits, 7);
  assert.equal(fields.facts.landedHash, "");
  assert.doesNotMatch(JSON.stringify(fields), /1234567|7654321/);
});

test("read-only by construction: the adapter never clicks, types, fills or submits", async () => {
  const src = await readFile(new URL("../src/pictime-intake.mjs", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\.(click|dblclick|tap|fill|type|press|check|uncheck|selectOption|setInputFiles|dispatchEvent|submit)\(/);
});
