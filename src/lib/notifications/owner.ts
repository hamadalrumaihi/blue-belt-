import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { deliveryInsert } from "./delivery-runner";
import { escapeHtml } from "./telegram/core";
import { categoryForKind, type OwnerKind } from "./telegram/kinds";

type Client = SupabaseClient<Database>;

export type OwnerMessage = {
  ownerId: string;
  kind: OwnerKind;
  /** Dedupe key: the same key is never sent twice (e.g. `booking:<id>:new`). */
  alertKey: string;
  title: string;
  lines?: Array<string | null | undefined>;
  /** Absolute link appended as "Open: <url>". */
  url?: string | null;
  now?: Date;
  extra?: Record<string, Json>;
};

/** HTML for a studio message: bold title, plain lines, optional link. All text is escaped. */
export function ownerMessageHtml(m: Pick<OwnerMessage, "title" | "lines" | "url">): string {
  const parts = [`<b>${escapeHtml(m.title)}</b>`];
  for (const line of m.lines ?? []) if (line) parts.push(escapeHtml(line));
  if (m.url) parts.push(`Open: ${escapeHtml(m.url)}`);
  return parts.join("\n");
}

/**
 * Queue one Telegram message for the owner. Idempotent on (owner, alert key):
 * a repeated call is a no-op, so callers may enqueue from retries freely.
 * Rows are drained by the delivery runner; while Telegram is off they wait.
 * Never throws: the caller's action must not fail because a notice did.
 */
export async function enqueueOwnerTelegram(supabase: Client, m: OwnerMessage): Promise<{ ok: boolean; error?: string }> {
  const now = m.now ?? new Date();
  const row = deliveryInsert({ ownerId: m.ownerId, alertKey: m.alertKey, kind: m.kind, text: ownerMessageHtml(m), category: categoryForKind(m.kind), extra: m.extra, now });
  const { error } = await supabase.from("photo_notification_deliveries").upsert(row, { onConflict: "owner_id,channel,alert_key", ignoreDuplicates: true });
  return error ? { ok: false, error: error.message } : { ok: true };
}
