import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { updateOrganization } from "@/lib/actions/organizations";
import { getOrganization } from "@/lib/organizations/queries";
import { listPeopleOptions } from "@/lib/people/queries";
import { isUuid } from "@/lib/validation";
import { OrganizationForm } from "../../OrganizationForm";

export const metadata: Metadata = { title: "Edit team or club" };
export const dynamic = "force-dynamic";

export default async function EditClubPage({ params }: PageProps<"/clubs/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [detail, people] = await Promise.all([getOrganization(id), listPeopleOptions()]);
  if (!detail) notFound();
  return (
    <>
      <BrandHeader title="Edit team or club" subtitle={detail.organization.name} backHref={`/clubs/${id}`} />
      <PageBody className="max-w-2xl">
        <OrganizationForm action={updateOrganization.bind(null, id)} initial={detail.organization} people={people} submitLabel="Save changes" cancelHref={`/clubs/${id}`} />
      </PageBody>
    </>
  );
}
