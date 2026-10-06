import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = { AJP: "AJP", SMOOTHCOMP: "Smoothcomp", LOCAL: "Local", OTHER: "Other" };

export function PlatformBadge({ platform, className }: { platform: string; className?: string }) {
  const p = platform.toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        p === "AJP" && "bg-navy text-white",
        p === "SMOOTHCOMP" && "bg-bright/15 text-primary",
        p === "LOCAL" && "bg-lightblue text-primary",
        p !== "AJP" && p !== "SMOOTHCOMP" && p !== "LOCAL" && "bg-page text-muted border border-line",
        className,
      )}
    >
      {LABEL[p] ?? platform}
    </span>
  );
}
