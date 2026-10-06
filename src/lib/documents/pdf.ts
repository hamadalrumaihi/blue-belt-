import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { DocumentStatus } from "@/lib/supabase/database.types";
import { DOCUMENT_STATUS_LABEL } from "./state";
import { shortHash } from "./hash";

/**
 * Renders a document (signed or not) as a simple, printable A4 PDF with
 * pdf-lib: Helvetica 11pt, wrapped paragraphs, a header with the studio
 * name and title on every page, page numbers and a footer carrying the
 * document id and the first characters of the body hash, so a printed copy
 * can be matched to the stored record. A signature block is appended for
 * signed documents. Pure: bytes in, bytes out, no I/O.
 */

export type PdfSigner = { name: string; email: string | null; phone: string | null; signedAt: string; evidenceSummary: string[] };

export type RenderDocumentPdfInput = {
  title: string;
  body: string;
  status: DocumentStatus;
  signer: PdfSigner | null;
  businessName: string;
  ref: { documentId: string; bodyHash: string | null };
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const BODY_SIZE = 11;
const INK = rgb(0.08, 0.13, 0.24);
const MUTED = rgb(0.41, 0.46, 0.54);
const LINE_COLOR = rgb(0.89, 0.91, 0.95);

type Ctx = { pdf: PDFDocument; font: PDFFont; bold: PDFFont; pages: PDFPage[]; page: PDFPage; y: number; header: { businessName: string; title: string }; charset: Set<number> };

/** Helvetica only covers WinAnsi; anything else (Arabic, emoji) becomes "?" rather than throwing. */
function encodable(text: string, charset: Set<number>): string {
  let out = "";
  for (const ch of text.replace(/\t/g, "    ")) {
    const cp = ch.codePointAt(0) ?? 63;
    out += charset.has(cp) ? ch : "?";
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      // A single word wider than the column is split by character.
      let piece = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(piece + ch, size) > maxWidth && piece) {
          lines.push(piece);
          piece = "";
        }
        piece += ch;
      }
      current = piece;
    }
    if (current) lines.push(current);
  }
  return lines;
}

function newPage(ctx: Ctx): void {
  const page = ctx.pdf.addPage([A4.width, A4.height]);
  ctx.pages.push(page);
  ctx.page = page;
  const top = A4.height - MARGIN + 18;
  page.drawText(encodable(ctx.header.businessName, ctx.charset), { x: MARGIN, y: top, size: 9, font: ctx.bold, color: MUTED });
  const titleText = encodable(ctx.header.title, ctx.charset);
  const titleWidth = ctx.font.widthOfTextAtSize(titleText, 9);
  page.drawText(titleText, { x: Math.max(MARGIN, A4.width - MARGIN - titleWidth), y: top, size: 9, font: ctx.font, color: MUTED });
  page.drawLine({ start: { x: MARGIN, y: top - 8 }, end: { x: A4.width - MARGIN, y: top - 8 }, thickness: 0.6, color: LINE_COLOR });
  ctx.y = A4.height - MARGIN - 8;
}

function ensureRoom(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN + 10) newPage(ctx);
}

function paragraph(ctx: Ctx, text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gapAfter?: number } = {}): void {
  const size = opts.size ?? BODY_SIZE;
  const font = opts.font ?? ctx.font;
  const lineHeight = Math.round(size * 1.36);
  const lines = wrap(encodable(text, ctx.charset), font, size, A4.width - MARGIN * 2);
  for (const line of lines) {
    ensureRoom(ctx, lineHeight);
    if (line) ctx.page.drawText(line, { x: MARGIN, y: ctx.y - size, size, font, color: opts.color ?? INK });
    ctx.y -= line ? lineHeight : lineHeight * 0.6;
  }
  ctx.y -= opts.gapAfter ?? 4;
}

function signatureBlock(ctx: Ctx, signer: PdfSigner): void {
  const lines = [
    `Signed electronically by ${signer.name}`,
    signer.email ? `E-mail: ${signer.email}` : null,
    signer.phone ? `Phone: ${signer.phone}` : null,
    `Signed at: ${signer.signedAt}`,
    ...signer.evidenceSummary,
  ].filter((l): l is string => Boolean(l));
  const height = 22 + lines.length * 14 + 12;
  ensureRoom(ctx, height + 10);
  const top = ctx.y - 6;
  ctx.page.drawRectangle({ x: MARGIN, y: top - height, width: A4.width - MARGIN * 2, height, borderColor: LINE_COLOR, borderWidth: 1, color: rgb(0.965, 0.975, 0.99) });
  ctx.page.drawText("ELECTRONIC SIGNATURE", { x: MARGIN + 12, y: top - 18, size: 8.5, font: ctx.bold, color: MUTED });
  let y = top - 34;
  for (const [i, line] of lines.entries()) {
    const text = encodable(line, ctx.charset);
    const fitted = wrap(text, ctx.font, 9.5, A4.width - MARGIN * 2 - 24)[0] ?? "";
    ctx.page.drawText(fitted, { x: MARGIN + 12, y, size: i === 0 ? 10.5 : 9.5, font: i === 0 ? ctx.bold : ctx.font, color: INK });
    y -= 14;
  }
  ctx.y = top - height - 10;
}

export async function renderDocumentPdf(input: RenderDocumentPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setAuthor(input.businessName);
  pdf.setProducer("Blue Belt Media studio");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set<number>(font.getCharacterSet());
  const ctx: Ctx = { pdf, font, bold, pages: [], page: null as unknown as PDFPage, y: 0, header: { businessName: input.businessName, title: input.title }, charset };
  newPage(ctx);

  ctx.y -= 10;
  paragraph(ctx, input.title, { size: 17, font: bold, gapAfter: 2 });
  const statusLine = input.status === "signed" && input.signer ? `Signed by ${input.signer.name} on ${input.signer.signedAt}` : `Status: ${DOCUMENT_STATUS_LABEL[input.status]} — not yet signed`;
  paragraph(ctx, statusLine, { size: 9.5, color: MUTED, gapAfter: 12 });

  paragraph(ctx, input.body, { gapAfter: 14 });
  if (input.status === "signed" && input.signer) signatureBlock(ctx, input.signer);

  const footerLeft = encodable(`Document ${input.ref.documentId} · hash ${shortHash(input.ref.bodyHash)}`, charset);
  const total = ctx.pages.length;
  ctx.pages.forEach((page, i) => {
    page.drawLine({ start: { x: MARGIN, y: MARGIN - 14 }, end: { x: A4.width - MARGIN, y: MARGIN - 14 }, thickness: 0.6, color: LINE_COLOR });
    page.drawText(footerLeft, { x: MARGIN, y: MARGIN - 26, size: 7.5, font, color: MUTED });
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, { x: A4.width - MARGIN - font.widthOfTextAtSize(label, 7.5), y: MARGIN - 26, size: 7.5, font, color: MUTED });
  });

  return pdf.save();
}

/** Human lines for the PDF's signature block from the stored signature_evidence JSON. */
export function evidenceSummaryOf(evidence: unknown): string[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const e = evidence as Record<string, unknown>;
  const out: string[] = [];
  if (typeof e.method === "string") out.push(`Method: ${e.method === "typed_name" ? "typed name + agreement checkbox" : e.method}`);
  if (typeof e.ip === "string" && e.ip) out.push(`Network address: ${e.ip}`);
  if (typeof e.user_agent === "string" && e.user_agent) out.push(`Device: ${e.user_agent.slice(0, 120)}`);
  if (typeof e.body_hash === "string" && e.body_hash) out.push(`Body hash at signing: ${e.body_hash}`);
  return out;
}
