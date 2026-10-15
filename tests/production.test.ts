import { describe, expect, it } from "vitest";
import { groupByStage, productionStage, readStoredProduction, settableStages, withStoredProduction } from "@/lib/bookings/production";
import { booking } from "./payments/fixtures";

const NOW = new Date("2026-10-10T08:00:00.000Z");

describe("productionStage (derivation precedence)", () => {
  it("is off the board before the shoot, when cancelled and when completed", () => {
    expect(productionStage(booking({ booking_status: "confirmed" }))).toBeNull();
    expect(productionStage(booking({ booking_status: "inquiry" }))).toBeNull();
    expect(productionStage(booking({ booking_status: "cancelled", coverage_done_at: "2026-10-01T00:00:00.000Z" }))).toBeNull();
    expect(productionStage(booking({ booking_status: "completed", delivered_at: "2026-10-01T00:00:00.000Z" }))).toBeNull();
  });

  it("starts at Shoot complete from coverage_done_at or the in_progress status", () => {
    expect(productionStage(booking({ booking_status: "in_progress", coverage_done_at: "2026-10-02T00:00:00.000Z" }))).toEqual({ stage: "shoot_complete", source: "shoot", since: "2026-10-02T00:00:00.000Z" });
    expect(productionStage(booking({ booking_status: "confirmed", coverage_done_at: "2026-10-02T00:00:00.000Z" }))?.stage).toBe("shoot_complete");
    expect(productionStage(booking({ booking_status: "in_progress", coverage_done_at: null }))?.stage).toBe("shoot_complete");
  });

  it("uses the stored stage for culling / editing / review and ignores junk", () => {
    const b = booking({ booking_status: "in_progress", coverage_done_at: "2026-10-02T00:00:00.000Z", details: { production: { stage: "editing", updatedAt: "2026-10-05T00:00:00.000Z", updatedBy: "u1" } } });
    expect(productionStage(b)).toEqual({ stage: "editing", source: "stored", since: "2026-10-05T00:00:00.000Z" });
    expect(productionStage(booking({ booking_status: "in_progress", details: { production: { stage: "delivered" } } }))?.stage).toBe("shoot_complete");
    expect(productionStage(booking({ booking_status: "in_progress", details: { production: "culling" } }))?.stage).toBe("shoot_complete");
    expect(readStoredProduction(null)).toBeNull();
    expect(readStoredProduction({ production: { stage: "culling" } })).toEqual({ stage: "culling", updatedAt: null, updatedBy: null });
  });

  it("gallery ready beats a stored editing stage; delivered columns beat everything", () => {
    const stored = { production: { stage: "editing", updatedAt: "2026-10-05T00:00:00.000Z" } };
    expect(productionStage(booking({ booking_status: "in_progress", details: stored }), { status: "ready" })).toEqual({ stage: "ready", source: "gallery", since: null });
    expect(productionStage(booking({ booking_status: "in_progress", details: stored }), { status: "created" })?.stage).toBe("editing");
    expect(productionStage(booking({ booking_status: "in_progress", details: stored, gallery_delivered_at: "2026-10-08T00:00:00.000Z" }), { status: "ready" })).toEqual({ stage: "delivered", source: "booking", since: "2026-10-08T00:00:00.000Z" });
    expect(productionStage(booking({ booking_status: "delivered", details: stored }))?.stage).toBe("delivered");
    expect(productionStage(booking({ booking_status: "in_progress", details: stored }), { status: "delivered" })?.stage).toBe("delivered");
  });

  it("delivered with the final balance due is Follow-up", () => {
    expect(productionStage(booking({ booking_status: "delivered", balance_state: "due", balance_qr: 175, delivered_at: "2026-10-08T00:00:00.000Z" }))?.stage).toBe("followup");
    expect(productionStage(booking({ booking_status: "delivered", balance_state: "due", balance_qr: 0 }))?.stage).toBe("delivered");
    expect(productionStage(booking({ booking_status: "delivered", balance_state: "paid", balance_qr: 175 }))?.stage).toBe("delivered");
  });

  it("only the editing stages are settable, and not once the gallery is ready or delivered", () => {
    expect(settableStages(null)).toEqual([]);
    expect(settableStages(productionStage(booking({ booking_status: "in_progress" })))).toEqual(["culling", "editing", "review"]);
    expect(settableStages(productionStage(booking({ booking_status: "in_progress" }), { status: "ready" }))).toEqual([]);
    expect(settableStages(productionStage(booking({ booking_status: "delivered" })))).toEqual([]);
  });

  it("withStoredProduction writes only the production key and keeps the rest of details", () => {
    const out = withStoredProduction({ belt: "blue", production: { stage: "culling" } }, "review", NOW, "u1") as Record<string, unknown>;
    expect(out).toEqual({ belt: "blue", production: { stage: "review", updatedAt: NOW.toISOString(), updatedBy: "u1" } });
    expect(withStoredProduction(out as never, null, NOW, "u1")).toEqual({ belt: "blue" });
    expect(withStoredProduction(null, "culling", NOW, null)).toEqual({ production: { stage: "culling", updatedAt: NOW.toISOString(), updatedBy: null } });
  });

  it("groupByStage fills the columns in board order, oldest first, dropping rows outside production", () => {
    const rows = [
      { booking: booking({ id: "a", booking_status: "in_progress", coverage_done_at: "2026-10-03T00:00:00.000Z" }), gallery: null },
      { booking: booking({ id: "b", booking_status: "in_progress", coverage_done_at: "2026-10-01T00:00:00.000Z" }), gallery: null },
      { booking: booking({ id: "c", booking_status: "confirmed" }), gallery: null },
      { booking: booking({ id: "d", booking_status: "in_progress" }), gallery: { status: "ready" as const } },
    ];
    const g = groupByStage(rows);
    expect(g.shoot_complete.map((c) => c.row.booking.id)).toEqual(["b", "a"]);
    expect(g.ready.map((c) => c.row.booking.id)).toEqual(["d"]);
    expect(g.culling).toEqual([]);
    expect(Object.keys(g)).toEqual(["shoot_complete", "culling", "editing", "review", "ready", "delivered", "followup"]);
  });
});
