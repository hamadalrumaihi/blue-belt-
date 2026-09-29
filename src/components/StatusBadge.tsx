import { bucketTone, type EtaBucket, type EtaTone } from "@/lib/eta";
import { cn } from "@/lib/utils";

const TONE: Record<EtaTone, string> = {
  red: "bg-danger text-white",
  orange: "bg-orange text-white",
  amber: "bg-warning-soft text-warning border border-warning/30",
  green: "bg-success-soft text-success border border-success/30",
  blue: "bg-lightblue text-primary border border-primary/20",
  gray: "bg-page text-muted border border-line",
};

type Props = {
  bucket: EtaBucket;
  size?: "sm" | "md" | "lg";
  className?: string;
};

/** The match state pill: UPCOMING / 30 MIN / ... / GO TO MAT / ON MAT. */
export function StatusBadge({ bucket, size = "md", className }: Props) {
  const tone = bucketTone(bucket);
  const urgent = bucket === "ON MAT" || bucket === "GO TO MAT";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-bold uppercase tracking-wide",
        size === "sm" && "px-2 py-0.5 text-[10px]",
        size === "md" && "px-2.5 py-1 text-[11px]",
        size === "lg" && "px-3.5 py-1.5 text-sm",
        TONE[tone],
        className,
      )}
    >
      {urgent && <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-current live-dot" />}
      {bucket}
    </span>
  );
}
