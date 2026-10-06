/**
 * Pure client-form parsing and duplicate helpers, shared by the Server
 * Actions in actions/clients.ts and unit-testable without a database. The
 * actions file is "use server" (every export must be async), so this logic
 * lives here instead.
 */
import { isPlatform } from "@/lib/types";
import { isValidEmail, isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { isUuid, isValidCalendarDate } from "@/lib/validation";
import { validateSourceUrl } from "@/lib/watchers/url-policy";

/** Same normalisation as the generated photo_athletes.name_key column. */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export type ParsedClientForm = {
  fieldErrors: Record<string, string>;
  allowDuplicate: boolean;
  values: {
    name: string;
    phone: string | null;
    email: string | null;
    academy: string | null;
    event_id: string | null;
    platform: string;
    source_url: string | null;
    division: string | null;
    weight: string | null;
    belt: string | null;
    gender: string | null;
    age_category: string | null;
    notes: string | null;
    package_name: string | null;
    internal_notes: string | null;
    active: boolean;
    birth_date: string | null;
    birth_year: number | null;
    weight_kg: number | null;
  };
};

export type ParseClientOptions = {
  /** False for a manually tracked event: there may be no public bracket page. */
  requireSourceUrl?: boolean;
};

/**
 * Validates the full client form. Required: name, event, platform, source URL.
 * Contact details (phone, email, academy) are OPTIONAL so a Quick Add client
 * — created with only name + URL — can later be edited without being forced
 * to invent a phone number, email or academy. Email format is still checked
 * when a value is given.
 */
export function parseClientForm(formData: FormData, options: ParseClientOptions = {}): ParsedClientForm {
  const requireSourceUrl = options.requireSourceUrl ?? true;
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(formData.get("name"));
  const phone = trimOrNull(formData.get("phone"));
  const email = trimOrNull(formData.get("email"));
  const academy = trimOrNull(formData.get("academy"));
  const event_id = trimOrNull(formData.get("event_id"));
  const platform = trimOrNull(formData.get("platform")) ?? "";
  const source_url = trimOrNull(formData.get("source_url"));

  if (!name) fieldErrors.name = "Full name is required.";
  if (email && !isValidEmail(email)) fieldErrors.email = "Enter a valid email.";
  if (!event_id) fieldErrors.event_id = "Choose an event.";
  else if (!isUuid(event_id)) fieldErrors.event_id = "Choose a valid event.";
  if (!isPlatform(platform)) fieldErrors.platform = "Choose a platform.";
  if (!source_url) {
    if (requireSourceUrl) fieldErrors.source_url = "Player / schedule URL is required.";
  } else if (!isValidHttpUrl(source_url)) fieldErrors.source_url = "Enter a full URL starting with https://";
  else if (platform !== "OTHER" && platform !== "LOCAL") {
    const policy = validateSourceUrl(source_url);
    if (!policy.ok) fieldErrors.source_url = policy.message;
    else if (policy.platform !== platform) fieldErrors.source_url = `This looks like a ${policy.platform === "AJP" ? "AJP" : "Smoothcomp"} link. Change the platform or the URL.`;
  }

  // An unchecked HTML checkbox submits nothing, so the control renders a hidden
  // `active_present` sentinel. Absent sentinel = the create form (no control) =
  // active by default; present sentinel = honour the checkbox state exactly.
  const activePresent = formData.get("active_present") === "1";
  const active = activePresent ? formData.get("active") === "on" : true;

  // Local competitions: real birth date / year and weight in kg (all optional).
  const birth_date = trimOrNull(formData.get("birth_date"));
  if (birth_date && !isValidCalendarDate(birth_date)) fieldErrors.birth_date = "Enter a real date (YYYY-MM-DD).";
  const birthYearRaw = trimOrNull(formData.get("birth_year"));
  const birth_year = birthYearRaw ? Number(birthYearRaw) : null;
  if (birth_year !== null && (!Number.isInteger(birth_year) || birth_year < 1900 || birth_year > 2100)) fieldErrors.birth_year = "Enter a four-digit year.";
  const weightRaw = trimOrNull(formData.get("weight_kg"));
  const weight_kg = weightRaw ? Number(weightRaw) : null;
  if (weight_kg !== null && (!Number.isFinite(weight_kg) || weight_kg <= 0 || weight_kg >= 400)) fieldErrors.weight_kg = "Enter the weight in kg, e.g. 36 or 36.5.";

  return {
    fieldErrors,
    allowDuplicate: formData.get("allow_duplicate") === "1",
    values: {
      name: name ?? "",
      phone,
      email,
      academy,
      event_id,
      platform,
      source_url,
      division: trimOrNull(formData.get("division")),
      weight: trimOrNull(formData.get("weight")),
      belt: trimOrNull(formData.get("belt")),
      gender: trimOrNull(formData.get("gender")),
      age_category: trimOrNull(formData.get("age_category")),
      notes: trimOrNull(formData.get("notes")),
      package_name: trimOrNull(formData.get("package_name")),
      internal_notes: trimOrNull(formData.get("internal_notes")),
      active,
      birth_date,
      birth_year: birth_year !== null && Number.isInteger(birth_year) ? birth_year : null,
      weight_kg: weight_kg !== null && Number.isFinite(weight_kg) ? Math.round(weight_kg * 100) / 100 : null,
    },
  };
}

/**
 * Clients in the same event that are the SAME person as `name`.
 *
 * Duplicate detection is by normalised name only. A shared source URL is NOT a
 * duplicate: distinct athletes routinely share a team or bracket page, and the
 * watcher applies one page to every client that points at it. Keying duplicates
 * on the URL would wrongly block a second real athlete on the same bracket.
 */
export function nameCollisions<T extends { id?: string; name: string }>(rows: T[], name: string, excludeId?: string): T[] {
  const key = normaliseName(name);
  return rows.filter((r) => (excludeId ? r.id !== excludeId : true) && normaliseName(r.name) === key);
}
