import type { Metadata } from "next";
import Link from "next/link";
import { ExternalIcon } from "@/components/icons";
import { CtaBand, JsonLd, SectionHeading, Steps } from "@/components/public/blocks";
import { FaqExplorer } from "@/components/public/FaqExplorer";
import { applyFaqOverrides, buildFaqJsonLd, FAQ_ITEMS } from "@/lib/catalog/faq";
import { getLocale } from "@/lib/i18n/server";
import { tr, UI } from "@/lib/i18n/ui";
import { pageMetadata, serializeJsonLd } from "@/lib/seo";
import { loadPublicStudio, pictimeGalleryUrl } from "@/lib/studio/queries";
import { readPublishedFaqOverrides } from "@/lib/studio/site-content";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata({
    title: locale === "ar" ? "كيف نعمل: من الطلب إلى المعرض" : "How it works: from request to gallery",
    description:
      locale === "ar"
        ? "ماذا يحدث بعد إرسال طلب التغطية، وكيف يتم الدفع (عربون 50% إلكترونيًا، والباقي بعد التسليم)، وإجابات الأسئلة الشائعة عن التصوير والفيديو والتسليم."
        : "What happens after you request coverage, how payment works (50% deposit online, the balance after delivery) and answers to the questions people ask about photo, video and delivery.",
    path: "/how-it-works",
    locale,
  });
}

export default async function HowItWorksPage() {
  const [pub, locale] = await Promise.all([loadPublicStudio(), getLocale()]);
  const t = tr(locale);
  const bookingOpen = Boolean(pub?.studio.public_booking);
  const galleryUrl = pictimeGalleryUrl(pub?.studio ?? null);
  // The owner's published overrides (edited under /website) merge with the code catalog.
  const faqs = applyFaqOverrides(FAQ_ITEMS, readPublishedFaqOverrides(pub?.studio.settings));
  const faqLd = serializeJsonLd(buildFaqJsonLd(locale, faqs));

  return (
    <main>
      <JsonLd json={faqLd} />
      <section className="navy-pattern bg-navy text-white">
        <div className="container-x py-12 lg:py-16">
          <p className="eyebrow !text-white/60">{t(UI.how.title)}</p>
          <h1 className="heading-1 mt-3 max-w-3xl text-balance">{t(UI.how.heading)}</h1>
          <p className="mt-4 max-w-2xl text-base text-white/75">{t(UI.how.lead)}</p>
        </div>
      </section>

      <section className="container-x section-sm" aria-labelledby="process-heading">
        <SectionHeading id="process-heading" eyebrow={t(UI.home.processEyebrow)} title={t(UI.home.processTitle)} />
        <div className="mt-8">
          <Steps steps={UI.process.map((s) => ({ title: t(s.title), body: t(s.body) }))} cols={5} />
        </div>
      </section>

      <section className="border-y border-line bg-page" aria-labelledby="payment-heading">
        <div className="container-x section-sm">
          <SectionHeading id="payment-heading" eyebrow={t(UI.common.onlinePayment)} title={t(UI.services.paymentHeading)} />
          <div className="mt-8">
            <Steps steps={UI.payment.map((s) => ({ title: t(s.title), body: t(s.body) }))} />
          </div>
          <p className="mt-6 text-sm text-ink">
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

      <section id="faq" className="container-x section-sm scroll-mt-20" aria-labelledby="faq-heading">
        <SectionHeading id="faq-heading" eyebrow={t(UI.home.faqEyebrow)} title={t(UI.how.faqHeading)} lead={t(UI.how.faqLead)} />
        <div className="mt-8">
          <FaqExplorer items={faqs} locale={locale} />
        </div>
        <p className="mt-6 text-sm text-muted">
          <span className="font-semibold text-ink">{t(UI.how.stillQuestions)}</span> {t(UI.how.stillQuestionsBody)}{" "}
          <Link href="/contact" data-umami-event="contact-click" className="font-semibold text-primary">{t(UI.nav.contact)}</Link>
        </p>
      </section>

      <CtaBand eyebrow={t(UI.home.ctaEyebrow)} title={t(UI.home.ctaTitle)} body={t(UI.home.ctaBody)} href={bookingOpen ? "/book" : "/contact"} label={bookingOpen ? t(UI.nav.requestCoverage) : t(UI.nav.contact)} event={bookingOpen ? "book-start" : "contact-click"} />
    </main>
  );
}
