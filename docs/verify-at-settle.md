# verify-at-settle — the fast verdict surface

**Endpoint**: `GET /api/v1/payees/{address}/verdict-fast` (API key required, 1 unit)

For facilitators and payment middleware that want a trust check **inside** the
settlement flow, where every millisecond is user-visible.

## The contract (one line)

> This surface **never computes**. It returns the engine's cached, confident
> verdict — or an honest `cache_cold`.

- `{"status":"hit", "recommendation":"ALLOW|WARN|BLOCK", "score":…, "cacheExpiresAt":…}`
- `{"status":"cache_cold", "recommendation":null, "warmVia":"/api/v1/payees/{address}/score"}`

Only verdicts the engine was confident enough to pin are ever cached
(degraded / partially-measured readings are excluded at the engine layer), so
speed here never trades away quality.

## Fail-closed semantics belong to the caller

Treat anything that is not an explicit `ALLOW` — including `cache_cold` — as
"do not pay yet". Warm the cache asynchronously by calling the full `/score`
endpoint (same cache, TTL 5 minutes); retry the fast surface afterwards.
This is exactly what `@vouchscore/sdk` / the Python SDK do by default.

## Latency

In-handler work is a single in-memory cache read; the test suite pins the
in-handler p95 under 1 ms over 100 calls (`tests/verdict-fast.test.ts` — the
number is enforced in CI, not quoted from memory). End-to-end latency adds
network + platform overhead on top; deploy-local callers (same region) should
budget single-digit milliseconds.

## Warming pattern for facilitators

1. On payment intent creation: fire-and-forget `GET /score` for the payee.
2. At settle time: `GET /verdict-fast`; require `status=hit` + `ALLOW`.
3. On `cache_cold`: fail closed (queue/delay), not open.
