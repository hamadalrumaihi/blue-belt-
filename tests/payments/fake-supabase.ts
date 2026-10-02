/**
 * Minimal in-memory stand-in for the Supabase service client, covering only
 * the query shapes the payments module uses:
 *   from(t).insert(row).select(cols).single()
 *   from(t).insert(row)
 *   from(t).select(cols).eq(..).eq(..).maybeSingle()
 *   from(t).update(patch).eq(..)[.eq(..)][.select(cols)]
 * Enforces the partial unique indexes from the migration so idempotency can
 * be tested the way Postgres would behave (error code 23505).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Row = Record<string, unknown>;
type Filter = { col: string; val: unknown };
type Op = "select" | "insert" | "update";

const UNIQUE: Record<string, string[][]> = {
  photo_payment_events: [["provider", "provider_event_id"]],
  photo_payment_attempts: [["provider", "provider_payment_id"]],
  photo_bookings: [["provider", "provider_invoice_id"]],
};

export type FakeCall = { table: string; op: Op; payload?: Row; filters: Filter[] };

export class FakeSupabase {
  tables: Record<string, Row[]> = { photo_payment_events: [], photo_bookings: [], photo_payment_attempts: [], photo_athletes: [] };
  calls: FakeCall[] = [];
  private seq = 1;

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new FakeQuery(this, table);
  }

  seed(table: string, rows: Row[]) {
    for (const r of rows) this.tables[table].push({ ...r });
  }

  nextId(): number {
    return this.seq++;
  }

  asClient(): SupabaseClient<Database> {
    return this as unknown as SupabaseClient<Database>;
  }
}

class FakeQuery {
  private op: Op = "select";
  private payload: Row | null = null;
  private filters: Filter[] = [];
  private returning = false;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private db: FakeSupabase,
    private table: string,
  ) {}

  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  select(cols?: string) {
    void cols; // column projection is not modelled; rows come back whole
    if (this.op === "select") return this;
    this.returning = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  // Supabase builders are thenables; awaiting one runs the query.
  then<T>(resolve: (v: { data: unknown; error: { code: string; message: string } | null }) => T, reject?: (e: unknown) => T) {
    try {
      return Promise.resolve(this.exec()).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  }

  private matches(row: Row) {
    return this.filters.every((f) => row[f.col] === f.val);
  }

  private exec() {
    this.db.calls.push({ table: this.table, op: this.op, payload: this.payload ?? undefined, filters: this.filters });
    const rows = this.db.tables[this.table];
    if (this.op === "insert") {
      const row = { id: this.db.nextId(), attempts: 1, ...this.payload } as Row;
      for (const cols of UNIQUE[this.table] ?? []) {
        if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
        const clash = rows.find((r) => cols.every((c) => r[c] === row[c]));
        if (clash) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${cols.join(",")})` } };
      }
      rows.push(row);
      return this.shape([row]);
    }
    const hit = rows.filter((r) => this.matches(r));
    if (this.op === "update") {
      for (const r of hit) Object.assign(r, this.payload);
      return this.returning ? this.shape(hit) : { data: null, error: null };
    }
    return this.shape(hit);
  }

  private shape(hit: Row[]) {
    const copy = hit.map((r) => ({ ...r }));
    if (this.mode === "single") return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { code: "PGRST116", message: `expected 1 row, got ${copy.length}` } };
    if (this.mode === "maybeSingle") return { data: copy[0] ?? null, error: null };
    return { data: copy, error: null };
  }
}
