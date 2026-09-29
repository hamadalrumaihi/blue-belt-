import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { countEverything, eventStats, listEvents } from "@/lib/queries";
import { DangerZone } from "./DangerZone";

export const metadata: Metadata = { title: "Danger zone" };
export const dynamic = "force-dynamic";

export default async function DangerPage() {
  const [counts, events] = await Promise.all([countEverything(), listEvents()]);
  const stats = await eventStats(events.map((e) => e.id));
  const eventSummaries = events.map((e) => ({ id: e.id, name: e.name, clients: stats.get(e.id)?.clients ?? 0, matches: stats.get(e.id)?.matches ?? 0 }));
  return (
    <>
      <BrandHeader title="Danger zone" subtitle="Manual deletion only. Nothing is removed automatically." backHref="/settings" />
      <PageBody className="max-w-2xl">
        <DangerZone counts={counts} events={eventSummaries} />
      </PageBody>
    </>
  );
}
