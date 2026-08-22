/**
 * One definition of "is this a uuid".
 *
 * WHY (2026-08-22 audit). The same regex was copy-pasted into seven modules,
 * and the copies had already diverged in the way that matters: some public
 * routes checked before using the value, others handed it straight to a
 * `::uuid` cast, where Postgres raises 22P02 and the route answers 5xx for
 * what is really a 400. `/api/v1/demo/verify` did that AFTER spending the
 * caller's one-live-purchase-per-day token, so malformed input cost a real
 * quota and produced a server error.
 *
 * Deliberately the SAME pattern the copies used (any version/variant nibble,
 * case-insensitive), not a stricter RFC-4122 v4 check: this validates the
 * shape Postgres will accept, and tightening it here would silently reject
 * ids already stored in the catalog.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
