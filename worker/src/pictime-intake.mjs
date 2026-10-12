import { chromium } from "playwright";
import { log as rootLog } from "./log.mjs";
import { acquirePictimeSession, releasePictimeSession, snapshot } from "./pictime.mjs";

/**
 * Pic-Time dashboard intake (docs/pictime-intake.md). Off by default.
 *
 * The Zap only delivers an order after it is approved, so an order paid to the
 * photographer never reaches the app while it waits for payment. This reads
 * the signed-in dashboard instead: it lists orders, opens each unseen one,
 * and keeps only those Pic-Time shows as `Offline Payment` (pending). In POST
 * mode it sends them to the app's own /api/orders/intake with an orders
 * credential, exactly like the Zap (flat fields, `paymentStatus: "pending
 * approval"`); the app dedupes on the Pic-Time reference, so the Zap's later
 * post-approval delivery is a harmless replay.
 *
 * Read-only by construction: the page is only navigated and read with
 * `evaluate`; nothing is clicked, typed or submitted (a test pins this).
 * It shares the approval job's dedicated browser context and session lock,
 * never the tournament profile.
 *
 * Modes (env, read on every run):
 *   PICTIME_INTAKE_ENABLED=1   run at all (with PICTIME_INTAKE_SECONDS on the scheduler)
 *   PICTIME_INTAKE_POST=1      send to the app; anything else = observe: log counts only
 *   PICTIME_INTAKE_TOKEN       bbmo_ orders credential (POST mode only)
 *   PICTIME_INTAKE_BUYER_SELECTOR  CSS selector of the buyer name on an order page;
 *                              not observed yet, so until it is set every order is
 *                              skipped as BUYER_UNREADABLE (the intake requires a name
 *                              and the adapter never invents one)
 *   PICTIME_ORIGIN, PICTIME_STORAGE_STATE_PATH, APP_URL  as for approval / the scheduler
 */
export const ORIGIN = "https://bluebeltmedia.pic-time.com";
export const MAX_ORDERS_PER_RUN = 10;
const MAX_REMEMBERED = 1000;

/** Refs settled in this process (app answered 201 / 200, or Pic-Time shows them shipped): not reopened. */
const acknowledged = new Set();
export function resetAcknowledged() {
  acknowledged.clear();
}
function remember(ref) {
  if (acknowledged.size >= MAX_REMEMBERED) acknowledged.clear();
  acknowledged.add(ref);
}

/** Pure: is this order page a pending order the intake may record? Never decides anything about payment. */
export function intakeDecision(snap) {
  if (!snap || !/^[0-9]{1,20}$/.test(snap.orderRef ?? "")) return { action: "skip", code: "ORDER_UNREADABLE" };
  if (snap.shipped || !snap.pending) return { action: "skip", code: "NOT_PENDING" };
  if (!Number.isSafeInteger(snap.amountMinor) || snap.amountMinor < 0) return { action: "skip", code: "AMOUNT_UNREADABLE" };
  if (!/^[A-Z]{3}$/.test(snap.currency ?? "")) return { action: "skip", code: "CURRENCY_UNREADABLE" };
  return { action: "record" };
}

/** Pure: the flat body the Zap sends (docs/orders-intake.md), for a pending order. */
export function buildIntakePayload(snap, buyerName) {
  return {
    source: "pictime",
    externalRef: snap.orderRef,
    buyerName,
    total: (snap.amountMinor / 100).toFixed(2),
    currency: snap.currency,
    paymentMethod: "photographer",
    paymentStatus: "pending approval",
  };
}

export function intakeSettings(env = process.env) {
  return {
    enabled: env.PICTIME_INTAKE_ENABLED === "1",
    post: env.PICTIME_INTAKE_POST === "1",
    token: env.PICTIME_INTAKE_TOKEN ?? "",
    buyerSelector: (env.PICTIME_INTAKE_BUYER_SELECTOR ?? "").trim(),
    origin: env.PICTIME_ORIGIN ?? "",
    statePath: env.PICTIME_STORAGE_STATE_PATH ?? "",
    appUrl: (env.APP_URL ?? "").replace(/\/$/, ""),
  };
}

/** Problems that stop a run before any browser starts; [] = runnable. */
export function settingsProblems(s) {
  const problems = [];
  if (s.origin !== ORIGIN) problems.push("PICTIME_ORIGIN");
  if (!s.statePath) problems.push("PICTIME_STORAGE_STATE_PATH");
  if (s.post && !/^bbmo_[A-Za-z0-9_-]{8,}$/.test(s.token)) problems.push("PICTIME_INTAKE_TOKEN");
  if (s.post && !/^https:\/\//.test(s.appUrl)) problems.push("APP_URL");
  return problems;
}

async function defaultOpen(statePath) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: statePath, locale: "en-GB", timezoneId: "Asia/Qatar" });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  return { page, close: () => browser.close() };
}

const onDashboard = (page) => {
  const u = new URL(page.url());
  return u.origin === ORIGIN && u.pathname.startsWith("/professional");
};

