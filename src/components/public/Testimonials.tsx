import Link from "next/link";
import { ChevronRightIcon, SendIcon } from "@/components/icons";
import type { Testimonial } from "@/lib/studio/site-content";

/** Native, server-rendered reviews. Only owner-supplied client words appear here. */
export function Testimonials({ reviews }: { reviews: Testimonial[] }) {
  return (
    <section className="overflow-hidden border-y border-line bg-page" aria-labelledby="stories-heading">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-24">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow !text-primary">Athletes · Coaches · Clubs</p>
            <h2 id="stories-heading" className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              From the mats,<br /><span className="text-primary">in their words.</span>
            </h2>
          </div>
          <Link href="/contact" data-umami-event="contact-click" className="btn-secondary self-start sm:self-auto">
            Share your experience <ChevronRightIcon size={16} />
          </Link>
        </div>

        {reviews.length ? (
          <>
            <ul
              className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 lg:grid lg:grid-cols-3 lg:overflow-visible lg:pb-0"
              tabIndex={reviews.length > 1 ? 0 : undefined}
              aria-label="Client reviews"
            >
              {reviews.map((review, index) => (
                <li key={`${review.name}-${index}`} className="relative flex w-[85%] shrink-0 snap-start flex-col overflow-hidden rounded-card border border-line bg-surface p-6 shadow-card sm:w-[48%] lg:w-auto lg:p-8">
                  <div aria-hidden className="absolute left-0 right-0 top-0 h-1 bg-primary" />
                  <span aria-hidden className="h-14 select-none font-serif text-7xl leading-none text-primary/30">“</span>
                  <figure className="flex flex-1 flex-col">
                    <blockquote dir="auto" className="flex-1 whitespace-pre-line break-words text-lg leading-relaxed text-ink">{review.quote}</blockquote>
                    <figcaption className="mt-8 flex items-center gap-3 border-t border-line pt-5">
                      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lightblue text-sm font-bold text-primary">
                        {Array.from(review.name)[0]}
                      </span>
                      <div className="min-w-0">
                        <p dir="auto" className="break-words text-sm font-bold text-ink">{review.name}</p>
                        {review.role && <p dir="auto" className="mt-1 break-words text-xs text-muted">{review.role}</p>}
                      </div>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
            {reviews.length > 1 && <p className="mt-3 text-xs text-muted lg:hidden">Swipe or scroll to read more.</p>}
          </>
        ) : (
          <div className="relative mt-10 overflow-hidden rounded-[1.75rem] border border-white/10 bg-navy px-6 py-10 text-white sm:px-10 sm:py-12">
            <div aria-hidden className="pointer-events-none absolute -right-12 -top-20 size-64 rounded-full border-[32px] border-white/5" />
            <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-1 w-24 bg-bright" />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-lg">
                <p className="text-xs font-bold uppercase tracking-widest text-white/60">Your time on the mat. Your story.</p>
                <h3 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Shot with us? Tell us how it went.</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/75">A tournament, a training session or a team day. We’d love to hear what you thought of your coverage.</p>
              </div>
              <Link href="/contact" data-umami-event="contact-click" className="btn-primary min-h-12 shrink-0 self-start px-6 sm:self-auto">
                <SendIcon size={16} /> Share your experience
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
