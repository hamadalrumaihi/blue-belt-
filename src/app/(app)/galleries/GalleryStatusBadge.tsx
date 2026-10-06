import { GALLERY_STATUS_LABEL } from "@/lib/galleries/state";
import type { GalleryStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const TONE: Record<GalleryStatus, string> = {
  pending: "bg-page text-muted border border-line",
  created: "bg-lightblue text-primary border border-primary/20",
  ready: "bg-warning-soft text-warning border border-warning/30",
  delivered: "bg-success-soft text-success border border-success/30",
};

export function GalleryStatusBadge({ status, className }: { status: GalleryStatus; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", TONE[status], className)}>{GALLERY_STATUS_LABEL[status]}</span>;
}
