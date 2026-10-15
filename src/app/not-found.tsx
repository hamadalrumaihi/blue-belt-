import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

/** Branded 404 for every route group: a way back to the pages people actually want. */
export default function NotFound() {
  return (
    <main className="navy-pattern flex min-h-dvh flex-col items-center justify-center bg-navy px-gutter py-16 text-center text-white">
      <Logo inverted href="/" size={44} />
      <p className="eyebrow mt-10 !text-white/60">404</p>
      <h1 className="heading-1 mt-3">That page is not here</h1>
      <p className="mt-3 max-w-md text-base text-white/75">The link may be old or mistyped. The pages below are the ones most people are looking for.</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/" className="btn-primary btn-lg">Home</Link>
        <Link href="/services" className="btn btn-light btn-lg">Services</Link>
        <Link href="/work" className="btn btn-light btn-lg">Work</Link>
        <Link href="/client/login" className="btn btn-light btn-lg">Client portal</Link>
      </div>
    </main>
  );
}
