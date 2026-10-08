import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * House style for customer-facing text: no em dashes, nothing that says
 * payment happens offline or outside the website, no "no payment is needed
 * to book" story, and no vendor names (gallery host, payment provider,
 * e-signature provider) in anything a customer can read. Checks the public
 * site (pay and sign pages included), the client portal, the client e-mails,
 * the contract templates, the legal texts and the search metadata as source
 * files, so a stray word in a string literal or JSX text fails the suite.
 *
 * Vendor words are looked for only in customer-visible text: string
 * literals and JSX text. Comments, import paths, identifiers, env names,
 * URLs, ids, names and data-* attributes are allowed to keep the real names.
 */
const ROOT = new URL("../", import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = [
  ...walk(join(ROOT, "src/app/(public)")),
  ...walk(join(ROOT, "src/app/(client)")),
  ...walk(join(ROOT, "src/components/public")),
  ...walk(join(ROOT, "src/lib/legal")),
  join(ROOT, "src/lib/bookings/emails.ts"),
  join(ROOT, "src/lib/notifications/email/templates.ts"),
  join(ROOT, "src/lib/documents/templates.ts"),
  join(ROOT, "src/lib/seo.ts"),
];

const rel = (f: string) => relative(ROOT, f).split(sep).join("/");

/** Phrases that must not appear anywhere in these files (case-insensitive). */
const BANNED_PHRASES = ["offline", "arranged manually", "outside the website", "no payment is needed to book", "after the shoot you pay"];

/** Vendor names, as a customer could read them: a standalone word, not part of an identifier. */
const VENDOR_RE = /(?<![\w$.])(pic[\s-]?time|my\s?fatoorah|fatoorah|docusign)(?![\w$(])/gi;

/** Attribute names whose string value is internal (never read by a person). */
const INTERNAL_ATTR_RE = /(?:^|[\s{(,])(?:id|name|key|htmlFor|className|src|href|rel|target|type|value|role|data-[\w-]+|aria-labelledby|aria-controls|aria-describedby)=$/;

type Hit = { line: number; text: string };

/**
 * Pulls the customer-visible text out of a TS/TSX source: string literals
 * (except URLs, internal attribute values and lowercase enum tokens) and
 * JSX text. Comments are skipped.
 */
export function customerVisibleText(source: string): Hit[] {
  const hits: Hit[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  const push = (start: number, text: string) => {
    if (text.trim()) hits.push({ line: source.slice(0, start).split("\n").length, text });
  };
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\n") line += 1;
    // Comments.
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // String literals.
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i;
      i += 1;
      let text = "";
      while (i < n && source[i] !== ch) {
        if (source[i] === "\\") {
          text += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (ch === "`" && source[i] === "$" && source[i + 1] === "{") {
          // Skip the expression; nested braces are rare in this codebase.
          const close = source.indexOf("}", i);
          i = close === -1 ? n : close + 1;
          text += " ";
          continue;
        }
        text += source[i];
        i += 1;
      }
      i += 1;
      const before = source.slice(Math.max(0, start - 40), start);
      const isImport = /\b(?:from|import)\s*\(?\s*$/.test(before);
      const isUrl = /^(?:https?:)?\/\//.test(text) || /\.(?:com|net|media|js)(?:\/|$)/.test(text);
      const isInternalAttr = INTERNAL_ATTR_RE.test(before);
      const isEnumToken = /^[a-z0-9_.:-]+$/.test(text);
      if (!isImport && !isUrl && !isInternalAttr && !isEnumToken) push(start, text);
      continue;
    }
    // JSX text: after a closing ">" up to the next "<" or "{" on the same line or the following lines.
    if (ch === ">") {
      i += 1;
      const start = i;
      let text = "";
      while (i < n && source[i] !== "<" && source[i] !== "{") {
        text += source[i];
        i += 1;
      }
      // Code also contains ">": arrow functions, comparisons, generics. Real JSX text has no code punctuation.
      if (text.trim() && !/[=;()[\]`]/.test(text) && !/^\s*[&|?:]/.test(text) && !/^\s*\w+\.\w+/.test(text)) push(start, text);
      continue;
    }
    i += 1;
  }
  void line;
  return hits;
}

describe("customer-facing copy", () => {
  it("covers the public site (pay and sign included), the client portal, e-mails, contract templates, legal texts and metadata", () => {
    const files = FILES.map(rel);
    for (const expected of [
      "src/app/(public)/page.tsx",
      "src/app/(public)/services/page.tsx",
      "src/app/(public)/book/BookingWizard.tsx",
      "src/app/(public)/book/done/page.tsx",
      "src/app/(public)/pay/[token]/page.tsx",
      "src/app/(public)/sign/[token]/page.tsx",
      "src/app/(client)/client/page.tsx",
      "src/components/public/PublicFooter.tsx",
      "src/lib/legal/terms.ts",
      "src/lib/bookings/emails.ts",
      "src/lib/documents/templates.ts",
      "src/lib/seo.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("the text extractor keeps copy and drops identifiers, imports, URLs and internal attributes", () => {
    const src = [
      'import { x } from "@/lib/payments/myfatoorah/client";',
      "// Pic-Time comment",
      "/* MyFatoorah block */",
      'const url = "https://bluebeltmedia.pic-time.com/client";',
      'const label = "View and buy photos";',
      '<iframe id="pictimeIntegration" title="Client testimonials from our galleries" />',
      "<p>Hello <b>there</b> {name}</p>",
      "const f = (a) => a > 1 ? x : y;",
      'if (method === "myfatoorah") go();',
      "window.myFatoorah.submit();",
    ].join("\n");
    const texts = customerVisibleText(src).map((h) => h.text.trim());
    expect(texts).toContain("View and buy photos");
    expect(texts).toContain("Client testimonials from our galleries");
    expect(texts).toContain("Hello");
    expect(texts).toContain("there");
    expect(texts).not.toContain("@/lib/payments/myfatoorah/client");
    expect(texts).not.toContain("https://bluebeltmedia.pic-time.com/client");
    expect(texts).not.toContain("pictimeIntegration");
    expect(texts).not.toContain("myfatoorah");
    expect(texts.join("\n")).not.toMatch(VENDOR_RE);
    expect(customerVisibleText('<p>Delivered on Pic-Time.</p>').map((h) => h.text).join("")).toMatch(VENDOR_RE);
    expect(customerVisibleText('const t = "Pay with MyFatoorah";').map((h) => h.text).join("")).toMatch(VENDOR_RE);
  });

  it.each(FILES.map((f) => [rel(f), f]))("%s has no em dash", (_rel, file) => {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n").map((l, i) => (l.includes("—") ? `${i + 1}: ${l.trim()}` : null)).filter(Boolean);
    expect(lines, `em dash found:\n${lines.join("\n")}`).toEqual([]);
  });

  it.each(FILES.map((f) => [rel(f), f]))("%s never says payment is offline, outside the website, or not needed to book", (_rel, file) => {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const phrase of BANNED_PHRASES) expect(text, `found "${phrase}"`).not.toContain(phrase);
  });

  it.each(FILES.map((f) => [rel(f), f]))("%s shows no vendor name to customers", (_rel, file) => {
    const hits = customerVisibleText(readFileSync(file, "utf8")).filter((h) => VENDOR_RE.test(h.text) && (VENDOR_RE.lastIndex = 0) === 0);
    const report = hits.map((h) => `${h.line}: ${h.text.trim().slice(0, 140)}`);
    expect(report, `vendor name in customer-visible text:\n${report.join("\n")}`).toEqual([]);
  });
});
