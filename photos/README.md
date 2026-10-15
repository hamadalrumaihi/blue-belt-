# Photographs for the website

There are two ways to get photographs onto the website. Both end in the same
place: the owner's **Media library** (`Studio → Media library`, `/media`),
where every photograph is described, confirmed, placed and published. The full
reference is `docs/media-library.md`.

| | Path A: upload in the browser | Path B: import from your archive |
| --- | --- | --- |
| Good for | a few photographs at a time | hundreds of frames from a shoot or the whole `H:\` drive |
| Where it runs | `/media` in the website | `npm run photos:import` on your PC |
| What it needs | your owner login | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MEDIA_OWNER_ID` in your shell (never committed); `ANTHROPIC_API_KEY` only with `--vision` |
| Result | photographs **Ready** in the library | photographs **Ready** in the library, plus a report with placement suggestions |

Neither path publishes anything by itself, and neither stores your folder
paths or originals anywhere public. Web copies (sRGB JPEG, 640–2560 px, every
EXIF/GPS/camera field removed) are made server-side; originals stay in a
private bucket.

## Path B: import the best portfolio photos from a folder

On your PC, in the repository:

```powershell
cd C:\path\to\blue-belt-
npm install
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "..."       # Supabase → Settings → API → service_role
$env:MEDIA_OWNER_ID = "<your user UID>"       # Supabase → Authentication → Users

npm run photos:import -- --source "H:\2026\Qatar Open" --dry-run            # measure, rank, report only
npm run photos:import -- --source "H:\2026\Qatar Open" --limit 150 --suggest-placements
```

Or ask Claude in the repository: *"Import the best portfolio photos from this
folder: H:\2026\Qatar Open. Dry run first and show me the report, then import
with a cap of 150 and suggest placements. Do not publish anything."* Claude runs
the dry run, summarises `photos/report/import-<timestamp>.md`, then runs the
import (adding `--vision --vision-cap 60` when you want categories and alt text
pre-filled and `ANTHROPIC_API_KEY` is set).

