"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppAlert } from "@/lib/notifications/types";
import { AlertIcon, CloseIcon } from "./icons";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "bbm.dismissedAlerts.v1";
const EMPTY: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
let cache: ReadonlySet<string> | null = null;

function readDismissed(): ReadonlySet<string> {
  if (cache) return cache;
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    cache = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function dismissAlert(id: string) {
  const next = new Set(readDismissed());
  next.add(id);
  cache = next;
  try {
    window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  } catch {
    /* private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const LEVEL: Record<AppAlert["level"], string> = {
  danger: "bg-danger text-white",
  warning: "bg-warning text-white",
  info: "bg-primary text-white",
};

/**
 * Strong in-app alert banners for thresholds and detected changes.
 *
 * Alert ids encode the threshold (`m15:<match>`), so a client crossing from
 * 30 → 15 → 5 minutes produces three distinct alerts and each one is
 * announced exactly once; staying inside a threshold re-renders the same id
 * and announces nothing. Danger alerts use an assertive live region, the
 * rest a polite one, and the visual list itself is not a live region so
 * screen readers are not flooded on every countdown tick.
 */
export function AlertBanners({ alerts, max = 3 }: { alerts: AppAlert[]; max?: number }) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => EMPTY);
  const visible = alerts.filter((a) => !dismissed.has(a.id)).slice(0, max);
  const announced = useRef<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState<{ assertive: string; polite: string }>({ assertive: "", polite: "" });

  useEffect(() => {
    const fresh = alerts.filter((a) => !announced.current.has(a.id) && !dismissed.has(a.id));
    if (!fresh.length) return;
    for (const a of fresh) announced.current.add(a.id);
    const danger = fresh.filter((a) => a.level === "danger");
    const calm = fresh.filter((a) => a.level !== "danger");
    setAnnouncement({
      assertive: danger.map((a) => `${a.title}. ${a.body}`).join(" "),
      polite: calm.map((a) => `${a.title}. ${a.body}`).join(" "),
    });
  }, [alerts, dismissed]);

  return (
    <>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{announcement.assertive}</div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement.polite}</div>
      {visible.length > 0 && (
        <ul className="space-y-2" aria-label="Alerts">
          {visible.map((a) => (
            <li key={a.id} className={cn("flex items-center gap-3 rounded-2xl px-4 py-3 shadow-card", LEVEL[a.level])}>
              <AlertIcon className="shrink-0" />
              <Link href={a.athleteId ? `/clients/${a.athleteId}` : "/watcher"} className="min-w-0 flex-1 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                <p className="truncate text-sm font-extrabold uppercase tracking-wide">{a.title}</p>
                <p className="truncate text-xs opacity-90">{a.body}</p>
              </Link>
              <button type="button" onClick={() => dismissAlert(a.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label={`Dismiss alert: ${a.title}`}>
                <CloseIcon size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
