// ============================================================
// vet402 — buyer-side payee cache guard (H-3, 2026-08-13 R4).
//
// WHY THIS EXISTS. The buyer-side payee score (GET /v1/payees/{addr}/score,
// what SpendGuard and the trust-gate read) is cached in-process for 5 minutes.
// A wallet that begins draining right after a clean lookup keeps serving that
// pre-drain ALLOW to every buyer for up to the whole TTL. The monitoring
// heartbeat (watchlist scan) already re-scores watched wallets and detects the
// verdict change — this bridges THAT signal to the buyer-side cache so the
// window closes: a worsened verdict drops the wallet, and the next buyer
// lookup recomputes (and re-runs drain detection) instead of replaying the
// stale ALLOW.
//
// This lives OUTSIDE the scoring engine on purpose: the scoring code is owned
// by another workstream. We only READ its exported `invalidatePayeeScoreCache`
// entry point (a `cache.delete`) and decide, in this layer, when to call it.
//
// KNOWN TRADE-OFF (the "reputation-cache tradeoff" the finding asks us to
// note): `invalidatePayeeScoreCache` clears only the in-process LRU of the
// instance that runs it, and the payee engine's cache is NOT epoch-aware, so
// on a multi-instance serverless deploy other instances keep their own copy
// until their own TTL lapses. Making the drop cross-instance would require the
// payee engine to consult the DB cache epoch on read — a scoring-side change
// tracked separately. This closes the same-instance window and, more
// importantly, gives the drain/verdict-change signal a real invalidation path
// where today it has none.
// ============================================================

import { invalidatePayeeScoreCache } from "@/lib/scoring/payee-engine";

// Ordering of the three-way band by caution. A drain flips a clean ALLOW
// toward WARN/BLOCK; that strict increase is exactly when a still-cached
// buyer-side ALLOW is dangerous.
const CAUTION_RANK: Record<string, number> = { ALLOW: 0, WARN: 1, BLOCK: 2 };

/**
 * Did the verdict move to a strictly more cautious band? A first-ever verdict
 * (no `previous`) is not a change and never triggers invalidation. Unknown
 * strings rank as least-cautious (0), so a move INTO a recognised worse band
 * still fires while noise between two unknowns does not.
 */
export function isVerdictWorse(previous: string | null, current: string): boolean {
  if (previous === null) return false;
  const p = CAUTION_RANK[previous] ?? 0;
  const c = CAUTION_RANK[current] ?? 0;
  return c > p;
}

/**
 * Pure decision: which wallet (if any) should be dropped from the buyer-side
 * payee cache given a watchlist verdict change. Returns the lowercased wallet
 * to invalidate, or null when nothing should be invalidated.
 *
 * Only WALLET targets map to the payee cache — it is keyed by receiving
 * wallet, so an agentId is never a key here.
 */
export function payeeCacheTargetForVerdictChange(params: {
  targetType: "agent" | "wallet";
  target: string;
  previous: string | null;
  current: string;
}): string | null {
  if (params.targetType !== "wallet") return null;
  if (!isVerdictWorse(params.previous, params.current)) return null;
  return params.target.toLowerCase();
}

/**
 * Side-effecting bridge for the watchlist scan: on a worsened wallet verdict,
 * drop the wallet from the buyer-side payee cache. Best-effort and never
 * throws — a monitoring pass must not fail because a cache drop did. Returns
 * true when an invalidation was performed.
 */
export function invalidatePayeeCacheForVerdictChange(params: {
  targetType: "agent" | "wallet";
  target: string;
  previous: string | null;
  current: string;
}): boolean {
  const wallet = payeeCacheTargetForVerdictChange(params);
  if (wallet === null) return false;
  try {
    invalidatePayeeScoreCache(wallet);
    return true;
  } catch {
    return false;
  }
}
