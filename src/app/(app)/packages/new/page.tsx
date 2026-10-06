import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { createService } from "@/lib/actions/services";
import { ServiceForm } from "../ServiceForm";

export const metadata: Metadata = { title: "New package" };

export default function NewPackagePage() {
  return (
    <>
      <BrandHeader title="New package" backHref="/packages" />
      <PageBody className="max-w-2xl">
        <ServiceForm action={createService} submitLabel="Create package" />
      </PageBody>
    </>
  );
}
