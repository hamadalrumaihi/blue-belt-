import type { DocumentKind, DocumentStatus } from "@/lib/supabase/database.types";

/**
 * Document lifecycle (photo_documents.status). Pure.
 *
 *   draft → sent → viewed → signed
 *                        → declined
 *                        → expired
 *
 * `signed` is immutable: body, hash and evidence never change afterwards. A
 * declined or expired document is re-issued as a NEW document (new token,
 * new version), never edited in place.
 */
export const DOCUMENT_STATUSES = ["draft", "sent", "viewed", "signed", "declined", "expired"] as const satisfies readonly DocumentStatus[];

export const DOCUMENT_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  draft: ["sent"],
  sent: ["viewed", "signed", "declined", "expired"],
  viewed: ["signed", "declined", "expired"],
  signed: [],
  declined: [],
  expired: [],
};

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  signed: "Signed",
  declined: "Declined",
  expired: "Expired",
};

export const DOCUMENT_KINDS = ["services_agreement", "event_agreement", "session_agreement", "print_release", "model_release", "club_agreement", "custom"] as const satisfies readonly DocumentKind[];

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  services_agreement: "Photography services agreement",
  event_agreement: "Combat sports event photography agreement",
  session_agreement: "Fighter portrait / session agreement",
  print_release: "Print release",
  model_release: "Model / image release",
  club_agreement: "Club / team agreement",
  custom: "Custom document",
};

export function isDocumentStatus(v: unknown): v is DocumentStatus {
  return typeof v === "string" && (DOCUMENT_STATUSES as readonly string[]).includes(v);
}
export function isDocumentKind(v: unknown): v is DocumentKind {
  return typeof v === "string" && (DOCUMENT_KINDS as readonly string[]).includes(v);
}

export function canTransitionDocument(from: DocumentStatus, to: DocumentStatus): boolean {
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

/** A document can still be signed (status allows it and it has not passed its expiry). */
export function isSignable(doc: { status: DocumentStatus; expires_at: string | null }, now: Date): boolean {
  if (doc.status !== "sent" && doc.status !== "viewed") return false;
  if (doc.expires_at && Date.parse(doc.expires_at) <= now.getTime()) return false;
  return true;
}

export const MERGE_FIELDS = [
  "client_name",
  "client_email",
  "client_phone",
  "athlete_name",
  "organization_name",
  "business_name",
  "service_name",
  "event_name",
  "event_date",
  "session_date",
  "location",
  "amount",
  "deposit",
  "booking_ref",
  "today",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeValues = Partial<Record<MergeField, string>>;

const FIELD_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Replaces {{field}} with its value; unknown or empty fields become a visible blank so nothing is silently dropped. */
export function renderTemplate(body: string, values: MergeValues): string {
  return body.replace(FIELD_RE, (_m, key: string) => {
    const v = values[key as MergeField];
    return v && v.trim() ? v : "________";
  });
}

/** Fields a template body references (for the editor's checklist). */
export function templateFields(body: string): MergeField[] {
  const out = new Set<MergeField>();
  for (const m of body.matchAll(FIELD_RE)) {
    const key = m[1];
    if ((MERGE_FIELDS as readonly string[]).includes(key)) out.add(key as MergeField);
  }
  return [...out];
}

/** Characters that a typed signature must not be made of (prevents an empty / symbol-only "signature"). */
export function isAcceptableSignerName(name: string): boolean {
  const t = name.trim();
  return t.length >= 3 && t.length <= 120 && /\p{L}/u.test(t);
}
