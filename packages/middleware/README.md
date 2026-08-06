# @vouchscore/middleware

Drop-in **x402 transaction gate**. Score the payment counterparty and
**ALLOW / WARN / BLOCK** before the payment settles — from Express, Next.js,
or Hono, in about three lines. Fail-closed by default: a score you cannot
fetch blocks the payment rather than waving it through.

This is the productized form of the `facilitator-gate` and `x402-trust-gate`
reference adapters. The x402 payment gate stays your beacon; this middleware
reads Vouch before it settles.

> **Status: not yet published to npm.** The package is built and tested in this
> repo but has not been released, so `npm install @vouchscore/middleware` does
> not resolve yet. Until it ships, consume it from the repo — build
> `packages/middleware` and reference it via a workspace/`file:` dependency, or
> install the packed tarball (`npm pack` in `packages/middleware`). The
> published SDK (`@vouchscore/sdk`) and MCP server (`@vouchscore/mcp-server`)
> are live on npm today; this middleware follows once its API is frozen.

```bash
# once published:
npm install @vouchscore/middleware
```

## Express — three lines

```typescript
import { createExpressGate } from "@vouchscore/middleware/express";

// Mount AFTER x402 verification so `req.payer` is set.
app.use("/api/paid", createExpressGate({
  apiUrl: process.env.VOUCH_API_URL!,   // https://.../api/v1
  apiKey: process.env.VOUCH_API_KEY!,
  getAddress: (req) => req.payer,       // the counterparty to vet
}));
```

A `BLOCK` returns `403 { error: "trust_blocked", ... }` before your handler
runs. `ALLOW`/`WARN` continue, with the full decision on `req.vouchTrust`.

## Next.js (App Router)

```typescript
import { withVouchGate } from "@vouchscore/middleware/next";

export const POST = withVouchGate(
  {
    apiUrl: process.env.VOUCH_API_URL!,
    apiKey: process.env.VOUCH_API_KEY!,
    getAddress: (req) => new URL(req.url).searchParams.get("payer") ?? undefined,
  },
  async (req, trust) => Response.json({ ok: true, trust }),
);
```

Or inline with `createNextGate(...).check(address)` → `{ decision, response }`,
returning `response` when it is non-null.

## Hono

```typescript
import { createHonoGate } from "@vouchscore/middleware/hono";

app.use("/api/paid/*", createHonoGate({
  apiUrl: process.env.VOUCH_API_URL!,
  apiKey: process.env.VOUCH_API_KEY!,
  getAddress: (c) => c.get("payer"),
}));
```

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `scoreSource` | `"wallet"` | `"wallet"` (the x402 beacon) or `"payee"` (buyer-side receiving history). |
| `blockOn` | `["BLOCK"]` | Recommendations that block the transaction. |
| `warnOn` | `["WARN"]` | Recommendations that warn (still allowed). |
| `minScore` | — | Stricter numeric floor (0–100): block below it even on ALLOW. |
| `failMode` | `"closed"` | `"closed"` blocks on a lookup failure; `"open"` allows it (flagged `degraded`). |
| `timeoutMs` | `5000` | Score-lookup timeout — a hung Vouch never hangs the payment path. |
| `blockStatus` | `403` | HTTP status returned on a block. |

Every decision carries `{ action, recommendation, score, reason, degraded }`.
`degraded: true` marks a verdict that came from `failMode`, not a real
score — log or alert on those so trust-blind settlements are visible.

## Settlement attestation (optional)

Feed successful settlements back so future scores weight them (10% of the
score). Provide `getAttestation` on any adapter; it is fire-and-forget — a
failed attestation never fails the paid request.

```typescript
createExpressGate({
  /* ...as above... */
  getAttestation: (req) => req.paymentTxHash
    ? { wallet: req.payer, txHash: req.paymentTxHash, resource: req.path }
    : undefined,
});
```

## Non-custodial

The gate reads a score and returns a verdict. It never touches keys, funds,
signing, or transaction submission — settlement stays with your x402 stack.

MIT · [Vouch](https://agent-trust-tawny.vercel.app)
