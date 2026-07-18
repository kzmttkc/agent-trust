/**
 * Gate2 PMF judgement — automates the three psql checks from
 * output/0715/vouch_pmf_launch_pack.md (section 1-3) so the weekly review
 * doesn't depend on someone manually pasting SQL into a psql session.
 *
 * Gate2 (operational definition, from the launch pack):
 *   PASS  = judgement A has >= 5 external accounts
 *           AND judgement C has >= 1 external key that is either
 *             (i)  active >= 5 distinct days AND >= 50 queries in the last 14 days, or
 *             (ii) has at least one x402_payments row (settlement write-back)
 *
 * Self-accounts (own test signups) are excluded from every count via
 * SELF_ACCOUNT_EMAILS (comma-separated). Defaults to the one address the
 * launch pack names (kazumototakeshi@gmail.com) — override or extend with
 * the env var if more test accounts get created.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/gate2-report.ts
 *   DATABASE_URL=... SELF_ACCOUNT_EMAILS="a@x.com,b@x.com" tsx scripts/gate2-report.ts
 *
 * Writes a timestamped entry to state/gate2-ledger.json (gitignored — the
 * ledger holds external signup emails, which is PII) and prints a summary.
 * Fails safe (exits 1, writes nothing) if DATABASE_URL isn't configured or
 * the expected tables don't exist yet — mirrors scripts/backfill-payee.ts.
 */
import { and, eq, gt, inArray, isNull, notInArray, or } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../src/lib/db/client";
import { isMissingSchemaError } from "../src/lib/db/pg-errors";
import { accounts, apiKeys, apiUsage, trustEvents, x402Payments } from "../src/lib/db/schema";

const DEFAULT_SELF_EMAILS = ["kazumototakeshi@gmail.com"];
const ACTIVE_DAYS_THRESHOLD = 5;
const QUERY_COUNT_THRESHOLD = 50;
const WINDOW_DAYS = 14;

