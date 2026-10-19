/**
 * Every public word about the offer, in English and Arabic, keyed by the
 * catalog's structure (src/lib/catalog/index.ts). The structure says what is
 * sold; this file says how it is described. Both languages describe the same
 * offer, the same policies and the same limits.
 *
 * Rules kept here on purpose:
 *   - No prices in prose. Price lines come from publicPrice() at render time.
 *   - No promises beyond the approved policies: submitting a request costs
 *     nothing; once scope and price are confirmed, a deposit or full advance
 *     payment may be required to secure the booking, as the quotation or
 *     agreement says; any remaining balance and milestones follow the
 *     accepted quote; a request is not a confirmed reservation; scope /
 *     timing / rights / deliverables are confirmed in the written quote or
 *     agreement; no every-match promise; coverage depends on the schedule
 *     and venue access; delivery through the method agreed for the booking
 *     (private online galleries where applicable); event gallery purchases
 *     are separate and paid in the gallery.
 *   - Video deliverables are named explicitly (full-match recording, edited
 *     highlights, reels) and are always edited files: raw footage, RAW photo
 *     files and unedited source material are never offered.
 *   - Pure: no I/O, safe in client components and tests.
 */
import type { Bilingual, Locale } from "@/lib/i18n/locale";
import { localized } from "@/lib/i18n/locale";
import { AUDIENCES, MEDIA_SCOPES, PROJECT_CATEGORIES, SERVICES, VIDEO_DELIVERABLES, type AudienceKey, type MediaScope, type ProjectCategoryKey, type PublicVideoDeliverable, type ServiceKey } from "./index";

export type AudienceCopy = {
  title: Bilingual;
  /** One line under the title on entry tiles. */
  short: Bilingual;
  /** Opening paragraph of the audience block on /services. */
  lead: Bilingual;
  /** Label of the entry tile link. */
  cta: Bilingual;
};

export type ServiceCopy = {
  title: Bilingual;
  short: Bilingual;
  lead: Bilingual;
  intendedClient: Bilingual<string[]>;
  whatWeShoot: Bilingual<string[]>;
  photoDeliverables: Bilingual<string[]>;
  /** Service-specific notes about video; the named deliverable types come from VIDEO_DELIVERABLE_COPY. */
  videoDeliverables: Bilingual<string[]>;
  needFromYou: Bilingual<string[]>;
  bookingSteps: Bilingual<string[]>;
  paymentSteps: Bilingual<string[]>;
  permittedUse: Bilingual<string[]>;
  limitations: Bilingual<string[]>;
  cta: Bilingual;
  metaTitle: Bilingual;
  metaDescription: Bilingual;
  /** FAQ ids (src/lib/catalog/faq.ts) shown on the service page, in order. */
  faqIds: readonly string[];
};

export type MediaScopeCopy = { title: Bilingual; short: Bilingual };
export type VideoDeliverableCopy = { title: Bilingual; short: Bilingual; description: Bilingual };

/** The approved payment wording, shared by every service page and the FAQ. Flexible by design: deposit or full advance payment, as the quotation says. */
export const PAYMENT_POLICY: Bilingual = {
  en: "Submitting an inquiry or booking request does not require payment. Once the scope and pricing are confirmed, a deposit or full advance payment may be required to secure your booking, as specified in your quotation or agreement.",
  ar: "إرسال استفسار أو طلب حجز لا يتطلب أي دفع. بعد تثبيت النطاق والسعر، قد يُطلب عربون أو دفعة مقدمة كاملة لتأكيد حجزك، وفق ما يحدده عرض السعر أو الاتفاقية.",
};

export const PAYMENT_BALANCE_NOTE: Bilingual = {
  en: "Any remaining balance and payment milestones are determined by the accepted quote or agreement.",
  ar: "تُحدَّد أي مبالغ متبقية ومراحل الدفع وفق عرض السعر أو الاتفاقية المقبولة.",
};

const PAYMENT_STEPS: Bilingual<string[]> = {
  en: [
    "Nothing is paid when you send the request.",
    "After the scope and the price are confirmed in writing, a deposit or full advance payment may be required to secure the booking, as stated in your quotation or agreement.",
    "Any remaining balance and payment milestones follow the accepted quote. Payment is by secure online payment link unless your agreement says otherwise.",
    "Photos bought from a public event gallery are separate and are paid in the gallery.",
  ],
  ar: [
    "لا تدفع شيئًا عند إرسال الطلب.",
    "بعد تثبيت النطاق والسعر كتابيًا، قد يُطلب عربون أو دفعة مقدمة كاملة لتأكيد الحجز، وفق ما ينص عليه عرض السعر أو الاتفاقية.",
    "تُحدَّد أي مبالغ متبقية ومراحل الدفع وفق عرض السعر المقبول. يتم الدفع عبر رابط دفع إلكتروني آمن ما لم تنص اتفاقيتك على خلاف ذلك.",
    "شراء الصور من معرض فعالية عام أمر منفصل ويُدفع داخل المعرض.",
  ],
};

const BOOKING_STEPS_EVENT: Bilingual<string[]> = {
  en: [
    "Send the request with the event, the date and who we should follow. You receive a reference straight away; the request is not a confirmed booking yet.",
    "We check the date and reply with a written quote: scope, timing, deliverables and how the work may be used.",
    "You confirm, sign the agreement online and make the payment stated in your quotation. The booking is now confirmed.",
    "Before the day we re-check the athlete's details and the schedule with you.",
  ],
  ar: [
    "أرسل الطلب مع اسم الفعالية والتاريخ ومن علينا متابعته. تحصل على رقم مرجعي فورًا؛ والطلب ليس حجزًا مؤكدًا بعد.",
    "نتحقق من الموعد ونرد بعرض سعر مكتوب: النطاق والتوقيت والمخرجات وكيفية استخدام العمل.",
    "تؤكد الطلب وتوقّع الاتفاقية إلكترونيًا وتسدد الدفعة المحددة في عرض السعر. عندها يصبح الحجز مؤكدًا.",
    "قبل اليوم نراجع معك بيانات الرياضي والجدول مرة أخرى.",
  ],
};

