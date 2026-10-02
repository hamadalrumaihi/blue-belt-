import type { Metadata } from "next";
import { headers } from "next/headers";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ImportPage } from "./ImportPage";

export const metadata: Metadata = { title: "Import page" };
export const dynamic = "force-dynamic";

/** Origin of this deployment, for the bookmarklet the page generates. */
async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function ImportRoute({ searchParams }: PageProps<"/import">) {
  const params = await searchParams;
  const url = typeof params.url === "string" ? params.url : "";
  return (
    <>
      <BrandHeader title="Import page" subtitle="Bring a bracket page in from your own browser" backHref="/clients" />
      <PageBody className="max-w-2xl">
        <ImportPage appOrigin={await appOrigin()} initialUrl={url} />
      </PageBody>
    </>
  );
}
