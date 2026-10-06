import type { Metadata } from "next";
import { BrandHeader } from "@/components/BrandHeader";
import { PageBody } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { CheckIcon } from "@/components/icons";
import { listIssues, RESOLVED_WINDOW_MS } from "@/lib/incidents/queries";
import { IssueCard } from "./IssueCard";

export const metadata: Metadata = { title: "Issues" };
export const dynamic = "force-dynamic";

/**
 * Watcher problems the Telegram [System] messages talk about: blocked sources,
 * worker outages, unreadable pages, athletes missing from their page. Each one
 * says what failed, when, and the next step; the owner can mark it done.
 * Issues resolve on their own when the source reads OK again.
 */
export default async function IssuesPage() {
  const now = new Date();
  const { open, resolved } = await listIssues(now);
  const needsAction = open.filter((i) => !i.acknowledged_at);
  const done = open.filter((i) => i.acknowledged_at);

  return (
    <>
      <BrandHeader title="Issues" subtitle={needsAction.length ? `${needsAction.length} need${needsAction.length === 1 ? "s" : ""} action` : "Nothing needs action"} />
      <PageBody className="max-w-3xl space-y-5">
        <p className="text-sm text-muted">
          Problems the watcher hit while checking sources. The last confirmed schedule is always kept. An issue clears by itself when the source reads OK again; mark it done once you have handled it. Times are Qatar time.
        </p>

        <Section title="Needs action" count={needsAction.length}>
          {needsAction.length === 0 ? (
            <EmptyState compact icon={<CheckIcon />} title="No open issues" description="Every watched source was read without a problem, or you have handled what came up." />
          ) : (
            needsAction.map((i) => <IssueCard key={i.id} issue={i} now={now} />)
          )}
        </Section>

        {done.length > 0 && (
          <Section title="Marked done — still failing" count={done.length} hint="You handled these, but the source has not read OK yet. If the same problem returns after a recovery, it shows up above again.">
            {done.map((i) => <IssueCard key={i.id} issue={i} now={now} />)}
          </Section>
        )}

        {resolved.length > 0 && (
          <Section title={`Resolved in the last ${Math.round(RESOLVED_WINDOW_MS / 86_400_000)} days`} count={resolved.length}>
            {resolved.map((i) => <IssueCard key={i.id} issue={i} now={now} />)}
          </Section>
        )}
      </PageBody>
    </>
  );
}

function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-muted">{title} · {count}</h2>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  );
}