Flags: `--source <dir>` (required; `H:\` only when you pass it explicitly),
`--dry-run`, `--limit N`, `--batch N`, `--concurrency N`, `--resume`
(`photos/cache/import-state.json`), `--suggest-placements`, `--vision`,
`--vision-cap N`, `--min-score N`, `--report <path>`.

The import reads your folder only, measures and dedupes every frame, drops
technical failures (too small, blown out, unsupported), uploads the chosen
originals privately, renders the web copies and leaves each photograph
**Ready**. It never modifies, renames, moves or deletes an original, never
publishes, and only stores a short hash of each file name (never a path).

Then open `/media`, filter **Ready**, check or write alt text, tick **I hold the
rights** (and **Permission confirmed** where flagged), place and publish.

## Legacy path: the curated manifest (still supported)

The pipeline below predates the media library. It writes web copies into
`public/photos/` plus a manifest, which the legacy **Featured work** page
approves and publishes. The site uses the manifest selection only while the
media library has no placements; once it has, the library wins.

### 1. Run it on your PC against H:\

Requirements: Node.js 22 (already needed for the project), `npm install` once,
and an Anthropic API key for the vision pass (keep it in your shell, never in
the repository):

```powershell
cd C:\path\to\blue-belt-
npm install
$env:ANTHROPIC_API_KEY = "sk-ant-..."

npm run photos -- scan    --source "H:\"      # inventory, header data only, fast
npm run photos -- analyze --source "H:\"      # measurements + vision, resumable
npm run photos -- select  --source "H:\"      # shortlist, placements, web copies, report
```

`--source` accepts any folder, so you can point it at one event
(`--source "H:\2026\Qatar Open"`) for a quick run. `photos/incoming/` remains
the default when no source is given.

What each step does:

1. **scan** walks the drive recursively, skipping system and application
   folders (`$RECYCLE.BIN`, `System Volume Information`, Lightroom previews,
   caches, `node_modules`), and records size, dimensions, EXIF date and
   camera for every JPEG (add `--jpeg-only` to ignore PNG/TIFF/HEIC). It writes
   `photos/cache/inventory.json` and `photos/report/inventory.csv`. A re-scan
   only re-reads files whose size or date changed.
2. **analyze** works in batches of 200 (`--batch`), four files at a time
   (`--concurrency`), and saves after every batch, so you can stop it and run
   it again. Each file gets a sharpness, noise, exposure and resolution
   measurement, a SHA-256 and a perceptual hash. Bursts and re-exports are
   collapsed from the hashes before the vision pass; only the sharpest two
   frames of each burst (`--per-cluster`) are sent to Claude, which classifies
   the frame and scores composition, peak action, emotion, subject clarity,
   technical quality and brand fit, suggests placements, and flags minors,
   sensitive content and third-party branding. Vision results are cached by
   content hash in `photos/cache/vision/`, so nothing is paid for twice.
3. **select** excludes frames with hard problems (tiny, blown out, sensitive,
   blurred without intent), keeps the best of each burst, and builds:
   - a **shortlist** of the strongest 30 to 50 frames, spread across events,
     categories and days;
   - a **hero** plus up to 3 alternates (landscape, at least 2000 px, a clean
     area for the headline, nothing awaiting approval);
   - **featured work** for the home page (8 to 12);
   - frames per service: tournament photography (3 to 5), photo and video
     (2 to 3), team and club (3 to 5), training (3 to 5), athlete portraits
     (3 to 5), other coverage (2 to 3). A slot is left short rather than
     padded with a frame scoring under 55/100.
   It then writes web copies to `public/photos/` (sRGB JPEG, longest edge
   2560 px, every EXIF, GPS and camera field removed, named
   `bbm-<category>-<id>.jpg` with no athlete or event names), a blur
   placeholder per photo, the plan in `public/photos/manifest.json`, and the
   review material in `photos/report/`.

Vision costs roughly one to two thousand input tokens per frame at the default
model (`claude-opus-5-5`). For a first pass over many thousands of frames use
`--model claude-sonnet-5-5`; the cache keeps both. Nothing is sent to the
vision model until the technical pass and burst grouping have cut the count.
Previews sent for assessment are 1024 px JPEGs made on the fly; the full-size
originals are only ever read once for measurement and once for the web copy.

The hardware you described (i7-12700F, 32 GB RAM) handles this comfortably:
the pipeline streams files in batches and never holds more than a handful of
decoded images in memory. The GPU is not used.

### 2. Review, approve, publish

1. Open `photos/report/contact-sheet.html` and `photos/report/selection.md`.
   Rows marked **approve** need your confirmation before they go live: a
   subject who may be under 18, a private training session or portrait, or
   prominent third-party branding. Only publish photographs you hold the
   rights and permissions for.
2. Commit `public/photos/` and `photos/report/selection.md` and push. Web
   copies are not shown anywhere on the site until you publish them.
3. In the website, open **Studio > Featured work**. Every shortlisted photo
   appears there with its slot. Approve or reject, pick the hero, reorder the
   featured set, replace a service image, then switch **Publish** on. Studio
   users see the pending selection on the public pages as a preview before it
   is published; visitors see nothing until it is.

For the next pipeline run, `photos/overrides.json` lets you exclude files,
pin a file to a slot or replace alt text without touching code; the Featured
work page keeps working on top of whatever the pipeline produces.

### 3. What the site does with it

`src/lib/photos/site.ts` prefers the media library's published placements
and falls back to the manifest (`src/lib/photos/manifest.ts`) combined with
your approvals from the studio. The
home hero, the featured section, the services cards and the service
previews use whatever is approved; an empty slot falls back to the
photo-free layout, so the site never breaks on an empty manifest.
`next/image` serves AVIF and WebP in every needed width from the single JPEG
master, with the pipeline's focal point as the crop anchor on phones.
