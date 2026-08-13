import type { WalletOutcomeRow } from "@/lib/db/outcome-writer";

/**
 * vet402 2026-08-13 (negative-poison ruling). How a wallet's recorded outcome
 * history moves its PUBLIC payee score — the number the SDK's SpendGuard reads
 * before releasing funds, and the badge/observatory show to the world.
 *
 * THE HOLE THIS CLOSES. A negative label used to cap the score at 15 (→ BLOCK)
 * the instant ANY negative row existed — no matter who wrote it or whether they
 * had ever transacted with the wallet. Scoring is open to any wallet, so an
 * attacker scored a victim V (minting a trust_event they own, wallet=V), then
 * POSTed confirmed_fraud on their OWN verdict. One free key, two requests, and
 * a competitor's payments stop. The 2026-08-12 owner-scope fix only stopped
 * pinning fraud on someone else's EXISTING verdict; a self-authored one sailed
 * straight through.
 *
 * THE RULE. A public score must never drop on the unverified word of a single
 * reporter who cannot be shown to have any real relationship to the subject.
 * But a genuine counterparty's fraud report keeps its full weight. So negative
 * labels are split into TRUSTED and UNCORROBORATED:
 *
 *   TRUSTED  (caps the score) — any of:
 *     • source = 'auto'                    the system observed the chain itself
 *                                          (rug_pull_outflow); not a partner's claim.
 *     • verified counterparty              the reporting key controls a wallet that
 *                                          actually settled an x402 payment TO the
 *                                          subject (binding to a real payment
 *                                          relationship — see getNegativeReporter-
 *                                          Corroboration). One such report is enough,
 *                                          because it is not self-attested.
 *     • independent corroboration          ≥ REQUIRED_INDEPENDENT_REPORTERS distinct
 *                                          reporter ACCOUNTS agree, collapsed by
 *                                          userId so one actor's many keys count once.
 *
 *   UNCORROBORATED (retained, disclosed, but does NOT move the public score) —
 *     everything else: a lone partner report from a key with no proven tie to
 *     the wallet. The row is kept, not discarded: the moment a real counterparty
 *     reports, or enough independent accounts pile on, the SAME rows become
 *     trusted and take effect. Nothing is thrown away; it just cannot BLOCK a
 *     stranger on one anonymous say-so.
 *
 * This module is deliberately pure — no DB, no chain — so the decision is
 * unit-testable in isolation (tests/vet402-negative-poison.test.ts). The facts
 * it needs (who is a verified counterparty, which account each reporter belongs
 * to) are gathered by the DB layer and passed in as `OutcomeTrust`.
 */

export const NEGATIVE_OUTCOME_TYPES = new Set([
  "rug_pull_outflow",
  "confirmed_fraud",
  "chargeback_dispute",
]);
export const POSITIVE_OUTCOME_TYPES = new Set([
  "sustained_healthy_activity",
  "confirmed_legitimate",
]);

/**
 * How many DISTINCT reporter accounts must independently report a wallet as
 * negative before their reports — none of which is a proven counterparty — can
 * move the public score. Collapsed by userId, so registering ten free keys
 * under one login still counts as one. Three is chosen so a single actor cannot
 * reach it by pairing two throwaway accounts; a genuinely defrauded crowd
 * clears it, and any one real counterparty bypasses it entirely.
 */
export const REQUIRED_INDEPENDENT_REPORTERS = 3;

export type OutcomeTrust = {
  /**
   * Reporter apiKeyIds shown to control a wallet that actually settled an x402
   * payment TO the subject wallet (score-eligible: on-chain USDC, amount- and
   * ownership-verified). A single report from one of these is trusted.
   */
  verifiedCounterparties: Set<string>;
  /**
   * Reporter apiKeyId → owning account (userId), or null when unknown. Used to
   * collapse the multi-reporter count so one actor's many keys are one voice.
   */
  accountByReporter: Map<string, string | null>;
};

export const EMPTY_OUTCOME_TRUST: OutcomeTrust = {
  verifiedCounterparties: new Set(),
  accountByReporter: new Map(),
};

