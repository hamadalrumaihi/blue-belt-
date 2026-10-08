import { confirmationBlockers, type BookingBlocker, type GateBooking } from "@/lib/bookings/gates";
import type { BalanceState, BookingStatus, BookingType, DepositState, PaymentMethod, PaymentMode, PaymentStage, PhotoBookingPaymentRequestRow, PhotoBookingRow } from "@/lib/supabase/database.types";

/**
 * Booking lifecycle (photo_bookings.booking_status). Pure: no I/O, shared by
 * server actions, the public booking flow, the client portal and tests.
 *
 *   inquiry → quoted → awaiting_contract → awaiting_payment → confirmed
 *           → in_progress → delivered → completed            (+ cancelled)
 *
 * Steps may be skipped forwards (a cash booking goes inquiry → confirmed) and
 * stepped back one stage by the owner to correct a mistake. `completed` is
 * terminal; `cancelled` can be reopened to `inquiry`.
 */
export const BOOKING_STATUSES = ["inquiry", "quoted", "awaiting_contract", "awaiting_payment", "confirmed", "in_progress", "delivered", "completed", "cancelled"] as const satisfies readonly BookingStatus[];

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  inquiry: ["quoted", "awaiting_contract", "awaiting_payment", "confirmed", "cancelled"],
  quoted: ["inquiry", "awaiting_contract", "awaiting_payment", "confirmed", "cancelled"],
  awaiting_contract: ["quoted", "awaiting_payment", "confirmed", "cancelled"],
  awaiting_payment: ["awaiting_contract", "confirmed", "cancelled"],
  confirmed: ["awaiting_payment", "in_progress", "delivered", "cancelled"],
  in_progress: ["confirmed", "delivered", "completed", "cancelled"],
  delivered: ["in_progress", "completed"],
  completed: [],
  cancelled: ["inquiry"],
};

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  inquiry: "Inquiry",
  quoted: "Quote sent",
  awaiting_contract: "Awaiting agreement",
  awaiting_payment: "Awaiting deposit",
  confirmed: "Confirmed",
  in_progress: "In progress",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** What the client sees. Plain words, no internal stages, no vendor names. */
export const BOOKING_STATUS_CLIENT_LABEL: Record<BookingStatus, string> = {
  inquiry: "Request received",
  quoted: "Quote ready",
  awaiting_contract: "Agreement to sign",
  awaiting_payment: "Deposit due",
  confirmed: "Booking confirmed",
  in_progress: "Editing",
  delivered: "Gallery delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const BOOKING_TYPES = ["tournament_athlete", "club", "training_session", "private_session", "custom"] as const satisfies readonly BookingType[];

export const BOOKING_TYPE_LABEL: Record<BookingType, string> = {
  tournament_athlete: "Tournament athlete coverage",
  club: "Team / club coverage",
  training_session: "Training session",
  private_session: "Private athlete session",
  custom: "Other / custom coverage",
};

export const PAYMENT_MODES = ["instant", "link_later", "manual", "quote"] as const satisfies readonly PaymentMode[];

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  instant: "Pay now (card)",
  link_later: "Payment link sent later",
  manual: "Cash / bank transfer / Fawran",
  quote: "Custom quote first",
};

export const PAYMENT_METHODS = ["myfatoorah", "cash", "bank_transfer", "fawran", "other"] as const satisfies readonly PaymentMethod[];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  myfatoorah: "MyFatoorah",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  fawran: "Fawran",
  other: "Other",
};

export function isBookingStatus(v: unknown): v is BookingStatus {
  return typeof v === "string" && (BOOKING_STATUSES as readonly string[]).includes(v);
}
export function isBookingType(v: unknown): v is BookingType {
  return typeof v === "string" && (BOOKING_TYPES as readonly string[]).includes(v);
}
export function isPaymentMode(v: unknown): v is PaymentMode {
  return typeof v === "string" && (PAYMENT_MODES as readonly string[]).includes(v);
}
export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function isTerminalBooking(status: BookingStatus): boolean {
  return status === "completed";
}

