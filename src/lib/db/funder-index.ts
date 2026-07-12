import { count, eq } from "drizzle-orm";
import { getDb } from "./client";
import { funderWallets } from "./schema";

const FUNDER_CLUSTER_THRESHOLD = 5;

/**
 * Read-only cluster lookup. Rows are populated by a trusted indexer — never by API scoring.
 */
export async function getFunderClusterSize(funder: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const rows = await db
    .select({ value: count() })
    .from(funderWallets)
    .where(eq(funderWallets.funder, funder.toLowerCase()));

  return rows[0]?.value ?? 0;
}

export function isFundingCluster(size: number): boolean {
  return size >= FUNDER_CLUSTER_THRESHOLD;
}
