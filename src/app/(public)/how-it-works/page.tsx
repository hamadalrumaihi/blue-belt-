import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, ExternalIcon } from "@/components/icons";
import { CtaBand, SectionHeading, Steps } from "@/components/public/blocks";
import { Testimonials } from "@/components/public/Testimonials";
import { PAYMENT_BALANCE_NOTE, PAYMENT_POLICY } from "@/lib/catalog/copy";
import { localized } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { tr, UI } from "@/lib/i18n/ui";
import { inquiryHref } from "@/lib/inquiries/labels";
import { pageMetadata } from "@/lib/seo";
import { loadPublicStudio, pictimeGalleryUrl } from "@/lib/studio/queries";
import { readTestimonials } from "@/lib/studio/site-content";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata({
    title: locale === "ar" ? "كيف نعمل: من فكرتك إلى محتواك" : "How it works: from your idea to your content",
    description:
      locale === "ar"
        ? "أربع خطوات لكل مشروع: أخبرنا برؤيتك، نخطط التغطية معك، نلتقط قصتك، وتستلم محتواك. كيف يتم الدفع وأين تجد شروط تغطية المنافسات."
        : "Four steps for every project: tell us your vision, we plan the coverage with you, we capture your story, you receive your content. How payment works and where to read the competition conditions.",
    path: "/how-it-works",
    locale,
  });
}

/**
 * How it works, for tournament customers and general clients alike: the
 * four steps, the payment principle, a pointer to the competition
 * conditions (kept on the booking journey, not repeated here) and two calls
 * to action: Book coverage (the request wizard) and Discuss a project (the
 * inquiry form with the commercial / creative category preselected).
 */
export default async function HowItWorksPage() {
  const [pub, locale] = await Promise.all([loadPublicStudio(), getLocale()]);
  const t = tr(locale);
  const bookingOpen = Boolean(pub?.studio.public_booking);
  const galleryUrl = pictimeGalleryUrl(pub?.studio ?? null);
  const testimonials = pub ? readTestimonials(pub.studio.settings).slice(0, 3) : [];
  const bookHref = bookingOpen ? "/book" : inquiryHref("tournament_event", "/how-it-works");
  const discussHref = inquiryHref("commercial_creative", "/how-it-works");

  return (
    <main>
      <section className="navy-pattern bg-navy text-white">
        <div className="container-x py-12 lg:py-16">
          <p className="eyebrow !text-white/60">{t(UI.how.title)}</p>
          <h1 className="heading-1 mt-3 max-w-3xl text-balance">{t(UI.how.heading)}</h1>
          <p className="mt-4 max-w-2xl text-base text-white/75">{t(UI.how.lead)}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href={bookHref} data-umami-event={bookingOpen ? "book-start" : "contact-click"} className="btn-primary btn-lg shadow-hero">
              {bookingOpen ? t(UI.nav.requestCoverage) : t(UI.nav.getQuote)} <ChevronRightIcon size={18} className="rtl-flip" />
            </Link>
            <Link href={discussHref} data-umami-event="contact-click" data-umami-event-category="commercial_creative" className="btn btn-light btn-lg">{t(UI.nav.discussProject)}</Link>
          </div>
        </div>
      </section>

      <section className="container-x section-sm" aria-labelledby="process-heading">
        <SectionHeading id="process-heading" eyebrow={t(UI.home.processEyebrow)} title={t(UI.home.processTitle)} />
        <div className="mt-8">
          <Steps steps={UI.process.map((s) => ({ title: t(s.title), body: t(s.body) }))} cols={4} />
        </div>
      </section>

      <section className="border-y border-line bg-page" aria-labelledby="payment-heading">
        <div className="container-x section-sm">
          <SectionHeading id="payment-heading" eyebrow={t(UI.common.onlinePayment)} title={t(UI.how.paymentHeading)} lead={localized(PAYMENT_POLICY, locale)} />
          <div className="mt-8">
            <Steps steps={UI.payment.map((s) => ({ title: t(s.title), body: t(s.body) }))} />
          </div>
          <p className="mt-6 text-sm text-ink">{localized(PAYMENT_BALANCE_NOTE, locale)}</p>
          <p className="mt-3 text-sm text-ink">
            {t(UI.services.galleryNote)}{" "}
            <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="inline-flex items-center gap-1 font-semibold text-primary">
              {t(UI.nav.findMyPhotos)} <ExternalIcon size={14} />
              <span className="sr-only">{t(UI.nav.opensGallery)}</span>
            </a>
          </p>
          <p className="mt-2 text-sm text-muted">
            <Link href="/terms" className="font-semibold text-primary">{t(UI.nav.terms)}</Link> · <Link href="/privacy" className="font-semibold text-primary">{t(UI.nav.privacy)}</Link>
          </p>
        </div>
      </section>

      {/* Competition conditions live on the booking journey; this is the signpost. */}
      <section className="container-x section-sm" aria-labelledby="competition-heading">
        <div className="card flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">{t(UI.home.faqEyebrow)}</p>
            <h2 id="competition-heading" className="heading-3 mt-2 text-navy">{t(UI.how.competitionHeading)}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{t(UI.how.competitionBody)}</p>
          </div>
          <Link href="/services/tournament-athlete-coverage#before-you-book" className="btn-secondary shrink-0">
            {t(UI.how.competitionLink)} <ChevronRightIcon size={16} className="rtl-flip" />
          </Link>
        </div>
        <p className="mt-6 text-sm text-muted">
          <span className="font-semibold text-ink">{t(UI.how.stillQuestions)}</span> {t(UI.how.stillQuestionsBody)}{" "}
          <Link href={inquiryHref(null, "/how-it-works")} data-umami-event="contact-click" className="font-semibold text-primary">{t(UI.nav.contactInquiries)}</Link>
        </p>
      </section>

      <Testimonials reviews={testimonials} locale={locale} ctaHref={inquiryHref(null, "/how-it-works")} />

      <CtaBand eyebrow={t(UI.home.ctaEyebrow)} title={t(UI.home.ctaTitle)} body={t(UI.home.ctaBody)} href={bookHref} label={bookingOpen ? t(UI.nav.requestCoverage) : t(UI.nav.getQuote)} event={bookingOpen ? "book-start" : "contact-click"} secondary={{ href: discussHref, label: t(UI.nav.discussProject), event: "contact-click" }} />
    </main>
  );
}
