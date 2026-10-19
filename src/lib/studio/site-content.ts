import { isAllowedGalleryUrl } from "@/lib/galleries/state";
import type { Json } from "@/lib/supabase/database.types";
import { isValidHttpUrl } from "@/lib/utils";
import { isPlainObject } from "@/lib/validation";

/**
 * Where "View and buy photos" sends visitors: the studio's Pic-Time client
 * gallery. Verified as a direct link (HTTP 200). The `?headless=true` variant
 * of the same page is for embedding only and is never linked.
 */
export const DEFAULT_PICTIME_GALLERY_URL = "https://galleries.bluebelt.media/client";

/**
 * Normalises an owner-supplied public gallery link: https on pic-time.com or
 * galleries.bluebelt.media only, with any `headless` query parameter removed.
 * Null when the value is empty or not acceptable.
 */
export function normalizePictimeGalleryUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048 || !isAllowedGalleryUrl(trimmed)) return null;
  const u = new URL(trimmed);
  u.searchParams.delete("headless");
  u.hash = "";
  return u.toString();
}

/** `photo_studio.settings.pictimeGalleryUrl` when valid, else the default client gallery. */
export function readPictimeGalleryUrl(settings: Json | null | undefined): string {
  if (!isPlainObject(settings)) return DEFAULT_PICTIME_GALLERY_URL;
  return normalizePictimeGalleryUrl(settings.pictimeGalleryUrl) ?? DEFAULT_PICTIME_GALLERY_URL;
}

/**
 * Optional website content kept in photo_studio.settings (edited in
 * /website/* or by hand). Everything is validated on read, so a stray value
 * never breaks the public site and no URL is rendered unchecked.
 */
/** `name` may be empty: the website then shows an anonymous label ("Client"). */
export type Testimonial = { quote: string; name: string; role: string | null };
export type PortfolioLink = { title: string; url: string; cover: string | null };

/**
 * Editor view of one testimonial. Rows written before the permission flags
 * existed have `legacy: true`: they are treated as unpublished and shown in
 * the editor as "needs permission confirmation" until the owner confirms.
 */
export type TestimonialRecord = Testimonial & {
  id: string;
  /** The client agreed, in writing, to appear on the website. */
  permission_granted: boolean;
  /** Where / when the permission was given (e.g. "WhatsApp, 3 Oct 2026"). */
  permission_note: string | null;
  published: boolean;
  legacy: boolean;
  created_at: string | null;
};

export const TESTIMONIAL_LIMITS = { quote: 600, name: 80, role: 80, permission_note: 200, max: 40, publicMax: 6 } as const;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(new Date(v).getTime()) ? v : null;
}

const ID_RE = /^[a-z0-9_-]{1,64}$/i;

/** Every stored testimonial, legacy rows included, for the editor. Invalid rows are skipped. */
export function readTestimonialRecords(settings: Json | null | undefined): TestimonialRecord[] {
  if (!isPlainObject(settings) || !Array.isArray(settings.testimonials)) return [];
  const out: TestimonialRecord[] = [];
  settings.testimonials.forEach((t, index) => {
    if (!isPlainObject(t)) return;
    const quote = str(t.quote, TESTIMONIAL_LIMITS.quote);
    const name = str(t.name, TESTIMONIAL_LIMITS.name) ?? "";
    if (!quote) return;
    const legacy = typeof t.permission_granted !== "boolean" || typeof t.published !== "boolean";
    const id = typeof t.id === "string" && ID_RE.test(t.id) ? t.id : `legacy-${index}`;
    out.push({
      id,
      quote,
      name,
      role: str(t.role, TESTIMONIAL_LIMITS.role),
      permission_granted: t.permission_granted === true,
      permission_note: str(t.permission_note, TESTIMONIAL_LIMITS.permission_note),
      published: legacy ? false : t.published === true,
      legacy,
      created_at: isoOrNull(t.created_at),
    });
  });
  return out.slice(0, TESTIMONIAL_LIMITS.max);
}

/** PUBLIC read: only testimonials that are published AND have written permission. Legacy rows never show. */
export function readTestimonials(settings: Json | null | undefined): Testimonial[] {
  return readTestimonialRecords(settings)
    .filter((t) => t.published && t.permission_granted && !t.legacy)
    .map(({ quote, name, role }) => ({ quote, name, role }))
    .slice(0, TESTIMONIAL_LIMITS.publicMax);
}

/**
 * Reviews the owner supplied on 19 October 2026 for the website. They are
 * NOT published from here: each one is offered in the testimonials editor
 * as a one-click draft, and goes live only once the owner confirms the
 * customer's written permission and ticks Published, like any other review.
 * Wording is kept exactly as supplied (Arabic stays Arabic); attribution is
 * anonymous until the owner adds an approved name.
 */
export const SUPPLIED_REVIEWS: ReadonlyArray<{ key: string; quote: string }> = [
  { key: "supplied-2026-10-19-1", quote: "ماشاءالله تبارك الله الصور مافيها ولا ملاحظه خيال والكوالتي ممتاز" },
  { key: "supplied-2026-10-19-2", quote: "والله العظيم شغل جبار" },
  { key: "supplied-2026-10-19-3", quote: "ممتاز الفيديو خيال ماشاءالله" },
];

