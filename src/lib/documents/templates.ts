import type { DocumentKind } from "@/lib/supabase/database.types";

/**
 * Starter contract bodies, one per document kind. Plain English, written
 * for a combat-sports photography studio in Qatar, with {{merge}} fields
 * filled in when a document is created from the template (see
 * `renderTemplate` in ./state and `mergeValuesFor` in ./merge).
 *
 * These are DRAFTS. Every body starts with a notice saying so; the owner is
 * expected to have them reviewed by a lawyer before relying on them. Pure
 * data: no I/O, safe to import from tests and the templates editor.
 *
 * Policy the wording must reflect (round 3, confirmed by the owner):
 *   - 50% deposit before the booking is confirmed; 50% balance after delivery.
 *   - Cancellation tiers: 7+ days: deposit may be moved once to a new date,
 *     subject to availability; 3 to 6 days: deposit retained; under 72 hours
 *     or no-show: full agreed amount due; event cancelled by the organiser:
 *     reschedule or credit first; refunds where legally required or agreed.
 *     Everything subject to mandatory Qatar consumer protection law.
 *   - Vendors are never named: "payment provider", "gallery hosting
 *     provider", "electronic signature provider".
 *   - No em dashes anywhere in customer-facing text.
 *
 * Clauses a lawyer should look at first (flagged, not invented around):
 *   1. Cancellation tiers, especially "full agreed amount due" under 72
 *      hours and on no-show: may be read as a penalty rather than a genuine
 *      pre-estimate of loss, and consumer law may limit it.
 *   2. "Deposit retained" at 3 to 6 days: same concern as above.
 *   3. Liability caps (refund of fees paid only; no indirect loss).
 *   4. Portfolio and social media use defaulting to "allowed unless the
 *      client opts out", and in particular any publication of a minor.
 *   5. Validity of a typed-name electronic signature under Law No. 16 of
 *      2010 and what evidence must be kept (we keep name, time, network
 *      address, device string and the document hash).
 *   6. Balance payment term after delivery (no number of days is written;
 *      the Studio requests it after delivery) and what happens if it is
 *      never paid, since delivery is not withheld.
 *   7. Guardian release: age threshold (18), proof of guardianship, and
 *      safeguarding wording during sessions with minors.
 */

export const DRAFT_NOTICE = "DRAFT TEMPLATE: review with a lawyer before use. Blue Belt Media makes no claim this text is enforceable until reviewed.";

export const PLACEHOLDER_NOTICE = "Placeholder: needs final legal review.";

const CONSUMER_LAW = "Nothing in this agreement limits any right the Client has under the mandatory consumer protection law of the State of Qatar. Where this agreement and that law differ, the law applies.";

const DELIVERY_TEXT = "Edited images are delivered through a private online gallery hosted by the Studio's gallery hosting provider. The Client receives a link and may download the images included in the service. Unedited (RAW) files are not delivered. Delivery normally takes place within 14 days of the session unless the booking says otherwise; busy tournament periods may take longer and the Studio will keep the Client informed.";

const FEES_TEXT = `The total fee is {{amount}}.
a) Deposit: 50% of the fee ({{deposit}}) is due before the booking is confirmed. The booking is confirmed only when this agreement is signed and the deposit has been received. Until then the date is not reserved.
b) Balance: the remaining 50% ({{balance}}) is due after delivery of the gallery. The Studio sends a payment request after delivery; nothing is charged automatically.
c) Payment is made by secure online payment through the Studio's payment provider, or by another method agreed in writing. The Studio confirms each payment once its payment provider reports it.`;

const CANCELLATION_TEXT = `${PLACEHOLDER_NOTICE}
a) 7 days or more before the date: the deposit may be moved once to a new date, subject to availability. It is not refunded.
b) 3 to 6 days before the date: the deposit is retained by the Studio.
c) Under 72 hours before the date, or no-show: the full agreed amount is due, because the Studio has turned down other work for that date.
d) Event cancelled or postponed by the organiser: the Studio offers a new date or a credit first; a refund where legally required or agreed.
e) If the Studio has to cancel for reasons within its control, all money paid is refunded in full.
f) Refunds are made where legally required or where agreed in writing.
${CONSUMER_LAW}`;

