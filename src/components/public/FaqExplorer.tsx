"use client";

import { useEffect, useId, useState } from "react";
import { ChevronRightIcon, SearchIcon } from "@/components/icons";
import { FAQ_CATEGORIES, FAQ_CATEGORY_LABEL, filterFaqs, type FaqCategory, type FaqItem } from "@/lib/catalog/faq";
import { localized, type Locale } from "@/lib/i18n/locale";
import { tr, UI } from "@/lib/i18n/ui";

type Props = { items: FaqItem[]; locale: Locale };

/**
 * Searchable, categorised FAQ. Every item is in the HTML for search engines
 * and for visitors without JavaScript (the filter only hides). A `#faq-<id>`
 * link opens that question. Matching is on both languages, so an English
 * word finds the Arabic answer too.
 */
export function FaqExplorer({ items, locale }: Props) {
  const t = tr(locale);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FaqCategory | "all">("all");
  const inputId = useId();
  const visible = filterFaqs(items, query, category);
  const present = new Set(items.map((i) => i.category));
  const categories = FAQ_CATEGORIES.filter((c) => present.has(c));

  useEffect(() => {
    const id = window.location.hash.replace(/^#faq-/, "");
    if (!id || !window.location.hash.startsWith("#faq-")) return;
    const el = document.getElementById(`faq-${id}`);
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ block: "start" });
    }
  }, []);

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div>
          <label htmlFor={inputId} className="label">{t(UI.common.search)}</label>
          <div className="relative">
            <SearchIcon size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input id={inputId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(UI.how.searchPlaceholder)} className="input ps-10" autoComplete="off" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t(UI.common.category)}>
        <button type="button" className="chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t(UI.common.all)}</button>
        {categories.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
            {localized(FAQ_CATEGORY_LABEL[c], locale)}
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">{visible.length} {t(UI.common.results)}</p>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted" role="status">
          <p>{t(UI.common.noResults)}</p>
          <button type="button" className="btn-secondary mt-3" onClick={() => { setQuery(""); setCategory("all"); }}>{t(UI.common.clearSearch)}</button>
        </div>
      ) : (
        <div className="mt-6 divide-y divide-line rounded-card border border-line bg-surface">
          {visible.map((f) => (
            <details key={f.id} id={`faq-${f.id}`} className="disclosure group scroll-mt-24 px-5 py-3">
              <summary>
                <span>{localized(f.question, locale)}</span>
                <ChevronRightIcon size={18} className="rtl-flip shrink-0 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
              </summary>
              <div className="pb-2 pt-1 text-sm leading-relaxed text-muted">
                <p>{localized(f.answer, locale)}</p>
                <p className="mt-2 text-xs"><span className="badge">{localized(FAQ_CATEGORY_LABEL[f.category], locale)}</span></p>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
