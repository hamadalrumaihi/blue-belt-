import type { Metadata, MetadataRoute } from "next";
import { SERVICE_COPY } from "@/lib/catalog/copy";
import { SERVICE_DEFINITIONS, SERVICES, type ServiceDefinition } from "@/lib/catalog/index";
import { localized, OG_LOCALE, type Locale } from "@/lib/i18n/locale";
import { publicPrice } from "@/lib/services/pricing";
import { businessIdentity, type BusinessIdentity } from "@/lib/studio/business";
import type { PhotoServiceRow, PhotoStudioRow } from "@/lib/supabase/database.types";

/**
 * Search metadata for the public website. Pure: takes the site base URL and
 * studio rows as arguments and never touches the request or the database,
 * so the root layout, every public page, sitemap.ts, robots.ts and the tests
 * all build from the same definitions.
 *
 * Both languages share one URL (the language is a cookie, never a path), so
 * no hreflang alternates are declared: declaring two languages for one URL
 * would be wrong. Canonicals are always the English path.
 */
export const SITE_NAME = "Blue Belt Media";
export const DEFAULT_TITLE = "Blue Belt Media: BJJ and martial arts photography and video in Qatar";
export const DEFAULT_DESCRIPTION =
  "Tournament, training and athlete photography and video for jiu-jitsu and martial arts in Doha, Qatar. Request coverage online. Photos delivered in a private gallery.";

export const DEFAULT_TITLE_AR = "بلو بلت ميديا: تصوير فوتوغرافي وفيديو للجوجيتسو والفنون القتالية في قطر";
export const DEFAULT_DESCRIPTION_AR = "تصوير فوتوغرافي وفيديو للبطولات والتدريب والرياضيين في الجوجيتسو والفنون القتالية في الدوحة، قطر. اطلب التغطية إلكترونيًا. تُسلَّم الصور في معرض خاص.";

/** Public service detail paths, one per catalog service. */
export const SERVICE_PATHS: readonly string[] = SERVICES.map((k) => `/services/${SERVICE_DEFINITIONS[k].slug}`);

/** Pages that search engines should index. Keep in step with the public routes. */
export const SITEMAP_PATHS: readonly string[] = ["/", "/services", ...SERVICE_PATHS, "/how-it-works", "/work", "/contact", "/privacy", "/terms"];

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
  "/media",
  "/website",
  "/production",
  "/leads",
  "/issues",
  "/history",
  "/import",
  "/coverage",
  "/more",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/auth",
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

export type PageMeta = { title: string; description: string; path: string; index?: boolean; locale?: Locale };

/**
 * One public page's metadata: a unique title (templated with the site name),
 * description, canonical URL and matching Open Graph tags. `index: false`
 * keeps thin pages out of search results while still letting links be
 * followed. The canonical never changes with the language.
 */
export function pageMetadata({ title, description, path, index = true, locale = "en" }: PageMeta): Metadata {
  const fullTitle = path === "/" ? title : `${title} · ${SITE_NAME}`;
  return {
    title: path === "/" ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { title: fullTitle, description, url: path, type: "website", siteName: SITE_NAME, locale: OG_LOCALE[locale], images: [SOCIAL_IMAGE] },
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
    changeFrequency: path === "/" || path === "/work" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/services" || path.startsWith("/services/") ? 0.8 : path === "/work" || path === "/how-it-works" ? 0.6 : 0.4,
  }));
}

export function buildRobots(base: string): MetadataRoute.Robots {
  const origin = base.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}

type JsonLdOffer = { "@type": "Offer"; priceCurrency: "QAR"; price: number; availability: string };

type JsonLdService = {
  "@type": "Service";
  "@id": string;
  url: string;
  name: string;
  description: string;
  serviceType: string;
  provider: { "@id": string };
  areaServed: Array<{ "@type": "City" | "Country"; name: string }>;
  offers?: JsonLdOffer;
};

export type HomeJsonLd = {
  "@context": "https://schema.org";
  /** The business first, then one Service per catalog service. */
  "@graph": Array<Record<string, unknown>>;
};

const AREA_SERVED = [
  { "@type": "City" as const, name: "Doha" },
  { "@type": "Country" as const, name: "Qatar" },
];

