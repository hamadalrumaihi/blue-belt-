import type { ComponentType } from "react";
import {
  AlertIcon,
  CalendarIcon,
  CameraIcon,
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

/**
 * Sidebar sections, in display order. The private workspace is organised by
 * the owner's workday rather than by database table: overview, selling,
 * producing, the tournament floor, money and delivery, the public website,
 * then settings.
 */
export type NavGroup = "overview" | "sales" | "production" | "tournament" | "finance" | "website" | "settings";

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

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  overview: "Overview",
  sales: "Sales",
  production: "Production",
  tournament: "Tournament day",
  finance: "Finance & delivery",
  website: "Website",
  settings: "Settings & integrations",
};
export const NAV_GROUP_ORDER: readonly NavGroup[] = ["overview", "sales", "production", "tournament", "finance", "website", "settings"];

/**
 * Blue Belt Media workspace navigation. The Tournament Watcher is one module
 * (its routes are unchanged); the studio surfaces sit beside it. Pricing and
 * every money surface stay owner-only; a collaborator keeps their coverage
 * board and settings.
 */
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/studio", label: "Overview", icon: HomeIcon, group: "overview", ownerOnly: true },
  { href: "/leads", label: "Leads", icon: InboxIcon, group: "sales", ownerOnly: true },
  { href: "/people", label: "Clients", icon: UsersIcon, group: "sales", ownerOnly: true },
  { href: "/clubs", label: "Teams & clubs", icon: BuildingIcon, group: "sales", ownerOnly: true },
  { href: "/pricing", label: "Quotes & pricing", icon: TagIcon, group: "sales", ownerOnly: true },
  { href: "/bookings", label: "Bookings & projects", icon: BookmarkIcon, group: "production", ownerOnly: true },
  { href: "/production", label: "Production board", icon: CameraIcon, group: "production", ownerOnly: true },
  { href: "/bookings?filter=confirmed", label: "Schedule", icon: CalendarIcon, group: "production", ownerOnly: true },
  { href: "/dashboard", label: "Today on the mats", icon: SwordsIcon, group: "tournament", ownerOnly: true },
  { href: "/watcher", label: "Tournament Watcher", icon: EyeIcon, group: "tournament", ownerOnly: true },
  { href: "/events", label: "Events", icon: CalendarIcon, group: "tournament", ownerOnly: true },
  { href: "/clients", label: "Athletes", icon: SwordsIcon, group: "tournament", ownerOnly: true },
  { href: "/coverage", label: "My coverage", icon: CheckIcon, group: "tournament" },
  { href: "/issues", label: "Issues", icon: AlertIcon, group: "tournament", ownerOnly: true },
  { href: "/documents", label: "Agreements", icon: FileTextIcon, group: "finance", ownerOnly: true },
  { href: "/orders", label: "Invoices & orders", icon: ReceiptIcon, group: "finance", ownerOnly: true },
  { href: "/payments", label: "Payments", icon: CreditCardIcon, group: "finance", ownerOnly: true },
  { href: "/galleries", label: "Client galleries", icon: ImageIcon, group: "finance", ownerOnly: true },
  { href: "/media", label: "Portfolio & media", icon: ImageIcon, group: "website", ownerOnly: true },
  { href: "/packages", label: "Service content", icon: ReceiptIcon, group: "website", ownerOnly: true },
  { href: "/website/testimonials", label: "Testimonials", icon: UsersIcon, group: "website", ownerOnly: true },
  { href: "/website/faqs", label: "FAQs & open questions", icon: FileTextIcon, group: "website", ownerOnly: true },
  { href: "/featured-work", label: "Legacy manifest selection", icon: ImageIcon, group: "website", ownerOnly: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon, group: "settings" },
  { href: "/notifications", label: "Notifications", icon: BellIcon, group: "settings", ownerOnly: true },
  { href: "/history", label: "Audit history", icon: HistoryIcon, group: "settings", ownerOnly: true },
];

/**
 * Phone bottom bar: mat day and lead follow-up first. Everything else is one
 * tap away under More. A collaborator gets Coverage + More.
 */
export const BOTTOM_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: SwordsIcon, ownerOnly: true },
  { href: "/watcher", label: "Watcher", icon: EyeIcon, ownerOnly: true },
  { href: "/leads", label: "Leads", icon: InboxIcon, ownerOnly: true },
  { href: "/bookings", label: "Bookings", icon: BookmarkIcon, ownerOnly: true },
  { href: "/coverage", label: "Coverage", icon: CheckIcon, collaboratorOnly: true },
  { href: "/more", label: "More", icon: MoreIcon },
];

