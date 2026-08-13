import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ensureOwnerUserId } from "./api-keys";
import { getDb } from "./client";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { recordOperatorOverride } from "./operator-overrides";
import { apiKeys, customerLists } from "./schema";

export type ListType = "whitelist" | "blacklist";

export type CustomerListEntry = {
  id: string;
  apiKeyId: string | null;
  wallet: string;
  listType: ListType;
  createdAt: Date | null;
};

export type ManualListPolicy = {
  /** Applied for scoring decisions */
  effective: "none" | "whitelist" | "blacklist";
  /** Exposed in API signals — global operator lists are never revealed */
  visible: "none" | "whitelist" | "blacklist";
  isGlobal: boolean;
};

const MAX_CSV_ENTRIES = 500;
const NONE_POLICY: ManualListPolicy = {
  effective: "none",
  visible: "none",
  isGlobal: false,
};

async function ownerKeyIds(apiKeyId: string): Promise<string[]> {
  const userId = await ensureOwnerUserId(apiKeyId);
  const db = getDb();
  if (!db) return [apiKeyId];

  const rows = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));

  return rows.map((row) => row.id);
}

export async function lookupManualListPolicy(
  apiKeyId: string | undefined,
  wallet: string | null,
): Promise<ManualListPolicy> {
  if (!wallet) return NONE_POLICY;

  const db = getDb();
  if (!db) return NONE_POLICY;

  const normalized = wallet.toLowerCase();

  let scope: ReturnType<typeof or> | ReturnType<typeof isNull>;
  if (apiKeyId && apiKeyId !== "dev") {
    const keyIds = await ownerKeyIds(apiKeyId);
    scope = or(isNull(customerLists.apiKeyId), inArray(customerLists.apiKeyId, keyIds));
  } else {
    scope = isNull(customerLists.apiKeyId);
  }

  const rows = await db
    .select({
      listType: customerLists.listType,
      apiKeyId: customerLists.apiKeyId,
    })
    .from(customerLists)
    .where(and(sql`lower(${customerLists.wallet}) = ${normalized}`, scope));

  const globalBlacklist = rows.some(
    (row) => row.listType === "blacklist" && row.apiKeyId === null,
  );
  if (globalBlacklist) {
    return { effective: "blacklist", visible: "none", isGlobal: true };
  }

  const customerBlacklist = rows.some(
    (row) => row.listType === "blacklist" && row.apiKeyId !== null,
  );
  if (customerBlacklist) {
    return { effective: "blacklist", visible: "blacklist", isGlobal: false };
  }

  const customerWhitelist = rows.some(
    (row) => row.listType === "whitelist" && row.apiKeyId !== null,
  );
  if (customerWhitelist) {
    return { effective: "whitelist", visible: "whitelist", isGlobal: false };
  }

  return NONE_POLICY;
}

/** @deprecated Use lookupManualListPolicy */
export async function lookupManualList(
  apiKeyId: string | undefined,
  wallet: string | null,
): Promise<"none" | "whitelist" | "blacklist"> {
  const policy = await lookupManualListPolicy(apiKeyId, wallet);
  return policy.effective;
}

export async function listCustomerEntries(apiKeyId: string): Promise<CustomerListEntry[]> {
  const db = getDb();
  if (!db) return [];

  const keyIds = await ownerKeyIds(apiKeyId);

  const rows = await db
    .select()
    .from(customerLists)
    .where(inArray(customerLists.apiKeyId, keyIds))
    .orderBy(desc(customerLists.createdAt));

  return rows.map((row) => ({
    id: row.id,
    apiKeyId: row.apiKeyId,
    wallet: row.wallet,
    listType: row.listType as ListType,
    createdAt: row.createdAt,
  }));
}

