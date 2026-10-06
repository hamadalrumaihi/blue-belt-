import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, ExternalIcon, ImageIcon, InstagramIcon } from "@/components/icons";
import { loadPublicStudio } from "@/lib/studio/queries";
import { readPortfolio } from "@/lib/studio/site-content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portfolio — Blue Belt Media", description: "Selected tournament, academy and athlete galleries, delivered through Pic-Time." };

/* Covers are optional and only ever https links the owner put in settings. Without one, a CSS tile stands in: never a stock or made-up image. */
function Tile({ i }: { i: number }) {
  const tones = ["bg-navy", "bg-navy-800", "bg-navy-700", "bg-primary-700"];
  return (
    <div aria-hidden className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl ${tones[i % tones.length]}`}>
      <div className="absolute inset-3 rounded-lg border border-white/10" />
      <div className="absolute left-5 top-5 h-1.5 w-10 rounded-full bg-primary" />
      <ImageIcon size={28} className="absolute bottom-5 right-5 text-white/40" />
    </div>
  );
}

export default async function PortfolioPage() {
  const pub = await loadPublicStudio();
  const studio = pub?.studio ?? null;
  const links = studio ? readPortfolio(studio.settings) : [];
  const ig = studio?.instagram?.replace(/^@/, "") ?? null;
  const bookingOpen = Boolean(studio?.public_booking);

  return (
    <main>
      <section className="bg-navy text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
          <p className="eyebrow !text-white/60">Portfolio</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">Selected galleries</h1>
          <p className="mt-4 max-w-xl text-base text-white/75">Every booking is delivered as a private Pic-Time gallery. The highlights below are public sets the studio chose to share.</p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
        {links.length ? (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((p, i) => (
              <li key={p.url}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="card group block overflow-hidden p-3 transition-colors hover:border-primary/40">
                  {p.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- owner-supplied https cover from Pic-Time; no remote image config for arbitrary hosts.
                    <img src={p.cover} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" loading="lazy" />
                  ) : (
                    <Tile i={i} />
                  )}
                  <p className="mt-3 flex items-center justify-between px-1 pb-1 text-base font-bold text-ink">
                    {p.title}
                    <ExternalIcon size={16} className="text-muted group-hover:text-primary" />
                  </p>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-center">
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => <Tile key={i} i={i} />)}
            </div>
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-navy">Galleries live in Pic-Time</h2>
              <p className="mt-3 text-base leading-relaxed text-muted">
                Our work is delivered privately to the athletes and clubs who booked it, so there is no public wall of photos here. Each client receives a Pic-Time link with downloads, sharing and print orders.
              </p>
              <p className="mt-3 text-base leading-relaxed text-muted">Public highlights will appear on this page as galleries are released.</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                {ig && (
                  <a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                    <InstagramIcon size={18} /> Recent work on Instagram
                  </a>
                )}
                <Link href={bookingOpen ? "/book" : "/contact"} className="btn-primary">
                  {bookingOpen ? "Book your coverage" : "Get in touch"} <ChevronRightIcon size={16} />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