/** Columns to write when a booking enters `to` at `now` (timestamps are set once). */
export function bookingTransitionColumns(booking: Pick<PhotoBookingRow, "quoted_at" | "confirmed_at" | "delivered_at" | "completed_at" | "cancelled_at">, to: BookingStatus, now: Date): Partial<PhotoBookingRow> {
  const iso = now.toISOString();
  const cols: Partial<PhotoBookingRow> = { booking_status: to };
  if (to === "quoted" && !booking.quoted_at) cols.quoted_at = iso;
  if (to === "confirmed" && !booking.confirmed_at) cols.confirmed_at = iso;
  if (to === "delivered" && !booking.delivered_at) cols.delivered_at = iso;
  if (to === "completed" && !booking.completed_at) cols.completed_at = iso;
  if (to === "cancelled") cols.cancelled_at = iso;
  if (to === "inquiry") {
    cols.cancelled_at = null;
    cols.cancel_reason = null;
  }
  return cols;
}

/**
 * Where a brand-new booking starts. Booking never requires payment: a quote
 * and a priced service both start as an inquiry the owner reviews and
 * confirms; a service that requires a contract waits for it first; only a
 * free (0 QAR) service is confirmed at once. Payment is requested after the
 * shoot (see canRequestPayment) and never decides the initial stage.
 */
export function initialBookingStatus(input: { paymentMode: PaymentMode; amountQr: number; requiresContract: boolean }): BookingStatus {
  if (input.paymentMode === "quote") return "inquiry";
  if (input.requiresContract) return "awaiting_contract";
  if (input.amountQr <= 0) return "confirmed";
  return "inquiry";
}

/** The shoot is done once the owner marked it (coverage_done_at). */
export function isShootComplete(b: Pick<PhotoBookingRow, "coverage_done_at">): boolean {
  return Boolean(b.coverage_done_at);
}

/** Lifecycle stages in which a payment may be requested (the shoot happened or is under way). */
export const PAYABLE_BOOKING_STATUSES: readonly BookingStatus[] = ["confirmed", "in_progress", "delivered", "completed"];

export type PaymentRequestBooking = Pick<PhotoBookingRow, "coverage_done_at" | "amount_qr" | "booking_status" | "status" | "amount_paid_qr" | "manual_paid_at"> & Partial<Pick<PhotoBookingRow, "deposit_state" | "deposit_qr" | "balance_state" | "balance_qr">>;

/**
 * Why a payment cannot be requested yet, or null when it can. The customer
 * pays online only after the shoot, for the final amount the owner recorded,
 * and only while something is still due.
 */
export function paymentRequestBlocker(b: PaymentRequestBooking): "shoot_not_complete" | "no_amount" | "wrong_stage" | "already_paid" | "refunded" | null {
  if (!isShootComplete(b)) return "shoot_not_complete";
  if (!(Number(b.amount_qr) > 0)) return "no_amount";
  if (!PAYABLE_BOOKING_STATUSES.includes(b.booking_status)) return "wrong_stage";
  const state = effectivePayment(b).state;
  if (state === "paid") return "already_paid";
  if (state === "refunded") return "refunded";
  return null;
}

export function canRequestPayment(b: PaymentRequestBooking): boolean {
  return paymentRequestBlocker(b) === null;
}

export const PAYMENT_REQUEST_BLOCKER_LABEL: Record<NonNullable<ReturnType<typeof paymentRequestBlocker>>, string> = {
  shoot_not_complete: "Mark the shoot complete first.",
  no_amount: "Record the final amount first.",
  wrong_stage: "Confirm the booking first.",
  already_paid: "This booking is already paid.",
  refunded: "This booking was refunded through MyFatoorah.",
};

