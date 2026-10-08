import type { ComponentType } from "react";
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  EyeIcon,
  FileTextIcon,
  HistoryIcon,
  HomeIcon,
  ImageIcon,
  InboxIcon,
  MoreIcon,
  BellIcon,
  BookmarkIcon,
  CreditCardIcon,
  BuildingIcon,
  ReceiptIcon,
  SettingsIcon,
  SwordsIcon,
  TagIcon,
  UsersIcon,
} from "./icons";

export type NavGroup = "studio" | "delivery" | "tournaments" | "account";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Sidebar section. */
  group?: NavGroup;
  /** Owner surfaces (financial / customer / account data). Hidden for collaborator-only users. */
  ownerOnly?: boolean;
  /** Collaborator shortcuts. Hidden for owners, so the owner's own nav is unchanged. */
  collaboratorOnly?: boolean;
};

export const NAV_GROUP_LABEL: Record<NavGroup, string> = { studio: "Studio", delivery: "Delivery", tournaments: "Tournaments", account: "Account" };
export const NAV_GROUP_ORDER: readonly NavGroup[] = ["studio", "delivery", "tournaments", "account"];

/**
 * Blue Belt Media studio navigation. The Tournament Watcher is one module
 * (its routes are unchanged); the studio surfaces sit beside it.
 */
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/studio", label: "Dashboard", icon: HomeIcon, group: "studio", ownerOnly: true },
  { href: "/leads", label: "Leads", icon: InboxIcon, group: "studio", ownerOnly: true },
  { href: "/bookings", label: "Bookings", icon: BookmarkIcon, group: "studio", ownerOnly: true },
  { href: "/people", label: "Clients", icon: UsersIcon, group: "studio", ownerOnly: true },
  { href: "/clubs", label: "Teams & clubs", icon: BuildingIcon, group: "studio", ownerOnly: true },
  { href: "/pricing", label: "Pricing", icon: TagIcon, group: "studio", ownerOnly: true },
  { href: "/documents", label: "Contracts", icon: FileTextIcon, group: "delivery", ownerOnly: true },
  { href: "/payments", label: "Payments", icon: CreditCardIcon, group: "delivery", ownerOnly: true },
  { href: "/galleries", label: "Galleries", icon: ImageIcon, group: "delivery", ownerOnly: true },
  { href: "/orders", label: "Orders", icon: ReceiptIcon, group: "delivery", ownerOnly: true },
  { href: "/dashboard", label: "Tournament day", icon: SwordsIcon, group: "tournaments", ownerOnly: true },
  { href: "/watcher", label: "Tournament Watcher", icon: EyeIcon, group: "tournaments", ownerOnly: true },
  { href: "/events", label: "Events", icon: CalendarIcon, group: "tournaments", ownerOnly: true },
  { href: "/clients", label: "Athletes", icon: SwordsIcon, group: "tournaments", ownerOnly: true },
  { href: "/coverage", label: "My coverage", icon: CheckIcon, group: "tournaments" },
  { href: "/issues", label: "Issues", icon: AlertIcon, group: "tournaments", ownerOnly: true },
  { href: "/notifications", label: "Notifications", icon: BellIcon, group: "account", ownerOnly: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon, group: "account" },
];

export const BOTTOM_ITEMS: NavItem[] = [
  { href: "/studio", label: "Studio", icon: HomeIcon, ownerOnly: true },
  { href: "/bookings", label: "Bookings", icon: BookmarkIcon, ownerOnly: true },
  { href: "/dashboard", label: "Today", icon: SwordsIcon, ownerOnly: true },
  { href: "/watcher", label: "Watcher", icon: EyeIcon, ownerOnly: true },
  { href: "/coverage", label: "Coverage", icon: CheckIcon, collaboratorOnly: true },
  { href: "/more", label: "More", icon: MoreIcon },
];

/** Everything reachable from the More page (mobile), in display order. */
export const MORE_ITEMS: NavItem[] = [
  { href: "/leads", label: "Leads", icon: InboxIcon, group: "studio", ownerOnly: true },
  { href: "/people", label: "Clients", icon: UsersIcon, group: "studio", ownerOnly: true },
  { href: "/clubs", label: "Teams & clubs", icon: BuildingIcon, group: "studio", ownerOnly: true },
  { href: "/pricing", label: "Pricing", icon: TagIcon, group: "studio", ownerOnly: true },
  { href: "/packages", label: "Services & packages", icon: ReceiptIcon, group: "studio", ownerOnly: true },
  { href: "/documents", label: "Contracts & releases", icon: FileTextIcon, group: "delivery", ownerOnly: true },
  { href: "/payments", label: "Payments", icon: CreditCardIcon, group: "delivery", ownerOnly: true },
  { href: "/galleries", label: "Galleries", icon: ImageIcon, group: "delivery", ownerOnly: true },
  { href: "/orders", label: "Orders (Pic-Time)", icon: ReceiptIcon, group: "delivery", ownerOnly: true },
  { href: "/events", label: "Events", icon: CalendarIcon, group: "tournaments", ownerOnly: true },
  { href: "/clients", label: "Athletes", icon: SwordsIcon, group: "tournaments", ownerOnly: true },
  { href: "/issues", label: "Issues (watcher problems)", icon: AlertIcon, group: "tournaments", ownerOnly: true },
  { href: "/history", label: "Activity / change history", icon: HistoryIcon, group: "tournaments", ownerOnly: true },
  { href: "/import", label: "Import a page (CAPTCHA workaround)", icon: EyeIcon, group: "tournaments", ownerOnly: true },
  { href: "/notifications", label: "Notifications", icon: BellIcon, group: "account", ownerOnly: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon, group: "account" },
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

/** Sidebar items split into their sections, empty sections dropped. */
export function groupNavItems(items: NavItem[]): Array<{ group: NavGroup; items: NavItem[] }> {
  return NAV_GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => (i.group ?? "account") === group) })).filter((g) => g.items.length > 0);
}

/** Literal class names (Tailwind must see them verbatim) for the bottom bar's column count. */
const BOTTOM_GRID_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6" };

/** One row for every item, whatever the count. */
export function bottomGridClass(count: number): string {
  return BOTTOM_GRID_COLS[count] ?? "grid-flow-col auto-cols-fr";
}

/** Routes that live under "More" on the phone (not in the bottom bar). */
const MORE_ROUTES = ["/more", "/history", "/settings", "/orders", "/leads", "/people", "/clubs", "/pricing", "/packages", "/documents", "/payments", "/galleries", "/events", "/clients", "/issues", "/import", "/notifications"];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/more") return MORE_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}
