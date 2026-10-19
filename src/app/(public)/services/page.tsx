import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, ExternalIcon } from "@/components/icons";
import { priceLine, ProjectCategoryCard, ScopeBadges, SectionHeading, ServiceCard, Steps } from "@/components/public/blocks";
import { loadServiceMedia } from "@/components/public/media-loaders";
import { Testimonials } from "@/components/public/Testimonials";
import { AUDIENCE_COPY, PAYMENT_BALANCE_NOTE, PAYMENT_POLICY, SERVICE_COPY } from "@/lib/catalog/copy";
import { AUDIENCE_SERVICES, AUDIENCES, PROJECT_CATEGORIES, SERVICE_DEFINITIONS, SERVICES } from "@/lib/catalog/index";
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
    title: locale === "ar" ? "خدمات التصوير والفيديو: رياضات قتالية ورياضيون وأندية ومشاريع إبداعية في قطر" : "Photography and video services: combat sports, athletes, clubs and creative projects in Qatar",
    description:
      locale === "ar"
        ? "تغطية بطولات، ومحتوى رياضيين، وتغطية أندية وفرق، وتصوير فوتوغرافي وفيديو ومشاريع مخصصة في الدوحة. صور أو فيديو أو كلاهما، وعرض سعر مكتوب قبل الدفع."
        : "Tournament coverage, athlete media, club and team coverage, photography, videography and custom projects in Doha. Photo, video or both, confirmed in a written quote before you pay.",
    path: "/services",
    locale,
  });
}

