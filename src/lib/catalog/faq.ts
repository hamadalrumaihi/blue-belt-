/**
 * The conditions a customer should understand before booking competition
 * coverage, plus the two general answers every visitor needs (how payment
 * works, public event galleries). Answered in English and Arabic without
 * promises the studio has not approved: where a policy depends on the
 * written quotation, the answer says so.
 *
 * Everything else that used to be a FAQ (training locations, revisions,
 * gallery troubleshooting, custom projects…) is handled through the Contact
 * & Inquiries page, so the website no longer asks visitors to scroll through
 * dozens of questions.
 *
 * Rendered as "Before you book: competition coverage" on the request page
 * and on the competition service pages, as a short teaser on the home page,
 * and as FAQPage structured data on the tournament athlete service page.
 * Pure: no I/O, safe in client components and tests.
 */
import type { Bilingual, Locale } from "@/lib/i18n/locale";
import { localized } from "@/lib/i18n/locale";
import type { FaqCategory as OwnerFaqCategory, FaqOverride } from "@/lib/studio/site-content";
import { PAYMENT_BALANCE_NOTE, PAYMENT_POLICY } from "./copy";
import type { ServiceKey } from "./index";

export const FAQ_CATEGORIES = ["booking", "coverage", "video", "delivery", "payment", "usage", "privacy", "account"] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export const FAQ_CATEGORY_LABEL: Record<FaqCategory, Bilingual> = {
  booking: { en: "Booking", ar: "الحجز" },
  coverage: { en: "On the day", ar: "يوم التصوير" },
  video: { en: "Video", ar: "الفيديو" },
  delivery: { en: "Delivery", ar: "التسليم" },
  payment: { en: "Payment", ar: "الدفع" },
  usage: { en: "Using the work", ar: "استخدام العمل" },
  privacy: { en: "Privacy", ar: "الخصوصية" },
  account: { en: "Your account", ar: "حسابك" },
};

