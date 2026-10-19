import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { HONEYPOT_ERROR, HONEYPOT_FIELD } from "@/lib/bookings/public-form";
import { INQUIRY_MAX, normalizeReference, normalizeSourcePage, parseInquiryForm } from "@/lib/inquiries/form";
import { bookingTypeForCategory, INQUIRY_CATEGORIES, INQUIRY_CATEGORY_LABEL, INQUIRY_STATUSES, inquiryHref, isInquiryCategory, isInquiryRef, isInquiryStatus, makeInquiryRef, OPEN_INQUIRY_STATUSES, readInquiryNotes, REFERENCE_CATEGORIES } from "@/lib/inquiries/labels";
import { inquirySearchTerm, summariseInquiries } from "@/lib/inquiries/queries";

const ARABIC = /[؀-ۿ]/;

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const GOOD = { full_name: "Ali", email: "ALI@example.com", category: "videography", subject: "Promo film", message: "A two-minute promo for our academy.", consent: "1" };

describe("inquiry categories and statuses", () => {
  it("lists the brief's thirteen categories with English and Arabic labels, and the seven statuses", () => {
    expect(INQUIRY_CATEGORIES).toEqual(["general", "tournament_event", "athlete", "club_team", "photography", "videography", "commercial_creative", "booking_question", "existing_order", "payment_billing", "partnership", "technical_support", "other"]);
    for (const c of INQUIRY_CATEGORIES) {
      expect(INQUIRY_CATEGORY_LABEL[c].en.trim()).not.toBe("");
      expect(INQUIRY_CATEGORY_LABEL[c].ar).toMatch(ARABIC);
    }
    expect(INQUIRY_STATUSES).toEqual(["new", "in_progress", "waiting_customer", "quoted", "converted", "resolved", "closed"]);
    expect(OPEN_INQUIRY_STATUSES).toEqual(["new", "in_progress", "waiting_customer", "quoted"]);
    expect(isInquiryCategory("athlete")).toBe(true);
    expect(isInquiryCategory("Athlete")).toBe(false);
    expect(isInquiryStatus("quoted")).toBe(true);
    expect(isInquiryStatus("done")).toBe(false);
  });

  it("shows the reference field by default for the existing-booking categories only", () => {
    expect(REFERENCE_CATEGORIES).toEqual(["booking_question", "existing_order", "payment_billing", "technical_support"]);
    expect(REFERENCE_CATEGORIES).not.toContain("general");
  });

  it("maps categories onto the booking type a conversion starts from", () => {
    expect(bookingTypeForCategory("athlete")).toBe("tournament_athlete");
    expect(bookingTypeForCategory("club_team")).toBe("club");
    expect(bookingTypeForCategory("photography")).toBe("private_session");
    for (const c of ["general", "tournament_event", "videography", "commercial_creative", "other"] as const) expect(bookingTypeForCategory(c)).toBe("custom");
  });
});

describe("inquiry references and links", () => {
  it("makes IQ- references from the same safe alphabet as bookings and validates them", () => {
    const ref = makeInquiryRef();
    expect(ref).toMatch(/^IQ-[A-HJ-NP-Z2-9]{6}$/);
    expect(isInquiryRef(ref)).toBe(true);
    expect(makeInquiryRef(() => 0)).toBe("IQ-AAAAAA");
    expect(isInquiryRef("BB-7K3PQ2")).toBe(false);
    expect(isInquiryRef("IQ-7K3PQ0")).toBe(false);
    expect(isInquiryRef(null)).toBe(false);
  });

  it("builds contact links that preselect the category and record a safe source page", () => {
    expect(inquiryHref()).toBe("/contact");
    expect(inquiryHref("general", "/")).toBe("/contact?from=%2F");
    expect(inquiryHref("commercial_creative", "/services?lang=ar")).toBe("/contact?type=commercial_creative&from=%2Fservices");
    expect(inquiryHref("athlete", "https://evil.example/x")).toBe("/contact?type=athlete");
    expect(inquiryHref("athlete", "//evil.example")).toBe("/contact?type=athlete");
  });

  it("reads stored notes defensively", () => {
    expect(readInquiryNotes(null)).toEqual([]);
    expect(readInquiryNotes([{ at: "2026-10-19T10:00:00.000Z", by: "u1", text: "Called" }, { text: " " }, "junk", { text: "No stamp" }])).toEqual([
      { at: "2026-10-19T10:00:00.000Z", by: "u1", text: "Called" },
      { at: "", by: null, text: "No stamp" },
    ]);
  });
});

