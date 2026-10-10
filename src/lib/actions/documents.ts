"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { agreementKindForBookingType, guardianOf, needsGuardianRelease, type GuardianContact } from "@/lib/documents/contract-state";
import { applyProviderEvent, signerContactFor, syncBookingContractState, type SignerContact } from "@/lib/documents/events";
import { bodyHash } from "@/lib/documents/hash";
import { mergeValuesFor } from "@/lib/documents/merge";
import { canTransitionDocument, DOCUMENT_KIND_LABEL, isDocumentKind, isSignerRole, renderTemplate } from "@/lib/documents/state";
import { DEFAULT_TEMPLATES } from "@/lib/documents/templates";
import { createSigningToken } from "@/lib/documents/tokens";
import { getEsignProvider } from "@/lib/esign";
import { esignStatus } from "@/lib/esign/config";
import { MOCK_LABEL, mockAdvanceEvent } from "@/lib/esign/mock";
import { isEsignProviderName, type EsignEventType } from "@/lib/esign/types";
import { buildEmail } from "@/lib/notifications/email/templates";
import { enqueueClientEmail } from "@/lib/notifications/email/outbox";
import { loadStudio, siteUrl } from "@/lib/studio/queries";
import { requireStudioUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { AuditActorKind, DocumentKind, PhotoBookingRow, PhotoDocumentRow, PhotoDocumentTemplateRow, SignerRole } from "@/lib/supabase/database.types";
import { trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import type { ActionState } from "./types";

/** Templates are plain text; 40 KB is far beyond any real contract and keeps the editor and PDF fast. */
const MAX_BODY_BYTES = 40 * 1024;
const MAX_TITLE = 160;
const MAX_REASON = 500;
const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 90;
const DEFAULT_EXPIRY_DAYS = 14;
const DAY_MS = 86_400_000;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type StudioActor = { id: string; email: string | null; kind: AuditActorKind };

async function owner() {
  const supabase = await createClient();
  // Studio team only: a client-portal account gets `user: null` here, which every
  // caller turns into a clear error. RLS (photo_is_studio_user) enforces the same.
  const guard = await requireStudioUser();
  const user: StudioActor | null = guard.ok ? { id: guard.viewer.userId, email: guard.viewer.email, kind: guard.viewer.role === "staff" ? "staff" : "owner" } : null;
  return { supabase, user };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

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

/** Inserts the starter template for every kind the owner has none of. One row per insert so a partial failure leaves the rest in place. */
async function seedMissingTemplates(supabase: Supabase, ownerId: string): Promise<Result<{ created: number }>> {
  const { data: existing, error } = await supabase.from("photo_document_templates").select("kind");
  if (error) return { ok: false, error: error.message };
  const have = new Set((existing ?? []).map((t) => t.kind));
  let created = 0;
  for (const t of DEFAULT_TEMPLATES) {
    if (have.has(t.kind)) continue;
    const { error: insertError } = await supabase.from("photo_document_templates").insert({ owner_id: ownerId, kind: t.kind, name: t.name, body: t.body, version: 1, active: true });
    if (insertError) return { ok: false, error: insertError.message };
    created += 1;
  }
  return { ok: true, created };
}

/**
 * Seeds the starter templates for kinds the owner has none of yet (so a new
 * kind such as the guardian release appears for existing owners without
 * duplicating the others). Idempotent; safe to call on every templates page load.
 */
export async function ensureDefaultTemplates(): Promise<Result<{ created: number }>> {
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  // No revalidatePath here: this runs while the Templates and New document
  // pages render (both force-dynamic and re-read after seeding), and Next.js
  // rejects revalidation during a render.
  return seedMissingTemplates(supabase, user.id);
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

export type CreateDocumentInput = { templateId: string; bookingId?: string | null; clientId?: string | null; organizationId?: string | null; title?: string | null; expiresDays?: number; signerRole?: SignerRole; requiredForConfirmation?: boolean };

function parseExpiryDays(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_DAYS;
  return Math.min(MAX_EXPIRY_DAYS, Math.max(MIN_EXPIRY_DAYS, Math.round(n)));
}

type Parties = {
  booking: PhotoBookingRow | null;
  person: { id: string; full_name: string; email: string | null; phone: string | null } | null;
  organization: { id: string; name: string } | null;
  service: { name: string; price_qr: number | null; deposit_qr: number | null } | null;
  event: { name: string; event_date: string | null; venue: string | null } | null;
  studio: { business_name: string } | null;
  guardian: GuardianContact | null;
};

async function loadParties(supabase: Supabase, input: { booking: PhotoBookingRow | null; clientId: string | null; organizationId: string | null }): Promise<Result<Parties>> {
  const { booking, clientId, organizationId } = input;
  const [person, organization, service, event, studio] = await Promise.all([
    clientId ? supabase.from("photo_people").select("id,full_name,email,phone").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null }),
    organizationId ? supabase.from("photo_organizations").select("id,name").eq("id", organizationId).maybeSingle() : Promise.resolve({ data: null }),
    booking?.service_id ? supabase.from("photo_services").select("name,price_qr,deposit_qr").eq("id", booking.service_id).maybeSingle() : Promise.resolve({ data: null }),
    booking?.event_id ? supabase.from("photo_events").select("name,event_date,venue").eq("id", booking.event_id).maybeSingle() : Promise.resolve({ data: null }),
    loadStudio(),
  ]);
  if (clientId && !person.data) return { ok: false, error: "Client not found or you do not have access to it." };
  if (organizationId && !organization.data) return { ok: false, error: "Organization not found or you do not have access to it." };
  return { ok: true, booking, person: person.data ?? null, organization: organization.data ?? null, service: service.data ?? null, event: event.data ?? null, studio: studio ? { business_name: studio.business_name } : null, guardian: booking ? guardianOf(booking) : null };
}

type InsertOptions = { title: string | null; expiresDays: number; signerRole: SignerRole; requiredForConfirmation: boolean };

/**
 * Creates a draft from a template: merge fields are filled from the booking,
 * client, organization, service, event, studio and guardian rows at this
 * moment, the body is frozen on the document and hashed. The draft can still
 * be edited until it is sent. A guardian document is addressed to the parent
 * or guardian; the athlete is never its signer.
 */
async function insertDocumentFromTemplate(supabase: Supabase, user: StudioActor, template: PhotoDocumentTemplateRow, parties: Parties, opts: InsertOptions, now: Date): Promise<Result<{ id: string }>> {
  const { booking, person, organization } = parties;
  const values = mergeValuesFor({ booking, person, organization, service: parties.service, event: parties.event, studio: parties.studio, guardian: parties.guardian, now });
  const body = renderTemplate(template.body, values);
  const kindLabel = DOCUMENT_KIND_LABEL[template.kind];
  const subject = opts.signerRole === "guardian" ? booking?.athlete_name ?? person?.full_name ?? null : person?.full_name ?? booking?.athlete_name ?? organization?.name ?? null;
  const finalTitle = opts.title?.trim() || (subject ? `${kindLabel}: ${subject}` : kindLabel);
  const { data, error } = await supabase
    .from("photo_documents")
    .insert({
      owner_id: user.id,
      template_id: template.id,
      template_version: template.version,
      kind: template.kind,
      title: finalTitle.slice(0, MAX_TITLE),
      booking_id: booking?.id ?? null,
      client_id: person?.id ?? null,
      organization_id: organization?.id ?? null,
      body,
      body_hash: bodyHash(body),
      status: "draft",
      provider: "internal",
      signer_role: opts.signerRole,
      required_for_confirmation: opts.requiredForConfirmation,
      document_version: `${template.kind}@${template.version}`,
      // The planned validity; re-anchored to the send time by sendDocument.
      expires_at: new Date(now.getTime() + opts.expiresDays * DAY_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await writeAudit(supabase, {
    ownerId: user.id,
    actorId: user.id,
    actorKind: user.kind,
    entity: "document",
    entityId: data.id,
    action: "contract.created",
    data: { kind: template.kind, templateVersion: template.version, bookingId: booking?.id ?? null, signerRole: opts.signerRole, requiredForConfirmation: opts.requiredForConfirmation },
  });
  return { ok: true, id: data.id };
}

export async function createDocument(input: CreateDocumentInput): Promise<Result<{ id: string }>> {
  if (!isUuid(input.templateId)) return { ok: false, error: "Choose a template." };
  if (input.bookingId && !isUuid(input.bookingId)) return { ok: false, error: "Invalid booking id." };
  if (input.clientId && !isUuid(input.clientId)) return { ok: false, error: "Invalid client id." };
  if (input.organizationId && !isUuid(input.organizationId)) return { ok: false, error: "Invalid organization id." };
  const title = input.title?.trim() ?? "";
  if (title.length > MAX_TITLE) return { ok: false, error: "Keep the title under 160 characters." };
  if (input.signerRole !== undefined && !isSignerRole(input.signerRole)) return { ok: false, error: "Choose who signs." };
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
  const parties = await loadParties(supabase, { booking, clientId: input.clientId ?? booking?.client_id ?? null, organizationId: input.organizationId ?? booking?.organization_id ?? null });
  if (!parties.ok) return parties;
  const signerRole: SignerRole = input.signerRole ?? (template.kind === "guardian_release" ? "guardian" : "client");
  const requiredForConfirmation = input.requiredForConfirmation ?? (template.kind !== "print_release" && template.kind !== "model_release");
  const res = await insertDocumentFromTemplate(supabase, user, template, parties, { title: title || null, expiresDays: parseExpiryDays(input.expiresDays ?? DEFAULT_EXPIRY_DAYS), signerRole, requiredForConfirmation }, new Date());
  if (!res.ok) return res;
  revalidateDocumentPaths(res.id, booking?.id);
  return res;
}

/** Form wrapper for the "New document" page. */
export async function createDocumentForm(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const templateId = trimOrNull(formData.get("template_id")) ?? "";
  const bookingId = trimOrNull(formData.get("booking_id"));
  const clientId = trimOrNull(formData.get("client_id"));
  const title = trimOrNull(formData.get("title"));
  const signerRoleRaw = trimOrNull(formData.get("signer_role"));
  const required = formData.get("required_for_confirmation");
  const expiresDays = parseExpiryDays(trimOrNull(formData.get("expires_days")) ?? DEFAULT_EXPIRY_DAYS);
  if (!isUuid(templateId)) return { fieldErrors: { template_id: "Choose a template." } };
  if (bookingId && !isUuid(bookingId)) return { fieldErrors: { booking_id: "Choose a booking from the list." } };
  if (clientId && !isUuid(clientId)) return { fieldErrors: { client_id: "Choose a client from the list." } };
  if (signerRoleRaw && !isSignerRole(signerRoleRaw)) return { fieldErrors: { signer_role: "Choose who signs." } };
  const res = await createDocument({ templateId, bookingId, clientId, title, expiresDays, signerRole: signerRoleRaw ? (signerRoleRaw as SignerRole) : undefined, requiredForConfirmation: required === null ? undefined : required === "on" || required === "1" });
  if (!res.ok) return { error: res.error };
  redirect(`/documents/${res.id}`);
}

export type PreparedContract = { id: string; kind: DocumentKind; signerRole: SignerRole };

/**
 * Creates the right draft(s) for a booking from its type: event agreement
 * for tournament athletes and clubs, session agreement for private sessions,
 * services agreement otherwise. When the athlete is a minor, ALSO a guardian
 * release addressed to the parent or guardian on the booking. Idempotent:
 * a role that already has a live document (draft, sent, viewed or signed) is
 * skipped, so pressing the button twice never doubles anything.
 */
export async function prepareBookingContracts(bookingId: string): Promise<Result<{ created: PreparedContract[]; skipped: SignerRole[]; warnings: string[] }>> {
  if (!isUuid(bookingId)) return { ok: false, error: "Invalid booking id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: booking } = await supabase.from("photo_bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!booking) return { ok: false, error: "Booking not found or you do not have access to it." };
  if (booking.booking_status === "cancelled") return { ok: false, error: "This booking is cancelled." };

  const { data: existingRows } = await supabase.from("photo_documents").select("id,status,signer_role,required_for_confirmation,kind").eq("booking_id", bookingId);
  const existing = existingRows ?? [];
  const live = (role: SignerRole) => existing.some((d) => d.signer_role === role && d.required_for_confirmation && (d.status === "draft" || d.status === "sent" || d.status === "viewed" || d.status === "signed"));

  const plan: Array<{ kind: DocumentKind; signerRole: SignerRole }> = [{ kind: agreementKindForBookingType(booking.booking_type), signerRole: "client" }];
  const minor = needsGuardianRelease(booking);
  if (minor) plan.push({ kind: "guardian_release", signerRole: "guardian" });

  const parties = await loadParties(supabase, { booking, clientId: booking.client_id, organizationId: booking.organization_id });
  if (!parties.ok) return parties;
  const warnings: string[] = [];
  if (minor && !parties.guardian?.name) warnings.push("No parent or guardian is recorded on this booking. Add their name and e-mail before sending the guardian release.");

  const now = new Date();
  const created: PreparedContract[] = [];
  const skipped: SignerRole[] = [];
  let seeded = false;
  for (const step of plan) {
    if (live(step.signerRole)) {
      skipped.push(step.signerRole);
      continue;
    }
    let template = await activeTemplateOfKind(supabase, step.kind);
    if (!template && !seeded) {
      seeded = true;
      const seed = await seedMissingTemplates(supabase, user.id);
      if (!seed.ok) return seed;
      template = await activeTemplateOfKind(supabase, step.kind);
    }
    if (!template) return { ok: false, error: `No active "${DOCUMENT_KIND_LABEL[step.kind]}" template. Switch one on under Templates first.` };
    const res = await insertDocumentFromTemplate(supabase, user, template, parties, { title: null, expiresDays: DEFAULT_EXPIRY_DAYS, signerRole: step.signerRole, requiredForConfirmation: true }, now);
    if (!res.ok) return res;
    created.push({ id: res.id, kind: step.kind, signerRole: step.signerRole });
  }
  if (created.length) await syncBookingContractState(supabase, bookingId, now);
  revalidateDocumentPaths(undefined, bookingId);
  for (const c of created) revalidatePath(`/documents/${c.id}`);
  return { ok: true, created, skipped, warnings };
}

async function activeTemplateOfKind(supabase: Supabase, kind: DocumentKind): Promise<PhotoDocumentTemplateRow | null> {
  const { data } = await supabase.from("photo_document_templates").select("*").eq("kind", kind).eq("active", true).order("version", { ascending: false }).limit(1);
  return data?.[0] ?? null;
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

async function loadOwnedDocument(supabase: Supabase, id: string): Promise<PhotoDocumentRow | null> {
  const { data } = await supabase.from("photo_documents").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/** The "please sign" e-mail; the guardian variant says who they are signing for. */
async function queueSigningEmail(supabase: Supabase, user: StudioActor, doc: PhotoDocumentRow, contact: SignerContact, signingUrl: string, validUntil: Date, alertKey: string, now: Date): Promise<boolean> {
  if (!contact.email) return false;
  const [studio, bookingRow] = await Promise.all([loadStudio(), doc.booking_id ? supabase.from("photo_bookings").select("public_ref").eq("id", doc.booking_id).maybeSingle() : Promise.resolve({ data: null })]);
  const businessName = studio?.business_name ?? "Blue Belt Media";
  const facts: Array<[string, string]> = [["Document", doc.title]];
  if (bookingRow.data?.public_ref) facts.push(["Booking", bookingRow.data.public_ref]);
  facts.push(["Link valid until", new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", day: "numeric", month: "long", year: "numeric" }).format(validUntil)]);
  const guardian = doc.signer_role === "guardian";
  const paragraphs = guardian
    ? [`You are signing as the parent or guardian of ${contact.athleteName ?? "the athlete"}. Open the link below, read the release and sign by typing your name. It takes about two minutes on a phone.`, "If anything looks wrong, reply to this e-mail before signing."]
    : [`Your agreement with ${businessName} is ready. Open the link below, read it through and sign by typing your name. It takes about two minutes on a phone.`, "If anything looks wrong, reply to this e-mail before signing."];
  const draft = buildEmail(contact.email, {
    kind: "CONTRACT_READY",
    subject: `${businessName}: please review and sign "${doc.title}"`,
    greeting: `Hello ${contact.name ?? "there"},`,
    paragraphs,
    cta: { label: "Review and sign", url: signingUrl },
    facts,
    businessName,
  });
  const queued = await enqueueClientEmail(supabase, { ownerId: user.id, kind: "CONTRACT_READY", alertKey, draft, personId: doc.signer_role === "client" ? doc.client_id : null, bookingId: doc.booking_id, now });
  return queued.ok && queued.queued;
}

export type SendDocumentResult = Result<{ signingUrl: string | null; emailQueued: boolean; provider: string }>;

/**
 * draft → sent through the configured e-signature provider. Internal: mints
 * the signing token (hash stored, link returned ONCE) and queues the
 * CONTRACT_READY e-mail. Mock: fake envelope, nothing sent. DocuSign: the
 * provider e-mails the signer; we store the envelope id. In every case the
 * booking's contract_state becomes `sent` and the gates are recomputed.
 */
export async function sendDocument(id: string): Promise<SendDocumentResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (!canTransitionDocument(doc.status, "sent")) return { ok: false, error: `This document is ${doc.status}; only drafts can be sent.` };
  if (!doc.body.trim()) return { ok: false, error: "The document is empty." };

  const provider = getEsignProvider();
  if (!provider.isConfigured()) {
    const missing = esignStatus().missing.join(", ");
    await supabase.from("photo_documents").update({ provider: provider.name, provider_error: `Not configured: ${missing}` }).eq("id", id);
    return { ok: false, error: `The ${provider.name} e-signature provider is not configured (${missing}).` };
  }
  const contact = await signerContactFor(supabase, doc);
  if (doc.signer_role === "guardian" && !contact.guardianName) return { ok: false, error: "Add the parent or guardian's name to the booking before sending the guardian release." };

  const now = new Date();
  const plannedDays = doc.expires_at ? Math.round((Date.parse(doc.expires_at) - Date.parse(doc.created_at)) / DAY_MS) : DEFAULT_EXPIRY_DAYS;
  const days = parseExpiryDays(plannedDays);
  const validUntil = new Date(now.getTime() + days * DAY_MS);
  const envelope = await provider.createEnvelope({ document: doc, signer: { name: contact.name, email: contact.email, phone: contact.phone, role: doc.signer_role }, returnUrl: `${siteUrl()}/client` });
  if (!envelope.ok) {
    await supabase.from("photo_documents").update({ provider: provider.name, provider_error: envelope.message.slice(0, 500), updated_at: now.toISOString() }).eq("id", id);
    return { ok: false, error: envelope.message };
  }
  const applied = await applyProviderEvent(
    supabase,
    {
      doc,
      event: { type: "sent", occurredAt: now.toISOString(), envelopeId: envelope.envelopeId },
      actor: { kind: user.kind, id: user.id },
      columns: {
        provider: provider.name,
        provider_envelope_id: envelope.envelopeId,
        provider_error: null,
        access_token_hash: envelope.accessTokenHash ?? null,
        body_hash: bodyHash(doc.body),
        expires_at: validUntil.toISOString(),
        document_version: doc.document_version ?? (doc.template_version !== null ? `${doc.kind}@${doc.template_version}` : null),
      },
    },
    now,
  );
  if (!applied.ok) return { ok: false, error: applied.error };
  if (!applied.applied) return { ok: false, error: "This document was already sent." };

  let emailQueued = false;
  if (envelope.signingUrl) emailQueued = await queueSigningEmail(supabase, user, { ...doc, status: "sent" }, contact, envelope.signingUrl, validUntil, `email:document:${doc.id}:ready`, now);
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true, signingUrl: envelope.signingUrl ?? null, emailQueued, provider: provider.name };
}

/**
 * Internal provider: a fresh signing link (the old one stops working) and
 * the "please sign" e-mail again. Other providers resend from their own
 * dashboard, so this refuses rather than pretending.
 */
export async function resendDocument(id: string): Promise<SendDocumentResult> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (doc.status !== "sent" && doc.status !== "viewed") return { ok: false, error: "Only a document that is waiting for a signature can be resent." };
  if (doc.provider === "mock") return { ok: false, error: "Test envelopes are never sent. Use the test buttons instead." };
  if (doc.provider !== "internal") return { ok: false, error: `Resend this envelope from the ${doc.provider} dashboard.` };
  const now = new Date();
  const { token, hash } = createSigningToken();
  const validUntil = doc.expires_at && Date.parse(doc.expires_at) > now.getTime() ? new Date(doc.expires_at) : new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * DAY_MS);
  const { data: updated, error } = await supabase.from("photo_documents").update({ access_token_hash: hash, expires_at: validUntil.toISOString(), updated_at: now.toISOString() }).eq("id", id).in("status", ["sent", "viewed"]).select("id");
  if (error) return { ok: false, error: error.message };
  if (!(updated ?? []).length) return { ok: false, error: "The document changed state; reload the page." };
  const contact = await signerContactFor(supabase, doc);
  const signingUrl = `${siteUrl()}/sign/${token}`;
  const emailQueued = await queueSigningEmail(supabase, user, doc, contact, signingUrl, validUntil, `email:document:${doc.id}:resend:${now.getTime()}`, now);
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, actorKind: user.kind, entity: "document", entityId: doc.id, action: "contract.resent", data: { bookingId: doc.booking_id, emailQueued } });
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true, signingUrl, emailQueued, provider: doc.provider };
}

/** New token for a sent/viewed internal document (the old link stops working). Returned once; nothing is e-mailed. */
export async function regenerateSigningLink(id: string): Promise<Result<{ signingUrl: string }>> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (doc.status !== "sent" && doc.status !== "viewed") return { ok: false, error: "Only a document that is waiting for a signature can get a new link." };
  if (doc.provider !== "internal") return { ok: false, error: doc.provider === "mock" ? "Test envelopes have no signing link." : `The signing link for this envelope is managed by ${doc.provider}.` };
  const { token, hash } = createSigningToken();
  const now = new Date();
  const { data: updated, error } = await supabase.from("photo_documents").update({ access_token_hash: hash, updated_at: now.toISOString() }).eq("id", id).in("status", ["sent", "viewed"]).select("id");
  if (error) return { ok: false, error: error.message };
  if (!(updated ?? []).length) return { ok: false, error: "The document changed state; reload the page." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, actorKind: user.kind, entity: "document", entityId: doc.id, action: "contract.link_regenerated" });
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true, signingUrl: `${siteUrl()}/sign/${token}` };
}

