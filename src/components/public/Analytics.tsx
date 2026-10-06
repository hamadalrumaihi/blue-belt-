import Script from "next/script";

/**
 * Umami page analytics for the public website only. Off unless both
 * NEXT_PUBLIC_UMAMI_WEBSITE_ID and NEXT_PUBLIC_UMAMI_SCRIPT_URL are set, so a
 * deployment without them ships no third-party script at all. Umami sets no
 * cookies; clicks tagged with `data-umami-event` are counted automatically.
 */
export function Analytics() {
  const id = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim();
  const src = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL?.trim();
  if (!id || !src || !src.startsWith("https://")) return null;
  return <Script defer src={src} data-website-id={id} data-auto-track="true" strategy="afterInteractive" />;
}