const PORTFOLIO_TEXT = `The Studio may use images from this booking in its portfolio, website, social media and printed samples to show its work. If the Client does not want this, the Client can opt out by writing "No portfolio use" next to their name when signing, or by e-mail at any time, and the Studio will stop new publication within a reasonable time.`;

const SIGNATURE_BLOCK = `SIGNATURE

By typing your full legal name below and ticking the agreement box, you confirm that you have read this agreement, that you understand it and that you agree to be bound by it. This typed-name electronic signature is intended to be a valid electronic signature under Qatar Law No. 16 of 2010 (Electronic Transactions and Commerce). The Studio, or its electronic signature provider, records the date and time of signing, the name typed, and technical details of the device used, and keeps a copy for both parties.

If the client is under 18, this agreement must be signed by a parent or legal guardian, who confirms they have authority to sign on the minor's behalf, and a separate Minor / Guardian Release is also signed.

Signed for the client: ________________________ (typed name)
For {{business_name}}: accepted on sending.
Date: {{today}}`;

const GUARDIAN_SIGNATURE_BLOCK = `SIGNATURE

By typing your full legal name below and ticking the agreement box, you confirm that you are the parent or legal guardian of the Athlete named above, that you have read this release, that you understand it and that you agree to it. This typed-name electronic signature is intended to be a valid electronic signature under Qatar Law No. 16 of 2010 (Electronic Transactions and Commerce). The Studio, or its electronic signature provider, records the date and time of signing, the name typed, and technical details of the device used, and keeps a copy for both parties.

Signed by the parent or legal guardian: ________________________ (typed name)
Parent or legal guardian of: {{athlete_name}}
For {{business_name}}: accepted on sending.
Date: {{today}}`;

const SERVICES_AGREEMENT = `${DRAFT_NOTICE}

PHOTOGRAPHY SERVICES AGREEMENT

Between {{business_name}} ("the Studio") and {{client_name}} ("the Client"). Booking reference: {{booking_ref}}. Date: {{today}}.

1. WHAT IS BOOKED
The Studio will provide the service "{{service_name}}" as described on the booking, on or around {{session_date}} at {{location}}. Any change to the date, time, place or scope must be agreed in writing (e-mail or WhatsApp is fine).

2. DELIVERABLES
${DELIVERY_TEXT}

3. COPYRIGHT AND USE
The Studio owns the copyright in every image and video it creates. The Client receives a personal, non-exclusive, non-transferable licence to use the delivered images for private, non-commercial purposes: sharing with family, friends and on personal social media, and printing for personal use. Commercial use (advertising, sponsorship, merchandise, sale) needs a separate written licence. The Client must not edit, crop out or remove the Studio's credit when images are shared publicly, and should credit {{business_name}} where practical.

4. PORTFOLIO AND SOCIAL MEDIA
${PORTFOLIO_TEXT}

5. FEES AND PAYMENT
${FEES_TEXT}

6. CANCELLATION AND RESCHEDULING
${CANCELLATION_TEXT}

7. LIABILITY
The Studio takes care of its equipment and keeps backups, but if images are lost or unusable through equipment failure, accident, illness or events outside its control, the Studio's liability is limited to a refund of the fees paid for this booking. The Studio is not liable for indirect losses.

8. GOVERNING LAW
This agreement is governed by the laws of the State of Qatar. The parties will try to resolve any disagreement amicably first.

${SIGNATURE_BLOCK}`;

