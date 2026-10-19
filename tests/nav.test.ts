import { describe, expect, it } from "vitest";
import { BOTTOM_ITEMS, bottomGridClass, groupNavItems, isActivePath, MORE_ITEMS, MORE_ROUTES, NAV_GROUP_LABEL, NAV_GROUP_ORDER, navItemsFor, SIDEBAR_ITEMS } from "@/components/nav";

describe("navItemsFor", () => {
  it("keeps the owner's nav as it was (no collaborator shortcuts)", () => {
    expect(navItemsFor(SIDEBAR_ITEMS, false)).toEqual(SIDEBAR_ITEMS);
    expect(navItemsFor(BOTTOM_ITEMS, false).map((i) => i.href)).toEqual(["/dashboard", "/watcher", "/leads", "/bookings", "/more"]);
  });

  it("fits every viewer's bottom nav on one row", () => {
    for (const collaboratorOnly of [false, true]) {
      const n = navItemsFor(BOTTOM_ITEMS, collaboratorOnly).length;
      expect(bottomGridClass(n)).toBe(`grid-cols-${n}`);
    }
    expect(bottomGridClass(9)).toBe("grid-flow-col auto-cols-fr");
  });

  it("drops owner-only items for a collaborator and never exposes Orders or pricing", () => {
    const sidebar = navItemsFor(SIDEBAR_ITEMS, true);
    expect(sidebar.every((i) => !i.ownerOnly)).toBe(true);
    expect(sidebar.some((i) => i.href === "/orders")).toBe(false);
    expect(sidebar.some((i) => i.href === "/pricing")).toBe(false);
    expect(sidebar.some((i) => i.href === "/payments")).toBe(false);
    // The collaborator still has their coverage board and settings.
    expect(sidebar.map((i) => i.href)).toEqual(["/coverage", "/settings"]);
    expect(navItemsFor(MORE_ITEMS, true).map((i) => i.href)).toEqual(["/coverage", "/settings"]);
  });

  it("keeps the collaborator bottom nav non-empty (coverage + more)", () => {
    const bottom = navItemsFor(BOTTOM_ITEMS, true);
    expect(bottom.map((i) => i.href)).toEqual(["/coverage", "/more"]);
  });
});

describe("sidebar groups", () => {
  it("orders the workday groups and labels every one", () => {
    expect(NAV_GROUP_ORDER).toEqual(["overview", "sales", "production", "tournament", "finance", "website", "settings"]);
    for (const g of NAV_GROUP_ORDER) expect(NAV_GROUP_LABEL[g]).toBeTruthy();
    const groups = groupNavItems(navItemsFor(SIDEBAR_ITEMS, false));
    expect(groups.map((g) => g.group)).toEqual(NAV_GROUP_ORDER);
    const hrefs = Object.fromEntries(groups.map((g) => [g.group, g.items.map((i) => i.href)]));
    expect(hrefs.overview).toEqual(["/studio"]);
    expect(hrefs.sales).toEqual(["/leads", "/inquiries", "/people", "/clubs", "/pricing"]);
    expect(hrefs.production).toEqual(["/bookings", "/production", "/bookings?filter=confirmed"]);
    expect(hrefs.tournament).toEqual(["/dashboard", "/watcher", "/events", "/clients", "/coverage", "/issues"]);
    expect(hrefs.finance).toEqual(["/documents", "/orders", "/payments", "/galleries"]);
    expect(hrefs.website).toEqual(["/media", "/packages", "/website/testimonials", "/website/faqs", "/featured-work"]);
    expect(hrefs.settings).toEqual(["/settings", "/notifications", "/history"]);
  });

  it("marks pricing and every money surface owner-only", () => {
    for (const href of ["/pricing", "/payments", "/orders", "/documents", "/media"]) {
      expect(SIDEBAR_ITEMS.find((i) => i.href === href)?.ownerOnly, href).toBe(true);
    }
    expect(SIDEBAR_ITEMS.find((i) => i.href === "/pricing")?.label).toBe("Quotes & pricing");
    expect(SIDEBAR_ITEMS.find((i) => i.href === "/clients")?.label).toBe("Athletes");
    expect(SIDEBAR_ITEMS.find((i) => i.href === "/people")?.label).toBe("Clients");
  });

  it("puts items without a group under settings and drops empty groups", () => {
    const groups = groupNavItems([{ href: "/x", label: "X", icon: SIDEBAR_ITEMS[0].icon }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe("settings");
  });

  it("offers every sidebar route (except the bottom-bar ones) from More on the phone", () => {
    const bottom = new Set(navItemsFor(BOTTOM_ITEMS, false).map((i) => i.href));
    const more = new Set(MORE_ITEMS.map((i) => i.href));
    for (const item of SIDEBAR_ITEMS) {
      if (bottom.has(item.href)) continue;
      expect(more.has(item.href), item.href).toBe(true);
    }
    const anyBottom = new Set(BOTTOM_ITEMS.map((i) => i.href));
    for (const item of MORE_ITEMS) {
      const path = item.href.split("?")[0];
      if (anyBottom.has(path)) continue; // coverage sits in the collaborator's bottom bar; Schedule is a Bookings view
      expect(MORE_ROUTES.some((p) => path === p || path.startsWith(`${p}/`)), item.href).toBe(true);
    }
  });
});

describe("isActivePath", () => {
  it("matches the exact path and its sub-paths", () => {
    expect(isActivePath("/events", "/events")).toBe(true);
    expect(isActivePath("/events/123", "/events")).toBe(true);
    expect(isActivePath("/eventsomething", "/events")).toBe(false);
  });

  it("groups owner sub-pages under More", () => {
    for (const p of ["/more", "/studio", "/studio/metrics", "/history", "/settings", "/orders", "/orders/abc", "/people", "/documents/x", "/payments", "/production", "/website/faqs", "/media"]) {
      expect(isActivePath(p, "/more"), p).toBe(true);
    }
    for (const p of ["/coverage", "/leads", "/bookings", "/bookings/abc", "/dashboard", "/watcher"]) {
      expect(isActivePath(p, "/more"), p).toBe(false);
    }
  });

  it("highlights a query-string link only when the search matches, so Bookings and Schedule never both light up", () => {
    expect(isActivePath("/bookings", "/bookings?filter=confirmed")).toBe(false);
    expect(isActivePath("/bookings", "/bookings?filter=confirmed", "")).toBe(false);
    expect(isActivePath("/bookings", "/bookings?filter=confirmed", "filter=confirmed")).toBe(true);
    expect(isActivePath("/bookings", "/bookings?filter=confirmed", "?filter=confirmed")).toBe(true);
    expect(isActivePath("/bookings/abc", "/bookings?filter=confirmed", "filter=confirmed")).toBe(false);
    expect(isActivePath("/bookings", "/bookings", "filter=confirmed")).toBe(true);
  });
});
