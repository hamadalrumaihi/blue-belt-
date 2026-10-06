/**
 * Turns the owner's recent delivery rows into a plain answer to "are my
 * Telegram alerts working?". Pure, so it is shared by the Settings page and
 * the tests. Error text is shown to the owner only, with anything shaped
 * like a bot token masked just in case.
 */

export type DeliveryRowLite = { status: string; created_at: string; sent_at: string | null; last_error: string | null; next_attempt_at: string | null; updated_at: string };

export type DeliveryHealth = {
  verdict: "working" | "idle" | "failing" | "stuck" | "blocked";
  /** One sentence for the Settings card. */
  summary: string;
  lastSentAt: string | null;
  sent24h: number;
  failed24h: number;
  waiting: number;
  lastError: string | null;
  lastErrorAt: string | null;
};

const DAY_MS = 24 * 3600_000;
/** A message still waiting this long after it was queued means the delivery job is not running. */
export const STUCK_AFTER_MS = 15 * 60_000;

export function maskSecrets(text: string): string {
  return text.replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, "[hidden]");
}

export function summarizeDeliveries(rows: DeliveryRowLite[], opts: { now: Date; linkEnabled: boolean; lastSentAt: string | null }): DeliveryHealth {
  const now = opts.now.getTime();
  const recent = rows.filter((r) => now - new Date(r.created_at).getTime() <= DAY_MS);
  const sent24h = recent.filter((r) => r.status === "sent").length;
  const failedRows = recent.filter((r) => r.status === "failed").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const waitingRows = rows.filter((r) => r.status === "pending");
  const stuck = waitingRows.some((r) => now - new Date(r.created_at).getTime() > STUCK_AFTER_MS);
  const lastFailed = failedRows[0] ?? null;
  const lastError = lastFailed?.last_error ? maskSecrets(lastFailed.last_error).slice(0, 200) : null;
  const base = { lastSentAt: opts.lastSentAt, sent24h, failed24h: failedRows.length, waiting: waitingRows.length, lastError, lastErrorAt: lastFailed?.updated_at ?? null };

  if (!opts.linkEnabled && lastError && /forbidden|blocked|chat not found|user not found|kicked/i.test(lastError)) {
    return { ...base, verdict: "blocked", summary: "Telegram refused delivery (the bot was blocked or the chat was removed), so alerts were paused. Unblock the bot, then link the chat again." };
  }
  if (failedRows.length) {
    return { ...base, verdict: "failing", summary: `${failedRows.length} ${failedRows.length === 1 ? "message" : "messages"} could not be delivered in the last 24 hours.` };
  }
  if (stuck) {
    return { ...base, verdict: "stuck", summary: `${waitingRows.length} ${waitingRows.length === 1 ? "message is" : "messages are"} waiting to send for more than ${STUCK_AFTER_MS / 60_000} minutes — the delivery job may not be running.` };
  }
  if (opts.lastSentAt) return { ...base, verdict: "working", summary: `Working — ${sent24h} ${sent24h === 1 ? "message" : "messages"} delivered in the last 24 hours.` };
  return { ...base, verdict: "idle", summary: "Linked, but nothing has been sent yet. Alerts arrive when a refresh finds something, an order comes in, or a check fails." };
}
