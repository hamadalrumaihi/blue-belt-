import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ensureDefaultTemplates } from "@/lib/actions/documents";
import { listTemplates } from "@/lib/documents/queries";
import { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS } from "@/lib/documents/state";
import { NewTemplateForm } from "./NewTemplateForm";
import { TemplatesList } from "./TemplatesList";

export const metadata: Metadata = { title: "Templates" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  // Seeds the starter contracts the first time the owner opens this page.
  await ensureDefaultTemplates();
  const templates = await listTemplates();
  const groups = DOCUMENT_KINDS.map((kind) => ({ kind, label: DOCUMENT_KIND_LABEL[kind], items: templates.filter((t) => t.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <>
      <BrandHeader title="Templates" subtitle="The wording your documents start from" backHref="/documents" />
      <PageBody className="max-w-3xl space-y-4">
        <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">The starter templates are drafts. Have a lawyer review them before relying on them; edit the text here once they have.</p>
        <TemplatesList groups={groups.map((g) => ({ ...g, items: g.items.map((t) => ({ id: t.id, name: t.name, version: t.version, active: t.active, updated_at: t.updated_at })) }))} />
        <NewTemplateForm />
      </PageBody>
    </>
  );
}