/** The stored shape of one testimonial (what the editor writes back). */
export function testimonialToJson(t: Omit<TestimonialRecord, "legacy">): Json {
  return { id: t.id, quote: t.quote, name: t.name, role: t.role, permission_granted: t.permission_granted, permission_note: t.permission_note, published: t.published, created_at: t.created_at };
}

export function readPortfolio(settings: Json): PortfolioLink[] {
  if (!isPlainObject(settings) || !Array.isArray(settings.portfolio)) return [];
  const out: PortfolioLink[] = [];
  for (const p of settings.portfolio) {
    if (!isPlainObject(p) || typeof p.title !== "string" || typeof p.url !== "string") continue;
    const title = p.title.trim().slice(0, 120);
    const url = p.url.trim();
    if (!title || !isValidHttpUrl(url) || !url.startsWith("https://")) continue;
    const cover = typeof p.cover === "string" && p.cover.startsWith("https://") && isValidHttpUrl(p.cover) ? p.cover : null;
    out.push({ title, url, cover });
  }
  return out.slice(0, 24);
}

// ---------------------------------------------------------------------------
// FAQ overrides and open questions (photo_studio.settings.faqOverrides / openQuestions)
// ---------------------------------------------------------------------------

export const FAQ_CATEGORIES = ["booking", "pricing", "delivery", "rights", "tournaments", "other"] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];
export const FAQ_CATEGORY_LABEL: Record<FaqCategory, string> = { booking: "Booking", pricing: "Pricing & payment", delivery: "Delivery", rights: "Rights & consent", tournaments: "Tournaments", other: "Other" };

export function isFaqCategory(v: unknown): v is FaqCategory {
  return typeof v === "string" && (FAQ_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Owner-written FAQ override or addition. `id` matching a code catalog FAQ
 * (src/lib/catalog/faq.ts, workstream B) replaces that entry on the public
 * pages; any other id is appended. Unpublished rows never leave the editor.
 */
export type FaqOverride = { id: string; question_en: string; answer_en: string; question_ar: string | null; answer_ar: string | null; category: FaqCategory; published: boolean; updated_at: string | null };

export const FAQ_LIMITS = { question: 200, answer: 2000, max: 60 } as const;

export function readFaqOverrides(settings: Json | null | undefined): FaqOverride[] {
  if (!isPlainObject(settings) || !Array.isArray(settings.faqOverrides)) return [];
  const out: FaqOverride[] = [];
  const seen = new Set<string>();
  for (const f of settings.faqOverrides) {
    if (!isPlainObject(f) || typeof f.id !== "string" || !ID_RE.test(f.id) || seen.has(f.id)) continue;
    const question_en = str(f.question_en, FAQ_LIMITS.question);
    const answer_en = str(f.answer_en, FAQ_LIMITS.answer);
    if (!question_en || !answer_en) continue;
    seen.add(f.id);
    out.push({
      id: f.id,
      question_en,
      answer_en,
      question_ar: str(f.question_ar, FAQ_LIMITS.question),
      answer_ar: str(f.answer_ar, FAQ_LIMITS.answer),
      category: isFaqCategory(f.category) ? f.category : "other",
      published: f.published === true,
      updated_at: isoOrNull(f.updated_at),
    });
  }
  return out.slice(0, FAQ_LIMITS.max);
}

/** PUBLIC read: published overrides only (the public pages merge these with the code catalog). */
export function readPublishedFaqOverrides(settings: Json | null | undefined): FaqOverride[] {
  return readFaqOverrides(settings).filter((f) => f.published);
}

export function faqToJson(f: FaqOverride): Json {
  return { id: f.id, question_en: f.question_en, answer_en: f.answer_en, question_ar: f.question_ar, answer_ar: f.answer_ar, category: f.category, published: f.published, updated_at: f.updated_at };
}

/** A question a visitor (or the owner) asked that the site does not answer yet. Private; never rendered publicly. */
export type OpenQuestion = { id: string; text: string; source: string; created_at: string; resolved: boolean; resolved_at: string | null };

export const OPEN_QUESTION_LIMITS = { text: 500, source: 80, max: 200 } as const;

export function readOpenQuestions(settings: Json | null | undefined): OpenQuestion[] {
  if (!isPlainObject(settings) || !Array.isArray(settings.openQuestions)) return [];
  const out: OpenQuestion[] = [];
  settings.openQuestions.forEach((q, index) => {
    if (!isPlainObject(q)) return;
    const text = str(q.text, OPEN_QUESTION_LIMITS.text);
    if (!text) return;
    const id = typeof q.id === "string" && ID_RE.test(q.id) ? q.id : `q-${index}`;
    out.push({ id, text, source: str(q.source, OPEN_QUESTION_LIMITS.source) ?? "owner", created_at: isoOrNull(q.created_at) ?? "", resolved: q.resolved === true, resolved_at: isoOrNull(q.resolved_at) });
  });
  return out.slice(0, OPEN_QUESTION_LIMITS.max);
}

export function openQuestionToJson(q: OpenQuestion): Json {
  return { id: q.id, text: q.text, source: q.source, created_at: q.created_at, resolved: q.resolved, resolved_at: q.resolved_at };
}

/** Counters for the Overview: unanswered visitor / policy questions. */
export function openQuestionCounts(settings: Json | null | undefined): { open: number; resolved: number } {
  const all = readOpenQuestions(settings);
  const open = all.filter((q) => !q.resolved).length;
  return { open, resolved: all.length - open };
}