describe("parseInquiryForm", () => {
  it("accepts a complete form, lower-cases the e-mail, normalises the reference and the source page, keeps a UUID key only", () => {
    const r = parseInquiryForm(fd({ ...GOOD, booking_reference: " bb-7k3pq2 ", source_page: "/services/tournament-athlete-coverage?lang=ar#x", idempotency_key: "55555555-5555-4555-8555-555555555555" }));
    expect(r.fieldErrors).toEqual({});
    expect(r.values).toEqual({ full_name: "Ali", email: "ali@example.com", category: "videography", subject: "Promo film", message: "A two-minute promo for our academy.", booking_reference: "BB-7K3PQ2", source_page: "/services/tournament-athlete-coverage", idempotency_key: "55555555-5555-4555-8555-555555555555" });
    expect(parseInquiryForm(fd({ ...GOOD, idempotency_key: "nope" })).values?.idempotency_key).toBeNull();
    expect(parseInquiryForm(fd(GOOD)).values?.booking_reference).toBeNull();
  });

  it("does not require a reference for a general inquiry and accepts gallery or order references", () => {
    expect(parseInquiryForm(fd({ ...GOOD, category: "general" })).values?.booking_reference).toBeNull();
    expect(parseInquiryForm(fd({ ...GOOD, category: "existing_order", booking_reference: "Order #4821 / gallery qatar-open" })).values?.booking_reference).toBe("ORDER #4821 / GALLERY QATAR-OPEN");
    expect(normalizeReference("<script>")).toBe("SCRIPT");
    expect(normalizeReference("   ")).toBeNull();
  });

  it("rejects the honeypot, missing or invalid fields, unknown categories, long values and missing consent", () => {
    expect(parseInquiryForm(fd({ ...GOOD, [HONEYPOT_FIELD]: "spam" })).fieldErrors[HONEYPOT_FIELD]).toBe(HONEYPOT_ERROR);
    const r = parseInquiryForm(fd({ full_name: "", email: "nope", category: "spam", subject: "s".repeat(INQUIRY_MAX.subject + 1), message: "m".repeat(INQUIRY_MAX.message + 1), booking_reference: "!!!" }));
    expect(r.values).toBeNull();
    expect(r.fieldErrors).toMatchObject({ full_name: "Required.", email: expect.stringMatching(/e-mail/i), category: expect.stringMatching(/listed/i), subject: expect.stringMatching(/under 160/), message: expect.stringMatching(/under 3000/), booking_reference: expect.stringMatching(/letters and digits/i), consent: expect.any(String) });
    expect(parseInquiryForm(fd({ ...GOOD, category: "" })).fieldErrors.category).toMatch(/choose/i);
  });

  it("only records site-relative source pages", () => {
    expect(normalizeSourcePage("/how-it-works")).toBe("/how-it-works");
    expect(normalizeSourcePage("https://x.test/")).toBeNull();
    expect(normalizeSourcePage("//x.test")).toBeNull();
    expect(normalizeSourcePage("/a b<c>")).toBe("/abc");
  });
});

describe("inquiry reporting", () => {
  it("summarises totals, new, open, quoted, converted and the split by category and status", () => {
    const stats = summariseInquiries([
      { status: "new", category: "photography" },
      { status: "new", category: "athlete" },
      { status: "quoted", category: "photography" },
      { status: "converted", category: "club_team" },
      { status: "closed", category: "other" },
      { status: "waiting_customer", category: "photography" },
    ]);
    expect(stats).toMatchObject({ total: 6, new: 2, open: 4, quoted: 1, converted: 1 });
    expect(stats.byCategory[0]).toEqual({ category: "photography", count: 3 });
    expect(stats.byStatus[0]).toEqual({ status: "new", count: 2 });
    expect(summariseInquiries([])).toMatchObject({ total: 0, new: 0, open: 0, byCategory: [], byStatus: [] });
  });

  it("keeps search terms safe for the PostgREST filter", () => {
    expect(inquirySearchTerm("IQ-AB12CD")).toBe("IQ-AB12CD");
    expect(inquirySearchTerm("a,b(c)")).toBe("a b c");
    expect(inquirySearchTerm("x")).toBeNull();
    expect(inquirySearchTerm("  ")).toBeNull();
  });
});
