# @vouch/sdk

Thin TypeScript client for the Vouch Trust API.

```bash
cd packages/sdk && npm install && npm run build
```

```typescript
import { createVouchClient } from "@vouch/sdk";

// apiUrl below is the current production deployment. A custom domain
// (e.g. api.vouch.dev) is not registered yet — swap this in once it is.
const vouch = createVouchClient({
  apiUrl: "https://agent-trust-tawny.vercel.app/api/v1",
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

```typescript
const guard = vouch.createSpendGuard({
  maxPerTxUsd: 10,             // deny any single payment above $10
  dailyBudgetUsd: 50,          // deny once today's allowed total would pass $50
  minPayeeScore: 40,           // deny when the payee scores below 40
  blockOnRecommendation: true, // deny when the payee recommendation is BLOCK
});

const decision = await guard.evaluate({ payee: "0x...", amountUsd: 5 });
if (decision.allow) {
  // hand off to AgentKit / Privy / your own signer
} else {
  console.error(decision.reasons); // e.g. ["payee_score_below_min"]
}
```

How it works:

- All policy fields are optional — set only the rules you want. `minPayeeScore` /
  `blockOnRecommendation` trigger a `GET /v1/payees/{address}/score` lookup
  (skipped when a local rule already denied, so no quota is burned on a dead
  payment). A purely local policy makes no API calls at all.
- Trust-lookup failures **fail closed**: the decision is deny with reason
  `payee_trust_unavailable`.
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
