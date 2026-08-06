// ============================================================
// Vouch — per-[id] horizontal authorization (IDOR / BOLA).
//
// watchlist/[id] and webhooks/[id] both take an id straight from the URL and
// mutate the matching row. The ONLY thing standing between "customer A deletes
// their own resource" and "customer A deletes customer B's resource by id" is
// that the data layer scopes every mutation by the caller's apiKeyId
// (WHERE id = ? AND api_key_id = ?). These tests brute-force that: the same id
// is attacked from a foreign key and must be refused, and the owner-scoping
// param must actually be bound into the query.
//
// The routes wire auth.ctx.apiKeyId (from the authenticated API key) straight
// into removeWatch(apiKeyId, id) / deleteWebhook(apiKeyId, id), so proving the
// data functions are owner-scoped proves the routes are.
//
// An in-memory fake db (injected via __setDbForTests) models real SQL AND
// semantics: a row is deleted only when the query's bound params match BOTH
// its id and its api_key_id — exactly the condition the production WHERE builds.
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setDbForTests } from "@/lib/db/client";
import { webhooks as webhooksTable, watchlistEntries } from "@/lib/db/schema";
import { removeWatch } from "@/lib/watchlist";
import { deleteWebhook } from "@/lib/webhooks";

// Pull the scalar bound values out of a drizzle condition (the args to eq()).
function boundParams(node: unknown, out: (string | number)[] = []): (string | number)[] {
  if (node == null) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const n of node) boundParams(n, out);
    return out;
  }
  if (typeof node === "object") {
    const v = (node as { value?: unknown }).value;
    if (typeof v === "string" || typeof v === "number") out.push(v);
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    if (chunks) boundParams(chunks, out);
  }
  return out;
}

interface Row {
  id: string;
  apiKeyId: string;
  [k: string]: unknown;
}

let lastDeleteParams: (string | number)[] = [];

function makeFakeDb(stores: Map<unknown, Row[]>) {
  return {
    delete(table: unknown) {
      return {
        where(cond: unknown) {
          const params = boundParams(cond);
          lastDeleteParams = params;
          return {
            async returning() {
              const store = stores.get(table) ?? [];
              const removed: Row[] = [];
              for (let i = store.length - 1; i >= 0; i--) {
                const row = store[i]!;
                // Real WHERE id=? AND api_key_id=?: both must be bound to match.
                if (params.includes(row.id) && params.includes(row.apiKeyId)) {
                  removed.push(row);
                  store.splice(i, 1);
                }
              }
              return removed;
            },
          };
        },
      };
    },
  };
}

afterEach(() => __setDbForTests(null));

test("watchlist: owner can delete their own entry", async () => {
  const stores = new Map<unknown, Row[]>([
    [watchlistEntries, [{ id: "watch-1", apiKeyId: "key_owner" }]],
  ]);
  __setDbForTests(makeFakeDb(stores));

  const ok = await removeWatch("key_owner", "watch-1");
  assert.equal(ok, true);
  assert.equal(stores.get(watchlistEntries)!.length, 0, "row removed");
  assert.ok(lastDeleteParams.includes("key_owner"), "query is scoped by the caller's apiKeyId");
});

test("watchlist: a FOREIGN key cannot delete another owner's entry (IDOR blocked)", async () => {
  const stores = new Map<unknown, Row[]>([
    [watchlistEntries, [{ id: "watch-1", apiKeyId: "key_owner" }]],
  ]);
  __setDbForTests(makeFakeDb(stores));

  const ok = await removeWatch("key_attacker", "watch-1"); // right id, wrong owner
  assert.equal(ok, false, "must report not-found for a non-owner");
  assert.equal(stores.get(watchlistEntries)!.length, 1, "victim's row is untouched");
  assert.ok(
    lastDeleteParams.includes("key_attacker") && !lastDeleteParams.includes("key_owner"),
    "the attacker's key — not the victim's — is what got bound",
  );
});

test("webhooks: owner can delete their own endpoint", async () => {
  const stores = new Map<unknown, Row[]>([
    [webhooksTable, [{ id: "wh-1", apiKeyId: "key_owner" }]],
  ]);
  __setDbForTests(makeFakeDb(stores));

  const ok = await deleteWebhook("key_owner", "wh-1");
  assert.equal(ok, true);
  assert.equal(stores.get(webhooksTable)!.length, 0);
});

test("webhooks: a FOREIGN key cannot delete another owner's endpoint (IDOR blocked)", async () => {
  const stores = new Map<unknown, Row[]>([
    [webhooksTable, [{ id: "wh-1", apiKeyId: "key_owner" }]],
  ]);
  __setDbForTests(makeFakeDb(stores));

  const ok = await deleteWebhook("key_attacker", "wh-1");
  assert.equal(ok, false, "not-yours and not-found are indistinguishable, both 404");
  assert.equal(stores.get(webhooksTable)!.length, 1, "victim's endpoint is untouched");
});

test("brute-forcing many ids under a foreign key never removes a foreign row", async () => {
  const victimRows: Row[] = Array.from({ length: 25 }, (_, i) => ({
    id: `res-${i}`,
    apiKeyId: "key_victim",
  }));
  const stores = new Map<unknown, Row[]>([[watchlistEntries, victimRows]]);
  __setDbForTests(makeFakeDb(stores));

  for (let i = 0; i < 25; i++) {
    const ok = await removeWatch("key_attacker", `res-${i}`);
    assert.equal(ok, false, `id res-${i} must not be deletable by a foreign key`);
  }
  assert.equal(stores.get(watchlistEntries)!.length, 25, "no victim row was deleted");
});