const BOOKING_STEPS_SESSION: Bilingual<string[]> = {
  en: [
    "Send the request with the kind of session, the preferred dates and the location you have in mind. The request is not a confirmed booking yet.",
    "We reply with a written quote: length, location, what is shot, deliverables and how the work may be used.",
    "You confirm, sign the agreement online and make the payment stated in your quotation. The date is now reserved.",
    "We agree the shot list and the timing with you before the session.",
  ],
  ar: [
    "أرسل الطلب مع نوع الجلسة والتواريخ المفضلة والموقع الذي تفكر فيه. الطلب ليس حجزًا مؤكدًا بعد.",
    "نرد بعرض سعر مكتوب: المدة والموقع وما نصوّره والمخرجات وكيفية استخدام العمل.",
    "تؤكد الطلب وتوقّع الاتفاقية إلكترونيًا وتسدد الدفعة المحددة في عرض السعر. عندها يُحجز الموعد.",
    "نتفق معك على قائمة اللقطات والتوقيت قبل الجلسة.",
  ],
};

export type ProjectCategoryCopy = {
  title: Bilingual;
  short: Bilingual;
  /** What this category covers, as short items. */
  items: Bilingual<string[]>;
  /** Label of the category's call to action. */
  cta: Bilingual;
};

/** The six project categories on the home and services pages (structure: PROJECT_CATEGORY_DEFINITIONS). */
export const PROJECT_CATEGORY_COPY: Record<ProjectCategoryKey, ProjectCategoryCopy> = {
  tournament_event: {
    title: { en: "Tournament and event coverage", ar: "تغطية البطولات والفعاليات" },
    short: { en: "Competition days captured as they happen, from the first match to the podium.", ar: "أيام المنافسة كما تحدث، من أول نزال إلى منصة التتويج." },
    items: { en: ["BJJ", "Judo", "MMA", "Boxing", "Martial arts competitions", "Other sporting events"], ar: ["الجوجيتسو", "الجودو", "فنون القتال المختلطة", "الملاكمة", "بطولات الفنون القتالية", "فعاليات رياضية أخرى"] },
    cta: { en: "Book coverage", ar: "احجز التغطية" },
  },
  athlete: {
    title: { en: "Athlete media", ar: "محتوى الرياضيين" },
    short: { en: "Your competition, your training, your story, built for your profile and your sponsors.", ar: "بطولتك وتدريبك وقصتك، لملفك الشخصي ورعاتك." },
    items: { en: ["Competition coverage", "Training sessions", "Fight camps", "Athlete portraits", "Promotional videos", "Athlete branding"], ar: ["تغطية المنافسات", "جلسات التدريب", "معسكرات القتال", "بورتريهات الرياضيين", "فيديوهات ترويجية", "بناء العلامة الشخصية للرياضي"] },
    cta: { en: "Book athlete coverage", ar: "احجز تغطية رياضي" },
  },
  clubs_teams: {
    title: { en: "Clubs and teams", ar: "الأندية والفرق" },
    short: { en: "Your academy on the mats and at competitions, with content your channels can use all season.", ar: "أكاديميتك على البساط وفي البطولات، بمحتوى تستخدمه قنواتك طوال الموسم." },
    items: { en: ["Team photography", "Training sessions", "Academy promotional media", "Social media content", "Team competition coverage"], ar: ["تصوير الفريق", "جلسات التدريب", "محتوى ترويجي للأكاديمية", "محتوى لوسائل التواصل", "تغطية الفريق في البطولات"] },
    cta: { en: "Request a team quote", ar: "اطلب عرض سعر للفريق" },
  },
  photography: {
    title: { en: "Photography", ar: "التصوير الفوتوغرافي" },
    short: { en: "Portraits, sport, lifestyle and commercial photography, planned around what you need the images for.", ar: "بورتريهات وتصوير رياضي ولايف ستايل وتجاري، مخطط حول الغرض من الصور." },
    items: { en: ["Portraits", "Sports photography", "Lifestyle photography", "Commercial photography", "Custom photoshoots"], ar: ["بورتريهات", "تصوير رياضي", "تصوير لايف ستايل", "تصوير تجاري", "جلسات تصوير مخصصة"] },
    cta: { en: "Get a quote", ar: "اطلب عرض سعر" },
  },
  videography: {
    title: { en: "Videography", ar: "تصوير الفيديو" },
    short: { en: "Promotional films, reels and cinematic pieces, cut for the platform they will live on.", ar: "أفلام ترويجية وريلز وأعمال سينمائية، مُعدَّة للمنصة التي ستُعرض عليها." },
    items: { en: ["Promotional videos", "Reels and short-form content", "Cinematic projects", "Commercial content", "Event highlights"], ar: ["فيديوهات ترويجية", "ريلز ومحتوى قصير", "مشاريع سينمائية", "محتوى تجاري", "أبرز لقطات الفعاليات"] },
    cta: { en: "Get a quote", ar: "اطلب عرض سعر" },
  },
  custom: {
    title: { en: "Custom projects", ar: "مشاريع مخصصة" },
    short: { en: "Brand collaborations, campaigns and bespoke productions that do not fit a package. Tell us the idea; we quote it.", ar: "تعاونات مع العلامات التجارية وحملات وإنتاجات مخصصة لا تناسبها الباقات. أخبرنا بالفكرة ونسعّرها." },
    items: { en: ["Brand collaborations", "Creative productions", "Campaigns", "Bespoke media requests"], ar: ["تعاونات مع العلامات التجارية", "إنتاجات إبداعية", "حملات", "طلبات إعلامية مخصصة"] },
    cta: { en: "Discuss a project", ar: "ناقش مشروعك" },
  },
};

