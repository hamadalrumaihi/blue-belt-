/**
 * Pure parsing for the Packages (photo_services) form. The actions file is
 * "use server", so validation lives here and is unit-tested directly.
 */
import { isBookingType } from "@/lib/bookings/state";
import type { BookingType } from "@/lib/supabase/database.types";
import { trimOrNull } from "@/lib/utils";

export const SERVICE_MAX = { name: 80, code: 40, description: 1000, price: 1_000_000, duration: 24 * 60 } as const;

export type ServiceValues = {
  code: string;
  name: string;
  booking_type: BookingType;
  description: string | null;
  price_qr: number | null;
  deposit_qr: number | null;
  currency: string;
  duration_minutes: number | null;
  includes_photo: boolean;
  includes_video: boolean;
  active: boolean;
  public: boolean;
  sort_order: number;
};

export type ParsedServiceForm = { fieldErrors: Record<string, string>; values: ServiceValues | null };

/** "Tournament photo + video" → "tournament-photo-video". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SERVICE_MAX.code);
}

export const SERVICE_CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

function money(raw: string | null, field: string, fieldErrors: Record<string, string>): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > SERVICE_MAX.price) {
    fieldErrors[field] = "Enter an amount in QAR (leave empty for a quote).";
    return null;
  }
  return Math.round(n * 100) / 100;
}

export function parseServiceForm(fd: FormData): ParsedServiceForm {
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(fd.get("name"));
  const codeRaw = trimOrNull(fd.get("code"));
  const bookingType = trimOrNull(fd.get("booking_type"));
  const description = trimOrNull(fd.get("description"));
  const durationRaw = trimOrNull(fd.get("duration_minutes"));
  const sortRaw = trimOrNull(fd.get("sort_order"));

  if (!name) fieldErrors.name = "Name is required.";
  else if (name.length > SERVICE_MAX.name) fieldErrors.name = `Keep the name under ${SERVICE_MAX.name} characters.`;
  const code = codeRaw ? codeRaw.toLowerCase() : name ? slugify(name) : "";
  if (!code || !SERVICE_CODE_RE.test(code)) fieldErrors.code = "Use 2–40 lower-case letters, digits or dashes.";
  if (!isBookingType(bookingType)) fieldErrors.booking_type = "Choose a booking type.";
  if (description && description.length > SERVICE_MAX.description) fieldErrors.description = `Keep the description under ${SERVICE_MAX.description} characters.`;

  const price_qr = money(trimOrNull(fd.get("price_qr")), "price_qr", fieldErrors);
  const deposit_qr = money(trimOrNull(fd.get("deposit_qr")), "deposit_qr", fieldErrors);
  if (price_qr !== null && deposit_qr !== null && deposit_qr > price_qr) fieldErrors.deposit_qr = "The deposit cannot exceed the price.";

  let duration_minutes: number | null = null;
  if (durationRaw) {
    const n = Number(durationRaw);
    if (!Number.isInteger(n) || n <= 0 || n > SERVICE_MAX.duration) fieldErrors.duration_minutes = "Enter a whole number of minutes.";
    else duration_minutes = n;
  }
  let sort_order = 0;
  if (sortRaw) {
    const n = Number(sortRaw);
    if (!Number.isInteger(n) || n < -1000 || n > 1000) fieldErrors.sort_order = "Enter a whole number.";
    else sort_order = n;
  }
  const includes_photo = fd.get("includes_photo") === "on" || fd.get("includes_photo") === "1";
  const includes_video = fd.get("includes_video") === "on" || fd.get("includes_video") === "1";
  if (!includes_photo && !includes_video) fieldErrors.includes_photo = "A package includes photo, video or both.";

  if (Object.keys(fieldErrors).length) return { fieldErrors, values: null };
  return {
    fieldErrors,
    values: {
      code,
      name: name!,
      booking_type: bookingType as BookingType,
      description,
      price_qr,
      deposit_qr,
      currency: "QAR",
      duration_minutes,
      includes_photo,
      includes_video,
      active: fd.get("active") === "on" || fd.get("active") === "1",
      public: fd.get("public") === "on" || fd.get("public") === "1",
      sort_order,
    },
  };
}

/**
 * Starter packages for a new studio. Every price is null (= quote on
 * request) so nothing can be booked at an accidental 0 QAR; the owner sets
 * real prices on the Packages page.
 */
export const DEFAULT_SERVICES: ServiceValues[] = [
  { code: "tournament-photo", name: "Tournament photo coverage", booking_type: "tournament_athlete", description: "All of one athlete's matches photographed, from warm-up to podium. Set your price.", price_qr: null, deposit_qr: null, currency: "QAR", duration_minutes: null, includes_photo: true, includes_video: false, active: true, public: true, sort_order: 10 },
  { code: "tournament-photo-video", name: "Tournament photo + video", booking_type: "tournament_athlete", description: "Photos plus full-match video of every bout. Set your price.", price_qr: null, deposit_qr: null, currency: "QAR", duration_minutes: null, includes_photo: true, includes_video: true, active: true, public: true, sort_order: 20 },
  { code: "club-day", name: "Club day coverage", booking_type: "club", description: "A photographer and/or videographer for the whole team at an event. Quoted per day.", price_qr: null, deposit_qr: null, currency: "QAR", duration_minutes: null, includes_photo: true, includes_video: true, active: true, public: true, sort_order: 30 },
  { code: "training-60", name: "Training session (60 min)", booking_type: "training_session", description: "One hour at your academy during class or open mat. Set your price.", price_qr: null, deposit_qr: null, currency: "QAR", duration_minutes: 60, includes_photo: true, includes_video: false, active: true, public: true, sort_order: 40 },
  { code: "private-session", name: "Private athlete session", booking_type: "private_session", description: "A dedicated shoot for one athlete: portraits, technique or sponsor material. Set your price.", price_qr: null, deposit_qr: null, currency: "QAR", duration_minutes: 90, includes_photo: true, includes_video: false, active: true, public: true, sort_order: 50 },
  { code: "custom", name: "Custom coverage", booking_type: "custom", description: "Seminars, gradings, promotions and anything else. Quoted individually.", price_qr: null, deposit_qr: null, currency: "QAR", duration_minutes: null, includes_photo: true, includes_video: true, active: true, public: true, sort_order: 60 },
];
