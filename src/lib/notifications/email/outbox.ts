import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, type Logger } from "@/lib/log";
import type { Database, Json, PhotoNotificationDeliveryRow } from "@/lib/supabase/database.types";
import { isValidEmail } from "@/lib/utils";
import { backoffDelayMs } from "@/lib/notifications/telegram/core";
import { emailFrom, emailReplyTo, isEmailDryRun } from "./config";
import { ALWAYS_ON_KINDS, type ClientNotificationKind } from "./kinds";
import type { EmailDraft } from "./templates";

type Client = SupabaseClient<Database>;

export const EMAIL_CHANNEL = "email" as const;

export type EnqueueEmailInput = {
  ownerId: string;
  kind: ClientNotificationKind;
  /** Dedupe key, e.g. `email:booking:<id>:confirmed`. */
  alertKey: string;
  draft: EmailDraft;
  /** Links the row to a client record for the Notifications page. */
  personId?: string | null;
  bookingId?: string | null;
  now?: Date;
};

export type EnqueueEmailResult = { ok: true; queued: boolean; reason?: "disabled_by_owner" | "invalid_address" | "duplicate" } | { ok: false; error: string };

/** Owner preference: a kind is on unless an explicit row says off. */
export async function isClientKindEnabled(supabase: Client, ownerId: string, kind: ClientNotificationKind): Promise<boolean> {
  if (ALWAYS_ON_KINDS.includes(kind)) return true;
  const { data } = await supabase.from("photo_client_notification_prefs").select("enabled").eq("owner_id", ownerId).eq("kind", kind).maybeSingle();
  return data ? data.enabled : true;
}

/**
 * Queue one client e-mail in the shared outbox (channel 'email'). Honors the
 * owner's per-kind switch, validates the address, dedupes on alert key.
 * The e-mail runner sends it; while e-mail is off the row simply waits.
 */
export async function enqueueClientEmail(supabase: Client, input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
  if (!isValidEmail(input.draft.to)) return { ok: true, queued: false, reason: "invalid_address" };
  if (!(await isClientKindEnabled(supabase, input.ownerId, input.kind))) return { ok: true, queued: false, reason: "disabled_by_owner" };
  const now = input.now ?? new Date();
  const { data, error } = await supabase
    .from("photo_notification_deliveries")
    .upsert(
      {
        owner_id: input.ownerId,
        channel: EMAIL_CHANNEL,
        alert_key: input.alertKey,
        kind: input.kind,
        category: "delivery",
        payload: { to: input.draft.to, subject: input.draft.subject, html: input.draft.html, text: input.draft.text, personId: input.personId ?? null, bookingId: input.bookingId ?? null } as Json,
        status: "pending",
        attempts: 0,
        next_attempt_at: now.toISOString(),
      },
      { onConflict: "owner_id,channel,alert_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, queued: (data ?? []).length > 0, reason: (data ?? []).length ? undefined : "duplicate" };
}

export type SendEmail = (draft: EmailDraft) => Promise<{ id: string | null }>;

export type EmailBatchSummary = { claimed: number; sent: number; retried: number; failed: number };

export type EmailBatchOptions = { supabase: Client; now?: Date; log?: Logger; send?: SendEmail; limit?: number; worker?: string; leaseSeconds?: number };

/**
 * One bounded pass of the e-mail runner over channel 'email'. Same claim RPC
 * and lease semantics as Telegram: at-least-once, three attempts with
 * backoff, failures recorded on the row (and surfaced on /notifications).
 */
export async function runEmailBatch(opts: EmailBatchOptions): Promise<EmailBatchSummary> {
  const { supabase } = opts;
  const now = opts.now ?? new Date();
  const log = (opts.log ?? createLogger({ route: "deliveries" })).child({ channel: EMAIL_CHANNEL });
  const send = opts.send ?? defaultEmailSender(log);
  const summary: EmailBatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  const { data, error } = await supabase.rpc("photo_claim_notification_deliveries", {
    p_channel: EMAIL_CHANNEL,
    p_limit: Math.min(Math.max(opts.limit ?? 20, 1), 100),
    p_lease_seconds: opts.leaseSeconds ?? 60,
    p_worker: opts.worker ?? `email:${process.pid}`,
    p_owner_id: null,
  });
  if (error) throw new Error(`claim email deliveries: ${error.message}`);
  const rows = (data ?? []) as PhotoNotificationDeliveryRow[];
  summary.claimed = rows.length;
  for (const row of rows) {
    const draft = draftOf(row);
    if (!draft) {
      await patch(supabase, row, { status: "failed", last_error: "malformed e-mail payload", next_attempt_at: null, leased_until: null, updated_at: now.toISOString() });
      summary.failed += 1;
      continue;
    }
    try {
      await send(draft);
      await patch(supabase, row, { status: "sent", sent_at: now.toISOString(), last_error: null, next_attempt_at: null, leased_until: null, updated_at: now.toISOString() });
      summary.sent += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 200) : "send failed";
      const delay = backoffDelayMs(row.attempts);
      await patch(supabase, row, {
        status: delay === null ? "failed" : "pending",
        last_error: reason,
        next_attempt_at: delay === null ? null : new Date(now.getTime() + delay).toISOString(),
        leased_until: null,
        updated_at: now.toISOString(),
      });
      if (delay === null) summary.failed += 1;
      else summary.retried += 1;
      log.warn("email.retry", { deliveryId: row.id, attempts: row.attempts, reason });
    }
  }
  if (summary.claimed) log.info("email.batch", summary);
  return summary;
}

export function draftOf(row: Pick<PhotoNotificationDeliveryRow, "payload">): EmailDraft | null {
  const p = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : null;
  if (!p || typeof p.to !== "string" || typeof p.subject !== "string" || typeof p.html !== "string") return null;
  return { to: p.to, subject: p.subject, html: p.html, text: typeof p.text === "string" ? p.text : "" };
}

async function patch(supabase: Client, row: PhotoNotificationDeliveryRow, update: Partial<PhotoNotificationDeliveryRow>): Promise<void> {
  const { error } = await supabase.from("photo_notification_deliveries").update(update).eq("id", row.id).eq("owner_id", row.owner_id);
  if (error) throw new Error(error.message);
}

/**
 * Resend over plain HTTPS (no SDK). Dry run in tests / EMAIL_DRY_RUN=1 so no
 * client ever receives test traffic. The API key is read here only.
 */
export function defaultEmailSender(log: Logger): SendEmail {
  if (isEmailDryRun()) {
    return async (draft) => {
      log.info("email.dry_run", { to: draft.to, subject: draft.subject.slice(0, 60) });
      return { id: null };
    };
  }
  return async (draft) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    const body: Record<string, unknown> = { from: emailFrom(), to: [draft.to], subject: draft.subject, html: draft.html, text: draft.text };
    const replyTo = emailReplyTo();
    if (replyTo) body.reply_to = replyTo;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`resend ${res.status}: ${text.slice(0, 160)}`);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: json.id ?? null };
  };
}
