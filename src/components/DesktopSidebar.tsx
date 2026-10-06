"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";
import { LogoutIcon } from "./icons";
import { Logo } from "./Logo";
import { isActivePath, navItemsFor, SIDEBAR_ITEMS } from "./nav";

export function DesktopSidebar({ email, collaboratorOnly = false }: { email: string | null; collaboratorOnly?: boolean }) {
  const pathname = usePathname();
  const items = navItemsFor(SIDEBAR_ITEMS, collaboratorOnly);
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy text-white lg:flex">
      <div className="px-5 pb-4 pt-6">
        <Logo inverted caption size={44} />
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
                active ? "bg-primary text-white shadow-hero" : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4">
        {email && <p className="mb-2 truncate px-1 text-xs text-white/60" title={email}>{email}</p>}
        <form action={signOut}>
          <button type="submit" className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">
            <LogoutIcon size={18} /> Sign out
          </button>
        </form>
        <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.14em] text-white/40">Tournament Coverage Command Center</p>
      </div>
    </aside>
  );
}
