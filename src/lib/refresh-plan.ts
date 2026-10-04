import { detectChanges, mergeMatch, type DetectedChange } from "./changes";
import { CLEAR_OVERRIDE, overrideSuperseded } from "./manual-correction";
import { takeMatching } from "./match-identity";
import type { IdentityConfidence, Json } from "./supabase/database.types";
import { DEFAULT_TIMEZONE } from "./time";
import type { MatchRow } from "./types";
import type { NormalizedMatch, WatchResult } from "./watchers/types";

/**
 * Pure diff between the stored match rows of one athlete and a fresh
 * WatchResult. The output is exactly what photo_apply_refresh applies in a
 * single transaction, so it can be unit-tested without a database and the
 * same plan is never applied twice (the RPC rejects a stale version).
 */

export type MatchPatch = Omit<MatchRow, "id" | "owner_id" | "athlete_id" | "created_at" | "updated_at">;

export type PlannedChange = DetectedChange & {
  /** Set for changes to an existing row. */
  match_id?: string;
  /** Index into `inserts` for changes about a row that does not exist yet. */
  match_ref?: number;
};

export type RefreshPlan = {
  /** True when the source was read and parsed (OK / NO_MATCHES / ATHLETE_NOT_FOUND). */
  ok: boolean;
  updates: Array<{ id: string; patch: MatchPatch }>;
  inserts: MatchPatch[];
  history: PlannedChange[];
  /** Existing rows the source no longer lists; kept, only re-stamped. */
  touchIds: string[];
  /** Optimistic preview of the resulting rows (inserted rows carry a `ref`). */
  preview: Array<MatchRow | (MatchPatch & { ref: number })>;
  /** Parsed matches that could belong to several stored rows. */
  ambiguous: number;
};

const SUCCESS_STATUSES = new Set(["OK", "NO_MATCHES", "ATHLETE_NOT_FOUND"]);

export function isSuccessfulRead(status: string): boolean {
  return SUCCESS_STATUSES.has(status);
}

