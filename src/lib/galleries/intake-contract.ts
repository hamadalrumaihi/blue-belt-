import { isPlainObject } from "@/lib/validation";

/**
 * Pic-Time gallery events forwarded by a Zap ("Pic-Time → Main Client
 * Gallery Invite Sent" / "New Gallery Visitor" / "New Gallery" triggers →
 * "Webhooks by Zapier: POST JSON") to POST /api/galleries/intake with the
 * same bbmo_ orders-intake credential. PROPOSED shape (no real payload was
 * available while building): nested form first, flat Zapier-style aliases
 * accepted. Nothing here proves anything about money or identity: an event
 * only moves a gallery along, it never e-mails a client.
 */
export type GalleryEventKind = "gallery_invite_sent" | "gallery_visitor" | "gallery_created";

export const GALLERY_EVENT_KINDS: readonly GalleryEventKind[] = ["gallery_invite_sent", "gallery_visitor", "gallery_created"];

export type GalleryEvent = {
  event: GalleryEventKind;
  gallery: { name: string; id: string | null; url: string | null };
  client: { email: string | null; name: string | null } | null;
  visitor: { email: string | null; name: string | null; at: string | null } | null;
  occurredAt: string | null;
};

export type GalleryEventParse = { ok: true; event: GalleryEvent } | { ok: false; code: "INVALID_EVENT"; error: string };

const MAX_TEXT = 200;
const MAX_URL = 2048;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function emailOf(v: unknown): string | null {
  const s = str(v, 254);
  return s && EMAIL_RE.test(s) ? s.toLowerCase() : null;
}

function isoOf(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Maps Pic-Time / Zapier wording onto our three kinds. */
export function galleryEventKindOf(v: unknown): GalleryEventKind | null {
  const s = (str(v) ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return null;
  if ((GALLERY_EVENT_KINDS as readonly string[]).includes(s)) return s as GalleryEventKind;
  if (/invite|invitation|sent/.test(s)) return "gallery_invite_sent";
  if (/visit|view|open/.test(s)) return "gallery_visitor";
  if (/creat|new_gallery|new_project|publish/.test(s)) return "gallery_created";
  return null;
}

/** Validates and normalises one gallery event body. Never throws. */
export function parseGalleryEvent(body: unknown): GalleryEventParse {
  if (!isPlainObject(body)) return { ok: false, code: "INVALID_EVENT", error: "Body must be a JSON object." };
  const event = galleryEventKindOf(body.event ?? body.eventType ?? body.type ?? body.trigger);
  if (!event) return { ok: false, code: "INVALID_EVENT", error: "event must be one of gallery_invite_sent, gallery_visitor, gallery_created." };

  const galleryRaw = isPlainObject(body.gallery) ? body.gallery : {};
  const name = str(galleryRaw.name ?? body.galleryName ?? body.projectName ?? body.gallery_name ?? body.project_name);
  if (!name) return { ok: false, code: "INVALID_EVENT", error: "gallery.name (the Pic-Time project name) is required." };
  const id = str(galleryRaw.id ?? galleryRaw.projectId ?? body.galleryId ?? body.projectId ?? body.gallery_id ?? body.project_id, 80);
  const urlRaw = str(galleryRaw.url ?? body.galleryUrl ?? body.link ?? body.gallery_url ?? body.url, MAX_URL);
  // The URL is kept verbatim here; the route checks it against the gallery
  // host policy before storing it (never trust a link from a webhook blindly).
  const url = urlRaw && /^https:\/\//i.test(urlRaw) ? urlRaw : null;

  const clientRaw = isPlainObject(body.client) ? body.client : {};
  const clientEmail = emailOf(clientRaw.email ?? body.clientEmail ?? body.client_email);
  const clientName = str(clientRaw.name ?? body.clientName ?? body.client_name);
  const client = clientEmail || clientName ? { email: clientEmail, name: clientName } : null;

  const visitorRaw = isPlainObject(body.visitor) ? body.visitor : {};
  const visitorEmail = emailOf(visitorRaw.email ?? body.visitorEmail ?? body.visitor_email);
  const visitorName = str(visitorRaw.name ?? body.visitorName ?? body.visitor_name);
  const visitorAt = isoOf(visitorRaw.at ?? visitorRaw.visitedAt ?? body.visitedAt ?? body.visited_at);
  const visitor = visitorEmail || visitorName || visitorAt ? { email: visitorEmail, name: visitorName, at: visitorAt } : null;

  const occurredAt = isoOf(body.occurredAt ?? body.occurred_at ?? body.timestamp ?? body.createdAt ?? body.created_at) ?? visitorAt;

  return { ok: true, event: { event, gallery: { name, id, url }, client, visitor, occurredAt } };
}

export function normalizeGalleryName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Finds the gallery a Pic-Time event talks about by project name among the
 * owner's rows: exact normalised match first, then a single prefix match
 * (Pic-Time appends suffixes like "— Finals"). Ambiguous prefixes return
 * null rather than guessing.
 */
export function matchGalleryByName<T extends { name: string }>(rows: readonly T[], name: string): T | null {
  const key = normalizeGalleryName(name);
  if (!key) return null;
  const exact = rows.find((r) => normalizeGalleryName(r.name) === key);
  if (exact) return exact;
  // The event name is a prefix of exactly one gallery ("Club" → "Club Shoot").
  const extended = rows.filter((r) => normalizeGalleryName(r.name).startsWith(key));
  if (extended.length === 1) return extended[0];
  if (extended.length > 1) return null;
  // A gallery name is a prefix of the event name: the longest (most specific) wins.
  const shortened = rows.filter((r) => key.startsWith(normalizeGalleryName(r.name))).sort((a, b) => normalizeGalleryName(b.name).length - normalizeGalleryName(a.name).length);
  return shortened[0] ?? null;
}
