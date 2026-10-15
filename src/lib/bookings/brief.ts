import { BOOKING_TYPE_LABEL, bookingDetails, type BookingDetails } from "@/lib/bookings/state";
import type { BookingType, PhotoAthleteRow, PhotoBookingRow, PhotoCoverageRow, PhotoDocumentRow, PhotoEventRow, PhotoOrganizationRow, PhotoPersonRow, PhotoServiceRow } from "@/lib/supabase/database.types";
import { formatDateTime, formatEventDate } from "@/lib/time";
import { isPlainObject } from "@/lib/validation";

/**
 * Shoot brief: everything the crew needs on the day, built from the accepted
 * scope (booking columns + `details`), the service, the event, the linked
 * watcher athlete and the event roster, the venue, the shot priorities for
 * the service, the deliverables and the assigned crew. Plus a checklist of
 * what the CLIENT still owes, each item with a due date relative to the
 * session so the owner can chase in time. Pure; the page does the I/O.
 */

export type BriefAthlete = Pick<PhotoAthleteRow, "id" | "name" | "division" | "academy" | "belt" | "weight" | "age_category" | "source_url">;
export type BriefCrewMember = { role: "photographer" | "videographer" | "assistant"; userId: string | null; email: string | null; source: "booking" | "coverage" | "event" };

export type BriefInput = {
  booking: PhotoBookingRow;
  client: Pick<PhotoPersonRow, "full_name" | "email" | "phone" | "whatsapp" | "instagram"> | null;
  organization: Pick<PhotoOrganizationRow, "name" | "kind"> | null;
  service: Pick<PhotoServiceRow, "name" | "description" | "includes_photo" | "includes_video" | "duration_minutes"> | null;
  event: Pick<PhotoEventRow, "id" | "name" | "venue" | "country" | "event_date" | "source_url" | "timezone"> | null;
  /** The athlete linked via photo_bookings.watcher_athlete_id (never matched by name). */
  athlete: BriefAthlete | null;
  /** Other tracked athletes on the same event (club / team bookings). */
  roster: BriefAthlete[];
  /** photo_coverage rows for the linked athlete / event. */
  coverage: Array<Pick<PhotoCoverageRow, "athlete_id" | "photographer_id" | "videographer_id">>;
  /** Event members with resolved e-mails (owner view). */
  team: Array<{ userId: string; email: string | null; role: string }>;
  documents: Array<Pick<PhotoDocumentRow, "kind" | "status" | "signer_role">>;
  now: Date;
};

export type BriefLine = { label: string; value: string };
export type BriefSection = { title: string; lines: BriefLine[] };

export type ChecklistKey = "session_time" | "venue_access" | "roster" | "bracket" | "division" | "guardian_release" | "agreement" | "contact";

export type ChecklistItem = {
  key: ChecklistKey;
  label: string;
  /** What exactly is missing, in owner words. */
  detail: string;
  done: boolean;
  /** Days before the session this must be in hand. */
  daysBefore: number;
  /** ISO date (YYYY-MM-DD) the item is due, when the session is dated. */
  due: string | null;
  /** Due date already passed and still missing. */
  overdue: boolean;
};

export type Brief = {
  title: string;
  ref: string;
  bookingType: BookingType;
  sessionLine: string;
  sections: BriefSection[];
  shotPriorities: string[];
  deliverables: string[];
  crew: BriefCrewMember[];
  roster: BriefAthlete[];
  checklist: ChecklistItem[];
  /** Reminder lines the owner sees (the open checklist items, soonest first). Nothing is sent. */
  reminders: string[];
  generatedAt: string;
};

export const SHOT_PRIORITIES: Record<BookingType, string[]> = {
  tournament_athlete: ["Warm-up and walk to the mat", "Grip fighting, takedown and guard pull", "Passes, sweeps and back takes", "Submission attempts and the finish", "Referee raising the hand", "Podium / medal with coach and team"],
  club: ["Team photo before the first match (everyone in the kit)", "Each athlete's walk-out and first exchange", "Coach corner reactions", "Every podium (team and individual)", "Candid team moments between matches"],
  training_session: ["Wide of the room and the warm-up", "Technique demonstration (both angles)", "Live rolling: grips, transitions, submissions", "Coach teaching close-ups", "Portraits of regulars for the club's socials"],
  private_session: ["Clean portrait set (gi and no-gi if both requested)", "Signature position or submission", "Movement sequence (drilling with a partner)", "Detail shots: belt, patches, hands", "A few relaxed candids"],
  custom: ["Agree the priority list with the client before the day", "Establishing shots of the venue and crowd", "Key moments named in the request", "Sponsors / branding where present", "Closing moments and group photo"],
};

