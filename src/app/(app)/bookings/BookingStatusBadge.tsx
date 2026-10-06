import { BOOKING_STATUS_LABEL } from "@/lib/bookings/state";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const TONE: Record<BookingStatus, string> = {
  inquiry: "bg-lightblue text-primary border border-primary/20",
  quoted: "bg-lightblue text-primary border border-primary/20",
  awaiting_contract: "bg-warning-soft text-warning border border-warning/30",
  awaiting_payment: "bg-warning-soft text-warning border border-warning/30",
  confirmed: "bg-success-soft text-success border border-success/30",
  in_progress: "bg-success-soft text-success border border-success/30",
  delivered: "bg-page text-ink border border-line",
  completed: "bg-page text-muted border border-line",
  cancelled: "bg-danger-soft text-danger border border-danger/30",
};

/** Lifecycle pill for a booking (owner wording). */
export function BookingStatusBadge({ status, size = "md", className }: { status: BookingStatus; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full font-bold uppercase tracking-wide", size === "sm" && "px-2 py-0.5 text-[10px]", size === "md" && "px-2.5 py-1 text-[11px]", size === "lg" && "px-3.5 py-1.5 text-sm", TONE[status], className)}>
      {BOOKING_STATUS_LABEL[status]}
    </span>
  );
}
