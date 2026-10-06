import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { createPerson } from "@/lib/actions/people";
import { PersonForm } from "../PersonForm";

export const metadata: Metadata = { title: "Add client" };

export default function NewPersonPage() {
  return (
    <>
      <BrandHeader title="Add client" backHref="/people" />
      <PageBody className="max-w-2xl">
        <PersonForm action={createPerson} submitLabel="Add client" />
      </PageBody>
    </>
  );
}
