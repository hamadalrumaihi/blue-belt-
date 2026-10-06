import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A controllable fake of the user-scoped Supabase client.
let ownedCount: number | null = 0;
let collabRows: unknown[] | null = [];
let ownedError: { message: string } | null = null;
let collabError: { message: string } | null = null;
const fakeClient = {
  from() {
    return { select: async () => ({ count: ownedCount, error: ownedError }) };
  },
  rpc: async () => ({ data: collabRows, error: collabError }),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}), isServiceClientConfigured: () => false }));

import { resolveViewerMode } from "@/lib/collaborator";

beforeEach(() => {
  ownedCount = 0;
  collabRows = [];
  ownedError = null;
  collabError = null;
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

  it("fails open to the owner nav when either lookup errors", async () => {
    collabRows = [{ event_id: "e1" }];
    ownedCount = null;
    ownedError = { message: "timeout" };
    expect(await resolveViewerMode()).toEqual({ collaboratorOnly: false });
    ownedError = null;
    ownedCount = 0;
    collabRows = null;
    collabError = { message: "rpc down" };
    expect(await resolveViewerMode()).toEqual({ collaboratorOnly: false });
  });
});
