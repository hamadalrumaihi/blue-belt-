/**
 * Offline-first coverage completion as desired-state commands (pure).
 *
 * A tap on "Photos done" does not call the server directly. It records a
 * command — "for athlete A, kind K, the desired state is done=true, based on
 * the server version V I last saw" — persists it, and a sync loop replays
 * commands through the server action, which re-checks the session and the
 * assignment and applies them idempotently by command id.
 *
 * Rules pinned by tests/coverage-queue.test.ts:
 *   - one live command per (athlete, kind): a newer tap replaces an older
 *     pending one (the latest desired state is what matters);
 *   - a command is removed only when the ack names ITS id and it is still the
 *     live command for that key — a late ack for an older tap never deletes a
 *     newer one;
 *   - states: pending → saved | failed (retryable) | conflict (needs a human).
 */

export type CoverageKind = "photo" | "video";
export type CommandState = "pending" | "saved" | "failed" | "conflict";

export type CoverageCommand = {
  id: string;
  kind: "coverage_done";
  athleteId: string;
  coverageKind: CoverageKind;
  done: boolean;
  /** Server version this decision was based on: the done_at of that kind when the user tapped (null = not done). */
  expectedDoneAt: string | null;
  /** Set when the user chose "apply mine anyway" on a conflict. */
  force: boolean;
  createdAt: string;
  attempts: number;
  state: CommandState;
  error: string | null;
  /** Server's current done_at for that kind when a conflict was reported. */
  serverDoneAt?: string | null;
  /** Server ack time (saved). Saved commands are kept briefly for the UI, then pruned. */
  savedAt?: string | null;
};

export type CommandAck =
  | { ok: true; state: "saved"; doneAt: string | null }
  | { ok: false; state: "conflict"; serverDoneAt: string | null; error: string }
  | { ok: false; state: "failed"; error: string; retryable: boolean };

export const keyOf = (c: Pick<CoverageCommand, "athleteId" | "coverageKind">) => `${c.athleteId}|${c.coverageKind}`;

export function newCommand(input: { id: string; athleteId: string; coverageKind: CoverageKind; done: boolean; expectedDoneAt: string | null; now: Date; force?: boolean }): CoverageCommand {
  return { id: input.id, kind: "coverage_done", athleteId: input.athleteId, coverageKind: input.coverageKind, done: input.done, expectedDoneAt: input.expectedDoneAt, force: input.force ?? false, createdAt: input.now.toISOString(), attempts: 0, state: "pending", error: null };
}

/** Adds a command, replacing any earlier command for the same athlete + kind. */
export function enqueue(queue: CoverageCommand[], command: CoverageCommand): CoverageCommand[] {
  const key = keyOf(command);
  return [...queue.filter((c) => keyOf(c) !== key), command];
}

/** The live command for a key, if any. */
export function liveCommand(queue: CoverageCommand[], athleteId: string, coverageKind: CoverageKind): CoverageCommand | null {
  return queue.find((c) => c.athleteId === athleteId && c.coverageKind === coverageKind) ?? null;
}

/** Commands that should be sent now: pending or failed, oldest first. */
export function sendable(queue: CoverageCommand[]): CoverageCommand[] {
  return queue.filter((c) => c.state === "pending" || c.state === "failed").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Applies the server's answer for command `id`. Ignored when that id is no
 * longer the live command for its key (a newer tap superseded it).
 */
export function applyAck(queue: CoverageCommand[], id: string, ack: CommandAck, now: Date): CoverageCommand[] {
  const current = queue.find((c) => c.id === id);
  if (!current) return queue;
  const next: CoverageCommand = ack.ok
    ? { ...current, state: "saved", error: null, savedAt: now.toISOString(), attempts: current.attempts + 1 }
    : ack.state === "conflict"
      ? { ...current, state: "conflict", error: ack.error, serverDoneAt: ack.serverDoneAt, attempts: current.attempts + 1 }
      : { ...current, state: ack.retryable ? "failed" : "conflict", error: ack.error, attempts: current.attempts + 1 };
  return queue.map((c) => (c.id === id ? next : c));
}

/** Resolves a conflict the user accepted: resend with force and the server's version. */
export function forceCommand(queue: CoverageCommand[], id: string, now: Date): CoverageCommand[] {
  return queue.map((c) => (c.id === id ? { ...c, force: true, expectedDoneAt: c.serverDoneAt ?? null, state: "pending", error: null, createdAt: now.toISOString() } : c));
}

/** Drops a conflicted command (the user keeps the server's state). */
export function dismiss(queue: CoverageCommand[], id: string): CoverageCommand[] {
  return queue.filter((c) => c.id !== id);
}

/** Removes saved commands older than `ttlMs` (the UI has shown "Saved" long enough). */
export function prune(queue: CoverageCommand[], now: Date, ttlMs = 10_000): CoverageCommand[] {
  return queue.filter((c) => !(c.state === "saved" && c.savedAt && now.getTime() - new Date(c.savedAt).getTime() > ttlMs));
}

/** Retry delay for a failed command (bounded exponential). */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** The done state to SHOW for a kind: the live command's desired state, else the server's. */
export function displayedDone(queue: CoverageCommand[], athleteId: string, coverageKind: CoverageKind, serverDoneAt: string | null): { done: boolean; state: CommandState | "synced"; command: CoverageCommand | null } {
  const live = liveCommand(queue, athleteId, coverageKind);
  if (!live) return { done: Boolean(serverDoneAt), state: "synced", command: null };
  if (live.state === "conflict") return { done: Boolean(serverDoneAt), state: "conflict", command: live };
  return { done: live.done, state: live.state, command: live };
}

export function parseQueue(raw: string | null): CoverageCommand[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(isCommand);
  } catch {
    return [];
  }
}

function isCommand(v: unknown): v is CoverageCommand {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.kind === "coverage_done" && typeof o.id === "string" && typeof o.athleteId === "string" && (o.coverageKind === "photo" || o.coverageKind === "video") && typeof o.done === "boolean" && typeof o.createdAt === "string";
}
