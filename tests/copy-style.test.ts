import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * House style for customer-facing text: no em dashes, and nothing that says
 * payment happens offline or outside the website. Checks the public site, the
 * client portal, the client e-mails and the contract templates as source
 * files, so a stray character in a string literal or JSX text fails the suite.
 */
const ROOT = new URL("../", import.meta.url).pathname;

/** Files another agent owns in this round are checked separately by them. */
const EXCLUDED = new Set(["src/app/(public)/book/done/page.tsx", "src/app/(public)/book/BookingWizard.tsx"]);
const EXCLUDED_DIRS = new Set(["src/app/(public)/pay"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (EXCLUDED_DIRS.has(rel)) continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !EXCLUDED.has(rel)) out.push(full);
  }
  return out;
}

const FILES = [
  ...walk(join(ROOT, "src/app/(public)")),
  ...walk(join(ROOT, "src/app/(client)")),
  join(ROOT, "src/lib/bookings/emails.ts"),
  join(ROOT, "src/lib/notifications/email/templates.ts"),
  join(ROOT, "src/lib/documents/templates.ts"),
  join(ROOT, "src/components/public/PublicHeader.tsx"),
  join(ROOT, "src/components/public/PublicFooter.tsx"),
  join(ROOT, "src/lib/seo.ts"),
];

const BANNED_PHRASES = ["offline", "arranged manually", "outside the website"];

describe("customer-facing copy", () => {
  it("covers the public site, the client portal, e-mails and contract templates", () => {
    const rel = FILES.map((f) => relative(ROOT, f).split(sep).join("/"));
    expect(rel).toContain("src/app/(public)/page.tsx");
    expect(rel).toContain("src/app/(public)/services/page.tsx");
    expect(rel).toContain("src/app/(client)/client/page.tsx");
    expect(rel).not.toContain("src/app/(public)/book/BookingWizard.tsx");
    expect(rel.some((r) => r.startsWith("src/app/(public)/pay/"))).toBe(false);
  });

  it.each(FILES.map((f) => [relative(ROOT, f).split(sep).join("/"), f]))("%s has no em dash", (_rel, file) => {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n").map((l, i) => (l.includes("—") ? `${i + 1}: ${l.trim()}` : null)).filter(Boolean);
    expect(lines, `em dash found:\n${lines.join("\n")}`).toEqual([]);
  });

  it.each(FILES.map((f) => [relative(ROOT, f).split(sep).join("/"), f]))("%s never says payment is offline or outside the website", (_rel, file) => {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const phrase of BANNED_PHRASES) expect(text, `found "${phrase}"`).not.toContain(phrase);
  });
});
