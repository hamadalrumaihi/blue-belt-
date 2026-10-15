import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ShieldIcon } from "@/components/icons";
import { countMedia, listMediaAssets, loadOwnerPlacements, storageUsage } from "@/lib/media/queries";
import { requireOwner } from "@/lib/roles";
import { isServiceClientConfigured } from "@/lib/supabase/service";
import { MediaManager } from "./MediaManager";
import { OwnerInstructions } from "./OwnerInstructions";

export const metadata: Metadata = { title: "Media library" };
export const dynamic = "force-dynamic";

/**
 * The owner's media manager: upload, review, describe, place and publish
 * the photographs the public site shows. Owner only (requireOwner here, RLS
 * photo_is_owner_user in the database); staff see the refusal below.
 * The legacy manifest selection (/featured-work) keeps working as a fallback
 * source until the library has placements.
 */
export default async function MediaPage() {
  const owner = await requireOwner();
  if (!owner.ok) {
    return (
      <>
        <BrandHeader title="Media library" backHref="/more" />
        <PageBody className="max-w-xl">
          <EmptyState icon={<ShieldIcon />} title="Owner only" description="The media library is for the studio owner." action={<Link href="/coverage" className="btn-secondary">Back to my coverage</Link>} />
        </PageBody>
      </>
    );
  }
  const [assets, placements, counts, usage] = await Promise.all([listMediaAssets({ status: "all" }), loadOwnerPlacements(), countMedia(), storageUsage()]);
  const processingAvailable = isServiceClientConfigured();

  return (
    <>
      <BrandHeader title="Media library" subtitle={counts.total ? `${counts.published} published, ${counts.ready} ready, ${counts.archived} archived` : "Nothing uploaded yet"} backHref="/more" />
      <PageBody className="max-w-6xl space-y-8">
        {!processingAvailable && (
          <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Uploads are stored, but web copies cannot be made until it is configured (docs/media-library.md).</p>
        )}
        <MediaManager initialAssets={assets} initialPlacements={placements} counts={counts} usage={usage} />
        <OwnerInstructions />
      </PageBody>
    </>
  );
}
