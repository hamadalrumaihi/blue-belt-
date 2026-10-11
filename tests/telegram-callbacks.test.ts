import { describe, expect, it } from "vitest";
import { buildInlineKeyboard, CALLBACK_MAX_BYTES, callbackSecret, signCallback, verifyCallback } from "@/lib/notifications/telegram/callbacks";
import { summarizeWebhookInfo, TELEGRAM_ALLOWED_UPDATES, telegramWebhookUrl } from "@/lib/notifications/telegram/webhook-admin";

const SECRET = callbackSecret("123456:ABC-DEF_bot_token");
const OTHER = callbackSecret("123456:another_token");
const NOW = new Date("2026-10-11T10:00:00.000Z");
const ORDER = "33333333-3333-4333-8333-333333333333";

describe("signed callback data", () => {
  it("fits Telegram's 64-byte limit and round-trips action, order and expiry", () => {
    const data = signCallback({ action: "send", orderId: ORDER, now: NOW }, SECRET);
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    expect(data.split("|")).toHaveLength(5);
    const v = verifyCallback(data, SECRET, NOW);
    expect(v).toMatchObject({ ok: true, payload: { action: "send", orderId: ORDER } });
    if (v.ok) expect(v.payload.exp * 1000).toBeGreaterThan(NOW.getTime());
    for (const action of ["check", "resend", "done", "refresh"] as const) {
      expect(verifyCallback(signCallback({ action, orderId: ORDER, now: NOW }, SECRET), SECRET, NOW)).toMatchObject({ ok: true, payload: { action } });
    }
  });

  it("rejects forged, edited, foreign-key and expired buttons", () => {
    const data = signCallback({ action: "check", orderId: ORDER, now: NOW, ttlMs: 60_000 }, SECRET);
    const [p, action, id, exp, sig] = data.split("|");
    // Another order id under the same signature.
    const otherId = signCallback({ action: "check", orderId: "44444444-4444-4444-8444-444444444444", now: NOW }, SECRET).split("|")[2];
    expect(verifyCallback([p, action, otherId, exp, sig].join("|"), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    // Another action ("done" instead of "check") under the same signature.
    expect(verifyCallback([p, "done", id, exp, sig].join("|"), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    // Signed with a different bot token.
    expect(verifyCallback(data, OTHER, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    // Expired (a minute later), even though the signature is intact.
    expect(verifyCallback(data, SECRET, new Date(NOW.getTime() + 61_000))).toEqual({ ok: false, reason: "expired" });
    // Garbage, wrong prefix, unknown action, oversize.
    expect(verifyCallback("hello", SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCallback(null, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCallback(["x", action, id, exp, sig].join("|"), SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCallback([p, "pay", id, exp, sig].join("|"), SECRET, NOW)).toEqual({ ok: false, reason: "unknown_action" });
    expect(verifyCallback(`${data}${"a".repeat(64)}`, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("only signs real order ids", () => {
    expect(() => signCallback({ action: "send", orderId: "not-a-uuid", now: NOW }, SECRET)).toThrow(/uuid/);
  });

  it("builds a keyboard with signed actions and plain links, dropping empty rows", () => {
    const kb = buildInlineKeyboard([[{ text: "Send invoice", action: "send" }, { text: "Check payment", action: "check" }], [], [{ text: "View order", url: "https://site.test/orders/x" }]], { orderId: ORDER, secret: SECRET, now: NOW });
    expect(kb).toHaveLength(2);
    expect(kb[0]).toHaveLength(2);
    expect(kb[0][0].text).toBe("Send invoice");
    expect(verifyCallback(kb[0][0].callback_data, SECRET, NOW)).toMatchObject({ ok: true, payload: { action: "send", orderId: ORDER } });
    expect(verifyCallback(kb[0][1].callback_data, SECRET, NOW)).toMatchObject({ ok: true, payload: { action: "check" } });
    expect(kb[1][0]).toEqual({ text: "View order", url: "https://site.test/orders/x" });
  });
});

describe("webhook registration summary", () => {
  const SITE = "https://www.bluebeltmedia.com";
  it("knows the exact URL and requires both message and callback_query", () => {
    expect(telegramWebhookUrl(`${SITE}/`)).toBe(`${SITE}/api/telegram/webhook`);
    expect(TELEGRAM_ALLOWED_UPDATES).toEqual(["message", "callback_query"]);
    expect(summarizeWebhookInfo({ url: `${SITE}/api/telegram/webhook`, allowed_updates: ["message", "callback_query"], pending_update_count: 0 }, SITE)).toMatchObject({ verdict: "ok", registered: true, urlMatches: true, buttonsEnabled: true, missingUpdates: [] });
    // Telegram's default set (no allowed_updates) includes callback queries.
    expect(summarizeWebhookInfo({ url: `${SITE}/api/telegram/webhook` }, SITE).verdict).toBe("ok");
  });

  it("flags a registration made before the buttons existed (message only)", () => {
    const s = summarizeWebhookInfo({ url: `${SITE}/api/telegram/webhook`, allowed_updates: ["message"], pending_update_count: 3, last_error_date: 1791712800, last_error_message: "Wrong response from the webhook: 401 Unauthorized" }, SITE);
    expect(s).toMatchObject({ verdict: "buttons_off", buttonsEnabled: false, missingUpdates: ["callback_query"], pendingUpdates: 3, lastErrorAt: "2026-10-11T10:00:00.000Z" });
    expect(s.lastError).toMatch(/401/);
  });

  it("reports a foreign or missing registration by host only", () => {
    expect(summarizeWebhookInfo({ url: "https://old-preview.vercel.app/api/telegram/webhook?secret_token=abc" }, SITE)).toMatchObject({ verdict: "wrong_url", registeredHost: "old-preview.vercel.app", urlMatches: false });
    expect(summarizeWebhookInfo({ url: "" }, SITE)).toMatchObject({ verdict: "not_registered", registered: false, registeredHost: null });
  });
});
