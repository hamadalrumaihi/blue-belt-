import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon, ChevronRightIcon, ExternalIcon } from "@/components/icons";
import { CtaBand, JsonLd, SectionHeading, ServiceCard, Steps } from "@/components/public/blocks";
import { loadFeaturedMedia, loadGalleryPending, loadHeroMedia, loadServiceMedia } from "@/components/public/media-loaders";
import { isLandscape } from "@/components/public/media";
import { MediaImage } from "@/components/public/MediaImage";
import { Testimonials } from "@/components/public/Testimonials";
import { AUDIENCE_COPY } from "@/lib/catalog/copy";
import { applyFaqOverrides, FAQ_ITEMS, featuredFaqs } from "@/lib/catalog/faq";
import { AUDIENCES, SERVICE_DEFINITIONS, SERVICES } from "@/lib/catalog/index";
import { localized } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { tr, UI } from "@/lib/i18n/ui";
import { buildHomeJsonLd, DEFAULT_DESCRIPTION, DEFAULT_DESCRIPTION_AR, DEFAULT_TITLE, DEFAULT_TITLE_AR, pageMetadata, serializeJsonLd } from "@/lib/seo";
import { DEFAULT_STUDIO, loadPublicStudio, pictimeGalleryUrl, siteUrl } from "@/lib/studio/queries";
import { readPublishedFaqOverrides, readTestimonials } from "@/lib/studio/site-content";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata({ title: locale === "ar" ? DEFAULT_TITLE_AR : DEFAULT_TITLE, description: locale === "ar" ? DEFAULT_DESCRIPTION_AR : DEFAULT_DESCRIPTION, path: "/", locale });
}

