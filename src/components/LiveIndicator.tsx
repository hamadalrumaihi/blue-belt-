import { cn } from "@/lib/utils";

type Props = { status: "live" | "upcoming" | "past" | "archived"; className?: string };

const COPY: Record<Props["status"], { label: string; cls: string }> = {
  live: { label: "Live today", cls: "bg-danger text-white" },
  upcoming: { label: "Upcoming", cls: "bg-success-soft text-success" },
  past: { label: "Finished", cls: "bg-page text-muted border border-line" },
  archived: { label: "Archived", cls: "bg-page text-muted border border-line" },
};

export function LiveIndicator({ status, className }: Props) {
  const c = COPY[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide", c.cls, className)}>
      {status === "live" && <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-white live-dot" />}
      {c.label}
    </span>
  );
}
