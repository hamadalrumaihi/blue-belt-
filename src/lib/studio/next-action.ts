import { formatQr } from "@/lib/bookings/state";
import type { PhotoBookingPaymentRequestRow, PhotoBookingRow, PhotoDocumentRow, PhotoGalleryRow } from "@/lib/supabase/database.types";

/**
 * The owner's next move on a booking, per lifecycle state, with a due date
 * where the state implies one and an internal follow-up DRAFT for the chase
 * states. Pure: no I/O. Nothing here is ever sent; the draft is text the
 * owner copies into WhatsApp or e-mail by hand.
 *
 *   inquiry           → Review request / assess price      (due: received + 1 day)
 *   quoted            → Follow up quote                     (due: quoted_at + 3 days)   + draft
 *   awaiting_contract → Send / chase agreement              (due: sent_at + 3 days)     + draft when sent
 *   awaiting_payment  → Chase deposit                       (due: requested + 3 days)   + draft
 *   confirmed         → Prepare shoot brief                 (due: session − 2 days)
 *   in_progress       → Culling / editing (deliver when the gallery is ready)
 *   delivered         → Chase balance / request review      (due: delivered + 7 days)   + draft
 *   completed         → nothing (null)
 */

export const DAY_MS = 86_400_000;
export const QUOTE_FOLLOW_UP_DAYS = 3;
export const AGREEMENT_CHASE_DAYS = 3;
export const DEPOSIT_CHASE_DAYS = 3;
export const BRIEF_LEAD_DAYS = 2;
export const REVIEW_REQUEST_DAYS = 7;
export const INQUIRY_RESPONSE_DAYS = 1;

export type NextActionTone = "info" | "warning" | "danger" | "success" | "muted";

export type NextActionCode =
  | "review_request"
  | "follow_up_quote"
  | "send_agreement"
  | "chase_agreement"
  | "request_deposit"
  | "chase_deposit"
  | "prepare_brief"
  | "mark_shoot_complete"
  | "culling_editing"
  | "deliver_gallery"
  | "chase_balance"
  | "request_review"
  | "complete"
  | "cancelled";

export type FollowUpDraft = {
  /** Short line for an e-mail subject (WhatsApp ignores it). */
  subject: string;
  /** Plain English the owner copies. Never sent by the system. */
  body: string;
};

export type NextAction = {
  code: NextActionCode;
  label: string;
  href: string;
  /** ISO timestamp the action is due by, when the state implies one. */
  due?: string;
  /** `due` is in the past relative to `now`. */
  overdue: boolean;
  tone: NextActionTone;
  /** Internal follow-up draft for the chase states; null otherwise. */
  draft: FollowUpDraft | null;
};

export type NextActionBooking = Pick<
  PhotoBookingRow,
  | "id"
  | "booking_status"
  | "customer_name"
  | "public_ref"
  | "package_name"
  | "amount_qr"
  | "deposit_qr"
  | "balance_qr"
  | "balance_state"
  | "contract_state"
  | "requires_contract"
  | "quoted_at"
  | "session_at"
  | "coverage_done_at"
  | "delivered_at"
  | "gallery_delivered_at"
  | "created_at"
>;

export type NextActionContext = {
  documents?: Array<Pick<PhotoDocumentRow, "status" | "sent_at" | "required_for_confirmation">>;
  paymentRequests?: Array<Pick<PhotoBookingPaymentRequestRow, "stage" | "status"> & Partial<Pick<PhotoBookingPaymentRequestRow, "created_at">>>;
  gallery?: Pick<PhotoGalleryRow, "status" | "pictime_url"> | null;
  /** Pricing assessment (workstream D), when one exists for this booking. */
  assessment?: { status: string; href?: string | null } | null;
  now?: Date;
};

const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
const minusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() - days * DAY_MS).toISOString();

function firstName(name: string): string {
  const n = name.trim().split(/\s+/)[0];
  return n || "there";
}

function finish(a: Omit<NextAction, "overdue" | "tone"> & { tone?: NextActionTone }, now: Date): NextAction {
  const overdue = Boolean(a.due && new Date(a.due).getTime() < now.getTime());
  const tone: NextActionTone = overdue ? "danger" : a.tone ?? (a.draft ? "warning" : "info");
  return { ...a, overdue, tone };
}

