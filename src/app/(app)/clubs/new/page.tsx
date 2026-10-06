import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { createOrganization } from "@/lib/actions/organizations";
import { listPeopleOptions } from "@/lib/people/queries";
import { OrganizationForm } from "../OrganizationForm";

export const metadata: Metadata = { title: "New team or club" };
export const dynamic = "force-dynamic";

export default async function NewClubPage() {
  const people = await listPeopleOptions();
  return (
    <>
      <BrandHeader title="New team or club" backHref="/clubs" />
      <PageBody className="max-w-2xl">
        <OrganizationForm action={createOrganization} people={people} submitLabel="Add club" />
      </PageBody>
    </>
  );
}
