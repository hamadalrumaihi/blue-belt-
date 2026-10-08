import "server-only";
import { listBookings, NEEDS_ACTION_STATUSES, upcomingBookings, type BookingListRow } from "@/lib/bookings/queries";
import { BOOKING_STATUS_LABEL, effectivePayment, formatQr } from "@/lib/bookings/state";
import { countOpenIssues } from "@/lib/incidents/queries";
import { monthMoney, type MoneySummary, type MonthRange } from "@/lib/payments/ledger";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus, PhotoAuditLogRow, PhotoBookingRow, PhotoEventRow } from "@/lib/supabase/database.types";
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

const ENTITY_PATH: Record<string, string> = { booking: "/bookings", person: "/people", organization: "/clubs", document: "/documents", gallery: "/galleries", lead: "/leads", order: "/orders" };

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
    default:
      text = row.action.replace(/[._]/g, " ");
  }
  const base = ENTITY_PATH[row.entity];
  return { id: row.id, at: row.created_at, text, href: base && row.entity_id ? `${base}/${row.entity_id}` : base ?? null, actor: row.actor_kind };
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