export type OutcomeAdjustment = {
  score: number;
  adjustment: number;
  /** Every outcome type observed, trusted or not — for disclosure. */
  types: string[];
  /** Negative types that met the trust bar and DID cap the score. */
  trustedNegativeTypes: string[];
  /** Negative types retained but not corroborated — disclosed, no score effect. */
  uncorroboratedNegativeTypes: string[];
  /** Positive types present. */
  positiveTypes: string[];
};

function isPartnerSource(source: string): boolean {
  return source.startsWith("partner:");
}

/** Independence key for a partner reporter: their account if known, else the
 *  key itself (so two rows from the same key never count as two voices, but two
 *  distinct anonymous keys are not silently merged either). */
function independenceKey(row: WalletOutcomeRow, trust: OutcomeTrust): string {
  const account = row.apiKeyId != null ? trust.accountByReporter.get(row.apiKeyId) ?? null : null;
  if (account != null) return `acct:${account}`;
  return `key:${row.apiKeyId ?? "unknown"}`;
}

/**
 * Fold a wallet's outcome history into its score. Pure and deterministic.
 *
 *   trusted negative present   → cap at 15 (the BLOCK the negative earns)
 *   else positive present      → +8
 *   else                       → unchanged
 *
 * An uncorroborated negative alone changes nothing — it is disclosed via the
 * returned list and the engine's flags, but the money-facing number does not
 * move on it.
 */
export function applyOutcomeAdjustment(
  score: number,
  outcomes: WalletOutcomeRow[],
  trust: OutcomeTrust = EMPTY_OUTCOME_TRUST,
): OutcomeAdjustment {
  const positiveTypes = new Set<string>();
  const trustedNegativeTypes = new Set<string>();

  // Partner negatives that are not (yet) individually trusted — candidates for
  // the multi-reporter corroboration path below.
  const pendingPartnerNegatives: WalletOutcomeRow[] = [];

  for (const row of outcomes) {
    if (POSITIVE_OUTCOME_TYPES.has(row.outcomeType)) {
      positiveTypes.add(row.outcomeType);
      continue;
    }
    if (!NEGATIVE_OUTCOME_TYPES.has(row.outcomeType)) continue;

    // Auto (chain-observed by us) and non-partner sources are trusted as before.
    if (!isPartnerSource(row.source)) {
      trustedNegativeTypes.add(row.outcomeType);
      continue;
    }
    // A partner report from a proven counterparty is trusted on its own.
    if (row.apiKeyId != null && trust.verifiedCounterparties.has(row.apiKeyId)) {
      trustedNegativeTypes.add(row.outcomeType);
      continue;
    }
    pendingPartnerNegatives.push(row);
  }

  // Multi-reporter corroboration: count distinct independent accounts among the
  // not-yet-trusted partner negatives. Meeting the bar promotes all of them.
  const independentReporters = new Set(
    pendingPartnerNegatives.map((row) => independenceKey(row, trust)),
  );
  const corroboratedByCrowd = independentReporters.size >= REQUIRED_INDEPENDENT_REPORTERS;

  const uncorroboratedNegativeTypes = new Set<string>();
  for (const row of pendingPartnerNegatives) {
    if (corroboratedByCrowd) trustedNegativeTypes.add(row.outcomeType);
    else uncorroboratedNegativeTypes.add(row.outcomeType);
  }

  const allTypes = [...new Set(outcomes.map((row) => row.outcomeType))];

  let adjusted = score;
  if (trustedNegativeTypes.size > 0) {
    adjusted = Math.min(score, 15);
  } else if (positiveTypes.size > 0) {
    adjusted = Math.max(0, Math.min(100, Math.round(score + 8)));
  }

  return {
    score: adjusted,
    adjustment: adjusted - score,
    types: allTypes,
    trustedNegativeTypes: [...trustedNegativeTypes],
    uncorroboratedNegativeTypes: [...uncorroboratedNegativeTypes],
    positiveTypes: [...positiveTypes],
  };
}
