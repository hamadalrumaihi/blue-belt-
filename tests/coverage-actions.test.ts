import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser } })) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { assignCoverage, inviteCollaborator, removeCollaborator, setCoverageDone } from "@/lib/actions/coverage";

const ATH = "22222222-2222-4222-8222-222222222222";
const EV = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("coverage action input guards (no DB access past validation)", () => {
  it("setCoverageDone rejects a bad id or kind", async () => {
    expect(await setCoverageDone("nope", "photo", true)).toMatchObject({ ok: false });
    expect(await setCoverageDone(ATH, "audio" as "photo", true)).toMatchObject({ ok: false, error: expect.stringMatching(/kind/i) });
  });

  it("assignCoverage rejects a bad client id", async () => {
    expect(await assignCoverage("nope", {})).toMatchObject({ ok: false });
  });

  it("inviteCollaborator validates event, email and role", async () => {
    expect(await inviteCollaborator("nope", "a@b.com", "photographer")).toMatchObject({ ok: false, error: expect.stringMatching(/event/i) });
    expect(await inviteCollaborator(EV, "notanemail", "photographer")).toMatchObject({ ok: false, error: expect.stringMatching(/email/i) });
    expect(await inviteCollaborator(EV, "a@b.com", "boss" as "photographer")).toMatchObject({ ok: false, error: expect.stringMatching(/role/i) });
  });

  it("removeCollaborator validates ids", async () => {
    expect(await removeCollaborator("nope", "nope")).toMatchObject({ ok: false });
  });

  it("all actions refuse when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await setCoverageDone(ATH, "photo", true)).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
    expect(await assignCoverage(ATH, { photographerId: null })).toMatchObject({ ok: false, error: expect.stringMatching(/signed out/i) });
  });
});
