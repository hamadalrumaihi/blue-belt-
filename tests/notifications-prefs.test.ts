import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/roles", async () => {
  const { createClient } = await import("@/lib/supabase/server");
  return {
    requireStudioUser: async () => {
      const s = await createClient();
      const { data } = await s.auth.getUser();
      const user = data?.user;
      return user ? { ok: true, viewer: { userId: user.id, email: user.email ?? null, role: "owner" } } : { ok: false, error: "You are signed out." };
    },
    isStudioRole: (r: string) => r !== "client",
  };
});
const getUser = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser }, from })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { retryDelivery, setClientNotificationPref } from "@/lib/actions/notifications";
import { maskEmail, toDeliveryView } from "@/lib/notifications/queries";

type Row = Record<string, unknown>;

/** One table call recorder: captures the payload and filters, answers with `result`. */
function tableFake(result: { error: { message: string } | null; count?: number | null }) {
  const calls: { op?: string; payload?: unknown; opts?: unknown; filters: Array<[string, unknown]> } = { filters: [] };
  const chain: Record<string, unknown> = {
    upsert: (p: unknown, o: unknown) => ((calls.op = "upsert"), (calls.payload = p), (calls.opts = o), Promise.resolve(result)),
    update: (p: unknown, o: unknown) => ((calls.op = "update"), (calls.payload = p), (calls.opts = o), chain),
    eq: (c: string, v: unknown) => (calls.filters.push([c, v]), chain),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
  };
  return { chain, calls };
}

beforeEach(() => {
  getUser.mockReset();
  from.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
});

describe("setClientNotificationPref", () => {
  it("rejects unknown kinds, non-boolean values and switching an always-on kind off — before any DB access", async () => {
    expect(await setClientNotificationPref("NOPE", true)).toMatchObject({ ok: false, error: expect.stringMatching(/kind/i) });
    expect(await setClientNotificationPref("GALLERY_READY", "yes" as unknown as boolean)).toMatchObject({ ok: false, error: expect.stringMatching(/boolean/i) });
    expect(await setClientNotificationPref("PORTAL_SIGN_IN", false)).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be switched off/i) });
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await setClientNotificationPref("GALLERY_READY", false)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(from).not.toHaveBeenCalled();
  });

  it("upserts the owner's own row keyed on (owner_id, kind)", async () => {
    const t = tableFake({ error: null });
    from.mockReturnValue(t.chain);
    expect(await setClientNotificationPref("GALLERY_READY", false)).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("photo_client_notification_prefs");
    expect(t.calls.op).toBe("upsert");
    expect(t.calls.payload).toMatchObject({ owner_id: "owner-1", kind: "GALLERY_READY", enabled: false });
    expect(t.calls.opts).toMatchObject({ onConflict: "owner_id,kind" });
    const failing = tableFake({ error: { message: "rls" } });
    from.mockReturnValue(failing.chain);
    expect(await setClientNotificationPref("GALLERY_READY", true)).toEqual({ ok: false, error: "rls" });
  });
});

describe("retryDelivery", () => {
  it("rejects a bad id and a signed-out user before any DB access", async () => {
    expect(await retryDelivery(0)).toMatchObject({ ok: false });
    expect(await retryDelivery(1.5)).toMatchObject({ ok: false });
    expect(await retryDelivery("7" as unknown as number)).toMatchObject({ ok: false });
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await retryDelivery(7)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(from).not.toHaveBeenCalled();
  });

  it("re-queues only the owner's failed row with a fresh attempt budget", async () => {
    const t = tableFake({ error: null, count: 1 });
    from.mockReturnValue(t.chain);
    expect(await retryDelivery(7)).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("photo_notification_deliveries");
    expect(t.calls.payload).toMatchObject({ status: "pending", attempts: 0, last_error: null, leased_until: null, lease_owner: null });
    expect(typeof (t.calls.payload as Row).next_attempt_at).toBe("string");
    expect(t.calls.filters).toEqual([["id", 7], ["owner_id", "owner-1"], ["status", "failed"]]);
    const none = tableFake({ error: null, count: 0 });
    from.mockReturnValue(none.chain);
    expect(await retryDelivery(8)).toMatchObject({ ok: false, error: expect.stringMatching(/failed delivery/i) });
  });
});

describe("delivery views never expose addresses or bodies", () => {
  it("masks e-mail addresses", () => {
    expect(maskEmail("fatima@example.com")).toBe("f***@example.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    expect(maskEmail("garbage")).toBe("***");
  });

  it("keeps only the recipient (masked) and subject from an e-mail payload, and says Telegram for the other channel", () => {
    const base = { id: 1, kind: "GALLERY_READY", category: "delivery", status: "failed" as const, attempts: 3, last_error: "resend 500 token 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", sent_at: null, created_at: "2026-10-01T00:00:00.000Z" };
    const email = toDeliveryView({ ...base, channel: "email", payload: { to: "fatima@example.com", subject: "Your gallery is ready", html: "<p>secret body</p>", text: "secret body" } });
    expect(email).toMatchObject({ to: "f***@example.com", subject: "Your gallery is ready", status: "failed", attempts: 3 });
    expect(JSON.stringify(email)).not.toContain("secret body");
    expect(JSON.stringify(email)).not.toContain("fatima@");
    expect(email.lastError).toContain("[hidden]");
    const tg = toDeliveryView({ ...base, channel: "telegram", payload: { text: "<b>Hello</b>" } });
    expect(tg.to).toBe("Telegram");
    expect(tg.subject).toBeNull();
    expect(toDeliveryView({ ...base, channel: "email", payload: null }).to).toBe("—");
  });
});
