"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pic-Time's testimonials widget, embedded as the studio's own gallery
 * account publishes it. The iframe loads straight from Pic-Time (no proxy, no
 * scraping); after it loads, Pic-Time's resize helper is appended next to the
 * iframe — the same thing their inline `onload` snippet does — so the frame
 * grows to fit its content instead of scrolling inside a fixed box.
 *
 * States: skeleton while loading; the live widget once it loads; the
 * fallback children if Pic-Time does not answer in time or the frame errors.
 */
export const PICTIME_TESTIMONIALS_SRC = "https://bluebeltmedia.pic-time.com/testimonials?pictimeColumns=&cssurl=";
export const PICTIME_RESIZE_SCRIPT = "https://pictimecloudaf-pub-g3csanfebyefg3dm.a02.azurefd.net/pictures/scripts/iframeresize.js";

/** How long to wait for the widget before showing the fallback (the frame may still arrive later). */
const LOAD_TIMEOUT_MS = 10_000;

export function PictimeTestimonials({ src = PICTIME_TESTIMONIALS_SRC, fallback }: { src?: string; fallback: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const wrapper = useRef<HTMLDivElement>(null);
  const scriptAdded = useRef(false);

  useEffect(() => {
    if (state !== "loading") return;
    const t = window.setTimeout(() => setState((s) => (s === "loading" ? "failed" : s)), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [state]);

  function onLoad() {
    // Pic-Time's resize helper reads the iframe next to it and posts height
    // updates; add it once, from a fixed URL (never from page content).
    if (!scriptAdded.current && wrapper.current) {
      scriptAdded.current = true;
      const script = document.createElement("script");
      script.src = PICTIME_RESIZE_SCRIPT;
      script.async = true;
      wrapper.current.append(script);
    }
    setState("ready");
  }

  return (
    <div className="relative w-full overflow-hidden" aria-busy={state === "loading"}>
      {state === "loading" && (
        <div className="absolute inset-0 grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-40 animate-pulse bg-page motion-reduce:animate-none" />
          ))}
        </div>
      )}
      {state === "failed" ? (
        <div role="status">{fallback}</div>
      ) : (
        <div ref={wrapper} className={state === "ready" ? "w-full" : "h-44 w-full opacity-0"}>
          <iframe
            id="pictimeIntegration"
            name="pictimeIntegration"
            title="Client testimonials from Pic-Time"
            src={src}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            onLoad={onLoad}
            onError={() => setState("failed")}
            className="block w-full border-0"
            style={{ width: "100%", minHeight: state === "ready" ? 320 : 0, height: "100%" }}
          />
        </div>
      )}
      {state === "loading" && <p className="sr-only">Loading testimonials…</p>}
    </div>
  );
}
