/**
 * Pure parsing for the owner's manual booking form and the manual payment
 * sheet. No I/O: shared by the server actions and unit tests. The actions
 * file is "use server" (every export must be async), so the logic lives here.
 */
import type { BookingDetails } from "@/lib/bookings/state";
import { isBookingType, isPaymentMethod, isPaymentMode, isPaymentStage } from "@/lib/bookings/state";
import type { BookingType, PaymentMethod, PaymentMode, PaymentStage } from "@/lib/supabase/database.types";
import { DEFAULT_TIMEZONE, wallClockToIso } from "@/lib/time";
import { isValidEmail, isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { isUuid, isValidCalendarDate } from "@/lib/validation";

export const MAX_NOTES = 2000;
export const MAX_LOCATION = 200;
export const MAX_NAME = 120;
export const MAX_PAYMENT_NOTE = 500;
/** Upper bound for one booking / one payment (QAR); keeps typos like 3500000 out. */
export const MAX_AMOUNT_QR = 1_000_000;

export type ParsedBookingForm = {
  fieldErrors: Record<string, string>;
  values: {
    booking_type: BookingType;
    /** An existing CRM person (preferred) … */
    client_id: string | null;
    /** … or a new contact to find-or-create. */
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    instagram: string | null;
    organization_id: string | null;
    service_id: string | null;
    event_id: string | null;
    athlete_name: string | null;
    /** ISO instant built from the Qatar wall clock, or null when no date was given. */
    session_at: string | null;
    session_date: string | null;
    session_time: string | null;
    location: string | null;
    /** null = "use the service price" (the action resolves it). */
    amount_qr: number | null;
    payment_mode: PaymentMode;
    requires_contract: boolean;
    notes: string | null;
    details: BookingDetails;
  };
};

const GI = ["gi", "no-gi", "both"] as const;
const COVERAGE = ["photo", "video", "both"] as const;
const BOOKED_FOR = ["self", "child", "athlete", "club"] as const;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function short(value: string | null, max: number): string | null {
  return value ? value.slice(0, max) : null;
}

/** Parses a QAR amount typed by the owner: "350", "350.50", "1,200". Null for blank. */
export function parseAmountQr(raw: string | null): { ok: true; value: number | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  const n = Number(raw.replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT_QR) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/**
 * Validates the owner's booking form. Required: a booking type and a client
 * (an existing person OR a new name). Everything else is optional so a quick
 * phone inquiry can be captured in ten seconds and completed later.
 */
export function parseBookingForm(formData: FormData, now: Date = new Date()): ParsedBookingForm {
  const fieldErrors: Record<string, string> = {};
  const typeRaw = trimOrNull(formData.get("booking_type"));
  const booking_type: BookingType = isBookingType(typeRaw) ? typeRaw : "custom";
  if (!isBookingType(typeRaw)) fieldErrors.booking_type = "Choose what this booking is for.";

  const client_id = trimOrNull(formData.get("client_id"));
  if (client_id && !isUuid(client_id)) fieldErrors.client_id = "Choose a valid client.";
  const customer_name = short(trimOrNull(formData.get("customer_name")), MAX_NAME);
  const customer_email = trimOrNull(formData.get("customer_email"))?.toLowerCase() ?? null;
  const customer_phone = short(trimOrNull(formData.get("customer_phone")), 40);
  const instagram = short(trimOrNull(formData.get("instagram")), 60);
  if (!client_id && !customer_name) fieldErrors.customer_name = "Enter the client's name or pick an existing client.";
  if (customer_email && !isValidEmail(customer_email)) fieldErrors.customer_email = "Enter a valid email.";

  const organization_id = trimOrNull(formData.get("organization_id"));
  if (organization_id && !isUuid(organization_id)) fieldErrors.organization_id = "Choose a valid team or club.";
  const service_id = trimOrNull(formData.get("service_id"));
  if (service_id && !isUuid(service_id)) fieldErrors.service_id = "Choose a valid service.";
  const event_id = trimOrNull(formData.get("event_id"));
  if (event_id && !isUuid(event_id)) fieldErrors.event_id = "Choose a valid event.";

  const athlete_name = short(trimOrNull(formData.get("athlete_name")), MAX_NAME);

  const session_date = trimOrNull(formData.get("session_date"));
  const session_time = trimOrNull(formData.get("session_time"));
  let session_at: string | null = null;
  if (session_date && !isValidCalendarDate(session_date)) fieldErrors.session_date = "Enter a real date (YYYY-MM-DD).";
  else if (session_date) {
    session_at = wallClockToIso(session_time ?? "09:00", DEFAULT_TIMEZONE, session_date, now);
    if (!session_at) fieldErrors.session_time = "Enter a time like 14:30.";
  } else if (session_time) fieldErrors.session_date = "Pick the date for that time.";

  const location = short(trimOrNull(formData.get("location")), MAX_LOCATION);

  const amount = parseAmountQr(trimOrNull(formData.get("amount_qr")));
  if (!amount.ok) fieldErrors.amount_qr = "Enter the amount in QAR, e.g. 350.";

  const modeRaw = trimOrNull(formData.get("payment_mode"));
  const payment_mode: PaymentMode = isPaymentMode(modeRaw) ? modeRaw : "manual";
  if (modeRaw && !isPaymentMode(modeRaw)) fieldErrors.payment_mode = "Choose how this booking will be paid.";

  const notesRaw = trimOrNull(formData.get("notes"));
  if (notesRaw && notesRaw.length > MAX_NOTES) fieldErrors.notes = `Keep notes under ${MAX_NOTES} characters.`;

  const source_url = trimOrNull(formData.get("source_url"));
  if (source_url && !isValidHttpUrl(source_url)) fieldErrors.source_url = "Enter a full URL starting with https://";
  const competition_date = trimOrNull(formData.get("competition_date"));
  if (competition_date && !isValidCalendarDate(competition_date)) fieldErrors.competition_date = "Enter a real date (YYYY-MM-DD).";
  const countRaw = trimOrNull(formData.get("athlete_count"));
  const athlete_count = countRaw ? Number(countRaw) : null;
  if (athlete_count !== null && (!Number.isInteger(athlete_count) || athlete_count < 1 || athlete_count > 500)) fieldErrors.athlete_count = "Enter how many athletes (1–500).";

  const details: BookingDetails = {};
  const academy = short(trimOrNull(formData.get("academy")), MAX_NAME);
  if (academy) details.academy = academy;
  const belt = short(trimOrNull(formData.get("belt")), 40);
  if (belt) details.belt = belt;
  const ageDivision = short(trimOrNull(formData.get("age_division")), 60);
  if (ageDivision) details.age_division = ageDivision;
  const weightDivision = short(trimOrNull(formData.get("weight_division")), 60);
  if (weightDivision) details.weight_division = weightDivision;
  const gi = oneOf(trimOrNull(formData.get("gi")), GI);
  if (gi) details.gi = gi;
  const coverage = oneOf(trimOrNull(formData.get("coverage")), COVERAGE);
  if (coverage) details.coverage = coverage;
  if (source_url && !fieldErrors.source_url) details.source_url = source_url;
  if (competition_date && !fieldErrors.competition_date) details.competition_date = competition_date;
  if (athlete_count !== null && !fieldErrors.athlete_count) details.athlete_count = athlete_count;
  if (formData.get("wants_photographer") === "1") details.wants_photographer = true;
  if (formData.get("wants_videographer") === "1") details.wants_videographer = true;
  const bookedFor = oneOf(trimOrNull(formData.get("booked_for")), BOOKED_FOR);
  if (bookedFor) details.booked_for = bookedFor;
  if (instagram) details.instagram = instagram;
  if (athlete_name) details.athlete_name = athlete_name;

  return {
    fieldErrors,
    values: {
      booking_type,
      client_id: client_id && isUuid(client_id) ? client_id : null,
      customer_name,
      customer_email,
      customer_phone,
      instagram,
      organization_id: organization_id && isUuid(organization_id) ? organization_id : null,
      service_id: service_id && isUuid(service_id) ? service_id : null,
      event_id: event_id && isUuid(event_id) ? event_id : null,
      athlete_name,
      session_at,
      session_date,
      session_time: session_date ? (session_time ?? "09:00") : session_time,
      location,
      amount_qr: amount.ok ? amount.value : null,
      payment_mode,
      requires_contract: formData.get("requires_contract") === "1",
      notes: notesRaw ? notesRaw.slice(0, MAX_NOTES) : null,
      details,
    },
  };
}

export type ParsedManualPayment = {
  fieldErrors: Record<string, string>;
  values: { method: PaymentMethod; amount_qr: number; paid_at: string; note: string | null; stage: PaymentStage };
};

const MANUAL_METHODS: readonly PaymentMethod[] = ["cash", "bank_transfer", "fawran", "other"];

/**
 * The "Record a payment" sheet: an offline method (never MyFatoorah, that
 * comes from the webhook), WHICH STAGE it settles (the deposit or the
 * remaining balance), a positive amount, the day it arrived (today by
 * default, Qatar time) and an optional note such as a Fawran reference.
 */
export function parseManualPayment(formData: FormData, now: Date = new Date()): ParsedManualPayment {
  const fieldErrors: Record<string, string> = {};
  const methodRaw = trimOrNull(formData.get("method"));
  const method: PaymentMethod = isPaymentMethod(methodRaw) && MANUAL_METHODS.includes(methodRaw) ? methodRaw : "cash";
  if (!isPaymentMethod(methodRaw) || !MANUAL_METHODS.includes(methodRaw)) fieldErrors.method = "Choose how the payment arrived.";

  const stageRaw = trimOrNull(formData.get("stage"));
  const stage: PaymentStage = isPaymentStage(stageRaw) ? stageRaw : "deposit";
  if (!isPaymentStage(stageRaw)) fieldErrors.stage = "Say whether this settles the deposit or the remaining balance.";

  const amount = parseAmountQr(trimOrNull(formData.get("amount_qr")));
  if (!amount.ok || amount.value === null || amount.value <= 0) fieldErrors.amount_qr = "Enter the amount received in QAR.";

  const dateRaw = trimOrNull(formData.get("paid_at"));
  let paid_at = now.toISOString();
  if (dateRaw) {
    if (!isValidCalendarDate(dateRaw)) fieldErrors.paid_at = "Enter a real date (YYYY-MM-DD).";
    else paid_at = wallClockToIso("12:00", DEFAULT_TIMEZONE, dateRaw, now) ?? paid_at;
  }

  const noteRaw = trimOrNull(formData.get("note"));
  if (noteRaw && noteRaw.length > MAX_PAYMENT_NOTE) fieldErrors.note = `Keep the note under ${MAX_PAYMENT_NOTE} characters.`;

  return { fieldErrors, values: { method, amount_qr: amount.ok && amount.value ? amount.value : 0, paid_at, note: noteRaw ? noteRaw.slice(0, MAX_PAYMENT_NOTE) : null, stage } };
}

export const MAX_FINAL_AMOUNT_NOTE = 300;

export type ParsedFinalAmount = {
  fieldErrors: Record<string, string>;
  values: { amount_qr: number; currency: "QAR"; note: string | null };
};

/**
 * The "Set the price" form: a positive QAR amount (the currency is fixed)
 * and an optional short note such as "2 extra hours". The deposit and
 * balance are split from it on the server (never typed by anyone).
 */
export function parseFinalAmount(formData: FormData): ParsedFinalAmount {
  const fieldErrors: Record<string, string> = {};
  const amount = parseAmountQr(trimOrNull(formData.get("amount_qr")));
  if (!amount.ok || amount.value === null || amount.value <= 0) fieldErrors.amount_qr = "Enter the final amount in QAR, e.g. 350.";
  const noteRaw = trimOrNull(formData.get("note"));
  if (noteRaw && noteRaw.length > MAX_FINAL_AMOUNT_NOTE) fieldErrors.note = `Keep the note under ${MAX_FINAL_AMOUNT_NOTE} characters.`;
  return { fieldErrors, values: { amount_qr: amount.ok && amount.value ? amount.value : 0, currency: "QAR", note: noteRaw ? noteRaw.slice(0, MAX_FINAL_AMOUNT_NOTE) : null } };
}

/** The Qatar wall-clock date and time of an instant, for prefilling the edit form. */
export function isoToWallClock(iso: string | null | undefined, timeZone = DEFAULT_TIMEZONE): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Keeps a search term safe for a PostgREST `or(ilike)` filter: letters, digits, spaces, dashes and dots only. */
export function bookingSearchTerm(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/[^\p{L}\p{N}\s.@'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || null;
}
