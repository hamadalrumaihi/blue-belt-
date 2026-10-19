import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { UsersIcon } from "@/components/icons";
import { resolveViewer } from "@/lib/roles";
import { loadStudio } from "@/lib/studio/queries";
import { readTestimonialRecords, readTestimonials, SUPPLIED_REVIEWS } from "@/lib/studio/site-content";
import { AddTestimonial, SuppliedReviews, TestimonialRow } from "./TestimonialEditor";

export const metadata: Metadata = { title: "Testimonials" };
export const dynamic = "force-dynamic";

export default async function TestimonialsPage() {
  const viewer = await resolveViewer();
  if (viewer?.role !== "owner") redirect("/studio");
  const studio = await loadStudio();
  const records = readTestimonialRecords(studio?.settings);
  const live = readTestimonials(studio?.settings).length;
  const needsPermission = records.filter((r) => r.legacy).length;
  const stored = new Set(records.map((r) => r.quote.trim()));
  const supplied = SUPPLIED_REVIEWS.filter((r) => !stored.has(r.quote.trim()));
  return (
    <>
      <BrandHeader title="Testimonials" subtitle="Client words on the website. Only published reviews with written permission are shown; no ratings, no invented names." backHref="/website" />
      <PageBody className="max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{live} live on the website · {records.length} stored{needsPermission ? ` · ${needsPermission} need permission confirmation` : ""}. The public page shows at most 6, newest first. <Link href="/" className="font-semibold text-primary hover:underline" target="_blank" rel="noopener noreferrer">See the home page</Link>.</p>
          <AddTestimonial />
        </div>
        <SuppliedReviews reviews={supplied} />
        {records.length === 0 ? (
          <EmptyState icon={<UsersIcon />} title="No testimonials yet" description="After a delivery, ask the client for a sentence about the experience and their permission to use it. Until there is one, the website hides the section entirely." />
        ) : (
          <ul className="space-y-3">
            {records.map((r) => <TestimonialRow key={r.id} record={r} />)}
          </ul>
        )}
        <p className="text-[11px] text-muted">A review is public only when both boxes are ticked: written permission and published. Minors&rsquo; names are never shown; use the parent&rsquo;s words and name instead. A review without an approved name is shown as &ldquo;Client&rdquo;. Reviews appear on the home page, the services page, How it works and the contact page.</p>
      </PageBody>
    </>
  );
}
