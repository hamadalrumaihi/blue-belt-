import type { ComponentType } from "react";
import { CalendarIcon, CheckIcon, EyeIcon, HistoryIcon, HomeIcon, MoreIcon, SettingsIcon, UsersIcon } from "./icons";

export type NavItem = { href: string; label: string; icon: ComponentType<{ size?: number; className?: string }> };

export const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/events", label: "Events", icon: CalendarIcon },
  { href: "/clients", label: "Clients", icon: UsersIcon },
  { href: "/watcher", label: "Match Watcher", icon: EyeIcon },
  { href: "/coverage", label: "My coverage", icon: CheckIcon },
  { href: "/history", label: "History", icon: HistoryIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export const BOTTOM_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: HomeIcon },
  { href: "/events", label: "Event", icon: CalendarIcon },
  { href: "/clients", label: "Clients", icon: UsersIcon },
  { href: "/watcher", label: "Watcher", icon: EyeIcon },
  { href: "/more", label: "More", icon: MoreIcon },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/more") return ["/more", "/history", "/settings"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}
