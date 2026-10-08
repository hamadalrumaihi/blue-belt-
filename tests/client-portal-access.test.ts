import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Who can see which booking in the client portal. Access comes from the
 * signed-in user's e-mail (verified by the auth provider) matching a
 * person row, which the portal links on first sign-in. A booking reference
 * on its own never grants anything.
 */
type Row = Record<string, unknown>;
const people: Row[] = [];
const peopleView: Row[] = [];
const serviceUpdates: Array<{ patch: Row; filters: Array<[string, unknown]> }> = [];
let serviceConfigured = true;

function userClient() {
  return {
    from: (table: string) => ({
      select: () => ({
        order: async () => ({ data: table === "photo_client_people_v" ? peopleView.slice() : [], error: null }),
      }),
    }),
  };
}

function serviceClient() {
  return {
    from: () => ({
      update: (patch: Row) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          is: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
          eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
          select: async () => {
            serviceUpdates.push({ patch, filters });
            const key = filters.find(([k]) => k === "email_key")?.[1];
            const hits = people.filter((p) => p.email_key === key && p.user_id === null);
            for (const h of hits) { Object.assign(h, patch); peopleView.push({ ...h }); }
            return { data: hits.map((h) => ({ id: h.id })), error: null };
          },
        };
        return chain;
      },
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => userClient()) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(() => serviceClient()), isServiceClientConfigured: () => serviceConfigured }));

import { loadMyPeople } from "@/lib/client-portal/queries";

const USER = "703c69b4-323b-4cd2-b432-e042f375043d";

beforeEach(() => {
  people.length = 0;
  peopleView.length = 0;
  serviceUpdates.length = 0;
  serviceConfigured = true;
  people.push({ id: "p-owner", email_key: "client@example.com", user_id: null, full_name: "Booked Client" });
  people.push({ id: "p-other", email_key: "someone-else@example.com", user_id: null, full_name: "Other Person" });
});

describe("loadMyPeople", () => {
  it("links the person whose e-mail matches the signed-in user and returns only that person", async () => {
    const out = await loadMyPeople(USER, "Client@Example.com");
    expect(out.map((p) => p.id)).toEqual(["p-owner"]);
    expect(people.find((p) => p.id === "p-owner")?.user_id).toBe(USER);
    expect(people.find((p) => p.id === "p-other")?.user_id).toBeNull();
    // The link is keyed on the verified e-mail only and never re-assigns an already linked person.
    expect(serviceUpdates[0]?.filters).toEqual([["user_id", null], ["email_key", "client@example.com"]]);
  });

  it("returns nothing for an e-mail with no person row, so no booking is ever visible by reference alone", async () => {
    const out = await loadMyPeople(USER, "stranger@example.com");
    expect(out).toEqual([]);
    expect(people.every((p) => p.user_id === null)).toBe(true);
  });

  it("returns nothing when the sign-in has no e-mail or the server is not configured to link", async () => {
    expect(await loadMyPeople(USER, null)).toEqual([]);
    serviceConfigured = false;
    expect(await loadMyPeople(USER, "client@example.com")).toEqual([]);
    expect(serviceUpdates).toHaveLength(0);
  });

  it("reads already linked people through the client view without touching the service client", async () => {
    peopleView.push({ id: "p-owner", email_key: "client@example.com", user_id: USER, full_name: "Booked Client" });
    const out = await loadMyPeople(USER, "client@example.com");
    expect(out.map((p) => p.id)).toEqual(["p-owner"]);
    expect(serviceUpdates).toHaveLength(0);
  });
});
