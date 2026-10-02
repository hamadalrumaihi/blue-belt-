import { describe, expect, it } from "vitest";
import { CRON_DEFAULT_LIMIT, CRON_MAX_LIMIT, MAX_IMPORT_HTML_BYTES, MAX_WATCH_BATCH, daysInMonth, isPlainObject, isUuid, isValidCalendarDate, parseCronRequest, parseImportRequest, parseWatchRequest } from "@/lib/validation";

const UUID_A = "7f4f6d1e-3c2b-4a1d-9e8f-0a1b2c3d4e5f";
const UUID_B = "8a5a7e2f-4d3c-4b2e-8f9a-1b2c3d4e5f60";

function fail(body: unknown) {
  const r = parseWatchRequest(body);
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r)}`);
  return r;
}

describe("isValidCalendarDate", () => {
  it("accepts real dates and rejects impossible or loosely formatted ones", () => {
    expect(isValidCalendarDate("2026-03-14")).toBe(true);
    expect(isValidCalendarDate("2024-02-29")).toBe(true); // leap year
    expect(isValidCalendarDate("2023-02-29")).toBe(false);
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
    expect(isValidCalendarDate("2026-99-99")).toBe(false);
    expect(isValidCalendarDate("2026-00-10")).toBe(false);
    expect(isValidCalendarDate("2026-04-31")).toBe(false);
    expect(isValidCalendarDate("2026-4-1")).toBe(false);
    expect(isValidCalendarDate("1899-12-31")).toBe(false);
    expect(isValidCalendarDate("2201-01-01")).toBe(false);
    expect(isValidCalendarDate(20260314)).toBe(false);
    expect(isValidCalendarDate(null)).toBe(false);
  });

  it("daysInMonth / isUuid / isPlainObject", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(isUuid(UUID_A)).toBe(true);
    expect(isUuid(UUID_A.toUpperCase())).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});

describe("parseWatchRequest: 400 cases", () => {
  it("undefined (invalid JSON)", () => expect(fail(undefined)).toMatchObject({ status: 400, code: "INVALID_JSON" }));
  it("null", () => expect(fail(null)).toMatchObject({ status: 400, code: "INVALID_BODY" }));
  it("a string", () => expect(fail("str")).toMatchObject({ code: "INVALID_BODY" }));
  it("a number", () => expect(fail(42)).toMatchObject({ code: "INVALID_BODY" }));
  it("an array", () => expect(fail([])).toMatchObject({ code: "INVALID_BODY" }));
  it("{} has no mode", () => expect(fail({})).toMatchObject({ code: "MISSING_MODE" }));
  it("both url and athleteIds", () => expect(fail({ url: "https://ajptour.com/x", athleteIds: [UUID_A] })).toMatchObject({ code: "AMBIGUOUS_MODE" }));
  it("athleteIds empty", () => expect(fail({ athleteIds: [] })).toMatchObject({ code: "INVALID_FIELD", error: "athleteIds must not be empty." }));
  it("athleteIds not an array", () => expect(fail({ athleteIds: UUID_A })).toMatchObject({ code: "INVALID_FIELD" }));
  it("athleteIds with a non-uuid", () => expect(fail({ athleteIds: [UUID_A, "nope"] })).toMatchObject({ code: "INVALID_FIELD", error: "athleteIds must contain valid ids." }));
  it("athleteIds over the batch limit", () => {
    const ids = Array.from({ length: MAX_WATCH_BATCH + 1 }, () => crypto.randomUUID());
    expect(fail({ athleteIds: ids })).toMatchObject({ code: "TOO_MANY" });
  });
  it("athleteIds combined with another field", () => expect(fail({ athleteIds: [UUID_A], extra: 1 })).toMatchObject({ code: "UNKNOWN_FIELD" }));
  it("eventId invalid", () => expect(fail({ eventId: "nope" })).toMatchObject({ code: "INVALID_FIELD", error: "eventId must be a valid id." }));
  it("eventId combined with another field", () => expect(fail({ eventId: UUID_A, athleteName: "x" })).toMatchObject({ code: "UNKNOWN_FIELD" }));
  it("unknown field on a preview", () => expect(fail({ url: "https://ajptour.com/x", foo: 1 })).toMatchObject({ code: "UNKNOWN_FIELD", error: "Unsupported field: foo." }));
  it("eventDate invalid", () => expect(fail({ url: "https://ajptour.com/x", eventDate: "2026-02-30" })).toMatchObject({ code: "INVALID_DATE" }));
  it("eventDate of the wrong type", () => expect(fail({ url: "https://ajptour.com/x", eventDate: 20260314 })).toMatchObject({ code: "INVALID_FIELD" }));
  it("url empty / wrong type / too long", () => {
    expect(fail({ url: "   " })).toMatchObject({ code: "INVALID_URL" });
    expect(fail({ url: 5 })).toMatchObject({ code: "INVALID_URL" });
    expect(fail({ url: `https://ajptour.com/${"a".repeat(2100)}` })).toMatchObject({ code: "INVALID_URL", error: "url is too long." });
  });
  it("athleteName / timezone of the wrong type or too long", () => {
    expect(fail({ url: "https://ajptour.com/x", athleteName: 7 })).toMatchObject({ code: "INVALID_FIELD" });
    expect(fail({ url: "https://ajptour.com/x", athleteName: "x".repeat(121) })).toMatchObject({ code: "INVALID_FIELD" });
    expect(fail({ url: "https://ajptour.com/x", timezone: ["Asia/Qatar"] })).toMatchObject({ code: "INVALID_FIELD" });
  });
});

