import "server-only";
import { listBookings, NEEDS_ACTION_STATUSES, upcomingBookings, type BookingListRow } from "@/lib/bookings/queries";
import { BOOKING_STATUS_LABEL, effectivePayment, formatQr } from "@/lib/bookings/state";
import { countOpenIssues } from "@/lib/incidents/queries";
import { inRange, monthMoney, monthRange, OUTSTANDING_STATUSES, summariseMoney, type MoneySummary, type MonthRange } from "@/lib/payments/ledger";
import { nextActionFor, sortByDue, type NextAction } from "@/lib/studio/next-action";
import { openQuestionCounts } from "@/lib/studio/site-content";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus, DocumentStatus, PaymentRequestStatus, PaymentStage, PhotoAuditLogRow, PhotoBookingRow, PhotoEventRow, PhotoGalleryRow, PhotoIncidentRow, PhotoLeadRow, PhotoPaymentRecordRow } from "@/lib/supabase/database.types";
import { formatEventDate } from "@/lib/time";

/**
 * Studio dashboard: what needs the owner's attention today, this month's
 * money, what is coming up and what just happened. The summarisers are pure
 * (tested); `loadStudioDashboard` is the only reader.
 */

export type TodayCounts = {
  upcomingShoots: number;
  needsAction: number;
  paymentsAwaiting: number;
  contractsAwaiting: number;
  galleriesAwaiting: number;
  openIssues: number;
  failedDeliveries: number;
};

/** Pure: counts from already-loaded rows. */
export function summariseToday(input: {
  upcoming: Array<Pick<PhotoBookingRow, "id">>;
  bookings: Array<Pick<PhotoBookingRow, "booking_status" | "status" | "amount_qr" | "amount_paid_qr" | "manual_paid_at"> & Partial<Pick<PhotoBookingRow, "deposit_state" | "deposit_qr" | "balance_state" | "balance_qr">>>;
  documents: Array<{ status: string }>;
  galleries: Array<{ status: string }>;
  openIssues: number;
  failedDeliveries: number;
}): TodayCounts {
  const needsAction = input.bookings.filter((b) => NEEDS_ACTION_STATUSES.includes(b.booking_status)).length;
  const paymentsAwaiting = input.bookings.filter((b) => {
    if (b.booking_status === "cancelled" || b.booking_status === "completed") return false;
    const p = effectivePayment(b);
    return Number(b.amount_qr) > 0 && (p.state === "unpaid" || p.state === "partial");
  }).length;
  return {
    upcomingShoots: input.upcoming.length,
    needsAction,
    paymentsAwaiting,
    contractsAwaiting: input.documents.filter((d) => d.status === "sent" || d.status === "viewed").length,
    galleriesAwaiting: input.galleries.filter((g) => g.status === "ready").length,
    openIssues: input.openIssues,
    failedDeliveries: input.failedDeliveries,
  };
}

export type UpcomingItem = { kind: "booking" | "event"; id: string; href: string; at: string; title: string; subtitle: string; status?: BookingStatus };