export default async function ServicesPage() {
  const [pub, locale] = await Promise.all([loadPublicStudio(), getLocale()]);
  const media = await Promise.all(SERVICES.map((k) => loadServiceMedia(k, 1)));
  const t = tr(locale);
  const rows = pub?.services ?? [];
  const bookingOpen = Boolean(pub?.studio.public_booking);
  const galleryUrl = pictimeGalleryUrl(pub?.studio ?? null);
  const testimonials = pub ? readTestimonials(pub.studio.settings).slice(0, 3) : [];
  const rowsFor = (key: (typeof SERVICES)[number]) => rows.filter((r) => r.booking_type === SERVICE_DEFINITIONS[key].bookingType);
  const discussHref = inquiryHref("commercial_creative", "/services");

  return (
    <main>
      <section className="navy-pattern bg-navy text-white">
        <div className="container-x py-12 lg:py-16">
          <p className="eyebrow !text-white/60">{t(UI.services.title)}</p>
          <h1 className="heading-1 mt-3 max-w-3xl text-balance">{t(UI.services.heading)}</h1>
          <p className="mt-4 max-w-2xl text-base text-white/75">{t(UI.services.lead)}</p>
          <nav aria-label={t(UI.home.categoriesEyebrow)} className="mt-6 flex flex-wrap gap-2">
            <a href="#categories" className="chip chip-light">{t(UI.home.categoriesEyebrow)}</a>
            <a href="#all" className="chip chip-light">{t(UI.services.byService)}</a>
            {AUDIENCES.map((a) => (
              <a key={a} href={`#for-${a}`} className="chip chip-light">{localized(AUDIENCE_COPY[a].cta, locale)}</a>
            ))}
          </nav>
        </div>
      </section>

      {/* What we do: the six categories; the quoted ones lead straight to the inquiry form. */}
      <section id="categories" className="container-x section-sm scroll-mt-20" aria-labelledby="categories-heading">
        <SectionHeading id="categories-heading" eyebrow={t(UI.home.categoriesEyebrow)} title={t(UI.home.categoriesTitle)} lead={t(UI.home.categoriesLead)} />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECT_CATEGORIES.map((key) => (
            <li key={key}>
              <ProjectCategoryCard category={key} locale={locale} bookingOpen={bookingOpen} from="/services" />
            </li>
          ))}
        </ul>
      </section>

      {/* Bookable services. Prices only from publicPrice(). */}
      <section id="all" className="scroll-mt-20 border-y border-line bg-page" aria-labelledby="all-heading">
        <div className="container-x section-sm">
          <SectionHeading id="all-heading" eyebrow={t(UI.services.byService)} title={t(UI.home.servicesTitle)} lead={t(UI.home.servicesLead)} />
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((k, i) => (
              <li key={k}>
                <ServiceCard def={SERVICE_DEFINITIONS[k]} locale={locale} rows={rowsFor(k)} media={media[i][0] ?? null} />
              </li>
            ))}
          </ul>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted" aria-label={t(UI.services.mediaOptions)}>
            {SERVICES.map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span className="font-semibold text-ink">{localized(SERVICE_COPY[k].title, locale)}:</span>
                <ScopeBadges def={SERVICE_DEFINITIONS[k]} locale={locale} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Custom work: quoted per project, never forced through the tournament forms. */}
      <section className="container-x section-sm" aria-labelledby="custom-heading">
        <div className="card flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow !text-primary">{t(UI.services.customEyebrow)}</p>
            <h2 id="custom-heading" className="heading-3 mt-2 text-navy">{t(UI.services.customTitle)}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{t(UI.services.customBody)}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Link href={discussHref} data-umami-event="contact-click" data-umami-event-category="commercial_creative" className="btn-primary">{t(UI.nav.discussProject)}</Link>
            <Link href={inquiryHref("photography", "/services")} data-umami-event="contact-click" data-umami-event-category="photography" className="btn-secondary">{t(UI.nav.getQuote)}</Link>
          </div>
        </div>
      </section>

      {/* By audience: each audience lists its services as compact rows. */}
      <section className="border-t border-line bg-page" aria-labelledby="audiences-heading">
        <div className="container-x section-sm">
          <SectionHeading id="audiences-heading" eyebrow={t(UI.services.byAudience)} title={t(UI.home.audiencesTitle)} />
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {AUDIENCES.map((a) => {
              const copy = AUDIENCE_COPY[a];
              return (
                <section key={a} id={`for-${a}`} className="card scroll-mt-24 p-5 sm:p-6" aria-labelledby={`for-${a}-title`}>
                  <h3 id={`for-${a}-title`} className="text-xl font-extrabold text-navy">{localized(copy.title, locale)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{localized(copy.lead, locale)}</p>
                  <ul className="mt-4 divide-y divide-line border-t border-line">
                    {AUDIENCE_SERVICES[a].map((key) => {
                      const def = SERVICE_DEFINITIONS[key];
                      const line = def.quoteFirst ? t(UI.common.quoteOnRequest) : priceLine(rowsFor(key), locale);
                      return (
                        <li key={key}>
                          <Link href={`/services/${def.slug}`} className="group flex min-h-14 items-center justify-between gap-3 py-3">
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-ink group-hover:text-primary">{localized(SERVICE_COPY[key].title, locale)}</span>
                              <span className="block text-xs text-muted">{line}</span>
                            </span>
                            <ChevronRightIcon size={18} className="rtl-flip shrink-0 text-muted" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </section>

      <Testimonials reviews={testimonials} locale={locale} ctaHref={inquiryHref(null, "/services")} />

      {/* Booking and payment in short */}
      <section className="container-x section-sm" aria-labelledby="payment-heading">
        <SectionHeading
          id="payment-heading"
          eyebrow={t(UI.home.processEyebrow)}
          title={t(UI.services.paymentHeading)}
          action={
            <Link href="/how-it-works" className="btn-secondary">
              {t(UI.nav.howItWorks)} <ChevronRightIcon size={16} className="rtl-flip" />
            </Link>
          }
        />
        <div className="mt-8">
          <Steps steps={UI.payment.map((s) => ({ title: t(s.title), body: t(s.body) }))} />
        </div>
        <p className="mt-6 text-sm text-ink">{localized(PAYMENT_POLICY, locale)} {localized(PAYMENT_BALANCE_NOTE, locale)}</p>
        <p className="mt-3 text-sm text-ink">
          {t(UI.services.galleryNote)}{" "}
          <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="inline-flex items-center gap-1 font-semibold text-primary">
            {t(UI.nav.findMyPhotos)} <ExternalIcon size={14} />
            <span className="sr-only">{t(UI.nav.opensGallery)}</span>
          </a>
        </p>
        <p className="mt-2 text-sm text-muted">
          {t(UI.services.paymentMore)} <Link href={inquiryHref("booking_question", "/services")} className="font-semibold text-primary">{t(UI.nav.contact)}</Link> · <Link href="/terms" className="font-semibold text-primary">{t(UI.nav.terms)}</Link>
        </p>
      </section>
    </main>
  );
}
