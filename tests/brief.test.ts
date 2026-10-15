import { describe, expect, it } from "vitest";
import { briefChecklist, briefCrew, briefDeliverables, briefToText, buildBrief, mediaScope, rosterNames, type BriefInput } from "@/lib/bookings/brief";
import { booking } from "./payments/fixtures";

const NOW = new Date("2026-10-10T08:00:00.000Z");

function input(overrides: Partial<BriefInput> = {}, bookingOverrides: Parameters<typeof booking>[0] = {}): BriefInput {
  return {
    booking: booking({ booking_status: "confirmed", session_at: "2026-10-20T07:00:00.000Z", location: "Lusail Sports Arena", public_ref: "BB-7K3PQ2", ...bookingOverrides }),
    client: { full_name: "Hamad Al-Thani", email: "h@example.com", phone: "+97455555555", whatsapp: null, instagram: "hamad" },
    organization: null,
    service: { name: "Tournament athlete coverage", description: "Photos of every match. Set your price.", includes_photo: true, includes_video: false, duration_minutes: null },
    event: { id: "e1", name: "Qatar Open", venue: "Lusail Sports Arena", country: "Qatar", event_date: "2026-10-20", source_url: "https://ajptour.com/events/1/brackets", timezone: "Asia/Qatar" },
    athlete: { id: "a1", name: "Hamad Al-Thani", division: "Adult / Blue / -76", academy: "Doha BJJ", belt: "blue", weight: "-76", age_category: "Adult", source_url: null },
    roster: [],
    coverage: [{ athlete_id: "a1", photographer_id: "u-photo", videographer_id: null }],
    team: [{ userId: "u-photo", email: "sara@example.com", role: "photographer" }, { userId: "u-asst", email: "ali@example.com", role: "assistant" }],
    documents: [],
    now: NOW,
    ...overrides,
  };
}

describe("buildBrief", () => {
  it("composes who / what / where from the accepted scope, the service, the event and the linked athlete", () => {
    const brief = buildBrief(input());
    expect(brief.ref).toBe("BB-7K3PQ2");
    expect(brief.sessionLine).toMatch(/20 Oct/);
    const lines = Object.fromEntries(brief.sections.flatMap((s) => s.lines.map((l) => [l.label, l.value])));
    expect(lines.Client).toBe("Hamad Al-Thani");
    expect(lines.Service).toBe("Tournament athlete coverage");
    expect(lines.Media).toBe("Photo");
    expect(lines["Tracked athlete"]).toBe("Hamad Al-Thani · Adult / Blue / -76 · Doha BJJ");
    expect(lines.Venue).toBe("Lusail Sports Arena");
    expect(lines.Event).toContain("Qatar Open");
    expect(lines["Bracket / schedule"]).toBe("https://ajptour.com/events/1/brackets");
    expect(brief.shotPriorities[0]).toMatch(/Warm-up/);
    expect(brief.deliverables[0]).toBe("Edited photo gallery (Pic-Time)");
    expect(brief.deliverables[1]).toBe("Service note: Photos of every match."); // placeholder stripped
    expect(brief.crew).toEqual([{ role: "photographer", userId: "u-photo", email: "sara@example.com", source: "coverage" }]);
  });

  it("prefers the booking's own crew assignment, falls back to event members only when nothing is assigned", () => {
    const assigned = briefCrew({ ...input(), booking: booking({ assigned_photographer_id: "u-photo", assigned_videographer_id: "u-video" }) });
    expect(assigned.map((c) => `${c.role}:${c.userId}:${c.source}`)).toEqual(["photographer:u-photo:booking", "videographer:u-video:booking"]);
    const fallback = briefCrew({ ...input({ coverage: [] }) });
    expect(fallback.map((c) => `${c.role}:${c.source}`)).toEqual(["photographer:event", "assistant:event"]);
    // Coverage rows for other athletes are ignored (so the event fallback applies).
    expect(briefCrew({ ...input({ coverage: [{ athlete_id: "other", photographer_id: "u-x", videographer_id: null }] }) }).map((c) => c.userId)).toEqual(["u-photo", "u-asst"]);
  });

  it("derives the media scope and video deliverables from details, then the service", () => {
    expect(mediaScope(booking({ details: { coverage: "both" } }), null)).toBe("both");
    expect(mediaScope(booking({ details: { media_scope: "photo_video" } }), null)).toBe("both");
    expect(mediaScope(booking({ details: { wants_videographer: true } }), null)).toBe("video");
    expect(mediaScope(booking({ details: {} }), { name: "x", description: null, includes_photo: true, includes_video: true, duration_minutes: null })).toBe("both");
    expect(mediaScope(booking({ details: {} }), null)).toBe("photo");
    const dl = briefDeliverables(booking({ details: { coverage: "both", video_deliverables: ["edited_highlights", "reels", "weird"] } }), null);
    expect(dl).toEqual(["Edited photo gallery (Pic-Time)", "Edited highlights", "Short vertical reels", "weird"]);
    expect(briefDeliverables(booking({ details: { coverage: "video" } }), null)).toEqual(["Video as agreed in the quote"]);
  });
});

