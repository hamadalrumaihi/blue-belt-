/**
 * Minimal in-memory stand-in for the Supabase service client, covering only
 * the query shapes the payments module uses:
 *   from(t).insert(row).select(cols).single()
 *   from(t).insert(row)
 *   from(t).select(cols).eq(..).eq(..).maybeSingle()
 *   from(t).update(patch).eq(..)[.eq(..)][.select(cols)]
 *   from(t).select().in(..).is(..).lt(..).not(..).order(..).limit(n)
 *   from(t).upsert(rows, { ignoreDuplicates: true })[.select(cols)]   (insert-or-skip on the unique keys; select returns the inserted rows)
 *   rpc("photo_apply_payment_transition", args)   (emulated in-process, sequentially)
 * Enforces the partial unique indexes from the migration so idempotency can
 * be tested the way Postgres would behave (error code 23505).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Op = "select" | "insert" | "update" | "upsert";

/** PostgREST JSON path columns (`metadata->>pay_token_hash`): read the nested text value. */
function readColumn(row: Row, col: string): unknown {
  if (!col.includes("->")) return row[col];
  const [base, ...path] = col.split(/->>?/);
  let v: unknown = row[base];
  for (const key of path) v = v && typeof v === "object" ? (v as Row)[key] : undefined;
  return v === undefined ? null : v;
}

const UNIQUE: Record<string, string[][]> = {
  photo_payment_events: [["provider", "provider_event_id"]],
  photo_payment_attempts: [["provider", "provider_payment_id"]],
  photo_bookings: [["provider", "provider_invoice_id"]],
  photo_notification_deliveries: [["owner_id", "channel", "alert_key"]],
  photo_incidents: [["owner_id", "incident_key"]],
  photo_payment_records: [["provider", "provider_payment_id"]],
};

export type FakeCall = { table: string; op: Op; payload?: Row; filters: number };
export type FakeRpcCall = { name: string; args: Record<string, unknown> };

export class FakeSupabase {
  tables: Record<string, Row[]> = { photo_payment_events: [], photo_bookings: [], photo_payment_attempts: [], photo_athletes: [], photo_notification_deliveries: [], photo_payment_records: [], photo_client_notification_prefs: [], photo_studio: [] };
  calls: FakeCall[] = [];
  rpcCalls: FakeRpcCall[] = [];
  private seq = 1;

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new FakeQuery(this, table);
  }

  seed(table: string, rows: Row[]) {
    if (!this.tables[table]) this.tables[table] = [];
    for (const r of rows) this.tables[table].push({ ...r });
  }

  nextId(): number {
    return this.seq++;
  }

  /** Emulates photo_apply_payment_transition: guarded booking update + attempt + event row + outbox, all-or-nothing. */
  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name !== "photo_apply_payment_transition") return { data: null, error: { code: "42883", message: `unknown function ${name}` } };
    const booking = this.tables.photo_bookings.find((b) => b.id === args.p_booking_id);
    if (!booking) return { data: { applied: false, reason: "booking_not_found" }, error: null };
    if (booking.status !== args.p_expected_status) return { data: { applied: false, reason: "concurrent_update", status: booking.status }, error: null };
    const columns = args.p_columns as Row;
    Object.assign(booking, columns);
    const attempt = args.p_attempt as Row | null | undefined;
    if (attempt) {
      const row: Row = { id: this.nextId(), owner_id: booking.owner_id, booking_id: booking.id, provider: attempt.provider ?? "MYFATOORAH", status: attempt.status ?? columns.status, amount: attempt.amount ?? booking.amount_qr, currency: attempt.currency ?? booking.currency, ...attempt };
      const clash = row.provider_payment_id && this.tables.photo_payment_attempts.some((a) => a.provider === row.provider && a.provider_payment_id === row.provider_payment_id);
      if (!clash) this.tables.photo_payment_attempts.push(row);
    }
    if (args.p_event_row_id !== null && args.p_event_row_id !== undefined) {
      const ev = this.tables.photo_payment_events.find((e) => e.id === args.p_event_row_id);
      if (ev) Object.assign(ev, { processing_result: args.p_processing_result, processed_at: new Date().toISOString(), booking_id: booking.id, owner_id: booking.owner_id });
    }
    const delivery = args.p_delivery as Row | null | undefined;
    if (delivery) {
      const exists = this.tables.photo_notification_deliveries.some((d) => d.owner_id === booking.owner_id && d.channel === (delivery.channel ?? "telegram") && d.alert_key === delivery.alert_key);
      if (!exists) this.tables.photo_notification_deliveries.push({ id: this.nextId(), owner_id: booking.owner_id, channel: delivery.channel ?? "telegram", alert_key: delivery.alert_key, kind: delivery.kind ?? "PAYMENT_CONFIRMED", category: "orders", payload: delivery.payload ?? {}, status: "pending", attempts: 0 });
    }
    return { data: { applied: true, status: columns.status ?? booking.status, owner_id: booking.owner_id }, error: null };
  }

  asClient(): SupabaseClient<Database> {
    return this as unknown as SupabaseClient<Database>;
  }
}

class FakeQuery {
  private op: Op = "select";
  private payload: Row | null = null;
  private upsertRows: Row[] = [];
  private filters: Filter[] = [];
  private returning = false;
  private mode: "many" | "single" | "maybeSingle" = "many";
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;

  constructor(
    private db: FakeSupabase,
    private table: string,
  ) {}

  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  /** Only `ignoreDuplicates: true` is modelled: rows that clash on a unique key are skipped. */
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    if (!opts?.ignoreDuplicates) throw new Error("FakeSupabase.upsert only models ignoreDuplicates: true");
    this.op = "upsert";
    this.upsertRows = Array.isArray(rows) ? rows : [rows];
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
    this.filters.push((r) => readColumn(r, col) === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  not(col: string, _op: string, val: unknown) {
    this.filters.push((r) => (r[col] ?? null) !== val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) < String(val));
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) > String(val));
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) <= String(val));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
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
    return this.filters.every((f) => f(row));
  }

  private exec() {
    this.db.calls.push({ table: this.table, op: this.op, payload: this.payload ?? undefined, filters: this.filters.length });
    const rows = this.db.tables[this.table];
    if (this.op === "upsert") {
      const inserted: Row[] = [];
      for (const input of this.upsertRows) {
        const row = { id: this.db.nextId(), ...input } as Row;
        const clash = (UNIQUE[this.table] ?? []).some((cols) => rows.some((r) => cols.every((c) => r[c] === row[c])));
        if (!clash) {
          rows.push(row);
          inserted.push(row);
        }
      }
      return this.returning ? this.shape(inserted) : { data: null, error: null };
    }
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
    let hit = rows.filter((r) => this.matches(r));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      hit = [...hit].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.limitN !== null) hit = hit.slice(0, this.limitN);
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
