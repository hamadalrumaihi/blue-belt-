"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";
import { LogoutIcon, SearchIcon } from "./icons";
import { Logo } from "./Logo";
import { groupNavItems, isActivePath, NAV_GROUP_LABEL, navItemsFor, SIDEBAR_ITEMS } from "./nav";
import { ThemeToggle } from "./ThemeToggle";

export function DesktopSidebar({ email, collaboratorOnly = false }: { email: string | null; collaboratorOnly?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const groups = groupNavItems(navItemsFor(SIDEBAR_ITEMS, collaboratorOnly));
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the workspace search from anywhere (unless typing already).
  useEffect(() => {
    if (collaboratorOnly) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collaboratorOnly]);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy text-white lg:flex print:hidden">
      <div className="px-5 pb-3 pt-6">
        <Logo inverted caption size={44} href="/studio" />
      </div>
      {!collaboratorOnly && (
        <form action="/studio" method="get" role="search" className="px-3 pb-2" aria-label="Search the workspace">
          <label htmlFor="sidebar-search" className="sr-only">Search people, clubs, bookings, leads, events and athletes</label>
          <div className="flex min-h-10 items-center gap-2 rounded-xl bg-white/10 px-3 focus-within:bg-white/15">
            <SearchIcon size={16} className="shrink-0 text-white/60" />
            <input ref={searchRef} id="sidebar-search" name="q" type="search" placeholder="Search…  ( / )" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none" />
          </div>
        </form>
      )}
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {groups.map(({ group, items }) => (
          <div key={group} className="mt-3 first:mt-0">
            {groups.length > 1 && <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{NAV_GROUP_LABEL[group]}</p>}
            <ul className="space-y-0.5">
              {items.map(({ href, label, icon: Icon }) => {
                const active = isActivePath(pathname, href, search);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
                        active ? "bg-primary text-white shadow-hero" : "text-white/70 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      <Icon size={19} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="mb-3">
          <p id="sidebar-appearance" className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Appearance</p>
          <ThemeToggle showLabels onNavy className="w-full" aria-labelledby="sidebar-appearance" />
        </div>
        {email && <p className="mb-2 truncate px-1 text-xs text-white/60" title={email}>{email}</p>}
        <form action={signOut}>
          <button type="submit" className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">
            <LogoutIcon size={18} /> Sign out
          </button>
        </form>
        <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.14em] text-white/40">Blue Belt Media · Workspace</p>
      </div>
    </aside>
  );
}
