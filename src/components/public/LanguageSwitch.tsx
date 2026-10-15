"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { langSwitchHref, LOCALE_LABEL, LOCALE_TAG, otherLocale, type Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

/**
 * One link that switches to the other language and stays on the same page.
 * The proxy turns `?lang=` into the cookie and redirects back without it,
 * so it works without JavaScript and never leaves a language in the URL.
 */
export function LanguageSwitch({ locale, className, onNavigate }: { locale: Locale; className?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const next = otherLocale(locale);
  return (
    <a
      href={langSwitchHref(pathname, search?.toString(), next)}
      hrefLang={LOCALE_TAG[next]}
      lang={LOCALE_TAG[next]}
      rel="nofollow"
      aria-label={next === "ar" ? "التبديل إلى العربية" : "Switch to English"}
      onClick={onNavigate}
      className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold", className)}
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      {LOCALE_LABEL[next]}
    </a>
  );
}