export const AUDIENCE_COPY: Record<AudienceKey, AudienceCopy> = {
  athletes: {
    title: { en: "Athletes", ar: "الرياضيون" },
    short: { en: "Your competition day, your training, your portraits.", ar: "يوم بطولتك، وتدريبك، وبورتريهاتك." },
    lead: { en: "Book coverage of your own matches, a session at your academy or a portrait shoot for your profile and sponsors.", ar: "احجز تغطية لنزالاتك، أو جلسة في أكاديميتك، أو جلسة بورتريه لملفك الشخصي ورعاتك." },
    cta: { en: "For athletes", ar: "للرياضيين" },
  },
  parents: {
    title: { en: "Parents", ar: "أولياء الأمور" },
    short: { en: "Your child's matches, followed mat by mat.", ar: "نزالات طفلك، متابعة من بساط إلى آخر." },
    lead: { en: "Book coverage for one child or several, with the guardian consent handled in the request. Photos arrive in a private gallery you control.", ar: "احجز تغطية لطفل واحد أو أكثر، مع موافقة ولي الأمر ضمن الطلب. تصل الصور إلى معرض خاص تتحكم فيه." },
    cta: { en: "For parents", ar: "لأولياء الأمور" },
  },
  clubs: {
    title: { en: "Clubs and coaches", ar: "الأندية والمدربون" },
    short: { en: "Your team at a tournament, or content from the academy.", ar: "فريقك في البطولة، أو محتوى من داخل الأكاديمية." },
    lead: { en: "Team coverage at competitions, training and gym content for your channels, and custom coverage for seminars, gradings and events you host.", ar: "تغطية الفريق في البطولات، ومحتوى التدريب والصالة لقنواتك، وتغطية مخصصة للندوات والترقيات والفعاليات التي تستضيفونها." },
    cta: { en: "For clubs and coaches", ar: "للأندية والمدربين" },
  },
  organizers: {
    title: { en: "Organizers", ar: "المنظمون" },
    short: { en: "Official coverage of your event.", ar: "تغطية رسمية لفعاليتك." },
    lead: { en: "Photography and video for the whole event, planned with you: mats, podiums, officials and the moments that make the day. Quoted per event.", ar: "تصوير فوتوغرافي وفيديو للفعالية كاملة، مخطط معك: البُسُط ومنصات التتويج والحكام واللحظات التي تصنع اليوم. يُسعَّر لكل فعالية." },
    cta: { en: "For organizers", ar: "للمنظمين" },
  },
};

export const MEDIA_SCOPE_COPY: Record<MediaScope, MediaScopeCopy> = {
  photo: { title: { en: "Photography", ar: "تصوير فوتوغرافي" }, short: { en: "Edited photos in a private gallery.", ar: "صور محررة في معرض خاص." } },
  video: { title: { en: "Video", ar: "فيديو" }, short: { en: "Named video deliverables, confirmed in the quote.", ar: "مخرجات فيديو محددة بالاسم، تُثبَّت في عرض السعر." } },
  photo_video: { title: { en: "Photo and video", ar: "صور وفيديو" }, short: { en: "Both, from the same day.", ar: "الاثنان معًا من اليوم نفسه." } },
};

export const VIDEO_DELIVERABLE_COPY: Record<PublicVideoDeliverable, VideoDeliverableCopy> = {
  full_match: {
    title: { en: "Full-match recording", ar: "تسجيل النزال كاملًا" },
    short: { en: "Each agreed match, start to finish, one file per match.", ar: "كل نزال متفق عليه من البداية إلى النهاية، ملف لكل نزال." },
    description: { en: "A continuous recording of each agreed match from the first grip to the result, trimmed at both ends and otherwise uncut. Delivered as one file per match.", ar: "تسجيل متواصل لكل نزال متفق عليه من أول قبضة حتى إعلان النتيجة، مقصوص من الطرفين فقط ومن دون مونتاج. يُسلَّم ملف لكل نزال." },
  },
  edited_highlights: {
    title: { en: "Edited highlights", ar: "مونتاج أبرز اللقطات" },
    short: { en: "The strongest moments cut into one short edit.", ar: "أقوى اللحظات في مونتاج قصير واحد." },
    description: { en: "The best moments of the agreed matches or session cut into one short edit, without music unless the agreement says otherwise. Length and format are set in the quote.", ar: "أفضل لحظات النزالات أو الجلسة المتفق عليها في مونتاج قصير واحد، من دون موسيقى ما لم تنص الاتفاقية على خلاف ذلك. تُحدَّد المدة والصيغة في عرض السعر." },
  },
  reels: {
    title: { en: "Reels", ar: "ريلز" },
    short: { en: "Vertical short clips for social media.", ar: "مقاطع قصيرة عمودية لوسائل التواصل." },
    description: { en: "Short vertical clips cut for social media, without music unless the agreement says otherwise. The number of clips is set in the quote.", ar: "مقاطع عمودية قصيرة مُعدَّة لوسائل التواصل، من دون موسيقى ما لم تنص الاتفاقية على خلاف ذلك. يُحدَّد عدد المقاطع في عرض السعر." },
  },
};

