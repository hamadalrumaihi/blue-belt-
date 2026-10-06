import type { Metadata } from "next";
import Link from "next/link";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { FileTextIcon, PlusIcon } from "@/components/icons";
import { DOCUMENT_KIND_LABEL, isDocumentKind } from "@/lib/documents/state";
import { isDocumentListFilter, listDocuments, type DocumentListFilter } from "@/lib/documents/queries";
import { formatStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DocumentStatusPill } from "./DocumentStatusPill";

export const metadata: Metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: DocumentListFilter; label: string }> = [
  { key: "awaiting", label: "Awaiting signature" },
  { key: "signed", label: "Signed" },
  { key: "drafts", label: "Drafts" },
  { key: "all", label: "All" },
];

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const params = await searchParams;
  const view: DocumentListFilter = isDocumentListFilter(params.view) ? params.view : "awaiting";
  const docs = await listDocuments({ status: view });

  return (
    <>
      <BrandHeader
        title="Contracts & releases"
        subtitle="Agreements your clients sign on their phone"
        actions={
          <div className="flex gap-2">
            <Link href="/documents/templates" className="btn-secondary min-h-10 px-3 text-xs">Templates</Link>
            <Link href="/documents/new" className="btn-primary min-h-10"><PlusIcon size={18} /> New document</Link>
          </div>
        }
      />
      <PageBody className="max-w-3xl space-y-4">
        <nav aria-label="Filter" className="-mx-4 overflow-x-auto px-4">
          <ul className="flex gap-2">
            {FILTERS.map((f) => (
              <li key={f.key}>
                <Link href={`/documents?view=${f.key}`} aria-current={view === f.key ? "page" : undefined} className={cn("inline-flex min-h-10 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold", view === f.key ? "border-primary bg-primary text-white" : "border-line bg-white text-ink hover:bg-lightblue")}>
                  {f.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {docs.length === 0 ? (
          <EmptyState
            icon={<FileTextIcon />}
            title={view === "awaiting" ? "Nothing waiting for a signature." : view === "drafts" ? "No drafts." : view === "signed" ? "No signed documents yet." : "No documents yet."}
            description="Create a document from a template, send the link, and the client signs on their phone. The signed PDF is kept here and in their portal."
            action={<Link href="/documents/new" className="btn-primary"><PlusIcon size={18} /> New document</Link>}
          />
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.id}>
                <Link href={`/documents/${d.id}`} className="card flex min-h-16 items-center gap-3 p-4 hover:bg-lightblue/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-ink">{d.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {isDocumentKind(d.kind) ? DOCUMENT_KIND_LABEL[d.kind] : d.kind}
                      {d.client ? ` · ${d.client.full_name}` : ""}
                      {d.booking ? ` · ${d.booking.public_ref ?? d.booking.athlete_name}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {d.status === "signed" && d.signed_at ? `Signed ${formatStamp(d.signed_at)}` : d.status === "draft" ? `Created ${formatStamp(d.created_at)}` : d.sent_at ? `Sent ${formatStamp(d.sent_at)}` : ""}
                      {d.status !== "signed" && d.status !== "draft" && d.expires_at ? ` · expires ${formatStamp(d.expires_at)}` : ""}
                    </p>
                  </div>
                  <DocumentStatusPill status={d.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
