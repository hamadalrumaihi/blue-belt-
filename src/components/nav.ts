import type { ComponentType } from "react";
import { AlertIcon, CalendarIcon, CheckIcon, EyeIcon, HistoryIcon, HomeIcon, MoreIcon, ReceiptIcon, SettingsIcon, UsersIcon } from "./icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Owner surfaces (financial / customer / account data). Hidden for collaborator-only users. */
  ownerOnly?: boolean;
  /** Collaborator shortcuts. Hidden for owners, so the owner's own nav is unchanged. */
  collaboratorOnly?: boolean;
};

export const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon, ownerOnly: true },
  { href: "/events", label: "Events", icon: CalendarIcon, ownerOnly: true },
  { href: "/clients", label: "Clients", icon: UsersIcon, ownerOnly: true },
  { href: "/watcher", label: "Match Watcher", icon: EyeIcon, ownerOnly: true },
  { href: "/issues", label: "Issues", icon: AlertIcon, ownerOnly: true },
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
  { href: "/coverage", label: "Coverage", icon: CheckIcon, collaboratorOnly: true },
  { href: "/more", label: "More", icon: MoreIcon },
];

/**
 * The nav items a viewer should see. A collaborator-only user (no owned events,
 * invited to someone else's) gets just the collaborator surfaces, so owner data
 * such as Orders is never offered to them. Owners see their usual nav; the
 * collaborator-only shortcuts are left out for them.
 */
export function navItemsFor(items: NavItem[], collaboratorOnly: boolean): NavItem[] {
  return items.filter((item) => (collaboratorOnly ? !item.ownerOnly : !item.collaboratorOnly));
}

/** Literal class names (Tailwind must see them verbatim) for the bottom bar's column count. */
const BOTTOM_GRID_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6" };

/** One row for every item, whatever the count. */
export function bottomGridClass(count: number): string {
  return BOTTOM_GRID_COLS[count] ?? "grid-flow-col auto-cols-fr";
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/more") return ["/more", "/history", "/settings", "/orders"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}
