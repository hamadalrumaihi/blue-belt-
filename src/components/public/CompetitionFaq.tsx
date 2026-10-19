import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import type { FaqItem } from "@/lib/catalog/faq";
import { localized, type Locale } from "@/lib/i18n/locale";
import { inquiryHref } from "@/lib/inquiries/labels";

type Props = {
  items: readonly FaqItem[];
  locale: Locale;
  /** Section id for in-page links (`#before-you-book`). */
  id?: string;
  /** Band variant: a full section with heading on page background, or a plain list inside a card. */
  variant?: "section" | "plain";
  /** The page this block sits on, recorded on inquiries opened from it. */
  from?: string;
};

const COPY = {
  eyebrow: { en: "Before you book", ar: "قبل أن تحجز" },
  title: { en: "Competition coverage", ar: "تغطية المنافسات" },
  lead: { en: "The conditions every competition booking works under. Read them once; they apply to individual athletes, clubs and teams alike.", ar: "الشروط التي يخضع لها كل حجز تغطية منافسة. اقرأها مرة واحدة؛ فهي تنطبق على الرياضيين الأفراد والأندية والفرق على حد سواء." },
  more: { en: "Anything else? Ask us before you book.", ar: "أمر آخر؟ اسألنا قبل الحجز." },
  ask: { en: "Ask a booking question", ar: "اسأل عن الحجز" },
} as const;

/**
 * "Before you book: competition coverage". Expandable questions, every one
 * in the HTML (search engines and no-JavaScript visitors read it all);
 * `#faq-<id>` links open that question through the browser's own anchor.
 */
export function CompetitionFaq({ items, locale, id = "before-you-book", variant = "section", from = "/book" }: Props) {
  if (!items.length) return null;
  const L = <T,>(v: { en: T; ar?: T }) => localized(v, locale);
  const list = (
    <div className="divide-y divide-line rounded-card border border-line bg-surface">
      {items.map((f) => (
        <details key={f.id} id={`faq-${f.id}`} className="disclosure group scroll-mt-24 px-5 py-3">
          <summary>
            <span>{L(f.question)}</span>
            <ChevronRightIcon size={18} className="rtl-flip shrink-0 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          </summary>
          <p className="pb-2 pt-1 text-sm leading-relaxed text-muted">{L(f.answer)}</p>
        </details>
      ))}
    </div>
  );
  if (variant === "plain") return <div id={id} className="scroll-mt-20">{list}</div>;
  return (
    <section id={id} className="scroll-mt-20 border-t border-line bg-page" aria-labelledby={`${id}-heading`}>
      <div className="container-x section-sm grid gap-8 lg:grid-cols-[1fr_2fr]">
        <div>
          <p className="eyebrow">{L(COPY.eyebrow)}</p>
          <h2 id={`${id}-heading`} className="heading-2 mt-2 text-navy">{L(COPY.title)}</h2>
          <p className="mt-3 text-base text-muted">{L(COPY.lead)}</p>
          <p className="mt-4 text-sm text-muted">
            {L(COPY.more)}{" "}
            <Link href={inquiryHref("booking_question", from)} data-umami-event="contact-click" className="font-semibold text-primary">{L(COPY.ask)}</Link>
          </p>
        </div>
        {list}
      </div>
    </section>
  );
}
