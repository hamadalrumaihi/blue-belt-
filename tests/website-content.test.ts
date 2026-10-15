import { describe, expect, it } from "vitest";
import { faqToJson, openQuestionCounts, readFaqOverrides, readOpenQuestions, readPublishedFaqOverrides, readTestimonialRecords, readTestimonials, testimonialToJson } from "@/lib/studio/site-content";

describe("testimonials with permission flags", () => {
  const settings = {
    testimonials: [
      { quote: "Old row, no flags", name: "Legacy" },
      { id: "ok", quote: "Great photos", name: "Hamad", role: "Athlete", permission_granted: true, permission_note: "WhatsApp 3 Oct", published: true, created_at: "2026-10-03T00:00:00.000Z" },
      { id: "draft", quote: "Not yet", name: "Sara", role: null, permission_granted: true, permission_note: "Email", published: false },
      { id: "nopermission", quote: "Published without permission", name: "X", permission_granted: false, permission_note: null, published: true },
      { id: "bad id!", quote: "weird id", name: "Y", permission_granted: true, published: true },
      { quote: "", name: "Empty" },
      "junk",
    ],
  };

  it("public read returns only published rows with written permission (legacy rows never show)", () => {
    expect(readTestimonials(settings)).toEqual([
      { quote: "Great photos", name: "Hamad", role: "Athlete" },
      { quote: "weird id", name: "Y", role: null },
    ]);
    expect(readTestimonials(null)).toEqual([]);
    expect(readTestimonials({ testimonials: "nope" })).toEqual([]);
  });

  it("editor read keeps every valid row, marks legacy rows as unpublished / needing permission, and assigns ids", () => {
    const rows = readTestimonialRecords(settings);
    expect(rows.map((r) => r.id)).toEqual(["legacy-0", "ok", "draft", "nopermission", "legacy-4"]);
    expect(rows[0]).toMatchObject({ legacy: true, published: false, permission_granted: false });
    expect(rows[1]).toMatchObject({ legacy: false, published: true, permission_granted: true, permission_note: "WhatsApp 3 Oct", created_at: "2026-10-03T00:00:00.000Z" });
    expect(rows[3]).toMatchObject({ legacy: false, published: true, permission_granted: false });
  });

  it("caps sizes and keeps backward compatibility on the stored shape", () => {
    const long = { testimonials: Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, quote: "q".repeat(700), name: "n".repeat(100), permission_granted: true, published: true })) };
    const rows = readTestimonialRecords(long);
    expect(rows).toHaveLength(40);
    expect(rows[0].quote).toHaveLength(600);
    expect(rows[0].name).toHaveLength(80);
    expect(readTestimonials(long)).toHaveLength(6);
    const json = testimonialToJson({ id: "a", quote: "q", name: "n", role: null, permission_granted: true, permission_note: "note", published: true, created_at: null });
    expect(readTestimonialRecords({ testimonials: [json] })[0]).toMatchObject({ id: "a", legacy: false, published: true });
  });
});

describe("FAQ overrides", () => {
  const settings = {
    faqOverrides: [
      { id: "deposit", question_en: "Do I pay a deposit?", answer_en: "Yes, 50%.", category: "pricing", published: true, updated_at: "2026-10-01T00:00:00.000Z" },
      { id: "deposit", question_en: "duplicate", answer_en: "x" },
      { id: "minors", question_en: "Minors?", answer_en: "Guardian release.", question_ar: "القاصرون؟", answer_ar: "تصريح ولي الأمر.", category: "nonsense", published: false },
      { id: "no-answer", question_en: "?" },
      { id: "bad id", question_en: "a", answer_en: "b" },
    ],
  };

  it("validates on read: unique ids, both English fields, known category, optional Arabic", () => {
    const rows = readFaqOverrides(settings);
    expect(rows.map((r) => r.id)).toEqual(["deposit", "minors"]);
    expect(rows[0]).toMatchObject({ category: "pricing", published: true, question_ar: null });
    expect(rows[1]).toMatchObject({ category: "other", published: false, question_ar: "القاصرون؟", answer_ar: "تصريح ولي الأمر." });
    expect(readPublishedFaqOverrides(settings).map((r) => r.id)).toEqual(["deposit"]);
    expect(readFaqOverrides(undefined)).toEqual([]);
  });

  it("round-trips through faqToJson and caps the list", () => {
    const rows = readFaqOverrides(settings);
    expect(readFaqOverrides({ faqOverrides: rows.map(faqToJson) })).toEqual(rows);
    const many = { faqOverrides: Array.from({ length: 70 }, (_, i) => ({ id: `f${i}`, question_en: "q", answer_en: "a".repeat(3000) })) };
    const out = readFaqOverrides(many);
    expect(out).toHaveLength(60);
    expect(out[0].answer_en).toHaveLength(2000);
  });
});

describe("open questions", () => {
  it("reads the private list, defaults the source, and counts open vs resolved", () => {
    const settings = {
      openQuestions: [
        { id: "a", text: "Do you shoot kids' divisions?", source: "contact form", created_at: "2026-10-02T00:00:00.000Z", resolved: false },
        { id: "b", text: "Raw files?", created_at: "2026-10-01T00:00:00.000Z", resolved: true, resolved_at: "2026-10-03T00:00:00.000Z" },
        { text: "" },
        { text: "no id" },
      ],
    };
    const rows = readOpenQuestions(settings);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "q-3"]);
    expect(rows[1]).toMatchObject({ source: "owner", resolved: true, resolved_at: "2026-10-03T00:00:00.000Z" });
    expect(openQuestionCounts(settings)).toEqual({ open: 2, resolved: 1 });
    expect(openQuestionCounts(null)).toEqual({ open: 0, resolved: 0 });
  });
});
