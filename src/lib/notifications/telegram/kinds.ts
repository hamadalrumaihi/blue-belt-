import type { AlertKind } from "@/lib/notifications/types";

/**
 * Alert kinds that can be delivered to Telegram. Shared by the server
 * (notifier, actions) and the Settings UI, so this module stays free of
 * server-only imports. Threshold alerts (30/15/5 min) stay in-app only.
 */
export const TELEGRAM_ALERT_KINDS = ["GO_TO_MAT", "ON_MAT", "MAT_CHANGE", "MOVED_EARLIER", "MOVED_LATER", "REMIND_15", "REMIND_5"] as const satisfies readonly AlertKind[];

export type TelegramAlertKind = (typeof TELEGRAM_ALERT_KINDS)[number];

export const TELEGRAM_KIND_LABELS: Record<TelegramAlertKind, string> = {
  GO_TO_MAT: "Go to mat (2 min)",
  ON_MAT: "On mat",
  MAT_CHANGE: "Mat change",
  MOVED_EARLIER: "Moved earlier",
  MOVED_LATER: "Moved later (15+ min)",
  REMIND_15: "Reminder 15 min before",
  REMIND_5: "Reminder 5 min before",
};

/**
 * Owner (studio) notification kinds beyond match alerts. Each is one
 * Telegram message, deduped by its alert_key, in its category.
 */
export const OWNER_KINDS = [
  "BOOKING_NEW",
  "BOOKING_PAYMENT_REQUESTED",
  "BOOKING_PAID",
  "BOOKING_CANCELLED",
  "LEAD_NEW",
  "CONTRACT_SIGNED",
  "CONTRACT_DECLINED",
  "ORDER_PLACED",
  "INVOICE_CREATED",
  "PAYMENT_CONFIRMED",
  "GALLERY_READY",
  "GALLERY_LINKED",
  "DELIVERY_SENT",
  "EMAIL_FAILED",
  "INTEGRATION_FAILED",
] as const;

export type OwnerKind = (typeof OWNER_KINDS)[number];

/** Message category prefix: who should read it first. */
export type MessageCategory = "match" | "bookings" | "orders" | "delivery" | "system";

export const CATEGORY_LABEL: Record<MessageCategory, string> = { match: "Match", bookings: "Bookings", orders: "Orders", delivery: "Delivery", system: "System" };

export function categoryForKind(kind: string): MessageCategory {
  if (kind.startsWith("INCIDENT_") || kind.startsWith("RECOVERY_") || kind.startsWith("SYSTEM_") || kind === "EMAIL_FAILED" || kind === "INTEGRATION_FAILED") return "system";
  if (kind.startsWith("BOOKING_") || kind.startsWith("CONTRACT_") || kind === "LEAD_NEW") return "bookings";
  if (kind.startsWith("GALLERY_") || kind.startsWith("DELIVERY_")) return "delivery";
  if (kind.startsWith("ORDER_") || kind.startsWith("PAYMENT_") || kind.startsWith("INVOICE_")) return "orders";
  return "match";
}

export function isTelegramAlertKind(value: unknown): value is TelegramAlertKind {
  return typeof value === "string" && (TELEGRAM_ALERT_KINDS as readonly string[]).includes(value);
}

/** Keeps only known kinds, de-duplicated, in canonical order. */
export function normalizeKinds(input: unknown): TelegramAlertKind[] | null {
  if (!Array.isArray(input)) return null;
  if (!input.every(isTelegramAlertKind)) return null;
  const set = new Set<TelegramAlertKind>(input);
  return TELEGRAM_ALERT_KINDS.filter((k) => set.has(k));
}
