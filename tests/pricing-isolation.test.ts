import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pricing research and quotes are owner-only. Nothing customer-facing (public
 * site, client portal, e-mails, documents, API routes) may import or mention
 * them, and the database policies must require the owner role, not merely a
 * studio user.
 */
const ROOT = join(__dirname, "..");
const SURFACES = ["src/app/(public)", "src/app/(client)", "src/lib/client-portal", "src/lib/notifications/email", "src/lib/documents", "src/app/api"];
const FORBIDDEN = ["photo_price_references", "photo_quotes", "photo_pricing_assessments", "lib/pricing"];
/** The one API route that may touch pricing: CRON_SECRET-protected, service role, returns counts only (asserted below). */
const ALLOWED = ["src/app/api/cron/pricing/route.ts"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|md|html|txt)$/.test(name)) out.push(p);
  }
  return out;
}

describe("pricing isolation", () => {
  it("no public, client, e-mail, document or API source mentions the pricing tables or module", () => {
    const hits: string[] = [];
    for (const surface of SURFACES) {
      for (const file of walk(join(ROOT, surface))) {
        if (ALLOWED.some((a) => file.endsWith(a))) continue;
        const text = readFileSync(file, "utf8");
        for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${file.replace(ROOT, "")}: ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the e-mail templates and every public page never import the pricing module", () => {
    const templates = readFileSync(join(ROOT, "src/lib/notifications/email/templates.ts"), "utf8");
    expect(templates).not.toMatch(/lib\/pricing|photo_pricing_assessments|photo_quotes|photo_price_references/);
    for (const file of walk(join(ROOT, "src/app/(public)"))) expect(readFileSync(file, "utf8"), file).not.toMatch(/lib\/pricing/);
  });

  it("the cron pricing route only ever answers with counts and statuses", () => {
    const route = readFileSync(join(ROOT, "src/app/api/cron/pricing/route.ts"), "utf8");
    expect(route).toContain("verifyCronSecret");
    expect(route).toContain("createServiceClient");
    expect(route).not.toMatch(/recommendation|recommended|price_from|customer_/);
    expect(route).toContain('research');
  });

  it("the pricing library never reads customer identifiers into a request or research scope", () => {
    // The files that read a booking / lead or describe a research job: no customer column, no free text.
    for (const file of ["src/lib/pricing/engine/extract.ts", "src/lib/pricing/compute.ts", "src/lib/pricing/assess-hook.ts", "src/lib/pricing/capacity.ts", "src/lib/pricing/research.ts"]) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(text, file).not.toMatch(/customer_|guardian|athlete_name|club_name|instagram|\bnotes\b|\bemail\b|\bphone\b/);
    }
    const hook = readFileSync(join(ROOT, "src/lib/pricing/assess-hook.ts"), "utf8");
    expect(hook).toContain("try {");
    expect(hook).not.toMatch(/notifications\/(owner|email)/);
    const research = readFileSync(join(ROOT, "src/lib/pricing/research.ts"), "utf8");
    expect(research).toContain("not_configured");
    expect(research).not.toMatch(/fetch\(|WebSearch|puppeteer|playwright/);
  });

  it("the pricing-intelligence migration's assessments policy requires the owner role and revokes anon", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261015120000_pricing_intelligence.sql"), "utf8");
    const start = sql.indexOf("create policy photo_pricing_assessments_owner_all");
    expect(start).toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf(";", start));
    expect(body).toContain("photo_is_owner_user()");
    expect(body).toContain("with check (");
    expect(body).not.toContain("photo_is_studio_user");
    expect(sql).toMatch(/revoke all on table public\.photo_pricing_assessments from anon/);
    expect(sql).toMatch(/alter table public\.photo_pricing_assessments enable row level security/);
  });

  it("the migration's two policies require the owner role in the database", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261007100000_pricing_references.sql"), "utf8");
    for (const policy of ["photo_price_references_owner_all", "photo_quotes_owner_all"]) {
      const start = sql.indexOf(`create policy ${policy}`);
      expect(start, `${policy} is defined`).toBeGreaterThan(-1);
      const body = sql.slice(start, sql.indexOf(";", start));
      expect(body).toContain("photo_is_owner_user()");
      expect(body).toContain("using (");
      expect(body).toContain("with check (");
      expect(body).not.toContain("photo_is_studio_user");
    }
    expect(sql).toMatch(/revoke execute on function public\.photo_is_owner_user\(\) from public, anon/);
  });

  it("the pricing actions guard with requireOwner, never requireStudioUser, and never import the notification modules", () => {
    const actions = readFileSync(join(ROOT, "src/lib/actions/pricing.ts"), "utf8");
    expect(actions).toContain("requireOwner");
    expect(actions).not.toContain("requireStudioUser");
    expect(actions).not.toMatch(/notifications\/(owner|email)/);
    const queries = readFileSync(join(ROOT, "src/lib/pricing/queries.ts"), "utf8");
    expect(queries).not.toContain("supabase/service");
  });
});
