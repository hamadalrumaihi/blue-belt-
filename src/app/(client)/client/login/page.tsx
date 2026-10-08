import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { resolveViewer } from "@/lib/roles";
import { ClientLoginForm } from "./ClientLoginForm";

export const metadata: Metadata = { title: "Client portal: sign in" };
export const dynamic = "force-dynamic";

export default async function ClientLoginPage({ searchParams }: PageProps<"/client/login">) {
  const viewer = await resolveViewer();
  if (viewer) redirect("/client");
  const params = await searchParams;
  const linkError = params.error === "link";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex justify-center"><Logo href="/" size={44} /></div>
      <ClientLoginForm linkError={linkError} />
      <p className="mt-6 text-center text-xs text-muted">
        Studio staff? <Link href="/login" className="font-semibold text-primary hover:underline">Sign in to the studio</Link>
      </p>
    </main>
  );
}
