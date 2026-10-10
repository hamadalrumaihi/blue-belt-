#!/usr/bin/env node
// Blue Belt Media photo curation pipeline. Reads a photography library
// (your H:\ drive or photos/incoming), never writes to it, and produces a
// curated set of web copies plus a manifest and a review report.
//
//   node scripts/photos/run.mjs scan    --source "H:\"      # inventory (fast, header-only)
//   node scripts/photos/run.mjs analyze --source "H:\"      # metrics, hashes, vision (resumable, cached)
//   node scripts/photos/run.mjs select  --source "H:\"      # shortlist, placements, web copies, manifest, report
//   node scripts/photos/run.mjs all     --source "H:\"
//
// Flags: --source <dir> (default photos/incoming), --limit N, --batch N (default 200),
// --concurrency N (default 4), --model <id>, --per-cluster N (frames per burst sent to
// vision, default 2), --no-vision, --dry-run, --jpeg-only. See photos/README.md.
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { discover, inspect, percentile, quickInfo, visionJpeg } from "./lib.mjs";
import { clusterDuplicates, plan, scoreRecord } from "./select.mjs";
import { analyseImage, createVisionClient, DEFAULT_MODEL, mapLimit, VisionCache } from "./vision.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const PHOTOS = path.join(ROOT, "photos");
const CACHE = path.join(PHOTOS, "cache");
const REPORT = path.join(PHOTOS, "report");
const PUBLIC = path.join(ROOT, "public", "photos");
const INVENTORY = path.join(CACHE, "inventory.json");
const ANALYSIS = path.join(CACHE, "analysis.json");
const OVERRIDES = path.join(PHOTOS, "overrides.json");

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("--")) ?? "all";
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const SOURCE = path.resolve(opt("source", process.env.PHOTO_SOURCE || path.join(PHOTOS, "incoming")));
const limit = Number(opt("limit", "0")) || 0;
const batchSize = Math.max(10, Number(opt("batch", "200")) || 200);
const concurrency = Math.max(1, Number(opt("concurrency", "4")) || 4);
const perCluster = Math.max(1, Number(opt("per-cluster", "2")) || 2);
const model = opt("model", process.env.PHOTO_VISION_MODEL || DEFAULT_MODEL);
const dryRun = flag("dry-run");
const noVision = flag("no-vision");
const jpegOnly = flag("jpeg-only");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Atomic write so an interrupted run never leaves a half-written cache behind. */
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

async function assertSource() {
  try {
    const { stat } = await import("node:fs/promises");
    if (!(await stat(SOURCE)).isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`Source folder not accessible: ${SOURCE}\nPass --source "H:\\" (or another folder) or copy photographs into photos/incoming.`);
    process.exit(2);
  }
  console.log(`Source: ${SOURCE}`);
}

/** Step 1: list every photograph with its header data. Resumable: files already listed with the same size and mtime are kept. */
async function scan() {
  await assertSource();
  const extensions = jpegOnly ? new Set([".jpg", ".jpeg"]) : undefined;
  let lastLog = 0;
  const files = await discover(SOURCE, {
    extensions,
    onDir: (dir, n) => {
      if (Date.now() - lastLog > 2000) {
        console.log(`  scanning ${path.relative(SOURCE, dir) || "."} (${n} so far)`);
        lastLog = Date.now();
      }
    },
  });
  console.log(`Found ${files.length} image file(s).`);
  const previous = new Map((await readJson(INVENTORY, { items: [] })).items.map((i) => [i.file, i]));
  const items = [];
  let reused = 0;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const infos = await mapLimit(batch, concurrency, async (file) => {
      const relative = path.relative(SOURCE, file);
      const prev = previous.get(relative);
      const { stat } = await import("node:fs/promises");
      const st = await stat(file);
      if (prev && prev.bytes === st.size && prev.mtimeMs === Math.round(st.mtimeMs)) {
        reused++;
        return prev;
      }
      return quickInfo(file, SOURCE);
    });
    items.push(...infos);
    if (!dryRun) await writeJson(INVENTORY, { source: SOURCE, scannedAt: new Date().toISOString(), items });
    console.log(`  inventoried ${Math.min(i + batchSize, files.length)}/${files.length}`);
  }
  const readable = items.filter((i) => i.readable);
  const byDir = new Map();
  for (const i of readable) byDir.set(i.dir, (byDir.get(i.dir) ?? 0) + 1);
  if (!dryRun) {
    await mkdir(REPORT, { recursive: true });
    const csv = ["file,folder,bytes,width,height,takenAt,camera"].concat(items.map((i) => [i.file, i.dir, i.bytes, i.width ?? "", i.height ?? "", i.exif.takenAt ?? "", [i.exif.make, i.exif.model].filter(Boolean).join(" ")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))).join("\n");
    await writeFile(path.join(REPORT, "inventory.csv"), csv);
  }
  console.log(`Inventory: ${readable.length} readable (${reused} unchanged since last scan, ${items.length - readable.length} unreadable), ${byDir.size} folder(s).`);
  return items;
}