export const SERVICE_COPY: Record<ServiceKey, ServiceCopy> = {
  tournament_athlete: {
    title: { en: "Tournament athlete coverage", ar: "تغطية رياضي في بطولة" },
    short: { en: "One athlete's competition day, followed mat by mat.", ar: "يوم بطولة لرياضي واحد، متابعة من بساط إلى آخر." },
    lead: { en: "We take the athlete's name, academy and division before the day, find them on the bracket and follow their matches as the schedule and venue access allow. For yourself, your child or an athlete you coach.", ar: "نأخذ اسم الرياضي وأكاديميته وفئته قبل اليوم، ونحدده في جدول النزالات ونتابع نزالاته حسب الجدول وإمكانية الوصول داخل الصالة. لك أو لطفلك أو لرياضي تدرّبه." },
    intendedClient: { en: ["Competitors booking their own matches", "Parents booking for a child or several children", "Coaches booking for one athlete"], ar: ["المتسابقون الذين يحجزون نزالاتهم", "أولياء الأمور لطفل أو عدة أطفال", "المدربون لرياضي واحد"] },
    whatWeShoot: { en: ["The agreed athlete's matches, from the walk-on to the result", "Warm-up, corner and podium moments where access allows", "Gi and no-gi, one or several divisions on the same day, as agreed"], ar: ["نزالات الرياضي المتفق عليه من الدخول حتى إعلان النتيجة", "لحظات الإحماء والزاوية ومنصة التتويج حيث يسمح الوصول", "بالبدلة أو من دونها، فئة واحدة أو أكثر في اليوم نفسه، حسب الاتفاق"] },
    photoDeliverables: { en: ["Edited photos from the agreed matches, selected and colour-corrected", "Delivered in a private online gallery, ready to download and share", "The number of photos depends on how the day goes and is never promised in advance"], ar: ["صور محررة من النزالات المتفق عليها، منتقاة ومصححة الألوان", "تُسلَّم في معرض إلكتروني خاص جاهزة للتحميل والمشاركة", "عدد الصور يعتمد على مجريات اليوم ولا يُوعد به مسبقًا"] },
    videoDeliverables: { en: ["Video is booked by naming what you want: full-match recordings, edited highlights or reels", "Full-match recording covers the agreed matches only", "Every deliverable is an edited file; raw footage and unedited source material are not provided", "Edits are delivered without music unless the agreement says otherwise"], ar: ["يُحجز الفيديو بتحديد ما تريده: تسجيلات النزالات كاملة أو مونتاج أبرز اللقطات أو ريلز", "تسجيل النزال كاملًا يشمل النزالات المتفق عليها فقط", "كل المخرجات ملفات محررة؛ لا نقدّم اللقطات الخام ولا المواد غير المحررة", "تُسلَّم المونتاجات من دون موسيقى ما لم تنص الاتفاقية على خلاف ذلك"] },
    needFromYou: { en: ["The event, the date and the venue", "The athlete's full name as registered, academy, belt, weight and age division", "A link to the bracket or the athlete's profile when it is published", "Whether the athlete is under 18, so the guardian consent is in the request"], ar: ["اسم الفعالية والتاريخ والمكان", "اسم الرياضي الكامل كما هو مسجل، والأكاديمية، والحزام، والوزن، والفئة العمرية", "رابط جدول النزالات أو ملف الرياضي عند نشره", "ما إذا كان الرياضي دون 18 عامًا، لتُضمَّن موافقة ولي الأمر في الطلب"] },
    bookingSteps: BOOKING_STEPS_EVENT,
    paymentSteps: PAYMENT_STEPS,
    permittedUse: { en: ["Personal use is included: sharing, printing and posting on your own accounts", "Club, team, sponsor or commercial use is confirmed in the quote", "Blue Belt Media may show selected photos in its own portfolio unless you ask otherwise in the request"], ar: ["الاستخدام الشخصي مشمول: المشاركة والطباعة والنشر على حساباتك", "استخدام النادي أو الفريق أو الراعي أو الاستخدام التجاري يُحدَّد في عرض السعر", "يجوز لبلو بلت ميديا عرض صور مختارة في معرض أعمالها ما لم تطلب خلاف ذلك في الطلب"] },
    limitations: { en: ["We cannot promise every match: coverage depends on the schedule, mats running at the same time and venue access", "If the athlete is eliminated early or has only one match, what was shot is still delivered as agreed", "Bracket changes on the day are handled as far as the schedule allows; tell us as soon as you know", "Delivery method and timing are as agreed in your quote"], ar: ["لا يمكننا الوعد بتغطية كل نزال: تعتمد التغطية على الجدول، وتشغيل عدة بُسُط في الوقت نفسه، وإمكانية الوصول داخل الصالة", "إذا خرج الرياضي مبكرًا أو كان له نزال واحد فقط، يُسلَّم ما صُوِّر وفق الاتفاق", "تغييرات الجدول في اليوم نفسه نتعامل معها بقدر ما يسمح الجدول؛ أخبرنا فور علمك", "طريقة التسليم وتوقيته حسب ما اتُّفق عليه في عرض السعر"] },
    cta: { en: "Request tournament coverage", ar: "اطلب تغطية بطولة" },
    metaTitle: { en: "Tournament athlete photography and video in Qatar", ar: "تصوير رياضي في بطولة جوجيتسو في قطر" },
    metaDescription: { en: "One athlete's jiu-jitsu competition day photographed or filmed in Doha: matched from the bracket, followed mat by mat, delivered in a private gallery.", ar: "تغطية يوم بطولة جوجيتسو لرياضي واحد في الدوحة بالصورة أو الفيديو: تحديد من جدول النزالات، متابعة من بساط إلى آخر، وتسليم في معرض خاص." },
    faqIds: ["wins-losses", "one-match-no-match", "athlete-identification", "every-match", "separate-bookings", "raw-footage", "venue-access", "no-show", "postponed-cancelled", "payment"],
  },
  team_tournament: {
    title: { en: "Team tournament coverage", ar: "تغطية فريق في بطولة" },
    short: { en: "A whole academy or team at a competition, quoted per day.", ar: "أكاديمية أو فريق كامل في بطولة، يُسعَّر لكل يوم." },
    lead: { en: "A photographer, a videographer or both for your team's competition day. We work from your roster, cover athletes across mats as the schedule allows and deliver one private gallery the club can share with every athlete.", ar: "مصور فوتوغرافي أو مصور فيديو أو كلاهما ليوم بطولة فريقك. نعمل من قائمة فريقك، ونغطي الرياضيين عبر البُسُط حسب ما يسمح الجدول، ونسلّم معرضًا خاصًا واحدًا يمكن للنادي مشاركته مع كل رياضي." },
    intendedClient: { en: ["Academies and clubs with several athletes competing", "Head coaches and team managers", "National or regional teams at a tournament"], ar: ["الأكاديميات والأندية التي يتنافس منها عدة رياضيين", "المدربون الرئيسيون ومديرو الفرق", "المنتخبات الوطنية أو الإقليمية في البطولات"] },
    whatWeShoot: { en: ["The roster's matches across mats, as the schedule allows", "Team, coach and podium moments where access allows", "The club's presence on the day: warm-ups, corners, celebrations"], ar: ["نزالات الرياضيين في القائمة عبر البُسُط حسب ما يسمح الجدول", "لحظات الفريق والمدرب ومنصة التتويج حيث يسمح الوصول", "حضور النادي في اليوم: الإحماء والزوايا والاحتفالات"] },
    photoDeliverables: { en: ["Edited photos organised by athlete where the roster allows", "One private gallery for the club, shareable with every athlete", "How many athletes can be covered is confirmed in the quote, based on the roster and the schedule"], ar: ["صور محررة مرتبة حسب الرياضي حيث تسمح القائمة", "معرض خاص واحد للنادي يمكن مشاركته مع كل رياضي", "عدد الرياضيين الذين يمكن تغطيتهم يُحدَّد في عرض السعر بناءً على القائمة والجدول"] },
    videoDeliverables: { en: ["Full-match recordings, edited highlights or reels, named in the quote", "For large teams a second camera may be proposed in the quote", "Every deliverable is an edited file; raw footage is not provided", "Edits are delivered without music unless the agreement says otherwise"], ar: ["تسجيلات النزالات كاملة أو مونتاج أبرز اللقطات أو ريلز، تُسمَّى في عرض السعر", "للفرق الكبيرة قد نقترح كاميرا ثانية في عرض السعر", "كل المخرجات ملفات محررة؛ لا نقدّم اللقطات الخام", "تُسلَّم المونتاجات من دون موسيقى ما لم تنص الاتفاقية على خلاف ذلك"] },
    needFromYou: { en: ["The event, the date and the venue", "The roster: names as registered, divisions and, when known, mat assignments", "Which athletes are under 18, so guardian consent can be collected", "One contact at the club for the day"], ar: ["اسم الفعالية والتاريخ والمكان", "القائمة: الأسماء كما هي مسجلة، والفئات، وتوزيع البُسُط عند معرفته", "أي الرياضيين دون 18 عامًا ليتم جمع موافقة أولياء الأمور", "شخص اتصال واحد من النادي لليوم"] },
    bookingSteps: BOOKING_STEPS_EVENT,
    paymentSteps: PAYMENT_STEPS,
    permittedUse: { en: ["Club use for the academy's own channels and website is confirmed in the quote", "Athletes' personal use of their own photos is included", "Sponsor or commercial use is confirmed in the quote"], ar: ["استخدام النادي على قنواته وموقعه يُحدَّد في عرض السعر", "الاستخدام الشخصي للرياضيين لصورهم مشمول", "استخدام الرعاة أو الاستخدام التجاري يُحدَّد في عرض السعر"] },
    limitations: { en: ["We cannot promise every athlete's every match: mats run at the same time and the schedule changes", "Large rosters are covered within the staffing set out in the quote", "Venue rules on where photographers may stand apply", "Delivery method and timing are as agreed in your quote"], ar: ["لا يمكننا الوعد بتغطية كل نزال لكل رياضي: تعمل البُسُط في الوقت نفسه ويتغير الجدول", "تُغطى القوائم الكبيرة ضمن عدد الطاقم المحدد في عرض السعر", "تنطبق قواعد الصالة بشأن أماكن وقوف المصورين", "طريقة التسليم وتوقيته حسب ما اتُّفق عليه في عرض السعر"] },
    cta: { en: "Request a team quote", ar: "اطلب عرض سعر للفريق" },
    metaTitle: { en: "Team and club tournament coverage in Qatar", ar: "تغطية الفرق والأندية في البطولات في قطر" },
    metaDescription: { en: "Photography and video for a whole academy or team at a jiu-jitsu competition in Doha. Roster-based coverage, one private gallery for the club, quoted per day.", ar: "تصوير فوتوغرافي وفيديو لأكاديمية أو فريق كامل في بطولة جوجيتسو في الدوحة. تغطية حسب قائمة الفريق، معرض خاص للنادي، يُسعَّر لكل يوم." },
    faqIds: ["club-team-coverage", "every-match", "separate-bookings", "athlete-identification", "raw-footage", "venue-access", "no-show", "postponed-cancelled", "payment"],
  },
  training_content: {
    title: { en: "Training and gym content", ar: "محتوى التدريب والصالة" },
    short: { en: "Photos or video at your academy during a class, open mat or sparring.", ar: "صور أو فيديو في أكاديميتك أثناء حصة أو بساط مفتوح أو سبارينغ." },
    lead: { en: "A session of the agreed length at your academy: technique, atmosphere and the people who train there. Built for the academy's channels and website, or for an athlete's own content.", ar: "جلسة بالمدة المتفق عليها في أكاديميتك: التقنيات والأجواء والأشخاص الذين يتدربون هناك. مناسبة لقنوات الأكاديمية وموقعها، أو لمحتوى رياضي بعينه." },
    intendedClient: { en: ["Academies and clubs that need content for their channels", "Coaches documenting a programme, a seminar or a belt promotion", "Athletes who want training content of themselves"], ar: ["الأكاديميات والأندية التي تحتاج محتوى لقنواتها", "المدربون الذين يوثقون برنامجًا أو ندوة أو ترقية حزام", "الرياضيون الذين يريدون محتوى تدريب لأنفسهم"] },
    whatWeShoot: { en: ["A regular class, open mat or sparring round, as agreed", "Technique details, drilling and the coach at work", "The space, the team and the atmosphere of the academy"], ar: ["حصة اعتيادية أو بساط مفتوح أو جولة سبارينغ، حسب الاتفاق", "تفاصيل التقنيات والتدريب والمدرب أثناء العمل", "المكان والفريق وأجواء الأكاديمية"] },
    photoDeliverables: { en: ["Edited photos from the session, selected and colour-corrected", "Delivered in a private online gallery", "Formats for web and social use as agreed in the quote"], ar: ["صور محررة من الجلسة، منتقاة ومصححة الألوان", "تُسلَّم في معرض إلكتروني خاص", "صيغ مناسبة للويب ووسائل التواصل حسب ما اتُّفق عليه في عرض السعر"] },
    videoDeliverables: { en: ["Edited highlights or reels, named in the quote", "Edits are delivered without music unless the agreement says otherwise", "Sound from the session is kept where it helps and agreed in advance", "Every deliverable is an edited file; raw footage is not provided"], ar: ["مونتاج أبرز اللقطات أو ريلز، تُسمَّى في عرض السعر", "تُسلَّم المونتاجات من دون موسيقى ما لم تنص الاتفاقية على خلاف ذلك", "يُحتفظ بصوت الجلسة حيث يفيد ويُتفق عليه مسبقًا", "كل المخرجات ملفات محررة؛ لا نقدّم اللقطات الخام"] },
    needFromYou: { en: ["The academy's address and the class or session you have in mind", "Preferred dates and times", "Who should be in the content and who should not, including any minors", "How the content will be used: the academy's channels, an athlete's own accounts, a sponsor"], ar: ["عنوان الأكاديمية والحصة أو الجلسة التي تفكر فيها", "التواريخ والأوقات المفضلة", "من يجب أن يظهر في المحتوى ومن لا يجب، بما في ذلك القاصرون", "كيف سيُستخدم المحتوى: قنوات الأكاديمية، حسابات رياضي، راعٍ"] },
    bookingSteps: BOOKING_STEPS_SESSION,
    paymentSteps: PAYMENT_STEPS,
    permittedUse: { en: ["Use on the academy's own channels and website is confirmed in the quote", "Athletes' personal use of photos they appear in is included", "Sponsor or commercial use is confirmed in the quote"], ar: ["الاستخدام على قنوات الأكاديمية وموقعها يُحدَّد في عرض السعر", "الاستخدام الشخصي للرياضيين للصور التي يظهرون فيها مشمول", "استخدام الرعاة أو الاستخدام التجاري يُحدَّد في عرض السعر"] },
    limitations: { en: ["People who do not want to be photographed are left out; tell us before the session", "Minors appear only with guardian consent", "Lighting and space in the gym shape what is possible; we plan around it with you", "Delivery method and timing are as agreed in your quote"], ar: ["من لا يرغب في التصوير يُستثنى؛ أخبرنا قبل الجلسة", "لا يظهر القاصرون إلا بموافقة ولي الأمر", "إضاءة الصالة ومساحتها تحددان ما هو ممكن؛ نخطط لذلك معك", "طريقة التسليم وتوقيته حسب ما اتُّفق عليه في عرض السعر"] },
    cta: { en: "Request a training session", ar: "اطلب جلسة تدريب" },
    metaTitle: { en: "Training and gym photography and video in Doha", ar: "تصوير التدريب والصالة في الدوحة" },
    metaDescription: { en: "Photos and video at your jiu-jitsu or martial arts academy during a class, open mat or sparring: technique, atmosphere and the people who train there.", ar: "صور وفيديو في أكاديمية الجوجيتسو أو الفنون القتالية أثناء حصة أو بساط مفتوح أو سبارينغ: التقنيات والأجواء والمتدربون." },
    faqIds: ["raw-footage", "payment", "club-team-coverage", "postponed-cancelled"],
  },
  athlete_portrait: {
    title: { en: "Athlete portraits and private sessions", ar: "بورتريهات الرياضيين والجلسات الخاصة" },
    short: { en: "A dedicated session for one athlete: portraits, controlled action, profile and sponsor images.", ar: "جلسة مخصصة لرياضي واحد: بورتريهات، وحركة مدروسة، وصور للملف الشخصي والرعاة." },
    lead: { en: "Planned around one athlete: the look, the location and the shots you need, from a clean profile portrait to controlled action for sponsors and promotion.", ar: "جلسة مخططة حول رياضي واحد: المظهر والموقع واللقطات التي تحتاجها، من بورتريه نظيف للملف الشخصي إلى حركة مدروسة للرعاة والترويج." },
    intendedClient: { en: ["Competitors building a profile or sponsor kit", "Parents who want portraits of a young athlete", "Coaches and academy owners who need professional images of themselves"], ar: ["المتسابقون الذين يبنون ملفًا شخصيًا أو ملف رعاية", "أولياء الأمور الراغبون في بورتريهات لرياضي صغير", "المدربون وأصحاب الأكاديميات الذين يحتاجون صورًا احترافية لأنفسهم"] },
    whatWeShoot: { en: ["Portraits in the gi, in competition kit or in plain clothes", "Controlled action: drilling, positions, movement planned for the camera", "A location you choose, or the academy, as agreed"], ar: ["بورتريهات بالبدلة أو بزي المنافسة أو بملابس عادية", "حركة مدروسة: تمارين ووضعيات وحركة مخططة للكاميرا", "موقع تختاره أنت، أو الأكاديمية، حسب الاتفاق"] },
    photoDeliverables: { en: ["Edited photos, selected and retouched to a natural standard", "Delivered in a private online gallery", "The number of edited photos is set in the quote"], ar: ["صور محررة، منتقاة ومعالجة بمستوى طبيعي", "تُسلَّم في معرض إلكتروني خاص", "عدد الصور المحررة يُحدَّد في عرض السعر"] },
    videoDeliverables: { en: ["Reels or a short edited piece, named in the quote", "Edits are delivered without music unless the agreement says otherwise", "Every deliverable is an edited file; raw footage is not provided"], ar: ["ريلز أو مقطع محرر قصير، تُسمَّى في عرض السعر", "تُسلَّم المونتاجات من دون موسيقى ما لم تنص الاتفاقية على خلاف ذلك", "كل المخرجات ملفات محررة؛ لا نقدّم اللقطات الخام"] },
    needFromYou: { en: ["What the images are for: profile, sponsors, social media, print", "Preferred dates, a location idea and the kit you will bring", "Whether the athlete is under 18, so the guardian consent is in the request", "Any sponsor logos or brand rules we should respect"], ar: ["الغرض من الصور: ملف شخصي، رعاة، وسائل التواصل، طباعة", "التواريخ المفضلة وفكرة عن الموقع والزي الذي ستحضره", "ما إذا كان الرياضي دون 18 عامًا، لتُضمَّن موافقة ولي الأمر في الطلب", "أي شعارات رعاة أو قواعد للعلامة التجارية يجب مراعاتها"] },
    bookingSteps: BOOKING_STEPS_SESSION,
    paymentSteps: PAYMENT_STEPS,
    permittedUse: { en: ["Personal use is included: sharing, printing and posting on your own accounts", "Sponsor, brand or commercial use is confirmed in the quote", "Blue Belt Media may show selected photos in its own portfolio unless you ask otherwise in the request"], ar: ["الاستخدام الشخصي مشمول: المشاركة والطباعة والنشر على حساباتك", "استخدام الرعاة أو العلامات التجارية أو الاستخدام التجاري يُحدَّد في عرض السعر", "يجوز لبلو بلت ميديا عرض صور مختارة في معرض أعمالها ما لم تطلب خلاف ذلك في الطلب"] },
    limitations: { en: ["Private or female-only sessions are offered only when suitable staffing is confirmed for the date; ask in the request", "Locations that need a permit are arranged by you unless the quote says otherwise", "Delivery method and timing are as agreed in your quote"], ar: ["تُقدَّم الجلسات الخاصة أو النسائية فقط عند تأكيد توفر الطاقم المناسب للموعد؛ اسأل عن ذلك في الطلب", "المواقع التي تتطلب تصريحًا تتولى أنت ترتيبها ما لم ينص عرض السعر على خلاف ذلك", "طريقة التسليم وتوقيته حسب ما اتُّفق عليه في عرض السعر"] },
    cta: { en: "Request a portrait session", ar: "اطلب جلسة بورتريه" },
    metaTitle: { en: "Athlete portrait sessions in Doha", ar: "جلسات بورتريه للرياضيين في الدوحة" },
    metaDescription: { en: "A dedicated photo or video session for one jiu-jitsu or martial arts athlete in Qatar: portraits, controlled action, profile and sponsor images.", ar: "جلسة تصوير أو فيديو مخصصة لرياضي جوجيتسو أو فنون قتالية في قطر: بورتريهات، وحركة مدروسة، وصور للملف الشخصي والرعاة." },
    faqIds: ["raw-footage", "payment", "postponed-cancelled", "no-show"],
  },
  organizer_custom: {
    title: { en: "Event and organizer coverage", ar: "تغطية الفعاليات والمنظمين" },
    short: { en: "Official photography and video for a tournament, seminar or grading, quoted per event.", ar: "تصوير فوتوغرافي وفيديو رسمي لبطولة أو ندوة أو ترقية، يُسعَّر لكل فعالية." },
    lead: { en: "Coverage planned with the organiser: mats, podiums, officials, sponsors and the moments that make the day. For tournaments, seminars, gradings, promotions and anything that does not fit the other services.", ar: "تغطية مخططة مع المنظم: البُسُط ومنصات التتويج والحكام والرعاة واللحظات التي تصنع اليوم. للبطولات والندوات والترقيات والفعاليات التي لا تناسبها الخدمات الأخرى." },
    intendedClient: { en: ["Tournament and event organisers", "Federations and governing bodies", "Academies hosting a seminar, a grading or a promotion"], ar: ["منظمو البطولات والفعاليات", "الاتحادات والجهات المنظمة", "الأكاديميات التي تستضيف ندوة أو ترقية أو احتفالًا"] },
    whatWeShoot: { en: ["The event as a whole: mats, podiums, officials, sponsors and the venue", "Key matches or moments you name in advance", "Material for the organiser's channels, sponsors and next year's promotion"], ar: ["الفعالية كاملة: البُسُط ومنصات التتويج والحكام والرعاة والمكان", "النزالات أو اللحظات الرئيسية التي تحددها مسبقًا", "مواد لقنوات المنظم والرعاة والترويج للنسخة القادمة"] },
    photoDeliverables: { en: ["Edited photos organised by the structure agreed with you: by mat, by session or by category", "A private online gallery for the organiser; public event galleries where agreed", "Formats for press, web and social use as set in the quote"], ar: ["صور محررة مرتبة وفق الهيكل المتفق عليه معك: حسب البساط أو الجلسة أو الفئة", "معرض إلكتروني خاص للمنظم؛ ومعارض فعاليات عامة حيث يُتفق على ذلك", "صيغ للصحافة والويب ووسائل التواصل حسب ما يُحدَّد في عرض السعر"] },
    videoDeliverables: { en: ["Full-match recordings of named matches, edited highlights or reels, each named in the quote", "Multi-camera coverage can be proposed for larger events", "Every deliverable is an edited file; raw footage is not provided", "Edits are delivered without music unless the agreement says otherwise"], ar: ["تسجيلات كاملة لنزالات محددة أو مونتاج أبرز اللقطات أو ريلز، تُسمَّى كلها في عرض السعر", "يمكن اقتراح تغطية بعدة كاميرات للفعاليات الكبيرة", "كل المخرجات ملفات محررة؛ لا نقدّم اللقطات الخام", "تُسلَّم المونتاجات من دون موسيقى ما لم تنص الاتفاقية على خلاف ذلك"] },
    needFromYou: { en: ["The event, the dates, the venue and the schedule", "Accreditation or access for the crew, including where cameras may stand", "What the coverage is for and which moments matter most", "Whether a public event gallery should be published"], ar: ["اسم الفعالية والتواريخ والمكان والجدول", "اعتماد أو تصريح وصول للطاقم، بما في ذلك أماكن وقوف الكاميرات", "الغرض من التغطية وأي اللحظات هي الأهم", "ما إذا كان يجب نشر معرض عام للفعالية"] },
    bookingSteps: BOOKING_STEPS_EVENT,
    paymentSteps: PAYMENT_STEPS,
    permittedUse: { en: ["Organiser, sponsor and press use is confirmed in the quote", "Public event galleries, where agreed, let attendees buy their own photos in the gallery", "Blue Belt Media may show selected photos in its own portfolio unless the agreement says otherwise"], ar: ["استخدام المنظم والرعاة والصحافة يُحدَّد في عرض السعر", "معارض الفعاليات العامة، حيث يُتفق عليها، تتيح للحاضرين شراء صورهم داخل المعرض", "يجوز لبلو بلت ميديا عرض صور مختارة في معرض أعمالها ما لم تنص الاتفاقية على خلاف ذلك"] },
    limitations: { en: ["Coverage is planned to the crew size set in the quote; mats running at the same time are covered as that allows", "Access and accreditation are arranged by the organiser", "Delivery method and timing are as agreed in your quote"], ar: ["تُخطط التغطية وفق حجم الطاقم المحدد في عرض السعر؛ وتُغطى البُسُط المتزامنة بقدر ما يسمح ذلك", "يتولى المنظم ترتيب الوصول والاعتماد", "طريقة التسليم وتوقيته حسب ما اتُّفق عليه في عرض السعر"] },
    cta: { en: "Describe your event", ar: "صف فعاليتك" },
    metaTitle: { en: "Event and organizer coverage in Qatar", ar: "تغطية الفعاليات والمنظمين في قطر" },
    metaDescription: { en: "Official photography and video for jiu-jitsu and martial arts tournaments, seminars and gradings in Doha, planned with the organiser and quoted per event.", ar: "تصوير فوتوغرافي وفيديو رسمي لبطولات وندوات وترقيات الجوجيتسو والفنون القتالية في الدوحة، مخطط مع المنظم ويُسعَّر لكل فعالية." },
    faqIds: ["venue-access", "every-match", "club-team-coverage", "raw-footage", "public-gallery", "postponed-cancelled", "payment"],
  },
};

