"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { applyCoverageCommand } from "@/lib/actions/coverage";
import { applyAck, dismiss, enqueue, forceCommand, newCommand, prune, retryDelayMs, sendable, type CommandAck, type CoverageCommand, type CoverageKind } from "@/lib/offline/coverage-queue";
import { readQueue, serverQueue, subscribeQueue, updateQueue } from "@/lib/offline/coverage-store";

/**
 * The coverage command queue for this browser: persisted desired-state
 * commands plus a sync loop that replays them one at a time through the
 * server action whenever the browser is online. A command is deleted only
 * after the server acknowledged THAT command id (see coverage-queue.ts).
 */
let syncing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function syncOnce(): Promise<void> {
  if (syncing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  syncing = true;
  try {
    for (;;) {
      const next = sendable(readQueue())[0];
      if (!next) break;
      // Respect the retry delay of a failed command.
      if (next.state === "failed" && next.attempts > 0) {
        const wait = retryDelayMs(next.attempts);
        const since = Date.now() - new Date(next.createdAt).getTime();
        if (since < wait) {
          schedule(wait - since);
          break;
        }
      }
      let ack: CommandAck;
      try {
        const res = await applyCoverageCommand({ commandId: next.id, athleteId: next.athleteId, kind: next.coverageKind, done: next.done, expectedDoneAt: next.expectedDoneAt, force: next.force });
        ack = res.ok ? { ok: true, state: "saved", doneAt: res.doneAt } : res.state === "conflict" ? { ok: false, state: "conflict", serverDoneAt: res.serverDoneAt, error: res.error } : { ok: false, state: "failed", error: res.error, retryable: res.retryable };
      } catch (err) {
        ack = { ok: false, state: "failed", error: err instanceof Error ? err.message : "Network problem", retryable: true };
      }
      updateQueue((q) => prune(applyAck(q, next.id, ack, new Date()), new Date()));
      if (!ack.ok && ack.state === "failed") {
        schedule(retryDelayMs(next.attempts + 1));
        break;
      }
    }
  } finally {
    syncing = false;
  }
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncOnce();
  }, ms);
}

export function useCoverageQueue() {
  const queue = useSyncExternalStore(subscribeQueue, readQueue, serverQueue);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void syncOnce();
    const onOnline = () => void syncOnce();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncOnce();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const sweep = setInterval(() => updateQueue((q) => prune(q, new Date())), 5_000);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(sweep);
    };
  }, []);

  const setDone = useCallback((athleteId: string, coverageKind: CoverageKind, done: boolean, expectedDoneAt: string | null) => {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    updateQueue((q) => enqueue(q, newCommand({ id, athleteId, coverageKind, done, expectedDoneAt, now: new Date() })));
    void syncOnce();
  }, []);

  const resolveConflict = useCallback((command: CoverageCommand, choice: "mine" | "theirs") => {
    updateQueue((q) => (choice === "mine" ? forceCommand(q, command.id, new Date()) : dismiss(q, command.id)));
    void syncOnce();
  }, []);

  const retryNow = useCallback(() => void syncOnce(), []);

  return { queue, setDone, resolveConflict, retryNow };
}
