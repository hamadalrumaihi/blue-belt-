import type { ComponentType } from "react";
import { CalendarIcon, CheckIcon, EyeIcon, HistoryIcon, HomeIcon, MoreIcon, ReceiptIcon, SettingsIcon, UsersIcon } from "./icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Owner surfaces (financial / customer / account data). Hidden for collaborator-only users. */
  ownerOnly?: boolean;
};

export const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon, ownerOnly: true },
  { href: "/events", label: "Events", icon: CalendarIcon, ownerOnly: true },
  { href: "/clients", label: "Clients", icon: UsersIcon, ownerOnly: true },
  { href: "/watcher", label: "Match Watcher", icon: EyeIcon, ownerOnly: true },
  { href: "/coverage", label: "My coverage", icon: CheckIcon },
  { href: "/orders", label: "Orders", icon: ReceiptIcon, ownerOnly: true },
  { href: "/history", label: "History", icon: HistoryIcon, ownerOnly: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export const BOTTOM_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: HomeIcon, ownerOnly: true },
  { href: "/events", label: "Event", icon: CalendarIcon, ownerOnly: true },
  { href: "/clients", label: "Clients", icon: UsersIcon, ownerOnly: true },
  { href: "/watcher", label: "Watcher", icon: EyeIcon, ownerOnly: true },
  { href: "/coverage", label: "Coverage", icon: CheckIcon },
  { href: "/more", label: "More", icon: MoreIcon },
];

/**
 * The nav items a viewer should see. A collaborator-only user (no owned events,
 * invited to someone else's) gets just the collaborator surfaces, so owner data
 * such as Orders is never offered to them. Owners see everything.
 */
export function navItemsFor(items: NavItem[], collaboratorOnly: boolean): NavItem[] {
  return collaboratorOnly ? items.filter((item) => !item.ownerOnly) : items;
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/more") return ["/more", "/history", "/settings", "/orders"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}
