import { describe, expect, it } from "vitest";
import { galleryEventKindOf, matchGalleryByName, normalizeGalleryName, parseGalleryEvent } from "@/lib/galleries/intake-contract";

describe("parseGalleryEvent", () => {
  it("parses the nested shape", () => {
    const res = parseGalleryEvent({
      event: "gallery_invite_sent",
      gallery: { name: " Doha Open 2026 ", id: "P-77", url: "https://bb.pic-time.com/doha" },
      client: { email: "Fatima@Example.com", name: "Fatima" },
      occurredAt: "2026-10-01T10:00:00Z",
    });
    expect(res).toEqual({
      ok: true,
      event: {
        event: "gallery_invite_sent",
        gallery: { name: "Doha Open 2026", id: "P-77", url: "https://bb.pic-time.com/doha" },
        client: { email: "fatima@example.com", name: "Fatima" },
        visitor: null,
        occurredAt: "2026-10-01T10:00:00.000Z",
      },
    });
  });

  it("accepts the flat Zapier aliases and maps trigger wording to kinds", () => {
    const visitor = parseGalleryEvent({ type: "New Gallery Visitor", projectName: "Doha Open", link: "https://bb.pic-time.com/doha", visitorEmail: "v@example.com", visitorName: "Visitor", visitedAt: "2026-10-02T08:00:00Z" });
    expect(visitor.ok && visitor.event.event).toBe("gallery_visitor");
    expect(visitor.ok && visitor.event.visitor).toEqual({ email: "v@example.com", name: "Visitor", at: "2026-10-02T08:00:00.000Z" });
    expect(visitor.ok && visitor.event.occurredAt).toBe("2026-10-02T08:00:00.000Z");
    const invite = parseGalleryEvent({ eventType: "Main Client Gallery Invite Sent", galleryName: "Doha Open", clientEmail: "c@example.com" });
    expect(invite.ok && invite.event.event).toBe("gallery_invite_sent");
    expect(invite.ok && invite.event.client).toEqual({ email: "c@example.com", name: null });
    const created = parseGalleryEvent({ event: "New Gallery", galleryName: "Doha Open", galleryUrl: "https://bb.pic-time.com/doha", galleryId: "P-1" });
    expect(created.ok && created.event.event).toBe("gallery_created");
    expect(created.ok && created.event.gallery).toEqual({ name: "Doha Open", id: "P-1", url: "https://bb.pic-time.com/doha" });
  });

  it("drops non-https links, bad e-mails and unparseable dates instead of failing", () => {
    const res = parseGalleryEvent({ event: "gallery_created", galleryName: "G", link: "http://bb.pic-time.com/x", clientEmail: "nope", occurredAt: "yesterday" });
    expect(res.ok && res.event.gallery.url).toBeNull();
    expect(res.ok && res.event.client).toBeNull();
    expect(res.ok && res.event.occurredAt).toBeNull();
  });

  it("refuses non-objects, unknown events and a missing gallery name", () => {
    expect(parseGalleryEvent(null)).toMatchObject({ ok: false, code: "INVALID_EVENT" });
    expect(parseGalleryEvent([])).toMatchObject({ ok: false });
    expect(parseGalleryEvent({ event: "order_placed", galleryName: "G" })).toMatchObject({ ok: false, error: expect.stringMatching(/event/) });
    expect(parseGalleryEvent({ event: "gallery_visitor" })).toMatchObject({ ok: false, error: expect.stringMatching(/name/) });
  });

  it("kind mapping is tolerant of case and separators", () => {
    expect(galleryEventKindOf("Gallery-Invite-Sent")).toBe("gallery_invite_sent");
    expect(galleryEventKindOf("VISITOR")).toBe("gallery_visitor");
    expect(galleryEventKindOf("project published")).toBe("gallery_created");
    expect(galleryEventKindOf("")).toBeNull();
    expect(galleryEventKindOf(7)).toBeNull();
  });
});

describe("matchGalleryByName", () => {
  const rows = [{ id: 1, name: "Doha Open 2026" }, { id: 2, name: "Doha Open 2026 — Finals" }, { id: 3, name: "Club Shoot" }];

  it("normalises case and whitespace", () => {
    expect(normalizeGalleryName("  DOHA   Open\t2026 ")).toBe("doha open 2026");
    expect(matchGalleryByName(rows, "doha  open 2026")?.id).toBe(1);
    expect(matchGalleryByName(rows, "CLUB SHOOT")?.id).toBe(3);
  });

  it("falls back to a single prefix match in either direction, never an ambiguous one", () => {
    expect(matchGalleryByName(rows, "Club Shoot — Day 2")?.id).toBe(3);
    expect(matchGalleryByName(rows, "Club")?.id).toBe(3);
    // "Doha Open" prefixes two rows → ambiguous.
    expect(matchGalleryByName(rows, "Doha Open")).toBeNull();
    expect(matchGalleryByName(rows, "Doha Open 2026 — Finals (extra)")?.id).toBe(2);
    expect(matchGalleryByName(rows, "")).toBeNull();
    expect(matchGalleryByName(rows, "Nothing like it")).toBeNull();
  });
});
