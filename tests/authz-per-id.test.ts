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
//
// 2026-08-12 — the outcome-report route (events/{trustEventId}/outcome) is the
// same class of hole and was NOT covered here: it authenticated the caller and
// then wrote a partner outcome onto ANY trust event id, with an arbitrary
// relatedWallet. Those cases live at the bottom of this file and drive the REAL
// route handler, not just its data layer, because the wallet half of the check
// has no data-layer equivalent.
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { __setDbForTests } from "@/lib/db/client";
import {
  webhooks as webhooksTable,
  watchlistEntries,
  trustEvents as trustEventsTable,
  verdictOutcomes as verdictOutcomesTable,
} from "@/lib/db/schema";
import { removeWatch } from "@/lib/watchlist";
import { deleteWebhook } from "@/lib/webhooks";
import { POST as reportOutcome } from "@/app/api/v1/events/[trustEventId]/outcome/route";

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

// ============================================================
// events/{trustEventId}/outcome — partner outcome reporting.
//
// This one is worse than a delete-by-id: a partner outcome is not just the
// caller's own row. `confirmed_fraud` lands in verdict_outcomes.related_wallet,
// and getOutcomesForWallet() feeds exactly those rows into the payee scoring
// engine. So an unowned write here is not "vandalizing a record" — it is
// writing into another customer's verdict AND steering the score every future
// caller sees for the named wallet. Cost of the attack: one quota unit.
//
// Unlike the cases above, these drive the REAL route handler. Two invariants
// have to hold together and only one of them has a data-layer equivalent:
//   1. the trust event must belong to the calling key;
//   2. relatedWallet must be the wallet that verdict was actually about.
// Authentication runs through the dev-key path (no api_keys table needed);
// everything the route touches afterwards is the injected fake db.
// ============================================================

const DEV_KEY = "dev-key-for-authz-tests";
process.env.DEV_API_KEY = DEV_KEY;
// The dev key resolves to apiKeyId "dev" (src/lib/api/auth.ts), so that is the
// identity the route authenticates as — and therefore the only owner it may write for.
const CALLER_KEY_ID = "dev";

const VICTIM_EVENT = "11111111-1111-4111-8111-111111111111";
const OWN_EVENT = "22222222-2222-4222-8222-222222222222";
const VICTIM_WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OWN_WALLET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const UNRELATED_WALLET = "0xcccccccccccccccccccccccccccccccccccccccc";

/**
 * Fake db covering the read/write shapes this route reaches: a scoped SELECT on
 * trust_events, the idempotency SELECT + INSERT on verdict_outcomes, and the
 * fire-and-forget webhook lookup. A row matches only when EVERY value bound
 * into the WHERE equals some column on it — the faithful stand-in for a
 * conjunction of eq(column, param). That is what makes an unscoped query
 * (one bound param: the id) visibly different from a scoped one (id AND key).
 */
