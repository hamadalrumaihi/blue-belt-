import { describe, expect, it } from "vitest";
import { buildEmail, renderEmailHtml, renderEmailText, type EmailContent } from "@/lib/notifications/email/templates";

const HOSTILE = `<script>alert("x")</script> & "quotes" 'single'`;

const content: EmailContent = {
  kind: "GALLERY_READY",
  subject: `Your gallery ${HOSTILE}`,
  greeting: `Hi ${HOSTILE},`,
  paragraphs: [`Para ${HOSTILE}`, "Second paragraph."],
  cta: { label: `View ${HOSTILE}`, url: `https://bb.pic-time.com/doha?a=1&b="2"<3>` },
  facts: [[`Key ${HOSTILE}`, `Value ${HOSTILE}`]],
  footer: `Footer ${HOSTILE}`,
  businessName: `Studio ${HOSTILE}`,
};

describe("renderEmailHtml", () => {
  it("escapes < and & in every field, and quotes in the CTA href", () => {
    const html = renderEmailHtml(content);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    // Every dynamic field shows the escaped script tag at least once.
    const occurrences = html.split("&lt;script&gt;").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(7);
    expect(html).toContain("&amp; ");
    // The href is attribute-escaped so the quotes in the URL cannot break out.
    expect(html).toContain(`href="https://bb.pic-time.com/doha?a=1&amp;b=&quot;2&quot;&lt;3&gt;"`);
    expect(html).not.toMatch(/href="[^"]*"[^>]*"2"/);
    expect(html).toContain("Second paragraph.");
  });

  it("renders the facts table, the CTA fallback link and omits them when absent", () => {
    const html = renderEmailHtml(content);
    expect(html).toContain("<table");
    expect(html).toContain("If the button does not open, copy this link:");
    const bare = renderEmailHtml({ ...content, cta: null, facts: [], footer: undefined });
    expect(bare).not.toContain("<table");
    expect(bare).not.toContain("<a ");
    expect(bare).toContain("This message was sent about your booking.");
  });
});

describe("renderEmailText", () => {
  it("contains the greeting, paragraphs, facts and the CTA url unescaped", () => {
    const text = renderEmailText(content);
    expect(text.startsWith(`Hi ${HOSTILE},`)).toBe(true);
    expect(text).toContain(`Para ${HOSTILE}`);
    expect(text).toContain(`Key ${HOSTILE}: Value ${HOSTILE}`);
    expect(text).toContain(`View ${HOSTILE}: https://bb.pic-time.com/doha?a=1&b="2"<3>`);
    expect(text.trimEnd().endsWith(`Footer ${HOSTILE}`)).toBe(true);
    expect(renderEmailText({ ...content, footer: undefined }).trimEnd().endsWith(`Studio ${HOSTILE}`)).toBe(true);
  });
});

describe("buildEmail", () => {
  it("keeps text and html in step and carries the recipient and subject verbatim", () => {
    const draft = buildEmail("fatima@example.com", content);
    expect(draft.to).toBe("fatima@example.com");
    expect(draft.subject).toBe(content.subject);
    expect(draft.text).toContain("https://bb.pic-time.com/doha");
    expect(draft.html).toContain("https://bb.pic-time.com/doha");
  });
});
