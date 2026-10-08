import { businessIdentity, businessLegalLine, type BusinessIdentity } from "@/lib/studio/business";
import type { LegalDocument, LegalSection } from "./types";
import { TERMS_UPDATED_LABEL, TERMS_VERSION } from "./versions";

/**
 * The public photography terms, as data. Plain sentences, generic vendor
 * wording only ("payment provider", "gallery hosting provider", "electronic
 * signature provider"), and every cancellation, refund and liability clause
 * explicitly subject to mandatory Qatar consumer protection law.
 */
export const QATAR_CONSUMER_LAW_SENTENCE = "Nothing in these terms limits any right you have under mandatory Qatar consumer protection law.";

export const CANCELLATION_TIERS = [
  "7 days or more before the shoot: your deposit can be moved once to a new date, subject to availability.",
  "3 to 6 days before the shoot: the deposit is retained.",
  "Less than 72 hours before the shoot, or no-show: the full agreed amount is due.",
  "Event cancelled by the organiser: we offer a new date or a credit first.",
  "Refunds are made where the law requires it or where we have agreed to one in writing.",
] as const;

/** Every topic the terms must cover, in order. Tests check each id is present. */
export const TERMS_TOPIC_IDS = [
  "who-we-are",
  "services",
  "booking-requests",
  "booking-confirmation",
  "pricing",
  "deposit",
  "balance",
  "cancellations",
  "rescheduling",
  "event-schedule-changes",
  "event-access",
  "athlete-coverage",
  "team-club-bookings",
  "style",
  "editing",
  "raw-files",
  "delivery",
  "private-galleries",
  "photo-purchases",
  "personal-use-licence",
  "commercial-use",
  "copyright",
  "prohibited-use",
  "screenshots-watermarks",
  "social-media",
  "portfolio-use",
  "minors",
  "public-events",
  "third-party-collaborators",
  "music-third-party-content",
  "client-cooperation",
  "revisions",
  "storage-archive",
  "equipment-data-failure",
  "force-majeure",
  "safety",
  "liability",
  "third-party-service-providers",
  "personal-information",
  "communications",
  "electronic-acceptance",
  "refunds",
  "chargebacks",
  "complaints",
  "website-availability",
  "website-content",
  "prohibited-activity",
  "consumer-rights",
  "changes-to-terms",
  "severability",
  "no-waiver",
  "entire-agreement",
  "governing-law",
  "contact",
  "acceptance",
] as const;