/**
 * Withdraws a draft, sent or viewed document with a reason: the link stops
 * working, the provider's envelope is voided where one exists, and the
 * booking falls back to "required" when nothing signed remains. Re-issue as
 * a new document.
 */
export async function voidDocument(id: string, reason?: string | null): Promise<Result<{ contractState: string | null }>> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const text = (reason ?? "").trim().slice(0, MAX_REASON);
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (!canTransitionDocument(doc.status, "void")) return { ok: false, error: `A ${doc.status} document cannot be voided.` };
  const now = new Date();
  const columns: Partial<PhotoDocumentRow> = {};
  if (doc.status !== "draft" && doc.provider !== "internal" && doc.provider_envelope_id && isEsignProviderName(doc.provider)) {
    const res = await getEsignProvider(doc.provider).voidEnvelope(doc.provider_envelope_id, text || "Voided by the studio");
    // A provider that cannot be reached must not keep a document alive here; the error is shown to the admin.
    if (!res.ok) columns.provider_error = res.message.slice(0, 500);
  }
  const applied = await applyProviderEvent(supabase, { doc, event: { type: "voided", occurredAt: now.toISOString(), envelopeId: doc.provider_envelope_id ?? undefined }, actor: { kind: user.kind, id: user.id }, reason: text || null, columns }, now);
  if (!applied.ok) return { ok: false, error: applied.error };
  if (!applied.applied) return { ok: false, error: "The document changed state; reload the page." };
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true, contractState: applied.booking?.state ?? null };
}