/**
 * Step 2: pixel analysis and vision, in batches, persisted after every batch
 * so an interrupted run resumes where it stopped. Bursts are detected first
 * from the cheap hashes, and only the sharpest `perCluster` frames of each
 * burst are sent to the vision model.
 */
async function analyze() {
  await assertSource();
  let inventory = await readJson(INVENTORY, null);
  if (!inventory || inventory.source !== SOURCE) inventory = { items: await scan() };
  let items = inventory.items.filter((i) => i.readable);
  if (limit) items = items.slice(0, limit);
  const done = new Map((await readJson(ANALYSIS, [])).map((r) => [r.file, r]));
  const todo = items.filter((i) => !done.has(i.file) || done.get(i.file).bytes !== i.bytes);
  console.log(`Analysing ${todo.length} of ${items.length} image(s); ${items.length - todo.length} already analysed.`);

  const cache = new VisionCache(path.join(CACHE, "vision"));
  // The API client is created on first use, so a run that is fully cached needs no key.
  let client = null;
  const getClient = () => (client ??= createVisionClient());
  let visionCalls = 0;
  let refused = 0;
  let unreadable = 0;

  // Pass A: technical metrics and hashes (CPU only, resumable).
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const recs = await mapLimit(batch, concurrency, async (item) => {
      const info = await inspect(path.join(SOURCE, item.file));
      if (!info.ok) {
        unreadable++;
        return { ok: false, file: item.file, reason: info.reason };
      }
      return { ok: true, file: item.file, relative: item.file, name: item.name, dir: item.dir, ...info, vision: null };
    });
    for (const r of recs) done.set(r.file, r);
    if (!dryRun) await writeJson(ANALYSIS, [...done.values()]);
    console.log(`  measured ${Math.min(i + batchSize, todo.length)}/${todo.length}`);
  }

  // Pass B: vision on burst representatives.
  if (!noVision) {
    const ok = [...done.values()].filter((r) => r.ok && items.some((i) => i.file === r.file));
    const batchSharp = ok.map((r) => r.metrics.sharpness);
    for (const r of ok) r.score = percentile(batchSharp, r.metrics.sharpness) * 100; // provisional, for picking burst representatives
    const reps = clusterDuplicates(ok).flatMap((c) => c.members.slice(0, perCluster));
    const need = reps.filter((r) => !r.vision);
    console.log(`Vision: ${reps.length} representative frame(s) from ${ok.length} (bursts collapsed); ${need.length} not yet assessed.`);
    for (let i = 0; i < need.length; i += batchSize) {
      const batch = need.slice(i, i + batchSize);
      await mapLimit(batch, concurrency, async (r) => {
        let vision = await cache.get(r.sha256);
        if (!vision) {
          try {
            vision = await analyseImage(getClient(), await visionJpeg(path.join(SOURCE, r.file)), { model });
            visionCalls++;
            await cache.set(r.sha256, vision);
          } catch (err) {
            console.warn(`  vision failed for ${r.file}: ${err instanceof Error ? err.message : String(err)}`);
            return;
          }
        }
        if (vision.refused) refused++;
        r.vision = vision;
      });
      if (!dryRun) await writeJson(ANALYSIS, [...done.values()]);
      console.log(`  assessed ${Math.min(i + batchSize, need.length)}/${need.length}`);
    }
    for (const r of ok) delete r.score;
    if (!dryRun) await writeJson(ANALYSIS, [...done.values()]);
  }
  console.log(`Done: ${visionCalls} new vision call(s), ${refused} refused, ${unreadable} unreadable.`);
}

