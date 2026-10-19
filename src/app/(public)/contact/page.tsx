import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { CheckIcon, InstagramIcon, MailIcon, MapPinIcon } from "@/components/icons";
import { Testimonials } from "@/components/public/Testimonials";
import { normalizeSourcePage } from "@/lib/inquiries/form";
import { isInquiryCategory, isInquiryRef } from "@/lib/inquiries/labels";
import { getLocale } from "@/lib/i18n/server";
import { tr, UI } from "@/lib/i18n/ui";
import { pageMetadata } from "@/lib/seo";
import { businessIdentity, businessLegalLine } from "@/lib/studio/business";
import { loadPublicStudio } from "@/lib/studio/queries";
import { readTestimonials } from "@/lib/studio/site-content";
import { ContactForm } from "./ContactForm";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const locale = await getLocale(params.lang);
  return pageMetadata({
    title: locale === "ar" ? "التواصل والاستفسارات: تصوير فوتوغرافي وفيديو في الدوحة" : "Contact & Inquiries: photography and video in Doha",
    description:
      locale === "ar"
        ? "اسأل عن تغطية بطولة، أو محتوى رياضي، أو محتوى نادٍ، أو جلسة تصوير، أو فيديو ترويجي، أو مشروع إبداعي في قطر. نرد عبر البريد الإلكتروني."
        : "Ask about tournament coverage, athlete media, club content, a photoshoot, a promotional video or a creative project in Qatar. We reply by e-mail.",
    path: "/contact",
    locale,
  });
}

/**
 * Contact & Inquiries. `?type=<category>` preselects the inquiry type (every
 * "Discuss a project" link on the site carries it), `?from=<path>` records
 * the page the visitor came from, and `?sent=<IQ-ref>` is the confirmation
 * state the server action redirects to once the inquiry row exists.
 */
export default async function ContactPage({ searchParams }: Props) {
  const [pub, params] = await Promise.all([loadPublicStudio(), searchParams]);
  const locale = await getLocale(params.lang);
  const t = tr(locale);
  const studio = pub?.studio ?? null;
  const sentRef = first(params.sent);
  const sent = isInquiryRef(sentRef) ? sentRef : null;
  const type = first(params.type);
  const initialCategory = isInquiryCategory(type) ? type : null;
  const sourcePage = normalizeSourcePage(first(params.from));
  const identity = businessIdentity();
  const ig = studio?.instagram?.replace(/^@/, "") ?? null;
  const email = studio?.email || identity.email;
  const bookingOpen = Boolean(studio?.public_booking);
  const testimonials = studio ? readTestimonials(studio.settings).slice(0, 3) : [];

  return (
    <main>
      <section className="navy-pattern bg-navy text-white">
        <div className="container-x py-12 lg:py-16">
          <p className="eyebrow !text-white/60">{t(UI.contact.title)}</p>
          <h1 className="heading-1 mt-3 max-w-2xl text-balance">{t(UI.contact.heading)}</h1>
          <p className="mt-4 max-w-xl text-base text-white/75">{t(UI.contact.lead)}</p>
        </div>
      </section>

      <div className="container-x section-sm grid gap-10 md:grid-cols-[1fr_1.4fr]">
        <aside className="space-y-6">
          {bookingOpen && (
            <div className="card-soft p-5">
              <p className="text-sm font-bold text-ink">{t(UI.contact.readyTitle)}</p>
              <p className="mt-1 text-sm text-muted">{t(UI.contact.readyBody)}</p>
              <Link href="/book" data-umami-event="book-start" className="btn-secondary mt-3">{t(UI.contact.goToRequest)}</Link>
            </div>
          )}
          <div>
            <p className="eyebrow">{t(UI.contact.direct)}</p>
            <ul className="mt-3 space-y-1 text-sm">
              <li>
                <a href={`mailto:${email}`} data-umami-event="contact-click" className="inline-flex min-h-11 items-center gap-3 break-all font-semibold text-ink hover:text-primary">
                  <MailIcon size={20} className="shrink-0 text-primary" /> <span dir="ltr">{email}</span>
                </a>
              </li>
              {ig && (
                <li>
                  <a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer" data-umami-event="contact-click" className="inline-flex min-h-11 items-center gap-3 font-semibold text-ink hover:text-primary">
                    <InstagramIcon size={20} className="shrink-0 text-primary" /> <span dir="ltr">@{ig}</span>
                  </a>
                </li>
              )}
              <li className="inline-flex min-h-11 items-center gap-3 text-muted">
                <MapPinIcon size={20} className="shrink-0 text-primary" /> <span className="sr-only">{t(UI.footer.basedIn)} </span>{studio?.city || identity.location}
              </li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">{t(UI.contact.business)}</p>
            <p className="mt-3 text-sm text-muted" dir="ltr">{businessLegalLine(identity)}</p>
          </div>
          <p className="text-sm text-muted">
            <Link href="/services" className="font-semibold text-primary">{t(UI.nav.services)}</Link> · <Link href="/how-it-works" className="font-semibold text-primary">{t(UI.nav.howItWorks)}</Link> · <Link href="/services/tournament-athlete-coverage#before-you-book" className="font-semibold text-primary">{t(UI.common.allQuestions)}</Link>
          </p>
        </aside>

        <div>
          {sent ? (
            <div className="card p-6 sm:p-8" role="status" aria-live="polite" data-umami-event="inquiry-sent">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-success-soft text-success"><CheckIcon size={24} /></span>
              <h2 className="heading-2 mt-4 text-navy">{t(UI.contact.sentTitle)}</h2>
              <p className="mt-2 text-base text-muted">{t(UI.contact.sentBody)}</p>
              <div className="mt-6 rounded-card border border-line bg-page p-4">
                <p className="eyebrow">{t(UI.contact.sentReference)}</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-2xl font-extrabold text-navy" dir="ltr">{sent}</p>
                  <CopyButton value={sent} label={locale === "ar" ? "نسخ" : "Copy"} />
                </div>
                <p className="mt-2 text-xs text-muted">{t(UI.contact.sentReferenceHint)}</p>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href="/" className="btn-secondary">{t(UI.nav.backToHome)}</Link>
                {bookingOpen && <Link href="/book" data-umami-event="book-start" className="btn-primary">{t(UI.nav.requestCoverage)}</Link>}
              </div>
            </div>
          ) : (
            <ContactForm locale={locale} initialCategory={initialCategory} sourcePage={sourcePage} />
          )}
        </div>
      </div>

      <Testimonials reviews={testimonials} locale={locale} compact />
    </main>
  );
}