/** The one thing to do next, or null when the booking is completed. */
export function nextActionFor(b: NextActionBooking, ctx: NextActionContext = {}): NextAction | null {
  const now = ctx.now ?? new Date();
  const href = `/bookings/${b.id}`;
  const requests = ctx.paymentRequests ?? [];
  const pending = (stage: "deposit" | "balance") => requests.find((r) => r.stage === stage && r.status === "pending") ?? null;

  switch (b.booking_status) {
    case "completed":
      return null;
    case "cancelled":
      return finish({ code: "cancelled", label: "Cancelled. Nothing to do.", href, draft: null, tone: "muted" }, now);
    case "inquiry": {
      const assessHref = ctx.assessment?.href ?? `/pricing/quote?booking=${b.id}`;
      return finish({ code: "review_request", label: "Review request / assess price", href: Number(b.amount_qr) > 0 ? href : assessHref, due: plusDays(b.created_at, INQUIRY_RESPONSE_DAYS), draft: null, tone: "warning" }, now);
    }
    case "quoted":
      return finish({ code: "follow_up_quote", label: "Follow up quote", href, due: b.quoted_at ? plusDays(b.quoted_at, QUOTE_FOLLOW_UP_DAYS) : undefined, draft: followUpDraft(b, "follow_up_quote") }, now);
    case "awaiting_contract": {
      const sent = (ctx.documents ?? []).filter((d) => d.status === "sent" || d.status === "viewed");
      if (b.contract_state === "sent" || sent.length) {
        const sentAt = sent.map((d) => d.sent_at).filter((v): v is string => Boolean(v)).sort()[0];
        return finish({ code: "chase_agreement", label: "Chase agreement signature", href: `${href}#contract`, due: sentAt ? plusDays(sentAt, AGREEMENT_CHASE_DAYS) : undefined, draft: followUpDraft(b, "chase_agreement") }, now);
      }
      return finish({ code: "send_agreement", label: "Send agreement for signature", href: `${href}#contract`, draft: null, tone: "warning" }, now);
    }
    case "awaiting_payment": {
      const req = pending("deposit");
      if (req) return finish({ code: "chase_deposit", label: "Chase deposit", href: `${href}#payment`, due: req.created_at ? plusDays(req.created_at, DEPOSIT_CHASE_DAYS) : undefined, draft: followUpDraft(b, "chase_deposit") }, now);
      return finish({ code: "request_deposit", label: "Create and send the deposit link", href: `${href}#payment`, draft: followUpDraft(b, "chase_deposit"), tone: "warning" }, now);
    }
    case "confirmed": {
      if (b.session_at && new Date(b.session_at).getTime() < now.getTime() && !b.coverage_done_at) {
        return finish({ code: "mark_shoot_complete", label: "Shoot date passed: mark the shoot complete", href: `${href}#delivery`, due: b.session_at, draft: null }, now);
      }
      return finish({ code: "prepare_brief", label: "Prepare shoot brief", href: `${href}/brief`, due: b.session_at ? minusDays(b.session_at, BRIEF_LEAD_DAYS) : undefined, draft: null }, now);
    }
    case "in_progress": {
      if (ctx.gallery?.status === "ready" && ctx.gallery.pictime_url) return finish({ code: "deliver_gallery", label: "Gallery ready: deliver it", href: `${href}#delivery`, draft: null, tone: "success" }, now);
      return finish({ code: "culling_editing", label: "Culling / editing", href: "/production", draft: null }, now);
    }
    case "delivered": {
      const deliveredAt = b.gallery_delivered_at ?? b.delivered_at;
      if (b.balance_state === "due" && Number(b.balance_qr) > 0) {
        return finish({ code: "chase_balance", label: pending("balance") ? "Chase final balance" : "Request the final balance", href: `${href}#payment`, due: deliveredAt ? plusDays(deliveredAt, REVIEW_REQUEST_DAYS) : undefined, draft: followUpDraft(b, "chase_balance") }, now);
      }
      return finish({ code: "request_review", label: "Request a review, then complete", href, due: deliveredAt ? plusDays(deliveredAt, REVIEW_REQUEST_DAYS) : undefined, draft: followUpDraft(b, "request_review") }, now);
    }
    default:
      return null;
  }
}

/**
 * Internal follow-up drafts. Plain, short, no vendor names. The owner copies
 * and adapts them; the system never sends them.
 */
export function followUpDraft(b: Pick<NextActionBooking, "customer_name" | "public_ref" | "package_name" | "amount_qr" | "deposit_qr" | "balance_qr">, kind: "follow_up_quote" | "chase_agreement" | "chase_deposit" | "chase_balance" | "request_review"): FollowUpDraft {
  const name = firstName(b.customer_name);
  const ref = b.public_ref ? ` (${b.public_ref})` : "";
  switch (kind) {
    case "follow_up_quote":
      return {
        subject: `Your Blue Belt Media quote${ref}`,
        body: `Hi ${name}, following up on the quote for ${b.package_name}${ref}: ${formatQr(b.amount_qr)}. Happy to adjust the scope if that helps. Shall I hold the date for you? A request only becomes a booking once the agreement is signed and the deposit is in, so let me know if you want to go ahead.`,
      };
    case "chase_agreement":
      return {
        subject: `Agreement to sign${ref}`,
        body: `Hi ${name}, the agreement for ${b.package_name}${ref} is waiting for your signature. It takes a minute on your phone. Once it is signed I will send the deposit link and the date is yours.`,
      };
    case "chase_deposit":
      return {
        subject: `Deposit to confirm your booking${ref}`,
        body: `Hi ${name}, to confirm ${b.package_name}${ref} the deposit of ${formatQr(b.deposit_qr)} is still open. The booking is confirmed as soon as it lands; until then the date is not reserved. Tell me if you need the link again or prefer a bank transfer.`,
      };
    case "chase_balance":
      return {
        subject: `Final balance${ref}`,
        body: `Hi ${name}, glad the gallery is with you. The remaining balance of ${formatQr(b.balance_qr)} for ${b.package_name}${ref} is now due. The payment link is in your portal; a bank transfer works too. Thank you.`,
      };
    case "request_review":
      return {
        subject: `How did it go?${ref}`,
        body: `Hi ${name}, thanks again for ${b.package_name}${ref}. If you are happy with the photos, a sentence or two about the experience would help other athletes and clubs decide. With your permission I would put it on the website with your first name.`,
      };
  }
}

/** Soonest-due first, undated last; used by the Overview priorities column. */
export function sortByDue<T extends { action: NextAction | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = a.action?.due ?? "9999";
    const db = b.action?.due ?? "9999";
    return da.localeCompare(db);
  });
}
