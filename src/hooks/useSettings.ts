"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getServerSettings, getSettings, subscribeSettings, updateSettings, type Settings } from "@/lib/settings";

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getServerSettings);
  const update = useCallback((patch: Partial<Settings>) => {
    updateSettings(patch);
  }, []);
  return [settings, update];
}