export function buildRefreshPlan(existing: MatchRow[], result: WatchResult, checkedAt: string, timezone: string = DEFAULT_TIMEZONE): RefreshPlan {
  const ok = isSuccessfulRead(result.status);
  const empty: RefreshPlan = { ok, updates: [], inserts: [], history: [], touchIds: [], preview: existing, ambiguous: 0 };

  // Any non-OK outcome keeps what we know. A successful read with no rows
  // (schedule not published yet, or athlete not found) also keeps the previous
  // rows: the organiser may have temporarily unpublished, and the user controls
  // deletion. Crucially it does NOT re-stamp the kept rows' last_checked_at: an
  // empty read did not verify those matches, so their freshness must keep
  // reflecting the last time each was actually seen. (athlete-level
  // last_attempt_at / last_success_at still record that the source was read.)
  if (!ok || result.status !== "OK" || !result.matches.length) {
    return empty;
  }

  const pool = [...existing];
  const plan: RefreshPlan = { ok, updates: [], inserts: [], history: [], touchIds: [], preview: [], ambiguous: 0 };

  for (const parsed of result.matches) {
    const identity = takeMatching(pool, parsed, result.matches.length);

    if (identity.kind === "match") {
      const previous = identity.row;
      let patch = withConfidence(mergeMatch(previous, parsed, checkedAt), confidenceFor(previous, identity.confidence));
      // An owner's manual correction is never silently overwritten: it is
      // carried forward unless the SOURCE changed the corrected field, in which
      // case it is dropped explicitly with its own history entry.
      const superseded = overrideSuperseded(previous, { mat: parsed.mat, scheduledAt: parsed.scheduledAt });
      if (superseded.mat || superseded.time) {
        const keepMat = !superseded.mat && Boolean(previous.override_mat);
        const keepTime = !superseded.time && Boolean(previous.override_scheduled_at);
        patch = keepMat || keepTime
          ? { ...patch, override_mat: keepMat ? previous.override_mat : null, override_scheduled_at: keepTime ? previous.override_scheduled_at : null }
          : { ...patch, ...CLEAR_OVERRIDE };
        plan.history.push({
          change_type: "OVERRIDE_SUPERSEDED",
          old_value: { value: superseded.mat ? previous.override_mat : previous.override_scheduled_at, label: superseded.mat ? `Manual ${previous.override_mat}` : `Manual ${describeTime(previous.override_scheduled_at, timezone)}` },
          new_value: { value: superseded.mat ? parsed.mat : parsed.scheduledAt, label: superseded.mat ? `Source now says ${parsed.mat}` : `Source now says ${describeTime(parsed.scheduledAt, timezone)}` },
          match_id: previous.id,
        });
      }
      plan.updates.push({ id: previous.id, patch });
      plan.preview.push({ ...previous, ...patch });
      for (const c of detectChanges(previous, parsed, timezone)) plan.history.push({ ...c, match_id: previous.id });
      continue;
    }

    const ref = plan.inserts.length;
    const confidence: IdentityConfidence = identity.kind === "ambiguous" ? "ambiguous" : "exact";
    const patch = withConfidence(mergeMatch(null, parsed, checkedAt), confidence);
    plan.inserts.push(patch);
    plan.preview.push({ ...patch, ref });
    if (identity.kind === "ambiguous") {
      plan.ambiguous += 1;
      plan.history.push({
        change_type: "IDENTITY_AMBIGUOUS",
        old_value: { value: identity.candidates.map((c) => c.id).join(","), label: `${identity.candidates.length} similar matches` },
        new_value: { value: null, label: describeParsed(parsed, timezone) },
        match_ref: ref,
      });
    } else {
      plan.history.push({
        change_type: "MATCH_FOUND",
        old_value: { value: null, label: "No match" },
        new_value: { value: null, label: describeParsed(parsed, timezone) },
        match_ref: ref,
      });
    }
  }

  // Rows the source no longer lists were not seen in this read, so they are
  // kept as last-known WITHOUT advancing last_checked_at (which means "last
  // verified"). They age into Stale on their own, truthfully.
  plan.preview.push(...pool);
  return plan;
}

function confidenceFor(previous: MatchRow, matched: Exclude<IdentityConfidence, "ambiguous">): IdentityConfidence {
  // A row flagged ambiguous stays flagged until a user-visible resolution;
  // an exact id match upgrades it.
  if (previous.identity_confidence === "ambiguous" && matched !== "exact") return "ambiguous";
  return matched;
}

function withConfidence(patch: Omit<MatchPatch, "identity_confidence">, identity_confidence: IdentityConfidence): MatchPatch {
  return { ...patch, identity_confidence };
}

function describeTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function describeParsed(m: NormalizedMatch, timezone: string): string {
  const parts: string[] = [];
  if (m.mat) parts.push(m.mat);
  if (m.scheduledAt) {
    const d = new Date(m.scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d));
    }
  }
  if (m.opponent) parts.push(`vs ${m.opponent}`);
  return parts.join(" · ") || "Match added";
}

/** Serialises a plan into the jsonb arguments of photo_apply_refresh. */
export function planToRpcArgs(plan: RefreshPlan): { p_updates: Json; p_inserts: Json; p_history: Json; p_touch_ids: string[] } {
  return {
    p_updates: plan.updates.map((u) => ({ id: u.id, patch: u.patch as unknown as Json })) as Json,
    p_inserts: plan.inserts as unknown as Json,
    p_history: plan.history.map((h) => ({
      change_type: h.change_type,
      old_value: h.old_value as unknown as Json,
      new_value: h.new_value as unknown as Json,
      ...(h.match_id ? { match_id: h.match_id } : { match_ref: h.match_ref }),
    })) as Json,
    p_touch_ids: plan.touchIds,
  };
}
