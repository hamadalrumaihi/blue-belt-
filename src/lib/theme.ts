/**
 * Light / dark / system theme. Pure helpers shared by the toggle, the root
 * layout's pre-paint script and the tests. No React, no DOM access here.
 *
 * The resolved theme lands on <html data-theme="light|dark">; globals.css
 * redefines the colour tokens under `:root[data-theme="dark"]`, so every
 * `bg-page`, `text-ink`, `border-line` utility follows automatically.
 */
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "bbm.theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];
export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Resolve the stored preference against the device setting. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}

/** Anything that is not exactly "light" or "dark" means "follow the system". */
export function readStoredTheme(raw: unknown): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** The next preference when a single button cycles System -> Light -> Dark. */
export function nextThemePreference(pref: ThemePreference): ThemePreference {
  const i = THEME_PREFERENCES.indexOf(pref);
  return THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length];
}

export const THEME_PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * Inline script for <head>: applies the theme before first paint so a dark
 * device never flashes a white page. Our own constant, no user content.
 * Mirrors resolveTheme/readStoredTheme; everything is wrapped in try/catch
 * because localStorage can throw (private mode, blocked storage).
 */
export const THEME_INIT_SCRIPT = [
  "(function(){try{",
  `var s=null;try{s=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});}catch(e){}`,
  "var t=s==='light'||s==='dark'?s:null;",
  `if(!t){var m=window.matchMedia&&window.matchMedia(${JSON.stringify(DARK_MEDIA_QUERY)});t=m&&m.matches?'dark':'light';}`,
  "var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;",
  "}catch(e){}})();",
].join("");
