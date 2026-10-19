import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import type { Locale } from "@/lib/i18n/locale";
import { tr, UI } from "@/lib/i18n/ui";
import { inquiryHref } from "@/lib/inquiries/labels";
import type { Testimonial } from "@/lib/studio/site-content";
import { cn } from "@/lib/utils";

type Props = {
  reviews: Testimonial[];
  locale?: Locale;
  /** A shorter band for secondary pages: no heading, no CTA. */
  compact?: boolean;
  /** Where "Work with us" leads; defaults to the general inquiry form. */
  ctaHref?: string;
};

/** The quote mark: an SVG so it renders identically in every font and never relies on glyph fallback. */
function Quote({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="28" height="28" className={className} fill="currentColor">
      <path d="M7.2 6C4.9 6 3 7.9 3 10.3c0 2.1 1.5 3.9 3.5 4.2-.4 1.3-1.4 2.3-2.8 2.9v2.6c3.9-.8 6.5-3.9 6.5-8.2V6H7.2Zm10.3 0C15.2 6 13.3 7.9 13.3 10.3c0 2.1 1.5 3.9 3.5 4.2-.4 1.3-1.4 2.3-2.8 2.9v2.6c3.9-.8 6.5-3.9 6.5-8.2V6h-2.9Z" />
    </svg>
  );
}

/**
 * Native, server-rendered reviews. Only owner-supplied client words appear
 * here (published with written permission), and the section does not exist
 * at all while there are none: a sales page never asks visitors for a
 * review. Every quote and name renders with `dir="auto"` so Arabic reviews
 * read right-to-left inside an English page and the other way round.
 * No star ratings, no platform logos, no invented names: a review without
 * an approved name is attributed to "Client".
 */
export function Testimonials({ reviews, locale = "en", compact = false, ctaHref }: Props) {
  if (!reviews.length) return null;
  const t = tr(locale);
  const href = ctaHref ?? inquiryHref(null, "/testimonials");
  return (
    <section className={cn("border-y border-line bg-page", compact && "border-b-0")} aria-labelledby="stories-heading">
      <div className={cn("container-x", compact ? "py-10" : "section-sm")}>
        <div className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", compact && "sr-only")}>
          <div className="max-w-2xl">
            <p className="eyebrow !text-primary">{t(UI.testimonials.eyebrow)}</p>
            <h2 id="stories-heading" className="heading-2 mt-2 text-ink">{t(UI.testimonials.title)}</h2>
          </div>
        </div>
        <ul className={cn("flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 lg:grid lg:overflow-visible lg:pb-0", compact ? "mt-0" : "mt-8", reviews.length >= 3 ? "lg:grid-cols-3" : reviews.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1 lg:max-w-2xl")} tabIndex={reviews.length > 1 ? 0 : undefined} role={reviews.length > 1 ? "region" : undefined} aria-label={t(UI.testimonials.label)}>
          {reviews.map((review, index) => {
            const name = review.name?.trim() || t(UI.testimonials.anonymous);
            return (
              <li key={`${name}-${index}`} className="relative flex w-[85%] shrink-0 snap-start flex-col rounded-card border border-line bg-surface p-6 shadow-card sm:w-[48%] lg:w-auto">
                <figure className="flex flex-1 flex-col">
                  <Quote className="text-primary/70" />
                  <blockquote dir="auto" className="mt-3 flex-1 whitespace-pre-line break-words text-base leading-relaxed text-ink">{review.quote}</blockquote>
                  <figcaption className="mt-6 flex items-center gap-3 border-t border-line pt-4">
                    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lightblue text-sm font-bold text-primary">{Array.from(name)[0]}</span>
                    <div className="min-w-0">
                      <p dir="auto" className="break-words text-sm font-bold text-ink">{name}</p>
                      {review.role && <p dir="auto" className="mt-0.5 break-words text-xs text-muted">{review.role}</p>}
                    </div>
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
        {reviews.length > 1 && <p className="mt-2 text-xs text-muted lg:hidden">{t(UI.testimonials.swipe)}</p>}
        {!compact && (
          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <p className="text-base font-bold text-ink">{t(UI.common.yourStoryNext)}</p>
            <Link href={href} data-umami-event="work-with-us" className="btn-primary">
              {t(UI.nav.workWithUs)} <ChevronRightIcon size={16} className="rtl-flip" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
