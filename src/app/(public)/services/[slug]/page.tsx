import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CameraIcon, ChevronRightIcon, VideoIcon } from "@/components/icons";
import { CheckList, CtaBand, JsonLd, PackageList, ScopeBadges } from "@/components/public/blocks";
import { CompetitionFaq } from "@/components/public/CompetitionFaq";
import { Testimonials } from "@/components/public/Testimonials";
import { loadServiceMedia } from "@/components/public/media-loaders";
import { MediaImage } from "@/components/public/MediaImage";
import { TrackEvent } from "@/components/public/TrackEvent";
import { AUDIENCE_COPY, MEDIA_SCOPE_COPY, SERVICE_COPY, VIDEO_DELIVERABLE_COPY } from "@/lib/catalog/copy";
import { applyFaqOverrides, buildFaqJsonLd, competitionFaqs, faqsForService, FAQ_ITEMS } from "@/lib/catalog/faq";
import { COMPETITION_SERVICES, PROJECT_CATEGORY_DEFINITIONS, SERVICE_DEFINITIONS, SERVICES, serviceBySlug, type MediaScope } from "@/lib/catalog/index";
import { localized } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { tr, UI } from "@/lib/i18n/ui";
import { inquiryHref } from "@/lib/inquiries/labels";
import { buildServiceJsonLd, pageMetadata, serializeJsonLd } from "@/lib/seo";
import { loadPublicStudio, siteUrl } from "@/lib/studio/queries";
import { readPublishedFaqOverrides, readTestimonials } from "@/lib/studio/site-content";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([params, getLocale()]);
  const def = serviceBySlug(slug);
  // Thrown here as well as in the page so the response status is 404 for crawlers, which get metadata before any streaming.
  if (!def) notFound();
  const copy = SERVICE_COPY[def.key];
  return pageMetadata({ title: localized(copy.metaTitle, locale), description: localized(copy.metaDescription, locale), path: `/services/${def.slug}`, locale });
}

/** The inquiry category a service maps to (for "Ask about this" links and the closed-booking fallback). */
function inquiryCategoryFor(key: (typeof SERVICES)[number]) {
  return Object.values(PROJECT_CATEGORY_DEFINITIONS).find((c) => c.services.includes(key))?.inquiry ?? "general";
}

/** The request link for a service and a media scope; the inquiry form (category preselected) when public booking is closed. */
function requestHref(bookingOpen: boolean, key: (typeof SERVICES)[number], media: MediaScope): string {
  return bookingOpen ? `/book?service=${key}&media=${media}` : inquiryHref(inquiryCategoryFor(key), `/services/${SERVICE_DEFINITIONS[key].slug}`);
}

