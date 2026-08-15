import { worstStatus } from "@/lib/scoring/payee-probe";

export type HealthStatus = "ok" | "degraded" | "error";

/**
 * Per-IP ceiling for the PUBLIC liveness probe (2026-08-15 audit).
 *
 * The shallow answer is not cheap: it runs the seller-side scoring probe and
 * the payee probe, i.e. Base RPC + Blockscout + DB. Memoisation is per function
 * INSTANCE, so a concurrent flood fans out to cold instances and pays the full
 * cost on each — and Blockscout answers sustained load with a global cooldown
 * that then degrades real scoring.
 *
 * 60/min = one request per second, far above any honest uptime poller.
 * Lives in lib (not next to the route) so GET /api/health can compose the
 * probes without the public banner importing engines into the HTML layout.
 */
export const HEALTH_RATE_LIMIT = 60;
export const HEALTH_RATE_WINDOW_MS = 60_000;

/**
 * HTTP status for the PUBLIC liveness endpoint.
 *
 * docs/api tells integrators the endpoint "returns 200/503 for uptime
 * pollers". `degraded` is not up — it returns 503. The body still carries
 * `"degraded"` vs `"error"` for a human reading curl.
 */
export function livenessHttpStatus(status: HealthStatus): 200 | 503 {
  return status === "ok" ? 200 : 503;
}

export type LivenessProbes = {
  scoring: () => Promise<{ status: HealthStatus }>;
  payee: () => Promise<{ status: HealthStatus }>;
};

export type LivenessResult = {
  /** Exactly one bit of detail to an anonymous caller: up, partly, or not. */
  status: HealthStatus;
  httpStatus: 200 | 503;
};

/**
 * Runs both engine probes concurrently (so the caller costs the slower one,
 * not the sum) and reports the worse of the two.
 */
export async function evaluateLiveness(probes: LivenessProbes): Promise<LivenessResult> {
  const [scoring, payee] = await Promise.all([probes.scoring(), probes.payee()]);
  const status = worstStatus([scoring.status, payee.status]);
  return { status, httpStatus: livenessHttpStatus(status) };
}
