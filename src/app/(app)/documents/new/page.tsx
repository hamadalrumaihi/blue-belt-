import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { FileTextIcon } from "@/components/icons";
import { ensureDefaultTemplates } from "@/lib/actions/documents";
import { listBookingChoices, listPersonChoices, listTemplates } from "@/lib/documents/queries";
import { isUuid } from "@/lib/validation";
import { NewDocumentForm } from "./NewDocumentForm";

export const metadata: Metadata = { title: "New document" };
export const dynamic = "force-dynamic";

export default async function NewDocumentPage({ searchParams }: PageProps<"/documents/new">) {
  const params = await searchParams;
  const bookingId = isUuid(params.booking) ? params.booking : null;
  const clientId = isUuid(params.client) ? params.client : null;
  let templates = await listTemplates();
  if (!templates.length) {
    await ensureDefaultTemplates();
    templates = await listTemplates();
  }
  const [bookings, people] = await Promise.all([listBookingChoices(), listPersonChoices()]);
  const active = templates.filter((t) => t.active);

  return (
    <>
      <BrandHeader title="New document" subtitle="Fill a template for one client or booking" backHref="/documents" />
      <PageBody className="max-w-2xl">
        {active.length === 0 ? (
          <EmptyState icon={<FileTextIcon />} title="No active templates." description="Turn a template on or create one first." action={<Link href="/documents/templates" className="btn-primary">Templates</Link>} />
        ) : (
          <NewDocumentForm templates={active.map((t) => ({ id: t.id, name: t.name, kind: t.kind, version: t.version }))} bookings={bookings} people={people} initialBookingId={bookingId} initialClientId={clientId} />
        )}
      </PageBody>
    </>
  );
}
