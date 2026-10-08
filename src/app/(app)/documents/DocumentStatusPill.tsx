import { DOCUMENT_STATUS_LABEL } from "@/lib/documents/state";
import type { DocumentStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const TONE: Record<DocumentStatus, string> = {
  draft: "bg-page text-muted border border-line",
  sent: "bg-lightblue text-primary border border-primary/20",
  viewed: "bg-warning-soft text-warning border border-warning/30",
  signed: "bg-success-soft text-success border border-success/30",
  declined: "bg-danger-soft text-danger border border-danger/30",
  expired: "bg-page text-muted border border-line",
  void: "bg-page text-muted border border-line line-through",
};

export function DocumentStatusPill({ status, className }: { status: DocumentStatus; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide", TONE[status], className)}>{DOCUMENT_STATUS_LABEL[status]}</span>;
}
