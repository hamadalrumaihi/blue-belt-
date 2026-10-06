"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./types";
import { requireOwnedAthlete, requireOwnedEvent } from "@/lib/authz";
import { nameCollisions, normaliseName, parseClientForm } from "@/lib/client-form";
import { parseCsv } from "@/lib/csv";
import { composeLocalDivision, divisionForWeight, divisionLabel, findAgeGroup, findWeightDivision, rulesOf } from "@/lib/local-divisions";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { type Platform } from "@/lib/types";
import { isValidEmail, trimOrNull } from "@/lib/utils";
import { isUuid, isValidCalendarDate } from "@/lib/validation";
import { guessPlatform, validateSourceUrl } from "@/lib/watchers/url-policy";

type AthleteInsert = Database["public"]["Tables"]["photo_athletes"]["Insert"];

/** Same normalisation as the generated photo_athletes.name_key column. */
export async function nameKey(name: string): Promise<string> {
  return normaliseName(name);
}

/** Existing clients in the event that are the same person (normalised name). A shared source URL is allowed. */
async function findDuplicates(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string, name: string, excludeId?: string) {
  const { data } = await supabase.from("photo_athletes").select("id,name").eq("event_id", eventId);
  return nameCollisions(data ?? [], name, excludeId);
}

/** The event facts a client form depends on: tracked by hand → no URL needed. */
async function clientEvent(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string | null) {
  if (!eventId || !isUuid(eventId)) return null;
  const { data } = await supabase.from("photo_events").select("id,platform,tracking_mode").eq("id", eventId).maybeSingle();
  return data ?? null;
}