const STATUS_TO_EVENT: Record<string, EsignEventType | null> = { created: null, sent: "sent", viewed: "viewed", signed: "signed", declined: "declined", voided: "voided", expired: "expired" };

/** Asks the provider for the envelope's status and applies any change through the same path as a webhook. */
export async function refreshDocumentStatus(id: string): Promise<Result<{ status: string; providerStatus: string | null; changed: boolean }>> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (doc.provider === "internal" || !doc.provider_envelope_id) return { ok: true, status: doc.status, providerStatus: doc.provider_status, changed: false };
  if (!isEsignProviderName(doc.provider)) return { ok: false, error: `Unknown provider "${doc.provider}".` };
  const now = new Date();
  const res = await getEsignProvider(doc.provider).getStatus(doc.provider_envelope_id);
  if (!res.ok) {
    await supabase.from("photo_documents").update({ provider_error: res.message.slice(0, 500), updated_at: now.toISOString() }).eq("id", id);
    return { ok: false, error: res.message };
  }
  const type = STATUS_TO_EVENT[res.status] ?? null;
  if (!type) {
    await supabase.from("photo_documents").update({ provider_status: res.providerStatus, provider_error: null, updated_at: now.toISOString() }).eq("id", id);
    revalidateDocumentPaths(doc.id, doc.booking_id);
    return { ok: true, status: doc.status, providerStatus: res.providerStatus, changed: false };
  }
  const applied = await applyProviderEvent(
    supabase,
    {
      doc,
      event: { type, occurredAt: now.toISOString(), envelopeId: res.envelopeId, eventId: `refresh:${res.envelopeId}:${type}:${now.getTime()}`, completedDocumentRef: res.completedDocumentRef ?? null, certificateRef: res.certificateRef ?? null },
      actor: { kind: user.kind, id: user.id },
      columns: { provider_error: null },
    },
    now,
  );
  if (!applied.ok) return { ok: false, error: applied.error };
  if (!applied.applied) await supabase.from("photo_documents").update({ provider_status: res.providerStatus, provider_error: null, updated_at: now.toISOString() }).eq("id", id);
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true, status: applied.applied ? applied.status : doc.status, providerStatus: res.providerStatus, changed: applied.applied };
}

