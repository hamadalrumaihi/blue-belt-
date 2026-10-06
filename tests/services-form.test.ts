import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES, SERVICE_CODE_RE, parseServiceForm, slugify } from "@/lib/services/form";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("slugify", () => {
  it("makes a lower-case dashed code", () => {
    expect(slugify("Tournament photo + video")).toBe("tournament-photo-video");
    expect(slugify("  Café Day!  ")).toBe("cafe-day");
    expect(slugify("x".repeat(80)).length).toBeLessThanOrEqual(40);
  });
});

describe("parseServiceForm", () => {
  it("parses a priced package and fills the code from the name", () => {
    const r = parseServiceForm(fd({ name: "Tournament photo", booking_type: "tournament_athlete", description: "All matches", price_qr: "350", deposit_qr: "100", duration_minutes: "", includes_photo: "on", active: "on", public: "on", sort_order: "10" }));
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toEqual({ code: "tournament-photo", name: "Tournament photo", booking_type: "tournament_athlete", description: "All matches", price_qr: 350, deposit_qr: 100, currency: "QAR", duration_minutes: null, includes_photo: true, includes_video: false, active: true, public: true, sort_order: 10 });
  });

  it("treats an empty price as quote on request and keeps an explicit code", () => {
    const r = parseServiceForm(fd({ name: "Club day", code: "CLUB-DAY", booking_type: "club", includes_video: "on" }));
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toMatchObject({ code: "club-day", price_qr: null, deposit_qr: null, includes_photo: false, includes_video: true, active: false, public: false, sort_order: 0 });
  });

  it("rejects a missing name, a bad type, a bad code, a negative price, a deposit above the price and no includes", () => {
    const r = parseServiceForm(fd({ name: "", code: "a", booking_type: "wedding", price_qr: "-5", deposit_qr: "abc", duration_minutes: "1.5", sort_order: "x" }));
    expect(r.values).toBeNull();
    expect(r.fieldErrors).toMatchObject({ name: expect.stringMatching(/required/i), code: expect.any(String), booking_type: expect.any(String), price_qr: expect.any(String), deposit_qr: expect.any(String), duration_minutes: expect.any(String), sort_order: expect.any(String), includes_photo: expect.any(String) });
    const d = parseServiceForm(fd({ name: "Session", booking_type: "private_session", price_qr: "100", deposit_qr: "150", includes_photo: "on" }));
    expect(d.fieldErrors.deposit_qr).toMatch(/exceed/);
  });

  it("caps the name and description", () => {
    const r = parseServiceForm(fd({ name: "n".repeat(81), booking_type: "custom", description: "d".repeat(1001), includes_photo: "on" }));
    expect(r.fieldErrors.name).toMatch(/under 80/);
    expect(r.fieldErrors.description).toMatch(/under 1000/);
  });
});

describe("DEFAULT_SERVICES", () => {
  it("covers every booking type, has unique valid codes and never a price (so nothing books at 0 QAR)", () => {
    const codes = DEFAULT_SERVICES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const s of DEFAULT_SERVICES) {
      expect(s.code).toMatch(SERVICE_CODE_RE);
      expect(s.price_qr).toBeNull();
      expect(s.includes_photo || s.includes_video).toBe(true);
    }
    expect(new Set(DEFAULT_SERVICES.map((s) => s.booking_type))).toEqual(new Set(["tournament_athlete", "club", "training_session", "private_session", "custom"]));
  });
});
