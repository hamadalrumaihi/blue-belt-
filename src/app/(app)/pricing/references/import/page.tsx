import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { IMPORT_CSV_HEADER } from "@/lib/pricing/import";
import { requireOwner } from "@/lib/roles";
import { OwnerOnly } from "../../OwnerOnly";
import { ImportForm } from "./ImportForm";

export const metadata: Metadata = { title: "Import market evidence" };
export const dynamic = "force-dynamic";

export default async function ImportReferencesPage() {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly title="Import market evidence" />;
  return (
    <>
      <BrandHeader title="Import market evidence" subtitle="Paste JSON or CSV. Records with a seed key you already have are skipped, never overwritten." backHref="/pricing" />
      <PageBody className="max-w-3xl space-y-4">
        <div className="rounded-xl border border-line bg-page px-3 py-2 text-xs text-muted">
          <p className="font-semibold text-ink">Accepted shapes</p>
          <p className="mt-1">A JSON array of records (the same shape as <code>scripts/pricing/seed-references.json</code>), or a CSV with this header:</p>
          <code className="mt-1 block break-all">{IMPORT_CSV_HEADER}</code>
          <p className="mt-1">Required: provider, service_type, price_from. Dates are YYYY-MM-DD. Unknown fields stay unknown; nothing is guessed.</p>
        </div>
        <ImportForm />
      </PageBody>
    </>
  );
}
