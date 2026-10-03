import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(), isServiceClientConfigured: () => true }));
vi.mock("@/lib/watch-service", () => ({ refreshAthletes: vi.fn() }));

import { POST } from "@/app/api/cron/refresh/route";
import { resetRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { refreshAthletes } from "@/lib/watch-service";
import { athleteRow, eventRow } from "./helpers/rows";
import type { AthleteRow } from "@/lib/types";

const createServiceClientMock = vi.mocked(createServiceClient);
const refreshMock = vi.mocked(refreshAthletes);
const SECRET = "cron-secret-abcdefgh";

/**
 * In-memory fake of the service client modelling only what the cron route
 * uses: an events select, an eligible head-count, a keyset page over athletes
 * (eq/not/in/gt/order/limit) and a head-count after a cursor. `refreshAthletes`
 * mutates last_attempt_at on the rows it processes, so the test proves the
 * id-keyset pagination is unaffected by that mutation.
 */
function fakeService(athletes: AthleteRow[], events = [eventRow({ id: "33333333-3333-4333-8333-333333333333" })]) {
  const store = { athletes: athletes.map((a) => ({ ...a, event_id: events[0].id })) };

  function athletesQuery() {
    const filters: { gt?: string; head?: boolean } = {};
    let isCount = false;
    const chain: Record<string, unknown> = {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => { if (opts?.head) { isCount = true; filters.head = true; } return chain; },
      eq: () => chain,
      not: () => chain,
      in: () => chain,
      gt: (_col: string, val: string) => { filters.gt = val; return chain; },
      is: () => chain,
      order: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      limit: (n: number) => resolveRows(n),
      then: (res: (v: unknown) => void) => resolveCount().then(res),
    };
    function eligible() {
      const sorted = [...store.athletes].sort((a, b) => a.id.localeCompare(b.id));
      return filters.gt ? sorted.filter((a) => a.id > filters.gt!) : sorted;
    }
    function resolveRows(n: number) {
      const rows = eligible().slice(0, n);
      return Promise.resolve({ data: rows, error: null });
    }
    function resolveCount() {
      return Promise.resolve({ count: eligible().length, error: null, data: isCount ? null : eligible() });
    }
    return chain;
  }

  const client = {
    from: (table: string) => {
      if (table === "photo_events") {
        const chain: Record<string, unknown> = { select: () => chain, eq: () => chain, then: (r: (v: unknown) => void) => Promise.resolve({ data: events, error: null }).then(r) };
        return chain;
      }
      return athletesQuery();
    },
  };
  return { client: client as unknown as ReturnType<typeof createServiceClient>, store };
}

function post(body: unknown, secret = SECRET) {
  return POST(new Request("http://localhost/api/cron/refresh", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  resetRateLimits();
  process.env.CRON_SECRET = SECRET;
  refreshMock.mockReset();
});

describe("POST /api/cron/refresh pagination", () => {
  it("rejects a bad secret", async () => {
    const fake = fakeService([athleteRow()]);
    createServiceClientMock.mockReturnValue(fake.client);
    expect((await post({ all: true }, "wrong-secret-xxxxxxx")).status).toBe(401);
  });

  it("keyset on id survives refresh mutating last_attempt_at: no client skipped or repeated", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `22222222-2222-4222-8222-00000000000${i + 1}`);
    const athletes = ids.map((id, i) => athleteRow({ id, name: `A${i}`, last_attempt_at: null }));
    const fake = fakeService(athletes);
    createServiceClientMock.mockReturnValue(fake.client);

    // refreshAthletes stamps last_attempt_at = now on each processed row, which
    // under the OLD ordering would move it to the end and corrupt the cursor.
    refreshMock.mockImplementation(async (_c, slice) => {
      for (const a of slice) {
        const row = fake.store.athletes.find((r) => r.id === a.id);
        if (row) row.last_attempt_at = new Date().toISOString();
      }
      return slice.map((a) => ({ athleteId: a.id, athleteName: a.name, status: "OK" as const, code: "MATCHES_FOUND" as const, matches: [], changes: [], checkedAt: "t", sourceUrl: a.source_url, health: { lastAttemptAt: "t", lastSuccessAt: "t", consecutiveFailures: 0 }, ambiguous: 0 }));
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const res = await post({ all: true, limit: 2, cursor });
      const body = await res.json();
      // Record which ids this page processed (limit 2 each).
      const processedIds = refreshMock.mock.calls.flatMap((c) => (c[1] as AthleteRow[]).map((a) => a.id));
      refreshMock.mockClear();
      for (const id of processedIds) seen.push(id);
      cursor = body.cursor;
      if (!cursor) break;
    }

    // Every athlete processed exactly once across the sweep, in id order.
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(ids.length);
  });
});
