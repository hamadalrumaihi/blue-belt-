import type { AlertKind } from "@/lib/notifications/types";

/**
 * Alert kinds that can be delivered to Telegram. Shared by the server
 * (notifier, actions) and the Settings UI, so this module stays free of
 * server-only imports. Threshold alerts (30/15/5 min) stay in-app only.
 */
export const TELEGRAM_ALERT_KINDS = ["GO_TO_MAT", "ON_MAT", "MAT_CHANGE", "MOVED_EARLIER", "MOVED_LATER"] as const satisfies readonly AlertKind[];

export type TelegramAlertKind = (typeof TELEGRAM_ALERT_KINDS)[number];

export const TELEGRAM_KIND_LABELS: Record<TelegramAlertKind, string> = {
  GO_TO_MAT: "Go to mat (2 min)",
  ON_MAT: "On mat",
  MAT_CHANGE: "Mat change",
  MOVED_EARLIER: "Moved earlier",
  MOVED_LATER: "Moved later (15+ min)",
};

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
