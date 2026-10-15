import { describe, expect, it } from "vitest";
import { BOOKING_TYPES } from "@/lib/bookings/state";
import { SERVICE_KINDS } from "@/lib/bookings/public-form";
import { AUDIENCES, AUDIENCE_SERVICES, LEGACY_SERVICE_KIND, SERVICES, SERVICE_DEFINITIONS, resolveEntryService, serviceBySlug, serviceForBookingType } from "@/lib/catalog";

describe("catalog", () => {
  it("maps every booking type onto exactly one service and every legacy kind onto the catalog", () => {
    for (const t of BOOKING_TYPES) expect(serviceForBookingType(t).bookingType).toBe(t);
    expect(new Set(SERVICES.map((s) => SERVICE_DEFINITIONS[s].bookingType)).size).toBe(BOOKING_TYPES.length);
    expect(Object.keys(LEGACY_SERVICE_KIND).sort()).toEqual([...SERVICE_KINDS.map((k) => k.value)].sort());
    for (const k of SERVICE_KINDS) expect(SERVICE_DEFINITIONS[LEGACY_SERVICE_KIND[k.value].service].bookingType).toBe(k.booking_type);
    for (const s of SERVICES) {
      const def = SERVICE_DEFINITIONS[s];
      expect(def.wizardType).toBe(def.bookingType);
      expect(def.mediaScopes.length).toBeGreaterThan(0);
      expect(def.videoDeliverables.length).toBeGreaterThan(0);
      expect(serviceBySlug(def.slug)).toBe(def);
      for (const a of def.audiences) expect(AUDIENCE_SERVICES[a]).toContain(s);
    }
    for (const a of AUDIENCES) expect(AUDIENCE_SERVICES[a].length).toBeGreaterThan(0);
  });

  it("clubs and organisers are quote-first; the athlete services can carry a public price", () => {
    expect(SERVICE_DEFINITIONS.team_tournament.quoteFirst).toBe(true);
    expect(SERVICE_DEFINITIONS.organizer_custom.quoteFirst).toBe(true);
    expect(SERVICE_DEFINITIONS.tournament_athlete.quoteFirst).toBe(false);
  });

  it("resolves entry parameters: service, then legacy kind, then legacy type, then audience", () => {
    expect(resolveEntryService({ service: "athlete_portrait", kind: "custom", type: "club", audience: "clubs" })).toMatchObject({ service: SERVICE_DEFINITIONS.athlete_portrait, media: null, audience: "clubs" });
    expect(resolveEntryService({ kind: "tournament_athlete_photo_video" })).toMatchObject({ service: SERVICE_DEFINITIONS.tournament_athlete, media: "photo_video" });
    expect(resolveEntryService({ type: "training_session" })).toMatchObject({ service: SERVICE_DEFINITIONS.training_content, media: null });
    expect(resolveEntryService({ audience: "organizers" })).toMatchObject({ service: SERVICE_DEFINITIONS.organizer_custom, audience: "organizers" });
    expect(resolveEntryService({ service: "x", kind: "y", type: "z", audience: "w" })).toBeNull();
    expect(resolveEntryService({})).toBeNull();
  });
});
