import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@/components/public/Analytics";
import { HtmlLang } from "@/components/public/HtmlLang";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { dirFor, htmlLangScript } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { tr, UI } from "@/lib/i18n/ui";
import { siteMetadata } from "@/lib/seo";
import { loadPublicStudio, pictimeGalleryUrl, siteUrl } from "@/lib/studio/queries";
import { resolveViewer } from "@/lib/roles";

/** Search defaults for every public page (metadataBase, title template, Open Graph); pages override title, description and canonical. */
export const metadata: Metadata = siteMetadata(siteUrl());

/**
 * The public Blue Belt Media website, in English or Arabic (cookie
 * `bbm_lang`, switched with `?lang=`; URLs never change). No session
 * required; a signed-in owner gets a "Studio" link, a signed-in client a
 * "My bookings" link. Analytics (Umami, optional) is loaded here only.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [viewer, pub, locale] = await Promise.all([resolveViewer(), loadPublicStudio(), getLocale()]);
  const t = tr(locale);
  const link = viewer ? (viewer.role === "client" ? { href: "/client", label: t(UI.nav.myBookings) } : { href: "/studio", label: t(UI.nav.studio) }) : { href: "/client/login", label: t(UI.nav.clientPortal) };
  const galleryUrl = pictimeGalleryUrl(pub?.studio ?? null);
  return (
    <div lang={locale} dir={dirFor(locale)} className="flex min-h-dvh flex-col bg-white text-ink">
      {/* Our own constant string (src/lib/i18n/locale.ts), never user content: mirrors lang/dir onto <html> before first paint. */}
      <script dangerouslySetInnerHTML={{ __html: htmlLangScript(locale) }} />
      <HtmlLang locale={locale} />
      <PublicHeader locale={locale} accountLink={link} bookingOpen={Boolean(pub?.studio.public_booking)} galleryUrl={galleryUrl} />
      <div className="flex-1">{children}</div>
      <PublicFooter studio={pub?.studio ?? null} galleryUrl={galleryUrl} locale={locale} accountLink={link} />
      <Analytics />
    </div>
  );
}
