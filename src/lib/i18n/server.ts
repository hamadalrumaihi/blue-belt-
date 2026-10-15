import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale, type Locale } from "./locale";

/**
 * The visitor's language for the public site, read once per request from
 * the `bbm_lang` cookie (set by the proxy when a page is opened with
 * `?lang=`). Pages that receive search params may pass `lang` so a link
 * that bypassed the proxy still renders the requested language.
 */
export const getLocale = cache(async (query?: string | string[] | null): Promise<Locale> => {
  const q = Array.isArray(query) ? query[0] : query;
  try {
    const store = await cookies();
    return resolveLocale(q, store.get(LOCALE_COOKIE)?.value);
  } catch {
    return resolveLocale(q, DEFAULT_LOCALE);
  }
});
