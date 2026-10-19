"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { langSwitchHref, LOCALE_LABEL, otherLocale } from "@/lib/i18n/locale";
import { tr, UI } from "@/lib/i18n/ui";
import { inquiryHref } from "@/lib/inquiries/labels";
import { cn } from "@/lib/utils";
import { CloseIcon, ExternalIcon, MoreIcon } from "../icons";
import { Logo } from "../Logo";
import { ThemeToggle } from "../ThemeToggle";
import { LanguageSwitch } from "./LanguageSwitch";

/**
 * Shown only while the search-params-aware switch is suspended. It cannot
 * read the query on the server, so it starts from the path alone and picks
 * up the current query after mount, keeping every parameter.
 */
const noSubscribe = () => () => {};
const readSearch = () => {
  try {
    return window.location.search;
  } catch {
    return "";
  }
};
function SwitchFallback({ locale, pathname }: { locale: Locale; pathname: string }) {
  const next = otherLocale(locale);
  // Server snapshot is empty (the query is unknown there); the browser's current query takes over after hydration.
  const search = useSyncExternalStore(noSubscribe, readSearch, () => "");
  const href = langSwitchHref(pathname, search, next);
  return (
    <a href={href} hrefLang={next} lang={next} rel="nofollow" className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-ink hover:bg-page">
      {LOCALE_LABEL[next]}
    </a>
  );
}

type Props = {
  locale: Locale;
  accountLink: { href: string; label: string };
  bookingOpen: boolean;
  /** The public client gallery (see `pictimeGalleryUrl`); opens in a new tab. */
  galleryUrl: string;
};

/**
 * Public site header. Primary: Work, Services, How it works, Contact and
 * the request button. Secondary: Find my photos (external gallery) and the
 * client portal, plus language and appearance. Below `lg` the secondary
 * items fold into a sheet; the request button stays visible at every width.
 */
export function PublicHeader({ locale, accountLink, bookingOpen, galleryUrl }: Props) {
  const t = tr(locale);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const primary = [
    { href: "/work", label: t(UI.nav.work) },
    { href: "/services", label: t(UI.nav.services) },
    { href: "/how-it-works", label: t(UI.nav.howItWorks) },
    { href: "/contact", label: t(UI.nav.contact) },
  ];
  const cta = bookingOpen ? { href: "/book", label: t(UI.nav.requestCoverage), event: "book-start" } : { href: inquiryHref("tournament_event", pathname), label: t(UI.nav.getQuote), event: "contact-click" };
  const galleryLink = (className: string) => (
    <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className={className} onClick={close}>
      {t(UI.nav.findMyPhotos)}
      <ExternalIcon size={14} className="ms-1 inline" />
      <span className="sr-only"> {t(UI.nav.opensGallery)}</span>
    </a>
  );
  const switchFallback = <SwitchFallback locale={locale} pathname={pathname} />;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="container-x flex min-h-16 items-center gap-2">
        <Logo href="/" size={36} />
        <nav className="ms-4 hidden items-center gap-1 md:flex" aria-label={t(UI.nav.siteNav)}>
          {primary.map((item) => (
            <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined} className={cn("inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold", active(item.href) ? "bg-lightblue text-primary" : "text-ink hover:bg-page")}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-1 sm:gap-2">
          <div className="hidden items-center gap-1 lg:flex">
            {galleryLink("inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-ink hover:bg-page")}
            <Link href={accountLink.href} className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-ink hover:bg-page">{accountLink.label}</Link>
            <Suspense fallback={switchFallback}>
              <LanguageSwitch locale={locale} className="text-ink hover:bg-page" />
            </Suspense>
            <ThemeToggle variant="cycle" className="min-h-10 w-10" />
          </div>
          <Link href={cta.href} data-umami-event={cta.event} className="btn-primary min-h-10 px-3 sm:px-4">{cta.label}</Link>
          <button type="button" className="btn-ghost min-h-10 w-10 px-0 lg:hidden" aria-expanded={open} aria-controls="site-menu" aria-label={open ? t(UI.nav.closeMenu) : t(UI.nav.openMenu)} onClick={() => setOpen((v) => !v)}>
            {open ? <CloseIcon /> : <MoreIcon />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="site-menu" className="border-t border-line bg-white px-gutter py-2 lg:hidden" aria-label={t(UI.nav.siteNav)}>
          <ul className="md:hidden">
            {primary.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={close} aria-current={active(item.href) ? "page" : undefined} className={cn("flex min-h-12 items-center text-base font-semibold", active(item.href) ? "text-primary" : "text-ink")}>{item.label}</Link>
              </li>
            ))}
          </ul>
          <ul className="border-t border-line md:border-t-0">
            <li>{galleryLink("flex min-h-12 items-center text-base font-semibold text-ink")}</li>
            <li>
              <Link href={accountLink.href} onClick={close} className="flex min-h-12 items-center text-base font-semibold text-ink">{accountLink.label}</Link>
            </li>
          </ul>
          <div className="flex min-h-14 items-center justify-between gap-3 border-t border-line">
            <span className="text-base font-semibold text-ink">{t(UI.nav.language)}</span>
            <Suspense fallback={switchFallback}>
              <LanguageSwitch locale={locale} className="border border-line text-ink" onNavigate={close} />
            </Suspense>
          </div>
          <div className="flex min-h-14 items-center justify-between gap-3 border-t border-line">
            <span id="site-menu-appearance" className="text-base font-semibold text-ink">{t(UI.nav.appearance)}</span>
            <ThemeToggle aria-labelledby="site-menu-appearance" />
          </div>
        </nav>
      )}
    </header>
  );
}
