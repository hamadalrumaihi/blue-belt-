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
    default: "Blue Belt Media — Combat sports photography & video, Doha",
    template: "%s · Blue Belt Media",
  },
  description:
    "Blue Belt Media: tournament, athlete and team photography and video coverage in Qatar. Book coverage, sign your agreement and get your Pic-Time gallery in one place.",
  applicationName: "Blue Belt Media",
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
