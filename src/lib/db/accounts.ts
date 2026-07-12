import { eq } from "drizzle-orm";
import { normalizePlan } from "./api-keys";
import { getDb } from "./client";
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

export async function createAccount(email: string): Promise<AccountRecord> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");

  const normalized = email.toLowerCase().trim();

  const [row] = await db
    .insert(accounts)
    .values({ email: normalized, plan: "free" })
    .returning();

  return {
    id: row.id,
    email: row.email,
    plan: normalizePlan(row.plan),
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
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
