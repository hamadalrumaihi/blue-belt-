"use server";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "@/lib/settings";
import { isUuid } from "@/lib/validation";

/**
 * Persisted account settings. localStorage remains the per-device cache so
 * the UI is instant and works offline; these actions keep the account copy
 * in sync so a second device (or a reinstalled browser) starts from the
 * same preferences. RLS scopes every row to the signed-in owner.
 */
export type SettingsSnapshot = { settings: Settings; updatedAt: string | null };

export async function loadUserSettings(): Promise<SettingsSnapshot | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("photo_user_settings").select("settings,updated_at").eq("owner_id", user.id).maybeSingle();
  if (error || !data) return { settings: DEFAULT_SETTINGS, updatedAt: null };
  return { settings: sanitizeSettings(data.settings), updatedAt: data.updated_at };
}

export async function saveUserSettings(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const settings = sanitizeSettings(input);
  const { error } = await supabase
    .from("photo_user_settings")
    .upsert({ owner_id: user.id, settings: settings as unknown as Json }, { onConflict: "owner_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type EventSettings = { timezone?: string; notes?: string };

/** Per-event overrides (currently: nothing the UI edits beyond the event's own timezone column). */
export async function saveEventSettings(eventId: string, input: EventSettings): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(eventId)) return { ok: false, error: "Invalid event id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const clean: EventSettings = {};
  if (typeof input.timezone === "string" && input.timezone.length <= 64) clean.timezone = input.timezone;
  if (typeof input.notes === "string" && input.notes.length <= 2000) clean.notes = input.notes;
  const { error } = await supabase
    .from("photo_event_settings")
    .upsert({ event_id: eventId, owner_id: user.id, settings: clean as unknown as Json }, { onConflict: "event_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
