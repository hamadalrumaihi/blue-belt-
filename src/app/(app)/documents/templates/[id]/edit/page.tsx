import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { getTemplate } from "@/lib/documents/queries";
import { DOCUMENT_KIND_LABEL } from "@/lib/documents/state";
import { isUuid } from "@/lib/validation";
import { TemplateEditor } from "./TemplateEditor";

export const metadata: Metadata = { title: "Edit template" };
export const dynamic = "force-dynamic";

export default async function EditTemplatePage({ params }: PageProps<"/documents/templates/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const template = await getTemplate(id);
  if (!template) notFound();
  return (
    <>
      <BrandHeader title={template.name} subtitle={`${DOCUMENT_KIND_LABEL[template.kind]} · version ${template.version}`} backHref="/documents/templates" />
      <PageBody className="max-w-3xl">
        <TemplateEditor templateId={template.id} initialName={template.name} initialBody={template.body} version={template.version} kindLabel={DOCUMENT_KIND_LABEL[template.kind]} />
      </PageBody>
    </>
  );
}
