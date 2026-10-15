/**
 * The questions people ask before and after booking, answered in English
 * and Arabic without promises the studio has not approved. Where a policy is
 * not settled, the answer points to the written quote and the question is
 * listed in OPEN_POLICY_QUESTIONS for the owner (never rendered publicly).
 *
 * Rendered on /how-it-works (searchable, by category), as a teaser on the
 * home page, per service on /services/<slug>, and as FAQPage structured data.
 * Pure: no I/O, safe in client components and tests.
 */
import type { Bilingual, Locale } from "@/lib/i18n/locale";
import { localized } from "@/lib/i18n/locale";
import type { FaqCategory as OwnerFaqCategory, FaqOverride } from "@/lib/studio/site-content";
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
  /** Extra search words (both languages) that are not in the question itself. */
  keywords?: string[];
};

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: "photo-vs-video",
    category: "booking",
    featured: true,
    question: { en: "Should I book photography, video, or both?", ar: "هل أحجز تصويرًا فوتوغرافيًا أم فيديو أم الاثنين؟" },
    answer: { en: "Photography gives you edited stills in a private gallery. Video is booked by naming what you want: full-match recordings, edited highlights, reels or raw footage. Both can be booked for the same day. Pick the option you need when you request, and the quote lists exactly what is delivered.", ar: "التصوير الفوتوغرافي يمنحك صورًا محررة في معرض خاص. أما الفيديو فيُحجز بتحديد ما تريده: تسجيلات النزالات كاملة، أو مونتاج أبرز اللقطات، أو ريلز، أو لقطات خام. ويمكن حجز الاثنين لليوم نفسه. اختر ما تحتاجه عند الطلب، ويحدد عرض السعر بالضبط ما سيُسلَّم." },
  },
  {
    id: "full-match-vs-highlights",
    category: "video",
    featured: true,
    question: { en: "What is the difference between a full-match recording and highlights?", ar: "ما الفرق بين تسجيل النزال كاملًا وأبرز اللقطات؟" },
    answer: { en: "A full-match recording is each agreed match from start to finish, trimmed at both ends and otherwise uncut, one file per match. Edited highlights are the strongest moments cut into one short edit. Reels are short vertical clips for social media. Raw footage is the unedited material for your own editor. Edits come without music unless the agreement says otherwise.", ar: "تسجيل النزال كاملًا هو كل نزال متفق عليه من البداية إلى النهاية، مقصوص من الطرفين فقط ومن دون مونتاج، ملف لكل نزال. أما مونتاج أبرز اللقطات فهو أقوى اللحظات في مونتاج قصير واحد. والريلز مقاطع قصيرة عمودية لوسائل التواصل. واللقطات الخام هي المادة غير المحررة لمحرر الفيديو الخاص بك. تُسلَّم المونتاجات من دون موسيقى ما لم تنص الاتفاقية على خلاف ذلك." },
  },
  {
    id: "gi-nogi-divisions",
    category: "coverage",
    question: { en: "The athlete competes in gi and no-gi, or in several divisions. Is that one booking?", ar: "الرياضي يتنافس بالبدلة ومن دونها، أو في عدة فئات. هل هذا حجز واحد؟" },
    answer: { en: "Tell us every division in the request. When they fall on the same day at the same venue we quote them together; divisions on different days are quoted as separate days. What is included is written in the quote.", ar: "اذكر كل الفئات في الطلب. إذا كانت في اليوم نفسه وفي المكان نفسه نسعّرها معًا؛ أما الفئات في أيام مختلفة فتُسعَّر كأيام منفصلة. وما هو مشمول يُكتب في عرض السعر." },
  },
  {
    id: "wins-losses-elimination",
    category: "coverage",
    question: { en: "Do you shoot losses as well as wins? What if the athlete is eliminated early?", ar: "هل تصورون الخسارة كما تصورون الفوز؟ وماذا لو خرج الرياضي مبكرًا؟" },
    answer: { en: "We shoot the matches as they happen, wins and losses alike. If the athlete is eliminated early, everything shot up to that point is edited and delivered as agreed. The booking covers the day, not a number of matches.", ar: "نصوّر النزالات كما تحدث، فوزًا وخسارة. وإذا خرج الرياضي مبكرًا، يُحرَّر كل ما صُوِّر حتى تلك اللحظة ويُسلَّم وفق الاتفاق. الحجز يغطي اليوم وليس عددًا من النزالات." },
  },
  {
    id: "one-match-no-match",
    category: "coverage",
    question: { en: "What if the athlete has only one match, or no match at all?", ar: "ماذا لو كان للرياضي نزال واحد فقط، أو لم يكن له نزال أصلًا؟" },
    answer: { en: "One match is still a full booking: we are at the venue for the day and deliver what was shot, including warm-up and podium moments where access allows. If there is no match because the bracket is empty or the athlete does not compete, what happens next is set out in your written quote.", ar: "النزال الواحد يبقى حجزًا كاملًا: نكون في المكان طوال اليوم ونسلّم ما صُوِّر، بما في ذلك لحظات الإحماء ومنصة التتويج حيث يسمح الوصول. وإذا لم يكن هناك نزال لأن الفئة فارغة أو لأن الرياضي لم يتنافس، فإن ما يحدث بعدها محدد في عرض السعر المكتوب." },
  },
  {
    id: "athlete-identification",
    category: "coverage",
    question: { en: "How do you know which matches are ours, and what if the bracket changes?", ar: "كيف تعرفون أي النزالات لنا، وماذا لو تغير جدول النزالات؟" },
    answer: { en: "We take the athlete's registered name, academy and division before the day and find them on the organiser's bracket. A link to the bracket or the athlete's profile helps. Bracket changes on the day are followed as far as the schedule allows; tell us as soon as you know of one.", ar: "نأخذ اسم الرياضي المسجل وأكاديميته وفئته قبل اليوم ونحدده في جدول المنظم. ويفيد إرسال رابط الجدول أو ملف الرياضي. أما التغييرات في اليوم نفسه فنتابعها بقدر ما يسمح الجدول؛ أخبرنا فور علمك بأي تغيير." },
  },
  {
    id: "simultaneous-mats",
    category: "coverage",
    featured: true,
    question: { en: "Do you cover every match? What about mats running at the same time?", ar: "هل تغطون كل نزال؟ وماذا عن البُسُط التي تعمل في الوقت نفسه؟" },
    answer: { en: "We cannot promise every match. Coverage depends on the schedule, how many mats run at the same time, and where the venue lets photographers stand. For one athlete we follow their bracket mat by mat. For a team, the quote says how many athletes can be covered with the crew booked.", ar: "لا يمكننا الوعد بتغطية كل نزال. تعتمد التغطية على الجدول، وعدد البُسُط التي تعمل في الوقت نفسه، والأماكن التي تسمح الصالة للمصورين بالوقوف فيها. لرياضي واحد نتابع جدوله من بساط إلى آخر. وللفريق، يحدد عرض السعر عدد الرياضيين الذين يمكن تغطيتهم بالطاقم المحجوز." },
  },
  {
    id: "booking-child",
    category: "booking",
    question: { en: "Can I book for my child, or for several children?", ar: "هل يمكنني الحجز لطفلي، أو لعدة أطفال؟" },
    answer: { en: "Yes. Book as a parent or guardian, name each child in the request and confirm the guardian consent there. Several children on the same day are quoted together; the quote says how they are covered when their matches overlap.", ar: "نعم. احجز بصفتك ولي أمر، واذكر اسم كل طفل في الطلب وأكد موافقة ولي الأمر هناك. عدة أطفال في اليوم نفسه يُسعَّرون معًا؛ ويوضح عرض السعر كيف تتم التغطية عندما تتداخل نزالاتهم." },
  },
  {
    id: "team-roster",
    category: "booking",
    question: { en: "We are a club with a large team. How does that work?", ar: "نحن نادٍ بفريق كبير. كيف يتم ذلك؟" },
    answer: { en: "Send the roster with names as registered, divisions and, when known, mat assignments. We quote the day based on the roster and the schedule, including how many photographers or cameras are needed. One private gallery goes to the club, shareable with every athlete.", ar: "أرسل القائمة بالأسماء كما هي مسجلة والفئات وتوزيع البُسُط عند معرفته. نسعّر اليوم بناءً على القائمة والجدول، بما في ذلك عدد المصورين أو الكاميرات المطلوبة. ويُسلَّم معرض خاص واحد للنادي يمكن مشاركته مع كل رياضي." },
  },
  {
    id: "coach-academy-content",
    category: "booking",
    question: { en: "Can you make content for our academy's social media?", ar: "هل يمكنكم إعداد محتوى لحسابات أكاديميتنا؟" },
    answer: { en: "Yes. Training and gym content covers a class, open mat or sparring round at your academy, as photos, reels, edited highlights or raw footage. Use on the academy's channels and website is confirmed in the quote.", ar: "نعم. تغطي خدمة محتوى التدريب والصالة حصة أو بساطًا مفتوحًا أو جولة سبارينغ في أكاديميتك، كصور أو ريلز أو مونتاج أبرز اللقطات أو لقطات خام. ويُحدَّد الاستخدام على قنوات الأكاديمية وموقعها في عرض السعر." },
  },
  {
    id: "organizer-access",
    category: "booking",
    question: { en: "We organise an event. What access do you need?", ar: "نحن ننظم فعالية. ما الذي تحتاجونه من صلاحيات الوصول؟" },
    answer: { en: "Accreditation for the crew, the schedule, and a clear word on where cameras may stand (mat side, podium, officials' area). The organiser arranges access; we plan the coverage around it and set everything out in the quote.", ar: "اعتماد للطاقم، والجدول، وتوضيح أماكن وقوف الكاميرات (جانب البساط، منصة التتويج، منطقة الحكام). يتولى المنظم ترتيب الوصول؛ ونخطط التغطية وفقًا له ونثبّت كل شيء في عرض السعر." },
  },
  {
    id: "venue-restrictions",
    category: "coverage",
    question: { en: "What if the venue restricts where photographers can go?", ar: "ماذا لو قيّدت الصالة أماكن تحرك المصورين؟" },
    answer: { en: "Venue and organiser rules apply to us like everyone else. We work from wherever we are allowed, and coverage of podiums, corners and warm-up areas depends on that access.", ar: "تنطبق علينا قواعد الصالة والمنظم كما تنطبق على الجميع. نعمل من الأماكن المسموح بها، وتعتمد تغطية منصات التتويج والزوايا ومناطق الإحماء على تلك الصلاحيات." },
  },
  {
    id: "private-sessions",
    category: "booking",
    question: { en: "Do you offer private or female-only sessions?", ar: "هل تقدمون جلسات خاصة أو نسائية فقط؟" },
    answer: { en: "Private sessions are available. Female-only sessions are offered only when suitable staffing is confirmed for the date, so ask in the request and we confirm in writing before anything is booked.", ar: "الجلسات الخاصة متاحة. أما الجلسات النسائية فقط فتُقدَّم فقط عند تأكيد توفر الطاقم المناسب للموعد، لذا اسأل عنها في الطلب ونؤكد كتابيًا قبل تثبيت أي حجز." },
  },
  {
    id: "training-location",
    category: "booking",
    question: { en: "Where do training sessions and portraits take place?", ar: "أين تُقام جلسات التدريب والبورتريه؟" },
    answer: { en: "Training content is shot at your academy. Portraits can be at the academy or at a location you choose; a location that needs a permit is arranged by you unless the quote says otherwise. Travel outside Doha is set out in the quote.", ar: "يُصوَّر محتوى التدريب في أكاديميتك. أما البورتريهات فيمكن أن تكون في الأكاديمية أو في موقع تختاره؛ والموقع الذي يتطلب تصريحًا تتولى أنت ترتيبه ما لم ينص عرض السعر على خلاف ذلك. ويُحدَّد السفر خارج الدوحة في عرض السعر." },
  },
  {
    id: "sponsor-club-usage",
    category: "usage",
    featured: true,
    question: { en: "Can we use the photos for our club, a sponsor or advertising?", ar: "هل يمكننا استخدام الصور للنادي أو لراعٍ أو للإعلانات؟" },
    answer: { en: "Personal use is included with every booking. Club, team, sponsor or commercial use is confirmed in the quote when you tell us how the work will be used. Say so in the request so the right licence is in writing from the start.", ar: "الاستخدام الشخصي مشمول في كل حجز. أما استخدام النادي أو الفريق أو الراعي أو الاستخدام التجاري فيُحدَّد في عرض السعر عندما تخبرنا كيف سيُستخدم العمل. اذكر ذلك في الطلب ليكون الترخيص الصحيح مكتوبًا من البداية." },
  },
  {
    id: "delivery-timing",
    category: "delivery",
    featured: true,
    question: { en: "How and when are the photos and video delivered?", ar: "كيف ومتى تُسلَّم الصور والفيديو؟" },
    answer: { en: "In a private online gallery sent to the e-mail you booked with, where you can view, download and share. The delivery method and timing for your booking are as agreed in your written quote.", ar: "في معرض إلكتروني خاص يُرسل إلى البريد الإلكتروني الذي حجزت به، حيث يمكنك المشاهدة والتحميل والمشاركة. وطريقة التسليم وتوقيته لحجزك حسب ما اتُّفق عليه في عرض السعر المكتوب." },
  },
  {
    id: "revisions",
    category: "delivery",
    question: { en: "Can I ask for changes to the edit?", ar: "هل يمكنني طلب تعديلات على المونتاج أو التحرير؟" },
    answer: { en: "Tell us what you would like changed after delivery. What is included as a revision, and what is extra, is set out in your written quote.", ar: "أخبرنا بما تود تغييره بعد التسليم. وما يُعد تعديلًا مشمولًا وما يُعد إضافيًا محدد في عرض السعر المكتوب." },
  },
  {
    id: "raw-files",
    category: "delivery",
    question: { en: "Can I get the raw files?", ar: "هل يمكنني الحصول على الملفات الخام؟" },
    answer: { en: "Raw video footage can be booked as a named deliverable. Unedited photo files are not part of a standard booking; if you need them, ask in the request and the quote says whether and how they are provided.", ar: "يمكن حجز لقطات الفيديو الخام كمخرج محدد بالاسم. أما ملفات الصور غير المحررة فليست جزءًا من الحجز الاعتيادي؛ إذا كنت تحتاجها فاطلبها في الطلب ويوضح عرض السعر ما إذا كانت ستُقدَّم وكيف." },
  },
  {
    id: "watermarks-downloads",
    category: "delivery",
    question: { en: "Are the photos watermarked? Can I download them?", ar: "هل تحمل الصور علامة مائية؟ وهل يمكنني تحميلها؟" },
    answer: { en: "Photos delivered under a booking are downloadable from your private gallery. Which sizes are downloadable, and whether previews carry a watermark before purchase in a public event gallery, is set out in your quote or shown in the gallery itself.", ar: "الصور المسلَّمة ضمن الحجز قابلة للتحميل من معرضك الخاص. أما المقاسات القابلة للتحميل، وما إذا كانت المعاينات تحمل علامة مائية قبل الشراء في معرض فعالية عام، فيُحدَّد في عرض السعر أو يظهر في المعرض نفسه." },
  },
  {
    id: "find-buy-photos",
    category: "delivery",
    featured: true,
    question: { en: "I did not book. Can I still find and buy my photos from an event?", ar: "لم أحجز. هل يمكنني مع ذلك إيجاد صوري من فعالية وشراؤها؟" },
    answer: { en: "When an organiser agrees to a public event gallery, it is published in the same place as private galleries. Use Find my photos to look for the event; photos bought there are paid in the gallery and are separate from bookings.", ar: "عندما يوافق المنظم على معرض عام للفعالية، يُنشر في المكان نفسه الذي تُنشر فيه المعارض الخاصة. استخدم «ابحث عن صوري» للبحث عن الفعالية؛ والصور التي تُشترى هناك تُدفع داخل المعرض وهي منفصلة عن الحجوزات." },
  },
  {
    id: "missing-photos",
    category: "delivery",
    question: { en: "I cannot find myself in an event gallery. What can I do?", ar: "لا أجد نفسي في معرض الفعالية. ماذا أفعل؟" },
    answer: { en: "Write to us with the event, your name as registered, your division and the mat if you know it. Public galleries only show what was shot on the day, and not everyone is photographed at an event we were not booked to follow.", ar: "راسلنا باسم الفعالية واسمك كما هو مسجل وفئتك ورقم البساط إن عرفته. تعرض المعارض العامة ما صُوِّر في اليوم فقط، ولا يُصوَّر الجميع في فعالية لم نُحجز فيها لمتابعتهم." },
  },
  {
    id: "payment-status",
    category: "payment",
    featured: true,
    question: { en: "How does payment work?", ar: "كيف يتم الدفع؟" },
    answer: { en: "Nothing is paid when you send the request. After the scope and the price are confirmed in writing, you pay a 50% deposit by online payment, which secures the booking. The remaining 50% is due after your gallery is delivered. Photos bought in a public event gallery are separate and paid in the gallery.", ar: "لا تدفع شيئًا عند إرسال الطلب. بعد تثبيت النطاق والسعر كتابيًا، تدفع عربونًا بنسبة 50% عبر الدفع الإلكتروني، وبذلك يُؤكَّد الحجز. وتُستحق الـ50% المتبقية بعد تسليم معرضك. أما الصور التي تُشترى من معرض فعالية عام فهي منفصلة وتُدفع داخل المعرض." },
  },
  {
    id: "payment-check",
    category: "payment",
    question: { en: "How do I check whether my deposit or balance has been received?", ar: "كيف أتحقق من استلام العربون أو الباقي؟" },
    answer: { en: "Sign in to the client portal with the e-mail you booked with. Each booking shows its status, what has been paid and what is still due. Payment links are sent by e-mail as well.", ar: "سجّل الدخول إلى بوابة العملاء بالبريد الإلكتروني الذي حجزت به. يعرض كل حجز حالته وما دُفع وما لا يزال مستحقًا. وتُرسل روابط الدفع عبر البريد الإلكتروني أيضًا." },
  },
  {
    id: "client-login",
    category: "account",
    question: { en: "How do I sign in, and what if I lost my gallery link?", ar: "كيف أسجل الدخول، وماذا لو فقدت رابط المعرض؟" },
    answer: { en: "The client portal sends a sign-in link to the e-mail you booked with; there is no password to remember. Your gallery link is in your booking there. If the e-mail address has changed, write to us from the old address or with your booking reference.", ar: "ترسل بوابة العملاء رابط دخول إلى البريد الإلكتروني الذي حجزت به؛ لا توجد كلمة مرور لتذكرها. ورابط معرضك موجود في حجزك هناك. وإذا تغير بريدك الإلكتروني، راسلنا من العنوان القديم أو برقم الحجز المرجعي." },
  },
  {
    id: "cancellation",
    category: "payment",
    question: { en: "What if I need to cancel or reschedule, or the event is postponed?", ar: "ماذا لو احتجت إلى الإلغاء أو تغيير الموعد، أو تأجلت الفعالية؟" },
    answer: { en: "Tell us as early as you can. What happens to the deposit, and whether a new date can be offered, is set out in your written quote and agreement. For postponed events we move with the event where our schedule allows.", ar: "أخبرنا في أقرب وقت ممكن. وما يحدث للعربون، وما إذا كان يمكن تقديم موعد جديد، محدد في عرض السعر والاتفاقية المكتوبة. وفي حال تأجيل الفعالية ننتقل معها حيث يسمح جدولنا." },
  },
  {
    id: "no-show",
    category: "payment",
    question: { en: "What if the athlete does not show up on the day?", ar: "ماذا لو لم يحضر الرياضي في اليوم؟" },
    answer: { en: "The crew is at the venue for the booked day either way. How a no-show is treated is set out in your written quote and agreement.", ar: "يكون الطاقم في المكان في اليوم المحجوز في كل الأحوال. وكيفية التعامل مع عدم الحضور محددة في عرض السعر والاتفاقية المكتوبة." },
  },
  {
    id: "privacy-publication",
    category: "privacy",
    question: { en: "Can I ask that photos of me or my child are not published?", ar: "هل يمكنني طلب عدم نشر صوري أو صور طفلي؟" },
    answer: { en: "Yes. Say so in the request or write to us at any time. Photos from a booking stay in your private gallery; the studio shows work in its portfolio only as agreed, and never minors without the guardian's say.", ar: "نعم. اذكر ذلك في الطلب أو راسلنا في أي وقت. تبقى صور الحجز في معرضك الخاص؛ ويعرض الاستوديو أعماله في معرض أعماله فقط حسب الاتفاق، ولا يعرض القاصرين أبدًا من دون موافقة ولي الأمر." },
  },
  {
    id: "contact-method",
    category: "account",
    question: { en: "How do we stay in touch before the day?", ar: "كيف نبقى على تواصل قبل اليوم؟" },
    answer: { en: "By e-mail, using the address you booked with. The booking reference, the quote, the agreement, payment links and the gallery link all go there, so keep an eye on that inbox.", ar: "عبر البريد الإلكتروني، باستخدام العنوان الذي حجزت به. يُرسل إليه رقم الحجز المرجعي وعرض السعر والاتفاقية وروابط الدفع ورابط المعرض، فتابع ذلك البريد." },
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

/** Client-side filter used by the FAQ explorer: every query word must appear in the item (either language, plus keywords). */
export function filterFaqs(items: readonly FaqItem[], query: string, category: FaqCategory | "all" = "all"): FaqItem[] {
  const words = normalizeForSearch(query).split(" ").filter(Boolean);
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!words.length) return true;
    const hay = normalizeForSearch([item.question.en, item.question.ar ?? "", item.answer.en, item.answer.ar ?? "", ...(item.keywords ?? [])].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/** FAQPage structured data in one language; rendered on /how-it-works only, so the same questions are not claimed by two pages. */
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
  { id: "turnaround", question: "Standard delivery time for photos and for each video deliverable (days after the event / session).", where: "FAQ delivery-timing; service pages (Good to know); process step 5" },
  { id: "revisions", question: "How many revision rounds are included, what counts as a revision, and the price of extra rounds.", where: "FAQ revisions" },
  { id: "raw-photos", question: "Whether unedited photo files are ever supplied, and at what price.", where: "FAQ raw-files" },
  { id: "watermarks", question: "Whether booked-gallery downloads are watermark-free at all sizes, and which sizes are included.", where: "FAQ watermarks-downloads" },
  { id: "cancellation", question: "Cancellation and rescheduling terms: deposit refundable or not, notice periods, and what happens when the event is postponed by the organiser.", where: "FAQ cancellation; terms page" },
  { id: "no-show", question: "No-show and no-match policy: is the deposit kept, is the balance due, is a credit offered.", where: "FAQ no-show; FAQ one-match-no-match" },
  { id: "response-time", question: "A reply-time promise for requests and contact messages (the previous site said 24 hours; not in the approved list).", where: "Contact page; FAQ contact-method; how-it-works" },
  { id: "female-staffing", question: "Whether female-only sessions can be offered and with which staff; the copy says only when staffing is confirmed.", where: "FAQ private-sessions; athlete_portrait limitations" },
  { id: "travel", question: "Travel outside Doha: whether it is offered and how it is charged.", where: "FAQ training-location" },
  { id: "usage-licence", question: "Price and terms of club / sponsor / commercial licences, and the studio's own portfolio use (opt-out wording is currently in the copy).", where: "FAQ sponsor-club-usage; permitted use on every service page" },
  { id: "music", question: "Whether licensed music can be added to edits on request and at what cost; default is without music.", where: "Video deliverable copy" },
  { id: "multi-child", question: "How several children or several divisions on one day are priced (together, per athlete, per division).", where: "FAQ booking-child; FAQ gi-nogi-divisions" },
  { id: "accreditation", question: "Who is responsible when an organiser refuses accreditation after a booking is confirmed.", where: "FAQ organizer-access; FAQ venue-restrictions" },
  { id: "missing-photos", question: "What is offered when a booked athlete has no usable photos from a match (re-shoot, partial refund, nothing).", where: "FAQ missing-photos" },
];
