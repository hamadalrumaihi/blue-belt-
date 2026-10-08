import { formatQr } from "@/lib/bookings/state";
import type { MergeValues } from "@/lib/documents/state";
import type { PhotoBookingRow, PhotoEventRow, PhotoOrganizationRow, PhotoPersonRow, PhotoServiceRow, PhotoStudioRow } from "@/lib/supabase/database.types";
import { DEFAULT_TIMEZONE } from "@/lib/time";

/**
 * Builds the {{merge}} values for a document from the studio records it is
 * about. Pure: the caller loads the rows. Dates are written out in Qatar
 * time ("Saturday 14 March 2026"), amounts through formatQr ("1,200 QAR").
 * Empty values are left undefined so renderTemplate shows a visible blank.
 */
export type MergeSources = {
  booking?: (Pick<PhotoBookingRow, "athlete_name" | "customer_name" | "customer_email" | "customer_phone" | "package_name" | "amount_qr" | "session_at" | "location" | "public_ref" | "academy"> & Partial<Pick<PhotoBookingRow, "deposit_qr" | "balance_qr">>) | null;
  person?: Pick<PhotoPersonRow, "full_name" | "email" | "phone"> | null;
  organization?: Pick<PhotoOrganizationRow, "name"> | null;
  service?: Pick<PhotoServiceRow, "name" | "price_qr" | "deposit_qr"> | null;
  event?: Pick<PhotoEventRow, "name" | "event_date" | "venue"> | null;
  studio?: Pick<PhotoStudioRow, "business_name"> | null;
  /** The parent or guardian of a minor (from photo_bookings.guardian); fills {{guardian_name}}. */
  guardian?: { name: string | null; email?: string | null; phone?: string | null } | null;
  now: Date;
  timeZone?: string;
};

export function formatMergeDate(iso: string | null | undefined, timeZone = DEFAULT_TIMEZONE): string | undefined {
  if (!iso) return undefined;
  // A bare calendar date (event_date) is a day, not an instant: format it without a zone shift.
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = dayOnly ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-GB", { timeZone: dayOnly ? "UTC" : timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function formatMergeDateTime(iso: string | null | undefined, timeZone = DEFAULT_TIMEZONE): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const day = formatMergeDate(iso, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day}, ${time}`;
}

function clean(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function money(v: number | null | undefined): string | undefined {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return undefined;
  return formatQr(Number(v));
}

export function mergeValuesFor(src: MergeSources): MergeValues {
  const tz = src.timeZone ?? DEFAULT_TIMEZONE;
  const { booking, person, organization, service, event, studio, guardian } = src;
  const amount = booking ? money(booking.amount_qr) : money(service?.price_qr);
  return {
    client_name: clean(person?.full_name) ?? clean(booking?.customer_name),
    client_email: clean(person?.email) ?? clean(booking?.customer_email),
    client_phone: clean(person?.phone) ?? clean(booking?.customer_phone),
    guardian_name: clean(guardian?.name),
    athlete_name: clean(booking?.athlete_name) ?? clean(person?.full_name),
    organization_name: clean(organization?.name) ?? clean(booking?.academy),
    business_name: clean(studio?.business_name) ?? "Blue Belt Media",
    service_name: clean(service?.name) ?? clean(booking?.package_name),
    event_name: clean(event?.name),
    event_date: formatMergeDate(event?.event_date, tz),
    session_date: formatMergeDateTime(booking?.session_at, tz),
    location: clean(booking?.location) ?? clean(event?.venue),
    amount: amount && amount !== "—" ? amount : undefined,
    // The 50% deposit is server-computed on the booking; a service-level deposit is only a fallback for quotes.
    deposit: booking && Number(booking.deposit_qr) > 0 ? money(booking.deposit_qr) : money(service?.deposit_qr),
    balance: booking && Number(booking.balance_qr) > 0 ? money(booking.balance_qr) : undefined,
    booking_ref: clean(booking?.public_ref),
    today: formatMergeDate(src.now.toISOString(), tz),
  };
}
