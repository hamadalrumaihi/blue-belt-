import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { getDocument } from "@/lib/documents/queries";
import { isUuid } from "@/lib/validation";
import { DraftEditor } from "./DraftEditor";

export const metadata: Metadata = { title: "Edit draft" };
export const dynamic = "force-dynamic";

export default async function EditDraftPage({ params }: PageProps<"/documents/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getDocument(id);
  if (!detail) notFound();
  if (detail.doc.status !== "draft") redirect(`/documents/${id}`);
  return (
    <>
      <BrandHeader title="Edit draft" subtitle={detail.doc.title} backHref={`/documents/${id}`} />
      <PageBody className="max-w-3xl">
        <DraftEditor documentId={id} initialBody={detail.doc.body} />
      </PageBody>
    </>
  );
}
