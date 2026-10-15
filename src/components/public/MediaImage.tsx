import Image from "next/image";
import type { CSSProperties } from "react";
import type { PublicMediaItem } from "@/lib/media/public";
import { cn } from "@/lib/utils";
import { focalPositionOf } from "./media";

type Props = {
  item: PublicMediaItem;
  /** The `sizes` attribute: how wide the image renders at each breakpoint, so the browser picks the right file. */
  sizes: string;
  /** Above-the-fold images (the hero) load with priority; everything else is lazy. */
  priority?: boolean;
  className?: string;
  /** Override the alt text (empty string for purely decorative uses next to a caption). */
  alt?: string;
};

/**
 * One published media item as a responsive image. Library items carry their
 * own derivative set, so they render as a plain `<img srcset>` (no image
 * optimizer round trip, no remote host configuration). Manifest photos
 * (local files under /photos) go through next/image for AVIF/WebP and the
 * generated widths. Both reserve space with explicit dimensions, honour the
 * focal point as the crop anchor and use a blur placeholder when there is one.
 */
export function MediaImage({ item, sizes, priority = false, className, alt }: Props) {
  const style: CSSProperties = { objectPosition: focalPositionOf(item) };
  const classes = cn("h-full w-full object-cover", className);
  if (item.sources.length) {
    const srcSet = item.sources.map((s) => `${s.src} ${s.width}w`).join(", ");
    const blur: CSSProperties = item.blurDataURL ? { backgroundImage: `url(${item.blurDataURL})`, backgroundSize: "cover", backgroundPosition: style.objectPosition } : {};
    return (
      // eslint-disable-next-line @next/next/no-img-element -- library derivatives already come in the right sizes and formats.
      <img
        src={item.src}
        srcSet={srcSet}
        sizes={sizes}
        width={item.width}
        height={item.height}
        alt={alt ?? item.alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        className={classes}
        style={{ ...style, ...blur }}
      />
    );
  }
  return (
    <Image
      src={item.src}
      alt={alt ?? item.alt}
      width={item.width}
      height={item.height}
      sizes={sizes}
      priority={priority}
      loading={priority ? undefined : "lazy"}
      placeholder={item.blurDataURL ? "blur" : "empty"}
      blurDataURL={item.blurDataURL}
      quality={82}
      className={classes}
      style={style}
    />
  );
}
