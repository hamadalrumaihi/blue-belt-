import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { updatePriceReference } from "@/lib/actions/pricing";
import { getPriceReference } from "@/lib/pricing/queries";
import { requireOwner } from "@/lib/roles";
import { todayInZone } from "@/lib/time";
import { isUuid } from "@/lib/validation";
import { OwnerOnly } from "../../../OwnerOnly";
import { PriceReferenceForm } from "../../../PriceReferenceForm";

export const metadata: Metadata = { title: "Edit reference price" };
export const dynamic = "force-dynamic";

export default async function EditPriceReferencePage({ params }: PageProps<"/pricing/references/[id]/edit">) {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly title="Edit reference price" />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const reference = await getPriceReference(id);
  if (!reference) notFound();
  const action = updatePriceReference.bind(null, id);
  return (
    <>
      <BrandHeader title="Edit reference price" subtitle={reference.provider} backHref="/pricing" />
      <PageBody className="max-w-2xl">
        <PriceReferenceForm action={action} initial={reference} today={todayInZone()} submitLabel="Save changes" />
      </PageBody>
    </>
  );
}