// The orders list route and its markup are inferred from the observed order
// URL (#dash|store|orders|order_<ref>), not yet observed themselves: refs are
// collected from links / attributes naming order_<digits> and from visible
// "Order #<digits>" leaves. Finding none is reported, never guessed around.
async function discoverOrderRefs(page) {
  return page.evaluate((max) => {
    const refs = new Set();
    for (const el of document.querySelectorAll("[href*='order_'], [data-hash*='order_'], [onclick*='order_']")) {
      for (const attr of ["href", "data-hash", "onclick"]) {
        const m = (el.getAttribute(attr) ?? "").match(/order_(\d{1,20})/);
        if (m) refs.add(m[1]);
      }
    }
    for (const el of document.querySelectorAll("div, span, a")) {
      if (el.children.length || !el.getClientRects().length) continue;
      const m = el.textContent.trim().match(/^Order #(\d{1,20})$/);
      if (m) refs.add(m[1]);
    }
    return [...refs].slice(0, max * 5);
  }, MAX_ORDERS_PER_RUN);
}

async function readBuyerName(page, selector) {
  if (!selector) return null;
  const names = await page.locator(selector).allTextContents().catch(() => []);
  const clean = names.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean);
  return clean.length === 1 && clean[0].length <= 200 ? clean[0] : null;
}

async function postOrder(fetchImpl, s, payload) {
  const res = await fetchImpl(`${s.appUrl}/api/orders/intake`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  return res.status;
}

/**
 * One bounded pass. Returns counts and codes only: no buyer names, e-mails or
 * page text ever leave this function (logs included).
 */
export async function runPictimeIntake(deps = {}) {
  const env = deps.env ?? process.env;
  const log = deps.log ?? rootLog;
  const open = deps.open ?? defaultOpen;
  const fetchImpl = deps.fetch ?? fetch;
  const s = intakeSettings(env);
  const summary = { ok: false, mode: s.post ? "post" : "observe", listed: 0, opened: 0, pending: 0, recordable: 0, buyerReadable: 0, recorded: 0, replayed: 0, skipped: {} };
  const skip = (code) => { summary.skipped[code] = (summary.skipped[code] ?? 0) + 1; };

  if (!s.enabled) return { ...summary, code: "DISABLED" };
  const problems = settingsProblems(s);
  if (problems.length) {
    log.warn("pictime_intake.not_configured", { missing: problems });
    return { ...summary, code: "NOT_CONFIGURED" };
  }
  if (!acquirePictimeSession()) return { ...summary, code: "BUSY" };

  let session;
  try {
    session = await open(s.statePath);
    const { page } = session;
    await page.goto(`${ORIGIN}/professional#dash|store|orders`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (!onDashboard(page)) return { ...summary, code: "SESSION_REQUIRED" };
    await page.waitForTimeout(3_000);
    const refs = (await discoverOrderRefs(page)).filter((r) => !acknowledged.has(r));
    summary.listed = refs.length;

    for (const ref of refs.slice(0, MAX_ORDERS_PER_RUN)) {
      await page.goto(`${ORIGIN}/professional#dash|store|orders|order_${ref}`, { waitUntil: "domcontentloaded", timeout: 10_000 });
      if (!onDashboard(page)) return { ...summary, code: "SESSION_REQUIRED" };
      const visible = await page.getByText(`Order #${ref}`, { exact: true }).waitFor({ state: "visible" }).then(() => true, () => false);
      if (!visible) { skip("ORDER_NOT_SHOWN"); continue; }
      summary.opened += 1;
      const snap = await snapshot(page);
      if (snap.orderRef !== ref) { skip("ORDER_MISMATCH"); continue; }
      const decision = intakeDecision(snap);
      if (snap.pending) summary.pending += 1;
      if (decision.action === "skip") {
        skip(decision.code);
        // Shipped is terminal: never reopen it, so old orders cannot crowd out pending ones.
        if (snap.shipped) remember(ref);
        continue;
      }
      summary.recordable += 1;
      const buyer = await readBuyerName(page, s.buyerSelector);
      if (!buyer) { skip("BUYER_UNREADABLE"); continue; }
      summary.buyerReadable += 1;
      if (!s.post) continue;

      const status = await postOrder(fetchImpl, s, buildIntakePayload(snap, buyer)).catch(() => 0);
      if (status === 201 || status === 200) {
        summary[status === 201 ? "recorded" : "replayed"] += 1;
        remember(ref);
      } else if (status === 400) {
        skip("INTAKE_REJECTED");
      } else {
        // 401/403 credential, 404 intake off, 429, 5xx, network: stop; the next tick retries.
        log.warn("pictime_intake.app_refused", { status });
        return { ...summary, code: status ? `INTAKE_HTTP_${status}` : "INTAKE_UNREACHABLE" };
      }
    }
    summary.ok = true;
    return summary;
  } catch {
    // Browser errors can carry authenticated URLs: report a code only.
    return { ...summary, code: "PAGE_OR_SESSION_UNAVAILABLE" };
  } finally {
    try { await session?.close(); } catch { /* already gone */ }
    releasePictimeSession();
    log.info("pictime_intake.run", { mode: summary.mode, listed: summary.listed, opened: summary.opened, pending: summary.pending, recordable: summary.recordable, buyerReadable: summary.buyerReadable, recorded: summary.recorded, replayed: summary.replayed, skipped: summary.skipped });
  }
}
