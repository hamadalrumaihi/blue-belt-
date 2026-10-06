import { describe, expect, it, vi } from "vitest";
import { findOrCreatePerson, normalizeInstagram, phoneKey } from "@/lib/people/match";
import type { PhotoPersonRow } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));

const OWNER = "11111111-1111-4111-8111-111111111111";

function person(overrides: Partial<PhotoPersonRow> = {}): PhotoPersonRow {
  return {
    id: "p1",
    owner_id: OWNER,
    user_id: null,
    full_name: "Sara Haddad",
    email: "sara@example.com",
    email_key: "sara@example.com",
    phone: "+974 5555 1234",
    phone_key: "55551234",
    instagram: null,
    whatsapp: null,
    kind: "person",
    source: "manual",
    tags: [],
    notes: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Minimal chainable fake: records inserts/updates, answers selects from `rows`. */
function fakeSupabase(rows: PhotoPersonRow[]) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  function query(kind: "select" | "insert" | "update", payload?: Record<string, unknown>) {
    const filters: Array<[string, unknown]> = [];
    const chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (kind === "update") {
          const id = filters.find(([k]) => k === "id")?.[1];
          updates.push({ id: String(id), patch: payload ?? {} });
          const row = rows.find((r) => r.id === id);
          return { data: row ? { ...row, ...payload } : null, error: null };
        }
        const hit = rows.find((r) => filters.every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
        return { data: hit ?? null, error: null };
      },
      single: async () => {
        if (kind === "insert") {
          inserts.push(payload ?? {});
          return { data: person({ id: "new", ...(payload as Partial<PhotoPersonRow>) }), error: null };
        }
        return { data: null, error: { message: "unexpected" } };
      },
    };
    return chain;
  }
  const client = {
    from: () => ({
      select: () => query("select"),
      insert: (p: Record<string, unknown>) => query("insert", p),
      update: (p: Record<string, unknown>) => query("update", p),
    }),
  };
  return { client: client as unknown as Parameters<typeof findOrCreatePerson>[0], inserts, updates };
}

describe("phoneKey / normalizeInstagram", () => {
  it("keeps the last 8 digits whatever the prefix", () => {
    expect(phoneKey("+974 5555 1234")).toBe("55551234");
    expect(phoneKey("0097455551234")).toBe("55551234");
    expect(phoneKey("123")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
  it("strips @ and URLs from Instagram handles and rejects junk", () => {
    expect(normalizeInstagram("@Blue.Belt_Media")).toBe("blue.belt_media");
    expect(normalizeInstagram("https://www.instagram.com/bluebelt/")).toBe("bluebelt");
    expect(normalizeInstagram("not a handle!")).toBeNull();
    expect(normalizeInstagram("")).toBeNull();
  });
});

describe("findOrCreatePerson", () => {
  it("matches by e-mail first and fills empty contact fields only", async () => {
    const existing = person({ phone: null, phone_key: null });
    const { client, inserts, updates } = fakeSupabase([existing]);
    const out = await findOrCreatePerson(client, OWNER, { fullName: "Different Name", email: "SARA@example.com ", phone: "+974 5555 9999", instagram: "@sara" });
    expect(out.ok && out.found.matchedBy).toBe("email");
    expect(inserts).toHaveLength(0);
    expect(updates[0]?.patch).toMatchObject({ phone: "+974 5555 9999", phone_key: "55559999", instagram: "sara" });
    expect(updates[0]?.patch).not.toHaveProperty("full_name");
  });

  it("matches by phone when the e-mail is unknown", async () => {
    const { client, inserts } = fakeSupabase([person()]);
    const out = await findOrCreatePerson(client, OWNER, { fullName: "Sara", email: "other@example.com", phone: "55551234" });
    expect(out.ok && out.found.matchedBy).toBe("phone");
    expect(inserts).toHaveLength(0);
  });

  it("untrusted (website) input matches by e-mail only and never rewrites an existing person", async () => {
    const existing = person({ email: null, email_key: null });
    const { client, inserts, updates } = fakeSupabase([existing]);
    // Same phone as the existing client, a stranger's e-mail: must NOT attach that e-mail.
    const out = await findOrCreatePerson(client, OWNER, { fullName: "Stranger", email: "stranger@example.com", phone: "+974 5555 1234" }, { trusted: false });
    expect(out.ok && out.found.created).toBe(true);
    expect(updates).toHaveLength(0);
    expect(inserts[0]).toMatchObject({ email: "stranger@example.com" });
    // An e-mail match is still honoured, but nothing is patched onto the row.
    const byEmail = await findOrCreatePerson(fakeSupabase([person()]).client, OWNER, { fullName: "X", email: "sara@example.com", instagram: "@new" }, { trusted: false });
    expect(byEmail.ok && byEmail.found.matchedBy).toBe("email");
  });

  it("creates a person with the owner id from the caller, never from the input", async () => {
    const { client, inserts } = fakeSupabase([]);
    const out = await findOrCreatePerson(client, OWNER, { fullName: "  New Client ", email: "new@example.com", phone: "+974 3333 4444", source: "website" });
    expect(out.ok && out.found.created).toBe(true);
    expect(inserts[0]).toMatchObject({ owner_id: OWNER, full_name: "New Client", email: "new@example.com", phone_key: "33334444", source: "website" });
  });
});