/** A descriptive, non-identifying public file name: category plus content id. */
function publicName(rec) {
  return `bbm-${rec.vision.category.replace(/_/g, "-")}-${rec.id}.jpg`;
}

/** Step 3: score, choose, write web copies, manifest and report. */
async function select() {
  const records = (await readJson(ANALYSIS, [])).filter((r) => r.ok);
  if (!records.length) {
    console.log("Nothing analysed yet. Run `analyze` first.");
    return;
  }
  const overrides = await readJson(OVERRIDES, {});
  const batch = { sharpness: records.map((r) => r.metrics.sharpness) };
  for (const r of records) Object.assign(r, scoreRecord(r, batch));
  const { placements, usable, shortlist, excludedByOverride } = plan(records, overrides);
  const selectedIds = new Set([placements.hero, ...placements.heroAlternates, ...placements.featured, ...Object.values(placements.services).flat(), ...placements.shortlist].filter(Boolean));
  const selected = usable.filter((r) => selectedIds.has(r.id));
  const assessed = records.filter((r) => r.vision && !r.vision.refused).length;
  console.log(`${records.length} analysed, ${assessed} assessed by vision, ${usable.length} usable after exclusions and duplicates, shortlist ${shortlist.length}, ${selected.length} with a slot (hero: ${placements.hero ? "yes" : "none"}, featured: ${placements.featured.length}).`);
  if (dryRun) {
    for (const r of [...selected].sort((a, b) => b.score - a.score)) console.log(`  ${r.score.toString().padStart(5)}  ${r.vision.category.padEnd(18)} ${r.file}`);
    return;
  }

  await mkdir(PUBLIC, { recursive: true });
  await mkdir(path.join(REPORT, "thumbs"), { recursive: true });
  const existing = await readJson(path.join(PUBLIC, "manifest.json"), { photos: {} });
  const photos = {};
  for (const r of selected) {
    const src = path.join(SOURCE, r.file);
    const name = publicName(r);
    const out = path.join(PUBLIC, name);
    const prev = existing.photos?.[r.id];
    let { width, height, blurDataURL } = prev ?? {};
    if (!prev || prev.src !== `/photos/${name}`) {
      // sRGB JPEG master, max 2560px, all metadata (EXIF, GPS, camera) dropped. next/image makes AVIF/WebP and every width from it.
      const info = await sharp(src, { failOn: "error" }).rotate().resize(2560, 2560, { fit: "inside", withoutEnlargement: true }).toColourspace("srgb").jpeg({ quality: 84, mozjpeg: true }).toFile(out);
      width = info.width;
      height = info.height;
      const blur = await sharp(out).resize(20, 20, { fit: "inside" }).jpeg({ quality: 40 }).toBuffer();
      blurDataURL = `data:image/jpeg;base64,${blur.toString("base64")}`;
    }
    await sharp(src, { failOn: "error" }).rotate().resize(480, 480, { fit: "inside" }).jpeg({ quality: 70 }).toFile(path.join(REPORT, "thumbs", `${r.id}.jpg`));
    photos[r.id] = {
      src: `/photos/${name}`,
      width,
      height,
      alt: overrides.alt?.[r.id] ?? overrides.alt?.[r.file] ?? r.vision.description,
      category: r.vision.category,
      focal: r.vision.focal_point,
      textSpace: r.vision.text_space,
      blurDataURL,
      needsReview: r.needsReview,
      score: r.score,
      takenAt: r.exif?.takenAt ?? null,
      folder: r.dir,
      source: r.file,
    };
  }
  for (const [id, p] of Object.entries(existing.photos ?? {})) if (!photos[id] && p.src) await rm(path.join(ROOT, "public", p.src), { force: true });

  const manifest = { generatedAt: new Date().toISOString(), source: path.basename(SOURCE), placements, photos };
  await writeFile(path.join(PUBLIC, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeReport({ records, usable, selected, placements, excludedByOverride, manifest });
  console.log(`Wrote ${Object.keys(photos).length} web copies to public/photos, the manifest, photos/report/selection.md and photos/report/contact-sheet.html.`);
  console.log("Next: open the contact sheet, then approve and publish in the website's Featured work page (Studio > Featured work).");
}

async function writeReport({ records, usable, selected, placements, excludedByOverride, manifest }) {
  const slotOf = (id) => {
    const slots = [];
    if (placements.hero === id) slots.push("hero");
    if (placements.heroAlternates.includes(id)) slots.push("hero alternate");
    if (placements.featured.includes(id)) slots.push("featured");
    for (const [t, ids] of Object.entries(placements.services)) if (ids.includes(id)) slots.push(t);
    if (!slots.length && placements.shortlist.includes(id)) slots.push("shortlist only");
    return slots.join(", ");
  };
  const row = (r) => `| ${r.file} | ${r.id} | ${r.vision.category} | ${r.score} | ${r.reasons.join("; ")} | ${slotOf(r.id)} | ${(r.vision.issues ?? []).join("; ") || "-"} | ${r.needsReview ? "yes" : "no"} |`;
  const sorted = [...selected].sort((a, b) => b.score - a.score);
  const md = [
    `# Photo selection report`,
    ``,
    `Generated ${manifest.generatedAt} from ${manifest.source}. ${records.length} analysed, ${usable.length} usable, ${placements.shortlist.length} shortlisted, ${selected.length} with a slot.`,
    `Review the contact sheet at photos/report/contact-sheet.html. Approve, reorder and publish in the website under Studio > Featured work; pin or exclude in photos/overrides.json for the next run.`,
    ``,
    `## Placements`,
    ``,
    `- Hero: ${placements.hero ?? "none"} (alternates: ${placements.heroAlternates.join(", ") || "none"})`,
    `- Featured work: ${placements.featured.length}`,
    ...Object.entries(placements.services).map(([t, ids]) => `- ${t}: ${ids.length}`),
    ``,
    `## Shortlist`,
    ``,
    `| File | Id | Category | Score | Why | Placement | Issues | Needs approval |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...sorted.map(row),
    ``,
    `## Excluded`,
    ``,
    `| File | Reason |`,
    `| --- | --- |`,
    ...records.filter((r) => r.exclude.length).map((r) => `| ${r.file} | ${r.exclude.join("; ")} |`),
    ...excludedByOverride.map((id) => `| ${id} | excluded in overrides.json |`),
    ``,
  ].join("\n");
  await writeFile(path.join(REPORT, "selection.md"), md);

  const card = (r) => `<figure><img src="thumbs/${r.id}.jpg" alt="" loading="lazy"><figcaption><b>${r.score}</b> · ${r.vision.category}<br><code>${r.file}</code><br>${slotOf(r.id)}${r.needsReview ? " · <mark>approve</mark>" : ""}</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Blue Belt Media photo selection</title><style>body{font:14px system-ui;margin:24px;background:#0b1f3a;color:#fff}h1{font-size:20px}section{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}figure{margin:0;background:#12294a;border-radius:12px;padding:8px}img{width:100%;height:180px;object-fit:cover;border-radius:8px}figcaption{margin-top:6px;line-height:1.4}code{font-size:11px;color:#9fb6d6}mark{background:#f5a623;color:#000;padding:0 4px;border-radius:4px}</style><h1>Shortlist (${sorted.length})</h1><section>${sorted.map(card).join("")}</section>`;
  await writeFile(path.join(REPORT, "contact-sheet.html"), html);
  await copyFile(path.join(PUBLIC, "manifest.json"), path.join(REPORT, "manifest.snapshot.json"));
}

if (!["scan", "analyze", "select", "all"].includes(cmd)) {
  console.error(`Unknown command "${cmd}". Use scan, analyze, select or all.`);
  process.exit(1);
}
if (cmd === "scan") await scan();
if (cmd === "analyze" || cmd === "all") await analyze();
if (cmd === "select" || cmd === "all") await select();
