"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "@/components/icons";
import { mediaCategoryLabel } from "@/lib/catalog/copy";
import type { Locale } from "@/lib/i18n/locale";
import { fill, tr, UI } from "@/lib/i18n/ui";
import type { PublicMediaItem } from "@/lib/media/public";
import { cn } from "@/lib/utils";
import { isLandscape, mediaCategories } from "./media";
import { MediaImage } from "./MediaImage";

type Props = { items: PublicMediaItem[]; locale: Locale };

/**
 * The showcase grid with category filters and an accessible lightbox. The
 * lightbox is a native <dialog> opened with showModal(): the browser keeps
 * focus inside it, Escape closes it, and everything behind is inert. Arrow
 * keys move between images (mirrored in RTL); focus returns to the
 * thumbnail that opened it. Images stay lazy until they are shown.
 */
export function WorkGallery({ items, locale }: Props) {
  const t = tr(locale);
  const rtl = locale === "ar";
  const categories = mediaCategories(items);
  const [category, setCategory] = useState<string>("all");
  const [current, setCurrent] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const visible = category === "all" ? items : items.filter((m) => m.category === category);

  const open = useCallback((index: number, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setCurrent(index);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (current !== null && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    }
    if (current === null && dialog.open) dialog.close();
  }, [current]);

  const close = useCallback(() => {
    setCurrent(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    // The dialog has to close before focus can move back behind it.
    requestAnimationFrame(() => trigger?.focus());
  }, []);

  const step = useCallback(
    (delta: number) => {
      setCurrent((i) => (i === null || !visible.length ? i : (i + delta + visible.length) % visible.length));
    },
    [visible.length],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "ArrowRight") step(rtl ? -1 : 1);
    else if (e.key === "ArrowLeft") step(rtl ? 1 : -1);
    else return;
    e.preventDefault();
  }

  const item = current !== null ? visible[current] : null;

  return (
    <div>
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t(UI.work.filterLabel)}>
          <button type="button" className="chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t(UI.common.all)}</button>
          {categories.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {mediaCategoryLabel(c, locale)}
            </button>
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{visible.length} {t(UI.common.results)}</p>

      <ul className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4", categories.length > 1 && "mt-6")}>
        {visible.map((m, i) => {
          const landscape = isLandscape(m);
          const wide = landscape && visible.length >= 6 && i % 5 === 0;
          return (
            <li key={m.id} className={cn(wide && "col-span-2")}>
              <button
                type="button"
                onClick={(e) => open(i, e.currentTarget)}
                className={cn("figure group block w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", wide ? "aspect-[16/10]" : landscape ? "aspect-[4/3]" : "aspect-[3/4]")}
                aria-label={`${t(UI.work.openImage)}: ${m.alt || mediaCategoryLabel(m.category, locale)}`}
              >
                <MediaImage item={m} sizes={wide ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"} className="transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
              </button>
            </li>
          );
        })}
      </ul>

      <dialog
        ref={dialogRef}
        className="dialog dialog-lock h-dvh w-screen"
        aria-label={item ? item.alt || mediaCategoryLabel(item.category, locale) : undefined}
        onClose={close}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        {item && (
          <div className="flex h-full w-full flex-col" dir={rtl ? "rtl" : "ltr"}>
            <div className="flex items-center justify-between gap-3 px-gutter py-3">
              <p className="text-sm text-white/80" aria-live="polite">{fill(t(UI.work.imageOf), { n: (current ?? 0) + 1, total: visible.length })}</p>
              <button ref={closeRef} type="button" onClick={close} className="btn btn-light min-h-11 w-11 px-0" aria-label={t(UI.common.close)}>
                <CloseIcon />
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-gutter">
              <MediaImage key={item.id} item={item} sizes="100vw" className="!h-auto !w-auto max-h-full max-w-full !object-contain" />
              {visible.length > 1 && (
                <>
                  <button type="button" onClick={() => step(-1)} className="btn btn-light absolute start-2 top-1/2 min-h-11 w-11 -translate-y-1/2 px-0" aria-label={t(UI.common.previous)}>
                    <ChevronLeftIcon className="rtl-flip" />
                  </button>
                  <button type="button" onClick={() => step(1)} className="btn btn-light absolute end-2 top-1/2 min-h-11 w-11 -translate-y-1/2 px-0" aria-label={t(UI.common.next)}>
                    <ChevronRightIcon className="rtl-flip" />
                  </button>
                </>
              )}
            </div>
            <div className="px-gutter py-3 text-sm text-white/80">
              <span className="badge badge-light">{mediaCategoryLabel(item.category, locale)}</span>
              {item.caption && <p className="mt-2">{item.caption}</p>}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
