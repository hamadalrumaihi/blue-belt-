import type { AthleteEta } from "./eta";
import type { NotificationPrefs } from "./settings";
import type { HistoryEntry } from "./types";
import type { AppAlert } from "./notifications/types";

const RECENT_WINDOW_MS = 20 * 60_000;
const SIGNIFICANT_LATER_MIN = 15;

type ChangeValue = { value: string | number | null; label: string } | null;

function asChangeValue(v: unknown): ChangeValue {
  if (v && typeof v === "object" && "label" in v) return v as ChangeValue;
  return null;
}

/**
 * Builds the list of alerts that should be on screen right now from the
 * current ranking and recent history rows. Pure and deterministic.
 */
export function buildAlerts(ranked: AthleteEta[], history: HistoryEntry[], prefs: NotificationPrefs, now: Date): AppAlert[] {
  const alerts: AppAlert[] = [];

  for (const { athlete, match, eta } of ranked) {
    if (!match) continue;
    const base = { athleteId: athlete.id, athleteName: athlete.name, mat: match.mat, createdAt: now.toISOString() };
    const where = match.mat ? ` on ${match.mat}` : "";
    switch (eta.bucket) {
      case "ON MAT":
        alerts.push({ ...base, id: `on-mat:${match.id}`, kind: "ON_MAT", level: "danger", title: `${athlete.name} is ON MAT`, body: `Match in progress${where}.` });
        break;
      case "GO TO MAT":
        alerts.push({ ...base, id: `go:${match.id}`, kind: "GO_TO_MAT", level: "danger", title: `GO TO MAT — ${athlete.name}`, body: `Match starting now${where}.` });
        break;
      case "5 MIN":
        if (prefs.m5) alerts.push({ ...base, id: `m5:${match.id}`, kind: "THRESHOLD_5", level: "warning", title: `${athlete.name} in ${Math.max(eta.minutesRemaining ?? 0, 0)} min`, body: `Head${where ? " to" : ""}${where || " to the mat"} now.` });
        break;
      case "15 MIN":
        if (prefs.m15) alerts.push({ ...base, id: `m15:${match.id}`, kind: "THRESHOLD_15", level: "warning", title: `${athlete.name} in ${eta.minutesRemaining} min`, body: `Get ready${where}.` });
        break;
      case "30 MIN":
        if (prefs.m30) alerts.push({ ...base, id: `m30:${match.id}`, kind: "THRESHOLD_30", level: "info", title: `${athlete.name} in ${eta.minutesRemaining} min`, body: `Upcoming${where}.` });
        break;
      default:
        break;
    }
  }

  const cutoff = now.getTime() - RECENT_WINDOW_MS;
  for (const h of history) {
    if (new Date(h.detected_at).getTime() < cutoff) continue;
    const oldV = asChangeValue(h.old_value);
    const newV = asChangeValue(h.new_value);
    const name = h.athlete_name ?? "A client";
    const base = { athleteId: h.athlete_id ?? "", athleteName: name, mat: null, createdAt: h.detected_at, changeType: h.change_type as AppAlert["changeType"] };

    if (h.change_type === "MAT_CHANGE" && prefs.matChange) {
      alerts.push({ ...base, id: `hist:${h.id}`, kind: "MAT_CHANGE", level: "danger", title: `MAT CHANGE — ${name}`, body: `${oldV?.label ?? "Unknown"} → ${newV?.label ?? "Unknown"}`, mat: typeof newV?.value === "string" ? newV.value : null });
    } else if ((h.change_type === "TIME_CHANGE" || h.change_type === "ETA_CHANGE") && prefs.timeChange) {
      const before = typeof oldV?.value === "string" ? new Date(oldV.value).getTime() : NaN;
      const after = typeof newV?.value === "string" ? new Date(newV.value).getTime() : NaN;
      if (Number.isNaN(before) || Number.isNaN(after)) continue;
      const deltaMin = Math.round((after - before) / 60_000);
      if (deltaMin < 0) {
        alerts.push({ ...base, id: `hist:${h.id}`, kind: "MOVED_EARLIER", level: "danger", title: `${name} moved EARLIER`, body: `${oldV?.label} → ${newV?.label} (${Math.abs(deltaMin)} min earlier)` });
      } else if (deltaMin >= SIGNIFICANT_LATER_MIN) {
        alerts.push({ ...base, id: `hist:${h.id}`, kind: "MOVED_LATER", level: "warning", title: `${name} moved later`, body: `${oldV?.label} → ${newV?.label} (+${deltaMin} min)` });
      }
    } else if (h.change_type === "STATUS_CHANGE" && newV?.value === "on_mat") {
      alerts.push({ ...base, id: `hist:${h.id}`, kind: "ON_MAT", level: "danger", title: `${name} is ON MAT`, body: "Status changed to on mat." });
    }
  }

  const rank: Record<AppAlert["level"], number> = { danger: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.level] - rank[b.level]);
}
