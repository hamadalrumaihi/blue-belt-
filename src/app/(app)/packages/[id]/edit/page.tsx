import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { updateService } from "@/lib/actions/services";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { ServiceForm } from "../../ServiceForm";

export const metadata: Metadata = { title: "Edit package" };
export const dynamic = "force-dynamic";

export default async function EditPackagePage({ params }: PageProps<"/packages/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: service } = await supabase.from("photo_services").select("*").eq("id", id).maybeSingle();
  if (!service) notFound();
  const action = updateService.bind(null, id);
  return (
    <>
      <BrandHeader title="Edit package" backHref="/packages" />
      <PageBody className="max-w-2xl">
        <ServiceForm action={action} initial={service} submitLabel="Save changes" />
      </PageBody>
    </>
  );
}
