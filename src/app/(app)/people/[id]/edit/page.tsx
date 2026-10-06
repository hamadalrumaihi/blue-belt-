import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { updatePerson } from "@/lib/actions/people";
import { getPerson } from "@/lib/people/queries";
import { isUuid } from "@/lib/validation";
import { PersonForm } from "../../PersonForm";

export const metadata: Metadata = { title: "Edit client" };
export const dynamic = "force-dynamic";

export default async function EditPersonPage({ params }: PageProps<"/people/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getPerson(id);
  if (!detail) notFound();
  return (
    <>
      <BrandHeader title="Edit client" subtitle={detail.person.full_name} backHref={`/people/${id}`} />
      <PageBody className="max-w-2xl">
        <PersonForm action={updatePerson.bind(null, id)} initial={detail.person} submitLabel="Save changes" cancelHref={`/people/${id}`} />
      </PageBody>
    </>
  );
}
