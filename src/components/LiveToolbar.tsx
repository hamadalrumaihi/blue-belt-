"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { formatAgo, secondsAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { RefreshButton } from "./RefreshButton";

type Props = {
  lastCheckedAt: string | null;
  refreshing: boolean;
  onRefreshAll: () => void;
  error?: string | null;
  trackedCount: number;
};

/** "Last checked: 12s ago" + auto-refresh toggle + Refresh All. */
export function LiveToolbar({ lastCheckedAt, refreshing, onRefreshAll, error, trackedCount }: Props) {
  const [settings, update] = useSettings();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  void tick;
  const ago = formatAgo(secondsAgo(lastCheckedAt));

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <p className="text-xs text-muted">
          Last checked: <span className="font-bold text-ink tabular-nums">{ago}</span>
          <span className="mx-1.5 text-line">·</span>
          {trackedCount} tracked
        </p>
        {error && <p className="mt-0.5 truncate text-xs font-semibold text-danger">{error}</p>}
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
      <RefreshButton onClick={onRefreshAll} loading={refreshing} label="Refresh all" variant="primary" disabled={!trackedCount} className="min-h-10 flex-1 sm:flex-none" />
    </div>
  );
}
