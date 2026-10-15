import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ChevronRightIcon, FileTextIcon, ImageIcon, ReceiptIcon, UsersIcon } from "@/components/icons";
import { resolveViewerMode } from "@/lib/collaborator";
import { loadStudio } from "@/lib/studio/queries";
import { openQuestionCounts, readFaqOverrides, readTestimonialRecords } from "@/lib/studio/site-content";

export const metadata: Metadata = { title: "Website" };
export const dynamic = "force-dynamic";

/** Hub for everything the public website shows: media, service content, testimonials, FAQs. */
export default async function WebsitePage() {
  if ((await resolveViewerMode()).collaboratorOnly) redirect("/coverage");
  const studio = await loadStudio();
  const testimonials = readTestimonialRecords(studio?.settings);
  const faqs = readFaqOverrides(studio?.settings);
  const questions = openQuestionCounts(studio?.settings);
  const items = [
    { href: "/media", label: "Portfolio & media", note: "Photos and videos shown on the website and the Work page.", icon: ImageIcon },
    { href: "/packages", label: "Service content", note: "Names, descriptions and public price mode of each service.", icon: ReceiptIcon },
    { href: "/website/testimonials", label: "Testimonials", note: `${testimonials.filter((t) => t.published && t.permission_granted).length} published · ${testimonials.filter((t) => t.legacy).length} need permission confirmation`, icon: UsersIcon },
    { href: "/website/faqs", label: "FAQs & open questions", note: `${faqs.filter((f) => f.published).length} published override${faqs.filter((f) => f.published).length === 1 ? "" : "s"} · ${questions.open} open question${questions.open === 1 ? "" : "s"}`, icon: FileTextIcon },
    { href: "/featured-work", label: "Legacy manifest selection", note: "The old committed-manifest picker. Kept until the media library replaces it.", icon: ImageIcon },
  ];
  return (
    <>
      <BrandHeader title="Website" subtitle="What visitors see. Changes go live on the next page load." />
      <PageBody className="max-w-2xl">
        <ul className="card divide-y divide-line">
          {items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-page">
                <i.icon size={20} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-ink">{i.label}</span><span className="block truncate text-xs text-muted">{i.note}</span></span>
                <ChevronRightIcon size={18} className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted">Business details, contact channels and the public-booking switch live in <Link href="/settings" className="font-semibold text-primary hover:underline">Settings</Link>.</p>
      </PageBody>
    </>
  );
}
