import { describe, expect, it, vi } from "vitest";
import { enqueueOwnerTelegram, ownerMessageHtml } from "@/lib/notifications/owner";
import { categoryForKind, OWNER_KINDS } from "@/lib/notifications/telegram/kinds";
import { withCategory } from "@/lib/notifications/telegram/core";

vi.mock("server-only", () => ({}));

describe("owner studio notifications", () => {
  it("routes every owner kind to a studio category, never to Match", () => {
    for (const kind of OWNER_KINDS) expect(categoryForKind(kind)).not.toBe("match");
    expect(categoryForKind("BOOKING_NEW")).toBe("bookings");
    expect(categoryForKind("CONTRACT_SIGNED")).toBe("bookings");
    expect(categoryForKind("GALLERY_READY")).toBe("delivery");
    expect(categoryForKind("PAYMENT_CONFIRMED")).toBe("orders");
    expect(categoryForKind("EMAIL_FAILED")).toBe("system");
    expect(categoryForKind("GO_TO_MAT")).toBe("match");
  });

  it("escapes client text and keeps the category tag inside the bold title", () => {
    const html = ownerMessageHtml({ title: "New booking <script>", lines: ["Client: A & B", null], url: "https://x.test/bookings/1?a=1&b=2" });
    expect(html).toBe("<b>New booking &lt;script&gt;</b>\nClient: A &amp; B\nOpen: https://x.test/bookings/1?a=1&amp;b=2");
    expect(withCategory(html, "bookings").startsWith("<b>[Bookings] ")).toBe(true);
  });

  it("upserts an idempotent delivery row and never throws on a DB error", async () => {
    const calls: unknown[] = [];
    const supabase = {
      from: () => ({
        upsert: async (row: unknown, opts: unknown) => {
          calls.push([row, opts]);
          return { error: { message: "boom" } };
        },
      }),
    } as unknown as Parameters<typeof enqueueOwnerTelegram>[0];
    const out = await enqueueOwnerTelegram(supabase, { ownerId: "o", kind: "BOOKING_NEW", alertKey: "booking:1:new", title: "t", now: new Date("2026-10-06T10:00:00Z") });
    expect(out).toEqual({ ok: false, error: "boom" });
    const [row, opts] = calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(row).toMatchObject({ owner_id: "o", channel: "telegram", alert_key: "booking:1:new", kind: "BOOKING_NEW", category: "bookings", status: "pending" });
    expect(opts).toMatchObject({ onConflict: "owner_id,channel,alert_key", ignoreDuplicates: true });
  });
});
