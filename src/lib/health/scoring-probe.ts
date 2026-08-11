import { scoreAgentById } from "@/lib/scoring/engine";
import { withDeadline } from "@/lib/util/deadline";

/**
 * Does the product's core capability — computing a trust score — actually work
 * right now?
 *
 * WHY THIS EXISTS (2026-08-12). /api/health returned a hard-coded
 * {"status":"ok"} while every score on the site was failing, and the deep
 * check only proved the RPC could answer `eth_getBlockNumber`. Both were
 * measuring something ADJACENT to the thing that was broken: the block-number
 * read stayed fast and green the entire time `eth_getLogs` was failing and
 * scoring was timing out. The docs point customers at /api/health as their
 * uptime monitor, so this was worse than having no monitoring — it actively
 * asserted health during a total outage of the one feature people pay for.
 *
 * So the probe runs the real thing: the same scoreAgentById() call that
 * /api/demo/score and /agent/[id] make. If a customer cannot get a score,
 * neither can this probe, and the endpoint must say so.
 *
 * Cost control: the result is memoised briefly, so an uptime poller hitting
 * this every few seconds costs one score per PROBE_TTL_MS, not one per
 * request. The scoring engine's own 5-minute cache absorbs the rest.
 */

const PROBE_TTL_MS = 60_000;
/** Under the engine's own 6s budget — a probe must never outlive what it probes. */
const PROBE_DEADLINE_MS = 7_000;

export type ScoringProbe = {
  /**
   * ok       — a score was computed from live signals.
   * degraded — a score was computed, but one or more upstreams were unavailable
   *            (fail-closed: those verdicts are forced cautious).
   * error    — no score could be computed at all. This is an outage.
   */
  status: "ok" | "degraded" | "error";
  /** Flags that made it degraded — server-side detail, never in the public body. */
  unavailable: string[];
  latencyMs: number;
};

let cached: { probe: ScoringProbe; expiresAt: number } | null = null;

function probeAgentId(): bigint {
  try {
    return BigInt(process.env.DEMO_AGENT_ID ?? "1");
  } catch {
    return BigInt(1);
  }
}

export function resetScoringProbeCache(): void {
  cached = null;
}

export async function runScoringProbe(): Promise<ScoringProbe> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.probe;

  const startedAt = Date.now();
  let probe: ScoringProbe;

  try {
    const result = await withDeadline(
      scoreAgentById(probeAgentId()),
      PROBE_DEADLINE_MS,
      "scoring_probe",
    );
    const unavailable = (result.signals.sybil.flags ?? []).filter((flag) =>
      flag.endsWith("_unavailable"),
    );
    probe = {
      status: unavailable.length > 0 ? "degraded" : "ok",
      unavailable,
      latencyMs: Date.now() - startedAt,
    };
    if (unavailable.length > 0) {
      console.warn(`[vouch] scoring_probe degraded: ${unavailable.join(",")}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The engine wraps upstream failures as `new Error(tag, { cause })`. The
    // tag alone ("agent_identity_unavailable") says WHICH read died but not
    // WHY, which is the half an operator actually needs.
    const cause = error instanceof Error ? error.cause : undefined;
    const causeText =
      cause instanceof Error
        ? ` | cause: ${(cause as { details?: string })?.details ?? cause.message}`
        : "";
    console.error(`[vouch] scoring_probe failed: ${message.slice(0, 200)}${causeText.slice(0, 300)}`);
    probe = {
      status: "error",
      unavailable: [],
      latencyMs: Date.now() - startedAt,
    };
  }

  cached = { probe, expiresAt: Date.now() + PROBE_TTL_MS };
  return probe;
}
