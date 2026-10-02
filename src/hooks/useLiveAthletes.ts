"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { rankAthletes, type AthleteEta } from "@/lib/eta";
import type { AthleteWithMatches, HistoryEntry } from "@/lib/types";
import type { RefreshResult } from "@/lib/watch-service";
import { useNow } from "./useNow";
import { useSettings } from "./useSettings";

export type AthleteRefreshState = {
  loading: boolean;
  status: RefreshResult["status"] | null;
  code: string | null;
  message: string | null;
  checkedAt: string | null;
};

type Options = {
  initialAthletes: AthleteWithMatches[];
  initialHistory?: HistoryEntry[];
  /** Whether the auto-refresh loop runs on this screen. */
  autoRefresh?: boolean;
};

export type ConnectivityState = {
  offline: boolean;
  /** Consecutive failed batch calls; drives the backoff. */
  failures: number;
  /** ISO of the next scheduled automatic refresh, when the loop is on. */
  nextRefreshAt: string | null;
  /** Seconds the loop is currently waiting between refreshes (after backoff). */
  intervalSeconds: number;
  /** Another tab holds the refresh lock right now. */
  heldByOtherTab: boolean;
};

const EMPTY_HISTORY: HistoryEntry[] = [];
const LOCK_NAME = "bbm.refresh";
const LOCK_KEY = "bbm.refresh.lock.v1";
const LOCK_TTL_MS = 20_000;
const MAX_BACKOFF_SECONDS = 300;

/**
 * Owns the live client list for the Dashboard and Match Watcher:
 * - keeps athletes + matches in state
 * - refreshes one / all through POST /api/watch (server does the scraping)
 * - runs the auto-refresh loop with the user's interval
 * - pauses while offline and resumes when connectivity returns
 * - backs off after failed calls and honours 429 Retry-After
 * - lets only one tab run the automatic loop (Web Locks, localStorage fallback)
 * - exposes ranked athletes and a ticking `now` for countdowns
 */
export function useLiveAthletes({ initialAthletes, initialHistory = EMPTY_HISTORY, autoRefresh = true }: Options) {
  const [settings] = useSettings();
  const [athletes, setAthletes] = useState<AthleteWithMatches[]>(initialAthletes);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [states, setStates] = useState<Record<string, AthleteRefreshState>>(() => seedStates(initialAthletes));
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(() => latestChecked(initialAthletes));
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [retryAfterUntil, setRetryAfterUntil] = useState<number | null>(null);
  const [heldByOtherTab, setHeldByOtherTab] = useState(false);
  const inFlight = useRef(false);
  const now = useNow(5_000);
  const offline = useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);

  // A server re-render (navigation, revalidatePath) supplies fresh props:
  // adopt them during render (React's "derive state from props" pattern).
  const [seenAthletes, setSeenAthletes] = useState(initialAthletes);
  if (seenAthletes !== initialAthletes) {
    setSeenAthletes(initialAthletes);
    setAthletes(initialAthletes);
    setStates(seedStates(initialAthletes));
    setLastCheckedAt(latestChecked(initialAthletes));
  }
  const [seenHistory, setSeenHistory] = useState(initialHistory);
  if (seenHistory !== initialHistory) {
    setSeenHistory(initialHistory);
    setHistory(initialHistory);
  }

  const applyResults = useCallback((results: RefreshResult[]) => {
    setAthletes((prev) =>
      prev.map((a) => {
        const r = results.find((x) => x.athleteId === a.id);
        if (!r) return a;
        return {
          ...a,
          matches: r.matches,
          last_checked_at: r.checkedAt,
          last_attempt_at: r.health.lastAttemptAt ?? r.checkedAt,
          last_success_at: r.health.lastSuccessAt,
          consecutive_failures: r.health.consecutiveFailures,
          last_watch_status: r.status,
          last_watch_code: r.code,
          last_watch_message: r.message ?? null,
        };
      }),
    );
    setStates((prev) => {
      const next = { ...prev };
      for (const r of results) next[r.athleteId] = { loading: false, status: r.status, code: r.code, message: r.message ?? null, checkedAt: r.checkedAt };
      return next;
    });
    const newHistory: HistoryEntry[] = [];
    for (const r of results) {
      for (const c of r.changes) {
        newHistory.push({
          id: -Date.now() - newHistory.length,
          owner_id: "",
          match_id: c.match_id,
          change_type: c.change_type,
          old_value: c.old_value,
          new_value: c.new_value,
          detected_at: r.checkedAt,
          athlete_id: r.athleteId,
          athlete_name: r.athleteName,
          event_id: null,
        });
      }
    }
    if (newHistory.length) setHistory((prev) => [...newHistory, ...prev].slice(0, 300));
    const latest = results.map((r) => r.checkedAt).sort().at(-1);
    if (latest) setLastCheckedAt(latest);
  }, []);

  const refresh = useCallback(
    async (athleteIds?: string[]) => {
      const ids = athleteIds ?? athletes.filter((a) => a.active && a.source_url).map((a) => a.id);
      if (!ids.length || inFlight.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setGlobalError("You are offline. Showing the last known schedule.");
        return;
      }
      inFlight.current = true;
      setGlobalError(null);
      if (!athleteIds) setRefreshingAll(true);
      setStates((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { ...(prev[id] ?? emptyState()), loading: true };
        return next;
      });
      try {
        const res = await fetch("/api/watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ athleteIds: ids }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string; retryAfterSeconds?: number };
          if (res.status === 429) {
            const wait = payload.retryAfterSeconds ?? Number(res.headers.get("retry-after")) ?? 30;
            setRetryAfterUntil(Date.now() + Math.max(5, wait) * 1000);
          }
          throw new Error(payload.error ?? `Refresh failed (${res.status})`);
        }
        const payload = (await res.json()) as { results: RefreshResult[] };
        applyResults(payload.results);
        setFailures(0);
      } catch (err) {
        setFailures((n) => n + 1);
        setGlobalError(err instanceof Error ? err.message : "Refresh failed");
        setStates((prev) => {
          const next = { ...prev };
          // Keep the previous status/message: the last known data stays visible, only `loading` clears.
          for (const id of ids) next[id] = { ...(prev[id] ?? emptyState()), loading: false };
          return next;
        });
      } finally {
        inFlight.current = false;
        setRefreshingAll(false);
      }
    },
    [athletes, applyResults],
  );

  // Auto-refresh loop with backoff, offline pause and cross-tab guard.
  // The effect owns the timer and publishes "next refresh at" to a tiny
  // external store (effects may update external systems); render reads it
  // through useSyncExternalStore, so nothing impure runs during render.
  const enabled = autoRefresh && settings.autoRefreshEnabled;
  const baseInterval = Math.max(30, settings.autoRefreshSeconds);
  const intervalSeconds = Math.min(MAX_BACKOFF_SECONDS, baseInterval * 2 ** Math.min(failures, 4));
  const [armTick, setArmTick] = useState(0);
  const [nextStore] = useState(createArmStore);
  const nextRefreshAt = useSyncExternalStore(nextStore.subscribe, nextStore.get, () => null);

  useEffect(() => {
    const store = nextStore;
    if (!enabled || offline) {
      store.set(null);
      return;
    }
    const now = Date.now();
    const waitMs = Math.max(intervalSeconds * 1000, retryAfterUntil ? retryAfterUntil - now : 0);
    store.set(new Date(now + waitMs).toISOString());
    const id = window.setTimeout(() => {
      if (document.visibilityState !== "visible") {
        // Re-arm without refreshing; a hidden tab should not spend requests.
        setArmTick((t) => t + 1);
        return;
      }
      void withRefreshLock(async (acquired) => {
        setHeldByOtherTab(!acquired);
        if (acquired) await refresh();
        setArmTick((t) => t + 1);
      });
    }, waitMs);
    return () => window.clearTimeout(id);
    // lastCheckedAt re-arms the wait after a manual refresh; armTick after each automatic attempt.
  }, [enabled, offline, intervalSeconds, retryAfterUntil, refresh, lastCheckedAt, armTick, nextStore]);

  // Connectivity returned: refresh promptly (once) instead of waiting a full interval.
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      setFailures(0);
      setGlobalError(null);
      if (enabled) void withRefreshLock(async (acquired) => { if (acquired) await refresh(); });
    }
  }, [offline, enabled, refresh]);

  const ranked: AthleteEta[] = useMemo(() => rankAthletes(athletes, now ?? new Date(0)), [athletes, now]);
  const connectivity: ConnectivityState = { offline, failures, nextRefreshAt, intervalSeconds, heldByOtherTab };

  return { athletes, ranked, history, states, now, lastCheckedAt, refreshingAll, globalError, refresh, settings, connectivity };
}