export async function addCustomerListEntry(params: {
  apiKeyId: string | null;
  wallet: string;
  listType: ListType;
  global?: boolean;
  /**
   * vet402 2026-08-14 — required for a GLOBAL (operator-wide) act: it is written
   * to the PUBLIC operator-override log (src/lib/db/operator-overrides.ts) so a
   * global blacklist can never be a silent, reasonless censorship point. Ignored
   * for customer-scoped list changes, which stay private to the customer.
   */
  reason?: string;
}): Promise<CustomerListEntry> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");

  const wallet = params.wallet.toLowerCase();
  const apiKeyId = params.global ? null : params.apiKeyId;

  if (apiKeyId) {
    const keyIds = await ownerKeyIds(apiKeyId);
    await db
      .delete(customerLists)
      .where(
        and(
          sql`lower(${customerLists.wallet}) = ${wallet}`,
          inArray(customerLists.apiKeyId, keyIds),
        ),
      );
  } else {
    await db
      .delete(customerLists)
      .where(
        and(sql`lower(${customerLists.wallet}) = ${wallet}`, isNull(customerLists.apiKeyId)),
      );
  }

  const [row] = await db
    .insert(customerLists)
    .values({
      apiKeyId,
      wallet,
      listType: params.listType,
    })
    .returning();

  // C-9: the customer's own audit trail. Fire-and-forget; a webhook must
  // never slow down or fail the list write itself.
  if (apiKeyId) {
    void dispatchWebhookEvent(apiKeyId, "list.changed", {
      action: "added",
      wallet,
      listType: params.listType,
    }).catch(() => {});
  } else if (params.listType === "blacklist") {
    // vet402 2026-08-14 — a GLOBAL operator blacklist is an act of censorship on
    // the whole network, so it is recorded in the PUBLIC operator-override log
    // with its reason. AWAITED, not fire-and-forget: the public record and the
    // enforcement must land together, or the "silent censorship" this closes
    // would reappear as an enforced block with no public trace.
    await recordOperatorOverride({
      wallet,
      action: "blacklist_added",
      reason: params.reason?.trim() || "unspecified",
    });
  }

  return {
    id: row.id,
    apiKeyId: row.apiKeyId,
    wallet: row.wallet,
    listType: row.listType as ListType,
    createdAt: row.createdAt,
  };
}

/**
 * vet402 2026-08-14 (中-3A, double-check) — REMOVE a GLOBAL operator blacklist
 * and record the removal in the PUBLIC operator-override log. The ToS promise is
 * that an operator censorship act can be "withdrawn, and the withdrawal
 * recorded" — but no code path recorded `blacklist_removed`, so the withdrawal
 * half of the promise had no implementation. This is it: the operator-wide
 * blacklist rows for the wallet are deleted, and — ONLY when something was
 * actually removed — a reasoned `blacklist_removed` entry is appended to the same
 * public log the addition wrote to. A removal request for a wallet that was not
 * globally blacklisted logs NOTHING (a phantom "removed" would be a lie in a
 * transparency log). Symmetric with addCustomerListEntry's global path: the
 * public record and the enforcement change land together (awaited), so the
 * withdrawal can never be a silent one.
 */
export async function removeGlobalBlacklistEntry(params: {
  wallet: string;
  reason: string;
}): Promise<{ removed: boolean }> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");

  const wallet = params.wallet.toLowerCase();
  const removedRows = await db
    .delete(customerLists)
    .where(
      and(
        sql`lower(${customerLists.wallet}) = ${wallet}`,
        isNull(customerLists.apiKeyId),
        eq(customerLists.listType, "blacklist"),
      ),
    )
    .returning();

  const removed = removedRows.length > 0;
  if (removed) {
    // AWAITED, like the addition: the withdrawal and its public trace land
    // together, or the "silent censorship" this closes would reappear as a
    // silent un-censorship.
    await recordOperatorOverride({
      wallet,
      action: "blacklist_removed",
      reason: params.reason.trim() || "unspecified",
    });
  }

  return { removed };
}

export async function removeCustomerListEntry(
  apiKeyId: string,
  entryId: string,
): Promise<{ removed: boolean; wallet: string | null }> {
  const db = getDb();
  if (!db) return { removed: false, wallet: null };

  const keyIds = await ownerKeyIds(apiKeyId);

  const existing = await db
    .select({ id: customerLists.id, wallet: customerLists.wallet })
    .from(customerLists)
    .where(and(eq(customerLists.id, entryId), inArray(customerLists.apiKeyId, keyIds)))
    .limit(1);

  if (!existing[0]) return { removed: false, wallet: null };

  await db.delete(customerLists).where(eq(customerLists.id, entryId));
  return { removed: true, wallet: existing[0].wallet };
}

export async function importCustomerListEntries(params: {
  apiKeyId: string;
  entries: Array<{ wallet: string; listType: ListType }>;
}): Promise<{ imported: number; skipped: number }> {
  if (params.entries.length > MAX_CSV_ENTRIES) {
    throw new Error("csv_too_large");
  }

  let imported = 0;
  let skipped = 0;

  for (const entry of params.entries) {
    try {
      await addCustomerListEntry({
        apiKeyId: params.apiKeyId,
        wallet: entry.wallet,
        listType: entry.listType,
      });
      imported++;
    } catch {
      skipped++;
    }
  }

  return { imported, skipped };
}

export { MAX_CSV_ENTRIES };