function makeOutcomeFakeDb(stores: Map<unknown, Row[]>) {
  const rowsFor = (table: unknown) => stores.get(table) ?? [];
  const matches = (row: Row, params: (string | number)[]) => {
    const values = new Set(Object.values(row).map((v) => String(v)));
    return params.every((p) => values.has(String(p)));
  };

  return {
    select() {
      return {
        from(table: unknown) {
          return {
            where(cond: unknown) {
              const params = boundParams(cond);
              const run = async () => rowsFor(table).filter((r) => matches(r, params));
              // drizzle's builder is awaitable with or without .limit().
              return {
                limit: async () => run(),
                then: (ok: (v: Row[]) => unknown, err: (e: unknown) => unknown) =>
                  run().then(ok, err),
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown>) {
          const run = async () => {
            const store = rowsFor(table);
            // unique(trust_event_id, outcome_type, source)
            const clash = store.some(
              (r) =>
                r.trustEventId === value.trustEventId &&
                r.outcomeType === value.outcomeType &&
                r.source === value.source,
            );
            if (clash) return [];
            const row = { id: `vo-${store.length + 1}`, ...value } as Row;
            store.push(row);
            stores.set(table, store);
            return [row];
          };
          return {
            onConflictDoNothing: () => ({ returning: run }),
            returning: run,
          };
        },
      };
    },
  };
}

function outcomeRequest(trustEventId: string, body: Record<string, unknown>) {
  return {
    request: new NextRequest(
      `http://localhost/api/v1/events/${trustEventId}/outcome`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${DEV_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    ),
    context: { params: Promise.resolve({ trustEventId }) },
  };
}

function seedEvents(): Map<unknown, Row[]> {
  return new Map<unknown, Row[]>([
    [
      trustEventsTable,
      [
        // Another customer's verdict. The attacker knows (or guessed) its id.
        {
          id: VICTIM_EVENT,
          apiKeyId: "key_victim",
          agentId: null,
          wallet: VICTIM_WALLET,
          createdAt: new Date("2026-08-01T00:00:00Z"),
          signals: null,
        },
        // The caller's own verdict — the normal, must-keep-working path.
        {
          id: OWN_EVENT,
          apiKeyId: CALLER_KEY_ID,
          agentId: null,
          wallet: OWN_WALLET,
          createdAt: new Date("2026-08-01T00:00:00Z"),
          signals: null,
        },
      ],
    ],
    [verdictOutcomesTable, []],
    [webhooksTable, []],
  ]);
}

test("outcome: the owner CAN label their own verdict (normal path intact)", async () => {
  const stores = seedEvents();
  __setDbForTests(makeOutcomeFakeDb(stores));

  const { request, context } = outcomeRequest(OWN_EVENT, {
    outcomeType: "confirmed_fraud",
    notes: "chargeback filed",
  });
  const res = await reportOutcome(request, context);

  assert.equal(res.status, 201, "owner's own report must still be accepted");
  const written = stores.get(verdictOutcomesTable)!;
  assert.equal(written.length, 1, "the owner's outcome is recorded");
  assert.equal(written[0]!.trustEventId, OWN_EVENT);
  assert.equal(written[0]!.relatedWallet, OWN_WALLET);
});

test("outcome: a FOREIGN key cannot label another customer's verdict (IDOR blocked)", async () => {
  const stores = seedEvents();
  __setDbForTests(makeOutcomeFakeDb(stores));

  const { request, context } = outcomeRequest(VICTIM_EVENT, {
    outcomeType: "confirmed_fraud",
  });
  const res = await reportOutcome(request, context);

  assert.equal(res.status, 404, "someone else's event must read as not-found");
  assert.deepEqual(
    await res.json(),
    { error: "trust_event_not_found" },
    "not-yours and not-found must be indistinguishable — a 403 here would confirm the id exists",
  );
  assert.equal(
    stores.get(verdictOutcomesTable)!.length,
    0,
    "nothing may be written against a verdict the caller does not own",
  );
});

test("outcome: a FOREIGN key cannot whitewash its own wallet either", async () => {
  const stores = seedEvents();
  __setDbForTests(makeOutcomeFakeDb(stores));

  // The mirror image of the fraud smear: confirmed_legitimate on a stranger's
  // verdict, naming the attacker's own wallet.
  const { request, context } = outcomeRequest(VICTIM_EVENT, {
    outcomeType: "confirmed_legitimate",
    relatedWallet: UNRELATED_WALLET,
  });
  const res = await reportOutcome(request, context);

  assert.equal(res.status, 404);
  assert.equal(stores.get(verdictOutcomesTable)!.length, 0);
});

test("outcome: relatedWallet cannot name a wallet the verdict was never about", async () => {
  const stores = seedEvents();
  __setDbForTests(makeOutcomeFakeDb(stores));

  // Owns the event, so the ownership check passes — but points the label at an
  // unrelated wallet, which is what actually reaches the payee scoring engine.
  const { request, context } = outcomeRequest(OWN_EVENT, {
    outcomeType: "confirmed_fraud",
    relatedWallet: UNRELATED_WALLET,
  });
  const res = await reportOutcome(request, context);

  assert.equal(res.status, 400, "a wallet the verdict was not about must be refused");
  assert.deepEqual(await res.json(), { error: "related_wallet_mismatch" });
  assert.equal(
    stores.get(verdictOutcomesTable)!.length,
    0,
    "no label may be attached to an unrelated wallet",
  );
});

test("outcome: relatedWallet matching the verdict's own wallet is accepted (any case)", async () => {
  const stores = seedEvents();
  __setDbForTests(makeOutcomeFakeDb(stores));

  const { request, context } = outcomeRequest(OWN_EVENT, {
    outcomeType: "confirmed_fraud",
    relatedWallet: OWN_WALLET.toUpperCase().replace("0X", "0x"),
  });
  const res = await reportOutcome(request, context);

  assert.equal(res.status, 201, "a checksummed spelling of the same wallet is the same wallet");
  assert.equal(stores.get(verdictOutcomesTable)!.length, 1);
});

test("outcome: brute-forcing event ids under a foreign key writes nothing", async () => {
  const victimRows: Row[] = Array.from({ length: 20 }, (_, i) => ({
    id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
    apiKeyId: "key_victim",
    agentId: null,
    wallet: VICTIM_WALLET,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    signals: null,
  }));
  const stores = new Map<unknown, Row[]>([
    [trustEventsTable, victimRows],
    [verdictOutcomesTable, []],
    [webhooksTable, []],
  ]);
  __setDbForTests(makeOutcomeFakeDb(stores));

  for (const row of victimRows) {
    const { request, context } = outcomeRequest(row.id, { outcomeType: "confirmed_fraud" });
    const res = await reportOutcome(request, context);
    assert.equal(res.status, 404, `event ${row.id} must not be labelable by a foreign key`);
  }
  assert.equal(stores.get(verdictOutcomesTable)!.length, 0, "no outcome was written at all");
});