export async function createAthlete(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const ev = await clientEvent(supabase, trimOrNull(formData.get("event_id")));
  const { fieldErrors, values, allowDuplicate } = parseClientForm(formData, { requireSourceUrl: ev?.tracking_mode !== "manual" });
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const event = await requireOwnedEvent(supabase, values.event_id!);
  if (!event.ok) return { fieldErrors: { event_id: event.error } };

  if (!allowDuplicate) {
    const dupes = await findDuplicates(supabase, values.event_id!, values.name);
    if (dupes.length) {
      return { fieldErrors: { name: `${dupes[0].name} is already in this event${dupes.length > 1 ? ` (${dupes.length} similar clients)` : ""}. Tick "Add anyway" if this is a different person.` }, duplicate: true };
    }
  }

  const { data, error } = await supabase
    .from("photo_athletes")
    .insert({ ...values, owner_id: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidateClientPaths(values.event_id);
  redirect(`/clients/${data.id}`);
}

export async function updateAthlete(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(id)) return { error: "Invalid client id." };
  const supabase = await createClient();
  const ev = await clientEvent(supabase, trimOrNull(formData.get("event_id")));
  const { fieldErrors, values, allowDuplicate } = parseClientForm(formData, { requireSourceUrl: ev?.tracking_mode !== "manual" });
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const owned = await requireOwnedAthlete(supabase, id);
  if (!owned.ok) return { error: owned.error };
  const event = await requireOwnedEvent(supabase, values.event_id!);
  if (!event.ok) return { fieldErrors: { event_id: event.error } };

  if (!allowDuplicate) {
    const dupes = await findDuplicates(supabase, values.event_id!, values.name, id);
    if (dupes.length) {
      return { fieldErrors: { name: `${dupes[0].name} is already in this event. Tick "Add anyway" if this is a different person.` }, duplicate: true };
    }
  }

  const { error, count } = await supabase.from("photo_athletes").update(values, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "Client not found or you do not have access to it." };

  revalidateClientPaths(values.event_id);
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}`);
}

export async function setAthleteActive(id: string, active: boolean): Promise<ActionState> {
  if (!isUuid(id)) return { error: "Invalid client id." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("photo_athletes").update({ active }, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "Client not found or you do not have access to it." };
  revalidateClientPaths(null);
  revalidatePath(`/clients/${id}`);
  return null;
}

/**
 * Quick entry at the mats: only what the watcher needs (name, event, source
 * URL). Contact and division details can be filled in later.
 */
export async function createAthleteQuick(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(formData.get("name"));
  const event_id = trimOrNull(formData.get("event_id"));
  const source_url = trimOrNull(formData.get("source_url"));
  const phone = trimOrNull(formData.get("phone"));
  const allowDuplicate = formData.get("allow_duplicate") === "1";

  if (!name) fieldErrors.name = "Name is required.";
  if (!event_id || !isUuid(event_id)) fieldErrors.event_id = "Choose an event.";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const ev = await clientEvent(supabase, event_id);
  let platform: Platform = ev?.platform === "LOCAL" ? "LOCAL" : "OTHER";
  if (!source_url) {
    if (ev?.tracking_mode !== "manual") fieldErrors.source_url = "Player / schedule URL is required.";
  } else {
    const policy = validateSourceUrl(source_url);
    if (!policy.ok) fieldErrors.source_url = policy.message;
    else platform = policy.platform;
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const event = await requireOwnedEvent(supabase, event_id!);
  if (!event.ok) return { fieldErrors: { event_id: event.error } };

  if (!allowDuplicate) {
    const dupes = await findDuplicates(supabase, event_id!, name!);
    if (dupes.length) return { fieldErrors: { name: `${dupes[0].name} is already in this event. Tick "Add anyway" if this is a different person.` }, duplicate: true };
  }

  const { data, error } = await supabase
    .from("photo_athletes")
    .insert({ name: name!, event_id, source_url, platform, phone, owner_id: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateClientPaths(event_id);
  redirect(`/clients/${data.id}`);
}

export type ImportReport = {
  inserted: number;
  skipped: Array<{ row: number; name: string; reason: string }>;
  errors: Array<{ row: number; reason: string }>;
};

export type ImportState = { error?: string; fieldErrors?: Record<string, string>; report?: ImportReport } | null;

/**
 * CSV import: header row with any of name, source_url, phone, email, academy
 * (or team), division, belt, weight, gender, age_category (or age_group),
 * birth_date, birth_year, weight_kg, package_name, notes.
 * Rows are validated individually; duplicates (same name or URL in the event)
 * are skipped unless "import duplicates" is ticked. Nothing is deleted.
 */
export async function importAthletesCsv(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const event_id = trimOrNull(formData.get("event_id"));
  const allowDuplicate = formData.get("allow_duplicate") === "1";
  const file = formData.get("file");
  let text = trimOrNull(formData.get("csv")) ?? "";
  if (file instanceof File && file.size) {
    if (file.size > 512 * 1024) return { error: "CSV is larger than 512 KB." };
    text = await file.text();
  }
  if (!event_id || !isUuid(event_id)) return { fieldErrors: { event_id: "Choose an event." } };
  if (!text.trim()) return { fieldErrors: { csv: "Paste CSV text or choose a file." } };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const event = await requireOwnedEvent(supabase, event_id);
  if (!event.ok) return { fieldErrors: { event_id: event.error } };
  const ev = await clientEvent(supabase, event_id);
  const rules = rulesOf(ev ? { platform: ev.platform } : null);

  const { headers, rows } = parseCsv(text);
  if (!headers.includes("name")) return { fieldErrors: { csv: 'The header row must include a "name" column.' } };
  if (rows.length > 500) return { fieldErrors: { csv: "Import at most 500 rows at a time." } };

  const { data: existingRows } = await supabase.from("photo_athletes").select("name").eq("event_id", event_id);
  const seenNames = new Set((existingRows ?? []).map((a) => normaliseName(a.name)));

  const report: ImportReport = { inserted: 0, skipped: [], errors: [] };
  const inserts: AthleteInsert[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const name = r.name?.trim();
    if (!name) {
      report.errors.push({ row: rowNo, reason: "Missing name." });
      return;
    }
    const sourceUrl = r.source_url?.trim() || null;
    let platform: Platform = "OTHER";
    if (sourceUrl) {
      const policy = validateSourceUrl(sourceUrl);
      if (!policy.ok) {
        report.errors.push({ row: rowNo, reason: `${name}: ${policy.message}` });
        return;
      }
      platform = policy.platform;
    } else {
      platform = ev?.platform === "LOCAL" ? "LOCAL" : guessPlatform(null) ?? "OTHER";
    }
    const email = r.email?.trim() || null;
    if (email && !isValidEmail(email)) {
      report.errors.push({ row: rowNo, reason: `${name}: invalid email.` });
      return;
    }
    const birthDate = r.birth_date?.trim() || null;
    if (birthDate && !isValidCalendarDate(birthDate)) {
      report.errors.push({ row: rowNo, reason: `${name}: birth_date must be YYYY-MM-DD.` });
      return;
    }
    const birthYear = r.birth_year?.trim() ? Number(r.birth_year) : null;
    if (birthYear !== null && (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2100)) {
      report.errors.push({ row: rowNo, reason: `${name}: birth_year must be a four-digit year.` });
      return;
    }
    const weightKg = r.weight_kg?.trim() ? Number(r.weight_kg.replace(",", ".")) : null;
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg >= 400)) {
      report.errors.push({ row: rowNo, reason: `${name}: weight_kg must be a number of kilograms.` });
      return;
    }
    // Local rules: map the sheet's group / division names onto the event's chart so the labels match the form.
    const ageCategoryRaw = r.age_category?.trim() || r.age_group?.trim() || null;
    const group = rules ? findAgeGroup(rules, ageCategoryRaw) : null;
    const weightDiv = rules && group ? findWeightDivision(group, r.weight?.trim() || null) ?? (weightKg !== null ? divisionForWeight(group, weightKg) : null) : null;
    const ageCategory = group?.label ?? ageCategoryRaw;
    const weightLabel = weightDiv ? divisionLabel(weightDiv) : r.weight?.trim() || null;
    const division = r.division?.trim() || (rules ? composeLocalDivision(group, weightDiv) || null : null);
    const key = normaliseName(name);
    if (!allowDuplicate && seenNames.has(key)) {
      report.skipped.push({ row: rowNo, name, reason: "Already in this event (same name)." });
      return;
    }
    seenNames.add(key);
    inserts.push({
      owner_id: user.id,
      event_id,
      name,
      source_url: sourceUrl,
      platform,
      phone: r.phone?.trim() || null,
      email,
      academy: r.academy?.trim() || r.team?.trim() || null,
      division,
      belt: r.belt?.trim() || null,
      weight: weightLabel,
      gender: r.gender?.trim() || null,
      age_category: ageCategory,
      birth_date: birthDate,
      birth_year: birthYear,
      weight_kg: weightKg !== null ? Math.round(weightKg * 100) / 100 : null,
      package_name: r.package_name?.trim() || null,
      notes: r.notes?.trim() || null,
    });
  });

  if (inserts.length) {
    const { error, count } = await supabase.from("photo_athletes").insert(inserts, { count: "exact" });
    if (error) return { error: `Nothing was imported: ${error.message}`, report };
    report.inserted = count ?? inserts.length;
  }
  revalidateClientPaths(event_id);
  return { report };
}

function revalidateClientPaths(eventId: string | null) {
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  revalidatePath("/watcher");
  if (eventId) revalidatePath(`/events/${eventId}`);
}
