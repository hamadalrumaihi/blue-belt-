import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A controllable fake of the user-scoped Supabase client.
let ownedCount = 0;
let collabRows: unknown[] = [];
const fakeClient = {
  from(_table: string) {
    return { select: async (_cols: string, _opts: unknown) => ({ count: ownedCount, error: null }) };
  },
  rpc: async (_name: string) => ({ data: collabRows, error: null }),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}), isServiceClientConfigured: () => false }));

import { resolveViewerMode } from "@/lib/collaborator";

beforeEach(() => {
  ownedCount = 0;
  collabRows = [];
});

describe("resolveViewerMode", () => {
  it("is owner when the user owns events, even if also invited elsewhere", async () => {
    ownedCount = 3;
    collabRows = [{ event_id: "e1" }];
    expect(await resolveViewerMode()).toEqual({ collaboratorOnly: false });
  });

  it("is collaborator-only when the user owns nothing but is a member somewhere", async () => {
    ownedCount = 0;
    collabRows = [{ event_id: "e1" }, { event_id: "e2" }];
    expect(await resolveViewerMode()).toEqual({ collaboratorOnly: true });
  });

  it("treats a brand-new user (no events, no memberships) as an owner", async () => {
    ownedCount = 0;
    collabRows = [];
    expect(await resolveViewerMode()).toEqual({ collaboratorOnly: false });
  });
});
