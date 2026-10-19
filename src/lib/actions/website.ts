"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { requireOwner } from "@/lib/roles";
import {
  FAQ_LIMITS,
  faqToJson,
  isFaqCategory,
  OPEN_QUESTION_LIMITS,
  openQuestionToJson,
  readFaqOverrides,
  readOpenQuestions,
  readTestimonialRecords,
  TESTIMONIAL_LIMITS,
  testimonialToJson,
  type FaqOverride,
  type OpenQuestion,
  type TestimonialRecord,
} from "@/lib/studio/site-content";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { trimOrNull } from "@/lib/utils";
import { isPlainObject } from "@/lib/validation";

/**
 * Website content the owner manages: testimonials (with written permission),
 * FAQ overrides / additions and the private list of open questions. All of
 * it lives in photo_studio.settings (jsonb) under its own key; a save
 * replaces only that key. Owner only (requireOwner + RLS), audited, and the
 * public pages that read the settings are revalidated.
 */
export type WebsiteState = { error?: string; fieldErrors?: Record<string, string>; saved?: boolean; id?: string } | null;
type Result = { ok: true } | { ok: false; error: string };

const PUBLIC_PATHS = ["/", "/how-it-works", "/services", "/work", "/contact"];
const ID_RE = /^[a-z0-9_-]{1,64}$/i;

type Client = SupabaseClient<Database>;

async function owner(): Promise<{ supabase: Client; userId: string } | { error: string }> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error === "Only the studio owner can use pricing." ? "Only the studio owner can edit website content." : guard.error };
  const supabase = await createClient();
  return { supabase, userId: guard.viewer.userId };
}

async function readSettings(supabase: Client, userId: string): Promise<{ exists: boolean; updatedAt: string | null; settings: Record<string, Json | undefined> }> {
  const { data } = await supabase.from("photo_studio").select("settings, updated_at").eq("owner_id", userId).maybeSingle();
  const settings = data && isPlainObject(data.settings) ? { ...(data.settings as Record<string, Json | undefined>) } : {};
  return { exists: Boolean(data), updatedAt: data?.updated_at ?? null, settings };
}

/**
 * Replace one key of settings; the studio row is created with defaults when
 * the owner never saved Settings → Public site. The write is guarded by the
 * row's updated_at (optimistic): a save from another tab in between is never
 * overwritten; we re-read and merge once, then give up with a clear message.
 */
async function writeKey(supabase: Client, userId: string, key: string, value: Json, action: string, data: Record<string, Json | undefined>): Promise<Result> {
  let written = false;
  for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
    const current = await readSettings(supabase, userId);
    const settings = { ...current.settings, [key]: value } as Json;
    if (!current.exists) {
      const { error } = await supabase.from("photo_studio").insert({ owner_id: userId, business_name: "Blue Belt Media", settings });
      if (error) return { ok: false, error: error.message };
      written = true;
      break;
    }
    let q = supabase.from("photo_studio").update({ settings }, { count: "exact" }).eq("owner_id", userId);
    if (current.updatedAt) q = q.eq("updated_at", current.updatedAt);
    const { error, count } = await q;
    if (error) return { ok: false, error: error.message };
    written = Boolean(count);
  }
  if (!written) return { ok: false, error: "The website settings changed in another tab. Reload the page and try again." };
  await writeAudit(supabase, { ownerId: userId, actorId: userId, entity: "studio", entityId: userId, action, data });
  for (const p of PUBLIC_PATHS) revalidatePath(p);
  revalidatePath("/services", "layout");
  revalidatePath("/website/testimonials");
  revalidatePath("/website/faqs");
  revalidatePath("/studio");
  return { ok: true };
}

