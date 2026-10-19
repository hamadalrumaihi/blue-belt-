import type { Bilingual } from "@/lib/i18n/locale";
import type { BookingType, InquiryCategory, InquiryStatus } from "@/lib/supabase/database.types";

/**
 * Inquiry categories and statuses, shared by the public Contact & Inquiries
 * page, the server action, the owner's /inquiries board and the tests. No
 * server-only imports, so client components may use it.
 */
export const INQUIRY_CATEGORIES = [
  "general",
  "tournament_event",
  "athlete",
  "club_team",
  "photography",
  "videography",
  "commercial_creative",
  "booking_question",
  "existing_order",
  "payment_billing",
  "partnership",
  "technical_support",
  "other",
] as const satisfies readonly InquiryCategory[];

export const INQUIRY_CATEGORY_LABEL: Record<InquiryCategory, Bilingual> = {
  general: { en: "General inquiry", ar: "استفسار عام" },
  tournament_event: { en: "Tournament & event coverage", ar: "تغطية بطولة أو فعالية" },
  athlete: { en: "Athlete coverage", ar: "تغطية رياضي" },
  club_team: { en: "Club & team coverage", ar: "تغطية نادٍ أو فريق" },
  photography: { en: "Photography", ar: "تصوير فوتوغرافي" },
  videography: { en: "Videography", ar: "تصوير فيديو" },
  commercial_creative: { en: "Commercial & creative projects", ar: "مشاريع تجارية وإبداعية" },
  booking_question: { en: "Booking questions", ar: "أسئلة عن الحجز" },
  existing_order: { en: "Existing order / gallery", ar: "طلب أو معرض قائم" },
  payment_billing: { en: "Payment & billing", ar: "الدفع والفواتير" },
  partnership: { en: "Partnerships & collaborations", ar: "شراكات وتعاونات" },
  technical_support: { en: "Technical support", ar: "دعم فني" },
  other: { en: "Other", ar: "أخرى" },
};

/** Categories where a booking, order or gallery reference is expected: the field shows by default for these. */
export const REFERENCE_CATEGORIES: readonly InquiryCategory[] = ["booking_question", "existing_order", "payment_billing", "technical_support"];

export const INQUIRY_STATUSES = ["new", "in_progress", "waiting_customer", "quoted", "converted", "resolved", "closed"] as const satisfies readonly InquiryStatus[];

export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  new: "New",
  in_progress: "In progress",
  waiting_customer: "Waiting for customer",
  quoted: "Quoted",
  converted: "Converted to booking",
  resolved: "Resolved",
  closed: "Closed",
};

/** Statuses that still need the studio's attention. */
export const OPEN_INQUIRY_STATUSES: readonly InquiryStatus[] = ["new", "in_progress", "waiting_customer", "quoted"];

export function isInquiryCategory(v: unknown): v is InquiryCategory {
  return typeof v === "string" && (INQUIRY_CATEGORIES as readonly string[]).includes(v);
}

export function isInquiryStatus(v: unknown): v is InquiryStatus {
  return typeof v === "string" && (INQUIRY_STATUSES as readonly string[]).includes(v);
}

/** Same alphabet as booking references (no 0/O/1/I), IQ- prefix so the two are never confused. */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INQUIRY_REF_RE = /^IQ-[A-HJ-NP-Z2-9]{6}$/;

export function makeInquiryRef(random: () => number = Math.random): string {
  let out = "IQ-";
  for (let i = 0; i < 6; i += 1) out += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return out;
}

export function isInquiryRef(v: unknown): v is string {
  return typeof v === "string" && INQUIRY_REF_RE.test(v);
}

/**
 * Link to the Contact & Inquiries page with a category preselected (and the
 * page the visitor came from, for lead tracking). Pure, so every CTA on the
 * site builds the same URL.
 */
export function inquiryHref(category?: InquiryCategory | null, from?: string | null): string {
  const params = new URLSearchParams();
  if (category && category !== "general") params.set("type", category);
  if (from && from.startsWith("/") && !from.startsWith("//")) params.set("from", from.split("?")[0].slice(0, 120));
  const q = params.toString();
  return q ? `/contact?${q}` : "/contact";
}

export const INQUIRY_NOTE_MAX = 1000;

/** Inquiry notes stored on the row: [{ at, by, text }]. */
export type InquiryNote = { at: string; by: string | null; text: string };

export function readInquiryNotes(v: unknown): InquiryNote[] {
  if (!Array.isArray(v)) return [];
  const out: InquiryNote[] = [];
  for (const n of v) {
    if (!n || typeof n !== "object" || Array.isArray(n)) continue;
    const o = n as Record<string, unknown>;
    if (typeof o.text !== "string" || !o.text.trim()) continue;
    out.push({ at: typeof o.at === "string" ? o.at : "", by: typeof o.by === "string" ? o.by : null, text: o.text });
  }
  return out;
}

/** The booking type an inquiry category most likely leads to when the owner converts it; changeable on the booking. */
export function bookingTypeForCategory(category: InquiryCategory): BookingType {
  switch (category) {
    case "athlete":
      return "tournament_athlete";
    case "club_team":
      return "club";
    case "photography":
      return "private_session";
    default:
      return "custom";
  }
}
