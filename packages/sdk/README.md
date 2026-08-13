# @vouchscore/sdk

Thin TypeScript client for the Vouch Trust API.

```bash
cd packages/sdk && npm install && npm run build
```

```typescript
import { createVouchClient } from "@vouchscore/sdk";

// apiUrl below is the current production deployment. A custom domain
// (e.g. api.vouch.dev) is not registered yet — swap this in once it is.
const vouch = createVouchClient({
  apiUrl: "https://vet402.com/api/v1",
  apiKey: process.env.VOUCH_API_KEY!,
});

const score = await vouch.getWalletScore("0x...");
await vouch.attestX402Payment({
  wallet: "0x...",
  txHash: "0x...",
  resource: "/api/premium/data",
});
```

Methods: `getAgentScore`, `getWalletScore`, `getPayeeScore`, `batchScore`, `attestX402Payment`, `createSpendGuard`.

## SpendGuard — pre-payment policy for agents

Buyer-side counterpart to the score lookups above: before your agent *pays*
someone, ask the guard. It returns an allow/deny decision plus
machine-readable reasons — and nothing else. SpendGuard is strictly
non-custodial: it never touches keys, funds, signing, or transaction
submission. Execution stays with your wallet stack (Coinbase AgentKit,
Privy, ...).

> **BREAKING (v0.2.0): fail-closed by default.** Money moves only on a clean
> `ALLOW` verdict unless you explicitly opt out. With no `trustPolicy` set,
> every `evaluate()` performs the payee trust lookup and **denies** when:
>
> | Condition | Reason code |
> |---|---|
> | Recommendation is `WARN` or `BLOCK` | `payee_recommendation_not_allow` |
> | The score came from a degraded read | `payee_score_degraded` |
> | Partial measurement (`signalsUnavailable` non-empty) | `payee_partial_measurement` |
> | The score lookup itself failed | `payee_trust_unavailable` |
>
> Opt-outs: `trustPolicy: "block-only"` (WARN passes; BLOCK, degraded and
> failed lookups still deny) or `trustPolicy: "custom"` (pre-0.2.0 behaviour —
> only the rules you set apply, and the lookup only runs when
> `minPayeeScore` / `blockOnRecommendation` is set).

```typescript
const guard = vouch.createSpendGuard({
  maxPerTxUsd: 10,             // deny any single payment above $10
  dailyBudgetUsd: 50,          // deny once today's allowed total would pass $50
  // trustPolicy: "allow-only" is the default: deny anything but a clean ALLOW
  minPayeeScore: 40,           // optional stricter floor on top of the policy
});

const decision = await guard.evaluate({ payee: "0x...", amountUsd: 5 });
if (decision.allow) {
  // hand off to AgentKit / Privy / your own signer
} else {
  console.error(decision.reasons); // e.g. ["payee_recommendation_not_allow"]
}
```

How it works:

- The local rules (`maxPerTxUsd`, `dailyBudgetUsd`) are optional — set only
  the ones you want. Under the default `trustPolicy: "allow-only"` the payee
  trust lookup (`GET /v1/payees/{address}/score`) always runs, but is skipped
  when a local rule already denied, so no quota is burned on a dead payment.
  Only `trustPolicy: "custom"` makes the lookup conditional on
  `minPayeeScore` / `blockOnRecommendation` being set — with `"custom"` and
  neither set, no API calls happen at all.
- Everything the guard cannot vet **fails closed**: a WARN/BLOCK verdict, a
  degraded read, a partial measurement, or a failed lookup all deny (reason
  codes in the table above).
- Budget reservation is optimistic: once the local rules pass, the amount is
  reserved *before* the trust lookup awaits and returned automatically if the
  trust rules deny — so concurrent `evaluate` calls within one process cannot
  race past the daily budget together. If an allowed transfer then fails or
  is skipped, call `guard.release(amountUsd)` to give the reservation back.
- The daily budget counter lives **in this process's memory** (UTC day): it
  resets on process restart and is not shared across replicas. Treat it as a
  runaway-agent brake, not an accounting system — persist your own ledger if
  you need durable budgets.

See [examples/agentkit-spend-guard](../../examples/agentkit-spend-guard) for a runnable demo and an AgentKit integration sketch.

See [OpenAPI](../../docs/openapi.yaml) and [x402 integration](../../docs/x402-integration.md).
