"use client";

import { useLayoutEffect } from "react";
import { dirFor, LOCALE_TAG, type Locale } from "@/lib/i18n/locale";

/**
 * Keeps <html lang dir> in step with the public site's language across
 * client-side navigations, and resets to English / LTR when the visitor
 * leaves the public layout (the studio and the client portal are English).
 * First paint is handled by the inline script in the public layout.
 */
export function HtmlLang({ locale }: { locale: Locale }) {
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.lang = LOCALE_TAG[locale];
    el.dir = dirFor(locale);
    return () => {
      el.lang = "en";
      el.dir = "ltr";
    };
  }, [locale]);
  return null;
}