export type MockAdvance = "viewed" | "signed" | "declined";

/** Development only (ESIGN_PROVIDER=mock): moves a test envelope on as if the provider had reported it. Never a real signature. */
export async function advanceMockEnvelope(id: string, to: MockAdvance): Promise<Result<{ status: string; contractState: string | null }>> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  if (to !== "viewed" && to !== "signed" && to !== "declined") return { ok: false, error: "Unknown test step." };
  if (!esignStatus().mock) return { ok: false, error: "Test signing is off. Set ESIGN_PROVIDER=mock on a non-production deployment." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const doc = await loadOwnedDocument(supabase, id);
  if (!doc) return { ok: false, error: "Document not found or you do not have access to it." };
  if (doc.provider !== "mock" || !doc.provider_envelope_id) return { ok: false, error: "This document was not sent through the test provider." };
  const now = new Date();
  const event = mockAdvanceEvent(doc.provider_envelope_id, to, now);
  const contact = to === "signed" ? await signerContactFor(supabase, doc) : null;
  const applied = await applyProviderEvent(
    supabase,
    {
      doc,
      event,
      actor: { kind: user.kind, id: user.id },
      signer: to === "signed" ? { name: contact?.name ?? "Test signer", email: contact?.email ?? null, phone: contact?.phone ?? null, evidence: { method: "mock", note: MOCK_LABEL, envelope_id: doc.provider_envelope_id, advanced_by: user.id, signed_at: now.toISOString() } } : null,
      reason: to === "declined" ? "Declined from the test buttons" : null,
    },
    now,
  );
  if (!applied.ok) return { ok: false, error: applied.error };
  if (!applied.applied) return { ok: false, error: `The document is already ${applied.status}.` };
  revalidateDocumentPaths(doc.id, doc.booking_id);
  return { ok: true, status: applied.status, contractState: applied.booking?.state ?? null };
}

export async function deleteDraft(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await owner();
  if (!user) return { ok: false, error: "You are signed out." };
  const { data: doc } = await supabase.from("photo_documents").select("id,booking_id,status").eq("id", id).maybeSingle();
  const { error, count } = await supabase.from("photo_documents").delete({ count: "exact" }).eq("id", id).eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Only drafts can be deleted. Void a sent document instead." };
  await writeAudit(supabase, { ownerId: user.id, actorId: user.id, actorKind: user.kind, entity: "document", entityId: id, action: "document.draft_deleted" });
  revalidateDocumentPaths(undefined, doc?.booking_id ?? null);
  return { ok: true };
}

/** Form wrapper so the delete can redirect to the list. */
export async function deleteDraftAndGoBack(id: string): Promise<Result> {
  const res = await deleteDraft(id);
  if (!res.ok) return res;
  redirect("/documents");
}
