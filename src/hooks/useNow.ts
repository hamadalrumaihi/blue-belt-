"use client";

import { useSyncExternalStore } from "react";

/**
 * A ticking clock for countdowns, implemented as an external store so the
 * server snapshot is `null` (no hydration drift) and the client re-renders
 * every `intervalMs`.
 */
const listeners = new Map<number, Set<() => void>>();
const timers = new Map<number, number>();
let current = Date.now();

function subscribeFor(intervalMs: number) {
  return (listener: () => void) => {
    let set = listeners.get(intervalMs);
    if (!set) {
      set = new Set();
      listeners.set(intervalMs, set);
    }
    set.add(listener);
    if (!timers.has(intervalMs)) {
      timers.set(
        intervalMs,
        window.setInterval(() => {
          current = Date.now();
          listeners.get(intervalMs)?.forEach((l) => l());
        }, intervalMs),
      );
    }
    // Fire once so the first client render after hydration shows a real time.
    queueMicrotask(() => {
      current = Date.now();
      listener();
    });
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        const t = timers.get(intervalMs);
        if (t !== undefined) window.clearInterval(t);
        timers.delete(intervalMs);
        listeners.delete(intervalMs);
      }
    };
  };
}

const subscribers = new Map<number, ReturnType<typeof subscribeFor>>();

function getSnapshot() {
  return current;
}

function getServerSnapshot() {
  return 0;
}

export function useNow(intervalMs = 10_000): Date | null {
  let subscribe = subscribers.get(intervalMs);
  if (!subscribe) {
    subscribe = subscribeFor(intervalMs);
    subscribers.set(intervalMs, subscribe);
  }
  const ms = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return ms ? new Date(ms) : null;
}