const EVENT_AGREEMENT = `${DRAFT_NOTICE}

COMBAT SPORT EVENT PHOTOGRAPHY SERVICES AGREEMENT

Between {{business_name}} ("the Studio") and {{client_name}} ("the Client") for coverage of {{athlete_name}} at {{event_name}} on {{event_date}} at {{location}}. Booking reference: {{booking_ref}}. Date: {{today}}.

1. SCOPE OF COVERAGE
The Studio will photograph (and, where the booking says so, film) the named athlete's matches at the event. Coverage is "{{service_name}}". The Studio works from the positions the organiser allows and follows all organiser, venue and referee rules.

2. WHAT THE STUDIO CANNOT PROMISE
Tournament schedules change without notice, brackets are re-drawn, mats run late and several matches can start at the same time. The Studio will do its best to track the athlete's matches using the bracket information available, but it cannot guarantee that every match, every exchange or a particular moment will be captured. Missing a match for reasons outside the Studio's control (schedule changes, restricted access, overlapping mats, incorrect bracket data) is not a breach of this agreement.

3. DELIVERABLES
${DELIVERY_TEXT} Video, where booked, is delivered as an edited highlight or full-match clip as described on the booking.

4. COPYRIGHT AND USE
The Studio owns the copyright. The Client receives a personal, non-commercial licence to share and print the delivered images. Clubs, sponsors or brands wanting to use images commercially need a separate written licence. Credit to {{business_name}} is appreciated when images are shared.

5. PORTFOLIO AND SOCIAL MEDIA
${PORTFOLIO_TEXT}

6. FEES AND PAYMENT
${FEES_TEXT}

7. CANCELLATION AND RESCHEDULING
${CANCELLATION_TEXT}

8. MINORS
If the athlete is under 18, this agreement is signed by a parent or legal guardian, who also signs the separate Minor / Guardian Release consenting to the athlete being photographed and filmed at the event.

9. LIABILITY
The Studio's total liability under this agreement is limited to the fees paid for this booking. The Studio is not responsible for the organiser's decisions, access restrictions or results.

10. GOVERNING LAW
This agreement is governed by the laws of the State of Qatar.

${SIGNATURE_BLOCK}`;

const SESSION_AGREEMENT = `${DRAFT_NOTICE}

FIGHTER PORTRAIT SESSION AGREEMENT

Between {{business_name}} ("the Studio") and {{client_name}} ("the Client") for a session with {{athlete_name}}. Service: {{service_name}}. Date and time: {{session_date}}. Place: {{location}}. Booking reference: {{booking_ref}}. Date: {{today}}.

1. THE SESSION
The Studio will photograph (and film where booked) the athlete during the agreed session. The Client is responsible for arriving on time with the agreed kit (gi, rash guard, belts, gloves, club colours). Time lost to late arrival is deducted from the session. Access to the gym or venue is arranged by the Client unless the booking says otherwise.

2. DELIVERABLES
A curated set of edited images is delivered through a private online gallery hosted by the Studio's gallery hosting provider, normally within 14 days. The number of images is as described on the booking. Unedited files are not delivered. Additional edits or images can be ordered separately.

3. COPYRIGHT AND USE
The Studio owns the copyright in all images. The Client receives a personal, non-commercial licence: personal social media, sharing with family and coaches, and personal prints. Use by a club, sponsor or brand needs a separate written licence. Please credit {{business_name}} when sharing.

4. PORTFOLIO AND SOCIAL MEDIA
${PORTFOLIO_TEXT}

5. FEES AND PAYMENT
${FEES_TEXT}

6. CANCELLATION AND RESCHEDULING
${CANCELLATION_TEXT}

7. MINORS
If the athlete is under 18, a parent or legal guardian signs this agreement and the separate Minor / Guardian Release, and must be present or reachable during the session.

8. LIABILITY
Training and demonstration during the session are at the athlete's own risk. The Studio's liability is limited to the fees paid for this booking.

9. GOVERNING LAW
This agreement is governed by the laws of the State of Qatar.

${SIGNATURE_BLOCK}`;

