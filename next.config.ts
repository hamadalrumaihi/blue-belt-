import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Capability-token pages (payment and signing links): never leak the token through the Referer header.
      { source: "/pay/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/sign/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
  async redirects() {
    return [
      // The old gallery signpost is now the indexable showcase; the FAQ lives on the process page.
      { source: "/portfolio", destination: "/work", permanent: true },
      { source: "/faq", destination: "/how-it-works#faq", permanent: true },
    ];
  },
  images: {
    // Curated photographs (public/photos) are served as AVIF where the browser
    // accepts it, WebP otherwise, in the widths next/image needs.
    formats: ["image/avif", "image/webp"],
    // Photographs ask for 82 (src/components/public/Photo.tsx); everything else uses the default 75.
    qualities: [75, 82],
    // Web copies are stable for a year; the manifest changes their id when the source changes.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
