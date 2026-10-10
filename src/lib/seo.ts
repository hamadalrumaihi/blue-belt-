import type { Metadata, MetadataRoute } from "next";
import { PUBLIC_BOOKING_TYPES } from "@/lib/bookings/public-form";
import { publicPrice } from "@/lib/services/pricing";
import { businessIdentity, type BusinessIdentity } from "@/lib/studio/business";
import type { PhotoServiceRow, PhotoStudioRow } from "@/lib/supabase/database.types";

/**
 * Search metadata for the public website. Pure: takes the site base URL and
 * studio rows as arguments and never touches the request or the database,
 * so the root layout, every public page, sitemap.ts, robots.ts and the tests
 * all build from the same definitions.
 */
export const SITE_NAME = "Blue Belt Media";
export const DEFAULT_TITLE = "Blue Belt Media: BJJ and martial arts photography and video in Qatar";
export const DEFAULT_DESCRIPTION =
  "Tournament, training and athlete photography and video for jiu-jitsu and martial arts in Doha, Qatar. Book online. Photos delivered in a private gallery.";

/** Pages that search engines should index. Keep in step with the public routes. */
export const SITEMAP_PATHS = ["/", "/services", "/book", "/contact", "/privacy", "/terms"] as const;

/** Private, transactional or thin routes: never crawled. */
export const ROBOTS_DISALLOW = [
  "/studio",
  "/dashboard",
  "/events",
  "/clients",
  "/watcher",
  "/bookings",
  "/people",
  "/clubs",
  "/documents",
  "/galleries",
  "/payments",
  "/orders",
  "/notifications",
  "/settings",
  "/pricing",
  "/packages",
  "/featured-work",
  "/client",
  "/sign",
  "/pay",
  "/api",
] as const;

/** Site-wide defaults (metadataBase, title template, Open Graph, Twitter, robots). */
export function siteMetadata(base: string): Metadata {
  const origin = base.replace(/\/$/, "");
  return {
    metadataBase: new URL(origin),
    title: { default: DEFAULT_TITLE, template: `%s · ${SITE_NAME}` },
    description: DEFAULT_DESCRIPTION,
    applicationName: SITE_NAME,
    alternates: { canonical: "/" },
    openGraph: {
      siteName: SITE_NAME,
      type: "website",
      locale: "en_QA",
      url: "/",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      images: [SOCIAL_IMAGE],
    },
    twitter: { card: "summary_large_image", title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, images: [SOCIAL_IMAGE.url] },
    robots: { index: true, follow: true },
  };
}

/**
 * The social card is the file-based route src/app/opengraph-image.tsx. A
 * page that sets its own openGraph block replaces the inherited one and
 * would lose the image, so every page lists it explicitly.
 */
export const SOCIAL_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: SITE_NAME };

export type PageMeta = { title: string; description: string; path: string; index?: boolean };

/**
 * One public page's metadata: a unique title (templated with the site name),
 * description, canonical URL and matching Open Graph tags. `index: false`
 * keeps thin pages out of search results while still letting links be followed.
 */
export function pageMetadata({ title, description, path, index = true }: PageMeta): Metadata {
  const fullTitle = path === "/" ? title : `${title} · ${SITE_NAME}`;
  return {
    title: path === "/" ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { title: fullTitle, description, url: path, type: "website", siteName: SITE_NAME, locale: "en_QA", images: [SOCIAL_IMAGE] },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [SOCIAL_IMAGE.url] },
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}

export function buildSitemap(base: string): MetadataRoute.Sitemap {
  const origin = base.replace(/\/$/, "");
  const now = new Date();
  return SITEMAP_PATHS.map((path) => ({
    url: path === "/" ? `${origin}/` : `${origin}${path}`,
    lastModified: now,
    changeFrequency: path === "/" || path === "/services" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/services" || path === "/book" ? 0.8 : 0.4,
  }));
}

export function buildRobots(base: string): MetadataRoute.Robots {
  const origin = base.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}

type JsonLdService = {
  "@type": "Service";
  "@id": string;
  name: string;
  description: string;
  serviceType: string;
  provider: { "@id": string };
  areaServed: Array<{ "@type": "City" | "Country"; name: string }>;
  offers?: { "@type": "Offer"; priceCurrency: "QAR"; price: number; availability: string };
};

