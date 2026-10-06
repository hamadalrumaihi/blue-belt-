import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
      <h1 className="text-3xl font-extrabold">Blue Belt Media</h1>
      <p className="mt-2 text-muted">Combat sports photography & video.</p>
      <Link href="/book" className="btn-primary mt-6">Book now</Link>
    </main>
  );
}