function flag(formData: FormData, name: string): boolean {
  const v = formData.get(name);
  return v === "on" || v === "1" || v === "true";
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

export async function saveTestimonial(_prev: WebsiteState, formData: FormData): Promise<WebsiteState> {
  const ctx = await owner();
  if ("error" in ctx) return { error: ctx.error };
  const fieldErrors: Record<string, string> = {};
  const rawId = trimOrNull(formData.get("id"));
  const id = rawId && ID_RE.test(rawId) ? rawId : randomUUID();
  const quote = trimOrNull(formData.get("quote"));
  const name = trimOrNull(formData.get("name"));
  const role = trimOrNull(formData.get("role"));
  const permission_granted = flag(formData, "permission_granted");
  const permission_note = trimOrNull(formData.get("permission_note"));
  const published = flag(formData, "published");
  if (!quote) fieldErrors.quote = "The client's words are required.";
  else if (quote.length > TESTIMONIAL_LIMITS.quote) fieldErrors.quote = `Keep it under ${TESTIMONIAL_LIMITS.quote} characters.`;
  if (name && name.length > TESTIMONIAL_LIMITS.name) fieldErrors.name = `Keep it under ${TESTIMONIAL_LIMITS.name} characters.`;
  if (role && role.length > TESTIMONIAL_LIMITS.role) fieldErrors.role = `Keep it under ${TESTIMONIAL_LIMITS.role} characters.`;
  if (permission_note && permission_note.length > TESTIMONIAL_LIMITS.permission_note) fieldErrors.permission_note = `Keep it under ${TESTIMONIAL_LIMITS.permission_note} characters.`;
  if (permission_granted && !permission_note) fieldErrors.permission_note = "Note where the permission was given (e.g. WhatsApp, 3 Oct 2026).";
  if (published && !permission_granted) fieldErrors.published = "Confirm written permission before publishing.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const current = readTestimonialRecords((await readSettings(ctx.supabase, ctx.userId)).settings as Json);
  const existing = current.find((t) => t.id === id);
  const record: Omit<TestimonialRecord, "legacy"> = { id, quote: quote!, name: name ?? "", role, permission_granted, permission_note, published, created_at: existing?.created_at ?? new Date().toISOString() };
  const next = existing ? current.map((t) => (t.id === id ? record : t)) : [...current, record];
  if (next.length > TESTIMONIAL_LIMITS.max) return { error: `At most ${TESTIMONIAL_LIMITS.max} testimonials can be stored. Delete one first.` };
  const res = await writeKey(ctx.supabase, ctx.userId, "testimonials", next.map(testimonialToJson), existing ? "website.testimonial_updated" : "website.testimonial_added", { id, published, permission_granted });
  return res.ok ? { saved: true, id } : { error: res.error };
}

export async function deleteTestimonial(id: string): Promise<Result> {
  if (!ID_RE.test(id)) return { ok: false, error: "Invalid testimonial." };
  const ctx = await owner();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const current = readTestimonialRecords((await readSettings(ctx.supabase, ctx.userId)).settings as Json);
  if (!current.some((t) => t.id === id)) return { ok: false, error: "Testimonial not found." };
  return writeKey(ctx.supabase, ctx.userId, "testimonials", current.filter((t) => t.id !== id).map(testimonialToJson), "website.testimonial_deleted", { id });
}

// ---------------------------------------------------------------------------
// FAQ overrides
// ---------------------------------------------------------------------------

export async function saveFaq(_prev: WebsiteState, formData: FormData): Promise<WebsiteState> {
  const ctx = await owner();
  if ("error" in ctx) return { error: ctx.error };
  const fieldErrors: Record<string, string> = {};
  const rawId = trimOrNull(formData.get("id"))?.toLowerCase().replace(/\s+/g, "-") ?? null;
  const id = rawId && ID_RE.test(rawId) ? rawId : rawId ? null : randomUUID();
  if (!id) fieldErrors.id = "Letters, digits, dashes and underscores only (max 64).";
  const question_en = trimOrNull(formData.get("question_en"));
  const answer_en = trimOrNull(formData.get("answer_en"));
  const question_ar = trimOrNull(formData.get("question_ar"));
  const answer_ar = trimOrNull(formData.get("answer_ar"));
  const category = trimOrNull(formData.get("category"));
  const published = flag(formData, "published");
  if (!question_en) fieldErrors.question_en = "The question (English) is required.";
  else if (question_en.length > FAQ_LIMITS.question) fieldErrors.question_en = `Keep it under ${FAQ_LIMITS.question} characters.`;
  if (!answer_en) fieldErrors.answer_en = "The answer (English) is required.";
  else if (answer_en.length > FAQ_LIMITS.answer) fieldErrors.answer_en = `Keep it under ${FAQ_LIMITS.answer} characters.`;
  if (question_ar && question_ar.length > FAQ_LIMITS.question) fieldErrors.question_ar = `Keep it under ${FAQ_LIMITS.question} characters.`;
  if (answer_ar && answer_ar.length > FAQ_LIMITS.answer) fieldErrors.answer_ar = `Keep it under ${FAQ_LIMITS.answer} characters.`;
  if ((question_ar && !answer_ar) || (!question_ar && answer_ar)) fieldErrors.answer_ar = "Give both the Arabic question and answer, or neither.";
  if (!isFaqCategory(category)) fieldErrors.category = "Pick a category.";
  if (Object.keys(fieldErrors).length || !id || !isFaqCategory(category)) return { fieldErrors };

  const current = readFaqOverrides((await readSettings(ctx.supabase, ctx.userId)).settings as Json);
  const existing = current.find((f) => f.id === id);
  const record: FaqOverride = { id, question_en: question_en!, answer_en: answer_en!, question_ar, answer_ar, category, published, updated_at: new Date().toISOString() };
  const next = existing ? current.map((f) => (f.id === id ? record : f)) : [...current, record];
  if (next.length > FAQ_LIMITS.max) return { error: `At most ${FAQ_LIMITS.max} FAQ entries can be stored.` };
  const res = await writeKey(ctx.supabase, ctx.userId, "faqOverrides", next.map(faqToJson), existing ? "website.faq_updated" : "website.faq_added", { id, published, category });
  return res.ok ? { saved: true, id } : { error: res.error };
}

export async function deleteFaq(id: string): Promise<Result> {
  if (!ID_RE.test(id)) return { ok: false, error: "Invalid FAQ id." };
  const ctx = await owner();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const current = readFaqOverrides((await readSettings(ctx.supabase, ctx.userId)).settings as Json);
  if (!current.some((f) => f.id === id)) return { ok: false, error: "FAQ entry not found." };
  return writeKey(ctx.supabase, ctx.userId, "faqOverrides", current.filter((f) => f.id !== id).map(faqToJson), "website.faq_deleted", { id });
}

// ---------------------------------------------------------------------------
// Open questions (private tracker)
// ---------------------------------------------------------------------------

export async function addOpenQuestion(_prev: WebsiteState, formData: FormData): Promise<WebsiteState> {
  const ctx = await owner();
  if ("error" in ctx) return { error: ctx.error };
  const text = trimOrNull(formData.get("text"));
  const source = trimOrNull(formData.get("source")) ?? "owner";
  if (!text) return { fieldErrors: { text: "Write the question." } };
  if (text.length > OPEN_QUESTION_LIMITS.text) return { fieldErrors: { text: `Keep it under ${OPEN_QUESTION_LIMITS.text} characters.` } };
  if (source.length > OPEN_QUESTION_LIMITS.source) return { fieldErrors: { source: `Keep it under ${OPEN_QUESTION_LIMITS.source} characters.` } };
  const current = readOpenQuestions((await readSettings(ctx.supabase, ctx.userId)).settings as Json);
  const q: OpenQuestion = { id: randomUUID(), text, source, created_at: new Date().toISOString(), resolved: false, resolved_at: null };
  const next = [q, ...current];
  if (next.length > OPEN_QUESTION_LIMITS.max) return { error: `At most ${OPEN_QUESTION_LIMITS.max} open questions can be stored. Resolve and delete old ones.` };
  const res = await writeKey(ctx.supabase, ctx.userId, "openQuestions", next.map(openQuestionToJson), "website.question_added", { id: q.id, source });
  return res.ok ? { saved: true, id: q.id } : { error: res.error };
}

export async function resolveOpenQuestion(id: string, resolved: boolean): Promise<Result> {
  if (!ID_RE.test(id)) return { ok: false, error: "Invalid question." };
  const ctx = await owner();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const current = readOpenQuestions((await readSettings(ctx.supabase, ctx.userId)).settings as Json);
  if (!current.some((q) => q.id === id)) return { ok: false, error: "Question not found." };
  const next = current.map((q) => (q.id === id ? { ...q, resolved, resolved_at: resolved ? new Date().toISOString() : null } : q));
  return writeKey(ctx.supabase, ctx.userId, "openQuestions", next.map(openQuestionToJson), resolved ? "website.question_resolved" : "website.question_reopened", { id });
}

export async function deleteOpenQuestion(id: string): Promise<Result> {
  if (!ID_RE.test(id)) return { ok: false, error: "Invalid question." };
  const ctx = await owner();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const current = readOpenQuestions((await readSettings(ctx.supabase, ctx.userId)).settings as Json);
  if (!current.some((q) => q.id === id)) return { ok: false, error: "Question not found." };
  return writeKey(ctx.supabase, ctx.userId, "openQuestions", current.filter((q) => q.id !== id).map(openQuestionToJson), "website.question_deleted", { id });
}