describe("briefChecklist", () => {
  it("lists what the client still owes with due dates relative to the session (tournament athlete)", () => {
    const items = briefChecklist({ ...input({ athlete: null }), booking: booking({ booking_type: "tournament_athlete", session_at: "2026-10-20T07:00:00.000Z", location: null, division: null, details: {}, subject_is_minor: true, requires_guardian_release: true, requires_contract: true, contract_state: "sent", customer_phone: "", customer_email: "" }), client: null, event: null });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.session_time).toMatchObject({ done: true, due: "2026-10-13" });
    expect(byKey.venue_access).toMatchObject({ done: false, due: "2026-10-19", overdue: false });
    expect(byKey.contact).toMatchObject({ done: false, due: "2026-10-17" });
    expect(byKey.bracket).toMatchObject({ done: false, due: "2026-10-18" });
    expect(byKey.division).toMatchObject({ done: false, due: "2026-10-18" });
    expect(byKey.guardian_release).toMatchObject({ done: false, due: "2026-10-17" });
    expect(byKey.agreement).toMatchObject({ done: false, due: "2026-10-17" });
    expect(byKey.roster).toBeUndefined();
    // Sorted soonest first.
    expect(items.map((i) => i.due)).toEqual([...items.map((i) => i.due)].sort());
  });

  it("marks items done from the booking, the event, the athlete and signed documents; flags overdue", () => {
    const items = briefChecklist({ ...input(), booking: booking({ booking_type: "tournament_athlete", session_at: "2026-10-11T07:00:00.000Z", location: null, division: null, details: {}, subject_is_minor: true, requires_guardian_release: true }), documents: [{ kind: "guardian_release", status: "signed", signer_role: "guardian" }] });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.venue_access.done).toBe(true); // from the event venue
    expect(byKey.division.done).toBe(true); // from the linked athlete
    expect(byKey.bracket.done).toBe(true); // from the event source_url
    expect(byKey.guardian_release.done).toBe(true);
    expect(byKey.contact.done).toBe(true);
    const late = briefChecklist({ ...input({ athlete: null, event: null, client: null }), booking: booking({ booking_type: "tournament_athlete", session_at: "2026-10-11T07:00:00.000Z", location: null, details: {}, customer_phone: "", customer_email: "" }) });
    expect(late.find((i) => i.key === "contact")).toMatchObject({ done: false, overdue: true, due: "2026-10-08" });
  });

  it("asks a club for the roster a week before, and has no due dates without a session or event date", () => {
    const club = briefChecklist({ ...input({ athlete: null, roster: [] }), booking: booking({ booking_type: "club", session_at: "2026-10-20T07:00:00.000Z", details: { athlete_count: 12 } }) });
    expect(club.find((i) => i.key === "roster")).toMatchObject({ done: false, due: "2026-10-13" });
    const withRoster = briefChecklist({ ...input({ athlete: null, roster: [{ id: "a", name: "A", division: null, academy: null, belt: null, weight: null, age_category: null, source_url: null }] }), booking: booking({ booking_type: "club", session_at: "2026-10-20T07:00:00.000Z" }) });
    expect(withRoster.find((i) => i.key === "roster")).toMatchObject({ done: true, detail: "1 names on the list." });
    const undated = briefChecklist({ ...input({ event: null }), booking: booking({ booking_type: "club", session_at: null }) });
    expect(undated.every((i) => i.due === null && !i.overdue)).toBe(true);
    expect(undated.find((i) => i.key === "session_time")?.done).toBe(false);
  });

  it("reminders are owner-visible lines for the open items only", () => {
    const brief = buildBrief({ ...input({ athlete: null, event: null }), booking: booking({ booking_type: "tournament_athlete", session_at: "2026-10-20T07:00:00.000Z", location: null, details: {} }) });
    expect(brief.reminders.some((r) => r.startsWith("By 18 Oct 2026: Bracket / schedule link"))).toBe(true);
    expect(brief.reminders.some((r) => r.includes("Session date and time"))).toBe(false);
  });
});

describe("briefToText", () => {
  it("is plain text with every section, the priorities and the checklist boxes", () => {
    const text = briefToText(buildBrief(input({ event: null }, { location: null })));
    expect(text.startsWith("SHOOT BRIEF · BB-7K3PQ2")).toBe(true);
    expect(text).toContain("WHO\n- Client: Hamad Al-Thani");
    expect(text).toContain("SHOT PRIORITIES\n1. Warm-up");
    expect(text).toContain("- photographer: sara@example.com");
    expect(text).toMatch(/\[x\] Session date and time/);
    expect(text).toMatch(/\[ \] Venue and access \(by 2026-10-19\)/);
    expect(text).not.toContain("<");
  });

  it("rosterNames accepts strings or {name} objects and nothing else", () => {
    expect(rosterNames({ roster: ["A", { name: "B" }, 3, {}] })).toEqual(["A", "B"]);
    expect(rosterNames(null)).toEqual([]);
  });
});
