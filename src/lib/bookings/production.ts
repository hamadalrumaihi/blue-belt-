import type { Json, PhotoBookingRow, PhotoGalleryRow } from "@/lib/supabase/database.types";
import { isPlainObject } from "@/lib/validation";

/**
 * Production board stages, DERIVED from columns that already exist. No new
 * status enum, no duplicate record: the booking lifecycle (`booking_status`),
 * `coverage_done_at`, the gallery status, `gallery_delivered_at` /
 * `delivered_at` and `balance_state` decide the columns that have a real
 * column behind them. Only the three editing stages with no column
 * (culling, editing, review) are stored, additively, in
 * `photo_bookings.details.production = { stage, updatedAt, updatedBy }`.
 *
 *   Shoot complete → Culling → Editing → Review → Ready → Delivered → Follow-up
 *
 * Precedence (highest first): delivered columns → gallery ready → stored
 * editing stage → shoot complete. A stored stage never overrides a real
 * column, so marking the gallery delivered always wins over a stale
 * "editing" note.
 */
export const PRODUCTION_STAGES = ["shoot_complete", "culling", "editing", "review", "ready", "delivered", "followup"] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

/** The stages the owner sets by hand (the ones without a column). */
export const STORED_STAGES = ["culling", "editing", "review"] as const;
export type StoredStage = (typeof STORED_STAGES)[number];

export const PRODUCTION_STAGE_LABEL: Record<ProductionStage, string> = {
  shoot_complete: "Shoot complete",
  culling: "Culling",
  editing: "Editing",
  review: "Review",
  ready: "Ready",
  delivered: "Delivered",
  followup: "Follow-up",
};

/** What moves a card out of each column (shown under the column heading). */
export const PRODUCTION_STAGE_HINT: Record<ProductionStage, string> = {
  shoot_complete: "Shoot marked complete; nothing started yet. Set Culling when you begin.",
  culling: "Selecting keepers. Set Editing when the selects are in.",
  editing: "Retouching / colour. Set Review when the set is ready to check.",
  review: "Final check before the gallery goes up. Mark the gallery Ready to move on.",
  ready: "Gallery is ready in Pic-Time but the client has not been told. Deliver it from the booking.",
  delivered: "Delivered; money settled or not yet due. Complete the booking when everything is in.",
  followup: "Delivered with the final balance due. Chase the balance / ask for a review.",
};

export function isStoredStage(v: unknown): v is StoredStage {
  return typeof v === "string" && (STORED_STAGES as readonly string[]).includes(v);
}

export function isProductionStage(v: unknown): v is ProductionStage {
  return typeof v === "string" && (PRODUCTION_STAGES as readonly string[]).includes(v);
}

export type StoredProduction = { stage: StoredStage; updatedAt: string | null; updatedBy: string | null };

/** `details.production` when it holds a valid stored stage; null otherwise (never throws on junk). */
export function readStoredProduction(details: Json | null | undefined): StoredProduction | null {
  if (!isPlainObject(details) || !isPlainObject(details.production)) return null;
  const p = details.production;
  if (!isStoredStage(p.stage)) return null;
  return { stage: p.stage, updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : null, updatedBy: typeof p.updatedBy === "string" ? p.updatedBy : null };
}

/** `details` with `production` replaced (stage null clears it); every other key is kept. */
export function withStoredProduction(details: Json | null | undefined, stage: StoredStage | null, now: Date, userId: string | null): Json {
  const base: Record<string, Json | undefined> = isPlainObject(details) ? { ...(details as Record<string, Json | undefined>) } : {};
  if (stage) base.production = { stage, updatedAt: now.toISOString(), updatedBy: userId };
  else delete base.production;
  return base as Json;
}

export type ProductionBooking = Pick<PhotoBookingRow, "booking_status" | "coverage_done_at" | "delivered_at" | "gallery_delivered_at" | "balance_state" | "balance_qr" | "details">;
export type ProductionGallery = Pick<PhotoGalleryRow, "status"> | null | undefined;

export type DerivedStage = {
  stage: ProductionStage;
  /** Which fact decided the column. */
  source: "booking" | "gallery" | "stored" | "shoot";
  /** When the booking entered this stage, when a timestamp exists. */
  since: string | null;
};

/**
 * The column a booking sits in, or null when it is not in production
 * (before the shoot, cancelled, or completed).
 */
export function productionStage(b: ProductionBooking, gallery: ProductionGallery = null): DerivedStage | null {
  if (b.booking_status === "cancelled" || b.booking_status === "completed") return null;
  const deliveredAt = b.gallery_delivered_at ?? b.delivered_at ?? null;
  if (b.booking_status === "delivered" || deliveredAt || gallery?.status === "delivered") {
    if (b.balance_state === "due" && Number(b.balance_qr) > 0) return { stage: "followup", source: "booking", since: deliveredAt };
    return { stage: "delivered", source: "booking", since: deliveredAt };
  }
  const shootDone = Boolean(b.coverage_done_at) || b.booking_status === "in_progress";
  if (!shootDone) return null;
  if (gallery?.status === "ready") return { stage: "ready", source: "gallery", since: null };
  const stored = readStoredProduction(b.details);
  if (stored) return { stage: stored.stage, source: "stored", since: stored.updatedAt };
  return { stage: "shoot_complete", source: "shoot", since: b.coverage_done_at };
}

/** Which stored stage the owner may set from the current column (null = clear back to Shoot complete). */
export function settableStages(current: DerivedStage | null): StoredStage[] {
  if (!current) return [];
  if (current.stage === "ready" || current.stage === "delivered" || current.stage === "followup") return [];
  return [...STORED_STAGES];
}

export type ProductionCard<T> = { row: T; derived: DerivedStage };

/** Rows grouped by column, in board order; rows outside production are dropped. */
export function groupByStage<T extends { booking: ProductionBooking; gallery: ProductionGallery }>(rows: T[]): Record<ProductionStage, Array<ProductionCard<T>>> {
  const out = { shoot_complete: [], culling: [], editing: [], review: [], ready: [], delivered: [], followup: [] } as Record<ProductionStage, Array<ProductionCard<T>>>;
  for (const row of rows) {
    const derived = productionStage(row.booking, row.gallery);
    if (derived) out[derived.stage].push({ row, derived });
  }
  for (const s of PRODUCTION_STAGES) out[s].sort((a, b) => (a.derived.since ?? "").localeCompare(b.derived.since ?? ""));
  return out;
}