const PRINT_RELEASE = `${DRAFT_NOTICE}

PRINT RELEASE

Issued by {{business_name}} ("the Studio") to {{client_name}} ("the Client"). Booking reference: {{booking_ref}}. Date: {{today}}.

1. WHAT THIS RELEASE DOES
The Studio owns the copyright in the images delivered for this booking ({{service_name}}; event or session: {{event_name}} / {{session_date}}). This release gives the Client permission to print those images, as delivered, for personal use. It does not transfer copyright.

2. PERMITTED USE
The Client may print the delivered images at any lab or at home, in any size, for personal and family use, including framed prints, albums and gifts. The Client may also share the digital files with family and friends for the same purposes.

3. NOT PERMITTED
The Client may not sell the images or prints, use them in advertising, sponsorship or merchandise, enter them in competitions as their own work, or remove the Studio's credit where it appears. Any commercial use needs a separate written licence from the Studio.

4. EDITING
The images are delivered finished. The Client may crop for a print size but should not apply filters, change colours or otherwise alter the images in a way that would misrepresent the Studio's work.

5. CREDIT
Where images are posted publicly, please credit {{business_name}}.

6. TERM
This release is ongoing and does not expire. The Studio may withdraw it only if the Client breaches it.

7. MINORS
If the images show a person under 18, this release is accepted by that person's parent or legal guardian.

8. GOVERNING LAW
This release is governed by the laws of the State of Qatar. ${CONSUMER_LAW}

${SIGNATURE_BLOCK}`;

const MODEL_RELEASE = `${DRAFT_NOTICE}

MODEL / IMAGE RELEASE

Given by {{client_name}} ("the Person", or, for a minor, the parent or legal guardian of {{athlete_name}}) to {{business_name}} ("the Studio"). Booking reference: {{booking_ref}}. Date: {{today}}.

1. CONSENT
The Person agrees that the Studio may photograph and film them (or the named minor) in connection with {{service_name}} on {{session_date}} at {{location}}, and may use the resulting images and video as described below.

2. PERMITTED USE BY THE STUDIO
The Studio may use the images and video in its portfolio, website, social media accounts, printed samples, competition entries and self-promotion, in any format and without time limit. The Studio will not use the images in a way that is misleading, offensive or that suggests the Person endorses an unrelated product or service.

3. NO FEE
Unless agreed separately in writing, no fee is payable for this release. The Person has received the agreed photography services (or complimentary images) in return.

4. OPT-OUT
The Person may withdraw this consent for future use at any time by e-mailing the Studio. The Studio will stop new publication within a reasonable time. Material already printed or published before the request may remain in place.

5. COPYRIGHT
The Studio owns the copyright in the images and video. The Person receives a personal, non-commercial licence to the images delivered to them.

6. MINORS
If the subject is under 18, this release is signed by a parent or legal guardian who confirms they have authority to do so.

7. GOVERNING LAW
This release is governed by the laws of the State of Qatar. ${CONSUMER_LAW}

${SIGNATURE_BLOCK}`;

const GUARDIAN_RELEASE = `${DRAFT_NOTICE}
${PLACEHOLDER_NOTICE}

MINOR / GUARDIAN RELEASE

Given by {{guardian_name}} ("the Guardian"), parent or legal guardian of {{athlete_name}} ("the Athlete"), to {{business_name}} ("the Studio"). Booking reference: {{booking_ref}}. Date: {{today}}.

1. WHO SIGNS
The Athlete is under 18. This release is signed by the Guardian, not by the Athlete. The Guardian confirms that they are the Athlete's parent or legal guardian and have authority to give the consents below. The Studio may ask for proof of that relationship.

2. CONSENT TO PHOTOGRAPH AND FILM
The Guardian agrees that the Studio may photograph and, where booked, film the Athlete in connection with "{{service_name}}" ({{event_name}} / {{session_date}}) at {{location}}, and may deliver the resulting images to the Guardian and the booking contact through a private online gallery hosted by the Studio's gallery hosting provider.

3. USE OF THE ATHLETE'S IMAGES
a) The Guardian receives a personal, non-commercial licence to the delivered images: family use, personal social media and personal prints.
b) The Studio may use images of the Athlete in its portfolio, website and social media to show its work, unless the Guardian opts out by writing "No portfolio use" next to their name when signing or by e-mail at any time. The Studio will stop new publication within a reasonable time.
c) The Studio will not publish the Athlete's full name, school, home area or contact details alongside an image without the Guardian's written agreement.
d) Any commercial use by a club, sponsor or brand needs a separate written licence.

4. SAFEGUARDING DURING SESSIONS
${PLACEHOLDER_NOTICE} The Guardian, or another adult the Guardian names (for example a coach), must be present or reachable during any private session with the Athlete. At tournaments and club training the Studio works in the public competition or training area only.

5. WITHDRAWING CONSENT
The Guardian may withdraw consent for future use at any time by e-mailing the Studio. Material already delivered or published before the request may remain in place unless the law requires otherwise.

6. COPYRIGHT
The Studio owns the copyright in the images and video.

7. GOVERNING LAW
This release is governed by the laws of the State of Qatar. ${CONSUMER_LAW}

${GUARDIAN_SIGNATURE_BLOCK}`;

