import { describe, expect, it } from "vitest";
import { BOTTOM_ITEMS, bottomGridClass, isActivePath, navItemsFor, SIDEBAR_ITEMS } from "@/components/nav";

describe("navItemsFor", () => {
  it("keeps the owner's nav as it was (no collaborator shortcuts)", () => {
    expect(navItemsFor(SIDEBAR_ITEMS, false)).toEqual(SIDEBAR_ITEMS);
    expect(navItemsFor(BOTTOM_ITEMS, false).map((i) => i.href)).toEqual(["/dashboard", "/events", "/clients", "/watcher", "/more"]);
  });

  it("fits every viewer's bottom nav on one row", () => {
    for (const collaboratorOnly of [false, true]) {
      const n = navItemsFor(BOTTOM_ITEMS, collaboratorOnly).length;
      expect(bottomGridClass(n)).toBe(`grid-cols-${n}`);
    }
    expect(bottomGridClass(9)).toBe("grid-flow-col auto-cols-fr");
  });

  it("drops owner-only items for a collaborator and never exposes Orders", () => {
    const sidebar = navItemsFor(SIDEBAR_ITEMS, true);
    expect(sidebar.every((i) => !i.ownerOnly)).toBe(true);
    expect(sidebar.some((i) => i.href === "/orders")).toBe(false);
    // The collaborator still has their coverage board.
    expect(sidebar.some((i) => i.href === "/coverage")).toBe(true);
  });

  it("keeps the collaborator bottom nav non-empty (coverage + more)", () => {
    const bottom = navItemsFor(BOTTOM_ITEMS, true);
    expect(bottom.map((i) => i.href)).toEqual(["/coverage", "/more"]);
  });
});

describe("isActivePath", () => {
  it("matches the exact path and its sub-paths", () => {
    expect(isActivePath("/events", "/events")).toBe(true);
    expect(isActivePath("/events/123", "/events")).toBe(true);
    expect(isActivePath("/eventsomething", "/events")).toBe(false);
  });

  it("groups owner sub-pages under More", () => {
    for (const p of ["/more", "/history", "/settings", "/orders", "/orders/abc"]) {
      expect(isActivePath(p, "/more")).toBe(true);
    }
    expect(isActivePath("/coverage", "/more")).toBe(false);
  });
});
