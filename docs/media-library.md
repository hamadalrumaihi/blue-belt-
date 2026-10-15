# Media library

The photographs the public website shows (home hero, featured work, service
cards, the Work page) live in Supabase Storage and are managed by the owner
under **Studio → Media library** (`/media`). This replaces the committed
`public/photos` manifest as the primary source; the manifest and the legacy
**Featured work** page remain as a fallback while the library has no placements.

## Trust boundaries

| Store | What | Who can read | Who can write |
| --- | --- | --- | --- |
| `bbm-media-private` (bucket, not public) | originals as uploaded (`<owner>/<sha256>.<ext>`) | the owner (own folder, via RLS), the service role | the owner (own folder only, through a signed upload URL), the service role (CLI import) |
| `bbm-media-public` (bucket, public) | web copies `<owner>/<sha256>/<width>.jpg` of **published or ready** assets, sRGB JPEG, all metadata removed | anyone with the URL | the service role only; there is no authenticated write policy |
| `photo_media_assets`, `photo_media_placements` (tables) | one row per photograph, placements | owner-role profile only (`photo_is_owner_user()`); public pages read through the service role with an explicit projection | owner only; staff and clients get zero rows |

Facts to keep in mind:

- **Published web copies are public by design.** Once a derivative is in the
  public bucket its URL works for anyone who has it. Unpublishing stops the site
  linking it; archiving also deletes the files from the bucket; neither can
  recall a copy someone already downloaded or that a CDN cached in the meantime.
  Do not publish anything you would need to retract.
- **Drafts never touch the public bucket.** Derivatives are only written after
  the original has been validated server-side, and the public projection
  (`src/lib/media/projection.ts`) only ever emits public-bucket URLs for
  `published` rows (or `ready` rows for a signed-in studio user who asked for a
  preview). A test asserts no private path, owner id, source label or review
  note can appear in the public output.
- **Originals never reach deployed assets.** They stay in the private bucket;
  nothing copies them into `public/` or the Next.js build.
- **Metadata is stripped.** Every derivative is rendered with sharp without
  `withMetadata()`: EXIF (including GPS and camera serials), XMP, IPTC and the
  ICC profile are dropped after the sRGB conversion. The blur placeholder is a
  20 px JPEG data URL stored on the row.
- **Only the owner confirms rights.** `rights_confirmed` and `guardian_ok` are
  set exclusively by `updateMediaMeta` from the owner's UI. The CLI import and
  the vision pass may set `needs_review` and a `review_note`, never the
  confirmations. Publishing requires `rights_confirmed`, plus `guardian_ok`
  when `needs_review` is on. Withdrawing a confirmation on a published asset
  unpublishes it at once.
- **Immutable keys.** A photograph's storage keys are derived from the owner id
  and the SHA-256 of its bytes, validated against a strict pattern on both the
  server and the database (`original_key` check constraint). The same bytes
  cannot be stored twice for one owner (`unique (owner_id, content_sha256)`).

## Setup

1. Apply `supabase/migrations/20261015110000_media_library.sql` (`supabase db
   push` or the SQL editor). It creates both buckets with size and mime limits,
   the two tables, the owner-only RLS policies, the `storage.objects` policies
   and the `updated_at` trigger. It is idempotent.
   - If the `storage.objects` policy statements are refused by the migration
     role, run that section from the dashboard SQL editor (it runs as
     `postgres`, which may create policies on `storage.objects`). Nothing else
     needs the dashboard: the buckets are inserted by SQL.
2. Run `supabase/tests/media_rls.test.sql` against a disposable database; it
   must end with `ROLLBACK_OK: all media RLS assertions passed`.
3. Environment variables on the web deployment (names only; values are secrets):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already present)
   - `SUPABASE_SERVICE_ROLE_KEY` (already present for cron): required for
     processing uploads (writes to the public bucket) and for public reads of
     the library. Without it uploads are stored but stay `failed` with a clear
     message until it is configured.
   - `CRON_SECRET` (already present): authorises `POST /api/media/cleanup`.
4. `next.config.ts` must allow the Supabase host for `next/image`
   (`images.remotePatterns`: `https`, `<project-ref>.supabase.co`,
   `/storage/v1/object/public/bbm-media-public/**`). The owner UI uses plain
   `<img>` for thumbnails, so it works either way; the public pages render
   through `next/image` and need the pattern.
5. Schedule `POST /api/media/cleanup?hours=24` with `Authorization: Bearer
   <CRON_SECRET>` from the same worker that ticks the other cron routes (daily
   is enough). It deletes `draft` rows older than the window and their private
   objects; nothing that was ever processed is touched.

## Path A: upload in the browser