describe("parseWatchRequest: happy paths", () => {
  it("preview with optional fields trimmed and normalised", () => {
    expect(parseWatchRequest({ url: " https://ajptour.com/events/1 ", athleteName: " Hamad ", timezone: "Asia/Qatar", eventDate: "2026-03-14" })).toEqual({
      ok: true,
      mode: "preview",
      url: "https://ajptour.com/events/1",
      athleteName: "Hamad",
      timezone: "Asia/Qatar",
      eventDate: "2026-03-14",
    });
    expect(parseWatchRequest({ url: "https://ajptour.com/events/1", athleteName: "", timezone: null })).toEqual({
      ok: true,
      mode: "preview",
      url: "https://ajptour.com/events/1",
      athleteName: null,
      timezone: null,
      eventDate: null,
    });
  });

  it("athletes with duplicate ids collapsed", () => {
    expect(parseWatchRequest({ athleteIds: [UUID_A, UUID_B, UUID_A] })).toEqual({ ok: true, mode: "athletes", athleteIds: [UUID_A, UUID_B] });
  });

  it("event", () => {
    expect(parseWatchRequest({ eventId: UUID_A })).toEqual({ ok: true, mode: "event", eventId: UUID_A });
  });
});

describe("parseCronRequest", () => {
  it("defaults for an absent body", () => {
    const expected = { ok: true, all: false, limit: CRON_DEFAULT_LIMIT, cursor: null, cooldownSeconds: 45 };
    expect(parseCronRequest(undefined)).toEqual(expected);
    expect(parseCronRequest(null)).toEqual(expected);
    expect(parseCronRequest({})).toEqual(expected);
  });

  it("validates each field", () => {
    expect(parseCronRequest("x")).toMatchObject({ ok: false, code: "INVALID_BODY" });
    expect(parseCronRequest({ all: "yes" })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(parseCronRequest({ limit: 0 })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(parseCronRequest({ limit: 1.5 })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(parseCronRequest({ cursor: "nope" })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(parseCronRequest({ cooldownSeconds: -1 })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
    expect(parseCronRequest({ cooldownSeconds: "5" })).toMatchObject({ ok: false, code: "INVALID_FIELD" });
  });

  it("clamps limit and cooldown and accepts a cursor", () => {
    expect(parseCronRequest({ all: true, limit: 10_000, cursor: UUID_A, cooldownSeconds: 99_999 })).toEqual({ ok: true, all: true, limit: CRON_MAX_LIMIT, cursor: UUID_A, cooldownSeconds: 3600 });
    expect(parseCronRequest({ limit: 5, cursor: null, cooldownSeconds: 0 })).toEqual({ ok: true, all: false, limit: 5, cursor: null, cooldownSeconds: 0 });
  });
});

describe("parseImportRequest", () => {
  const html = "<html><body><table><tr><td>Mat 1</td></tr></table></body></html>";
  const url = "https://ajptour.com/en/event/1411/bracket/130617";

  it("accepts url + html and trims the url", () => {
    expect(parseImportRequest({ url: ` ${url} `, html })).toEqual({ ok: true, url, html });
  });

  it("rejects malformed bodies with a code", () => {
    expect(parseImportRequest(undefined)).toMatchObject({ ok: false, code: "INVALID_JSON" });
    expect(parseImportRequest("x")).toMatchObject({ ok: false, code: "INVALID_BODY" });
    expect(parseImportRequest([])).toMatchObject({ ok: false, code: "INVALID_BODY" });
    expect(parseImportRequest({ url, html, extra: 1 })).toMatchObject({ ok: false, code: "UNKNOWN_FIELD" });
    expect(parseImportRequest({ html })).toMatchObject({ ok: false, code: "INVALID_URL" });
    expect(parseImportRequest({ url: "", html })).toMatchObject({ ok: false, code: "INVALID_URL" });
    expect(parseImportRequest({ url })).toMatchObject({ ok: false, code: "INVALID_HTML" });
    expect(parseImportRequest({ url, html: "just text, no tags" })).toMatchObject({ ok: false, code: "INVALID_HTML" });
    expect(parseImportRequest({ url, html: 42 })).toMatchObject({ ok: false, code: "INVALID_HTML" });
  });

  it("caps the page size", () => {
    expect(parseImportRequest({ url, html: "<p>" + "x".repeat(MAX_IMPORT_HTML_BYTES) })).toMatchObject({ ok: false, code: "TOO_LARGE" });
  });
});