export default async function HomePage() {
  const [pub, locale, hero, featured, pending] = await Promise.all([loadPublicStudio(), getLocale(), loadHeroMedia(), loadFeaturedMedia(8), loadGalleryPending()]);
  const serviceMedia = await Promise.all(SERVICES.map((k) => loadServiceMedia(k, 1)));
  const t = tr(locale);
  const studio = pub?.studio ?? null;
  const rows = pub?.services ?? [];
  const bookingOpen = Boolean(studio?.public_booking);
  const city = studio?.city ?? DEFAULT_STUDIO.city;
  const testimonials = studio ? readTestimonials(studio.settings) : [];
  const galleryUrl = pictimeGalleryUrl(studio);
  const primaryHref = bookingOpen ? "/book" : "/contact";
  const primaryLabel = bookingOpen ? t(UI.nav.requestCoverage) : t(UI.nav.contact);
  const primaryEvent = bookingOpen ? "book-start" : "contact-click";
  const lead = locale === "en" && studio?.about?.trim() ? studio.about.trim() : t(UI.home.lead);
  const faqs = featuredFaqs(4, applyFaqOverrides(FAQ_ITEMS, readPublishedFaqOverrides(studio?.settings)));
  const jsonLd = serializeJsonLd(buildHomeJsonLd({ base: siteUrl(), studio, services: rows, locale }));

  return (
    <main>
      <JsonLd json={jsonLd} />

      {/* Hero: one compact block. With a published hero photograph it becomes a responsive focal crop behind the copy; without one it stays a tight navy panel. */}
      <section className={cn("relative isolate overflow-hidden bg-navy text-white", !hero && "navy-pattern")} aria-labelledby="hero-heading">
        {hero && (
          <div aria-hidden className="absolute inset-0">
            <MediaImage item={hero} sizes="100vw" priority alt="" />
            <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/80 to-navy/30 md:bg-gradient-to-r md:from-navy md:via-navy/75 md:to-navy/10 rtl:md:bg-gradient-to-l" />
          </div>
        )}
        <div className={cn("container-x relative flex flex-col justify-end py-12 md:py-16 lg:py-20", hero && "min-h-[26rem] md:min-h-[30rem]")}>
          <div className="max-w-2xl">
            <p className="eyebrow !text-white/70">{t(UI.home.eyebrow)}{city ? ` · ${city}` : ""}</p>
            <h1 id="hero-heading" className="display mt-3 text-balance">{t(UI.home.title)}</h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">{lead}</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href={primaryHref} data-umami-event={primaryEvent} className="btn-primary btn-lg shadow-hero">
                {primaryLabel}
                <ChevronRightIcon size={18} className="rtl-flip" />
              </Link>
              <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="btn btn-light btn-lg">
                {t(UI.nav.findMyPhotos)}
                <ExternalIcon size={16} />
                <span className="sr-only">{t(UI.nav.opensGallery)}</span>
              </a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/75">
              {UI.home.trust.map((item) => (
                <li key={item.en} className="inline-flex items-center gap-2"><CheckIcon size={16} className="shrink-0 text-bright" /> {t(item)}</li>
              ))}
            </ul>
          </div>
        </div>
        {pending && <p className="relative border-t border-white/10 bg-navy-800 px-gutter py-2 text-center text-xs font-semibold text-white/80">{t(UI.home.previewNotice)}</p>}
      </section>

      {/* Audience entry points: four compact tiles, one per way in. */}
      <section className="container-x section-sm" aria-labelledby="audiences-heading">
        <SectionHeading id="audiences-heading" eyebrow={t(UI.home.audiencesEyebrow)} title={t(UI.home.audiencesTitle)} />
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCES.map((a) => {
            const copy = AUDIENCE_COPY[a];
            return (
              <li key={a}>
                <Link href={`/services#for-${a}`} className="tile card-hover group flex h-full flex-col justify-between gap-4">
                  <div>
                    <h3 className="text-base font-extrabold text-ink">{localized(copy.title, locale)}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{localized(copy.short, locale)}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-primary">
                    {localized(copy.cta, locale)} <ChevronRightIcon size={16} className="rtl-flip transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Services from the catalog. Price lines come from publicPrice() only. */}
      <section className="border-y border-line bg-page" aria-labelledby="services-heading">
        <div className="container-x section-sm">
          <SectionHeading
            id="services-heading"
            eyebrow={t(UI.home.servicesEyebrow)}
            title={t(UI.home.servicesTitle)}
            lead={t(UI.home.servicesLead)}
            action={
              <Link href="/services" className="btn-secondary">
                {t(UI.common.allServices)} <ChevronRightIcon size={16} className="rtl-flip" />
              </Link>
            }
          />
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((k, i) => (
              <li key={k}>
                <ServiceCard def={SERVICE_DEFINITIONS[k]} locale={locale} rows={rows.filter((r) => r.booking_type === SERVICE_DEFINITIONS[k].bookingType)} media={serviceMedia[i][0] ?? null} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Curated work: only when something is published. */}
      {featured.length > 0 && (
        <section className="bg-navy text-white" aria-labelledby="work-heading">
          <div className="container-x section-sm">
            <SectionHeading
              id="work-heading"
              light
              eyebrow={t(UI.home.workEyebrow)}
              title={t(UI.home.workTitle)}
              action={
                <Link href="/work" className="btn btn-light">
                  {t(UI.common.seeAllWork)} <ChevronRightIcon size={16} className="rtl-flip" />
                </Link>
              }
            />
            <ul className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              {featured.map((m, i) => {
                const landscape = isLandscape(m);
                const wide = landscape && featured.length >= 8 && i % 5 === 0;
                return (
                  <li key={m.id} className={cn("figure", wide ? "col-span-2 aspect-[16/10]" : landscape ? "aspect-[4/3]" : "aspect-[3/4]")}>
                    <MediaImage item={m} sizes={wide ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"} />
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* Real client words only; the section is absent while there are none. */}
      <Testimonials reviews={testimonials} locale={locale} />

      {/* Process */}
      <section className="container-x section-sm" aria-labelledby="how-heading">
        <SectionHeading
          id="how-heading"
          eyebrow={t(UI.home.processEyebrow)}
          title={t(UI.home.processTitle)}
          action={
            <Link href="/how-it-works" className="btn-secondary">
              {t(UI.nav.howItWorks)} <ChevronRightIcon size={16} className="rtl-flip" />
            </Link>
          }
        />
        <div className="mt-8">
          <Steps steps={UI.process.map((s) => ({ title: t(s.title), body: t(s.body) }))} cols={5} />
        </div>
      </section>

      {/* FAQ teaser */}
      <section className="border-t border-line bg-page" aria-labelledby="faq-heading">
        <div className="container-x section-sm grid gap-8 lg:grid-cols-[1fr_2fr]">
          <div>
            <p className="eyebrow">{t(UI.home.faqEyebrow)}</p>
            <h2 id="faq-heading" className="heading-2 mt-2 text-navy">{t(UI.home.faqTitle)}</h2>
            <p className="mt-3 text-base text-muted">
              <Link href="/how-it-works#faq" className="font-semibold text-primary">{t(UI.common.allQuestions)}</Link>
            </p>
          </div>
          <div className="divide-y divide-line rounded-card border border-line bg-surface">
            {faqs.map((f) => (
              <details key={f.id} className="disclosure group px-5 py-3">
                <summary>
                  <span>{localized(f.question, locale)}</span>
                  <ChevronRightIcon size={18} className="rtl-flip shrink-0 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                </summary>
                <p className="pb-2 pt-1 text-sm leading-relaxed text-muted">{localized(f.answer, locale)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand eyebrow={t(UI.home.ctaEyebrow)} title={t(UI.home.ctaTitle)} body={t(UI.home.ctaBody)} href={primaryHref} label={primaryLabel} event={primaryEvent} />
    </main>
  );
}
