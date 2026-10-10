import Image from "next/image";
import { focalPosition, type SitePhoto } from "@/lib/photos/manifest";
import { cn } from "@/lib/utils";

type Props = {
  photo: SitePhoto;
  /** The `sizes` attribute: how wide the image renders at each breakpoint, so the browser picks the right file. */
  sizes: string;
  /** Above-the-fold images (the hero) load with priority; everything else is lazy. */
  priority?: boolean;
  className?: string;
  /** Override the alt text (empty string for purely decorative uses next to a caption). */
  alt?: string;
};

/**
 * A curated photograph rendered through next/image: responsive srcset,
 * AVIF/WebP where supported, explicit dimensions (no layout shift), a blur
 * placeholder, and the pipeline's focal point as the crop anchor.
 */
export function Photo({ photo, sizes, priority = false, className, alt }: Props) {
  return (
    <Image
      src={photo.src}
      alt={alt ?? photo.alt}
      width={photo.width}
      height={photo.height}
      sizes={sizes}
      priority={priority}
      loading={priority ? undefined : "lazy"}
      placeholder={photo.blurDataURL ? "blur" : "empty"}
      blurDataURL={photo.blurDataURL}
      quality={82}
      className={cn("h-full w-full object-cover", className)}
      style={{ objectPosition: focalPosition(photo) }}
    />
  );
}
