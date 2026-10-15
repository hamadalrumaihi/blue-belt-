import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, ExternalIcon } from "@/components/icons";
import { priceLine, ScopeBadges, SectionHeading, ServiceCard, Steps } from "@/components/public/blocks";
import { loadServiceMedia } from "@/components/public/media-loaders";
import { AUDIENCE_COPY, SERVICE_COPY } from "@/lib/catalog/copy";
import { AUDIENCE_SERVICES, AUDIENCES, SERVICE_DEFINITIONS, SERVICES } from "@/lib/catalog/index";
import { localized } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { tr, UI } from "@/lib/i18n/ui";
import { pageMetadata } from "@/lib/seo";
import { loadPublicStudio, pictimeGalleryUrl } from "@/lib/studio/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata({
    title: locale === "ar" ? "خدمات تصوير الجوجيتسو والفنون القتالية في قطر" : "BJJ photography and video services in Qatar",
    description:
      locale === "ar"
        ? "تغطية رياضي في بطولة، تغطية فريق، محتوى تدريب، بورتريهات رياضيين وتغطية فعاليات في الدوحة. صور أو فيديو أو كلاهما، وعرض سعر مكتوب قبل الدفع."
        : "Tournament athlete coverage, team days, training content, athlete portraits and event coverage in Doha. Photo, video or both, confirmed in a written quote before you pay.",
    path: "/services",
    locale,
  });
}

export default async function ServicesPage() {
  const [pub, locale] = await Promise.all([loadPublicStudio(), getLocale()]);
  const media = await Promise.all(SERVICES.map((k) => loadServiceMedia(k, 1)));
  const t = tr(locale);
  const rows = pub?.services ?? [];
  const galleryUrl = pictimeGalleryUrl(pub?.studio ?? null);
  const rowsFor = (key: (typeof SERVICES)[number]) => rows.filter((r) => r.booking_type === SERVICE_DEFINITIONS[key].bookingType);

  return (
    <main>
      <section className="navy-pattern bg-navy text-white">
        <div className="container-x py-12 lg:py-16">
          <p className="eyebrow !text-white/60">{t(UI.services.title)}</p>
          <h1 className="heading-1 mt-3 max-w-3xl text-balance">{t(UI.services.heading)}</h1>
          <p className="mt-4 max-w-2xl text-base text-white/75">{t(UI.services.lead)}</p>
          <nav aria-label={t(UI.services.byAudience)} className="mt-6 flex flex-wrap gap-2">
            {AUDIENCES.map((a) => (
              <a key={a} href={`#for-${a}`} className="chip chip-light">{localized(AUDIENCE_COPY[a].cta, locale)}</a>
            ))}
          </nav>
        </div>
      </section>

      {/* By audience: each audience lists its services as compact rows, so a parent never reads the organiser's page by mistake. */}
      <section className="container-x section-sm" aria-labelledby="audiences-heading">
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
      </section>

      {/* All services. Prices only from publicPrice(). */}
      <section className="border-y border-line bg-page" aria-labelledby="all-heading">
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
        <p className="mt-6 text-sm text-ink">
          {t(UI.services.galleryNote)}{" "}
          <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="inline-flex items-center gap-1 font-semibold text-primary">
            {t(UI.nav.findMyPhotos)} <ExternalIcon size={14} />
            <span className="sr-only">{t(UI.nav.opensGallery)}</span>
          </a>
        </p>
        <p className="mt-2 text-sm text-muted">
          {t(UI.services.paymentMore)} <Link href="/contact" className="font-semibold text-primary">{t(UI.nav.contact)}</Link> · <Link href="/terms" className="font-semibold text-primary">{t(UI.nav.terms)}</Link>
        </p>
      </section>
    </main>
  );
}