export type EffectivePayment = { state: "unpaid" | "partial" | "paid" | "refunded"; source: "provider" | "manual" | "none"; paidQr: number; dueQr: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The stage columns, when the caller passed a full booking row (legacy callers and old tests pass only the summary columns). */
type StageColumns = Partial<Pick<PhotoBookingRow, "deposit_state" | "deposit_qr" | "balance_state" | "balance_qr">>;

function hasStageColumns(b: StageColumns): b is Required<StageColumns> {
  return typeof b.deposit_state === "string" && typeof b.balance_state === "string";
}

/**
 * One answer to "is this booking paid?". With the round 3 stage columns the
 * deposit and the balance are counted separately: paid stages add up, waived
 * stages are not owed, and the provider status only says who verified the
 * money. Without stage columns (legacy callers) the provider status wins and
 * manual records fill in cash / bank / Fawran.
 */
export function effectivePayment(b: Pick<PhotoBookingRow, "status" | "amount_qr" | "amount_paid_qr" | "manual_paid_at"> & StageColumns): EffectivePayment {
  const amount = round2(Number(b.amount_qr) || 0);
  if (b.status === "refunded") return { state: "refunded", source: "provider", paidQr: 0, dueQr: amount };
  const manual = Number(b.amount_paid_qr) || 0;
  if (hasStageColumns(b)) {
    const stagePaid = (b.deposit_state === "paid" ? Number(b.deposit_qr) || 0 : 0) + (b.balance_state === "paid" ? Number(b.balance_qr) || 0 : 0);
    const waived = (b.deposit_state === "waived" ? Number(b.deposit_qr) || 0 : 0) + (b.balance_state === "waived" ? Number(b.balance_qr) || 0 : 0);
    const paid = round2(Math.max(stagePaid, manual));
    const due = round2(Math.max(0, amount - paid - waived));
    const source: EffectivePayment["source"] = paid <= 0 ? "none" : b.status === "paid" ? "provider" : "manual";
    if (amount > 0 && due <= 0) return { state: "paid", source: source === "none" ? "provider" : source, paidQr: paid, dueQr: 0 };
    if (paid <= 0) return { state: "unpaid", source: "none", paidQr: 0, dueQr: due };
    return { state: "partial", source, paidQr: paid, dueQr: due };
  }
  if (b.status === "paid") return { state: "paid", source: "provider", paidQr: amount, dueQr: 0 };
  if (manual <= 0) return { state: "unpaid", source: "none", paidQr: 0, dueQr: amount };
  if (manual >= amount) return { state: "paid", source: "manual", paidQr: manual, dueQr: 0 };
  return { state: "partial", source: "manual", paidQr: manual, dueQr: Math.max(0, amount - manual) };
}

export const PAYMENT_STATE_LABEL: Record<EffectivePayment["state"], string> = { unpaid: "Unpaid", partial: "Partly paid", paid: "Paid", refunded: "Refunded" };

// ---------------------------------------------------------------------------
// Round 3: deposit before confirmation, balance after delivery
// ---------------------------------------------------------------------------

export const PAYMENT_STAGES = ["deposit", "balance"] as const satisfies readonly PaymentStage[];

export function isPaymentStage(v: unknown): v is PaymentStage {
  return typeof v === "string" && (PAYMENT_STAGES as readonly string[]).includes(v);
}

export type StageBooking = Pick<PhotoBookingRow, "amount_qr" | "currency" | "deposit_percent" | "deposit_qr" | "balance_qr" | "deposit_state" | "balance_state">;

/** Owner wording for the deposit column. */
export const DEPOSIT_STATE_LABEL: Record<DepositState, string> = { not_required: "Not required", pending: "Pending", paid: "Paid", waived: "Waived" };
/** Owner wording for the balance column. */
export const BALANCE_STATE_LABEL: Record<BalanceState, string> = { not_due: "Not due", due: "Due", paid: "Paid", waived: "Waived" };

/** Amount with its currency code, for e-mails and the pay page ("500 QAR"). */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0";
  return `${n.toLocaleString("en-QA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${(currency || "QAR").toUpperCase()}`;
}

/** The server-side amount of one stage: deposit_qr or balance_qr from the booking row, never from the browser. */
export function stageAmount(b: Pick<StageBooking, "deposit_qr" | "balance_qr">, stage: PaymentStage): number {
  return round2(Number(stage === "deposit" ? b.deposit_qr : b.balance_qr) || 0);
}

