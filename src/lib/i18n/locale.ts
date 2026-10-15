/**
 * Public-site locale. Two languages, one offer: English and Arabic copy
 * describe the same catalog, policies and prices. Pure (no I/O): the server
 * reads the cookie / query and passes the locale down; client components
 * receive it as a prop. Owned by the public content workstream; other
 * modules only import the types and `localized()`.
 */
export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Cookie that remembers the visitor's choice (public site only; never read in the studio). */
export const LOCALE_COOKIE = "bbm_lang";
/** Query parameter that switches and persists the language: `/services?lang=ar`. */
export const LOCALE_QUERY = "lang";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Query wins over the cookie; anything unknown falls back to English. */
export function resolveLocale(query: string | null | undefined, cookie: string | null | undefined): Locale {
  if (isLocale(query)) return query;
  if (isLocale(cookie)) return cookie;
  return DEFAULT_LOCALE;
}

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Bilingual value: English is required, Arabic optional and falls back to English so a missing translation never blanks a page. */
export type Bilingual<T = string> = { en: T; ar?: T };

export function localized<T>(value: Bilingual<T>, locale: Locale): T {
  return locale === "ar" && value.ar !== undefined ? value.ar : value.en;
}
