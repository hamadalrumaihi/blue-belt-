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
const FORBIDDEN = ["photo_price_references", "photo_quotes", "lib/pricing"];

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
        const text = readFileSync(file, "utf8");
        for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${file.replace(ROOT, "")}: ${needle}`);
      }
    }
    expect(hits).toEqual([]);
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
