# LangChain Tool (vet402 SpendGuard)

Make "check trust before you pay" one tool call for a LangChain agent.

`createVouchSpendGuardTool()` returns a `DynamicStructuredTool` named
`vouch_spend_guard`. The agent calls it with `{ payee, amountUsd }` before any
payment and gets back an allow/deny decision as JSON:

- **Local policy** — per-transaction USD cap + in-memory daily budget
  (UTC day, resets on process restart).
- **Vouch Payee Trust API** — settlement receiving history, wallet health,
  exit-scam-shaped outflow, outcome labels.
- **Fail-closed** — anything but a clean `ALLOW` verdict denies, and the tool
  never throws: even an unexpected error comes back as
  `{ "allow": false, "failClosed": true }`, so a crash mid-decision cannot
  fall through to a payment.

The tool only decides. It never touches keys, funds, or signing — execution
stays with your wallet stack (Coinbase AgentKit, Privy, ...).

## Quickstart

```bash
# 1. Build the SDK once (this example depends on it via file:)
cd packages/sdk && npm install && npm run build

# 2. Install and run the demo (dry-run, no key needed)
cd ../../examples/langchain-tool
npm install
npx tsx index.ts

# 3. Go live
export VOUCH_API_KEY=your_key   # https://vet402.com/dashboard/keys
npx tsx index.ts
```

Without `VOUCH_API_KEY` the demo runs **dry-run** (offline): the trust lookup
answers 401 locally and the guard denies with
`payee_trust_unauthenticated` — a live demonstration of the fail-closed
default, same design as [`../hackathon-starter`](../hackathon-starter/).

## Plugging into your agent

```typescript
import { createVouchSpendGuardTool } from "./index.js"; // or copy the file
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const spendGuard = createVouchSpendGuardTool({
  client: { apiKey: process.env.VOUCH_API_KEY! },
  policy: { maxPerTxUsd: 10, dailyBudgetUsd: 50 },
});

const agent = createReactAgent({
  llm,                                  // your chat model
  tools: [spendGuard, ...paymentTools], // guard first, wallet tools after
});
```

The tool description already instructs the model to call it before any
payment and to treat `allow: false` as final. Reinforce it in your system
prompt if your agent has other routes to money:

> Before executing any payment, call `vouch_spend_guard` with the payee
> address and USD amount. If it returns `"allow": false`, do not pay.

One tool instance = one `SpendGuard` instance, so the daily budget counter
spans every call the agent makes in the process. Create the tool once at
startup, not per request.

## What the agent gets back

```json
{
  "allow": false,
  "reasons": ["payee_trust_unauthenticated"],
  "payee": "0x8335...2913",
  "amountUsd": 1,
  "failClosed": false,
  "guidance": "DENY — do not pay this wallet. ...",
  "payeeScore": null
}
```

Every deny reason code is documented in the
[SDK README](../../packages/sdk/README.md).

## Where to go deeper

- [`../hackathon-starter`](../hackathon-starter/) — the same pattern without
  LangChain, in one file
- [`../agentkit-spend-guard`](../agentkit-spend-guard/) — where the ALLOW
  decision hands off to Coinbase AgentKit execution
- [`../elizaos-plugin`](../elizaos-plugin/) — the same guard as an ElizaOS
  action
