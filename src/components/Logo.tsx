import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Props = {
  /** "mark" shows only the knight badge; "full" shows the badge + script wordmark. */
  variant?: "mark" | "full";
  /** Height of the mark in px. The wordmark scales with it. */
  size?: number;
  href?: string | null;
  /** Use on dark (navy) surfaces: mark sits on a white tile, wordmark turns white. */
  inverted?: boolean;
  /** Small "Studio" caption under the wordmark (the private app). */
  caption?: boolean;
  className?: string;
};

/**
 * The official Blue Belt Media logo.
 * Source files live in /public/brand:
 *   logo.png            full lockup (mark + wordmark), colour
 *   logo-white.png      full lockup, white ink (dark surfaces)
 *   mark.png            square knight badge, colour
 *   wordmark.png        script wordmark, colour
 *   wordmark-white.png  script wordmark, white ink
 */
export function Logo({ variant = "full", size = 40, href = "/studio", inverted = false, caption = false, className }: Props) {
  const wordmarkHeight = Math.round(size * 0.85);
  const wordmarkWidth = Math.round(wordmarkHeight * (240 / 91));

  const mark = inverted ? (
    <span className="flex shrink-0 items-center justify-center rounded-[22%] bg-white" style={{ width: size, height: size, padding: Math.round(size * 0.08) }}>
      <Image src="/brand/mark.png" alt="Blue Belt Media" width={size} height={size} priority className="h-full w-full" />
    </span>
  ) : (
    <Image src="/brand/mark.png" alt="Blue Belt Media" width={size} height={size} priority className="shrink-0" style={{ width: size, height: size }} />
  );

  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {mark}
      {variant === "full" && (
        <span className="flex flex-col">
          <Image
            src={inverted ? "/brand/wordmark-white.png" : "/brand/wordmark.png"}
            alt=""
            aria-hidden
            width={wordmarkWidth}
            height={wordmarkHeight}
            priority
            style={{ width: wordmarkWidth, height: wordmarkHeight }}
          />
          {caption && (
            <span className={cn("mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]", inverted ? "text-white/60" : "text-muted")}>
              Studio
            </span>
          )}
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