/** Plain words for a stage: "deposit (50%)" / "remaining balance (50%)". */
export function stageWords(b: Pick<StageBooking, "deposit_percent">, stage: PaymentStage): string {
  const pct = Number(b.deposit_percent);
  const depositPct = Number.isFinite(pct) && pct > 0 ? pct : 50;
  return stage === "deposit" ? `deposit (${depositPct}%)` : `remaining balance (${Math.max(0, 100 - depositPct)}%)`;
}

/** Short owner label: "Deposit 50%" / "Remaining 50%". */
export function stageLabel(b: Pick<StageBooking, "deposit_percent">, stage: PaymentStage): string {
  const pct = Number(b.deposit_percent);
  const depositPct = Number.isFinite(pct) && pct > 0 ? pct : 50;
  return stage === "deposit" ? `Deposit ${depositPct}%` : `Remaining ${Math.max(0, 100 - depositPct)}%`;
}

/** True while a stage is still open for payment: the deposit until it is paid, the balance only once delivery made it due. */
export function isStageOpen(b: Pick<StageBooking, "deposit_state" | "balance_state">, stage: PaymentStage): boolean {
  return stage === "deposit" ? b.deposit_state === "pending" : b.balance_state === "due";
}

export type ManualStageOption = { stage: PaymentStage; open: boolean; reason: string | null };

/** Which stages the owner may still settle by hand (the manual payment sheet). A stage paid online is never overridden. */
export function manualPaymentStages(b: Pick<StageBooking, "deposit_state" | "balance_state">, requests: Array<Pick<PhotoBookingPaymentRequestRow, "stage" | "status">> = []): ManualStageOption[] {
  return PAYMENT_STAGES.map((stage) => {
    const paidOnline = requests.some((r) => r.stage === stage && r.status === "paid");
    const open = isStageOpen(b, stage) && !paidOnline;
    const reason = open ? null : paidOnline ? "Paid online." : stage === "deposit" ? (b.deposit_state === "paid" ? "Paid." : "Not required.") : b.balance_state === "paid" ? "Paid." : b.balance_state === "not_due" ? "Not due until delivery." : "Not required.";
    return { stage, open, reason };
  });
}

export type DeliveryBooking = Pick<PhotoBookingRow, "booking_status" | "delivered_at" | "gallery_delivered_at" | "balance_state" | "balance_qr" | "balance_due_at">;

/**
 * Columns written when the owner explicitly delivers the gallery: the
 * booking becomes delivered and the remaining balance becomes due (only when
 * there is one). Timestamps are set once. Never touches deposit columns.
 */
export function deliveryColumns(b: DeliveryBooking, now: Date): Partial<PhotoBookingRow> & { balanceBecameDue: boolean } {
  const iso = now.toISOString();
  const cols: Partial<PhotoBookingRow> = { gallery_delivered_at: b.gallery_delivered_at ?? iso };
  if (b.booking_status !== "delivered" && b.booking_status !== "completed" && b.booking_status !== "cancelled") {
    cols.booking_status = "delivered";
    if (!b.delivered_at) cols.delivered_at = iso;
  }
  let balanceBecameDue = false;
  if (b.balance_state === "not_due") {
    if (Number(b.balance_qr) > 0) {
      cols.balance_state = "due";
      cols.balance_due_at = b.balance_due_at ?? iso;
      balanceBecameDue = true;
    } else {
      // Nothing left to pay (free booking, or the deposit covered everything): nothing is owed.
      cols.balance_state = "waived";
    }
  }
  return { ...cols, balanceBecameDue };
}

/** A delivered booking whose money is settled (deposit and balance paid, waived or not required) may be completed. */
export function isCompletionReady(b: Pick<PhotoBookingRow, "booking_status" | "deposit_state" | "balance_state" | "balance_qr">): boolean {
  if (b.booking_status !== "delivered") return false;
  const depositDone = b.deposit_state === "paid" || b.deposit_state === "waived" || b.deposit_state === "not_required";
  const balanceDone = b.balance_state === "paid" || b.balance_state === "waived" || (b.balance_state === "not_due" && !(Number(b.balance_qr) > 0));
  return depositDone && balanceDone;
}