`/media` → drop files. For each file the browser computes the SHA-256, calls
`createMediaUpload({ sha256, bytes, mime, filename })`, which validates the
claim, returns the existing asset when the bytes are already in the library,
or inserts a `draft` row and mints a signed upload URL **with the owner's own
session** (so the private bucket's own-folder policy is what authorises it).
The browser uploads straight to Storage with `uploadToSignedUrl` (no Next.js
body limit), then calls `finalizeMediaUpload(assetId)`: the server downloads the
original with the service client, re-validates the real bytes (format vs claimed
mime, ≤ 40 MB, long edge 1200–12000 px, no SVG/GIF/animation), renders
640/1280/1920/2560 px JPEGs (never upscaled) plus the blur, uploads them to the
public bucket and marks the row `ready`. Failures mark it `failed` with the
reason; **Retry** runs finalize again without re-uploading.

Accepted: JPEG (preferred), PNG, WebP, TIFF, HEIC/HEIF when the server's sharp
build can decode it (the prebuilt binaries usually cannot decode HEIC; export
JPEG instead). Rejected with a message: GIF, SVG, video, anything else.

Then per photograph: alt text, caption, category, tags, focal point (click the
picture in edit mode), sort order, date, **I hold the rights**, and
**Permission confirmed** when flagged. Place it (hero / featured / work /
service) and **Publish**. Studio users see unpublished placed photographs on
the public pages as a preview; `/work?preview=1` is served with `ready` assets
to studio users only (`loadPublicMedia({ preview: true })` checks the viewer).

## Path B: import from the archive (CLI, owner's PC)

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "..."      # Settings → API → service_role; never commit it
$env:MEDIA_OWNER_ID = "<your user UID>"      # Authentication → Users
# optional, only with --vision:
$env:ANTHROPIC_API_KEY = "sk-ant-..."

npm run photos:import -- --source "H:\2026\Qatar Open" --dry-run
npm run photos:import -- --source "H:\2026\Qatar Open" --limit 150 --suggest-placements
```

Flags: `--source <dir>` (required; a whole drive such as `H:\` is accepted only
when passed explicitly), `--dry-run`, `--limit N` (import the best N), `--batch N`,
`--concurrency N`, `--resume` (state in `photos/cache/import-state.json`),
`--suggest-placements`, `--vision` with `--vision-cap N` (default 50),
`--min-score N` (default 40), `--report <path>` (markdown + JSON under
`photos/report/` by default).

What it does: discovers images under `--source` only (system and application
folders skipped, symlinks not followed), measures every file (dimensions, EXIF
date, sharpness, noise, exposure, SHA-256, perceptual hash), excludes technical
failures (too small, blown out, unsupported), collapses bursts and re-exports,
ranks the rest, optionally asks Claude about the top candidates (category, alt
text, focal point, review flags), uploads each chosen original to the private
bucket, inserts a `draft` row (`source = 'cli_import'`, `source_label` = 12 hex
characters of the basename's hash, never a path), renders and uploads the web
copies, and marks the row `ready`. It **never publishes**, never sets
`rights_confirmed`/`guardian_ok`, never modifies, renames, moves or deletes an
original, never scans outside `--source`, and skips bytes already in the
library. The report lists what happened and, with `--suggest-placements`, which
frames would suit the hero, featured and service slots: suggestions only, the
owner places them in `/media`.

### The Claude workflow

Ask, in the repository on your PC:

> Import the best portfolio photos from this folder: `H:\2026\Qatar Open`. Dry
> run first and show me the report, then import with a cap of 150 and suggest
> placements. Do not publish anything.

Claude runs `npm run photos:import -- --source "H:\2026\Qatar Open" --dry-run`,
reads `photos/report/import-<timestamp>.md`, summarises the counts and the top
frames, then runs the real import with `--limit 150 --suggest-placements`
(adding `--vision --vision-cap 60` if you ask for descriptions and categories
and `ANTHROPIC_API_KEY` is set). You then open `/media`, filter **Ready**,
confirm rights and review flags, place and publish.

## Operations

- **Storage usage** is estimated from the rows (originals + web copies) on
  `/media`; it does not list the buckets.
- **Archive** removes the public web copies and keeps the original; **Restore**
  re-renders them. Deleting originals is deliberately not offered in the UI.
- **Cleanup** of abandoned uploads: `POST /api/media/cleanup?hours=24`.
- **Audit**: every action writes `media.*` rows to `photo_audit_log`
  (entity `studio`, entity_id = asset id).
- **Cache**: actions call `revalidatePath` for `/`, `/services`, `/work` and
  `/media`. The public pages fetch the library per request (`react.cache`), so
  the next render reflects the change; browsers and CDNs may hold a published
  JPEG for its `Cache-Control` lifetime (one year, immutable key).

## Code map

- `src/lib/media/types.ts` vocabulary, limits, row → owner model
- `src/lib/media/mime.ts`, `validate.ts` claim/bytes/key validation
- `src/lib/media/process.ts` derivative rendering + public-bucket upload (service role)
- `src/lib/media/queries.ts` owner reads (RLS), counts, usage, placements
- `src/lib/media/public.ts` the public contract (`loadPublicMedia`, `loadPlacedMedia`)
- `src/lib/media/projection.ts` the only row → public item path
- `src/lib/media/placements.ts` placement vocabulary and ordering
- `src/lib/media/rules.ts` publish guard, metadata patch parsing
- `src/lib/media/site-gallery.ts` library → `SiteGallery` for the existing home/services components
- `src/lib/media/cleanup.ts`, `src/app/api/media/cleanup/route.ts`
- `src/lib/actions/media.ts` server actions (owner only)
- `src/app/(app)/media/*` owner UI
- `scripts/photos/import.mjs` CLI import; shared helpers in `scripts/photos/lib.mjs`
- `supabase/migrations/20261015110000_media_library.sql`, `supabase/tests/media_rls.test.sql`
- Tests: `tests/media-*.test.ts`
