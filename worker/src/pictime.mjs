import { chromium } from "playwright";

const fail = (code) => ({ ok: false, code });
export function validateApprovalInput(input) {
  if (!input || typeof input !== "object" || !/^[0-9]{1,20}$/.test(input.orderRef ?? "") || typeof input.orderRef !== "string" || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.currency !== "QAR") return fail("INVALID_APPROVAL");
  return { ok: true };
}

export function parseSale(raw) {
  const value = raw.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?$/.test(value)) return null;
  const [whole, cents = "00"] = value.replaceAll(",", "").split(".");
  const minor = Number(whole) * 100 + Number(cents);
  return Number.isSafeInteger(minor) ? minor : null;
}

export function approvalDecision(input, snapshot) {
  if (!validateApprovalInput(input).ok) return { action: "reject", code: "INVALID_APPROVAL" };
  if (input.orderRef !== snapshot.orderRef) return { action: "reject", code: "ORDER_MISMATCH" };
  if (input.amountMinor !== snapshot.amountMinor || input.currency !== snapshot.currency) return { action: "reject", code: "AMOUNT_MISMATCH" };
  if (!snapshot.digital) return { action: "reject", code: "UNSUPPORTED_PRODUCT" };
  if (snapshot.shipped && !snapshot.pending && !snapshot.approveVisible) return { action: "already_shipped" };
  if (!snapshot.pending || !snapshot.approveVisible || snapshot.shipped) return { action: "reject", code: "UNKNOWN_ORDER_STATE" };
  return { action: "approve" };
}

// Selectors observed in the account on 2026-10-12. Unknown layouts fail closed.
export async function snapshot(page) {
  return page.evaluate(() => {
    const visible = (el) => Boolean(el && el.getClientRects().length);
    const leaves = [...document.querySelectorAll("div")].filter(el => visible(el) && !el.children.length);
    const headings = leaves.filter(el => /^Order #\d+$/.test(el.textContent.trim()));
    const prices = [...document.querySelectorAll(".totalSale .salePrice")].filter(visible);
    const price = prices.length === 1 ? prices[0] : null;
    const currency = price?.querySelector(".pCurrency");
    const amount = price?.textContent.replace(currency?.textContent ?? "", "").trim() ?? "";
    const statuses = [...document.querySelectorAll(".itemStatus")].filter(visible);
    const status = statuses.length === 1 ? statuses[0].textContent.trim() : null;
    return {
      orderRef: headings.length === 1 ? headings[0].textContent.trim().slice(7) : null,
      amount,
      currency: currency?.getAttribute("data-name") ?? null,
      digital: statuses.length === 1 && leaves.filter(el => el.textContent.trim() === "Digital Delivery").length === 1 && leaves.filter(el => /^High-Res \(\d+\)$/.test(el.textContent.trim())).length === 1,
      pending: status === "Offline Payment",
      shipped: status === "Shipped to client",
      approveVisible: [...document.querySelectorAll(".approveOfflinePayment.orderApprove")].filter(visible).length === 1,
    };
  }).then(value => ({ ...value, amountMinor: parseSale(value.amount) }));
}

// One Pic-Time browser session at a time, shared by approval and the dashboard
// intake (pictime-intake.mjs): two contexts on one login would race each other.
let busy = false;
export function acquirePictimeSession() {
  if (busy) return false;
  busy = true;
  return true;
}
export function releasePictimeSession() {
  busy = false;
}

export async function approvePictimeOrder(input) {
  const valid = validateApprovalInput(input);
  if (!valid.ok) return valid;
  if (process.env.PICTIME_APPROVAL_ENABLED !== "1") return fail("DISABLED");
  const statePath = process.env.PICTIME_STORAGE_STATE_PATH;
  const origin = process.env.PICTIME_ORIGIN;
  if (!statePath || origin !== "https://bluebeltmedia.pic-time.com") return fail("NOT_CONFIGURED");
  const live = process.env.PICTIME_APPROVAL_DRY_RUN === "0";
  const allowlist = (process.env.PICTIME_APPROVAL_ORDER_ALLOWLIST ?? "").split(",").map(v => v.trim());
  if (live && !allowlist.includes(input.orderRef) && !allowlist.includes("*")) return fail("ORDER_NOT_ENABLED");
  if (!acquirePictimeSession()) return fail("BUSY");
  let browser;
  let clicked = false;
  try {
    // Dedicated context: tournament rendering never gets the studio login.
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: statePath, locale: "en-GB", timezoneId: "Asia/Qatar" });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    await page.goto(`${origin}/professional#dash|store|orders|order_${input.orderRef}`, { waitUntil: "domcontentloaded", timeout: 10_000 });
    if (new URL(page.url()).origin !== origin || !new URL(page.url()).pathname.startsWith("/professional")) return fail("SESSION_REQUIRED");
    await page.getByText(`Order #${input.orderRef}`, { exact: true }).waitFor({ state: "visible" });
    const before = await snapshot(page);
    const decision = approvalDecision(input, before);
    if (decision.action === "reject") return fail(decision.code);
    if (decision.action === "already_shipped") return { ok: true, state: "shipped", orderRef: input.orderRef, alreadyShipped: true };
    if (!live) return { ok: true, state: "dry_run", orderRef: input.orderRef };
    if (new URL(page.url()).origin !== origin) return fail("SESSION_REQUIRED");
    // Mark uncertain before the click: even a timeout can follow a committed approval.
    clicked = true;
    await page.locator(".approveOfflinePayment.orderApprove").click();
    // Never click an unobserved confirmation dialog or infer success from a missing button.
    await page.locator(".itemStatus").filter({ hasText: /^Shipped to client$/ }).waitFor({ state: "visible" });
    if (new URL(page.url()).origin !== origin) return fail("APPROVAL_UNCONFIRMED");
    const after = approvalDecision(input, await snapshot(page));
    return after.action === "already_shipped" ? { ok: true, state: "shipped", orderRef: input.orderRef } : fail("APPROVAL_UNCONFIRMED");
  } catch {
    // Do not return browser errors: they may contain authenticated URLs or secrets.
    return fail(clicked ? "APPROVAL_UNCONFIRMED" : "PAGE_OR_SESSION_UNAVAILABLE");
  } finally {
    try { await browser?.close(); } finally { releasePictimeSession(); }
  }
}
