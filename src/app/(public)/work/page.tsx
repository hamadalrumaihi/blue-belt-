import type { Metadata } from "next";
import Link from "next/link";
import { ExternalIcon, ImageIcon } from "@/components/icons";
import { CtaBand } from "@/components/public/blocks";
import { loadGalleryPending, loadWorkMedia } from "@/components/public/media-loaders";
import { WorkGallery } from "@/components/public/WorkGallery";
import { getLocale } from "@/lib/i18n/server";
import { tr, UI } from "@/lib/i18n/ui";
import { pageMetadata } from "@/lib/seo";
import { loadPublicStudio, pictimeGalleryUrl } from "@/lib/studio/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata({
    title: locale === "ar" ? "أعمالنا: تصوير الجوجيتسو والفنون القتالية في قطر" : "Work: jiu-jitsu and martial arts photography in Qatar",
    description:
      locale === "ar"
        ? "صور مختارة من البطولات وتدريبات الأكاديميات وبورتريهات الرياضيين وأيام الفرق في الدوحة، كما ينشرها الاستوديو."
        : "Selected tournament action, academy training, athlete portraits and team days in Doha, as published by the studio.",
    path: "/work",
    locale,
  });
}

export default async function WorkPage() {
  const [pub, locale, items, pending] = await Promise.all([loadPublicStudio(), getLocale(), loadWorkMedia(), loadGalleryPending()]);
  const t = tr(locale);
  const bookingOpen = Boolean(pub?.studio.public_booking);
  const galleryUrl = pictimeGalleryUrl(pub?.studio ?? null);

  return (
    <main>
      <section className="navy-pattern bg-navy text-white">
        <div className="container-x py-12 lg:py-16">
          <p className="eyebrow !text-white/60">{t(UI.work.title)}</p>
          <h1 className="heading-1 mt-3 max-w-3xl text-balance">{t(UI.work.heading)}</h1>
          <p className="mt-4 max-w-2xl text-base text-white/75">{t(UI.work.lead)}</p>
          <p className="mt-5 text-sm text-white/75">
            {t(UI.work.findYourPhotos)}{" "}
            <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="inline-flex items-center gap-1 font-semibold text-white underline-offset-2 hover:underline">
              {t(UI.nav.findMyPhotos)} <ExternalIcon size={14} />
              <span className="sr-only">{t(UI.nav.opensGallery)}</span>
            </a>
          </p>
        </div>
        {pending && <p className="border-t border-white/10 bg-navy-800 px-gutter py-2 text-center text-xs font-semibold text-white/80">{t(UI.home.previewNotice)}</p>}
      </section>

      <section className="container-x section-sm" aria-label={t(UI.work.title)}>
        {items.length ? (
          <WorkGallery items={items} locale={locale} />
        ) : (
          <div className="card-soft flex flex-col items-center px-6 py-12 text-center" role="status">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-lightblue text-primary"><ImageIcon size={24} /></span>
            <h2 className="heading-3 mt-4 text-navy">{t(UI.work.emptyTitle)}</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{t(UI.work.emptyBody)}</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="btn-secondary">
                {t(UI.nav.findMyPhotos)} <ExternalIcon size={14} />
                <span className="sr-only">{t(UI.nav.opensGallery)}</span>
              </a>
              <Link href="/services" className="btn-secondary">{t(UI.common.allServices)}</Link>
            </div>
          </div>
        )}
      </section>

      <CtaBand title={t(UI.work.ctaTitle)} body={t(UI.work.ctaBody)} href={bookingOpen ? "/book" : "/contact"} label={bookingOpen ? t(UI.nav.requestCoverage) : t(UI.nav.contact)} event={bookingOpen ? "book-start" : "contact-click"} />
    </main>
  );
}
