import { BOOKING_STATUS_CLIENT_LABEL } from "@/lib/bookings/state";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const STATUS_TONE: Partial<Record<BookingStatus, string>> = {
  confirmed: "bg-success-soft text-success border-success/30",
  in_progress: "bg-lightblue text-primary border-primary/20",
  delivered: "bg-success-soft text-success border-success/30",
  completed: "bg-page text-muted border-line",
  cancelled: "bg-danger-soft text-danger border-danger/30",
  awaiting_payment: "bg-warning-soft text-warning border-warning/30",
  awaiting_contract: "bg-warning-soft text-warning border-warning/30",
};

/** The client-facing lifecycle pill (softer wording than the studio's). */
export function BookingStatusPill({ status }: { status: BookingStatus }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide", STATUS_TONE[status] ?? "bg-lightblue text-primary border-primary/20")}>{BOOKING_STATUS_CLIENT_LABEL[status]}</span>;
}
