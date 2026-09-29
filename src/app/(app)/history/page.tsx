import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { ChangeHistory } from "@/components/ChangeHistory";
import { listEvents, listHistory, pickCurrentEvent } from "@/lib/queries";
import { HistoryFilter } from "./HistoryFilter";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const params = await searchParams;
  const events = await listEvents();
  const eventParam = typeof params.event === "string" ? params.event : null;
  const scope = eventParam === "all" ? null : pickCurrentEvent(events, eventParam);
  const entries = await listHistory({ eventId: scope?.id ?? null, limit: 300 });
  const tz = scope?.timezone ?? "Asia/Qatar";

  return (
    <>
      <BrandHeader title="Activity" subtitle="Change history detected by the watcher" actions={<HistoryFilter events={events} currentId={scope?.id ?? "all"} />} />
      <PageBody>
        <ChangeHistory entries={entries} timezone={tz} showDate emptyTitle="No activity yet" emptyDescription="Refresh clients from the Match Watcher; every mat, time, opponent and status change lands here." />
      </PageBody>
    </>
  );
}
