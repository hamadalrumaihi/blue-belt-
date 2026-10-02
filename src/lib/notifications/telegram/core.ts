import type { AppAlert } from "@/lib/notifications/types";
import type { ChangeValue, DetectedChange } from "@/lib/changes";
import { isTelegramAlertKind, type TelegramAlertKind } from "./kinds";

/**
 * Pure helpers for the Telegram channel: dedupe keys, message formatting,
 * retry schedule and error classification. No I/O, no grammY import, so the
 * tests exercise them without a token or network.
 */

export const TELEGRAM_CHANNEL = "telegram" as const;
export const MAX_ATTEMPTS = 3;
/** Delay before the next try, indexed by the number of attempts already made. */
export const BACKOFF_MS = [30_000, 120_000, 600_000] as const;

export type HistoryChange = DetectedChange & { match_id: string };

/**
 * Dedupe key for an alert. Ranked alerts (`go:<matchId>`, `on-mat:<matchId>`)
 * already carry a stable id. History-derived alerts have synthetic negative
 * ids in live results, so their key is built from the change itself and is
 * identical across retries and refreshes.
 */
export function deliveryKeyFor(alert: AppAlert, historyChanges: ReadonlyMap<number | string, HistoryChange>): string {
  if (!alert.id.startsWith("hist:")) return alert.id;
  const raw = alert.id.slice("hist:".length);
  const change = historyChanges.get(raw) ?? historyChanges.get(Number(raw));
  if (!change) return alert.id;
  // A status flip to on_mat means the same thing as the ranked ON MAT alert.
  if (change.change_type === "STATUS_CHANGE" && alert.kind === "ON_MAT") return `on-mat:${change.match_id}`;
  return `hist:${change.change_type}:${change.match_id}:${valueKey(change.old_value)}>${valueKey(change.new_value)}`;
}

function valueKey(v: ChangeValue | null | undefined): string {
  if (!v || v.value === null || v.value === undefined) return "";
  return String(v.value);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type MessageDetails = { mat?: string | null; time?: string | null };

/** Concise HTML message: bold title, body, then mat and time when known. */
export function formatTelegramMessage(alert: Pick<AppAlert, "title" | "body" | "mat">, details: MessageDetails = {}): string {
  const lines = [`<b>${escapeHtml(alert.title)}</b>`, escapeHtml(alert.body)];
  const meta = [details.mat ?? alert.mat, details.time].filter((v): v is string => Boolean(v && v.trim()));
  if (meta.length) lines.push(escapeHtml(meta.join(" · ")));
  return lines.join("\n");
}

/** Milliseconds to wait before the next attempt, or null when no attempts remain. */
export function backoffDelayMs(attemptsMade: number): number | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  return BACKOFF_MS[Math.min(Math.max(attemptsMade, 1), BACKOFF_MS.length) - 1];
}

export type ErrorClass =
  | { transient: true; retryAfterMs: number | null; reason: string }
  | { transient: false; disableLink: boolean; reason: string };

/**
 * Classifies a sendMessage failure by shape (grammY's GrammyError exposes
 * `error_code`, `description` and `parameters.retry_after`; HttpError and
 * plain fetch failures have none of these and are treated as transient).
 */
export function classifyTelegramError(err: unknown): ErrorClass {
  const e = (err && typeof err === "object" ? err : {}) as { error_code?: unknown; description?: unknown; message?: unknown; parameters?: { retry_after?: unknown } };
  const code = typeof e.error_code === "number" ? e.error_code : null;
  const description = String(e.description ?? e.message ?? "unknown error").slice(0, 200);
  if (code === null) return { transient: true, retryAfterMs: null, reason: description };
  if (code === 429) {
    const retryAfter = typeof e.parameters?.retry_after === "number" ? e.parameters.retry_after : null;
    return { transient: true, retryAfterMs: retryAfter !== null ? Math.max(1, retryAfter) * 1000 : null, reason: description };
  }
  if (code >= 500) return { transient: true, retryAfterMs: null, reason: description };
  if (code === 403) return { transient: false, disableLink: true, reason: description };
  if (code === 400 && /chat not found|user not found|chat_id is empty/i.test(description)) return { transient: false, disableLink: true, reason: description };
  return { transient: false, disableLink: false, reason: description };
}

/** Subscription rows as the notifier needs them (global = event_id null). */
export type SubscriptionLike = { event_id: string | null; kinds: string[]; enabled: boolean };

/**
 * Picks the subscription that governs an athlete: the per-event row when one
 * exists, else the global row. Returns null when nothing is subscribed.
 */
export function resolveSubscription(subs: readonly SubscriptionLike[], eventId: string | null): SubscriptionLike | null {
  const perEvent = eventId ? subs.find((s) => s.event_id === eventId) : undefined;
  return perEvent ?? subs.find((s) => s.event_id === null) ?? null;
}

export function kindAllowed(sub: SubscriptionLike | null, kind: string): kind is TelegramAlertKind {
  return Boolean(sub && sub.enabled && isTelegramAlertKind(kind) && sub.kinds.includes(kind));
}
