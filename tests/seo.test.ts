import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => false }));

import { buildHomeJsonLd, buildRobots, buildServiceJsonLd, buildSitemap, DEFAULT_DESCRIPTION, DEFAULT_TITLE, pageMetadata, ROBOTS_DISALLOW, serializeJsonLd, SERVICE_PATHS, siteMetadata, SITEMAP_PATHS } from "@/lib/seo";
import { SERVICE_DEFINITIONS } from "@/lib/catalog/index";
import { DEFAULT_PICTIME_GALLERY_URL, pictimeGalleryUrl } from "@/lib/studio/queries";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import type { PhotoServiceRow, PhotoStudioRow } from "@/lib/supabase/database.types";

const BASE = "https://www.bluebelt.media";

function studio(over: Partial<PhotoStudioRow> = {}): PhotoStudioRow {
  return {
    owner_id: "11111111-1111-4111-8111-111111111111",
    business_name: "Blue Belt Media",
    tagline: "Combat sports photography",
    about: null,
    city: "Doha, Qatar",
    email: null,
    phone: null,
    whatsapp: null,
    instagram: null,
    public_booking: true,
    settings: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function service(over: Partial<PhotoServiceRow> = {}): PhotoServiceRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    owner_id: "11111111-1111-4111-8111-111111111111",
    code: "TA1",
    name: "Single athlete, one day",
    booking_type: "tournament_athlete",
    description: null,
    price_qr: null,
    price_mode: "quote",
    deposit_qr: null,
    currency: "QAR",
    duration_minutes: null,
    includes_photo: true,
    includes_video: false,
    active: true,
    public: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("siteMetadata", () => {
  it("sets the base URL, title template, description, Open Graph, Twitter and robots defaults", () => {
    const m = siteMetadata(`${BASE}/`);
    expect(m.metadataBase).toBeInstanceOf(URL);
    expect((m.metadataBase as URL).origin).toBe(BASE);
    expect(m.title).toEqual({ default: DEFAULT_TITLE, template: "%s · Blue Belt Media" });
    expect(DEFAULT_TITLE).toBe("Blue Belt Media: combat sports photography, video and creative production in Qatar");
    expect(typeof m.description).toBe("string");
    expect((m.description as string).length).toBeLessThanOrEqual(160);
    expect(m.description).toBe(DEFAULT_DESCRIPTION);
    expect(m.alternates).toEqual({ canonical: "/" });
    expect(m.openGraph).toMatchObject({ siteName: "Blue Belt Media", type: "website", locale: "en_QA", url: "/" });
    expect(m.openGraph?.images).toEqual([{ url: "/opengraph-image", width: 1200, height: 630, alt: "Blue Belt Media" }]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  it("never contains an em dash", () => {
    expect(JSON.stringify(siteMetadata(BASE))).not.toContain("\u2014");
    expect(JSON.stringify(siteMetadata(BASE))).not.toMatch(/pic-?time|fatoorah|docusign/i);
  });
});

describe("pageMetadata", () => {
  it("gives each page its own title, description, canonical and Open Graph tags", () => {
    const m = pageMetadata({ title: "BJJ photography and video services in Qatar", description: "Prices in QAR.", path: "/services" });
    expect(m.title).toBe("BJJ photography and video services in Qatar");
    expect(m.alternates).toEqual({ canonical: "/services" });
    expect(m.openGraph).toMatchObject({ title: "BJJ photography and video services in Qatar · Blue Belt Media", description: "Prices in QAR.", url: "/services" });
    expect(m.robots).toBeUndefined();
  });

  it("uses an absolute title on the home page and noindex for thin pages", () => {
    const home = pageMetadata({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, path: "/" });
    expect(home.title).toEqual({ absolute: DEFAULT_TITLE });
    const thin = pageMetadata({ title: "Client sign-in", description: "x", path: "/client/login", index: false });
    expect(thin.robots).toEqual({ index: false, follow: true });
  });

  it("keeps one canonical per path in both languages and only changes the Open Graph locale", () => {
    const en = pageMetadata({ title: "Work", description: "x", path: "/work" });
    const ar = pageMetadata({ title: "أعمالنا", description: "x", path: "/work", locale: "ar" });
    expect(en.alternates).toEqual({ canonical: "/work" });
    expect(ar.alternates).toEqual({ canonical: "/work" });
    expect(en.openGraph).toMatchObject({ locale: "en_QA" });
    expect(ar.openGraph).toMatchObject({ locale: "ar_QA" });
    // The same URL serves both languages, so no hreflang alternates are declared.
    expect(ar.alternates).not.toHaveProperty("languages");
  });
});

describe("sitemap", () => {
  it("lists the home, services, every service page, how it works, work, contact and the legal pages, with absolute URLs", () => {
    const urls = buildSitemap(`${BASE}/`).map((e) => e.url);
    expect(urls).toEqual([`${BASE}/`, `${BASE}/services`, ...SERVICE_PATHS.map((p) => `${BASE}${p}`), `${BASE}/how-it-works`, `${BASE}/work`, `${BASE}/contact`, `${BASE}/privacy`, `${BASE}/terms`]);
    expect(SERVICE_PATHS).toEqual(Object.values(SERVICE_DEFINITIONS).map((d) => `/services/${d.slug}`));
    expect(SERVICE_PATHS).toHaveLength(5);
    for (const excluded of ["/portfolio", "/faq", "/client", "/sign", "/pay", "/studio", "/api", "/book"]) {
      expect(urls.some((u) => u.endsWith(excluded) || u.includes(`${excluded}/`))).toBe(false);
    }
    expect(SITEMAP_PATHS).not.toContain("/portfolio");
    const work = buildSitemap(BASE).find((e) => e.url.endsWith("/work"));
    expect(work?.changeFrequency).toBe("weekly");
  });

  it("the app route uses the configured site URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test/";
    const entries = sitemap();
    expect(entries[0].url).toBe("https://example.test/");
    expect(entries.map((e) => e.url)).toContain("https://example.test/services");
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
});

describe("robots", () => {
  it("allows the public site and blocks every private, transactional and API route", () => {
    const r = buildRobots(BASE);
    expect(r.sitemap).toBe(`${BASE}/sitemap.xml`);
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.userAgent).toBe("*");
    expect(rules.allow).toBe("/");
    const disallow = rules.disallow as string[];
    for (const p of ["/studio", "/dashboard", "/events", "/clients", "/watcher", "/bookings", "/people", "/clubs", "/documents", "/galleries", "/payments", "/orders", "/notifications", "/settings", "/pricing", "/packages", "/featured-work", "/media", "/website", "/production", "/login", "/auth", "/client", "/sign", "/pay", "/api"]) {
      expect(disallow).toContain(p);
    }
    expect(disallow).toEqual([...ROBOTS_DISALLOW]);
    for (const pub of ["/services", "/work", "/how-it-works", "/book", "/contact", "/privacy", "/terms"]) expect(disallow).not.toContain(pub);
  });

  it("the app route uses the configured site URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
    expect(robots().sitemap).toBe("https://example.test/sitemap.xml");
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
});

describe("buildHomeJsonLd", () => {
  it("describes the studio and the five catalog services, with no prices when everything is quoted", () => {
    const ld = buildHomeJsonLd({ base: BASE, studio: studio(), services: [service(), service({ id: "x", booking_type: "club", price_qr: null })] });
    expect(ld["@context"]).toBe("https://schema.org");
    const [business, ...services] = ld["@graph"];
    expect(business).toMatchObject({ "@type": ["ProfessionalService", "LocalBusiness"], name: "Blue Belt Media", url: `${BASE}/` });
    expect(business.areaServed).toEqual([{ "@type": "City", name: "Doha" }, { "@type": "Country", name: "Qatar" }]);
    expect(business.address).toEqual({ "@type": "PostalAddress", addressLocality: "Doha, Qatar", addressCountry: "QA" });
    // The registered identity fills in when the studio row has no contact details; never a street address.
    expect(business).toMatchObject({ legalName: "Blue belt media photography", identifier: { "@type": "PropertyValue", value: "235175" }, email: "bluebeltmediaqatar@gmail.com" });
    expect(business).not.toHaveProperty("telephone");
    expect(business.address).not.toHaveProperty("streetAddress");
    expect(business).not.toHaveProperty("sameAs");
    expect(services).toHaveLength(5);
    expect(services.map((s) => s["@type"])).toEqual(["Service", "Service", "Service", "Service", "Service"]);
    expect(services.map((s) => s.name)).toEqual(["Tournament athlete coverage", "Team tournament coverage", "Training and gym content", "Athlete portraits and private sessions", "Event and organizer coverage"]);
    expect(services.map((s) => s.url)).toEqual(SERVICE_PATHS.map((p) => `${BASE}${p}`));
    const json = serializeJsonLd(ld);
    expect(json).not.toContain("offers");
    expect(json).not.toContain("price\"");
    expect(json).not.toContain("telephone");
    expect(json).not.toContain("aggregateRating");
    expect(json).not.toContain("review");
    expect(json).not.toContain("\u2014");
    expect(json).not.toMatch(/pic-?time|fatoorah|docusign/i);
  });

  it("names the services in Arabic when asked, without changing their ids", () => {
    const ld = buildHomeJsonLd({ base: BASE, studio: studio(), services: [], locale: "ar" });
    const [, first] = ld["@graph"];
    expect(first.name).toBe("تغطية رياضي في بطولة");
    expect(first["@id"]).toBe(`${BASE}/services/tournament-athlete-coverage#service`);
  });

  it("adds a QAR offer only for a type with a real price, and contact details only when present", () => {
    const rows = [service({ price_qr: 450, price_mode: "from" }), service({ id: "b", price_qr: 350, price_mode: "fixed" }), service({ id: "c", booking_type: "private_session", price_qr: 0, price_mode: "fixed" })];
    const ld = buildHomeJsonLd({ base: BASE, studio: studio({ phone: "+974 5555 5555", email: "hello@bluebelt.media", instagram: "@bluebeltmedia", city: "Doha" }), services: rows });
    const [business, tournament, club, training, priv] = ld["@graph"];
    expect(business).toMatchObject({ email: "hello@bluebelt.media", sameAs: ["https://instagram.com/bluebeltmedia"] });
    expect(business).not.toHaveProperty("telephone");
    expect(tournament.offers).toEqual({ "@type": "Offer", priceCurrency: "QAR", price: 350, availability: "https://schema.org/InStock" });
    expect(club).not.toHaveProperty("offers");
    expect(training).not.toHaveProperty("offers");
    expect(priv).not.toHaveProperty("offers");
  });

  it("never attaches an offer to a quote-first service, even when a package row carries a number", () => {
    const rows = [service({ id: "club", booking_type: "club", price_qr: 2500, price_mode: "fixed" }), service({ id: "custom", booking_type: "custom", price_qr: 900, price_mode: "from" })];
    const ld = buildHomeJsonLd({ base: BASE, studio: studio(), services: rows });
    const [, , club, , , custom] = ld["@graph"];
    expect(club).not.toHaveProperty("offers");
    expect(custom).not.toHaveProperty("offers");
  });

  it("escapes < so the JSON can never close the script tag", () => {
    const ld = buildHomeJsonLd({ base: BASE, studio: studio({ about: "</script><script>alert(1)</script>" }), services: [] });
    const json = serializeJsonLd(ld);
    expect(json).not.toContain("</script");
    expect(json).toContain("\\u003c/script");
    expect(JSON.parse(json)["@graph"][0].description).toBe("</script><script>alert(1)</script>");
  });
});

describe("buildServiceJsonLd", () => {
  it("describes one service with its provider and a breadcrumb trail, in the requested language", () => {
    const def = SERVICE_DEFINITIONS.tournament_athlete;
    const ld = buildServiceJsonLd({ base: BASE, def, studio: studio(), services: [service({ price_qr: 400, price_mode: "from" })], locale: "en" });
    const [business, svc, crumbs] = ld["@graph"];
    expect(business).toMatchObject({ "@id": `${BASE}/#business` });
    expect(svc).toMatchObject({ "@type": "Service", url: `${BASE}/services/tournament-athlete-coverage`, offers: { price: 400, priceCurrency: "QAR" } });
    expect(crumbs).toMatchObject({ "@type": "BreadcrumbList" });
    expect((crumbs.itemListElement as Array<{ item: string }>).map((c) => c.item)).toEqual([`${BASE}/`, `${BASE}/services`, `${BASE}/services/tournament-athlete-coverage`]);
    const ar = buildServiceJsonLd({ base: BASE, def, studio: studio(), services: [], locale: "ar" });
    expect((ar["@graph"][2].itemListElement as Array<{ name: string }>)[1].name).toBe("الخدمات");
    expect(serializeJsonLd(ld)).not.toContain("telephone");
  });
});

describe("pictimeGalleryUrl", () => {
  it("defaults to the verified Pic-Time client gallery", () => {
    expect(DEFAULT_PICTIME_GALLERY_URL).toBe("https://galleries.bluebelt.media/client");
    expect(pictimeGalleryUrl(null)).toBe(DEFAULT_PICTIME_GALLERY_URL);
    expect(pictimeGalleryUrl(studio({ settings: {} }))).toBe(DEFAULT_PICTIME_GALLERY_URL);
    expect(pictimeGalleryUrl(studio({ settings: [] }))).toBe(DEFAULT_PICTIME_GALLERY_URL);
  });

  it("uses a valid custom link on pic-time.com or galleries.bluebelt.media", () => {
    expect(pictimeGalleryUrl(studio({ settings: { pictimeGalleryUrl: "https://bluebeltmedia.pic-time.com/client" } }))).toBe("https://bluebeltmedia.pic-time.com/client");
    expect(pictimeGalleryUrl(studio({ settings: { pictimeGalleryUrl: " https://galleries.bluebelt.media/portfolio " } }))).toBe("https://galleries.bluebelt.media/portfolio");
  });

  it("strips the headless embed parameter but keeps other query parameters", () => {
    expect(pictimeGalleryUrl(studio({ settings: { pictimeGalleryUrl: "https://galleries.bluebelt.media/client?headless=true" } }))).toBe("https://galleries.bluebelt.media/client");
    expect(pictimeGalleryUrl(studio({ settings: { pictimeGalleryUrl: "https://galleries.bluebelt.media/client?a=1&headless=true&b=2" } }))).toBe("https://galleries.bluebelt.media/client?a=1&b=2");
  });

  it("falls back to the default for anything else", () => {
    for (const bad of ["http://galleries.bluebelt.media/client", "https://evil.example/client", "https://galleries.bluebelt.media.evil.example/x", "not a url", "", 42, null, { url: "x" }]) {
      expect(pictimeGalleryUrl(studio({ settings: { pictimeGalleryUrl: bad as never } }))).toBe(DEFAULT_PICTIME_GALLERY_URL);
    }
  });
});
