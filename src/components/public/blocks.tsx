import Link from "next/link";
import type { ReactNode } from "react";
import { CameraIcon, CheckIcon, ChevronRightIcon, ImageIcon, SendIcon, UsersIcon, VideoIcon } from "@/components/icons";
import { cleanPublicDescription, MEDIA_SCOPE_COPY, SERVICE_COPY } from "@/lib/catalog/copy";
import type { ServiceDefinition, ServiceKey } from "@/lib/catalog/index";
import { formatQr } from "@/lib/bookings/state";
import { localized, type Locale } from "@/lib/i18n/locale";
import { tr, UI } from "@/lib/i18n/ui";
import type { PublicMediaItem } from "@/lib/media/public";
import { publicPrice } from "@/lib/services/pricing";
import type { PhotoServiceRow } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { MediaImage } from "./MediaImage";

/*
 * Small server-safe building blocks shared by the public pages, so headings,
 * steps, price lines and calls to action look the same everywhere and the
 * pages stay short. No hooks, no I/O.
 */

/** Structured data script. The data is our own; `<` is escaped by the serializer. */
export function JsonLd({ json }: { json: string }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export function SectionHeading({ id, eyebrow, title, lead, action, light = false, className }: { id?: string; eyebrow?: string; title: string; lead?: string; action?: ReactNode; light?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="max-w-2xl">
        {eyebrow && <p className={cn("eyebrow", light && "!text-white/60")}>{eyebrow}</p>}
        <h2 id={id} className={cn("heading-2 mt-2", light ? "text-white" : "text-navy")}>{title}</h2>
        {lead && <p className={cn("mt-3 text-base", light ? "text-white/75" : "text-muted")}>{lead}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Numbered list of short steps, in a compact responsive grid. */
export function Steps({ steps, cols = 4, light = false }: { steps: ReadonlyArray<{ title: string; body: string }>; cols?: 4 | 5; light?: boolean }) {
  return (
    <ol className={cn("grid gap-4 sm:grid-cols-2", cols === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
      {steps.map((s, i) => (
        <li key={s.title} className={cn("rounded-xl border p-5", light ? "border-white/15 bg-white/5" : "border-line bg-surface")}>
          <span className={cn("flex size-8 items-center justify-center rounded-full text-xs font-bold", light ? "bg-white text-navy" : "bg-navy text-white")} aria-hidden>
            {i + 1}
          </span>
          <h3 className={cn("mt-3 text-base font-extrabold", light ? "text-white" : "text-ink")}>{s.title}</h3>
          <p className={cn("mt-1.5 text-sm leading-relaxed", light ? "text-white/75" : "text-muted")}>{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** A tick list for "what you get" style content. */
export function CheckList({ items, icon = "check", className }: { items: readonly string[]; icon?: "check" | "chevron"; className?: string }) {
  return (
    <ul className={cn("prose-list", className)}>
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          {icon === "check" ? <CheckIcon size={16} className="mt-0.5 shrink-0 text-primary" /> : <ChevronRightIcon size={16} className="rtl-flip mt-0.5 shrink-0 text-muted" />}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** One call-to-action band at the end of a page: a title, a sentence and one button. */
export function CtaBand({ eyebrow, title, body, href, label, event, eventData }: { eyebrow?: string; title: string; body?: string; href: string; label: string; event: string; eventData?: Record<string, string> }) {
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(eventData ?? {})) data[`data-umami-event-${k}`] = v;
  return (
    <section className="navy-pattern bg-navy text-white">
      <div className="container-x flex flex-col items-start gap-6 py-12 md:flex-row md:items-center md:justify-between lg:py-16">
        <div className="max-w-2xl">
          {eyebrow && <p className="eyebrow !text-white/60">{eyebrow}</p>}
          <h2 className="heading-2 mt-2">{title}</h2>
          {body && <p className="mt-2 max-w-xl text-sm text-white/75 sm:text-base">{body}</p>}
        </div>
        <Link href={href} data-umami-event={event} {...data} className="btn-primary btn-lg shrink-0 shadow-hero">
          {label}
          <ChevronRightIcon size={18} className="rtl-flip" />
        </Link>
      </div>
    </section>
  );
}

/* ---------- prices (only from publicPrice; never typed into copy) ---------- */

/** The lowest public price among a service's packages, localised: "Quote on request", "350 QAR" or "from 350 QAR". */
export function priceLine(rows: readonly PhotoServiceRow[], locale: Locale): string {
  const t = tr(locale);
  const priced = rows.map(publicPrice).filter((p) => p.amount !== null);
  if (!priced.length) return t(UI.common.quoteOnRequest);
  const min = Math.min(...priced.map((p) => p.amount as number));
  const allFixedSame = priced.every((p) => p.mode === "fixed" && p.amount === min);
  return allFixedSame ? formatQr(min) : `${t(UI.common.from)} ${formatQr(min)}`;
}

export function priceLabel(row: PhotoServiceRow, locale: Locale): { label: string; quote: boolean } {
  const t = tr(locale);
  const p = publicPrice(row);
  if (p.mode === "quote") return { label: t(UI.common.quoteOnRequest), quote: true };
  return { label: p.mode === "fixed" ? formatQr(p.amount as number) : `${t(UI.common.from)} ${formatQr(p.amount as number)}`, quote: false };
}

/** The packages that book as a service: name, cleaned description, media and the price from publicPrice(). */
export function PackageList({ rows, locale, bookHref }: { rows: readonly PhotoServiceRow[]; locale: Locale; bookHref: (row: PhotoServiceRow) => string | null }) {
  const t = tr(locale);
  if (!rows.length) {
    return <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">{t(UI.common.quoteOnRequest)}. {t(UI.common.confirmedInQuote)}</p>;
  }
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {rows.map((row) => {
        const price = priceLabel(row, locale);
        const description = cleanPublicDescription(row.description);
        const href = bookHref(row);
        const inner = (
          <>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">{row.name}</p>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                {row.includes_photo && <span className="inline-flex items-center gap-1"><CameraIcon size={14} /> {t(UI.common.photo)}</span>}
                {row.includes_video && <span className="inline-flex items-center gap-1"><VideoIcon size={14} /> {t(UI.common.video)}</span>}
                {row.duration_minutes ? <span>{row.duration_minutes} {t(UI.common.minutes)}</span> : null}
              </p>
            </div>
            <p className={cn("shrink-0 text-end font-extrabold", price.quote ? "text-sm text-muted" : "text-base text-navy")}>{price.label}</p>
          </>
        );
        return (
          <li key={row.id}>
            {href ? (
              <Link href={href} data-umami-event="request-start" className="flex min-h-14 items-center gap-4 px-4 py-3 transition-colors hover:bg-page">
                {inner}
              </Link>
            ) : (
              <div className="flex min-h-14 items-center gap-4 px-4 py-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- services ---------- */

export const SERVICE_ICON: Record<ServiceKey, typeof CameraIcon> = {
  tournament_athlete: CameraIcon,
  team_tournament: UsersIcon,
  training_content: VideoIcon,
  athlete_portrait: ImageIcon,
  organizer_custom: SendIcon,
};

export function ScopeBadges({ def, locale, light = false }: { def: ServiceDefinition; locale: Locale; light?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={localized(UI.services.mediaOptions, locale)}>
      {def.mediaScopes.map((scope) => (
        <li key={scope} className={cn("badge", light && "badge-light")}>
          {scope === "video" ? <VideoIcon size={12} /> : <CameraIcon size={12} />}
          {localized(MEDIA_SCOPE_COPY[scope].title, locale)}
        </li>
      ))}
    </ul>
  );
}

/** A compact service card: title, one line, media scopes, a price line and a link to the detail page. */
export function ServiceCard({ def, locale, rows, media }: { def: ServiceDefinition; locale: Locale; rows: readonly PhotoServiceRow[]; media?: PublicMediaItem | null }) {
  const t = tr(locale);
  const copy = SERVICE_COPY[def.key];
  const Icon = SERVICE_ICON[def.key];
  const line = def.quoteFirst ? t(UI.common.quoteOnRequest) : priceLine(rows, locale);
  return (
    <Link href={`/services/${def.slug}`} className="card card-hover group flex h-full flex-col overflow-hidden" aria-label={localized(copy.title, locale)}>
      {media ? (
        <div className="figure aspect-[16/9] rounded-none">
          <MediaImage item={media} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" alt="" className="transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
        </div>
      ) : (
        <div className="flex items-center gap-3 border-b border-line bg-page px-5 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-navy text-white"><Icon size={18} /></span>
          <ScopeBadges def={def} locale={locale} />
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-extrabold text-ink">{localized(copy.title, locale)}</h3>
        <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">{localized(copy.short, locale)}</p>
        <p className="mt-4 flex items-center justify-between gap-3 text-sm font-bold text-primary">
          <span>{line}</span>
          <ChevronRightIcon size={18} className="rtl-flip transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
        </p>
      </div>
    </Link>
  );
}
