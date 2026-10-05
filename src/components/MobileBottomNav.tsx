"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BOTTOM_ITEMS, isActivePath, navItemsFor } from "./nav";

const GRID_COLS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" };

export function MobileBottomNav({ collaboratorOnly = false }: { collaboratorOnly?: boolean }) {
  const pathname = usePathname();
  const items = navItemsFor(BOTTOM_ITEMS, collaboratorOnly);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur lg:hidden safe-bottom" aria-label="Primary">
      <ul className={cn("grid", GRID_COLS[items.length] ?? "grid-cols-5")}>
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                  active ? "text-primary" : "text-muted",
                )}
              >
                <span className={cn("flex h-7 w-11 items-center justify-center rounded-full", active && "bg-lightblue")}>
                  <Icon size={22} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
