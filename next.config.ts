import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
