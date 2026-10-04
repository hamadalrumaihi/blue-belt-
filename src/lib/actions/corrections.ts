"use server";

import { revalidatePath } from "next/cache";
import { requireOwnedAthlete } from "@/lib/authz";
import { defaultOverrideUntil } from "@/lib/manual-correction";
import { createClient } from "@/lib/supabase/server";
import { formatTime } from "@/lib/time";
import { isUuid, isValidCalendarDate } from "@/lib/validation";

/**
 * Owner-only manual corrections of a match's mat / time. The correction is
 * stored beside the source values (never over them) with who, when, why and
 * until when; a history row records it; collaborators see the effective
 * values labelled "manual". The owner check is explicit (requireOwnedAthlete)
 * on top of RLS so a collaborator can never reach this.
 */
export type CorrectionResult = { ok: true; until: string } | { ok: false; error: string };

const MAT_RE = /^[\p{L}\p{N} .#\-/]{1,40}$/u;

export async function setManualCorrection(input: { matchId: string; mat?: string | null; time?: string | null; reason?: string | null; until?: string | null }): Promise<CorrectionResult> {
  if (!isUuid(input.matchId)) return { ok: false, error: "Invalid match." };
  const mat = input.mat?.trim() || null;
  if (mat && !MAT_RE.test(mat)) return { ok: false, error: "Mat must be short text like “Mat 5”." };
  const reason = (input.reason ?? "").trim().slice(0, 120) || null;
  if (!mat && !input.time) return { ok: false, error: "Enter a mat, a time, or both." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };

  const { data: match, error: readError } = await supabase.from("photo_matches").select("id,athlete_id,mat,scheduled_at").eq("id", input.matchId).maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!match) return { ok: false, error: "Match not found or you do not own it." };
  const owned = await requireOwnedAthlete(supabase, match.athlete_id);
  if (!owned.ok) return { ok: false, error: owned.error };
  if (owned.ownerId !== user.id) return { ok: false, error: "Only the owner can correct a match." };

  let eventDate: string | null = null;
  let timezone = "Asia/Qatar";
  if (owned.eventId) {
    const { data: event } = await supabase.from("photo_events").select("event_date,timezone").eq("id", owned.eventId).maybeSingle();
    eventDate = event?.event_date && isValidCalendarDate(event.event_date) ? event.event_date : null;
    timezone = event?.timezone ?? timezone;
  }

  // Time arrives as HH:MM (event-local) or an ISO string.
  let scheduledAt: string | null = null;
  if (input.time) {
    const t = input.time.trim();
    if (/^\d{2}:\d{2}$/.test(t)) {
      const { wallClockToIso } = await import("@/lib/time");
      scheduledAt = wallClockToIso(t, eventDate ?? new Date().toISOString().slice(0, 10), timezone);
    } else if (Number.isFinite(new Date(t).getTime())) {
      scheduledAt = new Date(t).toISOString();
    } else {
      return { ok: false, error: "Time must be HH:MM." };
    }
  }

  const now = new Date();
  let until = defaultOverrideUntil(now, eventDate, timezone);
  if (input.until) {
    const u = new Date(input.until).getTime();
    if (!Number.isFinite(u) || u <= now.getTime() || u > now.getTime() + 3 * 24 * 60 * 60 * 1000) return { ok: false, error: "Lifetime must be in the future and at most 3 days." };
    until = new Date(u).toISOString();
  }

  const { error } = await supabase
    .from("photo_matches")
    .update({ override_mat: mat, override_scheduled_at: scheduledAt, override_by: user.id, override_at: now.toISOString(), override_reason: reason, override_until: until })
    .eq("id", input.matchId)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };

  const parts = [mat ? `${match.mat ?? "—"} → ${mat}` : null, scheduledAt ? `${formatTime(match.scheduled_at, timezone)} → ${formatTime(scheduledAt, timezone)}` : null].filter(Boolean).join(" · ");
  await supabase.from("photo_match_history").insert({
    owner_id: user.id,
    match_id: input.matchId,
    change_type: "MANUAL_CORRECTION",
    old_value: { value: mat ? match.mat : match.scheduled_at, label: mat ? match.mat ?? "Unknown" : formatTime(match.scheduled_at, timezone) },
    new_value: { value: mat ?? scheduledAt, label: `${parts}${reason ? ` (${reason})` : ""} · until ${formatTime(until, timezone)}` },
    detected_at: now.toISOString(),
  });

  revalidatePath(`/clients/${match.athlete_id}`);
  revalidatePath("/dashboard");
  revalidatePath("/coverage");
  return { ok: true, until };
}

export async function clearManualCorrection(matchId: string): Promise<CorrectionResult> {
  if (!isUuid(matchId)) return { ok: false, error: "Invalid match." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: match } = await supabase.from("photo_matches").select("id,athlete_id,override_mat,override_scheduled_at").eq("id", matchId).eq("owner_id", user.id).maybeSingle();
  if (!match) return { ok: false, error: "Match not found or you do not own it." };
  const { error } = await supabase
    .from("photo_matches")
    .update({ override_mat: null, override_scheduled_at: null, override_by: null, override_at: null, override_reason: null, override_until: null })
    .eq("id", matchId)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  await supabase.from("photo_match_history").insert({
    owner_id: user.id,
    match_id: matchId,
    change_type: "MANUAL_CORRECTION",
    old_value: { value: match.override_mat ?? match.override_scheduled_at, label: "Manual correction" },
    new_value: { value: null, label: "Removed by the owner; source values apply again" },
    detected_at: new Date().toISOString(),
  });
  revalidatePath(`/clients/${match.athlete_id}`);
  revalidatePath("/dashboard");
  revalidatePath("/coverage");
  return { ok: true, until: "" };
}
