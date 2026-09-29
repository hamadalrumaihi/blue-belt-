import type { Platform } from "./types";
import { DEFAULT_TIMEZONE } from "./time";

/**
 * Per-device preferences, stored in localStorage. These are operational
 * conveniences (refresh cadence, which event is pinned), not tournament data,
 * so they intentionally live outside Supabase for V1.
 */
export type NotificationPrefs = {
  m30: boolean;
  m15: boolean;
  m5: boolean;
  matChange: boolean;
  timeChange: boolean;
};

export type Settings = {
  timezone: string;
  autoRefreshSeconds: number;
  autoRefreshEnabled: boolean;
  defaultPlatform: Platform;
  showCompleted: boolean;
  currentEventId: string | null;
  notifications: NotificationPrefs;
};

export const DEFAULT_SETTINGS: Settings = {
  timezone: DEFAULT_TIMEZONE,
  autoRefreshSeconds: 60,
  autoRefreshEnabled: true,
  defaultPlatform: "AJP",
  showCompleted: true,
  currentEventId: null,
  notifications: { m30: true, m15: true, m5: true, matChange: true, timeChange: true },
};

export const REFRESH_INTERVAL_OPTIONS = [30, 45, 60, 90, 120, 180] as const;
export const MIN_REFRESH_SECONDS = 30;

const KEY = "bbm.settings.v1";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    cache = DEFAULT_SETTINGS;
  }
  return cache;
}

function sanitize(input: unknown): Settings {
  const s = (input && typeof input === "object" ? input : {}) as Partial<Settings>;
  const seconds = Number(s.autoRefreshSeconds);
  return {
    timezone: typeof s.timezone === "string" && s.timezone ? s.timezone : DEFAULT_SETTINGS.timezone,
    autoRefreshSeconds: Number.isFinite(seconds) ? Math.max(MIN_REFRESH_SECONDS, Math.round(seconds)) : DEFAULT_SETTINGS.autoRefreshSeconds,
    autoRefreshEnabled: typeof s.autoRefreshEnabled === "boolean" ? s.autoRefreshEnabled : DEFAULT_SETTINGS.autoRefreshEnabled,
    defaultPlatform: s.defaultPlatform === "AJP" || s.defaultPlatform === "SMOOTHCOMP" || s.defaultPlatform === "OTHER" ? s.defaultPlatform : DEFAULT_SETTINGS.defaultPlatform,
    showCompleted: typeof s.showCompleted === "boolean" ? s.showCompleted : DEFAULT_SETTINGS.showCompleted,
    currentEventId: typeof s.currentEventId === "string" ? s.currentEventId : null,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(s.notifications ?? {}) },
  };
}

export function getSettings(): Settings {
  return read();
}

export function getServerSettings(): Settings {
  return DEFAULT_SETTINGS;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = sanitize({ ...read(), ...patch });
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage disabled: keep the in-memory copy.
  }
  listeners.forEach((l) => l());
  return next;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
