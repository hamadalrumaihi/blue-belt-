import { computeEta, type EffectiveMatch } from "@/lib/eta";
import { effectiveMatch } from "@/lib/manual-correction";
import { DEFAULT_TIMEZONE, formatTime } from "@/lib/time";
import type { MatchRow } from "@/lib/types";
import { escapeHtml } from "./telegram/core";

/**
 * Pre-match reminders (pure). Unlike the GO TO MAT / ON MAT alerts, which are
 * derived from a refresh, reminders are planned from the matches already in
 * the database on a clock tick, so they fire even when no new capture arrives.
 * Dedupe: one reminder per lead per match per 5-minute bucket of the target
 * time — a one-minute shuffle does not repeat it, a real move produces a new
 * reminder for the new time (honest at-least-once).
 */
export const DEFAULT_REMINDER_LEADS = [15, 5] as const;
/** A reminder for lead L fires while L - WINDOW < minutesRemaining <= L. */
const WINDOW_MIN = 2.5;

export type ReminderCandidate = { match: MatchRow; athlete: { id: string; name: string; owner_id: string; event_id: string | null }; timezone: string | null };

export type PlannedReminder = {
  ownerId: string;
  athleteId: string;
  matchId: string;
  eventId: string | null;
  lead: number;
  kind: "REMIND_15" | "REMIND_5";
  alertKey: string;
  text: string;
  targetAt: string;
};

/** Reads TELEGRAM_REMINDER_MINUTES="15,5" (or similar); falls back to 15 and 5. */
export function reminderLeads(raw: string | undefined | null): number[] {
  const parsed = (raw ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0 && n <= 120);
  const leads = parsed.length ? parsed : [...DEFAULT_REMINDER_LEADS];
  return [...new Set(leads)].sort((a, b) => b - a);
}

export function kindForLead(lead: number): "REMIND_15" | "REMIND_5" {
  return lead >= 10 ? "REMIND_15" : "REMIND_5";
}

export function planReminders(candidates: ReminderCandidate[], now: Date, leads: number[] = [...DEFAULT_REMINDER_LEADS]): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const c of candidates) {
    const m: EffectiveMatch = effectiveMatch(c.match, now);
    if (m.status === "complete" || m.status === "on_mat") continue;
    const eta = computeEta(m, now);
    if (eta.minutesRemaining === null || !eta.targetAt) continue;
    const exact = (new Date(eta.targetAt).getTime() - now.getTime()) / 60_000;
    for (const lead of leads) {
      if (!(exact <= lead && exact > lead - WINDOW_MIN)) continue;
      // Nearest 5-minute bucket of the target time: a small shuffle keeps the key, a real move changes it.
      const bucket = Math.round(new Date(eta.targetAt).getTime() / 300_000) * 300_000;
      const tz = c.timezone ?? DEFAULT_TIMEZONE;
      const where = m.mat ? ` on ${m.mat}` : "";
      const title = `${c.athlete.name} in ${lead} min`;
      const meta = [m.mat, formatTime(eta.targetAt, tz)].filter(Boolean).join(" · ");
      out.push({
        ownerId: c.athlete.owner_id,
        athleteId: c.athlete.id,
        matchId: m.id,
        eventId: c.athlete.event_id,
        lead,
        kind: kindForLead(lead),
        alertKey: `remind:${lead}:${m.id}:${new Date(bucket).toISOString()}`,
        text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(`Be${where ? " at" : ""}${where || " the mat"} ${m.manual?.time || m.manual?.mat ? "(manual correction in effect)" : ""}`.replace(/\s+/g, " ").trim())}\n${escapeHtml(meta)}`,
        targetAt: eta.targetAt,
      });
      break; // one lead per tick per match: the largest that applies
    }
  }
  return out;
}
