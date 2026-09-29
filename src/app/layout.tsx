import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Blue Belt Media — Tournament Watcher",
    template: "%s · Blue Belt Media",
  },
  description:
    "Tournament Coverage Command Center for Blue Belt Media. Know who to photograph next, where, and how soon.",
  applicationName: "Blue Belt Media Tournament Watcher",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Blue Belt Media",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1f3a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
