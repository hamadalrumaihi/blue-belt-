import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { siteMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/studio/queries";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Site-wide defaults (metadataBase, title template, Open Graph) come from
// src/lib/seo.ts so every route shares them; public pages refine title,
// description and canonical in their own metadata.
const site = siteMetadata(siteUrl());

export const metadata: Metadata = {
  metadataBase: site.metadataBase,
  title: site.title,
  description: site.description,
  applicationName: site.applicationName,
  openGraph: site.openGraph,
  twitter: site.twitter,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Blue Belt Media",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  // Browser chrome follows the device setting; the page itself follows the stored choice.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b1f3a" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1322" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the pre-paint script below sets data-theme and
    // style.color-scheme on <html> before React hydrates, on purpose.
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Our own constant string (src/lib/theme.ts), never user content: applies light/dark before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
