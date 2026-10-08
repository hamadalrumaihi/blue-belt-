import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicFooter } from "@/components/public/PublicFooter";
import type { PhotoStudioRow } from "@/lib/supabase/database.types";

describe("public contact privacy", () => {
  it("keeps email available while withholding configured phone and WhatsApp numbers", () => {
    const studio = { business_name: "Blue Belt Media", phone: "+974 30200312", whatsapp: "+974 30200312", email: "bluebeltmediaqatar@gmail.com", instagram: "bluebeltmedia" } as PhotoStudioRow;
    const html = renderToStaticMarkup(createElement(PublicFooter, { studio, galleryUrl: "https://galleries.bluebelt.media/client" }));
    expect(html).toContain("mailto:bluebeltmediaqatar@gmail.com");
    expect(html).toContain("https://instagram.com/bluebeltmedia");
    expect(html).not.toContain("30200312");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("wa.me");
  });
});
