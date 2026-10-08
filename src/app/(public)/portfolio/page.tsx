import type { Metadata } from "next";
import Link from "next/link";
import { ExternalIcon, ImageIcon } from "@/components/icons";
import { pageMetadata } from "@/lib/seo";
import { loadPublicStudio, pictimeGalleryUrl } from "@/lib/studio/queries";
import { readPortfolio } from "@/lib/studio/site-content";

export const dynamic = "force-dynamic";
/* Thin signpost page: galleries live with the gallery host, so this is kept out of search results. */
export const metadata: Metadata = pageMetadata({
  title: "View and buy photos",
  description: "Every Blue Belt Media booking is delivered through a private online gallery. View, download and buy your photos there.",
  path: "/portfolio",
  index: false,
});

export default async function PortfolioPage() {
  const pub = await loadPublicStudio();
  const studio = pub?.studio ?? null;
  const links = studio ? readPortfolio(studio.settings) : [];
  const galleryUrl = pictimeGalleryUrl(studio);

  return (
    <main className="mx-auto max-w-3xl px-4 py-14 text-center lg:px-8 lg:py-24">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-lightblue text-primary"><ImageIcon size={28} /></span>
      <p className="eyebrow mt-6">Galleries</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl">Your private galleries</h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted">
        Every booking is delivered through a private online gallery where you can view, download and buy photos. Public event galleries are published in the same place.
      </p>
      <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="btn-primary mt-8 min-h-14 w-full px-8 text-lg sm:w-auto">
        View and buy photos <ExternalIcon size={18} />
        <span className="sr-only">(opens your gallery in a new tab)</span>
      </a>

      {links.length > 0 && (
        <section className="mt-14 text-left" aria-labelledby="highlights-heading">
          <h2 id="highlights-heading" className="text-lg font-extrabold text-navy">Highlighted galleries</h2>
          <ul className="mt-4 divide-y divide-line rounded-card border border-line">
            {links.map((p) => (
              <li key={p.url}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-base font-semibold text-ink hover:text-primary">
                  {p.title}
                  <ExternalIcon size={16} className="shrink-0 text-muted" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-sm text-muted">
        Want coverage of your own event? See <Link href="/services" className="font-semibold text-primary">services and prices</Link> or <Link href="/contact" className="font-semibold text-primary">contact us</Link>.
      </p>
    </main>
  );
}