/** Labels for the categories a media item can carry (manifest categories plus a few the media library may use). */
export const MEDIA_CATEGORY_COPY: Record<string, Bilingual> = {
  tournament_action: { en: "Tournament action", ar: "لقطات البطولات" },
  athlete_portrait: { en: "Athlete portraits", ar: "بورتريهات الرياضيين" },
  training_session: { en: "Training", ar: "التدريب" },
  team_club: { en: "Teams and clubs", ar: "الفرق والأندية" },
  coaching_moment: { en: "Coaching", ar: "التدريب والتوجيه" },
  victory_podium: { en: "Podium", ar: "منصة التتويج" },
  behind_the_scenes: { en: "Behind the scenes", ar: "خلف الكواليس" },
  brand_general: { en: "Brand", ar: "العلامة" },
  video_still: { en: "Video stills", ar: "لقطات فيديو" },
  event: { en: "Events", ar: "الفعاليات" },
};

export function mediaCategoryLabel(category: string, locale: Locale): string {
  const known = MEDIA_CATEGORY_COPY[category];
  if (known) return localized(known, locale);
  return category.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function serviceCopy(key: ServiceKey): ServiceCopy {
  return SERVICE_COPY[key];
}

export function audienceCopy(key: AudienceKey): AudienceCopy {
  return AUDIENCE_COPY[key];
}

/** Every bilingual block in this file, flattened, for the completeness test and for proofreading. */
export function allCatalogCopy(): Array<{ path: string; value: Bilingual<string | string[]> }> {
  const out: Array<{ path: string; value: Bilingual<string | string[]> }> = [];
  for (const a of AUDIENCES) for (const [k, v] of Object.entries(AUDIENCE_COPY[a])) out.push({ path: `audience.${a}.${k}`, value: v });
  for (const s of SERVICES) {
    for (const [k, v] of Object.entries(SERVICE_COPY[s])) {
      if (k === "faqIds") continue;
      out.push({ path: `service.${s}.${k}`, value: v as Bilingual<string | string[]> });
    }
  }
  for (const m of MEDIA_SCOPES) for (const [k, v] of Object.entries(MEDIA_SCOPE_COPY[m])) out.push({ path: `media.${m}.${k}`, value: v });
  for (const d of VIDEO_DELIVERABLES) for (const [k, v] of Object.entries(VIDEO_DELIVERABLE_COPY[d])) out.push({ path: `video.${d}.${k}`, value: v });
  for (const c of PROJECT_CATEGORIES) for (const [k, v] of Object.entries(PROJECT_CATEGORY_COPY[c])) out.push({ path: `project.${c}.${k}`, value: v });
  out.push({ path: "payment.policy", value: PAYMENT_POLICY }, { path: "payment.balance", value: PAYMENT_BALANCE_NOTE });
  for (const [c, v] of Object.entries(MEDIA_CATEGORY_COPY)) out.push({ path: `category.${c}`, value: v });
  return out;
}

const PLACEHOLDER_SENTENCE_RE = /\s*[^.!?]*\bset your price\b[^.!?]*[.!?]?/gi;

/**
 * Package descriptions come from the database, where a seed placeholder
 * ("Set your price.") still sits in some rows. The catalog workstream strips
 * it on public read; this is the same rule applied once more at render
 * time so the sentence can never reach a visitor. Null when nothing is left.
 */
export function cleanPublicDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const cleaned = description.replace(PLACEHOLDER_SENTENCE_RE, " ").replace(/\s{2,}/g, " ").trim();
  return cleaned.length ? cleaned : null;
}
