import Image from "next/image";
import { cn } from "@/lib/utils";

/** Branded loading screen used by route-level loading.tsx files. */
export function LoadingState({ label = "Loading…", fullScreen = false }: { label?: string; fullScreen?: boolean }) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-4 text-center", fullScreen ? "min-h-dvh bg-navy text-white" : "py-16")}
      role="status"
      aria-live="polite"
    >
      <Image src="/brand/logo.svg" alt="Blue Belt Media" width={56} height={56} className="animate-pulse rounded-[22%]" priority />
      <div>
        <p className={cn("text-sm font-bold", fullScreen ? "text-white" : "text-navy")}>Blue Belt Media</p>
        <p className={cn("mt-0.5 text-xs", fullScreen ? "text-white/60" : "text-muted")}>{label}</p>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-line/70", className)} />;
}
