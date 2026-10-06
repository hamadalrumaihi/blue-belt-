import type { EventRow } from "@/lib/types";
import { zoneLabel } from "@/lib/time";
import type { RefreshResult } from "@/lib/watch-service";

/**
 * Operational incident derivation (pure). Turns a batch of refresh results into
 * owner-grouped incident drafts with a plain-language Telegram message that
 * names the event and client/source, the reason (or "unknown"), the last
 * verified time, whether previous schedule data was retained, a next action,
 * an authenticated app link and a short correlation id. Shared-source failures
 * of the same kind collapse into one incident.
 */

export type IncidentKind = "CHALLENGE" | "WORKER_DOWN" | "SOURCE_ERROR" | "ATHLETE_NOT_FOUND" | "PARSE_ERROR" | "PERSIST_ERROR";

export type IncidentDraft = {
  key: string;
  kind: IncidentKind;
  ownerId: string;
  eventId: string | null;
  sourceHost: string | null;
  athleteIds: string[];
  athleteNames: string[];
  eventName: string | null;
  lastVerifiedAt: string | null;
  retained: boolean;
  text: string;
  ref: string;
};

export const KIND_LABEL: Record<IncidentKind, string> = {
  CHALLENGE: "Refresh blocked",
  WORKER_DOWN: "Watcher unavailable",
  SOURCE_ERROR: "Source unreachable",
  ATHLETE_NOT_FOUND: "Athlete not found",
  PARSE_ERROR: "Could not read schedule",
  PERSIST_ERROR: "Refresh not saved",
};

export const KIND_REASON: Record<IncidentKind, string> = {
  CHALLENGE: "The source showed an anti-bot / human check (e.g. Cloudflare). The watcher stopped this check and does not try to get past it.",
  WORKER_DOWN: "The browser worker was unavailable.",
  SOURCE_ERROR: "The source site did not respond.",
  ATHLETE_NOT_FOUND: "The page loaded but did not name this athlete.",
  PARSE_ERROR: "The page loaded but its schedule could not be read.",
  PERSIST_ERROR: "The update could not be saved.",
};

export const KIND_ACTION: Record<IncidentKind, string> = {
  CHALLENGE: "Open the source page in your browser and import it (More → Import a page).",
  WORKER_DOWN: "No action needed yet; automatic refresh resumes when the worker is back. Import a page if you need times now.",
  SOURCE_ERROR: "Check the source is up; it will retry automatically. Import a page if you need times now.",
  ATHLETE_NOT_FOUND: "Check the client's profile URL is their own bracket/athlete page.",
  PARSE_ERROR: "Open the source page and import it; send the page if times are still missing.",
  PERSIST_ERROR: "Try again; if it repeats, the database may be unreachable.",
};

/** Maps one refresh result to an incident kind, or null when it is not an incident. */
export function classifyIncident(result: RefreshResult): IncidentKind | null {
  if (result.skipped) return null;
  const code = result.code ?? "";
  if (result.status === "REQUIRES_BROWSER_WATCHER") {
    return code === "BROWSER_WORKER_NOT_CONFIGURED" || code === "BROWSER_WORKER_UNREACHABLE" || code === "BROWSER_WORKER_RESTARTING" ? "WORKER_DOWN" : "CHALLENGE";
  }
  if (result.status === "ATHLETE_NOT_FOUND") return "ATHLETE_NOT_FOUND";
  if (result.status === "PARSE_ERROR") return "PARSE_ERROR";
  if (result.status === "FETCH_ERROR") {
    if (code.startsWith("BROWSER_WORKER")) return "WORKER_DOWN";
    if (code === "BROWSER_PROXY_ERROR") return "WORKER_DOWN";
    return "SOURCE_ERROR";
  }
  if (result.status === "ERROR") return "PERSIST_ERROR";
  return null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Stable 8-char correlation id for an incident key (support reference). */
export function incidentRef(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatTime(iso: string | null, timezone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** Builds the incident drafts for one batch, grouped by owner then kind+event+host. */
export function buildIncidentDrafts(
  input: { athletes: Array<{ id: string; owner_id: string; event_id: string | null; name: string; last_success_at?: string | null }>; events: Map<string, EventRow>; results: RefreshResult[] },
  appUrl: string,
): IncidentDraft[] {
  const byId = new Map(input.athletes.map((a) => [a.id, a]));
  const groups = new Map<string, IncidentDraft>();

  for (const r of input.results) {
    const kind = classifyIncident(r);
    if (!kind) continue;
    const athlete = byId.get(r.athleteId);
    if (!athlete) continue;
    const event = athlete.event_id ? input.events.get(athlete.event_id) ?? null : null;
    const host = hostOf(r.sourceUrl);
    const key = `${athlete.owner_id}|${kind}|${athlete.event_id ?? "none"}|${host ?? "none"}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        kind,
        ownerId: athlete.owner_id,
        eventId: athlete.event_id,
        sourceHost: host,
        athleteIds: [],
        athleteNames: [],
        eventName: event?.name ?? null,
        lastVerifiedAt: null,
        retained: false,
        text: "",
        ref: incidentRef(key),
      };
      groups.set(key, g);
    }
    g.athleteIds.push(athlete.id);
    g.athleteNames.push(athlete.name);
    const verified = r.health.lastSuccessAt ?? athlete.last_success_at ?? null;
    if (verified && (!g.lastVerifiedAt || verified > g.lastVerifiedAt)) g.lastVerifiedAt = verified;
    if (r.matches.length > 0) g.retained = true;
  }

  const base = appUrl.replace(/\/$/, "");
  for (const g of groups.values()) {
    const event = g.eventId ? input.events.get(g.eventId) ?? null : null;
    const tz = event?.timezone ?? "Asia/Qatar";
    const who = g.athleteNames.length === 1 ? g.athleteNames[0] : `${g.athleteNames.length} clients`;
    const verified = formatTime(g.lastVerifiedAt, tz);
    const link = base ? (g.eventId ? `${base}/events/${g.eventId}` : `${base}/dashboard`) : null;
    const lines = [
      `<b>${esc(KIND_LABEL[g.kind])} — ${esc(who)}${g.eventName ? `, ${esc(g.eventName)}` : ""}</b>`,
      `Reason: ${esc(KIND_REASON[g.kind])}`,
      `Last verified: ${verified ? `${verified} ${zoneLabel(tz)}` : "unknown"}.`,
      g.retained ? "Previous schedule retained." : "No previous schedule to show.",
      `Action: ${esc(KIND_ACTION[g.kind])}`,
    ];
    if (link) lines.push(`Open: ${link}`);
    if (base) lines.push(`Handled it? Mark it done: ${base}/issues`);
    lines.push(`Ref: ${g.ref}`);
    g.text = lines.join("\n");
  }
  return [...groups.values()];
}

/** Recovery message when a previously-reported incident clears. */
export function recoveryText(incident: { kind: IncidentKind; eventName: string | null; count: number; ref: string }): string {
  const who = incident.eventName ?? (incident.count === 1 ? "your client" : `${incident.count} clients`);
  return [
    `<b>Recovered — ${esc(who)}</b>`,
    `${esc(KIND_LABEL[incident.kind])} has cleared; automatic refresh is working again.`,
    `Ref: ${incident.ref}`,
  ].join("\n");
}
