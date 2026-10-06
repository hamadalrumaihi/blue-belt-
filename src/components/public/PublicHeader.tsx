"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CloseIcon, MoreIcon } from "../icons";
import { Logo } from "../Logo";

const LINKS = [
  { href: "/services", label: "Services" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/contact", label: "Contact" },
];

/**
 * Public site header: logo, three links, Book now, account link. Collapses
 * to a sheet on phones; Book now stays visible at every width.
 */
export function PublicHeader({ accountLink, bookingOpen }: { accountLink: { href: string; label: string }; bookingOpen: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-3 px-4 lg:px-8">
        <Logo href="/" size={36} />
        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Site">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined} className={cn("rounded-xl px-3 py-2 text-sm font-semibold", active(l.href) ? "bg-lightblue text-primary" : "text-ink hover:bg-page")}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href={accountLink.href} className="btn-ghost hidden min-h-10 px-3 md:inline-flex">{accountLink.label}</Link>
          <Link href={bookingOpen ? "/book" : "/contact"} className="btn-primary min-h-10 px-4">{bookingOpen ? "Book now" : "Get in touch"}</Link>
          <button type="button" className="btn-ghost min-h-10 w-10 px-0 md:hidden" aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((v) => !v)}>
            {open ? <CloseIcon /> : <MoreIcon />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="site-menu" className="border-t border-line bg-white px-4 py-2 md:hidden" aria-label="Site">
          <ul>
            {[...LINKS, accountLink].map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center text-base font-semibold text-ink">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
