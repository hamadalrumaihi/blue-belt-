import { describe, expect, it } from "vitest";
import { bookingSearchTerm, isoToWallClock, parseAmountQr, parseBookingForm, parseManualPayment } from "@/lib/bookings/form";
import { parsePersonForm, parseTags, whatsappDigits } from "@/lib/people/form";
import { parseOrganizationForm } from "@/lib/organizations/form";

const NOW = new Date("2026-10-06T08:00:00.000Z");
const PERSON = "44444444-4444-4444-8444-444444444444";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseBookingForm", () => {
  it("requires a type and either an existing client or a new name", () => {
    const { fieldErrors } = parseBookingForm(fd({}), NOW);
    expect(fieldErrors.booking_type).toBeTruthy();
    expect(fieldErrors.customer_name).toBeTruthy();
    expect(parseBookingForm(fd({ booking_type: "club", client_id: PERSON }), NOW).fieldErrors).toEqual({});
    expect(parseBookingForm(fd({ booking_type: "club", customer_name: "Ali" }), NOW).fieldErrors).toEqual({});
  });

  it("validates ids, e-mail, amount, URL and dates field by field", () => {
    const { fieldErrors } = parseBookingForm(fd({ booking_type: "tournament_athlete", client_id: "nope", customer_email: "bad", amount_qr: "abc", source_url: "ftp://x", competition_date: "2026-02-30", athlete_count: "0", event_id: "x", service_id: "y", organization_id: "z" }), NOW);
    expect(Object.keys(fieldErrors).sort()).toEqual(["amount_qr", "athlete_count", "client_id", "competition_date", "customer_email", "event_id", "organization_id", "service_id", "source_url"]);
  });

  it("builds session_at from the Qatar wall clock (UTC+3) and defaults the time to 09:00", () => {
    const a = parseBookingForm(fd({ booking_type: "private_session", customer_name: "Ali", session_date: "2026-10-10", session_time: "14:30" }), NOW);
    expect(a.fieldErrors).toEqual({});
    expect(a.values.session_at).toBe("2026-10-10T11:30:00.000Z");
    const b = parseBookingForm(fd({ booking_type: "private_session", customer_name: "Ali", session_date: "2026-10-10" }), NOW);
    expect(b.values.session_at).toBe("2026-10-10T06:00:00.000Z");
    expect(b.values.session_time).toBe("09:00");
    expect(parseBookingForm(fd({ booking_type: "private_session", customer_name: "Ali", session_time: "14:30" }), NOW).fieldErrors.session_date).toBeTruthy();
    expect(parseBookingForm(fd({ booking_type: "private_session", customer_name: "Ali", session_date: "2026-10-10", session_time: "25:00" }), NOW).fieldErrors.session_time).toBeTruthy();
  });

  it("collects typed details and ignores unknown enum values", () => {
    const { values } = parseBookingForm(fd({ booking_type: "tournament_athlete", customer_name: "Ali", athlete_name: "Sara", academy: "Gracie", belt: "Blue", age_division: "Adult", weight_division: "-64", gi: "both", coverage: "sideways", source_url: "https://ajptour.com/x", competition_date: "2026-11-01", booked_for: "child", instagram: "@sara", wants_photographer: "1", athlete_count: "12", amount_qr: "1,250.50", payment_mode: "link_later", requires_contract: "1" }), NOW);
    expect(values.details).toEqual({ academy: "Gracie", belt: "Blue", age_division: "Adult", weight_division: "-64", gi: "both", source_url: "https://ajptour.com/x", competition_date: "2026-11-01", athlete_count: 12, wants_photographer: true, booked_for: "child", instagram: "@sara", athlete_name: "Sara" });
    expect(values.amount_qr).toBe(1250.5);
    expect(values.payment_mode).toBe("link_later");
    expect(values.requires_contract).toBe(true);
    expect(values.customer_email).toBeNull();
  });

  it("blank amount means 'use the service price' and an unknown payment mode is an error", () => {
    expect(parseBookingForm(fd({ booking_type: "club", customer_name: "A" }), NOW).values.amount_qr).toBeNull();
    expect(parseBookingForm(fd({ booking_type: "club", customer_name: "A", payment_mode: "crypto" }), NOW).fieldErrors.payment_mode).toBeTruthy();
  });
});

describe("parseAmountQr", () => {
  it("accepts plain, decimal and thousands-separated amounts; refuses negatives and huge values", () => {
    expect(parseAmountQr("350")).toEqual({ ok: true, value: 350 });
    expect(parseAmountQr("1,200.456")).toEqual({ ok: true, value: 1200.46 });
    expect(parseAmountQr(null)).toEqual({ ok: true, value: null });
    expect(parseAmountQr("-1")).toEqual({ ok: false });
    expect(parseAmountQr("9999999")).toEqual({ ok: false });
  });
});

