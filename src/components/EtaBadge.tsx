import { bucketTone, formatCountdown, type Eta } from "@/lib/eta";
import { cn } from "@/lib/utils";

const TEXT: Record<ReturnType<typeof bucketTone>, string> = {
  red: "text-danger",
  orange: "text-orange",
  amber: "text-warning",
  green: "text-success",
  blue: "text-primary",
  gray: "text-muted",
};

type Props = { eta: Eta; className?: string; size?: "sm" | "lg" };

/** Countdown text such as "in 12 min", tinted by urgency. */
export function EtaBadge({ eta, className, size = "sm" }: Props) {
  const tone = bucketTone(eta.bucket);
  const text =
    eta.bucket === "ON MAT" ? "Now" : eta.bucket === "COMPLETE" ? "Done" : formatCountdown(eta.minutesRemaining);
  return (
    <span
      className={cn("font-bold tabular-nums", TEXT[tone], size === "lg" ? "text-3xl" : "text-sm", className)}
      title={eta.usesEstimate ? "Based on estimated time" : "Based on scheduled time"}
    >
      {text}
      {eta.usesEstimate && size === "sm" && <span className="ml-1 text-[10px] font-semibold text-muted">est</span>}
    </span>
  );
}
