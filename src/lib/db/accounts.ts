import { eq, sql } from "drizzle-orm";
import { isProduction } from "@/lib/config/env";
import { generateApiKey, hashApiKey, normalizePlan } from "./api-keys";
import { getDb } from "./client";
import { isUniqueViolationError } from "./pg-errors";
import { accounts, apiKeys } from "./schema";

export type AccountRecord = {
  id: string;
  email: string;
  plan: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export async function getAccountById(id: string): Promise<AccountRecord | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    plan: normalizePlan(row.plan),
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
}

export async function getAccountByEmail(email: string): Promise<AccountRecord | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, email.toLowerCase().trim()))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    plan: normalizePlan(row.plan),
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
}

export async function getAccountByStripeCustomerId(
  customerId: string,
): Promise<AccountRecord | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.stripeCustomerId, customerId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    plan: normalizePlan(row.plan),
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
}

/**
 * Create the account and its first API key in a single SQL statement.
 * neon-http has no interactive transactions; a CTE still commits atomically,
 * so a key-insert failure cannot leave an email-locked account with no key.
 */
export async function createAccountWithApiKey(params: {
  email: string;
  keyName: string;
}): Promise<{
  account: AccountRecord;
  apiKey: { id: string; key: string; plan: string };
}> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");
  if (isProduction() && !process.env.API_KEY_PEPPER) {
    throw new Error("API_KEY_PEPPER is required in production");
  }

  const normalized = params.email.toLowerCase().trim();
  const key = generateApiKey();
  const keyHash = hashApiKey(key);

  let raw: unknown;
  try {
    raw = await db.execute(sql`
      WITH acc AS (
        INSERT INTO accounts (email, plan)
        VALUES (${normalized}, 'free')
        RETURNING id, email, plan, stripe_customer_id, stripe_subscription_id
      ),
      k AS (
        INSERT INTO api_keys (user_id, name, key_hash, plan)
        SELECT id, ${params.keyName}, ${keyHash}, 'free' FROM acc
        RETURNING id, plan
      )
      SELECT
        acc.id AS account_id,
        acc.email,
        acc.plan AS account_plan,
        acc.stripe_customer_id,
        acc.stripe_subscription_id,
        k.id AS key_id,
        k.plan AS key_plan
      FROM acc, k
    `);
  } catch (error) {
    if (isUniqueViolationError(error)) {
      throw new Error("email_already_registered");
    }
    throw error;
  }

  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Record<
    string,
    unknown
  >[];
  const row = rows[0];
  if (!row?.account_id || !row.key_id) {
    throw new Error("signup_failed");
  }

  return {
    account: {
      id: String(row.account_id),
      email: String(row.email),
      plan: normalizePlan(String(row.account_plan ?? "free")),
      stripeCustomerId:
        row.stripe_customer_id === null || row.stripe_customer_id === undefined
          ? null
          : String(row.stripe_customer_id),
      stripeSubscriptionId:
        row.stripe_subscription_id === null || row.stripe_subscription_id === undefined
          ? null
          : String(row.stripe_subscription_id),
    },
    apiKey: {
      id: String(row.key_id),
      key,
      plan: normalizePlan(String(row.key_plan ?? "free")),
    },
  };
}

export async function setAccountStripeIds(
  accountId: string,
  params: { stripeCustomerId?: string; stripeSubscriptionId?: string | null },
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db
    .update(accounts)
    .set({
      ...(params.stripeCustomerId ? { stripeCustomerId: params.stripeCustomerId } : {}),
      ...(params.stripeSubscriptionId !== undefined
        ? { stripeSubscriptionId: params.stripeSubscriptionId }
        : {}),
    })
    .where(eq(accounts.id, accountId));
}

export async function updateAccountPlan(accountId: string, plan: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const normalized = normalizePlan(plan);

  await db.update(accounts).set({ plan: normalized }).where(eq(accounts.id, accountId));

  await db
    .update(apiKeys)
    .set({ plan: normalized })
    .where(eq(apiKeys.userId, accountId));
}
