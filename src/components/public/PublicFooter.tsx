import Link from "next/link";
import type { Locale } from "@/lib/i18n/locale";
import { tr, UI } from "@/lib/i18n/ui";
import { businessIdentity, businessLegalLine } from "@/lib/studio/business";
import type { PhotoStudioRow } from "@/lib/supabase/database.types";
import { ExternalIcon, InstagramIcon, MailIcon } from "../icons";
import { Logo } from "../Logo";

type Props = {
  studio: PhotoStudioRow | null;
  /** The public client gallery (see `pictimeGalleryUrl`); opens in a new tab. */
  galleryUrl: string;
  locale?: Locale;
  accountLink?: { href: string; label: string };
};

/** Site footer: brand line, the public pages, the external gallery, the portal, contact and the legal line. Never a phone number. */
export function PublicFooter({ studio, galleryUrl, locale = "en", accountLink }: Props) {
  const t = tr(locale);
  const name = studio?.business_name ?? "Blue Belt Media";
  const identity = businessIdentity();
  const ig = studio?.instagram?.replace(/^@/, "") ?? null;
  const email = studio?.email || identity.email;
  const account = accountLink ?? { href: "/client/login", label: t(UI.nav.clientPortal) };
  const pages = [
    ["/work", t(UI.nav.work)],
    ["/services", t(UI.nav.services)],
    ["/how-it-works", t(UI.nav.howItWorks)],
    ["/contact", t(UI.nav.contact)],
    ["/privacy", t(UI.nav.privacy)],
    ["/terms", t(UI.nav.terms)],
  ] as const;
  return (
    <footer className="border-t border-line bg-navy text-white">
      <div className="container-x grid gap-8 py-10 sm:grid-cols-2 md:grid-cols-4">
        <div className="sm:col-span-2 md:col-span-1">
          <Logo inverted href="/" size={40} />
          <p className="mt-3 max-w-xs text-sm text-white/70">
            {studio?.tagline ?? t(UI.footer.tagline)} {studio?.city ? `${t(UI.footer.basedIn)} ${studio.city}.` : ""}
          </p>
        </div>
        <nav aria-label={t(UI.nav.explore)}>
          <p className="eyebrow mb-2 !text-white/50">{t(UI.nav.explore)}</p>
          <ul className="space-y-1 text-sm">
            {pages.map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="inline-flex min-h-9 items-center text-white/80 hover:text-white">{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t(UI.nav.clientPortal)}>
          <p className="eyebrow mb-2 !text-white/50">{t(UI.common.privateGallery)}</p>
          <ul className="space-y-1 text-sm">
            <li>
              <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className="inline-flex min-h-9 items-center gap-1 text-white/80 hover:text-white">
                {t(UI.nav.findMyPhotos)} <ExternalIcon size={14} />
                <span className="sr-only">{t(UI.nav.opensGallery)}</span>
              </a>
            </li>
            <li>
              <Link href={account.href} className="inline-flex min-h-9 items-center text-white/80 hover:text-white">{account.label}</Link>
            </li>
            <li>
              <Link href="/book" data-umami-event="book-start" className="inline-flex min-h-9 items-center text-white/80 hover:text-white">{t(UI.nav.requestCoverage)}</Link>
            </li>
          </ul>
        </nav>
        <div>
          <p className="eyebrow mb-2 !text-white/50">{t(UI.nav.talkToUs)}</p>
          <ul className="space-y-1 text-sm">
            {ig && (
              <li>
                <a href={`https://instagram.com/${ig}`} rel="noopener noreferrer" target="_blank" data-umami-event="contact-click" className="inline-flex min-h-9 items-center gap-2 text-white/80 hover:text-white" dir="ltr">
                  <InstagramIcon size={18} /> @{ig}
                </a>
              </li>
            )}
            <li>
              <a href={`mailto:${email}`} data-umami-event="contact-click" className="inline-flex min-h-9 items-center gap-2 break-all text-white/80 hover:text-white" dir="ltr">
                <MailIcon size={18} /> {email}
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="space-y-1 border-t border-white/10 px-gutter py-4 text-center text-xs text-white/50">
        <p>
          © {new Date().getFullYear()} {name}. {t(UI.footer.delivered)}
        </p>
        <p dir="ltr">{businessLegalLine(identity)}</p>
      </div>
    </footer>
  );
}
