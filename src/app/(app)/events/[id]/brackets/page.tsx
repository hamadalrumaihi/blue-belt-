import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { isBracketExtractionConfigured } from "@/lib/bracket-extract-server";
import { listEventClientNames } from "@/lib/actions/matches";
import { getEvent } from "@/lib/queries";
import { isManualEvent } from "@/lib/types";
import { BracketCsvForm } from "./BracketCsvForm";
import { BracketPhotoReview } from "./BracketPhotoReview";

export const metadata: Metadata = { title: "Import brackets" };
export const dynamic = "force-dynamic";

/**
 * Brackets for a manually tracked event: from a CSV, or read off a bracket
 * photo and reviewed before anything is saved. Every row becomes a
 * hand-entered match on the named client's page.
 */
export default async function BracketsPage({ params }: PageProps<"/events/[id]/brackets">) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();
  const clients = await listEventClientNames(id);
  const manual = isManualEvent(event);

  return (
    <>
      <BrandHeader title="Import brackets" subtitle={event.name} backHref={`/events/${id}`} />
      <PageBody className="max-w-3xl space-y-6">
        {!manual && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This event is watched from a public page. Rows you add here are hand-entered and will not be checked or updated automatically. To track the whole event by hand, <Link href={`/events/${id}/edit`} className="font-semibold underline">change how brackets are followed</Link>.
          </p>
        )}
        <p className="text-sm text-muted">
          {clients.length} client{clients.length === 1 ? "" : "s"} in this event. Rows are matched to clients by name; others can be added as new clients. Times are in {event.timezone === "Asia/Qatar" ? "Qatar time" : event.timezone}.
        </p>

        <section aria-labelledby="csv-heading" className="space-y-3">
          <h2 id="csv-heading" className="text-sm font-extrabold uppercase tracking-wider text-muted">From a CSV</h2>
          <BracketCsvForm eventId={id} />
        </section>

        <section aria-labelledby="photo-heading" className="space-y-3">
          <h2 id="photo-heading" className="text-sm font-extrabold uppercase tracking-wider text-muted">From a bracket photo</h2>
          <BracketPhotoReview eventId={id} configured={isBracketExtractionConfigured()} clientNames={clients.map((c) => c.name)} />
        </section>
      </PageBody>
    </>
  );
}
