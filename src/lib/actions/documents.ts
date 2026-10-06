"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { bookingTransitionColumns, canTransitionBooking } from "@/lib/bookings/state";
import { bodyHash } from "@/lib/documents/hash";
import { mergeValuesFor } from "@/lib/documents/merge";
import { canTransitionDocument, DOCUMENT_KIND_LABEL, isDocumentKind, renderTemplate } from "@/lib/documents/state";
import { DEFAULT_TEMPLATES } from "@/lib/documents/templates";
import { createSigningToken } from "@/lib/documents/tokens";
import { buildEmail } from "@/lib/notifications/email/templates";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { loadStudio, siteUrl } from "@/lib/studio/queries";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { DocumentKind, PhotoBookingRow, PhotoDocumentRow } from "@/lib/supabase/database.types";
import { trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import type { ActionState } from "./types";

/** Templates are plain text; 40 KB is far beyond any real contract and keeps the editor and PDF fast. */
const MAX_BODY_BYTES = 40 * 1024;
const MAX_TITLE = 160;
const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 90;
const DEFAULT_EXPIRY_DAYS = 14;
const DAY_MS = 86_400_000;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function owner() {
  const supabase = await createClient();
  // Studio team only: a client-portal account gets `user: null` here, which every
  // caller turns into a clear error. RLS (photo_is_studio_user) enforces the same.
  const guard = await requireStudioUser();
  const user = guard.ok ? ({ id: guard.viewer.userId, email: guard.viewer.email } as { id: string; email: string | null }) : null;
  return { supabase, user };
}

function bodyTooLarge(body: string): boolean {
  return Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES;
}

function revalidateDocumentPaths(id?: string, bookingId?: string | null) {
  revalidatePath("/documents");
  revalidatePath("/studio");
  if (id) revalidatePath(`/documents/${id}`);
  if (bookingId) revalidatePath(`/bookings/${bookingId}`);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Seeds the starter templates for kinds the owner has none of yet. Idempotent; safe to call on every templates page load. */
export async function ensureDefaultTemplates(): Promise<Result<{ created: number }>> {
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: existing, error } = await supabase.from("photo_document_templates").select("kind");
  if (error) return { ok: false, error: error.message };
  const have = new Set((existing ?? []).map((t) => t.kind));
  const rows = DEFAULT_TEMPLATES.filter((t) => !have.has(t.kind)).map((t) => ({ owner_id: user.id, kind: t.kind, name: t.name, body: t.body, version: 1, active: true }));
  if (!rows.length) return { ok: true, created: 0 };
  const { error: insertError } = await supabase.from("photo_document_templates").insert(rows);
  if (insertError) return { ok: false, error: insertError.message };
  revalidatePath("/documents/templates");
  return { ok: true, created: rows.length };
}

export async function createTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(formData.get("name"));
  const kindRaw = trimOrNull(formData.get("kind"));
  const body = typeof formData.get("body") === "string" ? String(formData.get("body")) : "";
  if (!name) fieldErrors.name = "Give the template a name.";
  else if (name.length > MAX_TITLE) fieldErrors.name = "Keep the name under 160 characters.";
  if (!isDocumentKind(kindRaw)) fieldErrors.kind = "Choose a document kind.";
  if (bodyTooLarge(body)) fieldErrors.body = "The template is too long (40 KB limit).";
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const kind = kindRaw as DocumentKind;
  const starter = DEFAULT_TEMPLATES.find((t) => t.kind === kind)?.body ?? "";
  const { data, error } = await supabase
    .from("photo_document_templates")
    .insert({ owner_id: user.id, kind, name: name!, body: body.trim() || starter, version: 1, active: true })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/documents/templates");
  redirect(`/documents/templates/${data.id}/edit`);
}

