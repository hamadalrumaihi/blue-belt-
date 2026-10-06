"use server";

import { revalidatePath } from "next/cache";
import { ALWAYS_ON_KINDS, isClientNotificationKind } from "@/lib/notifications/email/kinds";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner switches for client e-mails and a manual retry for a failed
 * delivery. User client throughout (RLS: owner rows only); the retry only
 * re-queues the row — the delivery runner does the sending.
 */
export type NotificationActionResult = { ok: true } | { ok: false; error: string };

export async function setClientNotificationPref(kind: string, enabled: boolean): Promise<NotificationActionResult> {
  if (!isClientNotificationKind(kind)) return { ok: false, error: "Unknown notification kind." };
  if (typeof enabled !== "boolean") return { ok: false, error: "enabled must be a boolean." };
  if (ALWAYS_ON_KINDS.includes(kind) && !enabled) return { ok: false, error: "This notification cannot be switched off: clients need it to sign in." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { error } = await supabase.from("photo_client_notification_prefs").upsert({ owner_id: user.id, kind, enabled, updated_at: new Date().toISOString() }, { onConflict: "owner_id,kind" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

/** Puts a failed delivery back in the queue with a fresh attempt budget. */
export async function retryDelivery(id: number): Promise<NotificationActionResult> {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return { ok: false, error: "Invalid delivery id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const now = new Date().toISOString();
  const { error, count } = await supabase
    .from("photo_notification_deliveries")
    .update({ status: "pending", attempts: 0, next_attempt_at: now, leased_until: null, lease_owner: null, last_error: null, updated_at: now }, { count: "exact" })
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("status", "failed");
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Only a failed delivery can be retried." };
  revalidatePath("/notifications");
  return { ok: true };
}