export type FaqItem = {
  id: string;
  category: FaqCategory;
  question: Bilingual;
  answer: Bilingual;
  /** Shown on the home teaser when true. */
  featured?: boolean;
  /** Part of "Before you book: competition coverage". */
  competition?: boolean;
  /** Extra search words (both languages) that are not in the question itself. */
  keywords?: string[];
};

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: "wins-losses",
    category: "coverage",
    competition: true,
    featured: true,
    question: { en: "Do you shoot losses as well as wins?", ar: "هل تصورون الخسارة كما تصورون الفوز؟" },
    answer: {
      en: "Yes. We photograph and film matches as they happen, regardless of the result, so coverage includes wins and losses. If an athlete is eliminated early, the content captured up to that point is edited and delivered according to the booking agreement. A booking does not promise a particular number of matches.",
      ar: "نعم. نصوّر النزالات كما تحدث بغض النظر عن النتيجة، فالتغطية تشمل الفوز والخسارة. وإذا خرج الرياضي مبكرًا، يُحرَّر ما صُوِّر حتى تلك اللحظة ويُسلَّم وفق اتفاقية الحجز. الحجز لا يضمن عددًا معينًا من النزالات.",
    },
  },
  {
    id: "one-match-no-match",
    category: "coverage",
    competition: true,
    question: { en: "What if the athlete has only one match, or does not compete?", ar: "ماذا لو كان للرياضي نزال واحد فقط، أو لم يتنافس أصلًا؟" },
    answer: {
      en: "A single match still counts as a booking. Coverage may include other moments such as warm-ups, preparation and podium appearances where they happen and where access is permitted; we cannot promise that warm-up or podium footage will always exist. If the athlete does not compete or their bracket is empty, the applicable arrangements are those in the written quotation and booking agreement.",
      ar: "النزال الواحد يبقى حجزًا كاملًا. وقد تشمل التغطية لحظات أخرى مثل الإحماء والاستعداد ومنصة التتويج حيث تحدث وحيث يُسمح بالوصول؛ ولا يمكننا الوعد بوجود لقطات إحماء أو تتويج دائمًا. وإذا لم يتنافس الرياضي أو كانت فئته فارغة، فتُطبَّق الترتيبات الواردة في عرض السعر واتفاقية الحجز المكتوبة.",
    },
  },
  {
    id: "athlete-identification",
    category: "coverage",
    competition: true,
    question: { en: "How do you identify our matches?", ar: "كيف تحددون نزالاتنا؟" },
    answer: {
      en: "Before the event we request the athlete's registered name, academy and division. A bracket or athlete profile link helps us identify the correct schedule. Tell us about bracket changes as soon as possible; changes are accommodated according to scheduling and coverage availability.",
      ar: "قبل الفعالية نطلب اسم الرياضي المسجل وأكاديميته وفئته. ويساعدنا رابط جدول النزالات أو ملف الرياضي على تحديد الجدول الصحيح. أخبرنا بأي تغيير في الجدول في أقرب وقت ممكن؛ وتُستوعب التغييرات حسب الجدول وتوفر التغطية.",
    },
  },
  {
    id: "every-match",
    category: "coverage",
    competition: true,
    featured: true,
    question: { en: "Do you cover every match?", ar: "هل تغطون كل نزال؟" },
    answer: {
      en: "We aim to capture the agreed coverage as completely as possible, but we cannot promise every match. Coverage depends on match scheduling, overlapping mats, venue restrictions and crew availability. For an individual athlete we follow their competition schedule as closely as we can. For clubs and teams our approach is different: we capture as many athletes and moments from the team as possible throughout the event, according to the opportunities available. Team coverage does not automatically mean that every match or every athlete will be photographed or filmed.",
      ar: "نسعى إلى تغطية ما اتُّفق عليه بأكمل صورة ممكنة، لكن لا يمكن ضمان كل نزال. تعتمد التغطية على جدول النزالات، وتزامن البُسُط، وقيود الصالة، وتوفر الطاقم. للرياضي الواحد نتابع جدول منافساته بأقرب ما يمكن. أما للأندية والفرق فنهجنا مختلف: نلتقط أكبر عدد ممكن من رياضيي الفريق ولحظاته على مدار الفعالية حسب الفرص المتاحة. وتغطية الفريق لا تضمن تلقائيًا تصوير كل نزال أو كل رياضي.",
    },
  },
  {
    id: "club-team-coverage",
    category: "booking",
    competition: true,
    question: { en: "How does club and team coverage work?", ar: "كيف تتم تغطية الأندية والفرق؟" },
    answer: {
      en: "Clubs submit a roster with athlete names, divisions and the schedule information available. We assess the roster, the event schedule and the requested deliverables before preparing a quote. We aim to capture the team throughout the event, across different athletes, matches and moments whenever possible. Gallery arrangements and deliverables are defined in the quotation; crew size and image counts per athlete are not promised in advance.",
      ar: "يرسل النادي قائمة بأسماء الرياضيين وفئاتهم ومعلومات الجدول المتاحة. نقيّم القائمة وجدول الفعالية والمخرجات المطلوبة قبل إعداد عرض السعر. ونسعى إلى تغطية الفريق على مدار الفعالية عبر مختلف الرياضيين والنزالات واللحظات كلما أمكن. تُحدَّد ترتيبات المعرض والمخرجات في عرض السعر؛ ولا يُوعد مسبقًا بحجم الطاقم أو بعدد الصور لكل رياضي.",
    },
  },
  {
    id: "separate-bookings",
    category: "booking",
    competition: true,
    featured: true,
    question: { en: "Is each athlete a separate booking?", ar: "هل كل رياضي حجز منفصل؟" },
    answer: {
      en: "Yes. One individual athlete is one booking. If you ask for coverage of several athletes, the quote is adjusted accordingly. Multi-athlete, team and club projects may have different rates and coverage structures; individual package pricing is not automatically applied to a team. The final scope and price are confirmed in writing.",
      ar: "نعم. الرياضي الواحد هو حجز واحد. وإذا طلبت تغطية عدة رياضيين يُعدَّل عرض السعر وفقًا لذلك. وقد تختلف أسعار وهياكل التغطية لمشاريع الرياضيين المتعددين والفرق والأندية؛ ولا تُطبَّق أسعار الباقات الفردية تلقائيًا على الفريق. يُثبَّت النطاق والسعر النهائيان كتابيًا.",
    },
  },
  {
    id: "raw-footage",
    category: "video",
    competition: true,
    featured: true,
    question: { en: "Do you provide raw footage or unedited files?", ar: "هل تقدمون اللقطات الخام أو الملفات غير المحررة؟" },
    answer: {
      en: "No. Blue Belt Media provides edited photography and video deliverables according to the agreed booking. Raw camera footage, RAW photo files and unedited source material are not included or provided.",
      ar: "لا. تقدّم بلو بلت ميديا صورًا ومقاطع فيديو محررة وفق الحجز المتفق عليه. لا تشمل الخدمة لقطات الكاميرا الخام ولا ملفات الصور بصيغة RAW ولا أي مواد مصدرية غير محررة.",
    },
    keywords: ["RAW", "source files", "unedited"],
  },
  {
    id: "venue-access",
    category: "coverage",
    competition: true,
    question: { en: "What if venue access is restricted?", ar: "ماذا لو كان الوصول داخل الصالة مقيدًا؟" },
    answer: {
      en: "We follow venue and organiser rules, so coverage depends on where photographers and videographers are permitted to operate. If additional media access or accreditation is available, you or the organiser may arrange it for our crew. Access to restricted locations, podiums, warm-up areas or mat-side positions cannot be promised without the necessary permission.",
      ar: "نلتزم بقواعد الصالة والمنظم، لذا تعتمد التغطية على الأماكن المسموح فيها للمصورين بالعمل. وإذا توفر اعتماد إعلامي أو تصريح وصول إضافي، يمكنك أنت أو المنظم ترتيبه لطاقمنا. ولا يمكن ضمان الوصول إلى المناطق المقيدة أو منصات التتويج أو مناطق الإحماء أو جانب البساط من دون الإذن اللازم.",
    },
  },
  {
    id: "no-show",
    category: "booking",
    competition: true,
    question: { en: "What happens if the athlete does not show up?", ar: "ماذا يحدث إذا لم يحضر الرياضي؟" },
    answer: {
      en: "The crew may already have committed time and resources to the booked event. No-shows are handled according to the written quotation and booking agreement. Please tell us about any change as early as possible.",
      ar: "قد يكون الطاقم قد خصص وقته وموارده للفعالية المحجوزة مسبقًا. يُتعامل مع عدم الحضور وفق عرض السعر واتفاقية الحجز المكتوبة. يرجى إخبارنا بأي تغيير في أقرب وقت ممكن.",
    },
  },
  {
    id: "postponed-cancelled",
    category: "booking",
    competition: true,
    question: { en: "What if the competition is postponed or cancelled?", ar: "ماذا لو تأجلت البطولة أو أُلغيت؟" },
    answer: {
      en: "Tell us as soon as possible. Rescheduling, the treatment of any deposit and alternative arrangements depend on the written quotation and agreement. For postponed events we may move the coverage to the new date, subject to availability and agreement; we cannot promise automatic rescheduling.",
      ar: "أخبرنا في أقرب وقت ممكن. يعتمد تغيير الموعد والتعامل مع أي عربون والترتيبات البديلة على عرض السعر والاتفاقية المكتوبة. وفي حال تأجيل الفعالية قد ننقل التغطية إلى الموعد الجديد رهنًا بالتوفر والاتفاق؛ ولا يُضمن تغيير الموعد تلقائيًا.",
    },
  },
  {
    id: "payment",
    category: "payment",
    featured: true,
    question: { en: "How does payment work?", ar: "كيف يتم الدفع؟" },
    answer: {
      en: `${PAYMENT_POLICY.en} ${PAYMENT_BALANCE_NOTE.en} Photos bought from a public event gallery are separate and are paid in the gallery.`,
      ar: `${PAYMENT_POLICY.ar} ${PAYMENT_BALANCE_NOTE.ar} أما الصور التي تُشترى من معرض فعالية عام فهي منفصلة وتُدفع داخل المعرض.`,
    },
  },
  {
    id: "public-gallery",
    category: "delivery",
    question: { en: "I did not book. Can I still find and buy my photos from an event?", ar: "لم أحجز. هل يمكنني مع ذلك إيجاد صوري من فعالية وشراؤها؟" },
    answer: {
      en: "Sometimes. Public gallery availability depends on whether a gallery was created and published for that event. Use Find my photos to look for the event; photos bought there are paid in the gallery and are separate from bookings. Not every participant appears in a public event gallery, because we only shoot what the day and our booked coverage allow.",
      ar: "أحيانًا. يعتمد توفر المعرض العام على ما إذا كان قد أُنشئ معرض لتلك الفعالية ونُشر. استخدم «ابحث عن صوري» للبحث عن الفعالية؛ والصور التي تُشترى هناك تُدفع داخل المعرض وهي منفصلة عن الحجوزات. ولا يظهر كل مشارك في معرض الفعالية العام، لأننا نصوّر ما يسمح به اليوم والتغطية المحجوزة فقط.",
    },
  },
];

