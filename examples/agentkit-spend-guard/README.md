# AgentKit SpendGuard (sample)

Pre-payment gate for autonomous agents: **Vouch SpendGuard decides, your wallet stack executes.**

```
Agent wants to pay → guard.evaluate({payee, amountUsd}) → allow? → AgentKit signs & sends
                                                        → deny?  → skip, log reasons
```

SpendGuard composes two things into one allow/deny decision:

1. **Local policy** — per-transaction USD cap and an in-memory daily budget (UTC day; resets on process restart).
2. **Vouch Payee Trust API** — `GET /v1/payees/{address}/score`: settlement receiving history, wallet health, exit-scam-shaped outflow, outcome labels.

SpendGuard is strictly non-custodial: it never touches keys, funds, signing, or transaction submission. Execution stays with the agent's wallet stack (Coinbase AgentKit, Privy, ...).

## Files

| File | What it shows |
|---|---|
| `src/demo.ts` | Runnable demo: deterministic per-tx cap + daily budget sequence, then a live trust-gated check |
| `src/agentkit-integration.ts` | Where the decision plugs into Coinbase AgentKit (AgentKit calls commented so the sample stays dependency-light) |

## Run the demo

```bash
# Build the SDK once (the example depends on it via file:)
cd packages/sdk && npm install && npm run build

cd ../../examples/agentkit-spend-guard
npm install

# Terminal 1: Vouch API
cd ../.. && npm run dev

# Terminal 2: demo
export VOUCH_API_KEY=your_key
npm run demo
```

Expected output, part 1 (local policy — deterministic): payment 1 allowed, payment 2 denied (`max_per_tx_exceeded`), payment 3a allowed, payment 3b denied (`daily_budget_exceeded`). Part 2 queries the live Payee Trust API, so its verdict depends on the payee and environment — a local dev server with `SKIP_CHAIN_READS=true` scores unknown wallets low and will deny.

## Policy reference

```typescript
const guard = vouch.createSpendGuard({
  maxPerTxUsd: 10,            // deny any single payment above $10
  dailyBudgetUsd: 50,         // deny once today's allowed total would pass $50
  minPayeeScore: 40,          // deny when payee scores below 40
  blockOnRecommendation: true // deny when payee recommendation is BLOCK
});
```

All fields are optional — set only the rules you want. The payee trust lookup only happens when `minPayeeScore` or `blockOnRecommendation` is set, and is skipped when a local rule already denied (no API quota burned on a dead payment).

## Budget semantics worth knowing

- An **allowed** payment is immediately reserved against the daily budget. If the transfer then fails or is skipped, call `guard.release(amountUsd)` to give the reservation back (see `agentkit-integration.ts`).
- The budget counter is **per guard instance, in process memory**. A restart resets it to $0 — treat `dailyBudgetUsd` as a soft brake, not an accounting system. If you need durable budgets across restarts or replicas, persist your own ledger and keep SpendGuard for the per-tx and trust rules.
- Trust lookup failures **fail closed** (`payee_trust_unavailable`): an unreachable trust API denies the payment rather than waving it through.

See the [SDK README](../../packages/sdk/README.md) for the full SpendGuard API.

## Using alongside CDP facilitators / paymasters

SpendGuard sits at the payment-decision layer, so it composes with CDP
infrastructure rather than overlapping it:

- **Paymasters are orthogonal.** A paymaster sponsors gas/fees; it does not
  change who receives the payment or whether that recipient should be paid.
  Run `guard.evaluate()` on the payee exactly as without one — a sponsored
  transaction still needs an ALLOW verdict before it is submitted.
- **Facilitator-settled x402 payments verify the same address.** When a
  facilitator settles an x402 payment, the recipient is the `payTo` address
  from the x402 payment requirements. That `payTo` address is what you pass
  to `guard.evaluate({ payee, amountUsd })` — the check is identical whether
  the payment settles directly or through a facilitator. Settlement is not
  vetting: the facilitator moving the funds does not score the recipient.
- **Non-custodial either way.** SpendGuard returns a decision only; keys,
  signing, and submission stay with the wallet stack and its infrastructure
  in both setups.
