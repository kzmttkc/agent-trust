/**
 * Postgres "undefined_column" / "undefined_table" SQLSTATE codes — thrown
 * when a migration (new column or new table) hasn't been applied to this
 * database yet. Used to fail safe instead of crashing: see
 * scripts/backfill-payee.ts and getPayeeStats/recordX402Payment in
 * src/lib/db/x402-payments.ts.
 *
 * drizzle-orm wraps the underlying driver error rather than re-throwing it
 * directly, and the wrapping shape differs by driver:
 *  - postgres-js (local/dev, "postgres" package): DrizzleQueryError with the
 *    real PostgresError on `.cause`, which carries `.code`.
 *  - neon-http (production, "@neondatabase/serverless"): may attach `.code`
 *    directly or on `.cause` depending on version.
 * So this walks a short `.cause` chain rather than assuming one shape.
 */
const UNDEFINED_COLUMN = "42703";
const UNDEFINED_TABLE = "42P01";
const MAX_CAUSE_DEPTH = 5;

function readCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isMissingSchemaError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    const code = readCode(current);
    if (code === UNDEFINED_COLUMN || code === UNDEFINED_TABLE) return true;
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}