/**
 * The lowest real public price among the packages that book as this
 * service, as a schema.org Offer. Quote-only services have no offer at all:
 * structured data never invents a price.
 */
export function offerFor(service: ServiceDefinition, rows: readonly PhotoServiceRow[]): JsonLdOffer | null {
  if (service.quoteFirst) return null;
  const prices = rows.filter((s) => s.booking_type === service.bookingType).map((s) => publicPrice(s).amount).filter((a): a is number => a !== null);
  if (!prices.length) return null;
  return { "@type": "Offer", priceCurrency: "QAR", price: Math.min(...prices), availability: "https://schema.org/InStock" };
}

function businessNode({ base, studio, identity }: { base: string; studio: PhotoStudioRow | null; identity: BusinessIdentity }): Record<string, unknown> {
  const origin = base.replace(/\/$/, "");
  const name = studio?.business_name?.trim() || SITE_NAME;
  const city = studio?.city?.trim() || identity.location;
  const sameAs: string[] = [];
  const ig = studio?.instagram?.replace(/^@/, "").trim();
  if (ig) sameAs.push(`https://instagram.com/${ig}`);
  const business: Record<string, unknown> = {
    "@type": ["ProfessionalService", "LocalBusiness"],
    "@id": `${origin}/#business`,
    name,
    legalName: identity.legalName,
    identifier: { "@type": "PropertyValue", propertyID: "Commercial Registration (Qatar)", value: identity.crNumber },
    url: `${origin}/`,
    description: studio?.about?.trim() || DEFAULT_DESCRIPTION,
    image: `${origin}/brand/logo.png`,
    areaServed: AREA_SERVED,
    address: { "@type": "PostalAddress", addressLocality: city, addressCountry: "QA" },
    priceRange: "QAR",
    email: studio?.email?.trim() || identity.email,
  };
  if (sameAs.length) business.sameAs = sameAs;
  return business;
}

function serviceNode(base: string, def: ServiceDefinition, rows: readonly PhotoServiceRow[], locale: Locale): JsonLdService {
  const origin = base.replace(/\/$/, "");
  const copy = SERVICE_COPY[def.key];
  const entry: JsonLdService = {
    "@type": "Service",
    "@id": `${origin}/services/${def.slug}#service`,
    url: `${origin}/services/${def.slug}`,
    name: localized(copy.title, locale),
    description: localized(copy.short, locale),
    serviceType: "Photography and video",
    provider: { "@id": `${origin}/#business` },
    areaServed: AREA_SERVED,
  };
  const offer = offerFor(def, rows);
  if (offer) entry.offers = offer;
  return entry;
}

/**
 * Structured data for the home page: the studio as a ProfessionalService and
 * one Service per catalog service. Prices appear only when a public package
 * of that service carries a real price; quoted work has no offer at all. No
 * phone, no street address, no reviews.
 */
export function buildHomeJsonLd({ base, studio, services, identity = businessIdentity(), locale = "en" }: { base: string; studio: PhotoStudioRow | null; services: readonly PhotoServiceRow[]; identity?: BusinessIdentity; locale?: Locale }): HomeJsonLd {
  const business = businessNode({ base, studio, identity });
  const serviceEntries = SERVICES.map((k) => serviceNode(base, SERVICE_DEFINITIONS[k], services, locale));
  return { "@context": "https://schema.org", "@graph": [business, ...serviceEntries] };
}

/** Structured data for one service page: the service, its provider and a breadcrumb trail. */
export function buildServiceJsonLd({ base, def, studio, services, identity = businessIdentity(), locale = "en" }: { base: string; def: ServiceDefinition; studio: PhotoStudioRow | null; services: readonly PhotoServiceRow[]; identity?: BusinessIdentity; locale?: Locale }): HomeJsonLd {
  const origin = base.replace(/\/$/, "");
  const business = businessNode({ base, studio, identity });
  const service = serviceNode(base, def, services, locale);
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: locale === "ar" ? "الخدمات" : "Services", item: `${origin}/services` },
      { "@type": "ListItem", position: 3, name: service.name, item: service.url },
    ],
  };
  return { "@context": "https://schema.org", "@graph": [business, service, breadcrumb] };
}

/** JSON for a `<script type="application/ld+json">`: our own data, with `<` escaped so it can never close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