/** The owner's FAQ editor uses its own category names; they map onto the public ones here. */
const OWNER_CATEGORY: Record<OwnerFaqCategory, FaqCategory> = { booking: "booking", pricing: "payment", delivery: "delivery", rights: "usage", tournaments: "coverage", other: "booking" };

/**
 * Merges the owner's published FAQ overrides (photo_studio.settings,
 * edited under /website) into the code catalog: an override whose id
 * matches a catalog item replaces its words (keeping its place and, when
 * the override has no Arabic, falling back to English); any other id is
 * appended. Pure, so the pages and the tests share it.
 */
export function applyFaqOverrides(items: readonly FaqItem[], overrides: readonly FaqOverride[]): FaqItem[] {
  if (!overrides.length) return [...items];
  const byId = new Map(overrides.map((o) => [o.id, o] as const));
  const toItem = (o: FaqOverride, base?: FaqItem): FaqItem => ({
    id: o.id,
    category: base?.category ?? OWNER_CATEGORY[o.category] ?? "booking",
    featured: base?.featured,
    competition: base?.competition ?? o.category === "tournaments",
    keywords: base?.keywords,
    question: { en: o.question_en, ar: o.question_ar ?? undefined },
    answer: { en: o.answer_en, ar: o.answer_ar ?? undefined },
  });
  const merged = items.map((item) => {
    const o = byId.get(item.id);
    return o ? toItem(o, item) : item;
  });
  const known = new Set(items.map((i) => i.id));
  for (const o of overrides) if (!known.has(o.id)) merged.push(toItem(o));
  return merged;
}

