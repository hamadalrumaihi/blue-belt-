import type { Metadata } from "next";
import Link from "next/link";
import { ShieldIcon } from "@/components/icons";
import { CompetitionFaq } from "@/components/public/CompetitionFaq";
import { resolveWizardEntry, toPublicServiceOption } from "@/lib/bookings/public-form";
import { COMPETITION_SERVICES, SERVICE_DEFINITIONS } from "@/lib/catalog";
import { applyFaqOverrides, competitionFaqs, FAQ_ITEMS } from "@/lib/catalog/faq";
import { inquiryHref } from "@/lib/inquiries/labels";
import { pageMetadata } from "@/lib/seo";
import { listPublicEvents } from "@/lib/studio/public-events";
import { loadPublicStudio } from "@/lib/studio/queries";
import { readPublishedFaqOverrides } from "@/lib/studio/site-content";
import { BookingWizard } from "./BookingWizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Book photography or video coverage in Doha",
  description: "Request tournament, athlete, team, training or portrait photo and video coverage in Qatar. We reply by e-mail; nothing is paid until the scope and the price are confirmed in writing.",
  path: "/book",
});

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

/**
 * The request wizard. Entry points keep working: `?service=<catalog key>`,
 * `?audience=`, legacy `?type=<booking type>` and `?kind=<legacy kind>`,
 * `?media=<scope>`, `?service=<package id>` from the services page and
 * `?event=`. Prices reach the wizard only as labels (quote-mode packages
 * never show or book a number) and descriptions are stripped of seed
 * placeholders. "Before you book: competition coverage" sits under the
 * wizard whenever the request may be a competition booking.
 */
export default async function BookPage({ searchParams }: PageProps<"/book">) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  if (!pub || !pub.studio.public_booking) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center lg:px-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lightblue text-primary"><ShieldIcon size={24} /></span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-navy">Online requests open soon</h1>
        <p className="mt-3 text-base text-muted">We are not taking requests through the website yet. Send us an inquiry and we will arrange it with you.</p>
        <Link href={inquiryHref("booking_question", "/book")} data-umami-event="contact-click" className="btn-primary mt-6">Contact & Inquiries</Link>
      </main>
    );
  }
  const events = await listPublicEvents(pub.studio.owner_id);
  // Prices reach the browser only as a label; quote-mode packages carry no number.
  const services = pub.services.map(toPublicServiceOption);
  const entry = resolveWizardEntry({ service: first(params.service), audience: first(params.audience), type: first(params.type), kind: first(params.kind), event: first(params.event), media: first(params.media) }, { events, services });
  const showCompetition = !entry.service || COMPETITION_SERVICES.includes(entry.service);
  const faqs = showCompetition ? competitionFaqs(applyFaqOverrides(FAQ_ITEMS, readPublishedFaqOverrides(pub.studio.settings))) : [];
  return (
    <main className="bg-page">
      <div className="mx-auto max-w-2xl px-4 py-10 lg:px-8 lg:py-14">
        <p className="eyebrow">Book {pub.studio.business_name}</p>
        <h1 className="mt-2 text-xl font-bold text-ink">Coverage request</h1>
        <div className="card mt-6 p-5 sm:p-8">
          <BookingWizard events={events} services={services} entry={entry} />
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          Prefer to talk first, or planning a photoshoot, video or custom project instead? <Link href={inquiryHref(entry.service ? "booking_question" : "general", "/book")} data-umami-event="contact-click" className="font-semibold text-primary">Send an inquiry</Link>. What each service includes is on the <Link href={entry.service ? `/services/${SERVICE_DEFINITIONS[entry.service].slug}` : "/services"} className="font-semibold text-primary">services page</Link>.
        </p>
        {faqs.length > 0 && (
          <section className="mt-10" aria-labelledby="before-you-book-heading">
            <p className="eyebrow">Before you book</p>
            <h2 id="before-you-book-heading" className="mt-1 text-lg font-extrabold text-ink">Competition coverage</h2>
            <p className="mt-1 mb-4 text-sm text-muted">The conditions every competition booking works under, for individual athletes, clubs and teams alike.</p>
            <CompetitionFaq items={faqs} locale="en" variant="plain" from="/book" />
          </section>
        )}
      </div>
    </main>
  );
}