export type NextActionBooking = GateBooking & Pick<PhotoBookingRow, "coverage_done_at" | "deposit_qr" | "balance_qr" | "balance_state" | "contract_state">;

export type NextAction = { code: "set_price" | "approve_quote" | "send_agreement" | "await_signature" | "request_deposit" | "await_deposit" | "shoot" | "edit" | "deliver" | "request_balance" | "await_balance" | "complete" | "done" | "cancelled"; text: string; blockers: BookingBlocker[] };

/**
 * The one thing the owner should do next, derived from the booking columns
 * and the stage requests. Pure; the booking page shows it at the top.
 */
export function nextActionFor(b: NextActionBooking, requests: Array<Pick<PhotoBookingPaymentRequestRow, "stage" | "status">> = []): NextAction {
  const blockers = confirmationBlockers(b);
  const pendingFor = (stage: PaymentStage) => requests.some((r) => r.stage === stage && r.status === "pending");
  if (b.booking_status === "cancelled") return { code: "cancelled", text: "This booking is cancelled.", blockers: [] };
  if (b.booking_status === "completed") return { code: "done", text: "Completed. Nothing more to do.", blockers: [] };
  if (["inquiry", "quoted", "awaiting_contract", "awaiting_payment"].includes(b.booking_status)) {
    if (!(Number(b.amount_qr) > 0)) return { code: "set_price", text: "Set the price.", blockers };
    if (b.booking_status === "inquiry") return { code: "approve_quote", text: "Approve the quote.", blockers };
    if (blockers.some((x) => x.code === "contract_unsigned" || x.code === "guardian_release_unsigned")) {
      return b.contract_state === "sent" ? { code: "await_signature", text: "Waiting for the client to sign the agreement.", blockers } : { code: "send_agreement", text: "Send the agreement for signature.", blockers };
    }
    if (blockers.some((x) => x.code === "deposit_unpaid")) {
      return pendingFor("deposit") ? { code: "await_deposit", text: "Waiting for the deposit payment.", blockers } : { code: "request_deposit", text: "Create the deposit payment link.", blockers };
    }
    return { code: "shoot", text: "Ready to confirm.", blockers };
  }
  if (b.booking_status === "confirmed") return { code: "shoot", text: b.coverage_done_at ? "Mark the shoot complete." : "Shoot day. Mark the shoot complete afterwards.", blockers: [] };
  if (b.booking_status === "in_progress") return { code: "deliver", text: "Editing. Add the gallery link, then deliver the gallery.", blockers: [] };
  if (b.booking_status === "delivered") {
    if (b.balance_state === "due") return pendingFor("balance") ? { code: "await_balance", text: "Waiting for the final balance payment.", blockers: [] } : { code: "request_balance", text: "Create the final balance payment link.", blockers: [] };
    return { code: "complete", text: "Mark the booking completed.", blockers: [] };
  }
  return { code: "done", text: "", blockers: [] };
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short human reference for clients and receipts, e.g. BB-7K3PQ2. Uniqueness is enforced by the DB index; callers retry on collision. */
export function makePublicRef(random: () => number = Math.random): string {
  let out = "BB-";
  for (let i = 0; i < 6; i += 1) out += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return out;
}

export function formatQr(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-QA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} QAR`;
}

/** Typed view of photo_bookings.details (free-form per booking type). All keys optional. */
export type BookingDetails = {
  instagram?: string;
  athlete_name?: string;
  academy?: string;
  belt?: string;
  age_division?: string;
  weight_division?: string;
  gi?: "gi" | "no-gi" | "both";
  coverage?: "photo" | "video" | "both";
  source_url?: string;
  competition_date?: string;
  athlete_count?: number;
  wants_photographer?: boolean;
  wants_videographer?: boolean;
  requested_date?: string;
  requested_time?: string;
  consent_accepted_at?: string;
  booked_for?: "self" | "child" | "athlete" | "club";
};

export function bookingDetails(b: Pick<PhotoBookingRow, "details">): BookingDetails {
  const d = b.details;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as BookingDetails) : {};
}
