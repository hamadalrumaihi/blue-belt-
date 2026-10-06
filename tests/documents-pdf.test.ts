import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { evidenceSummaryOf, renderDocumentPdf } from "@/lib/documents/pdf";

/** pdf-lib deflates content streams; inflate every stream so drawn text can be asserted on. */
function visibleText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const latin = raw.toString("latin1");
  let out = latin;
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const m of latin.matchAll(re)) {
    const start = (m.index ?? 0) + m[0].indexOf(m[1]);
    const chunk = raw.subarray(start, start + Buffer.byteLength(m[1], "latin1"));
    try {
      // Standard-font text is written as hex strings (<48656c6c6f> Tj); decode them so assertions read plain text.
      out += inflateSync(chunk)
        .toString("latin1")
        .replace(/<([0-9A-Fa-f]+)>/g, (_m, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
    } catch {
      // not a Flate stream (fonts, xref) — ignore
    }
  }
  return out;
}

const base = { title: "Event coverage agreement", businessName: "Blue Belt Media", ref: { documentId: "11111111-1111-4111-8111-111111111111", bodyHash: "abcdef0123456789ffff" } } as const;

describe("renderDocumentPdf", () => {
  it("returns a PDF with the header, title and footer hash", async () => {
    const bytes = await renderDocumentPdf({ ...base, body: "Clause one.\n\nClause two.", status: "sent", signer: null });
    expect(Buffer.from(bytes.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
    const text = visibleText(bytes);
    expect(text).toContain("Clause one.");
    expect(text).toContain("Blue Belt Media");
    expect(text).toContain("hash abcdef012345");
    expect(text).toContain("not yet signed");
    expect(text).not.toContain("ELECTRONIC SIGNATURE");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("adds the signature block with the signer's details when signed", async () => {
    const bytes = await renderDocumentPdf({
      ...base,
      body: "Body text.",
      status: "signed",
      signer: { name: "Sara Khan", email: "sara@example.com", phone: "+974 5000 0000", signedAt: "6 October 2026, 12:00 (Qatar time)", evidenceSummary: evidenceSummaryOf({ method: "typed_name", ip: "10.0.0.1", user_agent: "Mozilla/5.0", body_hash: "feedface" }) },
    });
    const text = visibleText(bytes);
    expect(text).toContain("ELECTRONIC SIGNATURE");
    expect(text).toContain("Signed electronically by Sara Khan");
    expect(text).toContain("sara@example.com");
    expect(text).toContain("Network address: 10.0.0.1");
    expect(text).toContain("Body hash at signing: feedface");
  });

  it("wraps long bodies across pages with page numbers and survives non-Latin text", async () => {
    const body = Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}: ${"word ".repeat(30)}`).join("\n\n") + "\n\nعربي ✓";
    const bytes = await renderDocumentPdf({ ...base, body, status: "viewed", signer: null });
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    expect(pages).toBeGreaterThan(2);
    expect(visibleText(bytes)).toContain(`Page ${pages} of ${pages}`);
  });
});
