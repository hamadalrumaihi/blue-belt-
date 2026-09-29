import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Props = {
  /** "mark" shows only the icon; "full" adds the wordmark. */
  variant?: "mark" | "full";
  size?: number;
  href?: string | null;
  /** Use on dark backgrounds. */
  inverted?: boolean;
  className?: string;
};

/**
 * The Blue Belt Media logo. The image lives at /public/brand/logo.svg so the
 * official file can be dropped in without touching code.
 */
export function Logo({ variant = "full", size = 40, href = "/dashboard", inverted = false, className }: Props) {
  const content = (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <Image
        src="/brand/logo.svg"
        alt="Blue Belt Media"
        width={size}
        height={size}
        priority
        className="shrink-0 rounded-[22%]"
        style={{ width: size, height: size }}
      />
      {variant === "full" && (
        <span className="flex flex-col leading-none">
          <span className={cn("text-[15px] font-extrabold tracking-tight", inverted ? "text-white" : "text-navy")}>
            Blue Belt Media
          </span>
          <span className={cn("mt-1 text-[10px] font-semibold uppercase tracking-[0.16em]", inverted ? "text-white/60" : "text-muted")}>
            Tournament Watcher
          </span>
        </span>
      )}
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} className="rounded-xl focus-visible:outline-2 focus-visible:outline-primary" aria-label="Blue Belt Media home">
      {content}
    </Link>
  );
}
