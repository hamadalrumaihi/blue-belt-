"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";
import { LogoutIcon } from "./icons";
import { Logo } from "./Logo";
import { groupNavItems, isActivePath, NAV_GROUP_LABEL, navItemsFor, SIDEBAR_ITEMS } from "./nav";

export function DesktopSidebar({ email, collaboratorOnly = false }: { email: string | null; collaboratorOnly?: boolean }) {
  const pathname = usePathname();
  const groups = groupNavItems(navItemsFor(SIDEBAR_ITEMS, collaboratorOnly));
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy text-white lg:flex">
      <div className="px-5 pb-3 pt-6">
        <Logo inverted caption size={44} href="/studio" />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {groups.map(({ group, items }) => (
          <div key={group} className="mt-3 first:mt-0">
            {groups.length > 1 && <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{NAV_GROUP_LABEL[group]}</p>}
            <ul className="space-y-0.5">
              {items.map(({ href, label, icon: Icon }) => {
                const active = isActivePath(pathname, href);
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
        {email && <p className="mb-2 truncate px-1 text-xs text-white/60" title={email}>{email}</p>}
        <form action={signOut}>
          <button type="submit" className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">
            <LogoutIcon size={18} /> Sign out
          </button>
        </form>
        <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.14em] text-white/40">Blue Belt Media · Studio</p>
      </div>
    </aside>
  );
}
