/**
 * The Contact & Inquiries form: ONE definition of the fields, shared by the
 * page (which renders them) and the server action (which parses the posted
 * FormData). Pure: no I/O, so it is unit-tested directly and safe in a
 * client component.
 */
import { HONEYPOT_ERROR, HONEYPOT_FIELD, MAX } from "@/lib/bookings/public-form";
import type { InquiryCategory } from "@/lib/supabase/database.types";
import { isValidEmail, trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import { isInquiryCategory } from "./labels";

export { HONEYPOT_FIELD } from "@/lib/bookings/public-form";

export const INQUIRY_MAX = { name: MAX.name, email: MAX.email, subject: 160, message: MAX.request, reference: 64, sourcePage: 120 } as const;

export type InquiryValues = {
  full_name: string;
  email: string;
  category: InquiryCategory;
  subject: string;
  message: string;
  booking_reference: string | null;
  source_page: string | null;
  idempotency_key: string | null;
};

export type ParsedInquiry = { fieldErrors: Record<string, string>; values: InquiryValues | null };

const REQUIRED = "Required.";

/** A reference as a customer types it: a booking (BB-…), order, gallery or invoice reference; letters, digits and a few separators only. */
export function normalizeReference(v: string | null): string | null {
  if (!v) return null;
  const cleaned = v.replace(/[^\p{L}\p{N}\s#/_.-]/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
  return cleaned ? cleaned.slice(0, INQUIRY_MAX.reference) : null;
}

/** The page the form was opened from: a site-relative path, no query, no protocol. */
export function normalizeSourcePage(v: string | null): string | null {
  if (!v || !v.startsWith("/") || v.startsWith("//")) return null;
  const path = v.split(/[?#]/)[0].replace(/[^\w/.-]/g, "");
  return path ? path.slice(0, INQUIRY_MAX.sourcePage) : null;
}

export function parseInquiryForm(fd: FormData): ParsedInquiry {
  const str = (name: string) => trimOrNull(fd.get(name));
  if (str(HONEYPOT_FIELD)) return { fieldErrors: { [HONEYPOT_FIELD]: HONEYPOT_ERROR }, values: null };
  const fieldErrors: Record<string, string> = {};
  const full_name = str("full_name");
  const email = str("email");
  const category = str("category");
  const subject = str("subject");
  const message = str("message");
  const reference = normalizeReference(str("booking_reference"));
  const source = normalizeSourcePage(str("source_page"));
  const key = str("idempotency_key");

  if (!full_name) fieldErrors.full_name = REQUIRED;
  else if (full_name.length > INQUIRY_MAX.name) fieldErrors.full_name = `Keep this under ${INQUIRY_MAX.name} characters.`;
  if (!email) fieldErrors.email = REQUIRED;
  else if (email.length > INQUIRY_MAX.email || !isValidEmail(email)) fieldErrors.email = "Enter a valid e-mail address.";
  if (!category) fieldErrors.category = "Choose what your message is about.";
  else if (!isInquiryCategory(category)) fieldErrors.category = "Choose one of the listed inquiry types.";
  if (!subject) fieldErrors.subject = REQUIRED;
  else if (subject.length > INQUIRY_MAX.subject) fieldErrors.subject = `Keep this under ${INQUIRY_MAX.subject} characters.`;
  if (!message) fieldErrors.message = "Tell us a little about what you need.";
  else if (message.length > INQUIRY_MAX.message) fieldErrors.message = `Keep this under ${INQUIRY_MAX.message} characters.`;
  if (str("booking_reference") && !reference) fieldErrors.booking_reference = "Use letters and digits only.";
  if (fd.get("consent") !== "1") fieldErrors.consent = "Please agree to be contacted.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: null };
  return {
    fieldErrors,
    values: {
      full_name: full_name!,
      email: email!.toLowerCase(),
      category: category as InquiryCategory,
      subject: subject!,
      message: message!,
      booking_reference: reference,
      source_page: source,
      idempotency_key: isUuid(key) ? key : null,
    },
  };
}
