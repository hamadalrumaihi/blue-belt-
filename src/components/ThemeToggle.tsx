"use client";

import { useSyncExternalStore, type KeyboardEvent } from "react";
import {
  DARK_MEDIA_QUERY,
  nextThemePreference,
  readStoredTheme,
  resolveTheme,
  THEME_PREFERENCE_LABEL,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

/* ---------- tiny external store (one per tab, shared by every toggle) ---------- */

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    return readStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

/** Puts the resolved theme on <html>; the same thing the pre-paint script does. */
function applyTheme(pref: ThemePreference) {
  const theme = resolveTheme(pref, systemPrefersDark());
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function setPreference(pref: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Private mode or storage disabled: the choice still applies for this page.
  }
  applyTheme(pref);
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changed the preference.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
    applyTheme(readPreference());
    onChange();
  };
  // The device switched between light and dark while we follow "system".
  const onMedia = () => {
    if (readPreference() === "system") applyTheme("system");
  };
  window.addEventListener("storage", onStorage);
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia(DARK_MEDIA_QUERY);
    media.addEventListener("change", onMedia);
  } catch {
    media = null;
  }
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener("change", onMedia);
  };
}

const serverSnapshot = (): ThemePreference => "system";

/** The current preference, hydration-safe: "system" on the server and during hydration, then the stored value. */
export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const pref = useSyncExternalStore(subscribe, readPreference, serverSnapshot);
  return [pref, setPreference];
}

/* ---------- UI ---------- */

const ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

type Props = {
  /** `segmented`: three radio buttons (System / Light / Dark). `cycle`: one button that steps through them. */
  variant?: "segmented" | "cycle";
  /** Segmented only: show the text label next to each icon. */
  showLabels?: boolean;
  /** White-based styling for navy surfaces (sidebar). */
  onNavy?: boolean;
  className?: string;
  /** Accessible name for the group or the button; defaults to "Appearance". */
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

/**
 * Light / dark / system switch. Writes localStorage["bbm.theme"], applies
 * `data-theme` on <html> immediately and follows the device while on
 * "system". Renders "System" until mounted so server and client markup match.
 */
export function ThemeToggle({ variant = "segmented", showLabels = false, onNavy = false, className, "aria-label": ariaLabel, "aria-labelledby": labelledBy }: Props) {
  const [pref, setPref] = useThemePreference();
  const name = labelledBy ? undefined : (ariaLabel ?? "Appearance");

  if (variant === "cycle") {
    const next = nextThemePreference(pref);
    const Icon = ICON[pref];
    return (
      <button
        type="button"
        className={cn("btn-ghost min-h-11 w-11 px-0", onNavy && "text-white/80 hover:bg-white/10 hover:text-white", className)}
        onClick={() => setPref(next)}
        aria-label={`${name ?? "Appearance"}: ${THEME_PREFERENCE_LABEL[pref]}. Switch to ${THEME_PREFERENCE_LABEL[next].toLowerCase()}`}
        aria-labelledby={labelledBy}
        title={`Appearance: ${THEME_PREFERENCE_LABEL[pref]}`}
      >
        <Icon size={20} />
      </button>
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = THEME_PREFERENCES.indexOf(pref);
    let target: ThemePreference | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") target = THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") target = THEME_PREFERENCES[(i - 1 + THEME_PREFERENCES.length) % THEME_PREFERENCES.length];
    else if (e.key === "Home") target = THEME_PREFERENCES[0];
    else if (e.key === "End") target = THEME_PREFERENCES[THEME_PREFERENCES.length - 1];
    if (!target) return;
    e.preventDefault();
    setPref(target);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-pref="${target}"]`)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={name}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className={cn("inline-flex max-w-full rounded-xl border p-0.5", onNavy ? "border-white/15 bg-white/10" : "border-line bg-page", className)}
    >
      {THEME_PREFERENCES.map((p) => {
        const Icon = ICON[p];
        const checked = p === pref;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-pref={p}
            onClick={() => setPref(p)}
            title={showLabels ? undefined : THEME_PREFERENCE_LABEL[p]}
            className={cn(
              "inline-flex min-h-10 min-w-11 flex-1 items-center justify-center gap-1.5 rounded-[0.625rem] px-2.5 text-xs font-semibold transition-colors",
              onNavy
                ? checked
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
                : checked
                  ? "bg-surface text-primary shadow-sm ring-1 ring-line"
                  : "text-muted hover:text-ink",
            )}
          >
            <Icon size={18} />
            {showLabels ? <span>{THEME_PREFERENCE_LABEL[p]}</span> : <span className="sr-only">{THEME_PREFERENCE_LABEL[p]}</span>}
          </button>
        );
      })}
    </div>
  );
}
