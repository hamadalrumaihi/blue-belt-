"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CloseIcon, ExternalIcon, MoreIcon } from "../icons";
import { Logo } from "../Logo";
import { ThemeToggle } from "../ThemeToggle";

export const GALLERY_LINK_LABEL = "View and buy photos";

type Props = {
  accountLink: { href: string; label: string };
  bookingOpen: boolean;
  /** The public client gallery (see `pictimeGalleryUrl`); opens in a new tab. */
  galleryUrl: string;
};

/**
 * Public site header: logo, Services, the external gallery link,
 * Contact, Book now and the account link. Collapses to a sheet on phones;
 * Book now stays visible at every width.
 */
export function PublicHeader({ accountLink, bookingOpen, galleryUrl }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const galleryLink = (className: string) => (
    <a href={galleryUrl} target="_blank" rel="noopener noreferrer" data-umami-event="gallery-click" className={className} onClick={() => setOpen(false)}>
      {GALLERY_LINK_LABEL}
      <ExternalIcon size={14} className="ml-1 inline" />
      <span className="sr-only"> (opens your gallery in a new tab)</span>
    </a>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-3 px-4 lg:px-8">
        <Logo href="/" size={36} />
        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Site">
          <Link href="/services" aria-current={active("/services") ? "page" : undefined} className={cn("rounded-xl px-3 py-2 text-sm font-semibold", active("/services") ? "bg-lightblue text-primary" : "text-ink hover:bg-page")}>
            Services
          </Link>
          {galleryLink("rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:bg-page")}
          <Link href="/contact" aria-current={active("/contact") ? "page" : undefined} className={cn("rounded-xl px-3 py-2 text-sm font-semibold", active("/contact") ? "bg-lightblue text-primary" : "text-ink hover:bg-page")}>
            Contact
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle variant="cycle" className="hidden min-h-10 w-10 md:inline-flex" />
          <Link href={accountLink.href} className="btn-ghost hidden min-h-10 px-3 md:inline-flex">{accountLink.label}</Link>
          <Link href={bookingOpen ? "/book" : "/contact"} data-umami-event={bookingOpen ? "book-start" : "contact-click"} className="btn-primary min-h-10 px-4">{bookingOpen ? "Book now" : "Get in touch"}</Link>
          <button type="button" className="btn-ghost min-h-10 w-10 px-0 md:hidden" aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((v) => !v)}>
            {open ? <CloseIcon /> : <MoreIcon />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="site-menu" className="border-t border-line bg-white px-4 py-2 md:hidden" aria-label="Site">
          <ul>
            <li>
              <Link href="/services" onClick={() => setOpen(false)} className="flex min-h-12 items-center text-base font-semibold text-ink">Services</Link>
            </li>
            <li>{galleryLink("flex min-h-12 items-center text-base font-semibold text-ink")}</li>
            <li>
              <Link href="/contact" onClick={() => setOpen(false)} className="flex min-h-12 items-center text-base font-semibold text-ink">Contact</Link>
            </li>
            <li>
              <Link href={accountLink.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center text-base font-semibold text-ink">{accountLink.label}</Link>
            </li>
          </ul>
          <div className="flex min-h-14 items-center justify-between gap-3 border-t border-line">
            <span id="site-menu-appearance" className="text-base font-semibold text-ink">Appearance</span>
            <ThemeToggle aria-labelledby="site-menu-appearance" />
          </div>
        </nav>
      )}
    </header>
  );
}
