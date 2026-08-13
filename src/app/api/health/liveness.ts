import { worstStatus } from "@/lib/scoring/payee-probe";

export type HealthStatus = "ok" | "degraded" | "error";

/**
 * HTTP status for the PUBLIC liveness endpoint.
 *
 * docs/api tells integrators the endpoint "returns 200/503 for uptime
 * pollers" and to point their own monitor at it. There is no third code in
 * that contract, and an uptime poller only reads the code — the JSON body is
 * for humans reading a curl.
 *
 * 2026-08-13 (hackathon persona R2): `degraded` answered **200**. So the one
 * state the probe exists to surface — the engine answering, but from inputs
 * it could not fully read, which is exactly what /payee/[address] renders as
 * "Not verifiable right now" — was invisible to every monitor pointed here.
 * Same shape as the two defects fixed above it the same day: the endpoint
 * kept reporting green next to the thing that was broken. `degraded` is not
 * up. It returns 503.
 *
 * The body still carries the distinction (`"degraded"` vs `"error"`), so a
 * human or a richer monitor can tell a partial outage from a total one
 * without the poller having to guess.
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
 * Runs both engine probes concurrently (so the endpoint costs the slower one,
 * not the sum) and reports the worse of the two. Seller-side scoring and
 * buyer-side payee scoring can fail independently; either one failing means a
 * caller is not getting what the product sells.
 *
 * Probes are injected so this contract is testable without standing up the
 * whole Next route and its upstreams.
 */
export async function evaluateLiveness(probes: LivenessProbes): Promise<LivenessResult> {
  const [scoring, payee] = await Promise.all([probes.scoring(), probes.payee()]);
  const status = worstStatus([scoring.status, payee.status]);
  return { status, httpStatus: livenessHttpStatus(status) };
}
