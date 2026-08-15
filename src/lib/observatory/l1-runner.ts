// ============================================================
// vet402 Observatory L1 — purchase runner (design §1 L1/L2, §5 W3).
//
// One batch = walk the real-demand target list and, per endpoint, do ONE
// covert purchase: request → 402 → sign (x402-payer's funnel of refusals) →
// paid retry → record what actually happened, with the settlement tx hash
// as the receipt. Everything is recorded, including the refusals — a seller
// over-charging vs its own catalog listing is a published fact, not a
// payment.
//
// Money discipline (in order of the checks in code):
//  1. Master switches: OBSERVATORY_L1_ENABLED must be "true" AND the wallet
//     key present — otherwise zero requests are made at all.
//  2. Budget: today's spend is summed FROM THE DATABASE (x402_l1_purchases.
//     spent_units, UTC day) — restarts and concurrent invocations read the
//     same ledger. checkL1Budget gates each purchase BEFORE signing.
//  3. spent_units is RESERVED (row written, status `in_flight`) BEFORE the
//     signature exists, and the reservation itself re-checks the day's total
//     inside a single SQL statement (reserveSpend). Two reasons, both found
//     live-fire in the 2026-08-15 audit: (a) a signed EIP-3009 authorization
//     is live money until validBefore, so a kill between signing and the
//     write (maxDuration, DB blip) must not lose the spend; (b) reading the
//     day's total once per batch let two overlapping invocations each spend a
//     full daily budget ($49 measured against a $25 cap).
//  4. One purchase per endpoint per sweep window (default 6 days) — the
//     weekly-sweep cadence emerges from the daily budget, not from a queue.
// ============================================================
import { privateKeyToAccount } from "viem/accounts";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/pg-errors";
import { x402L1Purchases } from "@/lib/db/schema";
import { UnsafeTargetError, createSafeFetchImpl } from "@/lib/net/safe-fetch";
import { checkL1Budget, isL1Enabled, DAILY_BUDGET_USD } from "./budget";
import {
  buildAuthorization,
  encodePaymentHeader,
  parseChallenge,
  parseSettlementResponse,
  selectAccept,
  signX402Payment,
} from "./x402-payer";
import { logServerError } from "@/lib/util/log";

export type L1BatchSummary = {
  attempted: number;
  settled: number;
  settleFailed: number;
  skipped: number;
  budgetDenied: number;
  spentUnitsTotal: string;
  disabledReason: "l1_disabled" | "wallet_key_missing" | null;
};

type Candidate = {
  id: string;
  resourceUrl: string;
  method: string | null;
  priceAmount: string | null;
  payTo: string | null;
  declaredSchema: unknown;
};

const USDC_PER_USD = 1_000_000;

const guardedFetch = createSafeFetchImpl();

/** The daily cap in USDC base units — the same $25 checkL1Budget judges in USD. */
const DAILY_BUDGET_UNITS = BigInt(DAILY_BUDGET_USD) * BigInt(USDC_PER_USD);

/** Endpoints purchased within this window are not re-purchased (1判定1購買). */
export const SWEEP_WINDOW_DAYS = 6;

function unitsToUsd(units: bigint): number {
  return Number(units) / USDC_PER_USD;
}