/** Everything reachable from the More page (mobile), in display order. */
export const MORE_ITEMS: NavItem[] = [
  { href: "/studio", label: "Overview", icon: HomeIcon, group: "overview", ownerOnly: true },
  { href: "/studio/metrics", label: "Metrics", icon: HistoryIcon, group: "overview", ownerOnly: true },
  { href: "/people", label: "Clients", icon: UsersIcon, group: "sales", ownerOnly: true },
  { href: "/clubs", label: "Teams & clubs", icon: BuildingIcon, group: "sales", ownerOnly: true },
  { href: "/pricing", label: "Quotes & pricing", icon: TagIcon, group: "sales", ownerOnly: true },
  { href: "/production", label: "Production board", icon: CameraIcon, group: "production", ownerOnly: true },
  { href: "/bookings?filter=confirmed", label: "Schedule", icon: CalendarIcon, group: "production", ownerOnly: true },
  { href: "/events", label: "Events", icon: CalendarIcon, group: "tournament", ownerOnly: true },
  { href: "/clients", label: "Athletes", icon: SwordsIcon, group: "tournament", ownerOnly: true },
  { href: "/coverage", label: "My coverage", icon: CheckIcon, group: "tournament" },
  { href: "/issues", label: "Issues (watcher problems)", icon: AlertIcon, group: "tournament", ownerOnly: true },
  { href: "/import", label: "Import a page (CAPTCHA workaround)", icon: EyeIcon, group: "tournament", ownerOnly: true },
  { href: "/documents", label: "Agreements & releases", icon: FileTextIcon, group: "finance", ownerOnly: true },
  { href: "/orders", label: "Invoices & orders (Pic-Time)", icon: ReceiptIcon, group: "finance", ownerOnly: true },
  { href: "/payments", label: "Payments", icon: CreditCardIcon, group: "finance", ownerOnly: true },
  { href: "/galleries", label: "Client galleries", icon: ImageIcon, group: "finance", ownerOnly: true },
  { href: "/media", label: "Portfolio & media", icon: ImageIcon, group: "website", ownerOnly: true },
  { href: "/packages", label: "Service content", icon: ReceiptIcon, group: "website", ownerOnly: true },
  { href: "/website/testimonials", label: "Testimonials", icon: UsersIcon, group: "website", ownerOnly: true },
  { href: "/website/faqs", label: "FAQs & open questions", icon: FileTextIcon, group: "website", ownerOnly: true },
  { href: "/featured-work", label: "Legacy manifest selection", icon: ImageIcon, group: "website", ownerOnly: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon, group: "settings" },
  { href: "/notifications", label: "Notifications", icon: BellIcon, group: "settings", ownerOnly: true },
  { href: "/history", label: "Audit history", icon: HistoryIcon, group: "settings", ownerOnly: true },
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
  return NAV_GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => (i.group ?? "settings") === group) })).filter((g) => g.items.length > 0);
}

/** Literal class names (Tailwind must see them verbatim) for the bottom bar's column count. */
const BOTTOM_GRID_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6" };

/** One row for every item, whatever the count. */
export function bottomGridClass(count: number): string {
  return BOTTOM_GRID_COLS[count] ?? "grid-flow-col auto-cols-fr";
}

/** Routes that live under "More" on the phone (not in the bottom bar). */
export const MORE_ROUTES = [
  "/more",
  "/studio",
  "/history",
  "/settings",
  "/orders",
  "/people",
  "/clubs",
  "/pricing",
  "/production",
  "/packages",
  "/featured-work",
  "/media",
  "/website",
  "/documents",
  "/payments",
  "/galleries",
  "/events",
  "/clients",
  "/issues",
  "/import",
  "/notifications",
];

/**
 * Whether `href` is the current page. A link with a query string (such as
 * the Schedule view of Bookings) is only active when the current search
 * string is supplied and matches; by pathname alone it never highlights,
 * so the plain Bookings link stays the single active item.
 */
export function isActivePath(pathname: string, href: string, search?: string): boolean {
  if (href === "/more") return MORE_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const q = href.indexOf("?");
  if (q >= 0) {
    if (search === undefined) return false;
    const path = href.slice(0, q);
    const want = href.slice(q + 1);
    return pathname === path && search.replace(/^\?/, "") === want;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
