#!/usr/bin/env node
// Blue Belt Media: import the best photographs from a folder on the owner's PC
// into the media library (Supabase Storage + photo_media_assets). Owner-only;
// runs on the owner's machine with the service-role key, never on Vercel.
//
//   npm run photos:import -- --source "H:\2026\Qatar Open" --dry-run
//   npm run photos:import -- --source "H:\2026\Qatar Open" --limit 150 --suggest-placements
//   npm run photos:import -- --source "H:\" --vision --vision-cap 80 --resume
//
// Flags
//   --source <dir>         required; the folder to read (nothing outside it is ever touched)
//   --dry-run              measure, rank and report; upload nothing (needs no credentials)
//   --limit N              import at most N photographs (best first); 0 = all usable
//   --batch N              files measured per batch (default 100)
//   --concurrency N        files decoded at once (default 4)
//   --resume               skip files already imported in an earlier run (photos/cache/import-state.json)
//   --suggest-placements   add hero / featured / service suggestions to the report (nothing is placed)
//   --vision               opt-in Claude assessment of the top --vision-cap candidates (ANTHROPIC_API_KEY)
//   --vision-cap N         how many candidates vision may look at (default 50)
//   --min-score N          below this score a frame is reported but not imported (default 40)
//   --report <path>        markdown report path (default photos/report/import-<timestamp>.md; JSON beside it)
//
// Environment (shell only, never committed): SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
// SUPABASE_SERVICE_ROLE_KEY, MEDIA_OWNER_ID. ANTHROPIC_API_KEY only with --vision.
//
// Guarantees: originals are read, never modified, renamed, moved or deleted; nothing
// is written to the public bucket (web copies stay private until the owner publishes); no
// local path is stored in the database (only a hash of the basename); every
// imported photograph lands as `ready`, never `published`; the same bytes are
// never stored twice for the same owner.
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { basenameHash, buildWebDerivatives, discover, EXT_FOR_FORMAT, inspect, MEDIA_MAX_BYTES, MEDIA_MIN_LONG_EDGE, MIME_FOR_FORMAT, percentile, visionJpeg } from "./lib.mjs";
import { clusterDuplicates, HERO_MIN_LONG_EDGE, pickDiverse, plan, scoreRecord } from "./select.mjs";
import { analyseImage, createVisionClient, DEFAULT_MODEL, mapLimit, VisionCache } from "./vision.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const PHOTOS = path.join(ROOT, "photos");
const CACHE = path.join(PHOTOS, "cache");
const REPORT_DIR = path.join(PHOTOS, "report");
const STATE_FILE = path.join(CACHE, "import-state.json");
// Originals and web copies both go to the private bucket; only publishMedia (in the website)
// copies web copies to bbm-media-public, after the owner confirmed rights.
const PRIVATE_BUCKET = "bbm-media-private";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const sourceArg = opt("source", null);
const dryRun = flag("dry-run");
const limit = Math.max(0, Number(opt("limit", "0")) || 0);
const batchSize = Math.max(10, Number(opt("batch", "100")) || 100);
const concurrency = Math.max(1, Math.min(16, Number(opt("concurrency", "4")) || 4));
const resume = flag("resume");
const suggest = flag("suggest-placements");
const useVision = flag("vision");
const visionCap = Math.max(1, Number(opt("vision-cap", "50")) || 50);
const minScore = Math.max(0, Number(opt("min-score", "40")) || 40);
const model = opt("model", process.env.PHOTO_VISION_MODEL || DEFAULT_MODEL);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const reportPath = path.resolve(opt("report", path.join(REPORT_DIR, `import-${stamp}.md`)));

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

