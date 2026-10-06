import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwnedAthlete, requireOwnedEvent } from "@/lib/authz";
import type { Database } from "@/lib/supabase/database.types";

/**
 * A one-shot fake of the Supabase query chain used by authz:
 *   from(table).select(cols).eq(col, val).maybeSingle() -> { data, error }
 * It records which table/column/value were queried so each test can assert the
 * boundary hits the right row, and returns the scripted outcome.
 */
function fakeClient(outcome: { data: unknown; error: { message: string } | null }) {
  const calls: { table?: string; select?: string; eqCol?: string; eqVal?: unknown } = {};
  const client = {
    from(table: string) {
      calls.table = table;
      return {
        select(cols: string) {
          calls.select = cols;
          return {
            eq(col: string, val: unknown) {
              calls.eqCol = col;
              calls.eqVal = val;
              return { maybeSingle: async () => outcome };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("requireOwnedEvent", () => {
  it("returns the owner id when the event is found", async () => {
    const { client, calls } = fakeClient({ data: { owner_id: "owner-1" }, error: null });
    const result = await requireOwnedEvent(client, "event-9");
    expect(result).toEqual({ ok: true, ownerId: "owner-1" });
    expect(calls).toMatchObject({ table: "photo_events", eqCol: "id", eqVal: "event-9" });
  });

  it("returns a not-found error when no row matches (RLS hid it or it is gone)", async () => {
    const { client } = fakeClient({ data: null, error: null });
    const result = await requireOwnedEvent(client, "event-x");
    expect(result).toEqual({ ok: false, error: "Event not found or you do not have access to it." });
  });

  it("surfaces a database error distinctly from not-found", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    const result = await requireOwnedEvent(client, "event-x");
    expect(result).toEqual({ ok: false, error: "Could not verify the event: boom" });
  });
});

describe("requireOwnedAthlete", () => {
  it("returns owner id and event id when the athlete is found", async () => {
    const { client, calls } = fakeClient({ data: { owner_id: "owner-2", event_id: "event-3" }, error: null });
    const result = await requireOwnedAthlete(client, "ath-7");
    expect(result).toEqual({ ok: true, ownerId: "owner-2", eventId: "event-3" });
    expect(calls).toMatchObject({ table: "photo_athletes", select: "owner_id,event_id", eqCol: "id", eqVal: "ath-7" });
  });

  it("carries a null event id through", async () => {
    const { client } = fakeClient({ data: { owner_id: "owner-2", event_id: null }, error: null });
    const result = await requireOwnedAthlete(client, "ath-7");
    expect(result).toEqual({ ok: true, ownerId: "owner-2", eventId: null });
  });

  it("returns a not-found error when no row matches", async () => {
    const { client } = fakeClient({ data: null, error: null });
    const result = await requireOwnedAthlete(client, "ath-x");
    expect(result).toEqual({ ok: false, error: "Client not found or you do not have access to it." });
  });

  it("surfaces a database error distinctly from not-found", async () => {
    const { client } = fakeClient({ data: null, error: { message: "db down" } });
    const result = await requireOwnedAthlete(client, "ath-x");
    expect(result).toEqual({ ok: false, error: "Could not verify the client: db down" });
  });
});
