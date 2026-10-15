#!/usr/bin/env node
// Runs the migrations and the SQL tests against a disposable database.
//
//   npm run test:db                       # DATABASE_URL or postgres://postgres:postgres@127.0.0.1:5432/postgres
//   node scripts/db/sql-tests.mjs --only rls --keep --no-shim
//
// What it does, in order:
//   1. creates a fresh database `bbm_sql_tests` on the server DATABASE_URL points at
//      (dropped first when it exists; --keep leaves it behind for inspection);
//   2. applies scripts/db/shim.sql (the Supabase-managed roles, auth.* and storage.*)
//      unless --no-shim is given (real Supabase images already have them);
//   3. applies every supabase/migrations/*.sql in filename order with ON_ERROR_STOP;
//   3b. applies scripts/db/seed.sql (one owner + studio row + event the older tests
//      look up) unless --no-seed is given;
//   4. runs every supabase/tests/*.sql. A test passes when it ends in the exception
//      `ROLLBACK_OK: …` (the project's DO-block convention: every assertion is
//      checked inside one transaction that is then rolled back on purpose).
//
// Needs `psql` on PATH. Prints one line per step and a summary; exit code 1 on
// any failure. Nothing here touches the hosted project: DATABASE_URL defaults
// to a local server and the harness refuses hosts that look like Supabase.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const TESTS = path.join(ROOT, "supabase", "tests");
const SHIM = path.join(here, "shim.sql");
const SEED = path.join(here, "seed.sql");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DB_NAME = opt("db") ?? "bbm_sql_tests";
const only = opt("only");
const keep = flag("keep");
const noShim = flag("no-shim");
const noSeed = flag("no-seed");

const adminUrl = new URL(process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres");
if (/supabase\.(co|com)$/i.test(adminUrl.hostname) || /pooler\.supabase/i.test(adminUrl.hostname)) {
  console.error(`Refusing to run against ${adminUrl.hostname}: this harness creates and drops databases. Point DATABASE_URL at a local or CI server.`);
  process.exit(2);
}
const testUrl = new URL(adminUrl.toString());
testUrl.pathname = `/${DB_NAME}`;

function psql(url, psqlArgs, { allowFailure = false } = {}) {
  const res = spawnSync("psql", [url.toString(), "-X", "-q", "-v", "ON_ERROR_STOP=1", ...psqlArgs], { encoding: "utf8", env: { ...process.env, PGCONNECT_TIMEOUT: "10" } });
  if (res.error) {
    console.error(`psql could not start: ${res.error.message}`);
    process.exit(2);
  }
  if (res.status !== 0 && !allowFailure) {
    console.error(res.stdout.trim());
    console.error(res.stderr.trim());
    process.exit(1);
  }
  return res;
}

const sqlFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

console.log(`Server: ${adminUrl.hostname}:${adminUrl.port || 5432} (user ${adminUrl.username || "default"}) → database ${DB_NAME}`);
psql(adminUrl, ["-c", `drop database if exists "${DB_NAME}"`]);
psql(adminUrl, ["-c", `create database "${DB_NAME}"`]);

if (!noShim) {
  psql(testUrl, ["-f", SHIM]);
  console.log("shim      ok  scripts/db/shim.sql");
}

for (const file of sqlFiles(MIGRATIONS)) {
  const started = Date.now();
  psql(testUrl, ["-f", path.join(MIGRATIONS, file)]);
  console.log(`migrate   ok  ${file} (${Date.now() - started} ms)`);
}

if (!noSeed) {
  psql(testUrl, ["-f", SEED]);
  console.log("seed      ok  scripts/db/seed.sql (one owner, studio row and event the tests look up)");
}

const results = [];
for (const file of sqlFiles(TESTS)) {
  if (only && !file.includes(only)) continue;
  const started = Date.now();
  const res = psql(testUrl, ["-f", path.join(TESTS, file)], { allowFailure: true });
  const out = `${res.stdout}\n${res.stderr}`;
  const ok = /ROLLBACK_OK/.test(out);
  results.push({ file, ok, ms: Date.now() - started, out });
  console.log(`test      ${ok ? "ok " : "FAIL"} ${file} (${Date.now() - started} ms)`);
  if (!ok) console.log(out.trim().split("\n").slice(-25).map((l) => `            ${l}`).join("\n"));
}

if (!keep) psql(adminUrl, ["-c", `drop database if exists "${DB_NAME}"`]);
else console.log(`kept database ${DB_NAME} (--keep)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${only ? ` (filter: ${only})` : ""}`);
process.exit(failed.length ? 1 : 0);