export type HomeJsonLd = {
  "@context": "https://schema.org";
  /** The business first, then one Service per booking type. */
  "@graph": Array<Record<string, unknown>>;
};

const AREA_SERVED = [
  { "@type": "City" as const, name: "Doha" },
  { "@type": "Country" as const, name: "Qatar" },
];

/**
 * Structured data for the home page: the studio as a ProfessionalService and
 * one Service per booking type. Prices appear only when a public service of
 * that type carries a real price; quoted work has no offer at all.
 */
export function buildHomeJsonLd({ base, studio, services, identity = businessIdentity() }: { base: string; studio: PhotoStudioRow | null; services: readonly PhotoServiceRow[]; identity?: BusinessIdentity }): HomeJsonLd {
  const origin = base.replace(/\/$/, "");
  const businessId = `${origin}/#business`;
  const name = studio?.business_name?.trim() || SITE_NAME;
  const city = studio?.city?.trim() || identity.location;
  const sameAs: string[] = [];
  const ig = studio?.instagram?.replace(/^@/, "").trim();
  if (ig) sameAs.push(`https://instagram.com/${ig}`);

  const business: Record<string, unknown> = {
    "@type": ["ProfessionalService", "LocalBusiness"],
    "@id": businessId,
    name,
    legalName: identity.legalName,
    identifier: { "@type": "PropertyValue", propertyID: "Commercial Registration (Qatar)", value: identity.crNumber },
    url: `${origin}/`,
    description: studio?.about?.trim() || DEFAULT_DESCRIPTION,
    image: `${origin}/brand/logo.png`,
    areaServed: AREA_SERVED,
    address: { "@type": "PostalAddress", addressLocality: city, addressCountry: "QA" },
    priceRange: "QAR",
  };
  business.email = studio?.email?.trim() || identity.email;
  if (sameAs.length) business.sameAs = sameAs;

  const serviceEntries: JsonLdService[] = PUBLIC_BOOKING_TYPES.map((t) => {
    const prices = services.filter((s) => s.booking_type === t.value).map((s) => publicPrice(s).amount).filter((a): a is number => a !== null);
    const entry: JsonLdService = {
      "@type": "Service",
      "@id": `${origin}/services#${t.value}`,
      name: t.title,
      description: t.body,
      serviceType: "Photography and video",
      provider: { "@id": businessId },
      areaServed: AREA_SERVED,
    };
    if (prices.length) entry.offers = { "@type": "Offer", priceCurrency: "QAR", price: Math.min(...prices), availability: "https://schema.org/InStock" };
    return entry;
  });

  return { "@context": "https://schema.org", "@graph": [business, ...serviceEntries] };
}

export type FaqItem = { question: string; answer: string };

/**
 * The questions people ask before booking, answered without promises the
 * studio cannot keep (no turnaround times, no guaranteed match counts).
 * Rendered on the home page and exposed as FAQPage structured data.
 */
export const FAQ_ITEMS: readonly FaqItem[] = [
  { question: "When should I book tournament coverage?", answer: "Before the brackets are published, so we have your athlete's name, academy and division in advance and can be at the right mat when the first match is called." },
  { question: "How do you know which matches are mine?", answer: "We match the athlete on the day from the organiser's bracket and follow it live. A link to the athlete's profile or bracket helps; the booking form has a field for it." },
  { question: "How does payment work?", answer: "For commissioned coverage you pay a 50% deposit online once we have confirmed the date and price. That secures the booking. The remaining 50% is due after your gallery is delivered. Buying photos from a public event gallery is separate and paid in the gallery." },
  { question: "How are the photos delivered?", answer: "In a private online gallery sent to the e-mail you booked with. You can view, download and share from there, and order prints if you want them." },
  { question: "Can I buy photos if I did not book?", answer: "Yes. Public event galleries are published in the same gallery, where anyone can view and buy their photos." },
  { question: "Can I use the photos for my academy or a sponsor?", answer: "Personal use is included. Club, team, brand or commercial use needs a licence, which we include in the quote when you tell us on the booking form." },
];

export function buildFaqJsonLd(items: readonly FaqItem[] = FAQ_ITEMS): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.question, acceptedAnswer: { "@type": "Answer", text: i.answer } })),
  };
}

/** JSON for a `<script type="application/ld+json">`: our own data, with `<` escaped so it can never close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
