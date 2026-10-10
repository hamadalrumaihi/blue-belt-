import { ImageResponse } from "next/og";
import { DEFAULT_DESCRIPTION, SITE_NAME } from "@/lib/seo";

export const alt = SITE_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The social sharing card: brand navy, the studio name and what it does.
 * Generated, so it never depends on a photograph the owner has not approved.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #0b1f3a 0%, #12294a 60%, #1a3560 100%)", color: "#ffffff", fontFamily: "Inter, Arial, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", color: "#0b1f3a", fontSize: 34, fontWeight: 800 }}>B</div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>Jiu-jitsu and martial arts photography in Qatar</div>
          <div style={{ fontSize: 28, color: "rgba(255,255,255,0.75)", maxWidth: 900, lineHeight: 1.35 }}>{DEFAULT_DESCRIPTION}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "rgba(255,255,255,0.6)" }}>
          <span>bluebeltmedia.com</span>
          <span>Doha, Qatar</span>
        </div>
      </div>
    ),
    size,
  );
}
