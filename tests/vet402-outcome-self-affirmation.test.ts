// ============================================================
// vet402 2026-08-13 (ruling 7) — a partner cannot vouch for itself.
//
// The outcome endpoint only ever reaches the caller's OWN verdicts (the SELECT
// is scoped by api_key_id, re-asserted by an explicit ownership check). So a
// POSITIVE outcome reported here is always "I scored this wallet, and I now
// declare it legitimate" — self-lookup → self-affirmation. Because anyone can
// score any wallet, that let a key raise a wallet's payee score (via
// getOutcomesForWallet → applyOutcomeAdjustment's +8) purely by self-
// declaration: the same self-attestation-raises-score pattern the rest of this
// change removes from the ledger.
//
// So confirmed_legitimate is rejected from the partner endpoint; positive
// standing must be EARNED from on-chain activity (the auto-detector's
// sustained_healthy_activity), not self-declared. NEGATIVE reports
// (confirmed_fraud, chargeback_dispute) stay open — a counterparty warning
// others about a wallet that harmed it is the legitimate use, and the ownership
// + subject-wallet checks already pin it. This file drives the REAL route.
//
// Run: npm test
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { __setDbForTests } from "@/lib/db/client";
import { trustEvents, verdictOutcomes, webhooks } from "@/lib/db/schema";
import { POST as reportOutcome } from "@/app/api/v1/events/[trustEventId]/outcome/route";

const DEV_KEY = "dev-key-for-selfaffirm-tests";
process.env.DEV_API_KEY = DEV_KEY;
const CALLER_KEY_ID = "dev"; // the dev key resolves to apiKeyId "dev"

const OWN_EVENT = "22222222-2222-4222-8222-222222222222";
const FOREIGN_EVENT = "11111111-1111-4111-8111-111111111111";
const OWN_WALLET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FOREIGN_WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

interface Row {
  id: string;
  apiKeyId: string;
  [k: string]: unknown;
}

function boundParams(node: unknown, out: (string | number)[] = []): (string | number)[] {
  if (node == null) return out;
  if (typeof node === "string" || typeof node === "number") return (out.push(node), out);
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

function makeFakeDb(stores: Map<unknown, Row[]>) {
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
              return {
                limit: async () => run(),
                then: (ok: (v: Row[]) => unknown, err: (e: unknown) => unknown) => run().then(ok, err),
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
            const row = { id: `vo-${store.length + 1}`, ...value } as Row;
            store.push(row);
            stores.set(table, store);
            return [row];
          };
          return { onConflictDoNothing: () => ({ returning: run }), returning: run };
        },
      };
    },
  };
}

function seed(): Map<unknown, Row[]> {
  return new Map<unknown, Row[]>([
    [
      trustEvents,
      [
        { id: OWN_EVENT, apiKeyId: CALLER_KEY_ID, agentId: null, wallet: OWN_WALLET, createdAt: new Date("2026-08-01T00:00:00Z"), signals: null },
        { id: FOREIGN_EVENT, apiKeyId: "key_victim", agentId: null, wallet: FOREIGN_WALLET, createdAt: new Date("2026-08-01T00:00:00Z"), signals: null },
      ],
    ],
    [verdictOutcomes, []],
    [webhooks, []],
  ]);
}

function request(trustEventId: string, body: Record<string, unknown>) {
  return {
    request: new NextRequest(`http://localhost/api/v1/events/${trustEventId}/outcome`, {
      method: "POST",
      headers: { authorization: `Bearer ${DEV_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ trustEventId }) },
  };
}

afterEach(() => __setDbForTests(null));

test("self-affirming your own verdict (confirmed_legitimate) is rejected, and writes nothing", async () => {
  const stores = seed();
  __setDbForTests(makeFakeDb(stores));

  const { request: req, context } = request(OWN_EVENT, { outcomeType: "confirmed_legitimate" });
  const res = await reportOutcome(req, context);

  assert.equal(res.status, 422, "a self-declared positive standing is not accepted");
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, "self_affirmation_not_accepted");
  assert.equal(stores.get(verdictOutcomes)!.length, 0, "nothing was written to scoring");
});

test("reporting fraud on your own verdict still works (the legitimate negative path)", async () => {
  const stores = seed();
  __setDbForTests(makeFakeDb(stores));

  const { request: req, context } = request(OWN_EVENT, { outcomeType: "confirmed_fraud", notes: "chargeback filed" });
  const res = await reportOutcome(req, context);

  assert.equal(res.status, 201, "a counterparty fraud report is the legitimate use");
  const written = stores.get(verdictOutcomes)!;
  assert.equal(written.length, 1);
  assert.equal(written[0]!.outcomeType, "confirmed_fraud");
  assert.equal(written[0]!.relatedWallet, OWN_WALLET);
});

test("chargeback_dispute (also negative) is unaffected by the self-affirmation block", async () => {
  const stores = seed();
  __setDbForTests(makeFakeDb(stores));

  const { request: req, context } = request(OWN_EVENT, { outcomeType: "chargeback_dispute" });
  const res = await reportOutcome(req, context);
  assert.equal(res.status, 201);
  assert.equal(stores.get(verdictOutcomes)!.length, 1);
});

test("the self-affirmation block does not leak the existence of a FOREIGN verdict", async () => {
  // confirmed_legitimate on a stranger's event must still 404 (ownership), NOT
  // 422 — otherwise the new block would become an existence oracle over other
  // customers' event ids. Ownership is checked before the self-affirmation gate.
  const stores = seed();
  __setDbForTests(makeFakeDb(stores));

  const { request: req, context } = request(FOREIGN_EVENT, {
    outcomeType: "confirmed_legitimate",
    relatedWallet: OWN_WALLET,
  });
  const res = await reportOutcome(req, context);

  assert.equal(res.status, 404, "not-yours is indistinguishable from not-found");
  assert.equal(stores.get(verdictOutcomes)!.length, 0);
});
