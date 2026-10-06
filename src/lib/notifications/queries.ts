import "server-only";
import { ALWAYS_ON_KINDS, CLIENT_NOTIFICATION_KINDS, type ClientNotificationKind } from "@/lib/notifications/email/kinds";
import { maskSecrets } from "@/lib/notifications/telegram/health";
import type { DeliveryStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner reads for the Notifications page (user client, RLS). Delivery rows
 * are reduced to what the page shows: the e-mail HTML never leaves the
 * server and the recipient address is masked before it is returned.
 */
export type DeliveryView = {
  id: number;
  channel: string;
  kind: string;
  category: string | null;
  status: DeliveryStatus;
  /** Masked e-mail (a***@domain) or "Telegram". */
  to: string;
  subject: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type EmailStats = { queued: number; sent: number; failed: number };

const DELIVERY_COLS = "id,channel,kind,category,status,attempts,last_error,sent_at,created_at,payload";

export function maskEmail(address: string): string {
  const at = address.indexOf("@");
  if (at <= 0) return "***";
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

type PayloadLite = { to?: unknown; subject?: unknown };

function payloadOf(payload: unknown): PayloadLite {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as PayloadLite) : {};
}

export function toDeliveryView(row: { id: number; channel: string; kind: string; category: string | null; status: DeliveryStatus; attempts: number; last_error: string | null; sent_at: string | null; created_at: string; payload: unknown }): DeliveryView {
  const p = payloadOf(row.payload);
  const to = row.channel === "email" ? (typeof p.to === "string" ? maskEmail(p.to) : "—") : "Telegram";
  return {
    id: row.id,
    channel: row.channel,
    kind: row.kind,
    category: row.category,
    status: row.status,
    to,
    subject: row.channel === "email" && typeof p.subject === "string" ? p.subject.slice(0, 120) : null,
    attempts: row.attempts,
    lastError: row.last_error ? maskSecrets(row.last_error).slice(0, 200) : null,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

export async function listRecentDeliveries(limit = 50): Promise<DeliveryView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("photo_notification_deliveries").select(DELIVERY_COLS).in("channel", ["telegram", "email"]).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toDeliveryView);
}

/** E-mail outcomes in the last `days` days: queued = pending/sending. */
export async function emailStats(now: Date, days = 7): Promise<EmailStats> {
  const supabase = await createClient();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { data } = await supabase.from("photo_notification_deliveries").select("status").eq("channel", "email").gte("created_at", since).limit(5000);
  const stats: EmailStats = { queued: 0, sent: 0, failed: 0 };
  for (const row of data ?? []) {
    if (row.status === "sent") stats.sent += 1;
    else if (row.status === "failed") stats.failed += 1;
    else if (row.status === "pending" || row.status === "sending") stats.queued += 1;
  }
  return stats;
}

export type ClientPrefView = { kind: ClientNotificationKind; enabled: boolean; locked: boolean };

/** Every client kind with its current switch (on unless a row says off; always-on kinds are locked). */
export async function listClientPrefs(): Promise<ClientPrefView[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("photo_client_notification_prefs").select("kind,enabled");
  const off = new Set((data ?? []).filter((r) => !r.enabled).map((r) => r.kind));
  return CLIENT_NOTIFICATION_KINDS.map((kind) => ({ kind, enabled: ALWAYS_ON_KINDS.includes(kind) ? true : !off.has(kind), locked: ALWAYS_ON_KINDS.includes(kind) }));
}