const VIDEO_DELIVERABLE_LABEL: Record<string, string> = { full_match: "Full match recordings", edited_highlights: "Edited highlights", reels: "Short vertical reels", raw_footage: "Raw footage" };

type ExtendedDetails = BookingDetails & { event_name?: string; club_name?: string; location?: string; location_preference?: string; request?: string; notes?: string; media?: string; media_scope?: string; video_deliverables?: unknown; roster_url?: string; roster?: unknown };

function detailsOf(b: PhotoBookingRow): ExtendedDetails {
  return bookingDetails(b) as ExtendedDetails;
}

function ymd(iso: string): string {
  return iso.slice(0, 10);
}

function minusDays(iso: string, days: number): string {
  return ymd(new Date(new Date(iso).getTime() - days * 86_400_000).toISOString());
}

/** Photo / video / both from the booking's details or the service. */
export function mediaScope(b: PhotoBookingRow, service: BriefInput["service"]): "photo" | "video" | "both" {
  const d = detailsOf(b);
  const scope = d.coverage ?? d.media_scope ?? d.media;
  if (scope === "photo" || scope === "video") return scope;
  if (scope === "both" || scope === "photo_video") return "both";
  if (d.wants_photographer && d.wants_videographer) return "both";
  if (d.wants_videographer && !d.wants_photographer) return "video";
  if (d.wants_photographer && !d.wants_videographer) return "photo";
  if (service) {
    if (service.includes_photo && service.includes_video) return "both";
    if (service.includes_video) return "video";
  }
  return "photo";
}

/** What the client gets, from the accepted scope. */
export function briefDeliverables(b: PhotoBookingRow, service: BriefInput["service"]): string[] {
  const d = detailsOf(b);
  const scope = mediaScope(b, service);
  const out: string[] = [];
  if (scope !== "video") out.push("Edited photo gallery (Pic-Time)");
  if (scope !== "photo") {
    const list = Array.isArray(d.video_deliverables) ? d.video_deliverables.filter((v): v is string => typeof v === "string") : [];
    if (list.length) for (const v of list) out.push(VIDEO_DELIVERABLE_LABEL[v] ?? v);
    else out.push("Video as agreed in the quote");
  }
  if (service?.description) out.push(`Service note: ${service.description.replace(/\s*Set your price\.?\s*$/i, "").trim()}`);
  return out;
}

