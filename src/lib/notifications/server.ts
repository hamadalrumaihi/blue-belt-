import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";
import type { AthleteRow, EventRow } from "@/lib/types";
import type { RefreshResult } from "@/lib/watch-service";
import { isTelegramEnabled } from "./telegram/config";

/**
 * Server-side notification hook, called by watch-service after every batch
 * refresh has been persisted. External channels plug in here; in-app banners
 * are computed client-side from the same data and do not go through this
 * function. Telegram (./telegram) is the built-in channel and runs only when
 * TELEGRAM_ENABLED=1 and TELEGRAM_BOT_TOKEN are set; otherwise this is a no-op
 * and the grammY module is never loaded.
 */
export type RefreshNotificationContext = {
  supabase: SupabaseClient<Database>;
  athletes: AthleteRow[];
  events: Map<string, EventRow>;
  results: RefreshResult[];
  now: Date;
  log: Logger;
};

export type RefreshNotifier = (ctx: RefreshNotificationContext) => Promise<void>;

let notifier: RefreshNotifier | null = null;

/** Replaces the built-in Telegram notifier (tests, alternative channels). `null` restores it. */
export function registerRefreshNotifier(fn: RefreshNotifier | null): void {
  notifier = fn;
}

export async function notifyAfterRefresh(ctx: RefreshNotificationContext): Promise<void> {
  try {
    if (notifier) {
      await notifier(ctx);
      return;
    }
    if (!isTelegramEnabled()) return;
    if (!ctx.results.length) return;
    // Enqueue operational incident / recovery messages first, then the sender
    // flushes them alongside the match alerts.
    const { runIncidentNotifier } = await import("./telegram/incidents-run");
    await runIncidentNotifier(ctx);
    const { runTelegramNotifier } = await import("./telegram/notifier");
    await runTelegramNotifier(ctx);
  } catch (err) {
    // A notification failure must never fail a refresh.
    ctx.log.warn("notify.failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
