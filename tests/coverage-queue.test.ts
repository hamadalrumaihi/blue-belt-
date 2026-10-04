import { describe, expect, it } from "vitest";

import { applyAck, dismiss, displayedDone, enqueue, forceCommand, newCommand, parseQueue, prune, retryDelayMs, sendable } from "@/lib/offline/coverage-queue";

const NOW = new Date("2026-03-14T06:00:00.000Z");
const later = (s: number) => new Date(NOW.getTime() + s * 1000);
const A = "22222222-2222-4222-8222-000000000001";

describe("coverage command queue", () => {
  it("keeps one live command per athlete+kind: a newer tap replaces the older pending one", () => {
    let q = enqueue([], newCommand({ id: "c1", athleteId: A, coverageKind: "photo", done: true, expectedDoneAt: null, now: NOW }));
    q = enqueue(q, newCommand({ id: "c2", athleteId: A, coverageKind: "video", done: true, expectedDoneAt: null, now: later(1) }));
    q = enqueue(q, newCommand({ id: "c3", athleteId: A, coverageKind: "photo", done: false, expectedDoneAt: null, now: later(2) }));
    expect(q.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(sendable(q).map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("a late ack for a superseded command never removes or flips the newer one", () => {
    let q = enqueue([], newCommand({ id: "c1", athleteId: A, coverageKind: "photo", done: true, expectedDoneAt: null, now: NOW }));
    q = enqueue(q, newCommand({ id: "c2", athleteId: A, coverageKind: "photo", done: false, expectedDoneAt: null, now: later(1) }));
    const after = applyAck(q, "c1", { ok: true, state: "saved", doneAt: "2026-03-14T06:00:01.000Z" }, later(2));
    expect(after).toEqual(q);
    expect(displayedDone(after, A, "photo", null)).toMatchObject({ done: false, state: "pending" });
  });

  it("acks move commands to saved / failed / conflict and saved ones are pruned later", () => {
    let q = enqueue([], newCommand({ id: "c1", athleteId: A, coverageKind: "photo", done: true, expectedDoneAt: null, now: NOW }));
    q = applyAck(q, "c1", { ok: false, state: "failed", error: "offline", retryable: true }, later(1));
    expect(q[0]).toMatchObject({ state: "failed", attempts: 1, error: "offline" });
    expect(sendable(q)).toHaveLength(1);
    q = applyAck(q, "c1", { ok: true, state: "saved", doneAt: "x" }, later(2));
    expect(q[0]).toMatchObject({ state: "saved", attempts: 2, error: null });
    expect(sendable(q)).toHaveLength(0);
    expect(displayedDone(q, A, "photo", null)).toMatchObject({ done: true, state: "saved" });
    expect(prune(q, later(5))).toHaveLength(1);
    expect(prune(q, later(20))).toHaveLength(0);
    // Non-retryable failure (not assigned any more) is surfaced as a conflict, not retried forever.
    const q2 = applyAck(enqueue([], newCommand({ id: "c9", athleteId: A, coverageKind: "video", done: true, expectedDoneAt: null, now: NOW })), "c9", { ok: false, state: "failed", error: "not assigned", retryable: false }, later(1));
    expect(q2[0].state).toBe("conflict");
    expect(sendable(q2)).toHaveLength(0);
  });

  it("conflicts show the server state until the user forces or dismisses", () => {
    let q = enqueue([], newCommand({ id: "c1", athleteId: A, coverageKind: "photo", done: false, expectedDoneAt: "2026-03-14T05:00:00.000Z", now: NOW }));
    q = applyAck(q, "c1", { ok: false, state: "conflict", serverDoneAt: "2026-03-14T05:50:00.000Z", error: "changed elsewhere" }, later(1));
    expect(displayedDone(q, A, "photo", "2026-03-14T05:50:00.000Z")).toMatchObject({ done: true, state: "conflict" });
    const forced = forceCommand(q, "c1", later(2));
    expect(forced[0]).toMatchObject({ state: "pending", force: true, expectedDoneAt: "2026-03-14T05:50:00.000Z", error: null });
    expect(sendable(forced)).toHaveLength(1);
    expect(dismiss(q, "c1")).toEqual([]);
  });

  it("retry delay is bounded and the queue survives a round trip through storage", () => {
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(3)).toBe(8_000);
    expect(retryDelayMs(10)).toBe(60_000);
    const q = enqueue([], newCommand({ id: "c1", athleteId: A, coverageKind: "photo", done: true, expectedDoneAt: null, now: NOW }));
    expect(parseQueue(JSON.stringify(q))).toEqual(q);
    expect(parseQueue("{")).toEqual([]);
    expect(parseQueue(JSON.stringify([{ kind: "other" }, { ...q[0], coverageKind: "audio" }]))).toEqual([]);
  });
});
