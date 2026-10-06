import Link from "next/link";
import { countOpenIssues } from "@/lib/incidents/queries";
import { AlertIcon, ChevronRightIcon } from "./icons";

/** "2 watcher issues need action" prompt; renders nothing when there are none. */
export async function OpenIssuesLink() {
  const count = await countOpenIssues().catch(() => 0);
  if (!count) return null;
  return (
    <Link href="/issues" className="card mb-3 flex min-h-12 items-center gap-3 border-danger/30 px-4 py-2.5 text-sm hover:bg-page">
      <AlertIcon size={18} className="shrink-0 text-danger" />
      <span className="flex-1 font-bold text-ink">{count} watcher {count === 1 ? "issue needs" : "issues need"} action</span>
      <span className="text-xs font-semibold text-primary">Open issues</span>
      <ChevronRightIcon size={16} className="text-muted" />
    </Link>
  );
}
