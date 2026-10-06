"use client";

import { useMemo, useState } from "react";
import { DEFAULT_LOCAL_RULES, MAX_AGE_GROUPS, MAX_DIVISIONS_PER_GROUP, parseDivisionRules, type DivisionRules } from "@/lib/local-divisions";
import { cn } from "@/lib/utils";
import { PlusIcon, TrashIcon } from "./icons";

type Draft = { key: number; id?: string; label: string; minAge: string; maxAge: string; divisions: Array<{ key: number; label: string; maxKg: string }> };

type Props = { initial: DivisionRules | null; error?: string };

let seq = 1;
const nextKey = () => seq++;

function toDraft(rules: DivisionRules): Draft[] {
  return rules.ageGroups.map((g) => ({
    key: nextKey(),
    id: g.id,
    label: g.label,
    minAge: String(g.minAge),
    maxAge: String(g.maxAge),
    divisions: g.divisions.map((d) => ({ key: nextKey(), label: d.label, maxKg: String(d.maxKg) })),
  }));
}

function toRules(draft: Draft[]): unknown {
  return {
    version: 1,
    ageGroups: draft.map((g) => ({
      id: g.id,
      label: g.label,
      minAge: Number(g.minAge),
      maxAge: Number(g.maxAge),
      divisions: g.divisions.map((d) => ({ label: d.label, maxKg: Number(d.maxKg) })),
    })),
  };
}

/**
 * The event's own age groups and weight divisions. Every value is editable:
 * local competitions set their own rules. Posts the chart as JSON in
 * `division_rules`; the server validates it again.
 */
export function DivisionRulesEditor({ initial, error }: Props) {
  const [groups, setGroups] = useState<Draft[]>(() => toDraft(initial ?? DEFAULT_LOCAL_RULES));
  const json = useMemo(() => JSON.stringify(toRules(groups)), [groups]);
  const check = useMemo(() => parseDivisionRules(toRules(groups)), [groups]);

  function patchGroup(key: number, patch: Partial<Draft>) {
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }
  function patchDivision(gKey: number, dKey: number, patch: Partial<Draft["divisions"][number]>) {
    setGroups((gs) => gs.map((g) => (g.key === gKey ? { ...g, divisions: g.divisions.map((d) => (d.key === dKey ? { ...d, ...patch } : d)) } : g)));
  }

  return (
    <fieldset className="space-y-3">
      <legend className="label">Age groups and weight divisions</legend>
      <p className="hint -mt-1">Ages are counted on the event date. Each weight is that division’s maximum (“up to”). Change anything to match this competition’s rules.</p>
      <input type="hidden" name="division_rules" value={json} />

      {groups.map((g, gi) => (
        <div key={g.key} className="rounded-xl border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_4.5rem_4.5rem_auto] sm:items-end">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink">Age group</span>
              <input className="input" value={g.label} onChange={(e) => patchGroup(g.key, { label: e.target.value })} placeholder="Kids 2" maxLength={60} />
            </label>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:contents">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink">From</span>
              <input className="input" inputMode="numeric" value={g.minAge} onChange={(e) => patchGroup(g.key, { minAge: e.target.value.replace(/\D/g, "").slice(0, 3) })} aria-label={`${g.label || `Group ${gi + 1}`} minimum age`} />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink">To</span>
              <input className="input" inputMode="numeric" value={g.maxAge} onChange={(e) => patchGroup(g.key, { maxAge: e.target.value.replace(/\D/g, "").slice(0, 3) })} aria-label={`${g.label || `Group ${gi + 1}`} maximum age`} />
            </label>
            <button type="button" className="btn-ghost min-h-11 w-11 px-0 text-danger" aria-label={`Remove ${g.label || `group ${gi + 1}`}`} onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))} disabled={groups.length <= 1}>
              <TrashIcon size={16} />
            </button>
            </div>
          </div>

          <ul className="mt-2 space-y-1.5">
            {g.divisions.map((d, di) => (
              <li key={d.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                <input className="input min-h-10" value={d.label} onChange={(e) => patchDivision(g.key, d.key, { label: e.target.value })} placeholder="Light" maxLength={60} aria-label={`${g.label || `Group ${gi + 1}`} division ${di + 1} name`} />
                <span className="flex items-center gap-1 text-xs text-muted">
                  <span className="sm:hidden" aria-hidden>≤</span><span className="hidden sm:inline">up to</span>
                  <input className="input min-h-10 w-14 text-right tabular-nums sm:w-16" inputMode="decimal" value={d.maxKg} onChange={(e) => patchDivision(g.key, d.key, { maxKg: e.target.value.replace(/[^\d.]/g, "").slice(0, 6) })} aria-label={`${g.label || `Group ${gi + 1}`} division ${di + 1} maximum kg`} placeholder="kg" />
                  <span className="hidden sm:inline">kg</span>
                </span>
                <button type="button" className="btn-ghost min-h-10 w-10 px-0 text-muted" aria-label={`Remove ${d.label || `division ${di + 1}`} from ${g.label || `group ${gi + 1}`}`} onClick={() => patchGroup(g.key, { divisions: g.divisions.filter((x) => x.key !== d.key) })} disabled={g.divisions.length <= 1}>
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-ghost mt-2 min-h-10 px-2 text-xs text-primary"
            disabled={g.divisions.length >= MAX_DIVISIONS_PER_GROUP}
            onClick={() => patchGroup(g.key, { divisions: [...g.divisions, { key: nextKey(), label: "", maxKg: "" }] })}
          >
            <PlusIcon size={14} /> Add weight division
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary min-h-11"
          disabled={groups.length >= MAX_AGE_GROUPS}
          onClick={() => setGroups((gs) => [...gs, { key: nextKey(), label: "", minAge: "", maxAge: "", divisions: [{ key: nextKey(), label: "", maxKg: "" }] }])}
        >
          <PlusIcon size={16} /> Add age group
        </button>
        <button type="button" className="btn-ghost min-h-11" onClick={() => setGroups(toDraft(DEFAULT_LOCAL_RULES))}>
          Reset to the default chart
        </button>
      </div>
      <p className={cn("text-xs font-semibold", error || !check.ok ? "text-danger" : "text-muted")} role={error || !check.ok ? "alert" : undefined}>
        {error ?? (check.ok ? `${check.rules.ageGroups.length} age groups · ${check.rules.ageGroups.reduce((n, g) => n + g.divisions.length, 0)} weight divisions` : check.error)}
      </p>
    </fieldset>
  );
}
