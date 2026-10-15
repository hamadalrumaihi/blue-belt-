"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, string | number>) => void };
  }
}

/**
 * Counts a page-level event (for example `service-view`) once per mount
 * when Umami is loaded. The data holds catalog keys only, never anything
 * about the visitor.
 */
export function TrackEvent({ name, data }: { name: string; data?: Record<string, string | number> }) {
  useEffect(() => {
    try {
      window.umami?.track(name, data);
    } catch {
      // Analytics is optional; never let it break the page.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, by design.
  }, []);
  return null;
}
