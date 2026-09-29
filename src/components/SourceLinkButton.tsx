import { ExternalIcon } from "./icons";
import { cn } from "@/lib/utils";

type Props = {
  url: string | null | undefined;
  platform?: string | null;
  label?: string;
  variant?: "primary" | "secondary" | "ghost" | "inverted";
  className?: string;
  size?: "sm" | "md";
};

const PLATFORM_LABEL: Record<string, string> = { AJP: "Open AJP", SMOOTHCOMP: "Open Smoothcomp", OTHER: "Open source" };

/** Opens the athlete's AJP / Smoothcomp page in a new tab. */
export function SourceLinkButton({ url, platform, label, variant = "secondary", className, size = "md" }: Props) {
  const text = label ?? PLATFORM_LABEL[(platform ?? "OTHER").toUpperCase()] ?? "Open source";
  const cls =
    variant === "primary"
      ? "btn-primary"
      : variant === "ghost"
        ? "btn-ghost"
        : variant === "inverted"
          ? "btn bg-white text-navy hover:bg-lightblue"
          : "btn-secondary";
  if (!url) {
    return (
      <span className={cn(cls, "opacity-50", size === "sm" && "min-h-9 px-3 text-xs", className)} aria-disabled>
        <ExternalIcon size={16} /> No link
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(cls, size === "sm" && "min-h-9 px-3 text-xs", className)}
    >
      <ExternalIcon size={16} />
      {text}
    </a>
  );
}
