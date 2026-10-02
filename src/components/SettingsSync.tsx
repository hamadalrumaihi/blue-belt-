"use client";

import { useEffect, useRef } from "react";
import { loadUserSettings, saveUserSettings } from "@/lib/actions/settings";
import { getSettings, replaceSettings, subscribeSettings, type Settings } from "@/lib/settings";

const SYNC_KEY = "bbm.settings.syncedAt.v1";
const SAVE_DEBOUNCE_MS = 1_200;

/**
 * Keeps the per-device settings cache and the account copy in sync:
 * - on mount, loads the account copy and adopts it when it is newer than
 *   the last sync on this device (so a fresh device inherits preferences)
 * - afterwards, debounces local changes into saveUserSettings
 * Rendered once in the app layout; it draws nothing.
 */
export function SettingsSync() {
  const skipNext = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snapshot = await loadUserSettings().catch(() => null);
      if (cancelled || !snapshot) return;
      const syncedAt = readSyncedAt();
      if (snapshot.updatedAt && (!syncedAt || snapshot.updatedAt > syncedAt)) {
        skipNext.current = true;
        replaceSettings(snapshot.settings);
        writeSyncedAt(snapshot.updatedAt);
      } else if (!snapshot.updatedAt) {
        // No account copy yet: seed it from this device.
        void persist(getSettings());
      }
    })();
    const unsubscribe = subscribeSettings(() => {
      if (skipNext.current) {
        skipNext.current = false;
        return;
      }
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void persist(getSettings()), SAVE_DEBOUNCE_MS);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return null;
}

async function persist(settings: Settings) {
  const res = await saveUserSettings(settings).catch(() => ({ ok: false }));
  if (res.ok) writeSyncedAt(new Date().toISOString());
}

function readSyncedAt(): string | null {
  try {
    return window.localStorage.getItem(SYNC_KEY);
  } catch {
    return null;
  }
}

function writeSyncedAt(iso: string) {
  try {
    window.localStorage.setItem(SYNC_KEY, iso);
  } catch {
    /* ignore */
  }
}
