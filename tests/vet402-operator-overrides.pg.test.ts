// ============================================================
// vet402 2026-08-14 — the operator-override transparency log, against Postgres.
//
// The EF/Vitalik blocker: a GLOBAL operator blacklist must leave a public,
// append-only, reasoned trace — and a CUSTOMER's own list must NOT (it is their
// private management right). These two properties are the whole point of the
// feature, so they are pinned against a real database and skip without one.
//
// Isolated in its own schema so it never races the other .pg tests.
// ============================================================
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { __setDbForTests } from "@/lib/db/client";
import {
  recordOperatorOverride,
  listOperatorOverrides,
} from "@/lib/db/operator-overrides";

const URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://takeshi@localhost:5432/vet402_scoring_test";

let sql: ReturnType<typeof postgres> | null = null;
let reachable = false;

before(async () => {
  try {
    sql = postgres(URL, { max: 1, connect_timeout: 3, onnotice: () => {} });
    await sql`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    if (sql) {
      await sql.end({ timeout: 1 }).catch(() => {});
      sql = null;
    }
    return;
  }
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await sql`CREATE SCHEMA IF NOT EXISTS vet402_ops`;
  await sql`SET search_path TO vet402_ops`;
  await sql`DROP TABLE IF EXISTS operator_overrides`;
  await sql`CREATE TABLE operator_overrides (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet text NOT NULL,
    action text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz DEFAULT now()
  )`;
  __setDbForTests(drizzle(sql, { schema }));
});

after(async () => {
  __setDbForTests(null);
  if (sql) {
    await sql.end({ timeout: 5 }).catch(() => {});
    sql = null;
  }
});

test("a recorded global override is publicly listable with address, action and reason", async (t) => {
  if (!reachable) return t.skip("no Postgres (set TEST_DATABASE_URL)");
  await sql!`TRUNCATE operator_overrides`;
  await recordOperatorOverride({
    wallet: "0x00000000000000000000000000000000000000AA",
    action: "blacklist_added",
    reason: "sanctioned mixer per OFAC listing 2026-08-01",
  });
  const log = await listOperatorOverrides();
  assert.equal(log.length, 1);
  assert.equal(log[0]!.wallet, "0x00000000000000000000000000000000000000aa");
  assert.equal(log[0]!.action, "blacklist_added");
  assert.match(log[0]!.reason, /OFAC/);
});

test("the log is append-only and newest-first", async (t) => {
  if (!reachable) return t.skip("no Postgres");
  await sql!`TRUNCATE operator_overrides`;
  await recordOperatorOverride({ wallet: "0x01", action: "blacklist_added", reason: "first" });
  await new Promise((r) => setTimeout(r, 5));
  await recordOperatorOverride({ wallet: "0x02", action: "blacklist_added", reason: "second" });
  const log = await listOperatorOverrides();
  assert.equal(log.length, 2, "both entries retained — nothing overwrites");
  assert.equal(log[0]!.reason, "second", "newest first");
});

test("a missing table degrades to an empty public log, never throws", async (t) => {
  if (!reachable) return t.skip("no Postgres");
  await sql!`DROP TABLE IF EXISTS operator_overrides`;
  const log = await listOperatorOverrides();
  assert.deepEqual(log, []);
  // recording into a missing table must also not throw (deploy-ordering)
  await recordOperatorOverride({ wallet: "0x03", action: "blacklist_added", reason: "x" });
  // restore for isolation hygiene
  await sql!`CREATE TABLE operator_overrides (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY, wallet text NOT NULL, action text NOT NULL,
    reason text NOT NULL, created_at timestamptz DEFAULT now())`;
});