/** Crew for the day: booking assignment first, then coverage rows for the linked athlete, then event members. */
export function briefCrew(input: Pick<BriefInput, "booking" | "athlete" | "coverage" | "team">): BriefCrewMember[] {
  const emailOf = (id: string | null) => input.team.find((m) => m.userId === id)?.email ?? null;
  const out: BriefCrewMember[] = [];
  const seen = new Set<string>();
  const add = (role: BriefCrewMember["role"], userId: string | null, source: BriefCrewMember["source"]) => {
    if (!userId) return;
    const key = `${role}:${userId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ role, userId, email: emailOf(userId), source });
  };
  add("photographer", input.booking.assigned_photographer_id, "booking");
  add("videographer", input.booking.assigned_videographer_id, "booking");
  for (const c of input.coverage) {
    if (input.athlete && c.athlete_id !== input.athlete.id) continue;
    add("photographer", c.photographer_id, "coverage");
    add("videographer", c.videographer_id, "coverage");
  }
  if (!out.length) {
    for (const m of input.team) {
      if (m.role === "photographer") add("photographer", m.userId, "event");
      else if (m.role === "assistant") add("assistant", m.userId, "event");
    }
  }
  return out;
}

/** The client's open items, each with a due date relative to the session date. */
export function briefChecklist(input: Pick<BriefInput, "booking" | "client" | "organization" | "event" | "athlete" | "roster" | "documents" | "now">): ChecklistItem[] {
  const { booking: b } = input;
  const d = detailsOf(b);
  const session = b.session_at ?? (input.event?.event_date ? `${input.event.event_date}T00:00:00.000Z` : null);
  const today = ymd(input.now.toISOString());
  const items: ChecklistItem[] = [];
  const push = (key: ChecklistKey, label: string, detail: string, done: boolean, daysBefore: number) => {
    const due = session ? minusDays(session, daysBefore) : null;
    items.push({ key, label, detail, done, daysBefore, due, overdue: !done && due !== null && due < today });
  };

  push("session_time", "Session date and time", b.session_at ? "Confirmed." : "No session time on the booking. Agree the date and time with the client.", Boolean(b.session_at), 7);
  const venueKnown = Boolean(b.location || input.event?.venue || d.location);
  push("venue_access", "Venue and access", venueKnown ? "Venue known. Check photographer access / media pass with the organiser." : "No venue yet. Ask where the shoot is and whether a media pass is needed.", venueKnown, 1);
  const contactKnown = Boolean((input.client?.phone ?? b.customer_phone) || (input.client?.email ?? b.customer_email));
  push("contact", "Day-of contact", contactKnown ? "Phone or e-mail on file." : "No phone or e-mail for the client.", contactKnown, 3);

  if (b.booking_type === "tournament_athlete" || b.booking_type === "club" || b.booking_type === "custom") {
    const bracket = Boolean(d.source_url || input.athlete?.source_url || input.event?.source_url);
    push("bracket", "Bracket / schedule link", bracket ? "Bracket link on file. Keep the watcher on it." : "No bracket or schedule link. Ask the client for the registration / bracket page so the watcher can follow the mats.", bracket, 2);
  }
  if (b.booking_type === "tournament_athlete" || b.booking_type === "private_session") {
    const division = Boolean(b.division || d.age_division || d.weight_division || input.athlete?.division);
    push("division", "Division, belt and weight", division ? "Division known." : "Division / belt / weight missing. Needed to find the right mat and bracket.", division, 2);
  }
  if (b.booking_type === "club" || b.booking_type === "custom") {
    const rosterKnown = input.roster.length > 0 || (Array.isArray(d.roster) && d.roster.length > 0) || Boolean(d.roster_url) || (typeof d.athlete_count === "number" && d.athlete_count > 0 && input.roster.length > 0);
    push("roster", "Athlete roster", rosterKnown ? `${input.roster.length || (Array.isArray(d.roster) ? d.roster.length : "?")} names on the list.` : "No roster yet. Ask the club for every athlete's name, belt and division so nobody is missed.", rosterKnown, 7);
  }
  if (b.subject_is_minor || b.requires_guardian_release) {
    const signed = input.documents.some((doc) => doc.signer_role === "guardian" && doc.status === "signed") || (b.contract_state === "signed" && !input.documents.length);
    push("guardian_release", "Parent / guardian release", signed ? "Signed." : "Guardian release not signed. Required before any minor is photographed.", signed, 3);
  }
  if (b.requires_contract) {
    const signed = b.contract_state === "signed" || b.contract_state === "not_required";
    push("agreement", "Agreement", signed ? "Signed." : "Agreement not signed yet.", signed, 3);
  }
  return items.sort((a, b2) => (a.due ?? "9999").localeCompare(b2.due ?? "9999"));
}

/** Owner-visible reminder lines, soonest first. Nothing is sent. */
export function briefReminders(items: readonly ChecklistItem[]): string[] {
  return items
    .filter((i) => !i.done)
    .map((i) => `${i.overdue ? "OVERDUE · " : ""}${i.due ? `By ${formatEventDate(i.due, "short")}: ` : ""}${i.label} — ${i.detail}`);
}

export function buildBrief(input: BriefInput): Brief {
  const { booking: b } = input;
  const d = detailsOf(b);
  const scope = mediaScope(b, input.service);
  const sessionLine = b.session_at
    ? `${formatDateTime(b.session_at)}${b.session_end_at ? ` to ${formatDateTime(b.session_end_at)}` : ""}`
    : input.event?.event_date
      ? `${formatEventDate(input.event.event_date)} (event day; exact time not set)`
      : d.requested_date
        ? `Requested ${d.requested_date}${d.requested_time ? ` ${d.requested_time}` : ""} (not confirmed)`
        : "Not set";

  const who: BriefLine[] = [
    { label: "Client", value: input.client?.full_name ?? b.customer_name },
    { label: "Phone", value: input.client?.phone ?? b.customer_phone },
    { label: "WhatsApp", value: input.client?.whatsapp ?? "" },
    { label: "E-mail", value: input.client?.email ?? b.customer_email },
    { label: "Instagram", value: input.client?.instagram ? `@${input.client.instagram}` : d.instagram ?? "" },
    { label: "Club / academy", value: input.organization?.name ?? d.academy ?? b.academy ?? d.club_name ?? "" },
    { label: "Booked for", value: d.booked_for === "self" ? "The client" : d.booked_for === "child" ? "Their child (minor)" : d.booked_for === "athlete" ? "An athlete they manage" : d.booked_for === "club" ? "A club" : "" },
    { label: "Minor", value: b.subject_is_minor ? "Yes: guardian release required, no publication without it" : "" },
  ];
  const what: BriefLine[] = [
    { label: "Service", value: input.service?.name ?? b.package_name },
    { label: "Type", value: BOOKING_TYPE_LABEL[b.booking_type] },
    { label: "Media", value: scope === "both" ? "Photo + video" : scope === "video" ? "Video" : "Photo" },
    { label: "Athlete", value: b.athlete_name || d.athlete_name || "" },
    { label: "Tracked athlete", value: input.athlete ? `${input.athlete.name}${input.athlete.division ? ` · ${input.athlete.division}` : ""}${input.athlete.academy ? ` · ${input.athlete.academy}` : ""}` : "" },
    { label: "Belt", value: d.belt ?? input.athlete?.belt ?? "" },
    { label: "Division", value: [d.age_division, d.weight_division, b.division, input.athlete?.division].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ") },
    { label: "Gi", value: d.gi === "both" ? "Gi + No-Gi" : d.gi === "no-gi" ? "No-Gi" : d.gi === "gi" ? "Gi" : "" },
    { label: "Athletes", value: typeof d.athlete_count === "number" ? String(d.athlete_count) : "" },
    { label: "Duration", value: input.service?.duration_minutes ? `${input.service.duration_minutes} min` : "" },
    { label: "Request", value: d.request ?? "" },
    { label: "Notes", value: b.notes ?? d.notes ?? "" },
  ];
  const where: BriefLine[] = [
    { label: "Session", value: sessionLine },
    { label: "Event", value: input.event ? `${input.event.name}${input.event.event_date ? ` · ${formatEventDate(input.event.event_date, "short")}` : ""}` : d.event_name ?? "" },
    { label: "Venue", value: b.location ?? input.event?.venue ?? d.location ?? "" },
    { label: "Country", value: input.event?.country ?? "" },
    { label: "Time zone", value: input.event?.timezone ?? "" },
    { label: "Bracket / schedule", value: d.source_url ?? input.athlete?.source_url ?? input.event?.source_url ?? "" },
    { label: "Competition date", value: d.competition_date ? formatEventDate(d.competition_date, "short") : "" },
  ];
  const sections: BriefSection[] = [
    { title: "Who", lines: who.filter((l) => l.value) },
    { title: "What", lines: what.filter((l) => l.value) },
    { title: "When & where", lines: where.filter((l) => l.value) },
  ];
  const checklist = briefChecklist(input);
  return {
    title: `${b.customer_name}${b.athlete_name && b.athlete_name !== b.customer_name ? ` · ${b.athlete_name}` : ""}`,
    ref: b.public_ref ?? b.id.slice(0, 8),
    bookingType: b.booking_type,
    sessionLine,
    sections,
    shotPriorities: SHOT_PRIORITIES[b.booking_type],
    deliverables: briefDeliverables(b, input.service),
    crew: briefCrew(input),
    roster: input.roster,
    checklist,
    reminders: briefReminders(checklist),
    generatedAt: input.now.toISOString(),
  };
}

/** Plain text for "Copy as text" (WhatsApp-friendly: no markdown tables). */
export function briefToText(brief: Brief): string {
  const lines: string[] = [`SHOOT BRIEF · ${brief.ref}`, brief.title, `Session: ${brief.sessionLine}`, ""];
  for (const s of brief.sections) {
    lines.push(s.title.toUpperCase());
    for (const l of s.lines) lines.push(`- ${l.label}: ${l.value}`);
    lines.push("");
  }
  lines.push("SHOT PRIORITIES");
  brief.shotPriorities.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  lines.push("", "DELIVERABLES");
  for (const dl of brief.deliverables) lines.push(`- ${dl}`);
  lines.push("", "CREW");
  if (!brief.crew.length) lines.push("- Not assigned yet");
  for (const c of brief.crew) lines.push(`- ${c.role}: ${c.email ?? c.userId ?? "?"}`);
  if (brief.roster.length) {
    lines.push("", "ROSTER");
    for (const a of brief.roster) lines.push(`- ${a.name}${a.division ? ` · ${a.division}` : ""}${a.belt ? ` · ${a.belt}` : ""}`);
  }
  lines.push("", "CLIENT CHECKLIST");
  for (const c of brief.checklist) lines.push(`[${c.done ? "x" : " "}] ${c.label}${c.due && !c.done ? ` (by ${c.due})` : ""}${c.done ? "" : ` — ${c.detail}`}`);
  return lines.join("\n").trim();
}

/** Guard for a `details.roster` array of names (future wizard versions may send one). */
export function rosterNames(details: unknown): string[] {
  if (!isPlainObject(details) || !Array.isArray(details.roster)) return [];
  return details.roster.map((r) => (typeof r === "string" ? r : isPlainObject(r) && typeof r.name === "string" ? r.name : "")).filter(Boolean).slice(0, 200);
}
