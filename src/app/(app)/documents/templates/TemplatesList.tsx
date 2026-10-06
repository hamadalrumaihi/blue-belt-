"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EditIcon } from "@/components/icons";
import { setTemplateActive } from "@/lib/actions/documents";
import { cn } from "@/lib/utils";

type Item = { id: string; name: string; version: number; active: boolean; updated_at: string };
type Group = { kind: string; label: string; items: Item[] };

export function TemplatesList({ groups }: { groups: Group[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string, active: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setTemplateActive(id, active);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.kind}>
          <p className="eyebrow mb-2">{g.label}</p>
          <ul className="space-y-2">
            {g.items.map((t) => (
              <li key={t.id} className={cn("card flex items-center gap-3 p-3", !t.active && "opacity-70")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{t.name}</p>
                  <p className="text-xs text-muted">Version {t.version}{t.active ? "" : " · off"}</p>
                </div>
                <button type="button" role="switch" aria-checked={t.active} aria-label={`${t.name}: ${t.active ? "active" : "inactive"}`} disabled={pending} onClick={() => toggle(t.id, !t.active)} className={cn("relative h-7 w-12 shrink-0 rounded-full border transition-colors", t.active ? "border-primary bg-primary" : "border-line bg-page")}>
                  <span className={cn("absolute top-0.5 rounded-full bg-white shadow transition-all", t.active ? "left-6" : "left-0.5")} style={{ height: 22, width: 22 }} />
                </button>
                <Link href={`/documents/templates/${t.id}/edit`} className="btn-secondary min-h-11 px-3" aria-label={`Edit ${t.name}`}><EditIcon size={16} /><span className="hidden sm:inline">Edit</span></Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}