export function faqById(id: string, items: readonly FaqItem[] = FAQ_ITEMS): FaqItem | null {
  return items.find((f) => f.id === id) ?? null;
}

export function faqsFor(ids: readonly string[], items: readonly FaqItem[] = FAQ_ITEMS): FaqItem[] {
  return ids.map((id) => faqById(id, items)).filter((f): f is FaqItem => f !== null);
}

export function featuredFaqs(limit = 5, items: readonly FaqItem[] = FAQ_ITEMS): FaqItem[] {
  return items.filter((f) => f.featured).slice(0, limit);
}

/** "Before you book: competition coverage", in the order the conditions are explained. */
export function competitionFaqs(items: readonly FaqItem[] = FAQ_ITEMS): FaqItem[] {
  return items.filter((f) => f.competition);
}

/** The FAQs a service page shows, in the order its copy lists them. */
export function faqsForService(key: ServiceKey, faqIds: readonly string[], items: readonly FaqItem[] = FAQ_ITEMS): FaqItem[] {
  void key;
  return faqsFor(faqIds, items);
}

/** Lower-cased, diacritics-free text for matching a query against a question and answer in either language. */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٕ]/g, "")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** Filter used by the owner's FAQ tools and tests: every query word must appear in the item (either language, plus keywords). */
export function filterFaqs(items: readonly FaqItem[], query: string, category: FaqCategory | "all" = "all"): FaqItem[] {
  const words = normalizeForSearch(query).split(" ").filter(Boolean);
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!words.length) return true;
    const hay = normalizeForSearch([item.question.en, item.question.ar ?? "", item.answer.en, item.answer.ar ?? "", ...(item.keywords ?? [])].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/** FAQPage structured data in one language; rendered on one page only, so the same questions are not claimed twice. */
export function buildFaqJsonLd(locale: Locale = "en", items: readonly FaqItem[] = FAQ_ITEMS): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: locale,
    mainEntity: items.map((i) => ({ "@type": "Question", name: localized(i.question, locale), acceptedAnswer: { "@type": "Answer", text: localized(i.answer, locale) } })),
  };
}

/**
 * Policies the public copy deliberately leaves to the written quote because
 * the owner has not confirmed them. Owner-facing only: never rendered on the
 * public site. Each entry names the FAQ or page that would change once the
 * owner decides.
 */
export const OPEN_POLICY_QUESTIONS: ReadonlyArray<{ id: string; question: string; where: string }> = [
  { id: "deposit-structure", question: "Which projects take a deposit and which take full advance payment, and the deposit share when one applies (the booking tools default to the BOOKINGS_DEPOSIT_PERCENT setting).", where: "FAQ payment; every service page payment steps; quotation template" },
  { id: "turnaround", question: "Standard delivery time for photos and for each video deliverable (days after the event / session).", where: "Service pages (Good to know); How it works step 4" },
  { id: "no-show", question: "No-show and no-match policy: is the deposit kept, is the balance due, is a credit offered.", where: "FAQ no-show; FAQ one-match-no-match" },
  { id: "cancellation", question: "Cancellation and rescheduling terms for postponed events: deposit refundable or not, notice periods.", where: "FAQ postponed-cancelled; terms page" },
  { id: "team-crew", question: "How crew size and per-athlete coverage are decided for large rosters, and whether a minimum image count per athlete is ever offered.", where: "FAQ club-team-coverage; team service page" },
  { id: "usage-licence", question: "Price and terms of club / sponsor / commercial licences, and the studio's own portfolio use (opt-out wording is currently in the copy).", where: "Permitted use on every service page" },
  { id: "music", question: "Whether licensed music can be added to edits on request and at what cost; default is without music.", where: "Video deliverable copy" },
  { id: "accreditation", question: "Who is responsible when an organiser refuses accreditation after a booking is confirmed.", where: "FAQ venue-access" },
  { id: "custom-projects", question: "Day rates or starting points for photography, videography and custom productions, so quotes for non-tournament work are consistent.", where: "Project categories on the home and services pages; inquiry replies" },
];