/** Pure: bookings (with a session) and events in the next `days` days, soonest first. */
export function upcomingItems(bookings: BookingListRow[], events: Array<Pick<PhotoEventRow, "id" | "name" | "event_date" | "venue">>, now: Date, days = 14): UpcomingItem[] {
  const end = new Date(now.getTime() + days * 86_400_000);
  const today = now.toISOString().slice(0, 10);
  const items: UpcomingItem[] = [];
  for (const b of bookings) {
    if (!b.session_at) continue;
    const at = new Date(b.session_at);
    if (at > end || at.getTime() < now.getTime() - 60 * 60_000) continue;
    items.push({ kind: "booking", id: b.id, href: `/bookings/${b.id}`, at: b.session_at, title: b.customer_name, subtitle: [b.package_name, b.athlete_name || null, b.location].filter(Boolean).join(" · "), status: b.booking_status });
  }
  for (const e of events) {
    if (!e.event_date || e.event_date < today || e.event_date > end.toISOString().slice(0, 10)) continue;
    items.push({ kind: "event", id: e.id, href: `/events/${e.id}`, at: `${e.event_date}T00:00:00.000Z`, title: e.name, subtitle: [formatEventDate(e.event_date, "short"), e.venue].filter(Boolean).join(" · ") });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export type ActivityItem = { id: number; at: string; text: string; href: string | null; actor: string };

const ENTITY_PATH: Record<string, string> = { booking: "/bookings", person: "/people", organization: "/clubs", document: "/documents", gallery: "/galleries", lead: "/leads", order: "/orders", studio: "/website" };

function stageName(v: unknown): string {
  return v === "balance" ? "Final balance" : "Deposit";
}

function dataOf(row: Pick<PhotoAuditLogRow, "data">): Record<string, unknown> {
  return row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
}

/** Pure: one audit row → a short sentence and the page it concerns. */
export function describeAudit(row: Pick<PhotoAuditLogRow, "id" | "entity" | "entity_id" | "action" | "data" | "created_at" | "actor_kind">): ActivityItem {
  const d = dataOf(row);
  const label = (v: unknown) => (typeof v === "string" ? v : "");
  let text: string;
  switch (row.action) {
    case "booking.created":
      text = `Booking created (${label(d.source) || "manual"})`;
      break;
    case "booking.updated":
      text = "Booking details updated";
      break;
    case "booking.status": {
      const to = label(d.to) as BookingStatus;
      text = `Booking → ${BOOKING_STATUS_LABEL[to] ?? to}${label(d.reason) ? ` (${label(d.reason)})` : ""}`;
      break;
    }
    case "payment.manual":
      text = `Manual payment recorded: ${formatQr(Number(d.amount_qr))}${label(d.method) ? ` by ${label(d.method).replace("_", " ")}` : ""}`;
      break;
    case "payment.manual_deleted":
      text = `Manual payment removed: ${formatQr(Number(d.amount_qr))}`;
      break;
    case "booking.invoice_created":
      text = `MyFatoorah payment link created (${formatQr(Number(d.amount_qr))})`;
      break;
    case "booking.shoot_complete":
      text = "Shoot marked complete";
      break;
    case "booking.final_amount":
      text = `Final amount recorded: ${formatQr(Number(d.amount_qr))}`;
      break;
    case "booking.payment_requested":
      text = `Online payment requested: ${formatQr(Number(d.due_qr ?? d.amount_qr))}`;
      break;
    case "payment.session_started":
      text = `Client started an online payment (${formatQr(Number(d.amount_qr))}${label(d.stage) ? `, ${label(d.stage)}` : ""})`;
      break;
    case "booking.price_set":
      text = `Price set: ${formatQr(Number(d.amount_qr))} (deposit ${formatQr(Number(d.deposit_qr))}, balance ${formatQr(Number(d.balance_qr))})`;
      break;
    case "booking.quote_approved":
      text = `Quote approved: ${formatQr(Number(d.amount_qr))}`;
      break;
    case "payment_request.created":
      text = `${stageName(d.stage)} payment link created: ${formatQr(Number(d.amount_qr))}${label(d.provider) === "MANUAL_LINK" ? " (pasted link)" : ""}`;
      break;
    case "payment_request.regenerated":
      text = `${stageName(d.stage)} payment link regenerated (generation ${Number(d.generation) || "?"})`;
      break;
    case "payment_request.manual_link":
      text = `${stageName(d.stage)} payment link pasted from the provider dashboard`;
      break;
    case "payment_request.sent":
      text = `${stageName(d.stage)} payment link sent to the client${d.email_queued === false ? " (e-mail not queued)" : ""}`;
      break;
    case "payment_request.cancelled":
      text = `${stageName(d.stage)} payment link cancelled${label(d.reason) ? ` (${label(d.reason)})` : ""}`;
      break;
    case "deposit.paid":
      text = `Deposit paid: ${formatQr(Number(d.amount_qr))}${label(d.source) === "manual" ? " (recorded by hand)" : " (verified online)"}`;
      break;
    case "balance.due":
      text = `Final balance due: ${formatQr(Number(d.balance_qr))}`;
      break;
    case "balance.paid":
      text = `Final balance paid: ${formatQr(Number(d.amount_qr))}${label(d.source) === "manual" ? " (recorded by hand)" : " (verified online)"}`;
      break;
    case "gallery.url_added":
      text = "Gallery link saved";
      break;
    case "gallery.delivered":
      text = `Gallery delivered${d.balanceDue ? ", final balance now due" : ""}`;
      break;
    case "booking.completed":
      text = `Booking completed${label(d.reason) ? ` (${label(d.reason)})` : ""}`;
      break;
    case "booking.athlete_linked":
      text = "Booking linked to a tracked athlete";
      break;
    case "booking.athlete_unlinked":
      text = "Tracked athlete unlinked from booking";
      break;
    case "booking.athlete_created":
      text = "Tracked athlete created from booking";
      break;
    case "booking.coverage_assigned":
      text = "Coverage assigned";
      break;
    case "booking.production_stage":
      text = `Production → ${label(d.to).replace(/_/g, " ") || "?"}`;
      break;
    case "lead.status":
      text = `Lead → ${label(d.status) || "?"}`;
      break;
    case "website.testimonial_added":
    case "website.testimonial_updated":
      text = `Testimonial ${row.action.endsWith("added") ? "added" : "updated"}${d.published ? " (published)" : ""}`;
      break;
    case "website.faq_added":
    case "website.faq_updated":
      text = `FAQ ${row.action.endsWith("added") ? "added" : "updated"}${d.published ? " (published)" : ""}`;
      break;
    case "website.question_added":
      text = "Open question noted";
      break;
    case "website.question_resolved":
      text = "Open question resolved";
      break;
    default:
      text = row.action.replace(/[._]/g, " ");
  }
  const base = ENTITY_PATH[row.entity];
  const href = row.entity === "studio" ? (row.action.startsWith("website.") ? (row.action.includes("testimonial") ? "/website/testimonials" : "/website/faqs") : null) : base && row.entity_id ? `${base}/${row.entity_id}` : base ?? null;
  return { id: row.id, at: row.created_at, text, href, actor: row.actor_kind };
}

export type StudioDashboard = {
  today: TodayCounts;
  money: MoneySummary & { range: MonthRange };
  upcoming: UpcomingItem[];
  activity: ActivityItem[];
  needsAction: BookingListRow[];
};

export async function loadStudioDashboard(now: Date = new Date()): Promise<StudioDashboard> {
  const supabase = await createClient();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const [upcoming7, upcoming14, bookings, documents, galleries, openIssues, failed, events, audit, money] = await Promise.all([
    upcomingBookings(7, now),
    upcomingBookings(14, now),
    supabase.from("photo_bookings").select("booking_status,status,amount_qr,amount_paid_qr,manual_paid_at,deposit_state,deposit_qr,balance_state,balance_qr").neq("booking_status", "cancelled").limit(2000),
    supabase.from("photo_documents").select("status").in("status", ["sent", "viewed"]).limit(500),
    supabase.from("photo_galleries").select("status").eq("status", "ready").limit(500),
    countOpenIssues(),
    supabase.from("photo_notification_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", dayAgo),
    supabase.from("photo_events").select("id,name,event_date,venue").eq("active", true).limit(100),
    supabase.from("photo_audit_log").select("*").order("created_at", { ascending: false }).limit(15),
    monthMoney(now),
  ]);
  const needsAction = await listBookings({ filter: "needs_action", limit: 8 });
  return {
    today: summariseToday({ upcoming: upcoming7, bookings: bookings.data ?? [], documents: documents.data ?? [], galleries: galleries.data ?? [], openIssues, failedDeliveries: failed.count ?? 0 }),
    money,
    upcoming: upcomingItems(upcoming14, events.data ?? [], now, 14),
    activity: (audit.data ?? []).map(describeAudit),
    needsAction,
  };
}

// ---------------------------------------------------------------------------
// Overview (round 4): priorities, requests, money split, delivery, incidents
// ---------------------------------------------------------------------------

export type PriorityRow = { booking: BookingListRow; action: NextAction };

export type RequestItem = { kind: "lead" | "booking"; id: string; href: string; title: string; subtitle: string; at: string; status: string };

export type DeliveryItem = { galleryId: string; bookingId: string | null; name: string; customer: string | null; readyAt: string | null; hasUrl: boolean };

export type MoneySplit = {
  range: MonthRange;
  /** Confirmed (or later) bookings whose confirmation falls in the month: what was booked, not what was paid. */
  forecastMonthQr: number;
  /** Payment records (provider + manual) whose paid_at falls in the month. */
  collectedMonthQr: number;
  /** Balance still due on live bookings, regardless of month. */
  outstandingQr: number;
  /** Amount of every live booking (awaiting payment → delivered): the pipeline the outstanding sits in. */
  forecastLiveQr: number;
  /** Live bookings with money still owed. */
  outstandingCount: number;
};

/** Pure: forecast vs collected, split so the two are never read as the same number. */
export function splitMoney(
  bookings: Array<Pick<PhotoBookingRow, "booking_status" | "confirmed_at" | "amount_qr" | "status" | "amount_paid_qr" | "manual_paid_at"> & Partial<Pick<PhotoBookingRow, "deposit_state" | "deposit_qr" | "balance_state" | "balance_qr">>>,
  records: Array<Pick<PhotoPaymentRecordRow, "amount_qr" | "paid_at">>,
  range: MonthRange,
): MoneySplit {
  const m = summariseMoney(bookings, records, range);
  const live = bookings.filter((b) => OUTSTANDING_STATUSES.includes(b.booking_status));
  const outstandingCount = live.filter((b) => effectivePayment(b).dueQr > 0).length;
  const forecastLive = live.reduce((s, b) => s + Number(b.amount_qr || 0), 0);
  return { range, forecastMonthQr: m.bookedQr, collectedMonthQr: m.receivedQr, outstandingQr: m.outstandingQr, forecastLiveQr: Math.round(forecastLive * 100) / 100, outstandingCount };
}

/** Pure: website requests still waiting for a reply (new / contacted leads, inquiry / quoted bookings), oldest first. */
export function requestsNeedingAction(leads: Array<Pick<PhotoLeadRow, "id" | "status" | "source" | "created_at" | "booking_type" | "message"> & { person?: { full_name: string } | null }>, bookings: BookingListRow[]): RequestItem[] {
  const out: RequestItem[] = [];
  for (const l of leads) {
    if (l.status !== "new" && l.status !== "contacted") continue;
    out.push({ kind: "lead", id: l.id, href: `/leads?status=${l.status}`, title: l.person?.full_name ?? "Unknown", subtitle: [l.booking_type ? BOOKING_TYPE_LABEL_SAFE(l.booking_type) : "Message", `via ${l.source}`].join(" · "), at: l.created_at, status: l.status });
  }
  for (const b of bookings) {
    if (b.booking_status !== "inquiry" && b.booking_status !== "quoted") continue;
    out.push({ kind: "booking", id: b.id, href: `/bookings/${b.id}`, title: b.client?.full_name ?? b.customer_name, subtitle: [b.package_name, b.public_ref].filter(Boolean).join(" · "), at: b.created_at, status: b.booking_status });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

function BOOKING_TYPE_LABEL_SAFE(t: PhotoBookingRow["booking_type"]): string {
  return { tournament_athlete: "Tournament athlete", club: "Team / club", training_session: "Training", private_session: "Private session", custom: "Custom" }[t] ?? t;
}

/** Pure: the next action of every live booking, soonest due first. */
export function prioritise(bookings: BookingListRow[], ctx: { pendingRequests: Array<{ booking_id: string; stage: PaymentStage; status: PaymentRequestStatus; created_at: string }>; galleries: Array<Pick<PhotoGalleryRow, "booking_id" | "status" | "pictime_url">>; sentDocuments: Array<{ booking_id: string | null; status: DocumentStatus; sent_at: string | null; required_for_confirmation: boolean }>; now: Date }, limit = 10): PriorityRow[] {
  const rows: Array<{ booking: BookingListRow; action: NextAction | null }> = bookings.map((booking) => ({
    booking,
    action: nextActionFor(booking, {
      now: ctx.now,
      paymentRequests: ctx.pendingRequests.filter((r) => r.booking_id === booking.id),
      gallery: ctx.galleries.find((g) => g.booking_id === booking.id) ?? null,
      documents: ctx.sentDocuments.filter((d) => d.booking_id === booking.id),
    }),
  }));
  return sortByDue(rows).filter((r): r is PriorityRow => r.action !== null && r.action.code !== "cancelled").slice(0, limit);
}

export type StudioOverview = StudioDashboard & {
  priorities: PriorityRow[];
  requests: RequestItem[];
  moneySplit: MoneySplit;
  delivery: { ready: DeliveryItem[]; inProgress: number };
  incidents: Array<Pick<PhotoIncidentRow, "id" | "kind" | "status" | "last_seen_at" | "occurrences" | "event_id">>;
  openQuestions: { open: number; resolved: number };
};

export async function loadStudioOverview(now: Date = new Date()): Promise<StudioOverview> {
  const supabase = await createClient();
  const range = monthRange(now);
  const [base, live, leads, pending, galleries, sentDocs, incidents, studio, records] = await Promise.all([
    loadStudioDashboard(now),
    listBookings({ filter: "all", limit: 400 }),
    supabase.from("photo_leads").select("id,status,source,created_at,booking_type,message,person_id").in("status", ["new", "contacted"]).order("created_at", { ascending: true }).limit(100),
    supabase.from("photo_booking_payment_requests").select("booking_id,stage,status,created_at").eq("status", "pending").limit(500),
    supabase.from("photo_galleries").select("id,booking_id,name,status,ready_at,pictime_url,client_id").in("status", ["ready", "created"]).limit(200),
    supabase.from("photo_documents").select("booking_id,status,sent_at,required_for_confirmation").in("status", ["sent", "viewed"]).limit(500),
    supabase.from("photo_incidents").select("id,kind,status,last_seen_at,occurrences,event_id").eq("status", "open").order("last_seen_at", { ascending: false }).limit(5),
    supabase.from("photo_studio").select("settings").maybeSingle(),
    supabase.from("photo_payment_records").select("amount_qr,paid_at").gte("paid_at", range.start).lt("paid_at", range.end).limit(2000),
  ]);
  const leadRows = leads.data ?? [];
  const personIds = [...new Set(leadRows.map((l) => l.person_id).filter((v): v is string => Boolean(v)))];
  const people = personIds.length ? (await supabase.from("photo_people").select("id,full_name").in("id", personIds)).data ?? [] : [];
  const personById = new Map(people.map((p) => [p.id, p]));
  const activeBookings = live.filter((b) => b.booking_status !== "completed" && b.booking_status !== "cancelled");
  const byBooking = new Map(live.map((b) => [b.id, b]));
  const ready = (galleries.data ?? []).filter((g) => g.status === "ready").map((g) => ({ galleryId: g.id, bookingId: g.booking_id, name: g.name, customer: g.booking_id ? byBooking.get(g.booking_id)?.customer_name ?? null : null, readyAt: g.ready_at, hasUrl: Boolean(g.pictime_url) }));
  return {
    ...base,
    priorities: prioritise(activeBookings, { pendingRequests: pending.data ?? [], galleries: galleries.data ?? [], sentDocuments: sentDocs.data ?? [], now }),
    requests: requestsNeedingAction(leadRows.map((l) => ({ ...l, person: l.person_id ? personById.get(l.person_id) ?? null : null })), activeBookings),
    moneySplit: splitMoney(live, records.data ?? [], range),
    delivery: { ready, inProgress: activeBookings.filter((b) => b.booking_status === "in_progress").length },
    incidents: incidents.data ?? [],
    openQuestions: openQuestionCounts(studio.data?.settings),
  };
}

// ---------------------------------------------------------------------------
// Internal metrics (pure helpers + one loader). Every number carries its definition.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export type ResponseTimeMetric = { count: number; medianHours: number | null; meanHours: number | null; unanswered: number };

/**
 * Lead response time = lead created_at → first `lead.status` audit row for
 * that lead (the owner's first touch). Leads with no status change yet count
 * as unanswered. Hours.
 */
export function responseTimes(leads: Array<Pick<PhotoLeadRow, "id" | "created_at">>, audit: Array<Pick<PhotoAuditLogRow, "entity" | "entity_id" | "action" | "created_at">>): ResponseTimeMetric {
  const first = new Map<string, string>();
  for (const a of audit) {
    if (a.entity !== "lead" || a.action !== "lead.status" || !a.entity_id) continue;
    const prev = first.get(a.entity_id);
    if (!prev || a.created_at < prev) first.set(a.entity_id, a.created_at);
  }
  const hours: number[] = [];
  let unanswered = 0;
  for (const l of leads) {
    const at = first.get(l.id);
    if (!at) {
      unanswered += 1;
      continue;
    }
    const h = (new Date(at).getTime() - new Date(l.created_at).getTime()) / HOUR_MS;
    if (Number.isFinite(h) && h >= 0) hours.push(Math.round(h * 10) / 10);
  }
  return { count: hours.length, medianHours: median(hours), meanHours: mean(hours) === null ? null : Math.round(mean(hours)! * 10) / 10, unanswered };
}

/** Leads per `source` value, most first. */
export function leadSourceCounts(leads: Array<Pick<PhotoLeadRow, "source">>): Array<{ source: string; count: number }> {
  const m = new Map<string, number>();
  for (const l of leads) m.set(l.source || "unknown", (m.get(l.source || "unknown") ?? 0) + 1);
  return [...m.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

export type QuoteConversion = { quoted: number; confirmed: number; cancelled: number; open: number; rate: number | null };

/**
 * Quote conversion = bookings that were quoted (quoted_at set) and went on
 * to be confirmed (confirmed_at set) ÷ all quoted bookings that are no
 * longer open (confirmed or cancelled). Still-open quotes are listed but
 * not counted in the rate.
 */
export function quoteConversion(bookings: Array<Pick<PhotoBookingRow, "quoted_at" | "confirmed_at" | "booking_status">>): QuoteConversion {
  const quoted = bookings.filter((b) => b.quoted_at);
  const confirmed = quoted.filter((b) => b.confirmed_at).length;
  const cancelled = quoted.filter((b) => !b.confirmed_at && b.booking_status === "cancelled").length;
  const open = quoted.length - confirmed - cancelled;
  const decided = confirmed + cancelled;
  return { quoted: quoted.length, confirmed, cancelled, open, rate: decided ? Math.round((confirmed / decided) * 1000) / 10 : null };
}

export type DeliveryDelay = { count: number; medianDays: number | null; meanDays: number | null; over14: number };

/** Delivery delay = session_at (the shoot) → delivered_at (gallery delivered), in days, for delivered / completed bookings with both dates. */
export function deliveryDelays(bookings: Array<Pick<PhotoBookingRow, "session_at" | "delivered_at" | "gallery_delivered_at" | "booking_status">>): DeliveryDelay {
  const days: number[] = [];
  for (const b of bookings) {
    if (b.booking_status !== "delivered" && b.booking_status !== "completed") continue;
    const to = b.gallery_delivered_at ?? b.delivered_at;
    if (!b.session_at || !to) continue;
    const d = (new Date(to).getTime() - new Date(b.session_at).getTime()) / 86_400_000;
    if (Number.isFinite(d) && d >= 0) days.push(Math.round(d * 10) / 10);
  }
  return { count: days.length, medianDays: median(days), meanDays: mean(days) === null ? null : Math.round(mean(days)! * 10) / 10, over14: days.filter((d) => d > 14).length };
}

export type MonthMoney = { range: MonthRange; forecastQr: number; collectedQr: number };

/** Forecast (confirmed amount by confirmation month) vs collected (records by paid_at) for the last `months` months, oldest first. */
export function forecastVsCollected(
  bookings: Array<Pick<PhotoBookingRow, "booking_status" | "confirmed_at" | "amount_qr" | "status" | "amount_paid_qr" | "manual_paid_at"> & Partial<Pick<PhotoBookingRow, "deposit_state" | "deposit_qr" | "balance_state" | "balance_qr">>>,
  records: Array<Pick<PhotoPaymentRecordRow, "amount_qr" | "paid_at">>,
  now: Date,
  months = 6,
): MonthMoney[] {
  const out: MonthMoney[] = [];
  let cursor = monthRange(now);
  for (let i = 0; i < months; i += 1) {
    const m = summariseMoney(bookings, records.filter((r) => inRange(r.paid_at, cursor)), cursor);
    out.unshift({ range: cursor, forecastQr: m.bookedQr, collectedQr: m.receivedQr });
    cursor = monthRange(new Date(new Date(cursor.start).getTime() - 86_400_000));
  }
  return out;
}

export type StudioMetrics = {
  responseTime: ResponseTimeMetric;
  leadSources: Array<{ source: string; count: number }>;
  quoteConversion: QuoteConversion;
  outstandingQr: number;
  outstandingCount: number;
  deliveryDelay: DeliveryDelay;
  months: MonthMoney[];
  leadCount: number;
  bookingCount: number;
};

export async function loadStudioMetrics(now: Date = new Date()): Promise<StudioMetrics> {
  const supabase = await createClient();
  const sixMonthsAgo = monthRange(new Date(now.getTime() - 185 * 86_400_000)).start;
  const [leads, audit, bookings, records] = await Promise.all([
    supabase.from("photo_leads").select("id,created_at,source").limit(2000),
    supabase.from("photo_audit_log").select("entity,entity_id,action,created_at").eq("entity", "lead").eq("action", "lead.status").limit(5000),
    supabase.from("photo_bookings").select("booking_status,quoted_at,confirmed_at,session_at,delivered_at,gallery_delivered_at,amount_qr,status,amount_paid_qr,manual_paid_at,deposit_state,deposit_qr,balance_state,balance_qr").limit(5000),
    supabase.from("photo_payment_records").select("amount_qr,paid_at").gte("paid_at", sixMonthsAgo).limit(5000),
  ]);
  const b = bookings.data ?? [];
  const split = splitMoney(b, records.data ?? [], monthRange(now));
  return {
    responseTime: responseTimes(leads.data ?? [], audit.data ?? []),
    leadSources: leadSourceCounts(leads.data ?? []),
    quoteConversion: quoteConversion(b),
    outstandingQr: split.outstandingQr,
    outstandingCount: split.outstandingCount,
    deliveryDelay: deliveryDelays(b),
    months: forecastVsCollected(b, records.data ?? [], now),
    leadCount: leads.data?.length ?? 0,
    bookingCount: b.length,
  };
}