const CLUB_AGREEMENT = `${DRAFT_NOTICE}

CLUB / TEAM COVERAGE AGREEMENT

Between {{business_name}} ("the Studio") and {{organization_name}} ("the Club"), represented by {{client_name}}. Booking reference: {{booking_ref}}. Date: {{today}}.

1. SCOPE
The Studio will provide "{{service_name}}" for the Club: coverage of the Club's athletes at {{event_name}} on {{event_date}} (or the session on {{session_date}}) at {{location}}, as described on the booking. The Club provides a list of athletes to cover and a contact who is reachable on the day.

2. EVENT CONDITIONS
Coverage at a tournament depends on the organiser's access rules, mat allocation and schedule. The Studio will cover the listed athletes as fully as the day allows but cannot guarantee every match of every athlete, particularly when matches overlap on different mats.

3. DELIVERABLES
Edited images are delivered through a private online gallery hosted by the Studio's gallery hosting provider, normally within 14 days, organised so athletes and parents can find their own photos. Video, where booked, is delivered as described on the booking. Unedited files are not delivered.

4. COPYRIGHT AND LICENCE
The Studio owns the copyright. The Club receives a licence to use the delivered images on its own website and social media accounts, in its newsletters and on noticeboards, with credit to {{business_name}}. Athletes and parents receive a personal, non-commercial licence to their own images. Use in paid advertising, sponsor material or merchandise needs a separate written licence.

5. ATHLETE CONSENT
The Club confirms that it has the consent of each listed athlete (or the parent or legal guardian of each minor) to be photographed and filmed and to have their images shared through the gallery and the Club's channels. The Club will tell the Studio of any athlete who must not be photographed or published.

6. PORTFOLIO USE
The Studio may use images from this booking in its own portfolio and social media. To opt out for the Club as a whole, write "No portfolio use" next to the signature.

7. FEES AND PAYMENT
${FEES_TEXT} Payment requests are issued to the Club.

8. CANCELLATION AND RESCHEDULING
${CANCELLATION_TEXT}

9. LIABILITY
The Studio's total liability under this agreement is limited to the fees paid for this booking.

10. GOVERNING LAW
This agreement is governed by the laws of the State of Qatar.

${SIGNATURE_BLOCK}`;

export type DefaultTemplate = { kind: DocumentKind; name: string; body: string };

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  { kind: "services_agreement", name: "Photography Services Agreement", body: SERVICES_AGREEMENT },
  { kind: "event_agreement", name: "Combat Sport Event Photography Services Agreement", body: EVENT_AGREEMENT },
  { kind: "session_agreement", name: "Fighter Portrait Session Agreement", body: SESSION_AGREEMENT },
  { kind: "print_release", name: "Print Release", body: PRINT_RELEASE },
  { kind: "guardian_release", name: "Minor / Guardian Release", body: GUARDIAN_RELEASE },
  { kind: "model_release", name: "Model / image release", body: MODEL_RELEASE },
  { kind: "club_agreement", name: "Club / team coverage agreement", body: CLUB_AGREEMENT },
];

/** The five kinds the booking flow relies on; `ensureDefaultTemplates` seeds every kind above, these are the ones it must never miss. */
export const CORE_TEMPLATE_KINDS: readonly DocumentKind[] = ["services_agreement", "event_agreement", "session_agreement", "print_release", "guardian_release"];

export function defaultTemplateFor(kind: DocumentKind): DefaultTemplate | null {
  return DEFAULT_TEMPLATES.find((t) => t.kind === kind) ?? null;
}
