import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ImageIcon } from "@/components/icons";
import { readFeaturedWork } from "@/lib/photos/featured";
import { manifestGeneratedAt, manifestPhotos, manifestPlacements } from "@/lib/photos/manifest";
import { requireStudioUser } from "@/lib/roles";
import { loadStudio } from "@/lib/studio/queries";
import { FeaturedWorkManager } from "./FeaturedWorkManager";

export const metadata: Metadata = { title: "Featured work" };
export const dynamic = "force-dynamic";

/**
 * The owner's review desk for the curated photographs: approve, reject,
 * choose the hero, reorder the featured set and the service images, and
 * publish. Reads the committed manifest (photos/README.md) and the
 * decisions stored on the studio row.
 */
export default async function FeaturedWorkPage() {
  const gate = await requireStudioUser();
  if (!gate.ok) redirect("/login?next=/featured-work");
  const studio = await loadStudio();
  const photos = manifestPhotos();
  const placements = manifestPlacements();
  const work = readFeaturedWork(studio?.settings ?? null);

  return (
    <>
      <BrandHeader title="Featured work" subtitle={photos.length ? `${photos.length} photographs proposed by the pipeline${manifestGeneratedAt() ? `, generated ${new Date(manifestGeneratedAt() as string).toLocaleDateString("en-GB")}` : ""}` : "No curated photographs yet"} />
      <PageBody className="max-w-5xl">
        {photos.length === 0 ? (
          <EmptyState
            icon={<ImageIcon />}
            title="No photographs to review yet"
            description="Run the photo pipeline on your PC against your archive (photos/README.md), commit the web copies it writes to public/photos, and the shortlist appears here for approval."
            action={<Link href="/settings" className="btn-secondary">Back to settings</Link>}
          />
        ) : (
          <>
            {!studio && <p className="mb-4 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">Save your public site settings first (Settings, Public site); approvals are stored on that record.</p>}
            <FeaturedWorkManager photos={photos} placements={placements} initial={work} canSave={Boolean(studio)} />
          </>
        )}
      </PageBody>
    </>
  );
}