describe("parseManualPayment", () => {
  it("needs an offline method and a positive amount; MyFatoorah is never a manual method", () => {
    expect(parseManualPayment(fd({}), NOW).fieldErrors).toMatchObject({ method: expect.any(String), amount_qr: expect.any(String) });
    expect(parseManualPayment(fd({ method: "myfatoorah", amount_qr: "10" }), NOW).fieldErrors.method).toBeTruthy();
    expect(parseManualPayment(fd({ method: "cash", amount_qr: "0" }), NOW).fieldErrors.amount_qr).toBeTruthy();
  });

  it("defaults paid_at to now, places a given date at midday Qatar time and bounds the note", () => {
    const a = parseManualPayment(fd({ method: "fawran", amount_qr: "350", note: " ref 123 " }), NOW);
    expect(a.fieldErrors).toEqual({});
    expect(a.values).toEqual({ method: "fawran", amount_qr: 350, paid_at: NOW.toISOString(), note: "ref 123" });
    expect(parseManualPayment(fd({ method: "bank_transfer", amount_qr: "100", paid_at: "2026-10-01" }), NOW).values.paid_at).toBe("2026-10-01T09:00:00.000Z");
    expect(parseManualPayment(fd({ method: "cash", amount_qr: "100", paid_at: "2026-13-01" }), NOW).fieldErrors.paid_at).toBeTruthy();
    expect(parseManualPayment(fd({ method: "cash", amount_qr: "100", note: "x".repeat(501) }), NOW).fieldErrors.note).toBeTruthy();
  });
});

describe("helpers", () => {
  it("isoToWallClock renders Qatar date and time, null for garbage", () => {
    expect(isoToWallClock("2026-10-10T11:30:00.000Z")).toEqual({ date: "2026-10-10", time: "14:30" });
    expect(isoToWallClock("2026-10-10T22:30:00.000Z")).toEqual({ date: "2026-10-11", time: "01:30" });
    expect(isoToWallClock(null)).toBeNull();
    expect(isoToWallClock("nope")).toBeNull();
  });

  it("bookingSearchTerm strips PostgREST filter syntax", () => {
    expect(bookingSearchTerm("  BB-7K3,  (x)% ")).toBe("BB-7K3 x");
    expect(bookingSearchTerm("")).toBeNull();
    expect(bookingSearchTerm("a@b.com")).toBe("a@b.com");
  });
});

describe("parsePersonForm / parseOrganizationForm", () => {
  it("normalises e-mail, Instagram, phone key and tags", () => {
    const { fieldErrors, values } = parsePersonForm(fd({ full_name: " Ali Khan ", email: "Ali@Example.com", phone: "+974 5555 1234", instagram: "https://instagram.com/Ali.K/", tags: "VIP, parent,vip", kind: "parent" }));
    expect(fieldErrors).toEqual({});
    expect(values).toMatchObject({ full_name: "Ali Khan", email: "ali@example.com", phone_key: "55551234", instagram: "ali.k", tags: ["vip", "parent"], kind: "parent" });
  });
  it("flags a missing name, a bad e-mail and an unusable Instagram handle", () => {
    const { fieldErrors } = parsePersonForm(fd({ email: "x", instagram: "not a handle!" }));
    expect(Object.keys(fieldErrors).sort()).toEqual(["email", "full_name", "instagram"]);
  });
  it("parseTags caps and dedupes; whatsappDigits assumes Qatar for 8 digits", () => {
    expect(parseTags("a,b,a,c")).toEqual(["a", "b", "c"]);
    expect(whatsappDigits("5555 1234")).toBe("97455551234");
    expect(whatsappDigits("+974 5555 1234")).toBe("97455551234");
    expect(whatsappDigits("123")).toBeNull();
  });
  it("organisation form validates the contact id and kind", () => {
    expect(parseOrganizationForm(fd({ name: "Gracie Doha", kind: "academy", primary_contact_id: PERSON })).values).toMatchObject({ name: "Gracie Doha", kind: "academy", primary_contact_id: PERSON });
    const { fieldErrors } = parseOrganizationForm(fd({ kind: "gang", primary_contact_id: "nope", email: "bad" }));
    expect(Object.keys(fieldErrors).sort()).toEqual(["email", "kind", "name", "primary_contact_id"]);
  });
});
