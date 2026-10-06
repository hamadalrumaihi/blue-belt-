"use client";

import { useEffect, useState } from "react";
import type { ConnectivityState } from "@/hooks/useLiveAthletes";
import { useSettings } from "@/hooks/useSettings";
import { formatAgo, formatIn, secondsAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { RefreshButton } from "./RefreshButton";

type Props = {
  lastCheckedAt: string | null;
  refreshing: boolean;
  onRefreshAll: () => void;
  error?: string | null;
  trackedCount: number;
  connectivity?: ConnectivityState;
};

/** "Last check 12s ago · Next in 48s" + auto-refresh toggle + Refresh All. */
export function LiveToolbar({ lastCheckedAt, refreshing, onRefreshAll, error, trackedCount, connectivity }: Props) {
  const [settings, update] = useSettings();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  void tick;
  const ago = formatAgo(secondsAgo(lastCheckedAt));
  const next = connectivity?.nextRefreshAt ? formatIn(connectivity.nextRefreshAt) : null;
  const schedule = !settings.autoRefreshEnabled
    ? "Auto-refresh off"
    : connectivity?.offline
      ? "Paused while offline"
      : connectivity?.heldByOtherTab
        ? "Another tab is checking"
        : next
          ? `Next check ${next}`
          : null;

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <p className="flex flex-wrap gap-x-1.5 text-xs text-muted">
          <span>Last check <span className="font-bold text-ink tabular-nums">{ago}</span></span>
          {schedule && <><span className="text-line" aria-hidden>·</span><span className="tabular-nums">{schedule}</span></>}
          <span className="text-line" aria-hidden>·</span>
          <span>{trackedCount} tracked</span>
        </p>
        {connectivity?.offline ? (
          <p className="mt-0.5 text-xs font-semibold text-danger" role="status">Offline: showing the last confirmed schedule. Checks resume when you are back online.</p>
        ) : error ? (
          <p className="mt-0.5 break-words text-xs font-semibold text-danger" role="status">{error.replace(/\.$/, "")}{connectivity && connectivity.failures > 1 ? ` · retrying every ${connectivity.intervalSeconds}s` : ""}. Your last confirmed schedule is kept.</p>
        ) : connectivity?.heldByOtherTab ? (
          <p className="mt-0.5 text-xs text-muted" role="status">Another tab is refreshing; this one follows.</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={settings.autoRefreshEnabled}
        onClick={() => update({ autoRefreshEnabled: !settings.autoRefreshEnabled })}
        className={cn("flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold", settings.autoRefreshEnabled ? "border-success/30 bg-success-soft text-success" : "border-line bg-white text-muted")}
      >
        <span className={cn("relative inline-block h-2 w-2 rounded-full bg-current", settings.autoRefreshEnabled && "live-dot")} />
        Auto {settings.autoRefreshEnabled ? `${settings.autoRefreshSeconds}s` : "off"}
      </button>
      <RefreshButton onClick={onRefreshAll} loading={refreshing} label={error ? "Retry all" : "Refresh all"} variant="primary" disabled={!trackedCount || Boolean(connectivity?.offline)} className="min-h-10 flex-1 sm:flex-none" />
    </div>
  );
}
