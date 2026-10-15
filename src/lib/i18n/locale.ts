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

/** The language a switch should offer next to the current one. */
export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

/** Native-script names for the language switch (each language names itself). */
export const LOCALE_LABEL: Record<Locale, string> = { en: "English", ar: "العربية" };

/** BCP 47 tags for `<html lang>` and Open Graph locale. */
export const LOCALE_TAG: Record<Locale, string> = { en: "en", ar: "ar" };
export const OG_LOCALE: Record<Locale, string> = { en: "en_QA", ar: "ar_QA" };

/**
 * The link that switches language and keeps the visitor on the same page:
 * `?lang=ar` is turned into the cookie by the proxy, which then redirects
 * back to the same URL without the parameter, so canonical URLs never carry
 * a language.
 */
export function langSwitchHref(pathname: string, search: string | null | undefined, locale: Locale): string {
  const params = new URLSearchParams(search ?? "");
  params.set(LOCALE_QUERY, locale);
  return `${pathname || "/"}?${params.toString()}`;
}

/** Localises an inline map of strings: `pick(locale, { en: "Work", ar: "أعمالنا" })`. */
export function pick<T>(locale: Locale, value: Bilingual<T>): T {
  return localized(value, locale);
}

/**
 * Inline script for the public layout: mirrors the wrapper's lang/dir onto
 * <html> before first paint, so screen readers, hyphenation and scrollbars
 * follow the language. The locale comes from our own enum, never from input.
 */
export function htmlLangScript(locale: Locale): string {
  const lang = JSON.stringify(LOCALE_TAG[locale]);
  const dir = JSON.stringify(dirFor(locale));
  return `(function(){try{var d=document.documentElement;d.lang=${lang};d.dir=${dir};}catch(e){}})();`;
}
