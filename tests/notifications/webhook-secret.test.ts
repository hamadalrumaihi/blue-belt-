import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("normalizeWebhookSecret", () => {
  it("accepts a plain secret and strips quotes/whitespace", async () => {
    const { normalizeWebhookSecret } = await import("@/lib/notifications/telegram/config");
    expect(normalizeWebhookSecret("abcdefgh12345678")).toBe("abcdefgh12345678");
    expect(normalizeWebhookSecret('  "abcdefgh12345678"\n')).toBe("abcdefgh12345678");
  });

  it("extracts secret_token when the whole setWebhook URL was pasted", async () => {
    const { normalizeWebhookSecret } = await import("@/lib/notifications/telegram/config");
    const url = "https://api.telegram.org/bot123456:ABC-DEF/setWebhook?url=https://example.app/api/telegram/webhook&secret_token=S3cretValue12345&drop_pending_updates=true";
    expect(normalizeWebhookSecret(url)).toBe("S3cretValue12345");
  });

  it("rejects short, empty or URL-without-token values", async () => {
    const { normalizeWebhookSecret } = await import("@/lib/notifications/telegram/config");
    expect(normalizeWebhookSecret("short")).toBeNull();
    expect(normalizeWebhookSecret("")).toBeNull();
    expect(normalizeWebhookSecret(undefined)).toBeNull();
    expect(normalizeWebhookSecret("https://api.telegram.org/bot1:x/setWebhook?url=https://example.app/hook")).toBeNull();
  });
});