export default async function ServicePage({ params }: Props) {
  const [{ slug }, pub, locale] = await Promise.all([params, loadPublicStudio(), getLocale()]);
  const def = serviceBySlug(slug);
  if (!def) notFound();
  const media = await loadServiceMedia(def.key, 4);
  const t = tr(locale);
  const copy = SERVICE_COPY[def.key];
  const rows = (pub?.services ?? []).filter((r) => r.booking_type === def.bookingType);
  const bookingOpen = Boolean(pub?.studio.public_booking);
  const allFaqs = applyFaqOverrides(FAQ_ITEMS, readPublishedFaqOverrides(pub?.studio.settings));
  const competition = COMPETITION_SERVICES.includes(def.key);
  // Competition services show the full "Before you book" set; the others only the answers their copy lists.
  const faqs = competition ? competitionFaqs(allFaqs) : faqsForService(def.key, copy.faqIds, allFaqs);
  const others = SERVICES.filter((k) => k !== def.key);
  const defaultScope = def.mediaScopes[0];
  const askHref = inquiryHref(inquiryCategoryFor(def.key), `/services/${def.slug}`);
  const testimonials = pub ? readTestimonials(pub.studio.settings).slice(0, 3) : [];
  const jsonLd = serializeJsonLd(buildServiceJsonLd({ base: siteUrl(), def, studio: pub?.studio ?? null, services: pub?.services ?? [], locale }));
  // FAQPage structured data lives on one page only: the tournament athlete service, which carries the full competition set.
  const faqLd = def.key === "tournament_athlete" ? serializeJsonLd(buildFaqJsonLd(locale, faqs)) : null;
  const L = <T,>(v: { en: T; ar?: T }) => localized(v, locale);

  return (
    <main>
      <JsonLd json={jsonLd} />
      {faqLd && <JsonLd json={faqLd} />}
      <TrackEvent name="service-view" data={{ service: def.key }} />

      <section className="navy-pattern bg-navy text-white">
        <div className="container-x py-12 lg:py-16">
          <nav aria-label="Breadcrumb" className="text-xs text-white/60">
            <ol className="flex flex-wrap items-center gap-1">
              <li><Link href="/" className="hover:text-white">{t(UI.nav.home)}</Link></li>
              <li aria-hidden><ChevronRightIcon size={12} className="rtl-flip" /></li>
              <li><Link href="/services" className="hover:text-white">{t(UI.nav.services)}</Link></li>
              <li aria-hidden><ChevronRightIcon size={12} className="rtl-flip" /></li>
              <li aria-current="page" className="text-white/80">{L(copy.title)}</li>
            </ol>
          </nav>
          <h1 className="heading-1 mt-4 max-w-3xl text-balance">{L(copy.title)}</h1>
          <p className="mt-4 max-w-2xl text-base text-white/80 sm:text-lg">{L(copy.lead)}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <ScopeBadges def={def} locale={locale} light />
            <ul className="flex flex-wrap gap-1.5 text-xs text-white/70" aria-label={t(UI.common.forWhom)}>
              {def.audiences.map((a) => (
                <li key={a}><Link href={`/services#for-${a}`} className="underline-offset-2 hover:underline">{L(AUDIENCE_COPY[a].title)}</Link></li>
              ))}
            </ul>
          </div>
          {/* The request entry: one button per media scope, each carrying the service and the scope into the wizard. */}
          <div className="mt-7">
            <p className="eyebrow !text-white/60">{t(UI.services.sections.requestAs)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {def.mediaScopes.map((scope, i) => (
                <Link
                  key={scope}
                  href={requestHref(bookingOpen, def.key, scope)}
                  data-umami-event={bookingOpen ? "request-start" : "contact-click"}
                  data-umami-event-service={def.key}
                  data-umami-event-media={scope}
                  className={cn("btn min-h-12 px-5", i === 0 ? "btn-primary shadow-hero" : "btn-light")}
                >
                  {scope === "video" ? <VideoIcon size={16} /> : <CameraIcon size={16} />}
                  {L(MEDIA_SCOPE_COPY[scope].title)}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {media.length > 0 && (
        <section className="container-x pt-8" aria-label={t(UI.work.title)}>
          <ul className={cn("grid gap-3", media.length === 1 ? "grid-cols-1" : media.length === 2 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4")}>
            {media.map((m, i) => (
              <li key={m.id} className={cn("figure", media.length === 1 ? "aspect-[21/9]" : media.length === 3 && i === 0 ? "col-span-2 aspect-[16/9] md:col-span-2" : "aspect-[4/3]")}>
                <MediaImage item={m} sizes={media.length === 1 ? "100vw" : "(min-width: 768px) 25vw, 50vw"} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="container-x section-sm grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="space-y-10">
          <section aria-labelledby="shoot-heading">
            <h2 id="shoot-heading" className="heading-3 text-navy">{t(UI.services.sections.whatWeShoot)}</h2>
            <CheckList className="mt-3" items={L(copy.whatWeShoot)} />
          </section>

          <section aria-labelledby="deliverables-heading">
            <h2 id="deliverables-heading" className="heading-3 text-navy">{t(UI.services.sections.deliverables)}</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="tile">
                <p className="flex items-center gap-2 text-sm font-extrabold text-ink"><CameraIcon size={16} className="text-primary" /> {t(UI.services.sections.photoDeliverables)}</p>
                <CheckList className="mt-3" items={L(copy.photoDeliverables)} />
              </div>
              <div className="tile">
                <p className="flex items-center gap-2 text-sm font-extrabold text-ink"><VideoIcon size={16} className="text-primary" /> {t(UI.services.sections.videoDeliverables)}</p>
                <CheckList className="mt-3" items={L(copy.videoDeliverables)} />
              </div>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {def.videoDeliverables.map((d) => (
                <div key={d} className="rounded-xl border border-line bg-page p-4">
                  <dt className="text-sm font-bold text-ink">{L(VIDEO_DELIVERABLE_COPY[d].title)}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-muted">{L(VIDEO_DELIVERABLE_COPY[d].description)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="need-heading">
            <h2 id="need-heading" className="heading-3 text-navy">{t(UI.services.sections.needFromYou)}</h2>
            <CheckList className="mt-3" icon="chevron" items={L(copy.needFromYou)} />
          </section>

          <div className="grid gap-8 sm:grid-cols-2">
            <section aria-labelledby="booking-heading">
              <h2 id="booking-heading" className="heading-3 text-navy">{t(UI.services.sections.bookingSteps)}</h2>
              <ol className="mt-3 space-y-3">
                {L(copy.bookingSteps).map((step, i) => (
                  <li key={step} className="flex gap-3 text-sm leading-relaxed text-ink">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white" aria-hidden>{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-labelledby="payment-heading">
              <h2 id="payment-heading" className="heading-3 text-navy">{t(UI.services.sections.paymentSteps)}</h2>
              <ol className="mt-3 space-y-3">
                {L(copy.paymentSteps).map((step, i) => (
                  <li key={step} className="flex gap-3 text-sm leading-relaxed text-ink">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white" aria-hidden>{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            <section aria-labelledby="use-heading">
              <h2 id="use-heading" className="heading-3 text-navy">{t(UI.services.sections.permittedUse)}</h2>
              <CheckList className="mt-3" items={L(copy.permittedUse)} />
            </section>
            <section aria-labelledby="limits-heading">
              <h2 id="limits-heading" className="heading-3 text-navy">{t(UI.services.sections.limitations)}</h2>
              <CheckList className="mt-3" icon="chevron" items={L(copy.limitations)} />
            </section>
          </div>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <section className="card p-5" aria-labelledby="for-heading">
            <h2 id="for-heading" className="eyebrow">{t(UI.services.sections.intendedClient)}</h2>
            <CheckList className="mt-3" items={L(copy.intendedClient)} />
          </section>
          <section className="card p-5" aria-labelledby="packages-heading">
            <h2 id="packages-heading" className="eyebrow">{t(UI.common.packages)}</h2>
            <div className="mt-3">
              <PackageList rows={rows} locale={locale} bookHref={(row) => (bookingOpen ? `/book?service=${def.key}&media=${row.includes_video ? (row.includes_photo ? "photo_video" : "video") : "photo"}` : null)} />
            </div>
            <p className="mt-3 text-xs text-muted">{t(UI.common.confirmedInQuote)}</p>
          </section>
          <p className="text-sm text-muted">
            <Link href={askHref} data-umami-event="contact-click" className="font-semibold text-primary">{t(UI.common.askAboutThis)}</Link>
          </p>
        </aside>
      </div>

      {faqs.length > 0 && (competition ? (
        <CompetitionFaq items={faqs} locale={locale} from={`/services/${def.slug}`} />
      ) : (
        <section className="border-t border-line bg-page" aria-labelledby="service-faq-heading">
          <div className="container-x section-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <h2 id="service-faq-heading" className="heading-2 text-navy">{t(UI.services.relatedFaq)}</h2>
              <Link href={askHref} data-umami-event="contact-click" className="text-sm font-semibold text-primary">{t(UI.common.askAboutThis)}</Link>
            </div>
            <div className="mt-6">
              <CompetitionFaq items={faqs} locale={locale} variant="plain" id={`faq-${def.key}`} />
            </div>
          </div>
        </section>
      ))}

      <Testimonials reviews={testimonials} locale={locale} ctaHref={askHref} />

      <section className="container-x section-sm" aria-labelledby="others-heading">
        <h2 id="others-heading" className="eyebrow">{t(UI.services.sections.otherServices)}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {others.map((k) => (
            <li key={k}>
              <Link href={`/services/${SERVICE_DEFINITIONS[k].slug}`} className="chip">{L(SERVICE_COPY[k].title)}</Link>
            </li>
          ))}
        </ul>
      </section>

      <CtaBand title={L(copy.cta)} body={t(UI.home.ctaBody)} href={requestHref(bookingOpen, def.key, defaultScope)} label={bookingOpen ? L(copy.cta) : t(UI.nav.getQuote)} event={bookingOpen ? "request-start" : "contact-click"} eventData={{ service: def.key, media: defaultScope }} secondary={bookingOpen ? { href: askHref, label: t(UI.common.askAboutThis), event: "contact-click" } : null} />
    </main>
  );
}
