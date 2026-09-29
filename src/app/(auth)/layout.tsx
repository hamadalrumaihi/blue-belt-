import Image from "next/image";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-navy text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-bright/20 blur-3xl" />
      </div>
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-24 w-24 items-center justify-center rounded-[22%] bg-white p-2 shadow-hero">
            <Image src="/brand/mark.png" alt="" aria-hidden width={96} height={96} priority className="h-full w-full" />
          </span>
          <h1 className="mt-5">
            <Image src="/brand/wordmark-white.png" alt="Blue Belt Media" width={240} height={91} priority style={{ width: 220, height: "auto" }} />
          </h1>
          <p className="mt-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/60">Tournament Coverage Command Center</p>
        </div>
        <div className="w-full max-w-sm">{children}</div>
        <p className="mt-10 text-center text-xs text-white/40">Private tool for Blue Belt Media photographers.</p>
      </main>
    </div>
  );
}
