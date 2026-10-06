import { describe, expect, it } from "vitest";
import { maskSecrets, summarizeDeliveries, type DeliveryRowLite } from "@/lib/notifications/telegram/health";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const row = (over: Partial<DeliveryRowLite>): DeliveryRowLite => ({ status: "sent", created_at: ago(5), sent_at: ago(5), last_error: null, next_attempt_at: null, updated_at: ago(5), ...over });

describe("summarizeDeliveries", () => {
  it("says working when messages went out and nothing failed", () => {
    const h = summarizeDeliveries([row({}), row({ created_at: ago(60 * 30) })], { now: NOW, linkEnabled: true, lastSentAt: ago(5) });
    expect(h).toMatchObject({ verdict: "working", sent24h: 1, failed24h: 0 });
    expect(h.summary).toContain("1 message delivered");
  });

  it("reports failures with the latest error, and a blocked bot separately", () => {
    const failing = summarizeDeliveries([row({ status: "failed", last_error: "Bad Request: message is too long", updated_at: ago(3) })], { now: NOW, linkEnabled: true, lastSentAt: ago(60) });
    expect(failing).toMatchObject({ verdict: "failing", failed24h: 1, lastError: "Bad Request: message is too long" });
    const blocked = summarizeDeliveries([row({ status: "failed", last_error: "Forbidden: bot was blocked by the user" })], { now: NOW, linkEnabled: false, lastSentAt: null });
    expect(blocked.verdict).toBe("blocked");
    expect(blocked.summary).toContain("link the chat again");
  });

  it("flags messages stuck in the queue, and an idle link", () => {
    expect(summarizeDeliveries([row({ status: "pending", sent_at: null, created_at: ago(20) })], { now: NOW, linkEnabled: true, lastSentAt: ago(60) }).verdict).toBe("stuck");
    expect(summarizeDeliveries([row({ status: "pending", sent_at: null, created_at: ago(2) })], { now: NOW, linkEnabled: true, lastSentAt: ago(60) }).verdict).toBe("working");
    expect(summarizeDeliveries([], { now: NOW, linkEnabled: true, lastSentAt: null }).verdict).toBe("idle");
  });

  it("never shows anything shaped like a bot token", () => {
    expect(maskSecrets("fetch https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage")).not.toContain("AAHdq");
  });
});
