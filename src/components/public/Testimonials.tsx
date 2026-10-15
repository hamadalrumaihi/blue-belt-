import type { Locale } from "@/lib/i18n/locale";
import type { Testimonial } from "@/lib/studio/site-content";

/**
 * Native, server-rendered reviews. Only owner-supplied client words appear
 * here, and the section does not exist at all while there are none: a sales
 * page never asks visitors for a review.
 */
export function Testimonials({ reviews, locale = "en" }: { reviews: Testimonial[]; locale?: Locale }) {
  if (!reviews.length) return null;
  const ar = locale === "ar";
  return (
    <section className="border-y border-line bg-page" aria-labelledby="stories-heading">
      <div className="container-x section-sm">
        <div className="max-w-2xl">
          <p className="eyebrow !text-primary">{ar ? "رياضيون · مدربون · أندية" : "Athletes · Coaches · Clubs"}</p>
          <h2 id="stories-heading" className="heading-2 mt-2 text-ink">{ar ? "من على البساط، بكلماتهم." : "From the mats, in their words."}</h2>
        </div>
        <ul className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 lg:grid lg:grid-cols-3 lg:overflow-visible lg:pb-0" tabIndex={reviews.length > 1 ? 0 : undefined} aria-label={ar ? "آراء العملاء" : "Client reviews"}>
          {reviews.map((review, index) => (
            <li key={`${review.name}-${index}`} className="relative flex w-[85%] shrink-0 snap-start flex-col overflow-hidden rounded-card border border-line bg-surface p-6 shadow-card sm:w-[48%] lg:w-auto">
              <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
              <figure className="flex flex-1 flex-col">
                <blockquote dir="auto" className="flex-1 whitespace-pre-line break-words text-base leading-relaxed text-ink">{review.quote}</blockquote>
                <figcaption className="mt-6 flex items-center gap-3 border-t border-line pt-4">
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lightblue text-sm font-bold text-primary">{Array.from(review.name)[0]}</span>
                  <div className="min-w-0">
                    <p dir="auto" className="break-words text-sm font-bold text-ink">{review.name}</p>
                    {review.role && <p dir="auto" className="mt-0.5 break-words text-xs text-muted">{review.role}</p>}
                  </div>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
        {reviews.length > 1 && <p className="mt-2 text-xs text-muted lg:hidden">{ar ? "اسحب للمزيد." : "Swipe or scroll to read more."}</p>}
      </div>
    </section>
  );
}