function emptyState(): AthleteRefreshState {
  return { loading: false, status: null, code: null, message: null, checkedAt: null };
}

function seedStates(athletes: AthleteWithMatches[]): Record<string, AthleteRefreshState> {
  const out: Record<string, AthleteRefreshState> = {};
  for (const a of athletes) {
    out[a.id] = {
      loading: false,
      status: (a.last_watch_status as AthleteRefreshState["status"]) ?? null,
      code: a.last_watch_code ?? null,
      message: a.last_watch_message ?? null,
      checkedAt: a.last_checked_at ?? null,
    };
  }
  return out;
}

function latestChecked(athletes: AthleteWithMatches[]): string | null {
  return athletes.map((a) => a.last_checked_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Runs `fn(true)` while holding the cross-tab refresh lock, or `fn(false)`
 * immediately when another tab holds it. Uses the Web Locks API where
 * available and a localStorage lease elsewhere.
 */
export async function withRefreshLock(fn: (acquired: boolean) => Promise<void>): Promise<void> {
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      await fn(Boolean(lock));
    });
    return;
  }
  const tab = tabId();
  try {
    const raw = window.localStorage.getItem(LOCK_KEY);
    const lease = raw ? (JSON.parse(raw) as { tab: string; until: number }) : null;
    if (lease && lease.tab !== tab && lease.until > Date.now()) {
      await fn(false);
      return;
    }
    window.localStorage.setItem(LOCK_KEY, JSON.stringify({ tab, until: Date.now() + LOCK_TTL_MS }));
  } catch {
    /* storage unavailable: run without the guard */
  }
  try {
    await fn(true);
  } finally {
    try {
      const raw = window.localStorage.getItem(LOCK_KEY);
      if (raw && (JSON.parse(raw) as { tab: string }).tab === tab) window.localStorage.removeItem(LOCK_KEY);
    } catch {
      /* ignore */
    }
  }
}

type ArmStore = { get: () => string | null; set: (v: string | null) => void; subscribe: (cb: () => void) => () => void };

function createArmStore(): ArmStore {
  let value: string | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      if (v === value) return;
      value = v;
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

let cachedTabId: string | null = null;
function tabId(): string {
  if (cachedTabId) return cachedTabId;
  try {
    cachedTabId = window.sessionStorage.getItem("bbm.tab") ?? crypto.randomUUID();
    window.sessionStorage.setItem("bbm.tab", cachedTabId);
  } catch {
    cachedTabId = crypto.randomUUID();
  }
  return cachedTabId;
}
