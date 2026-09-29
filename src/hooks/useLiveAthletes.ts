"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rankAthletes, type AthleteEta } from "@/lib/eta";
import type { AthleteWithMatches, HistoryEntry } from "@/lib/types";
import type { RefreshResult } from "@/lib/watch-service";
import { useNow } from "./useNow";
import { useSettings } from "./useSettings";

export type AthleteRefreshState = {
  loading: boolean;
  status: RefreshResult["status"] | null;
  message: string | null;
  checkedAt: string | null;
};

type Options = {
  initialAthletes: AthleteWithMatches[];
  initialHistory?: HistoryEntry[];
  /** Whether the auto-refresh loop runs on this screen. */
  autoRefresh?: boolean;
};

/**
 * Owns the live client list for the Dashboard and Match Watcher:
 * - keeps athletes + matches in state
 * - refreshes one / all through POST /api/watch (server does the scraping)
 * - runs the auto-refresh loop with the user's interval
 * - exposes ranked athletes and a ticking `now` for countdowns
 */
const EMPTY_HISTORY: HistoryEntry[] = [];

export function useLiveAthletes({ initialAthletes, initialHistory = EMPTY_HISTORY, autoRefresh = true }: Options) {
  const [settings] = useSettings();
  const [athletes, setAthletes] = useState<AthleteWithMatches[]>(initialAthletes);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [states, setStates] = useState<Record<string, AthleteRefreshState>>(() => seedStates(initialAthletes));
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(() => latestChecked(initialAthletes));
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const now = useNow(5_000);

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
        return r ? { ...a, matches: r.matches, last_checked_at: r.checkedAt, last_watch_status: r.status, last_watch_message: r.message ?? null } : a;
      }),
    );
    setStates((prev) => {
      const next = { ...prev };
      for (const r of results) next[r.athleteId] = { loading: false, status: r.status, message: r.message ?? null, checkedAt: r.checkedAt };
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
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Refresh failed (${res.status})`);
        }
        const payload = (await res.json()) as { results: RefreshResult[] };
        applyResults(payload.results);
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : "Refresh failed");
        setStates((prev) => {
          const next = { ...prev };
          for (const id of ids) next[id] = { ...(prev[id] ?? emptyState()), loading: false, status: "ERROR", message: "Unable to refresh" };
          return next;
        });
      } finally {
        inFlight.current = false;
        setRefreshingAll(false);
      }
    },
    [athletes, applyResults],
  );

  // Auto-refresh loop.
  const enabled = autoRefresh && settings.autoRefreshEnabled;
  const interval = Math.max(30, settings.autoRefreshSeconds) * 1000;
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, interval);
    return () => window.clearInterval(id);
  }, [enabled, interval, refresh]);

  const ranked: AthleteEta[] = useMemo(() => rankAthletes(athletes, now ?? new Date(0)), [athletes, now]);

  return { athletes, ranked, history, states, now, lastCheckedAt, refreshingAll, globalError, refresh, settings };
}

function emptyState(): AthleteRefreshState {
  return { loading: false, status: null, message: null, checkedAt: null };
}

function seedStates(athletes: AthleteWithMatches[]): Record<string, AthleteRefreshState> {
  const out: Record<string, AthleteRefreshState> = {};
  for (const a of athletes) {
    out[a.id] = {
      loading: false,
      status: (a.last_watch_status as AthleteRefreshState["status"]) ?? null,
      message: a.last_watch_message ?? null,
      checkedAt: a.last_checked_at ?? null,
    };
  }
  return out;
}

function latestChecked(athletes: AthleteWithMatches[]): string | null {
  return athletes.map((a) => a.last_checked_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
}
