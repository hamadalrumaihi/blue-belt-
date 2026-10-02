"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./types";
import { requireOwnedAthlete, requireOwnedEvent } from "@/lib/authz";
import { parseCsv } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { isPlatform, type Platform } from "@/lib/types";
import { isValidEmail, isValidHttpUrl, trimOrNull } from "@/lib/utils";
import { isUuid } from "@/lib/validation";
import { guessPlatform, validateSourceUrl } from "@/lib/watchers/url-policy";

type AthleteInsert = Database["public"]["Tables"]["photo_athletes"]["Insert"];

/** Same normalisation as the generated photo_athletes.name_key column. */
export async function nameKey(name: string): Promise<string> {
  return normaliseName(name);
}

function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseClientForm(formData: FormData) {
  const fieldErrors: Record<string, string> = {};
  const name = trimOrNull(formData.get("name"));
  const phone = trimOrNull(formData.get("phone"));
  const email = trimOrNull(formData.get("email"));
  const academy = trimOrNull(formData.get("academy"));
  const event_id = trimOrNull(formData.get("event_id"));
  const platform = trimOrNull(formData.get("platform")) ?? "";
  const source_url = trimOrNull(formData.get("source_url"));

  if (!name) fieldErrors.name = "Full name is required.";
  if (!phone) fieldErrors.phone = "Phone is required.";
  if (!email) fieldErrors.email = "Email is required.";
  else if (!isValidEmail(email)) fieldErrors.email = "Enter a valid email.";
  if (!academy) fieldErrors.academy = "Academy / team is required.";
  if (!event_id) fieldErrors.event_id = "Choose an event.";
  else if (!isUuid(event_id)) fieldErrors.event_id = "Choose a valid event.";
  if (!isPlatform(platform)) fieldErrors.platform = "Choose a platform.";
  if (!source_url) fieldErrors.source_url = "Player / schedule URL is required.";
  else if (!isValidHttpUrl(source_url)) fieldErrors.source_url = "Enter a full URL starting with https://";
  else if (platform !== "OTHER") {
    const policy = validateSourceUrl(source_url);
    if (!policy.ok) fieldErrors.source_url = policy.message;
    else if (policy.platform !== platform) fieldErrors.source_url = `This looks like a ${policy.platform === "AJP" ? "AJP" : "Smoothcomp"} link. Change the platform or the URL.`;
  }

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
      active: formData.get("active") !== "off" && formData.get("active") !== "false",
    },
  };
}

/** Names of existing clients in the event that collide with `name` (same normalised name or same source URL). */
async function findDuplicates(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string, name: string, sourceUrl: string | null, excludeId?: string) {
  let query = supabase.from("photo_athletes").select("id,name,source_url").eq("event_id", eventId);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  const key = normaliseName(name);
  const url = sourceUrl?.trim().replace(/\/$/, "").toLowerCase() ?? null;
  return (data ?? []).filter((a) => normaliseName(a.name) === key || (url && a.source_url && a.source_url.trim().replace(/\/$/, "").toLowerCase() === url));
}

export async function createAthlete(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { fieldErrors, values, allowDuplicate } = parseClientForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const event = await requireOwnedEvent(supabase, values.event_id!);
  if (!event.ok) return { fieldErrors: { event_id: event.error } };

  if (!allowDuplicate) {
    const dupes = await findDuplicates(supabase, values.event_id!, values.name, values.source_url);
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
  const { fieldErrors, values, allowDuplicate } = parseClientForm(formData);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const owned = await requireOwnedAthlete(supabase, id);
  if (!owned.ok) return { error: owned.error };
  const event = await requireOwnedEvent(supabase, values.event_id!);
  if (!event.ok) return { fieldErrors: { event_id: event.error } };

  if (!allowDuplicate) {
    const dupes = await findDuplicates(supabase, values.event_id!, values.name, values.source_url, id);
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
  let platform: Platform = "OTHER";
  if (!source_url) fieldErrors.source_url = "Player / schedule URL is required.";
  else {
    const policy = validateSourceUrl(source_url);
    if (!policy.ok) fieldErrors.source_url = policy.message;
    else platform = policy.platform;
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const event = await requireOwnedEvent(supabase, event_id!);
  if (!event.ok) return { fieldErrors: { event_id: event.error } };

  if (!allowDuplicate) {
    const dupes = await findDuplicates(supabase, event_id!, name!, source_url);
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
 * CSV import: header row with any of name, source_url, phone, email, academy,
 * division, belt, weight, gender, age_category, package_name, notes.
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

  const { headers, rows } = parseCsv(text);
  if (!headers.includes("name")) return { fieldErrors: { csv: 'The header row must include a "name" column.' } };
  if (rows.length > 500) return { fieldErrors: { csv: "Import at most 500 rows at a time." } };

  const { data: existingRows } = await supabase.from("photo_athletes").select("name,source_url").eq("event_id", event_id);
  const seenNames = new Set((existingRows ?? []).map((a) => normaliseName(a.name)));
  const seenUrls = new Set((existingRows ?? []).map((a) => a.source_url?.trim().replace(/\/$/, "").toLowerCase()).filter(Boolean));

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
      platform = guessPlatform(null) ?? "OTHER";
    }
    const email = r.email?.trim() || null;
    if (email && !isValidEmail(email)) {
      report.errors.push({ row: rowNo, reason: `${name}: invalid email.` });
      return;
    }
    const key = normaliseName(name);
    const urlKey = sourceUrl?.replace(/\/$/, "").toLowerCase() ?? null;
    if (!allowDuplicate && (seenNames.has(key) || (urlKey && seenUrls.has(urlKey)))) {
      report.skipped.push({ row: rowNo, name, reason: "Already in this event (same name or URL)." });
      return;
    }
    seenNames.add(key);
    if (urlKey) seenUrls.add(urlKey);
    inserts.push({
      owner_id: user.id,
      event_id,
      name,
      source_url: sourceUrl,
      platform,
      phone: r.phone?.trim() || null,
      email,
      academy: r.academy?.trim() || null,
      division: r.division?.trim() || null,
      belt: r.belt?.trim() || null,
      weight: r.weight?.trim() || null,
      gender: r.gender?.trim() || null,
      age_category: r.age_category?.trim() || null,
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