if (!sourceArg) fail('Pass --source "<folder>" (for example --source "H:\\2026\\Qatar Open"). The import never assumes a drive on its own.');
const SOURCE = path.resolve(sourceArg);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}
function sanitizeMessage(message) {
  // Error messages may echo a path; keep only what is useful and never a drive path.
  return String(message).replace(/[A-Za-z]:\\[^\s"']+/g, "<path>").replace(SOURCE, "<source>").slice(0, 400);
}
function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in your shell. They are never read from the repository.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
function ownerId() {
  const id = (process.env.MEDIA_OWNER_ID || "").trim().toLowerCase();
  if (!UUID_RE.test(id)) fail("Set MEDIA_OWNER_ID to your user id (Supabase → Authentication → Users → UID).");
  return id;
}

/** Provisional 0..100 score from the technical signals alone (vision, when used, replaces it through scoreRecord). */
function technicalScore(rec, sharpnessValues) {
  const sharpP = percentile(sharpnessValues, rec.metrics.sharpness);
  const exp = rec.metrics.exposure;
  let s = sharpP * 45;
  s += (1 - Math.min(1, rec.metrics.noise / 12)) * 15;
  s += exp.mean > 0.18 && exp.mean < 0.8 ? 15 : 5;
  s += rec.longEdge >= HERO_MIN_LONG_EDGE ? 15 : rec.longEdge >= 1600 ? 10 : 4;
  s += rec.metrics.contrast > 0.12 ? 10 : 4;
  return Math.round(s * 10) / 10;
}

/** Hard technical problems that keep a frame out regardless of taste. */
function technicalExclusions(rec) {
  const out = [];
  if (!MIME_FOR_FORMAT[rec.format]) out.push(`unsupported format (${rec.format})`);
  if (rec.bytes > MEDIA_MAX_BYTES) out.push("larger than 40 MB");
  if (rec.longEdge < MEDIA_MIN_LONG_EDGE) out.push(`too small for the web (${rec.longEdge}px)`);
  if (rec.longEdge > 12000) out.push(`too large (${rec.longEdge}px)`);
  if (rec.metrics.exposure.highlightsClipped > 0.12) out.push("large blown-out area");
  if (rec.metrics.exposure.shadowsClipped > 0.5) out.push("mostly crushed shadows");
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  try {
    if (!(await stat(SOURCE)).isDirectory()) throw new Error("not a directory");
  } catch {
    fail(`Source folder not accessible: ${SOURCE}`);
  }
  if (/^[A-Za-z]:\\?$/.test(sourceArg.trim()) || SOURCE === path.parse(SOURCE).root) console.log(`Note: scanning an entire drive (${SOURCE}). Point --source at an event folder for a faster, more focused run.`);
  console.log(`Source: ${SOURCE}${dryRun ? " (dry run: nothing is uploaded)" : ""}`);

  const owner = dryRun ? (process.env.MEDIA_OWNER_ID || "").toLowerCase() : ownerId();
  const supabase = dryRun ? null : serviceClient();

  // 1. Discover and measure (resumable per file).
  const state = resume ? await readJson(STATE_FILE, { files: {} }) : { files: {} };
  if (resume && state.source && state.source !== SOURCE) console.log("Resume state belongs to another source folder; starting fresh for this one.");
  const done = resume && state.source === SOURCE ? state.files : {};
  state.source = SOURCE;
  state.files = done;

  let lastLog = 0;
  const files = await discover(SOURCE, {
    onDir: (dir, n) => {
      if (Date.now() - lastLog > 2000) {
        console.log(`  scanning ${path.relative(SOURCE, dir) || "."} (${n} so far)`);
        lastLog = Date.now();
      }
    },
  });
  console.log(`Found ${files.length} image file(s).`);
  const todo = files.filter((f) => !done[path.relative(SOURCE, f)]?.assetId);
  if (todo.length !== files.length) console.log(`Resuming: ${files.length - todo.length} already imported earlier.`);

  const records = [];
  const unreadable = [];
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const infos = await mapLimit(batch, concurrency, async (file) => {
      const info = await inspect(file);
      const relative = path.relative(SOURCE, file);
      if (!info.ok) return { ok: false, file: relative, reason: info.reason };
      return { ok: true, file: relative, relative, name: path.basename(file), dir: path.dirname(relative) || ".", abs: file, ...info, vision: null };
    });
    for (const r of infos) (r.ok ? records : unreadable).push(r);
    console.log(`  measured ${Math.min(i + batchSize, todo.length)}/${todo.length}`);
  }

  // 2. Technical exclusions, provisional ranking, duplicate collapse.
  const sharpnessValues = records.map((r) => r.metrics.sharpness);
  for (const r of records) {
    r.exclude = technicalExclusions(r);
    r.score = technicalScore(r, sharpnessValues);
    r.reasons = [`technical ${r.score}/100`];
    r.needsReview = false;
  }
  const technicallyOk = records.filter((r) => !r.exclude.length);
  const clusters = clusterDuplicates(technicallyOk);
  const kept = clusters.map((c) => c.best);
  const burstDrops = technicallyOk.length - kept.length;
  console.log(`${records.length} measured, ${technicallyOk.length} pass the technical checks, ${kept.length} after collapsing ${burstDrops} burst/duplicate frame(s).`);

  // 3. Optional vision on the strongest candidates (cached by content hash; never required).
  let visionCalls = 0;
  if (useVision) {
    if (!process.env.ANTHROPIC_API_KEY) fail("--vision needs ANTHROPIC_API_KEY in your shell. Run without --vision for the technical import.");
    const cache = new VisionCache(path.join(CACHE, "vision"));
    let client = null;
    const candidates = [...kept].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, visionCap);
    console.log(`Vision: assessing up to ${candidates.length} candidate(s) with ${model}.`);
    await mapLimit(candidates, Math.min(concurrency, 4), async (r) => {
      let vision = await cache.get(r.sha256);
      if (!vision) {
        try {
          client ??= createVisionClient();
          vision = await analyseImage(client, await visionJpeg(r.abs), { model });
          visionCalls++;
          await cache.set(r.sha256, vision);
        } catch (err) {
          console.warn(`  vision failed for ${r.file}: ${sanitizeMessage(err instanceof Error ? err.message : err)}`);
          return;
        }
      }
      r.vision = vision;
    });
    const batch = { sharpness: sharpnessValues };
    for (const r of kept) {
      if (!r.vision || r.vision.refused) continue;
      const scored = scoreRecord(r, batch);
      r.score = scored.score;
      r.reasons = scored.reasons;
      r.needsReview = scored.needsReview;
      r.exclude = [...r.exclude, ...scored.exclude];
    }
    console.log(`Vision: ${visionCalls} new call(s), ${kept.filter((r) => r.vision?.refused).length} refused.`);
  }

  // 4. Choose what to import: best first, above the score floor, within --limit.
  const usable = kept.filter((r) => !r.exclude.length);
  const ranked = [...usable].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const belowFloor = ranked.filter((r) => r.score < minScore);
  let chosen = ranked.filter((r) => r.score >= minScore);
  if (limit) chosen = chosen.slice(0, limit);
  console.log(`${chosen.length} photograph(s) selected for import (floor ${minScore}, ${belowFloor.length} below it${limit ? `, limit ${limit}` : ""}).`);

  // 5. Import: upload original → draft row → web copies → ready. Never publishes.
  const imported = [];
  const duplicates = [];
  const failed = [];
  if (!dryRun && chosen.length) {
    const { data: existingRows, error: existingError } = await supabase.from("photo_media_assets").select("id, content_sha256, status").eq("owner_id", owner).in("content_sha256", chosen.map((r) => r.sha256));
    if (existingError) fail(`Could not read the library: ${existingError.message}. Is the migration 20261015110000_media_library.sql applied?`);
    const existing = new Map((existingRows ?? []).map((r) => [r.content_sha256, r]));
    let n = 0;
    for (const r of chosen) {
      n++;
      const label = `${n}/${chosen.length} ${r.file}`;
      const dup = existing.get(r.sha256);
      if (dup) {
        duplicates.push({ file: r.file, assetId: dup.id, status: dup.status });
        done[r.file] = { sha256: r.sha256, assetId: dup.id, status: "duplicate", at: new Date().toISOString() };
        console.log(`  ${label}: already in the library (${dup.status}).`);
        continue;
      }
      const ext = EXT_FOR_FORMAT[r.format];
      const mime = MIME_FOR_FORMAT[r.format];
      const key = `${owner}/${r.sha256}.${ext}`;
      let assetId = null;
      try {
        const original = await readFile(r.abs);
        const up = await supabase.storage.from(PRIVATE_BUCKET).upload(key, original, { contentType: mime, upsert: true, cacheControl: "0" });
        if (up.error) throw new Error(`original upload: ${up.error.message}`);
        const v = r.vision && !r.vision.refused ? r.vision : null;
        const insert = {
          owner_id: owner,
          status: "draft",
          content_sha256: r.sha256,
          original_key: key,
          original_bytes: r.bytes,
          original_width: r.width,
          original_height: r.height,
          mime,
          source: "cli_import",
          source_label: basenameHash(r.file),
          taken_on: r.exif?.takenAt ? r.exif.takenAt.slice(0, 10) : null,
          alt: v?.description ?? "",
          category: v?.category ?? "brand_general",
          focal_x: v?.focal_point?.x ?? 0.5,
          focal_y: v?.focal_point?.y ?? 0.5,
          tags: v?.sport ? [String(v.sport).toLowerCase().slice(0, 40)] : [],
          needs_review: Boolean(r.needsReview),
          review_note: r.needsReview ? [v?.minors_likely ? "possible minor" : null, v?.visible_third_party_branding ? "third-party branding" : null, ["training_session", "athlete_portrait", "behind_the_scenes"].includes(v?.category) ? "private session or portrait" : null].filter(Boolean).join("; ") || null : null,
          // rights_confirmed and guardian_ok are deliberately absent: only the owner sets them in the UI.
        };
        const ins = await supabase.from("photo_media_assets").insert(insert).select("id").single();
        if (ins.error) throw new Error(`row insert: ${ins.error.message}`);
        assetId = ins.data.id;
        await supabase.from("photo_media_assets").update({ status: "processing" }).eq("id", assetId);
        const web = await buildWebDerivatives(original);
        const derivatives = [];
        for (const d of web.derivatives) {
          const dkey = `${owner}/${r.sha256}/${d.width}.jpg`;
          const put = await supabase.storage.from(PRIVATE_BUCKET).upload(dkey, d.buffer, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
          if (put.error) throw new Error(`web copy ${d.width}: ${put.error.message}`);
          derivatives.push({ key: dkey, width: d.width, height: d.height, bytes: d.bytes });
        }
        const upd = await supabase.from("photo_media_assets").update({ status: "ready", error: null, original_width: web.width, original_height: web.height, derivatives, blur_data_url: web.blurDataURL }).eq("id", assetId);
        if (upd.error) throw new Error(`row update: ${upd.error.message}`);
        imported.push({ file: r.file, assetId, score: r.score, category: insert.category, needsReview: insert.needs_review, width: web.width, height: web.height, bytes: r.bytes, derivatives: derivatives.length });
        done[r.file] = { sha256: r.sha256, assetId, status: "ready", at: new Date().toISOString() };
        console.log(`  ${label}: ready (${web.width}×${web.height}, ${derivatives.length} web copies).`);
      } catch (err) {
        const message = sanitizeMessage(err instanceof Error ? err.message : err);
        if (assetId) await supabase.from("photo_media_assets").update({ status: "failed", error: message }).eq("id", assetId);
        failed.push({ file: r.file, assetId, error: message });
        done[r.file] = { sha256: r.sha256, assetId, status: "failed", at: new Date().toISOString(), error: message };
        console.warn(`  ${label}: FAILED ${message}`);
      }
      await writeJson(STATE_FILE, state);
    }
  }

  // 6. Placement suggestions (report only; the owner places and publishes in /media).
  let suggestions = null;
  if (suggest) {
    const assetOf = (r) => imported.find((i) => i.file === r.file)?.assetId ?? duplicates.find((d) => d.file === r.file)?.assetId ?? null;
    const withVision = chosen.filter((r) => r.vision && !r.vision.refused);
    if (withVision.length >= 8) {
      const { placements } = plan(withVision, {}, { minScore });
      const map = (ids) => ids.map((id) => ({ id, file: chosen.find((r) => r.id === id)?.file ?? null, assetId: assetOf(chosen.find((r) => r.id === id) ?? {}) }));
      suggestions = { basis: "vision", hero: placements.hero ? map([placements.hero])[0] : null, heroAlternates: map(placements.heroAlternates), featured: map(placements.featured), services: Object.fromEntries(Object.entries(placements.services).map(([k, v]) => [k, map(v)])) };
    } else {
      const heroPool = chosen.filter((r) => r.orientation === "landscape" && r.longEdge >= HERO_MIN_LONG_EDGE && !r.needsReview);
      const fake = (r) => ({ ...r, vision: { category: r.vision?.category ?? "brand_general" } });
      const heroes = pickDiverse(heroPool.map(fake), 4, { sequencePenalty: 10, categoryPenalty: 0 });
      const featured = pickDiverse(chosen.filter((r) => r.id !== heroes[0]?.id).map(fake), 12, { sequencePenalty: 12, categoryPenalty: 0 });
      const entry = (r) => ({ id: r.id, file: r.file, assetId: assetOf(r) });
      suggestions = { basis: "technical (no vision: categories unknown, so no service suggestions)", hero: heroes[0] ? entry(heroes[0]) : null, heroAlternates: heroes.slice(1).map(entry), featured: featured.map(entry), services: {} };
    }
  }

  // 7. Report (local only; relative paths appear here, never in the database).
  const summary = {
    generatedAt: new Date().toISOString(),
    source: path.basename(SOURCE),
    dryRun,
    counts: { found: files.length, measured: records.length, unreadable: unreadable.length, technicallyExcluded: records.length - technicallyOk.length, burstDuplicates: burstDrops, usable: usable.length, belowFloor: belowFloor.length, selected: chosen.length, imported: imported.length, duplicates: duplicates.length, failed: failed.length, visionCalls },
    selected: chosen.map((r) => ({ file: r.file, id: r.id, score: r.score, longEdge: r.longEdge, orientation: r.orientation, category: r.vision?.category ?? null, needsReview: r.needsReview, reasons: r.reasons })),
    imported,
    duplicates,
    failed,
    excluded: [...records.filter((r) => r.exclude.length).map((r) => ({ file: r.file, reasons: r.exclude })), ...unreadable.map((u) => ({ file: u.file, reasons: [u.reason] }))],
    belowFloor: belowFloor.map((r) => ({ file: r.file, score: r.score })),
    suggestions,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath.replace(/\.md$/, "") + ".json", JSON.stringify(summary, null, 2));
  await writeFile(reportPath, renderMarkdown(summary));
  console.log(`Report: ${reportPath}`);
  if (dryRun) console.log("Dry run finished. Re-run without --dry-run to import; nothing has been uploaded.");
  else console.log(`Imported ${imported.length}, ${duplicates.length} already present, ${failed.length} failed. Everything is "ready" (not published): open the website's Media library to confirm rights, place and publish.`);
}

function renderMarkdown(s) {
  const row = (cells) => `| ${cells.map((c) => String(c ?? "-").replace(/\|/g, "\\|")).join(" | ")} |`;
  const lines = [
    `# Media import report`,
    ``,
    `Generated ${s.generatedAt} from \`${s.source}\`${s.dryRun ? " (dry run)" : ""}.`,
    ``,
    `| Found | Measured | Unreadable | Excluded | Burst dupes | Usable | Below floor | Selected | Imported | Already present | Failed | Vision calls |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    row([s.counts.found, s.counts.measured, s.counts.unreadable, s.counts.technicallyExcluded, s.counts.burstDuplicates, s.counts.usable, s.counts.belowFloor, s.counts.selected, s.counts.imported, s.counts.duplicates, s.counts.failed, s.counts.visionCalls]),
    ``,
    `Next: in the website open **Media library**, filter **Ready**, write or check alt text, tick the rights confirmation (and permission where flagged), place, publish. Nothing is published by this import.`,
    ``,
    `## Selected`,
    ``,
    `| File | Score | Long edge | Category | Review | Asset | Why |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...s.selected.map((r) => row([r.file, r.score, r.longEdge, r.category, r.needsReview ? "yes" : "no", s.imported.find((i) => i.file === r.file)?.assetId ?? s.duplicates.find((d) => d.file === r.file)?.assetId ?? (s.dryRun ? "dry run" : "-"), r.reasons.join("; ")])),
  ];
  if (s.suggestions) {
    const list = (items) => (items.length ? items.map((i) => `${i.file}${i.assetId ? ` (${i.assetId})` : ""}`).join("<br>") : "none");
    lines.push(``, `## Placement suggestions (${s.suggestions.basis})`, ``, `Suggestions only. Set placements in the website under Media library → Placements.`, ``, `| Placement | Photographs |`, `| --- | --- |`, row(["hero", s.suggestions.hero ? list([s.suggestions.hero]) : "none"]), row(["hero alternates", list(s.suggestions.heroAlternates)]), row(["featured", list(s.suggestions.featured)]));
    for (const [slot, items] of Object.entries(s.suggestions.services)) lines.push(row([slot, list(items)]));
  }
  if (s.failed.length) lines.push(``, `## Failed`, ``, `| File | Asset | Error |`, `| --- | --- | --- |`, ...s.failed.map((f) => row([f.file, f.assetId, f.error])));
  if (s.belowFloor.length) lines.push(``, `## Below the score floor (not imported)`, ``, `| File | Score |`, `| --- | --- |`, ...s.belowFloor.map((b) => row([b.file, b.score])));
  if (s.excluded.length) lines.push(``, `## Excluded`, ``, `| File | Reason |`, `| --- | --- |`, ...s.excluded.map((e) => row([e.file, e.reasons.join("; ")])));
  return lines.join("\n") + "\n";
}

await main();