function rowsOf(raw: unknown): Record<string, unknown>[] {
  return (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Record<
    string,
    unknown
  >[];
}

type Reservation =
  | { ok: true; rowId: string }
  | { ok: false; reason: "daily_budget_exceeded" | "already_purchased" };

/**
 * Claim the spend before it can happen. ONE statement, so the day's total and
 * the sweep-window check are evaluated and the ledger row written without the
 * caller ever holding a stale number: whoever commits first is the one whose
 * money is counted, and the loser is refused.
 *
 * Written as a single statement on purpose — production runs on neon-http,
 * where every query is its own connection and implicit transaction, so
 * multi-statement locking (advisory locks, SELECT ... FOR UPDATE) cannot span
 * a check and its write. What is left uncovered is only the sub-millisecond
 * overlap of two INSERTs whose snapshots predate each other's commit, and its
 * cost is bounded by one purchase (≤ $1), not by a second daily budget.
 */
async function reserveSpend(input: {
  db: NonNullable<ReturnType<typeof getDb>>;
  endpointId: string;
  payer: string;
  network: string;
  asset: string;
  payTo: string;
  amountUnits: string;
}): Promise<Reservation> {
  const { db, endpointId, payer, network, asset, payTo, amountUnits } = input;
  const raw = await db.execute(sql`
    WITH day AS (
      SELECT coalesce(sum(spent_units::numeric), 0) AS spent
      FROM x402_l1_purchases
      WHERE attempted_at >= date_trunc('day', now() AT TIME ZONE 'utc')
    ), dup AS (
      SELECT EXISTS (
        SELECT 1 FROM x402_l1_purchases pu
        WHERE pu.endpoint_id = ${endpointId}::uuid
          AND pu.attempted_at > now() - make_interval(days => ${SWEEP_WINDOW_DAYS})
      ) AS taken
    ), ins AS (
      INSERT INTO x402_l1_purchases
        (endpoint_id, status, payer, network, asset, pay_to, amount_units, spent_units)
      SELECT ${endpointId}::uuid, 'in_flight', ${payer}, ${network}, ${asset},
             ${payTo}, ${amountUnits}, ${amountUnits}
      FROM day, dup
      WHERE NOT dup.taken
        AND day.spent + ${amountUnits}::numeric <= ${String(DAILY_BUDGET_UNITS)}::numeric
      RETURNING id
    )
    SELECT (SELECT id FROM ins)::text AS row_id, (SELECT taken FROM dup) AS taken
  `);
  const row = rowsOf(raw)[0];
  // No row back at all means the statement did not run as written — refuse to
  // spend on a gate whose verdict we cannot read.
  if (!row) throw new Error("l1 spend reservation returned no verdict row");
  const rowId = typeof row.row_id === "string" && row.row_id !== "" ? row.row_id : null;
  if (rowId) return { ok: true, rowId };
  return { ok: false, reason: row.taken === true ? "already_purchased" : "daily_budget_exceeded" };
}

export async function runL1Batch(
  options: {
    limit?: number;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
  } = {},
): Promise<L1BatchSummary> {
  // SSRF (2026-08-15 audit): resourceUrl is a seller-declared string from the
  // public Bazaar catalog. The production default refuses any target that is —
  // or redirects to — a non-public address, so this runner cannot be pointed
  // at the platform's own internal surfaces (nor made to carry a signed
  // payment authorization there). See src/lib/net/safe-fetch.ts.
  const { limit = 100, fetchImpl = guardedFetch, timeoutMs = 20_000 } = options;
  const summary: L1BatchSummary = {
    attempted: 0,
    settled: 0,
    settleFailed: 0,
    skipped: 0,
    budgetDenied: 0,
    spentUnitsTotal: "0",
    disabledReason: null,
  };

  // 1. Master switches — fail-closed before any network traffic.
  if (!isL1Enabled()) {
    summary.disabledReason = "l1_disabled";
    return summary;
  }
  // MetaMask exports the key WITHOUT the 0x prefix; Coinbase Wallet WITH it.
  // Accept both, normalize to the 0x form viem requires.
  const rawPk = process.env.OBSERVATORY_WALLET_PRIVATE_KEY?.trim() ?? "";
  const pk = rawPk.startsWith("0x") ? rawPk : rawPk ? `0x${rawPk}` : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    summary.disabledReason = "wallet_key_missing";
    return summary;
  }
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");
  const account = privateKeyToAccount(pk as `0x${string}`);

  // 2. Today's spend from the ledger (UTC day).
  let spentToday = 0n;
  try {
    const raw = await db.execute(sql`
      SELECT coalesce(sum(spent_units::numeric), 0)::text AS spent
      FROM x402_l1_purchases
      WHERE attempted_at >= date_trunc('day', now() AT TIME ZONE 'utc')
    `);
    const list = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as {
      spent: string;
    }[];
    // Fail-closed: an unreadable ledger must never read as "nothing spent
    // today" — that is the one wrong answer that opens a fresh daily budget.
    const spentRaw = list[0]?.spent;
    if (typeof spentRaw !== "string") throw new Error("l1 daily spend query returned no total");
    spentToday = BigInt(spentRaw.split(".")[0]);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return summary; // table missing → cold start, nothing to do safely
  }

  // 3. Targets: L0-passing active endpoints with real demand, oldest-unpurchased
  //    first excluded within the sweep window. Highest observed demand first —
  //    the endpoints buyers actually depend on get verified soonest.
  const rawTargets = await db.execute(sql`
    SELECT e.id, e.resource_url, e.method, e.price_amount, e.pay_to, e.declared_schema
    FROM x402_endpoints e
    JOIN LATERAL (
      SELECT verdict FROM x402_l0_probes p
      WHERE p.endpoint_id = e.id
      ORDER BY probed_at DESC LIMIT 1
    ) lp ON lp.verdict = 'pass'
    WHERE e.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM x402_l1_purchases pu
        WHERE pu.endpoint_id = e.id
          AND pu.attempted_at > now() - make_interval(days => ${SWEEP_WINDOW_DAYS})
      )
    ORDER BY e.quality_payers_30d DESC NULLS LAST, e.quality_calls_30d DESC NULLS LAST
    LIMIT ${limit}
  `);
  const targetList = (Array.isArray(rawTargets)
    ? rawTargets
    : (rawTargets as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
  const candidates: Candidate[] = targetList.map((r) => ({
    id: String(r.id),
    resourceUrl: String(r.resource_url),
    method: (r.method as string | null) ?? null,
    priceAmount: (r.price_amount as string | null) ?? null,
    payTo: (r.pay_to as string | null) ?? null,
    declaredSchema: r.declared_schema ?? null,
  }));

  for (const candidate of candidates) {
    try {
      const outcome = await purchaseOne({ candidate, account, fetchImpl, timeoutMs, db, spentToday });
      spentToday += outcome.spent;
      summary.spentUnitsTotal = String(BigInt(summary.spentUnitsTotal) + outcome.spent);
      if (outcome.kind === "attempted") {
        summary.attempted++;
        if (outcome.settled) summary.settled++;
        else summary.settleFailed++;
      } else if (outcome.kind === "budget_denied") {
        summary.budgetDenied++;
        // Budget exhausted for anything at this price — later candidates may
        // be cheaper, so keep walking rather than break (prices vary 100x).
      } else {
        summary.skipped++;
      }
    } catch (error) {
      logServerError("observatory.l1.purchase", error);
      summary.skipped++;
    }
  }

  return summary;
}

async function purchaseOne(input: {
  candidate: Candidate;
  account: ReturnType<typeof privateKeyToAccount>;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs: number;
  db: NonNullable<ReturnType<typeof getDb>>;
  spentToday: bigint;
}): Promise<{ kind: "attempted" | "skipped" | "budget_denied"; settled: boolean; spent: bigint }> {
  const { candidate, account, fetchImpl, timeoutMs, db, spentToday } = input;
  const method = (candidate.method ?? "GET").toUpperCase();
  const startedAt = Date.now();

  const record = async (row: Partial<typeof x402L1Purchases.$inferInsert>) => {
    await db.insert(x402L1Purchases).values({
      endpointId: candidate.id,
      status: "request_error",
      payer: account.address.toLowerCase(),
      ...row,
    });
  };

  // Unpaid request → expect the wall.
  let first: Response;
  let firstBody = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    first = await fetchImpl(candidate.resourceUrl, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "application/json", "user-agent": "vet402-observatory-l1/1.0 (+https://vet402.com/observatory/methodology)", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    clearTimeout(timer);
    firstBody = (await first.text()).slice(0, 16_000);
  } catch (error) {
    await record({
      status: "request_error",
      rawResponseMeta: {
        phase: "unpaid",
        // A target the SSRF guard refused records OUR decision, not a
        // measurement of the seller — kept as its own reason code so the two
        // never get read as the same thing.
        reason: error instanceof UnsafeTargetError ? error.reason : null,
        error: String(error).slice(0, 300),
      },
    });
    return { kind: "skipped", settled: false, spent: 0n };
  }

  if (first.status !== 402) {
    await record({ status: "no_402", httpStatusPaid: null, rawResponseMeta: { phase: "unpaid", status: first.status } });
    return { kind: "skipped", settled: false, spent: 0n };
  }

  const challenge = parseChallenge({ bodyText: firstBody, headers: first.headers });
  if (!challenge) {
    await record({ status: "no_eligible_accept", rawResponseMeta: { phase: "unpaid", note: "unparseable challenge" } });
    return { kind: "skipped", settled: false, spent: 0n };
  }

  const selection = selectAccept(challenge.accepts, { declaredAmount: candidate.priceAmount });
  if (!selection.accept) {
    await record({
      status: selection.reason,
      rawResponseMeta: {
        phase: "select",
        declaredAmount: candidate.priceAmount,
        challengeAccepts: challenge.accepts.slice(0, 4),
      },
    });
    return { kind: "skipped", settled: false, spent: 0n };
  }
  const accept = selection.accept;
  const amount = BigInt(accept.amount);

  // Budget gate — BEFORE signing. The ledger, not memory, is the truth.
  const budget = checkL1Budget({
    spentTodayUsd: unitsToUsd(spentToday),
    requestUsd: unitsToUsd(amount),
  });
  if (!budget.allowed) {
    await record({
      status: "budget_denied",
      amountUnits: accept.amount,
      rawResponseMeta: { reason: budget.reason, dailyBudgetUsd: DAILY_BUDGET_USD },
    });
    return { kind: "budget_denied", settled: false, spent: 0n };
  }

  // Reserve BEFORE signing. This is the authoritative gate: it re-reads the
  // day's total and the sweep window inside one statement and writes the row
  // that carries spent_units, so the money is on the ledger before it can
  // exist. A kill, a timeout or a DB error after this point loses the outcome
  // detail, never the spend.
  const reservation = await reserveSpend({
    db,
    endpointId: candidate.id,
    payer: account.address.toLowerCase(),
    network: accept.network,
    asset: accept.asset,
    payTo: accept.payTo.toLowerCase(),
    amountUnits: String(amount),
  });
  if (!reservation.ok) {
    if (reservation.reason === "already_purchased") {
      // A concurrent run got this endpoint first — its row is the record.
      return { kind: "skipped", settled: false, spent: 0n };
    }
    await record({
      status: "budget_denied",
      amountUnits: accept.amount,
      rawResponseMeta: { reason: "daily_budget_exceeded", dailyBudgetUsd: DAILY_BUDGET_USD },
    });
    return { kind: "budget_denied", settled: false, spent: 0n };
  }

  // Sign — from here on the money is live, so the ledger row ALWAYS carries
  // spent_units, whatever the seller does next.
  const authorization = buildAuthorization({
    from: account.address,
    to: accept.payTo,
    value: accept.amount,
    nowSec: Math.floor(Date.now() / 1000),
    maxTimeoutSeconds: accept.maxTimeoutSeconds,
  });
  const { signature } = await signX402Payment({ account, accept, authorization });
  const header = encodePaymentHeader({
    x402Version: challenge.x402Version,
    accept,
    payload: { signature, authorization },
    resourceUrl: candidate.resourceUrl,
  });

  let paid: Response | null = null;
  let paidBody = "";
  let paidError: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    paid = await fetchImpl(candidate.resourceUrl, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "application/json",
        "user-agent": "vet402-observatory-l1/1.0 (+https://vet402.com/observatory/methodology)",
        [header.headerName]: header.headerValue,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    clearTimeout(timer);
    paidBody = (await paid.text()).slice(0, 16_000);
  } catch (error) {
    paidError = String(error).slice(0, 300);
  }

  const latencyMs = Date.now() - startedAt;
  const settlement = paid ? parseSettlementResponse(paid.headers) : null;
  const payloadNonEmpty = paidBody.trim().length > 0;
  const contentType = paid?.headers.get("content-type") ?? null;
  const contentTypeMatch = contentType === null ? null : contentType.includes("json");

  // L2 — minimal structural check against the catalog-declared schema.
  let l2Schema: string = "not_checked";
  if (paid && paid.status === 200) {
    l2Schema = checkL2(candidate.declaredSchema, paidBody, contentType);
  }

  const settled = settlement?.success === true && !!settlement.transaction;
  const status = !paid
    ? "settle_failed"
    : settled
      ? "settled"
      : paid.status === 200
        ? "delivered_no_receipt" // goods returned but no settlement receipt header
        : "settle_failed";

  // Resolve the reservation in place — spent_units stays exactly what was
  // reserved (signed = counted, success or not); only the outcome is filled in.
  await db
    .update(x402L1Purchases)
    .set({
      status,
      txHash: settlement?.transaction ?? null,
      httpStatusPaid: paid?.status ?? null,
      latencyMs,
      payloadNonEmpty: paid ? payloadNonEmpty : null,
      contentTypeMatch,
      l2Schema,
      rawSettlement: settlement ?? (paidError ? { error: paidError } : null),
      rawResponseMeta: {
        phase: "paid",
        status: paid?.status ?? null,
        contentType,
        bodyHead: paidBody.slice(0, 500),
      },
    })
    .where(eq(x402L1Purchases.id, reservation.rowId));

  return { kind: "attempted", settled, spent: amount };
}

/**
 * L2 contract conformance, minimal and honest: with no declaration the
 * verdict is `no_declaration` (never a failure); with a declaration we check
 * what is machine-checkable without a full JSON-Schema engine — the body
 * parses as JSON and carries the declared top-level required/properties keys.
 */
function checkL2(declaredSchema: unknown, bodyText: string, contentType: string | null): string {
  const schema = typeof declaredSchema === "object" && declaredSchema !== null
    ? (declaredSchema as Record<string, unknown>)
    : null;
  if (!schema) return "no_declaration";

  // The catalog schema wraps input/output; the OUTPUT declaration is what the
  // response must honor.
  const props = (schema.properties ?? null) as Record<string, unknown> | null;
  const output = (props?.output ?? null) as Record<string, unknown> | null;
  const outputProps = (output?.properties ?? null) as Record<string, unknown> | null;
  const example = (outputProps?.example ?? null) as Record<string, unknown> | null;
  const exampleProps = (example?.properties ?? null) as Record<string, unknown> | null;
  const requiredKeys = Array.isArray(example?.required) ? (example!.required as string[]) : [];

  if (!contentType?.includes("json")) return requiredKeys.length > 0 ? "mismatch" : "no_declaration";

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return "mismatch";
  }
  if (requiredKeys.length === 0 && !exampleProps) return "no_declaration";
  const rec = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  if (!rec) return "mismatch";
  for (const key of requiredKeys) {
    if (!(key in rec)) return "mismatch";
  }
  return "match";
}
