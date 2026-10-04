import { parseQueue, type CoverageCommand } from "./coverage-queue";

/**
 * Browser persistence for the coverage command queue (localStorage) with a
 * subscribe API for useSyncExternalStore. Every change is written BEFORE the
 * caller continues, so a tap survives a closed tab or a dead network.
 */
export const COVERAGE_QUEUE_KEY = "bbm:coverage-commands:v1";

const listeners = new Set<() => void>();
let cache: { raw: string | null; queue: CoverageCommand[] } = { raw: null, queue: [] };

function readRaw(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(COVERAGE_QUEUE_KEY);
  } catch {
    return null;
  }
}

/** Snapshot (stable reference while the stored string is unchanged). */
export function readQueue(): CoverageCommand[] {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, queue: parseQueue(raw) };
  return cache.queue;
}

const EMPTY: CoverageCommand[] = [];
export function serverQueue(): CoverageCommand[] {
  return EMPTY;
}

export function writeQueue(queue: CoverageCommand[]): void {
  try {
    if (queue.length) window.localStorage.setItem(COVERAGE_QUEUE_KEY, JSON.stringify(queue));
    else window.localStorage.removeItem(COVERAGE_QUEUE_KEY);
  } catch {
    // Storage blocked: keep the in-memory copy so the UI still works this session.
    cache = { raw: JSON.stringify(queue), queue };
  }
  for (const l of listeners) l();
}

export function updateQueue(fn: (queue: CoverageCommand[]) => CoverageCommand[]): CoverageCommand[] {
  const next = fn(readQueue());
  writeQueue(next);
  return next;
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === COVERAGE_QUEUE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