/** Saves a template's name and body; every save bumps the version so documents record which text they were made from. */
export async function updateTemplate(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(id)) return { error: "Invalid template id." };
  const { supabase, user } = await owner();
  if (!user) return { error: "You are signed out." };
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(formData.get("name"));
  const body = typeof formData.get("body") === "string" ? String(formData.get("body")).replace(/\r\n?/g, "\n") : "";
  if (!name) fieldErrors.name = "Give the template a name.";
  else if (name.length > MAX_TITLE) fieldErrors.name = "Keep the name under 160 characters.";
  if (!body.trim()) fieldErrors.body = "The template body cannot be empty.";
  else if (bodyTooLarge(body)) fieldErrors.body = "The template is too long (40 KB limit).";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const { data: current } = await supabase.from("photo_document_templates").select("id,version,body,name").eq("id", id).maybeSingle();
  if (!current) return { error: "Template not found or you do not have access to it." };
  const changed = current.body !== body || current.name !== name;
  const { error, count } = await supabase
    .from("photo_document_templates")
    .update({ name: name!, body, version: changed ? current.version + 1 : current.version, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("version", current.version);
  if (error) return { error: error.message };
  if (!count) return { error: "The template changed while you were editing. Reload and try again." };
  revalidatePath("/documents/templates");
  revalidatePath(`/documents/templates/${id}/edit`);
  redirect("/documents/templates");
}

export async function setTemplateActive(id: string, active: boolean): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid template id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { error, count } = await supabase.from("photo_document_templates").update({ active: Boolean(active), updated_at: new Date().toISOString() }, { count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Template not found or you do not have access to it." };
  revalidatePath("/documents/templates");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type CreateDocumentInput = { templateId: string; bookingId?: string | null; clientId?: string | null; organizationId?: string | null; title?: string | null; expiresDays?: number };

function parseExpiryDays(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_DAYS;
  return Math.min(MAX_EXPIRY_DAYS, Math.max(MIN_EXPIRY_DAYS, Math.round(n)));
}

/**
 * Creates a draft from a template: merge fields are filled from the booking,
 * client, organization, service, event and studio rows at this moment, the
 * body is frozen on the document and hashed. The draft can still be edited
 * until it is sent.
 */
export async function createDocument(input: CreateDocumentInput): Promise<Result<{ id: string }>> {
  if (!isUuid(input.templateId)) return { ok: false, error: "Choose a template." };
  if (input.bookingId && !isUuid(input.bookingId)) return { ok: false, error: "Invalid booking id." };
  if (input.clientId && !isUuid(input.clientId)) return { ok: false, error: "Invalid client id." };
  if (input.organizationId && !isUuid(input.organizationId)) return { ok: false, error: "Invalid organization id." };
  const title = input.title?.trim() ?? "";
  if (title.length > MAX_TITLE) return { ok: false, error: "Keep the title under 160 characters." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };

  const { data: template } = await supabase.from("photo_document_templates").select("*").eq("id", input.templateId).maybeSingle();
  if (!template) return { ok: false, error: "Template not found or you do not have access to it." };

  let booking: PhotoBookingRow | null = null;
  if (input.bookingId) {
    const { data } = await supabase.from("photo_bookings").select("*").eq("id", input.bookingId).maybeSingle();
    if (!data) return { ok: false, error: "Booking not found or you do not have access to it." };
    booking = data;
  }
  const clientId = input.clientId ?? booking?.client_id ?? null;
  const organizationId = input.organizationId ?? booking?.organization_id ?? null;
  const [person, organization, service, event, studio] = await Promise.all([
    clientId ? supabase.from("photo_people").select("*").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null }),
    organizationId ? supabase.from("photo_organizations").select("*").eq("id", organizationId).maybeSingle() : Promise.resolve({ data: null }),
    booking?.service_id ? supabase.from("photo_services").select("*").eq("id", booking.service_id).maybeSingle() : Promise.resolve({ data: null }),
    booking?.event_id ? supabase.from("photo_events").select("*").eq("id", booking.event_id).maybeSingle() : Promise.resolve({ data: null }),
    loadStudio(),
  ]);
  if (clientId && !person.data) return { ok: false, error: "Client not found or you do not have access to it." };
  if (organizationId && !organization.data) return { ok: false, error: "Organization not found or you do not have access to it." };

  const now = new Date();
  const values = mergeValuesFor({ booking, person: person.data, organization: organization.data, service: service.data, event: event.data, studio, now });
  const body = renderTemplate(template.body, values);
  const subject = person.data?.full_name ?? booking?.athlete_name ?? organization.data?.name ?? null;
  const finalTitle = title || (subject ? `${DOCUMENT_KIND_LABEL[template.kind]} — ${subject}` : DOCUMENT_KIND_LABEL[template.kind]);
  const expiresDays = parseExpiryDays(input.expiresDays ?? DEFAULT_EXPIRY_DAYS);

  const { data, error } = await supabase
    .from("photo_documents")
    .insert({
      owner_id: user.id,
      template_id: template.id,
      template_version: template.version,
      kind: template.kind,
      title: finalTitle,
      booking_id: booking?.id ?? null,
      client_id: clientId,
      organization_id: organizationId,
      body,
      body_hash: bodyHash(body),
      status: "draft",
      // The planned validity; re-anchored to the send time by sendDocument.
      expires_at: new Date(now.getTime() + expiresDays * DAY_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, actorKind: "owner", entity: "document", entityId: data.id, action: "document.created", data: { kind: template.kind, templateVersion: template.version, bookingId: booking?.id ?? null } });
  revalidateDocumentPaths(data.id, booking?.id);
  return { ok: true, id: data.id };
}

/** Form wrapper for the "New document" page. */
export async function createDocumentForm(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const templateId = trimOrNull(formData.get("template_id")) ?? "";
  const bookingId = trimOrNull(formData.get("booking_id"));
  const clientId = trimOrNull(formData.get("client_id"));
  const title = trimOrNull(formData.get("title"));
  const expiresDays = parseExpiryDays(trimOrNull(formData.get("expires_days")) ?? DEFAULT_EXPIRY_DAYS);
  if (!isUuid(templateId)) return { fieldErrors: { template_id: "Choose a template." } };
  if (bookingId && !isUuid(bookingId)) return { fieldErrors: { booking_id: "Choose a booking from the list." } };
  if (clientId && !isUuid(clientId)) return { fieldErrors: { client_id: "Choose a client from the list." } };
  const res = await createDocument({ templateId, bookingId, clientId, title, expiresDays });
  if (!res.ok) return { error: res.error };
  redirect(`/documents/${res.id}`);
}

/** Edits a draft's body (only drafts: a sent body is frozen so the hash the client saw never changes). */
export async function updateDraftBody(id: string, body: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const text = typeof body === "string" ? body.replace(/\r\n?/g, "\n") : "";
  if (!text.trim()) return { ok: false, error: "The document cannot be empty." };
  if (bodyTooLarge(text)) return { ok: false, error: "The document is too long (40 KB limit)." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { error, count } = await supabase
    .from("photo_documents")
    .update({ body: text, body_hash: bodyHash(text), updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Only drafts can be edited. This document has already been sent." };
  revalidateDocumentPaths(id);
  return { ok: true };
}

async function loadOwnedDocument(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<PhotoDocumentRow | null> {
  const { data } = await supabase.from("photo_documents").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

function signingUrlFor(token: string): string {
  return `${siteUrl()}/sign/${token}`;
}

/**
 * draft → sent. Mints the signing token (hash stored, token returned ONCE),
 * stamps sent_at / expires_at, links the booking and moves it to
 * awaiting_contract when it is still an inquiry or quote, and queues the
 * CONTRACT_READY e-mail with the link. The owner also gets the link to share
 * on WhatsApp themselves.
 */
export async function sendDocument(id: string): Promise<Result<{ signingUrl: string; emailQueued: boolean }>> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (!canTransitionDocument(doc.status, "sent")) return { ok: false, error: `This document is ${doc.status}; only drafts can be sent.` };
  if (!doc.body.trim()) return { ok: false, error: "The document is empty." };

  const now = new Date();
  const plannedDays = doc.expires_at ? Math.round((Date.parse(doc.expires_at) - Date.parse(doc.created_at)) / DAY_MS) : DEFAULT_EXPIRY_DAYS;
  const days = parseExpiryDays(plannedDays);
  const { token, hash } = createSigningToken();
  const { error, count } = await supabase
    .from("photo_documents")
    .update({ status: "sent", access_token_hash: hash, body_hash: bodyHash(doc.body), sent_at: now.toISOString(), expires_at: new Date(now.getTime() + days * DAY_MS).toISOString(), updated_at: now.toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "This document was already sent." };

  let booking: PhotoBookingRow | null = null;
  if (doc.booking_id) {
    const { data } = await supabase.from("photo_bookings").select("*").eq("id", doc.booking_id).maybeSingle();
    booking = data ?? null;
    if (booking) {
      const patch: Partial<PhotoBookingRow> = { contract_document_id: doc.id };
      if ((booking.booking_status === "inquiry" || booking.booking_status === "quoted") && canTransitionBooking(booking.booking_status, "awaiting_contract")) {
        Object.assign(patch, bookingTransitionColumns(booking, "awaiting_contract", now));
      }
      await supabase.from("photo_bookings").update(patch).eq("id", booking.id).eq("booking_status", booking.booking_status);
    }
  }

  const signingUrl = signingUrlFor(token);
  const [studio, person] = await Promise.all([loadStudio(), doc.client_id ? supabase.from("photo_people").select("id,full_name,email").eq("id", doc.client_id).maybeSingle() : Promise.resolve({ data: null })]);
  const businessName = studio?.business_name ?? "Blue Belt Media";
  const to = person.data?.email ?? booking?.customer_email ?? null;
  let emailQueued = false;
  if (to) {
    const greeting = `Hello ${person.data?.full_name ?? booking?.customer_name ?? "there"},`;
    const facts: Array<[string, string]> = [["Document", doc.title]];
    if (booking?.public_ref) facts.push(["Booking", booking.public_ref]);
    facts.push(["Link valid until", new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", day: "numeric", month: "long", year: "numeric" }).format(new Date(now.getTime() + days * DAY_MS))]);
    const draft = buildEmail(to, {
      kind: "CONTRACT_READY",
      subject: `${businessName}: please review and sign "${doc.title}"`,
      greeting,
      paragraphs: [`Your agreement with ${businessName} is ready. Open the link below, read it through and sign by typing your name. It takes about two minutes on a phone.`, "If anything looks wrong, reply to this e-mail before signing."],
      cta: { label: "Review and sign", url: signingUrl },
      facts,
      businessName,
    });
    const queued = await enqueueClientEmail(supabase, { ownerId: user.id, kind: "CONTRACT_READY", alertKey: `email:document:${doc.id}:ready`, draft, personId: person.data?.id ?? null, bookingId: doc.booking_id, now });
    emailQueued = queued.ok && queued.queued;
  }
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, actorKind: "owner", entity: "document", entityId: doc.id, action: "document.sent", data: { bookingId: doc.booking_id, emailQueued, expiresDays: days } });
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true, signingUrl, emailQueued };
}

/** New token for a sent/viewed document (the old link stops working). Returned once; nothing is e-mailed. */
export async function regenerateSigningLink(id: string): Promise<Result<{ signingUrl: string }>> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (doc.status !== "sent" && doc.status !== "viewed") return { ok: false, error: "Only a document that is waiting for a signature can get a new link." };
  const { token, hash } = createSigningToken();
  const now = new Date();
  const { error, count } = await supabase.from("photo_documents").update({ access_token_hash: hash, updated_at: now.toISOString() }, { count: "exact" }).eq("id", id).in("status", ["sent", "viewed"]);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "The document changed state; reload the page." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, actorKind: "owner", entity: "document", entityId: doc.id, action: "document.link_regenerated" });
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true, signingUrl: signingUrlFor(token) };
}

/** Withdraws a sent/viewed document: the link shows "expired" and nothing can be signed. Re-issue as a new document. */
export async function voidDocument(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (!canTransitionDocument(doc.status, "expired")) return { ok: false, error: `A ${doc.status} document cannot be voided.` };
  const now = new Date();
  const { error, count } = await supabase.from("photo_documents").update({ status: "expired", expires_at: now.toISOString(), updated_at: now.toISOString() }, { count: "exact" }).eq("id", id).in("status", ["sent", "viewed"]);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "The document changed state; reload the page." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, actorKind: "owner", entity: "document", entityId: doc.id, action: "document.voided" });
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true };
}

export async function deleteDraft(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { error, count } = await supabase.from("photo_documents").delete({ count: "exact" }).eq("id", id).eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Only drafts can be deleted. Void a sent document instead." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, actorKind: "owner", entity: "document", entityId: id, action: "document.draft_deleted" });
  revalidateDocumentPaths();
  return { ok: true };
}

/** Form wrapper so the delete can redirect to the list. */
export async function deleteDraftAndGoBack(id: string): Promise<Result> {
  const res = await deleteDraft(id);
  if (!res.ok) return res;
  redirect("/documents");
}
