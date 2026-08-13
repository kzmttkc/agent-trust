// ============================================================
// vet402 2026-08-14 (中-3A) — the admin global-lists route gates BOTH verbs
// (add + withdraw) behind the same production-config trap, per-IP rate limit,
// and admin bearer auth. These drive the REAL handlers for the branches that
// need no database (auth + input validation short-circuit before the data
// layer): the DELETE withdrawal path must not be reachable without admin auth,
// and must refuse a reasonless / malformed withdrawal — a reason is mandatory
// because it is published verbatim in the public operator-override log.
// The happy path (delete row + record blacklist_removed) is covered against a
// real Postgres in vet402-operator-overrides.pg.test.ts.
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { DELETE as removeGlobal, POST as addGlobal } from "@/app/api/admin/global-lists/route";

const SECRET = "test-admin-secret-cn3a";
const WALLET = "0x00000000000000000000000000000000000000cc";

function del(body: unknown, token?: string) {
  return new NextRequest("http://localhost/api/admin/global-lists", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  delete process.env.ADMIN_SECRET;
});

test("DELETE without an admin bearer is forbidden (withdrawal is not public)", async () => {
  process.env.ADMIN_SECRET = SECRET;
  const res = await removeGlobal(del({ wallet: WALLET, reason: "x" }));
  assert.equal(res.status, 403);
});

test("DELETE with a WRONG bearer is forbidden", async () => {
  process.env.ADMIN_SECRET = SECRET;
  const res = await removeGlobal(del({ wallet: WALLET, reason: "x" }, "not-the-secret"));
  assert.equal(res.status, 403);
});

test("DELETE with valid auth but a BLANK reason is refused (a withdrawal must state why)", async () => {
  process.env.ADMIN_SECRET = SECRET;
  const res = await removeGlobal(del({ wallet: WALLET, reason: "   " }, SECRET));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_request" });
});

test("DELETE with valid auth but an invalid wallet is refused", async () => {
  process.env.ADMIN_SECRET = SECRET;
  const res = await removeGlobal(del({ wallet: "not-an-address", reason: "delisted" }, SECRET));
  assert.equal(res.status, 400);
});

test("POST still enforces admin auth after the shared-gate refactor (regression)", async () => {
  process.env.ADMIN_SECRET = SECRET;
  const req = new NextRequest("http://localhost/api/admin/global-lists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: WALLET, listType: "blacklist", reason: "x" }),
  });
  const res = await addGlobal(req);
  assert.equal(res.status, 403);
});
