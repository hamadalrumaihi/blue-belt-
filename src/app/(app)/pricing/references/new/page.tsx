import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { createPriceReference } from "@/lib/actions/pricing";
import { requireOwner } from "@/lib/roles";
import { todayInZone } from "@/lib/time";
import { OwnerOnly } from "../../OwnerOnly";
import { PriceReferenceForm } from "../../PriceReferenceForm";

export const metadata: Metadata = { title: "New reference price" };
export const dynamic = "force-dynamic";

export default async function NewPriceReferencePage() {
  const owner = await requireOwner();
  if (!owner.ok) return <OwnerOnly title="New reference price" />;
  return (
    <>
      <BrandHeader title="New reference price" subtitle="What another provider charges for comparable work." backHref="/pricing" />
      <PageBody className="max-w-2xl">
        <PriceReferenceForm action={createPriceReference} today={todayInZone()} submitLabel="Add reference" />
      </PageBody>
    </>
  );
}
