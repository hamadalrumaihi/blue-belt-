#!/usr/bin/env node
/**
 * Imports pricing evidence (scripts/pricing/seed-references.json by default)
 * into photo_price_references for ONE owner, with the service-role key.
 * Idempotent: a record whose seed_key the owner already has is skipped,
 * never overwritten (re-observations are new rows made from the app).
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=https://... \
 *   node scripts/pricing/import-references.mjs --owner <owner auth.users id> [--file path.json] [--dry-run]
 *
 * The owner id can also come from PRICING_OWNER_ID. Nothing here reads a
 * booking, a person or anything customer-related; it only writes evidence.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SOURCE_TYPES = ["provider_site", "social_post", "search_index", "marketplace", "directory", "private_quote", "other"];
const CONFIDENCES = ["verified", "likely", "unverified"];
const REGIONS = ["qatar", "gcc", "other"];
const MEDIA = ["photo", "video", "photo_video", "other"];
const SERVICE_TYPES = ["tournament_athlete", "club", "training_session", "private_session", "custom"];
const SCOPES = ["sports_event_athlete", "event_coverage_hourly", "portrait_session", "content_package_images", "video_production", "retainer_monthly", "managed_social", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function isDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** Mirrors src/lib/pricing/form.ts validatePriceReference for the fields a seed record carries. */
function validate(r, today) {
  const errors = [];
  if (typeof r.seed_key !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(r.seed_key)) errors.push("seed_key");
  if (typeof r.provider !== "string" || !r.provider.trim()) errors.push("provider");
  if (r.source_url !== null && r.source_url !== undefined && !/^https?:\/\//.test(r.source_url)) errors.push("source_url");
  if (!SERVICE_TYPES.includes(r.service_type)) errors.push("service_type");
  if (typeof r.price_from !== "number" || r.price_from < 0) errors.push("price_from");
  if (r.price_to !== null && r.price_to !== undefined && (typeof r.price_to !== "number" || r.price_to < r.price_from)) errors.push("price_to");
  if (!isDate(r.observed_on) || r.observed_on > today) errors.push("observed_on");
  if (r.checked_on !== undefined && (!isDate(r.checked_on) || r.checked_on > today)) errors.push("checked_on");
  if (!SOURCE_TYPES.includes(r.source_type ?? "other")) errors.push("source_type");
  if (!CONFIDENCES.includes(r.confidence ?? "unverified")) errors.push("confidence");
  if (!REGIONS.includes(r.region ?? "qatar")) errors.push("region");
  if (r.media_type !== null && r.media_type !== undefined && !MEDIA.includes(r.media_type)) errors.push("media_type");
  if (r.comparable_scope !== null && r.comparable_scope !== undefined && !SCOPES.includes(r.comparable_scope)) errors.push("comparable_scope");
  if (r.excluded === true && (typeof r.excluded_reason !== "string" || !r.excluded_reason.trim())) errors.push("excluded_reason");
  if (r.includes !== undefined && (typeof r.includes !== "object" || r.includes === null || Array.isArray(r.includes))) errors.push("includes");
  return errors;
}

function row(r, ownerId) {
  return {
    owner_id: ownerId,
    seed_key: r.seed_key,
    provider: r.provider.trim(),
    source_url: r.source_url ?? null,
    checked_on: r.checked_on ?? r.observed_on,
    observed_on: r.observed_on,
    location: r.location ?? null,
    region: r.region ?? "qatar",
    service_type: r.service_type,
    comparable_scope: r.comparable_scope ?? null,
    media_type: r.media_type ?? null,
    price_from: r.price_from,
    price_to: r.price_to ?? null,
    currency: (r.currency ?? "QAR").toUpperCase(),
    duration_hours: r.duration_hours ?? r.includes?.hours ?? null,
    staffing_count: r.staffing_count ?? null,
    athlete_count: r.athlete_count ?? r.includes?.athletes ?? null,
    includes: r.includes ?? {},
    deliverables: r.deliverables ?? null,
    editing_revisions: r.editing_revisions ?? null,
    usage_rights: r.usage_rights ?? null,
    travel_tax_notes: r.travel_tax_notes ?? null,
    promotion_expires_on: r.promotion_expires_on ?? null,
    source_type: r.source_type ?? "other",
    confidence: r.confidence ?? "unverified",
    excluded: r.excluded === true,
    excluded_reason: r.excluded === true ? r.excluded_reason : null,
    notes: r.notes ?? null,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const file = resolve(arg("--file", "scripts/pricing/seed-references.json"));
  const ownerId = arg("--owner", process.env.PRICING_OWNER_ID ?? null);
  if (!ownerId || !UUID.test(ownerId)) fail("pass --owner <uuid> (the owner's auth.users id) or set PRICING_OWNER_ID");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !key)) fail("set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");

  const doc = JSON.parse(readFileSync(file, "utf8"));
  const records = Array.isArray(doc) ? doc : Array.isArray(doc.references) ? doc.references : null;
  if (!records) fail("the file must hold a JSON array or an object with a references array");
  const today = new Date().toISOString().slice(0, 10);

  const valid = [];
  let invalid = 0;
  for (const r of records) {
    const errors = validate(r, today);
    if (errors.length) {
      invalid += 1;
      console.warn(`skip ${r.seed_key ?? "(no seed_key)"}: invalid ${errors.join(", ")}`);
      continue;
    }
    valid.push(r);
  }
  const keys = new Set(valid.map((r) => r.seed_key));
  if (keys.size !== valid.length) fail("duplicate seed_key values in the file");

  let existing = new Set();
  let supabase = null;
  if (!dryRun) {
    supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.from("photo_price_references").select("seed_key").eq("owner_id", ownerId).in("seed_key", [...keys]);
    if (error) fail(`reading existing seed keys: ${error.message}`);
    existing = new Set((data ?? []).map((d) => d.seed_key));
  }
  const toInsert = valid.filter((r) => !existing.has(r.seed_key)).map((r) => row(r, ownerId));
  console.log(`${records.length} records: ${valid.length} valid, ${invalid} invalid, ${existing.size} already present, ${toInsert.length} to insert${dryRun ? " (dry run: nothing written)" : ""}`);
  for (const r of toInsert) console.log(`  + ${r.seed_key}  ${r.provider}  ${r.price_from} ${r.currency}  [${r.comparable_scope ?? "unlabelled"}; ${r.confidence}; ${r.source_type}${r.excluded ? "; EXCLUDED" : ""}]`);
  if (dryRun || toInsert.length === 0) return;
  const { error } = await supabase.from("photo_price_references").insert(toInsert);
  if (error) fail(`insert failed: ${error.message}`);
  console.log(`inserted ${toInsert.length}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
