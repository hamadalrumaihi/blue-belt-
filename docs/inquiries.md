# Contact & Inquiries

The public contact page (`/contact`) is a lead-capture form, not a FAQ. Every message becomes a `photo_inquiries` row with its own reference, category, optional customer reference, source page, status pipeline and private notes, worked by the owner from `/inquiries`.

## Public form (`src/app/(public)/contact`)

| Field | Required | Notes |
| --- | --- | --- |
| Full name | yes | |
| Email address | yes | lower-cased; matched to an existing CRM person by e-mail only (never by phone), never overwriting their details |
| Inquiry type | yes | 13 categories (`src/lib/inquiries/labels.ts`); `?type=<category>` preselects one, so every "Discuss a project" / "Get a quote" / "Ask about this" link on the site lands on the right category |
| Booking / order reference | no | shown by default for Booking questions, Existing order / gallery, Payment & billing and Technical support; one tap away for every other category; accepts booking, order, gallery or invoice references |
| Subject | yes | |
| Message | yes | |

Hidden: honeypot (`extra_notes_check`), consent checkbox, a per-mount idempotency key and `source_page` (from `?from=<path>`, site-relative paths only).

## Submission (`submitInquiry` in `src/lib/actions/public.ts`)

1. Per-IP sliding-window rate limit (`RULES.publicFormPerIp`, shared with the booking wizard).
2. `parseInquiryForm` (pure, `src/lib/inquiries/form.ts`) validates and sanitises every field.
3. The CRM person is found or created (service role).
4. One `photo_inquiries` row is inserted with an `IQ-XXXXXX` reference (retried on collision; a replayed idempotency key returns the existing row).
5. Owner Telegram message (`INQUIRY_NEW`, alert key `inquiry:<ref>:new`) and the customer's acknowledgment e-mail (`INQUIRY_RECEIVED`, switchable under Notifications) are queued in the existing outbox; the delivery runner sends and retries them.
6. The page redirects to `/contact?sent=<ref>`; that state renders only for a well-formed reference, and the action never reports success before the row exists. A notification failure after the row is written is logged, never surfaced.

## Owner side

- `/inquiries` (owner only): filter by status and type, search by reference / name / e-mail / subject / message, change status (New, In progress, Waiting for customer, Quoted, Converted to booking, Resolved, Closed), add private notes, convert to a quote-first booking (`convertInquiryToBooking`: a `custom`/matching booking type, amount 0, agreement required, linked both ways, race-safe).
- Overview: "Open inquiries" card and new / in-progress inquiries in "Requests needing an answer".
- Metrics (`/studio/metrics#inquiries`): total, new, quoted, converted, by category and status.
- Workspace search (`/studio?q=`) finds inquiries by reference, name, e-mail, subject or customer reference.
- Audit log: `inquiry.created` (public actor), `inquiry.status`, `inquiry.note`, `inquiry.converted`.

## Database

`supabase/migrations/20261019100000_inquiries.sql` (additive): table, unique `(owner_id, reference)` and `(owner_id, idempotency_key)`, status/category checks, `updated_at` trigger, studio-user RLS, grants to `authenticated` and `service_role`, nothing for `anon`. `supabase/tests/inquiries_rls.test.sql` covers isolation and the constraints (`npm run test:db`).