export function buildTerms(id: BusinessIdentity = businessIdentity()): LegalDocument {
  const we = id.legalName;
  const sections: LegalSection[] = [
    {
      id: "who-we-are",
      title: "Who we are",
      paragraphs: [
        `These terms are between you and ${businessLegalLine(id)} ("we", "us", "${we}"). You can reach us at ${id.email} or on ${id.phone}.`,
        "They apply to every booking request, booking, gallery and purchase made through our website, by e-mail or by message. The agreement you sign for a booking adds to these terms. Where the two differ, the signed agreement applies to that booking.",
      ],
    },
    {
      id: "services",
      title: "Our services",
      paragraphs: [
        "We photograph and film jiu-jitsu and martial arts: tournament athletes, tournament and event coverage, club and team days, training sessions, fighter and athlete portrait sessions, private sessions and custom requests.",
        "What is included in a booking (hours, number of athletes, photo, video, or both) is what the services page and your signed agreement say. Anything else is extra and is agreed in writing before the shoot.",
      ],
    },
    {
      id: "booking-requests",
      title: "Booking requests",
      paragraphs: [
        "Sending the booking form is a request, not a booking. It reserves nothing until we confirm it. We check availability and reply within 24 hours on working days, by e-mail, phone or WhatsApp.",
        "You must give accurate details: the right name of the athlete, the event, the date and a working phone number and e-mail address. We rely on these to plan the day and to send your agreement, payment page and gallery.",
      ],
    },
    {
      id: "booking-confirmation",
      title: "Booking confirmation",
      paragraphs: [
        "A booking is confirmed only when both of these have happened: you have signed the agreement we send you, and the 50% deposit has been paid and confirmed by our payment provider.",
        "Until then the date is not held for you, and we may accept another booking for the same date and time.",
      ],
    },
    {
      id: "pricing",
      title: "Pricing",
      paragraphs: [
        "Prices are in Qatari riyal (QAR) and are shown on the services page. Team days, event coverage and custom work are quoted individually.",
        "We confirm the total price with you before you sign and before you pay anything. The price in your signed agreement is the price for that booking. Extra hours, extra athletes or extra deliverables requested later are priced and agreed in writing before we do the work.",
      ],
    },
    {
      id: "deposit",
      title: "50% deposit",
      paragraphs: [
        "A deposit of 50% of the agreed price is due before the booking is confirmed. We send you a secure payment page on our website once you have signed the agreement. The deposit is part of the price, not an extra charge.",
        "The deposit is non-refundable except as set out under cancellations, refunds and consumer rights below. " + QATAR_CONSUMER_LAW_SENTENCE,
      ],
    },
    {
      id: "balance",
      title: "Remaining 50% after delivery",
      paragraphs: [
        "The remaining 50% becomes due after we deliver your gallery. We send a payment request for it at that point; nothing is charged automatically.",
        "Where a booking changed in size after the deposit was paid, the final payment request reflects the agreed changes.",
      ],
    },
    {
      id: "cancellations",
      title: "Cancellations",
      paragraphs: [
        "Tell us as early as you can, in writing (e-mail or WhatsApp). The timing is counted from the start time of the shoot. The following applies unless the law or your signed agreement gives you more:",
      ],
      bullets: [...CANCELLATION_TIERS],
    },
    {
      id: "cancellation-consumer-law",
      title: "Cancellations and the law",
      paragraphs: [
        "The amounts above reflect the time we set aside and the work we cannot sell to anyone else at short notice. " + QATAR_CONSUMER_LAW_SENTENCE + " Where the law gives you a right to cancel or to a refund, that right applies.",
      ],
    },
    {
      id: "rescheduling",
      title: "Rescheduling",
      paragraphs: [
        "If you ask 7 days or more before the shoot, we move your deposit once to a new date, subject to our availability. A second change, or a change with less notice, is treated as a cancellation under the section above unless we agree otherwise in writing.",
        "If we need to move a date (illness, an injury on our side, a clash we could not avoid), we offer the earliest alternative dates. If none works for you, we refund everything you have paid for that booking.",
      ],
    },
    {
      id: "event-schedule-changes",
      title: "Event schedule changes",
      paragraphs: [
        "Tournament schedules, mats and running order are set by the organiser and change on the day. We follow the official bracket and schedule and tell you as soon as we know of a change that affects your coverage.",
        "If the organiser moves your matches to a time or mat we cannot reach, or the event is shortened or cancelled, we tell you what we were able to cover and apply the cancellation section for anything we could not.",
      ],
    },
    {
      id: "event-access",
      title: "Event access and accreditation",
      paragraphs: [
        "At tournaments and other events we can only shoot where the organiser allows media. Where accreditation, a media pass or a ticket is required, we apply for it in good time. If access is refused or limited by the organiser, we tell you before the day where possible and agree how to proceed.",
        "You remain responsible for any entry fees, registrations or permissions that are yours to obtain.",
      ],
    },
    {
      id: "athlete-coverage",
      title: "Athlete coverage",
      paragraphs: [
        "For a tournament athlete booking we follow the athlete's bracket and aim to photograph or film every match they fight. We need the athlete's registered name, division and, where available, the bracket or profile link.",
        "We cannot cover a match we were not told about, a match moved without notice, or a match that overlaps with another booked athlete on a mat we cannot reach in time. Where that happens we tell you and, if a booked match was missed through our fault, we refund the part of the price that relates to it.",
      ],
    },
    {
      id: "team-club-bookings",
      title: "Team and club bookings",
      paragraphs: [
        "A club or team booking is made by the person who signs the agreement on the club's behalf. That person confirms they are allowed to book for the club and to agree these terms for it.",
        "The club is responsible for telling its athletes and, for members under 18, their parents or guardians, that photography and video take place, and for obtaining their consent. The club tells us in writing about any athlete who must not be photographed.",
      ],
    },
    {
      id: "style",
      title: "Photography and video style",
      paragraphs: [
        "You book us for the style you see in our galleries and on our social media. Framing, light, colour and editing choices are ours. We take reasonable requests into account but we do not copy another photographer's style or promise a specific shot.",
      ],
    },
    {
      id: "editing",
      title: "Editing",
      paragraphs: [
        "Delivered photos are selected and edited by us: exposure, colour, crop and clean-up. We do not deliver every frame taken. We do not do heavy retouching (body shaping, removing people, changing results) unless agreed in writing.",
        "Video is edited to the length and format described in your booking.",
      ],
    },
    {
      id: "raw-files",
      title: "RAW and source files",
      paragraphs: [
        "Unedited RAW photos and raw video footage are our working files and are not delivered or sold. They are not part of any booking.",
      ],
    },
    {
      id: "delivery",
      title: "Delivery",
      paragraphs: [
        "Edited photos and video are delivered through a private online gallery. The delivery time is agreed per booking and depends on the size of the shoot and the time of year; tournament weekends take longer than a single session.",
        "We tell you if delivery will be later than agreed. If we miss the agreed delivery time by a long way and that is our fault, you may ask for a partial refund as set out under refunds.",
      ],
    },
    {
      id: "private-galleries",
      title: "Private galleries",
      paragraphs: [
        "Your gallery is private and reachable only by its link, and, where set, a password. Keep the link to yourself and the people you want to share it with; anyone with the link can see the gallery.",
        "Galleries stay online for the period stated in the gallery or your agreement. Download what you want to keep before that period ends.",
      ],
    },
    {
      id: "photo-purchases",
      title: "Individual photo purchases",
      paragraphs: [
        "Photos from public and event galleries can be bought individually inside the gallery at the price shown there. A purchase is complete when the gallery hosting provider confirms the payment and the download or product becomes available.",
        "Digital downloads are delivered immediately and, once delivered, are not returnable except where the law requires it or the file is faulty. Prints and products ordered inside the gallery are made and shipped by the gallery hosting provider under its own terms.",
      ],
    },
    {
      id: "personal-use-licence",
      title: "Personal-use licence",
      paragraphs: [
        "When you book us or buy a photo, we give you a licence to use the delivered photos and video for personal purposes: viewing, sharing with family and friends, posting on your personal social media and printing for yourself. This licence does not expire and is not exclusive.",
      ],
    },
    {
      id: "commercial-use",
      title: "Commercial use",
      paragraphs: [
        "Commercial use needs a separate written licence from us. Commercial use includes advertising, sponsorship content, selling products, use by a brand, academy, federation or media outlet, and any use that promotes a business or paid service.",
        "Club and team bookings include use on the club's own channels to promote the club, unless the agreement says otherwise. Sales of the images by the club are not included.",
      ],
    },
    {
      id: "copyright",
      title: "Copyright",
      paragraphs: [
        `${we} owns the copyright in every photo and video we create, including delivered, edited and unedited files. A booking or purchase gives you a licence to use the images as described in these terms; it does not transfer ownership.`,
      ],
    },
    {
      id: "prohibited-use",
      title: "Prohibited use",
      paragraphs: ["You may not do any of the following with our photos or video without our written permission:"],
      bullets: [
        "Sell, license or give them to a third party for its own use.",
        "Edit them in a way that changes the image substantially, applies heavy filters, crops out our mark, or combines them with other material in a misleading way.",
        "Use them in any content that is unlawful, defamatory or harmful to the people shown.",
        "Enter them into competitions or submit them to publications as your own work.",
        "Use them to train or feed automated image generation systems.",
      ],
    },
    {
      id: "screenshots-watermarks",
      title: "Screenshots and watermarks",
      paragraphs: [
        "Preview images in a gallery carry a watermark and are reduced in size. Taking screenshots or screen recordings of watermarked previews, removing or hiding a watermark, or sharing previews in place of purchased images is not allowed. Purchased and booked images are delivered without a watermark.",
      ],
    },
    {
      id: "social-media",
      title: "Social media",
      paragraphs: [
        "You are welcome to post delivered images on your social media. A credit or tag is appreciated but not required for personal use. Please do not post watermarked previews or apply heavy filters.",
      ],
    },
    {
      id: "portfolio-use",
      title: "Portfolio and promotional use",
      paragraphs: [
        "We may use photos and video from a booking in our portfolio, website, social media and printed samples to show our work. If you do not want this, tell us in the booking form notes, in your agreement or by e-mail at any time, and we will not use your images, or will remove them from our channels within a reasonable time.",
        "We never use images of a person under 18 in this way without the written consent of a parent or guardian.",
      ],
    },
    {
      id: "minors",
      title: "Athletes under 18",
      paragraphs: [
        "A booking for an athlete under 18 must be made by a parent or legal guardian, or by a club with the guardian's consent. The guardian gives their name, e-mail and phone number in the booking form and signs the guardian release we send with the agreement.",
        "The guardian decides how images of the child are used and may withdraw consent for portfolio and promotional use at any time by e-mail.",
      ],
    },
    {
      id: "public-events",
      title: "Public events",
      paragraphs: [
        "Tournaments and open events take place in public, and other athletes, coaches, officials and spectators appear in the background of photos and video. We do not blur or remove them. Event galleries may be made public by agreement with the organiser.",
        "If you do not want to be shown in a public event gallery, tell us and we remove the images of you that we can identify.",
      ],
    },
    {
      id: "third-party-collaborators",
      title: "Third-party collaborators",
      paragraphs: [
        "For large events we may work with a second photographer, a videographer or an editor. They work under our direction and under these terms. We remain responsible to you for the work.",
      ],
    },
    {
      id: "music-third-party-content",
      title: "Music and third-party content",
      paragraphs: [
        "Video is delivered with music we are licensed to use, or without music. If you ask for a specific track, you are responsible for its licence. We do not add logos, graphics or footage you do not have the right to use.",
      ],
    },
    {
      id: "client-cooperation",
      title: "Your cooperation",
      paragraphs: [
        "We need your help to do the job well: accurate athlete and event details, the bracket or profile link where it exists, arrival on time for sessions, and a contact we can reach on the day. If we cannot reach you or the athlete and we cannot find them in the bracket, we may be unable to cover the booking, and the cancellation section applies.",
      ],
    },
    {
      id: "revisions",
      title: "Revisions",
      paragraphs: [
        "If something in a delivered edit is wrong (a colour cast, a wrong crop, a missing match that we did record), tell us within 14 days of delivery and we correct it at no cost. Changes of taste, re-edits of the whole gallery and additional images are quoted separately.",
      ],
    },
    {
      id: "storage-archive",
      title: "Storage and archive",
      paragraphs: [
        "We keep delivered files for at least 12 months after delivery. After that we may delete them without notice. The gallery is not a backup; download and keep your own copy.",
      ],
    },
    {
      id: "equipment-data-failure",
      title: "Equipment and data failure",
      paragraphs: [
        "We use professional equipment, two memory cards where the camera allows it, and backups after every shoot. Cameras, cards and drives can still fail. If images are lost through a failure on our side before delivery, we refund the part of the price that relates to the lost coverage, or re-shoot a session at no cost where that is possible. " + QATAR_CONSUMER_LAW_SENTENCE,
      ],
    },
    {
      id: "force-majeure",
      title: "Events outside our control",
      paragraphs: [
        "Neither side is responsible for failing to perform because of something outside its reasonable control: serious illness or injury, accident, extreme weather, a venue closure, a government order, an organiser's cancellation or a failure of public services. We tell you as soon as we can and agree a new date, a partial delivery or a refund of what you paid for the work not done. " + QATAR_CONSUMER_LAW_SENTENCE,
      ],
    },
    {
      id: "safety",
      title: "Safety",
      paragraphs: [
        "We follow the venue's and the organiser's rules and the instructions of referees and officials. We do not step onto a mat during a match or put ourselves or others at risk for a shot. We may stop a session if it becomes unsafe.",
        "During a private or training session you are responsible for your own warm-up, technique and physical safety. Follow your coach's instructions, not ours.",
      ],
    },
    {
      id: "liability",
      title: "Liability",
      paragraphs: [
        "We are responsible for providing the services with reasonable skill and care. If we fail to do so and you suffer loss as a direct result, our total liability for a booking is limited to the price you paid for that booking, and for a purchase to the price of that purchase.",
        "We are not liable for losses that were not a foreseeable result of our failure, for loss of business or profit, or for events outside our control. Nothing in these terms excludes or limits liability for death or personal injury caused by our negligence, for fraud, or for anything that cannot be limited by law. " + QATAR_CONSUMER_LAW_SENTENCE,
      ],
    },
    {
      id: "third-party-service-providers",
      title: "Third-party service providers",
      paragraphs: [
        "We use a payment provider to take online payments, a gallery hosting provider to deliver galleries and sell photos and prints, and an electronic signature provider to sign agreements. Each provider processes your data under its own terms and privacy policy, which apply to the part of the service it provides. We choose providers that handle card and personal data under recognised security standards.",
      ],
    },
    {
      id: "personal-information",
      title: "Personal information",
      paragraphs: [
        "We collect only what we need to confirm, deliver and invoice a booking, and we handle it as described in our privacy policy. We never store card numbers; the payment provider handles them.",
      ],
    },
    {
      id: "communications",
      title: "Communications",
      paragraphs: [
        "We contact you by e-mail, phone and WhatsApp about your booking: confirmation, agreement, payment requests, schedule changes and gallery delivery. These are part of the service, not marketing. We do not send marketing messages unless you ask for them.",
      ],
    },
    {
      id: "electronic-acceptance",
      title: "Electronic acceptance and signatures",
      paragraphs: [
        "You accept these terms by ticking the boxes in the booking form. You sign your agreement electronically on the page we send you, by typing your name and confirming. We record the time, the version of the text, and technical details such as the IP address as evidence of acceptance.",
        "An electronic signature made this way has the same effect between us as a handwritten one, to the extent Qatar law allows.",
      ],
    },
    {
      id: "refunds",
      title: "Refunds",
      paragraphs: [
        "We refund where the law requires it, where these terms say so, or where we have agreed to it in writing. Refunds go back to the payment method used, through the payment provider, normally within 14 days of our confirmation. We tell you when a refund has been sent. " + QATAR_CONSUMER_LAW_SENTENCE,
      ],
    },
    {
      id: "chargebacks",
      title: "Chargebacks",
      paragraphs: [
        "If you think a payment is wrong, contact us first; most problems are solved in a day. A chargeback raised for a payment you made and a service we provided is disputed with the evidence we hold (signed agreement, delivery record, messages). Raising a chargeback does not cancel the booking or the amounts due under these terms. " + QATAR_CONSUMER_LAW_SENTENCE,
      ],
    },
    {
      id: "complaints",
      title: "Complaints",
      paragraphs: [
        `Write to ${id.email} with your booking reference. We acknowledge within 2 working days and aim to resolve the complaint within 14 days. If you are not satisfied, you may take the matter to the competent consumer protection authority in Qatar or to the courts.`,
      ],
    },
    {
      id: "website-availability",
      title: "Website availability",
      paragraphs: [
        "We try to keep the website, the booking form, the payment page and the signing page available, but we do not promise uninterrupted access. If a page is down, contact us by e-mail or WhatsApp and we complete the step with you another way.",
      ],
    },
    {
      id: "website-content",
      title: "Website content",
      paragraphs: [
        "The text, images and video on this website belong to us or are used with permission. Prices and availability shown on the website may change; the price in your signed agreement is the one that applies. We correct errors when we find them and do not accept a booking at an obviously wrong price.",
      ],
    },
    {
      id: "prohibited-activity",
      title: "Prohibited activity on the website",
      paragraphs: ["You may not:"],
      bullets: [
        "Submit false booking requests, fake contact details or requests on behalf of someone without their permission.",
        "Attempt to access another person's booking, gallery, agreement or payment page.",
        "Scrape, copy or republish content from the website or galleries.",
        "Interfere with the website, the payment page or the signing page, or try to bypass any security measure.",
      ],
    },
    {
      id: "consumer-rights",
      title: "Consumer rights",
      paragraphs: [
        "You have rights under Qatar consumer protection law that these terms cannot take away. Where any part of these terms conflicts with a mandatory right you have, that right applies and the conflicting part does not. Nothing here asks you to waive a mandatory right.",
      ],
    },
    {
      id: "changes-to-terms",
      title: "Changes to these terms",
      paragraphs: [
        "We may update these terms. The date at the top shows the current version. A booking is governed by the version you accepted when you sent it, which we record. Changes do not apply to a booking already made unless they benefit you or the law requires them.",
      ],
    },
    {
      id: "severability",
      title: "Severability",
      paragraphs: ["If any part of these terms is found invalid or unenforceable, the rest continues to apply, and the invalid part is replaced by a valid one that comes closest to its purpose."],
    },
    {
      id: "no-waiver",
      title: "No waiver",
      paragraphs: ["If we do not enforce a part of these terms on one occasion, we can still enforce it later. A waiver is only valid if we give it in writing."],
    },
    {
      id: "entire-agreement",
      title: "Entire agreement",
      paragraphs: ["These terms, our privacy policy, the services page as it stood when you booked, and the agreement you sign make up the whole agreement for a booking. Anything agreed in addition must be in writing (e-mail or message counts)."],
    },
    {
      id: "governing-law",
      title: "Governing law",
      paragraphs: ["These terms are governed by the laws of the State of Qatar. The courts of Qatar have jurisdiction over any dispute, without limiting your right to bring a complaint to a consumer protection authority."],
    },
    {
      id: "contact",
      title: "Contact information",
      paragraphs: [`${businessLegalLine(id)}. E-mail ${id.email}. Phone and WhatsApp ${id.phone}.`],
    },
    {
      id: "acceptance",
      title: "Acceptance",
      paragraphs: ["By sending a booking request, signing an agreement, paying a deposit or buying a photo, you confirm that you have read these terms and agree to them, and that you are 18 or older or booking with the consent of your parent or guardian."],
    },
  ];

  return {
    title: "Photography terms",
    version: TERMS_VERSION,
    updatedLabel: TERMS_UPDATED_LABEL,
    intro: [
      `Last updated ${TERMS_UPDATED_LABEL}.`,
      "These terms explain how booking, paying, delivery and the use of photos and video work with us. They are written in plain language. Where they refer to the law, they mean the law of the State of Qatar.",
      "This text has been prepared by the studio and should be reviewed by a Qatar-qualified lawyer. It does not replace legal advice.",
    ],
    sections,
  };
}
