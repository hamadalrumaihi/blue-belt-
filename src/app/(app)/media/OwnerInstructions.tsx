import Link from "next/link";

/**
 * Both ingestion paths, written for the owner. Kept next to the manager so
 * the page is self-explaining; the long form is docs/media-library.md.
 */
export function OwnerInstructions() {
  return (
    <section aria-labelledby="instructions-h" className="card p-4 sm:p-5">
      <h2 id="instructions-h" className="text-base font-extrabold text-ink">Owner instructions</h2>
      <div className="mt-3 grid gap-6 md:grid-cols-2">
        <div>
          <p className="eyebrow">A. Upload here (a few photographs at a time)</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink">
            <li>Export JPEGs from Lightroom or Capture One: sRGB, longest edge 2560 to 4000 px, quality 85 or higher. PNG, WebP and TIFF are accepted; HEIC only when the server can decode it.</li>
            <li>Drop the files on the upload area above or pick them. Each file is fingerprinted first, so the same photograph is never stored twice.</li>
            <li>Wait for <strong>Ready</strong>. Every EXIF, GPS and camera field is removed from the web copies; original and web copies stay in private storage until you publish.</li>
            <li>Write alt text (what is visible, no names), choose a category and tags, and click the picture to set the focal point used for crops.</li>
            <li>Tick <strong>I hold the rights</strong>. A photograph flagged for review (possible minor, private session, third-party branding) also needs <strong>Permission confirmed</strong>.</li>
            <li>Add it to a placement (hero, featured, work, a service), then <strong>Publish</strong>: only then are the web copies copied to the public bucket. Check the result as a studio user on <Link href="/work?preview=1" className="font-semibold text-primary">/work?preview=1</Link> and the home page before and after publishing.</li>
          </ol>
        </div>
        <div>
          <p className="eyebrow">B. Import from your archive (hundreds of photographs)</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink">
            <li>On your PC, set <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code> and <code>MEDIA_OWNER_ID</code> in the shell (never in the repository).</li>
            <li>Ask Claude: <em>&ldquo;Import the best portfolio photos from this folder: H:\2026\Qatar Open. Dry run first, then import with a cap of 150, and suggest placements.&rdquo;</em> It runs <code>npm run photos:import -- --source &quot;H:\2026\Qatar Open&quot; --dry-run</code>, shows you the report, then the real run.</li>
            <li>The import measures, dedupes and ranks frames, uploads originals privately, makes the web copies and leaves every photograph <strong>Ready</strong>. It never publishes, never edits or deletes your originals and never stores your folder paths.</li>
            <li>Come back here: filter <strong>Ready</strong>, confirm rights and review flags, place and publish. <code>--vision</code> (opt-in, needs <code>ANTHROPIC_API_KEY</code>) pre-fills category, alt text and the review flag; the technical checks work without any key.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">Published web copies are public by design: unpublishing removes the files from the site and the public bucket at once, but a copy someone already downloaded cannot be recalled. Nothing unpublished is ever in the public bucket. The legacy manifest selection remains at <Link href="/featured-work" className="font-semibold text-primary">Featured work</Link> and is used only while this library has no placements.</p>
        </div>
      </div>
    </section>
  );
}
