import { businessIdentity, businessLegalLine, type BusinessIdentity } from "@/lib/studio/business";
import type { LegalDocument, LegalSection } from "./types";
import { PRIVACY_UPDATED_LABEL, PRIVACY_VERSION } from "./versions";

/** Every topic the privacy policy must cover, in order. Tests check each id is present. */
export const PRIVACY_TOPIC_IDS = [
  "who-we-are",
  "booking-information",
  "contact-data",
  "payment-metadata",
  "gallery-delivery",
  "contracts-signatures",
  "analytics",
  "security",
  "service-providers",
  "retention",
  "your-rights",
  "qatar-context",
  "contact",
] as const;

export function buildPrivacy(id: BusinessIdentity = businessIdentity()): LegalDocument {
  const sections: LegalSection[] = [
    {
      id: "who-we-are",
      title: "Who we are",
      paragraphs: [`${businessLegalLine(id)} ("we", "us") is responsible for the personal information described here. You can reach us at ${id.email}.`],
    },
    {
      id: "booking-information",
      title: "Booking information",
      paragraphs: [
        "When you send a booking request we keep what you typed: the type of coverage, the event or session, the date, the venue, the athlete's name, the club or academy, your notes, who the booking is for and how the photos will be used. We use it to check availability, confirm the booking, plan the day and deliver the work.",
        "If the athlete is under 18 we also keep the name, e-mail and phone number of the parent or guardian and the time they gave consent. We need this to send the guardian release and to know who decides about the child's images.",
      ],
    },
    {
      id: "contact-data",
      title: "Contact data",
      paragraphs: [
        "We use your email and phone number to contact you about your booking, online payment and finished private gallery.",
        "We keep your name, e-mail address, phone or WhatsApp number and, if you gave it, your Instagram handle. We use them to reply to you, to send your booking reference, agreement, payment requests and gallery link, and to reach you on the day of the shoot.",
        "We do not sell your contact data and we do not send marketing messages unless you ask for them.",
      ],
    },
    {
      id: "payment-metadata",
      title: "Payment information",
      paragraphs: [
        "Online payments are taken by our payment provider on its secure page. We never store card numbers. We receive and keep only the payment metadata: the amount, the currency, the date, the payment status, a provider reference and, where the provider gives it, the payment method type and the last digits of the card. We use this to mark your booking as paid, to issue receipts and to handle refunds.",
      ],
    },
    {
      id: "gallery-delivery",
      title: "Gallery delivery",
      paragraphs: [
        "Your photos and video are delivered through a private online gallery run by our gallery hosting provider. To create and send the gallery we share your name and e-mail address with that provider. If you buy photos or prints in the gallery, the provider processes your order and payment under its own privacy policy.",
        "Photos and video from a booking show you, the athlete and, at public events, other people present. We use them to deliver your booking and, unless you tell us not to, to show our work on our website and social media. Images of a person under 18 are never used that way without the written consent of a parent or guardian.",
      ],
    },
    {
      id: "contracts-signatures",
      title: "Agreements and electronic signatures",
      paragraphs: [
        "When you sign an agreement online we record your typed name, the time, the version of the document, your IP address and your browser type as evidence of the signature. The same is recorded when you accept the terms and this policy in the booking form. If we use an electronic signature provider, it processes the document and the signature on our behalf.",
      ],
    },
    {
      id: "analytics",
      title: "Analytics",
      paragraphs: [
        "If analytics are enabled on the website, we use a privacy-focused tool that counts page views and clicks without cookies and without identifying you. It is loaded only on the public website, never in the client portal, on the payment page or on the signing page. If analytics are not enabled, no analytics script is loaded.",
      ],
    },
    {
      id: "security",
      title: "Security",
      paragraphs: [
        "Your data is stored in a managed database with access controls, encrypted in transit and at rest. Gallery, payment and signing links are private, single-purpose links. We limit who at the studio can see your information to the people who deliver your booking.",
      ],
    },
    {
      id: "service-providers",
      title: "Service providers",
      paragraphs: ["We only share information with service providers where needed to deliver your booking, gallery, payment or contract signing.", "We share only what each provider needs to do its part:"],
      bullets: [
        "Payment provider: name, e-mail, phone, amount and booking reference, to take a payment.",
        "Gallery hosting provider: name and e-mail, to create and deliver your gallery.",
        "Electronic signature provider, where used: name and e-mail, to send and record the signed agreement.",
        "E-mail delivery provider: e-mail address and the content of the message we send you.",
        "Hosting and database providers: they store our data on our behalf and do not use it for their own purposes.",
      ],
    },
    {
      id: "retention",
      title: "Retention",
      paragraphs: [
        "We keep booking, agreement and payment records for as long as the law requires for accounting and for the resolution of any dispute, and delete or anonymise them after that. Delivered photos and video are kept for at least 12 months after delivery and may be deleted afterwards. Contact data of a request that never became a booking is deleted after 12 months.",
      ],
    },
    {
      id: "your-rights",
      title: "Your rights",
      paragraphs: [
        `You can ask us at any time what information we hold about you, ask us to correct it, ask us to delete it where we no longer need it, and withdraw consent to the use of your images in our portfolio and social media. Write to ${id.email}. We answer within 30 days. Some records (a signed agreement, a payment) must be kept for the legal period even if you ask for deletion.`,
      ],
    },
    {
      id: "qatar-context",
      title: "Qatar context",
      paragraphs: [
        "We are based in Qatar and process your data under Qatar law, including the Personal Data Privacy Protection Law. Our service providers may store data in other countries under their own safeguards. Nothing in this policy limits any right you have under Qatar law.",
        "This text has been prepared by the studio and should be reviewed by a Qatar-qualified lawyer.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      paragraphs: [`${businessLegalLine(id)}. E-mail ${id.email}.${id.phone ? ` Phone and WhatsApp ${id.phone}.` : ""}`],
    },
  ];

  return {
    title: "Privacy policy",
    version: PRIVACY_VERSION,
    updatedLabel: PRIVACY_UPDATED_LABEL,
    intro: [
      `Last updated ${PRIVACY_UPDATED_LABEL}.`,
      "This policy explains what information we collect when you book, pay, sign and receive your gallery, what we do with it and how to ask about it. It is written in plain language.",
    ],
    sections,
  };
}