function getSelfEmails(): string[] {
  const raw = process.env.SELF_ACCOUNT_EMAILS;
  if (!raw) return DEFAULT_SELF_EMAILS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const selfEmails = getSelfEmails();

  const db = getDb();
  if (!db) {
    console.error(
      "gate2-report: DATABASE_URL not configured — aborting safely, no report written.",
    );
    process.exit(1);
  }

  let selfAccountIds: string[];
  let externalAccounts: { id: string; email: string; createdAt: Date | null }[];
  try {
    const selfRows = selfEmails.length
      ? await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(inArray(accounts.email, selfEmails))
      : [];
    selfAccountIds = selfRows.map((r) => r.id);

    externalAccounts = await db
      .select({ id: accounts.id, email: accounts.email, createdAt: accounts.createdAt })
      .from(accounts)
      .where(selfEmails.length ? notInArray(accounts.email, selfEmails) : undefined)
      .orderBy(accounts.createdAt);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.error(
        "gate2-report: accounts table doesn't exist in this database yet — aborting safely, no report written.",
      );
      process.exit(1);
    }
    throw error;
  }

  // Judgement A: external signups + whether each has ever used an API key.
  const externalIds = externalAccounts.map((a) => a.id);
  const keyRows = externalIds.length
    ? await db
        .select({ userId: apiKeys.userId, lastUsedAt: apiKeys.lastUsedAt })
        .from(apiKeys)
        .where(inArray(apiKeys.userId, externalIds))
    : [];
  const lastUseByUser = new Map<string, number>();
  for (const k of keyRows) {
    if (!k.userId || !k.lastUsedAt) continue;
    const t = new Date(k.lastUsedAt).getTime();
    const prev = lastUseByUser.get(k.userId) ?? 0;
    if (t > prev) lastUseByUser.set(k.userId, t);
  }
  const judgementA = externalAccounts.map((a) => ({
    email: a.email,
    createdAt: a.createdAt,
    lastApiUse: lastUseByUser.has(a.id) ? new Date(lastUseByUser.get(a.id)!) : null,
  }));

  // Judgement B: external-key monthly usage (screening signal only).
  const notSelfKeyFilter = selfAccountIds.length
    ? or(isNull(apiKeys.userId), notInArray(apiKeys.userId, selfAccountIds))
    : undefined;
  const usageRows = await db
    .select({
      period: apiUsage.period,
      apiKeyId: apiUsage.apiKeyId,
      count: apiUsage.count,
      userId: apiKeys.userId,
    })
    .from(apiUsage)
    .innerJoin(apiKeys, eq(apiKeys.id, apiUsage.apiKeyId))
    .where(notSelfKeyFilter);
  const accountEmailById = new Map(externalAccounts.map((a) => [a.id, a.email]));
  const judgementB = usageRows
    .map((u) => ({
      period: u.period,
      apiKeyId: u.apiKeyId,
      email: u.userId ? (accountEmailById.get(u.userId) ?? "(self or unknown)") : "(no account)",
      count: u.count,
    }))
    .sort((x, y) => (x.period < y.period ? 1 : -1) || y.count - x.count);

  // Judgement C-i: continuous usage in the last WINDOW_DAYS.
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentEvents = await db
    .select({
      apiKeyId: trustEvents.apiKeyId,
      userId: apiKeys.userId,
      createdAt: trustEvents.createdAt,
    })
    .from(trustEvents)
    .innerJoin(apiKeys, eq(apiKeys.id, trustEvents.apiKeyId))
    .where(
      notSelfKeyFilter
        ? and(gt(trustEvents.createdAt, windowStart), notSelfKeyFilter)
        : gt(trustEvents.createdAt, windowStart),
    );
  const byKey = new Map<
    string,
    { userId: string | null; days: Set<string>; queries: number; first: Date; last: Date }
  >();
  for (const e of recentEvents) {
    if (!e.apiKeyId || !e.createdAt) continue;
    const created = new Date(e.createdAt);
    const entry = byKey.get(e.apiKeyId) ?? {
      userId: e.userId,
      days: new Set<string>(),
      queries: 0,
      first: created,
      last: created,
    };
    entry.days.add(dayKey(created));
    entry.queries += 1;
    if (created < entry.first) entry.first = created;
    if (created > entry.last) entry.last = created;
    byKey.set(e.apiKeyId, entry);
  }
  const judgementCi = [...byKey.entries()]
    .map(([apiKeyId, v]) => ({
      apiKeyId,
      email: v.userId ? (accountEmailById.get(v.userId) ?? "(self or unknown)") : "(no account)",
      queries: v.queries,
      activeDays: v.days.size,
      firstSeen: v.first,
      lastSeen: v.last,
    }))
    .filter((r) => r.activeDays >= ACTIVE_DAYS_THRESHOLD && r.queries >= QUERY_COUNT_THRESHOLD);

  // Judgement C-ii: x402 settlement write-back from an external key.
  let judgementCii: {
    apiKeyId: string | null;
    email: string;
    attested: number;
    first: Date;
    last: Date;
  }[] = [];
  try {
    const paymentRows = await db
      .select({
        apiKeyId: x402Payments.apiKeyId,
        userId: apiKeys.userId,
        createdAt: x402Payments.createdAt,
      })
      .from(x402Payments)
      .innerJoin(apiKeys, eq(apiKeys.id, x402Payments.apiKeyId))
      .where(notSelfKeyFilter);
    const byPaymentKey = new Map<
      string,
      { userId: string | null; count: number; first: Date; last: Date }
    >();
    for (const p of paymentRows) {
      if (!p.apiKeyId || !p.createdAt) continue;
      const created = new Date(p.createdAt);
      const entry = byPaymentKey.get(p.apiKeyId) ?? {
        userId: p.userId,
        count: 0,
        first: created,
        last: created,
      };
      entry.count += 1;
      if (created < entry.first) entry.first = created;
      if (created > entry.last) entry.last = created;
      byPaymentKey.set(p.apiKeyId, entry);
    }
    judgementCii = [...byPaymentKey.entries()].map(([apiKeyId, v]) => ({
      apiKeyId,
      email: v.userId ? (accountEmailById.get(v.userId) ?? "(self or unknown)") : "(no account)",
      attested: v.count,
      first: v.first,
      last: v.last,
    }));
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn(
        "gate2-report: x402_payments table not present yet — judgement C-ii treated as 0 rows.",
      );
    } else {
      throw error;
    }
  }

  const gate2Pass =
    judgementA.length >= 5 && (judgementCi.length > 0 || judgementCii.length > 0);

  const report = {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    selfEmailsExcluded: selfEmails,
    judgementA: {
      externalSignups: judgementA.length,
      pass: judgementA.length >= 5,
      accounts: judgementA,
    },
    judgementB: { rows: judgementB },
    judgementC: {
      continuousUsage: judgementCi,
      settlementWriteback: judgementCii,
      pass: judgementCi.length > 0 || judgementCii.length > 0,
    },
    gate2Pass,
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(
    `\nGate2: ${gate2Pass ? "PASS" : "not yet"} — external signups=${judgementA.length}/5, external integration=${judgementCi.length + judgementCii.length}/1`,
  );

  const ledgerDir = path.join(__dirname, "..", "state");
  fs.mkdirSync(ledgerDir, { recursive: true });
  const ledgerPath = path.join(ledgerDir, "gate2-ledger.json");
  const existing: unknown[] = fs.existsSync(ledgerPath)
    ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
    : [];
  existing.push(report);
  fs.writeFileSync(ledgerPath, JSON.stringify(existing, null, 2) + "\n");
  console.log(`\nappended to ${ledgerPath} (${existing.length} run(s) recorded)`);
}

main().catch((error) => {
  console.error("gate2-report: fatal error", error instanceof Error ? error.message : error);
  process.exit(1);
});
