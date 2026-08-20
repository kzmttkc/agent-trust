# Solana Agent Kit Plugin (vet402 SpendGuard)

Make "check trust before you pay" one plugin for a [Solana Agent Kit v2](https://github.com/sendaifun/solana-agent-kit) agent.

`VouchPlugin` ships a single action, **`VOUCH_SPEND_GUARD`**: when the agent
is about to pay a wallet, the action evaluates the payment with Vouch
SpendGuard and returns a machine-readable allow/deny verdict:

- **Local policy** — per-transaction USD cap + in-memory daily budget
  (UTC day, resets on process restart), configurable via config keys.
- **Vouch Payee Trust API** — settlement receiving history, wallet health,
  exit-scam-shaped outflow, outcome labels.
- **Fail-closed** — anything but a clean `ALLOW` verdict denies. A missing
  API key, an unreadable input, an unscorable payee address, or an
  unexpected error all end in an explicit "do not pay", never in a silent
  pass-through.

The action only decides. It never touches keys, funds, or signing —
execution stays with the kit's wallet and payment plugins (e.g.
`@solana-agent-kit/plugin-token`'s `TRANSFER` action).

## Scoring coverage (read this first)

vet402 scores **EVM settlement addresses** (`0x` + 40 hex) today — the
addresses x402 payments settle to on Base et al. A **base58 Solana payee is
accepted as input** but cannot be scored yet: the action classifies it and
denies fail-closed with `payee_unscorable_address`. That is deliberate — an
address the guard cannot vet is an address the agent does not pay. When
vet402 adds Solana-native scoring, this plugin picks it up without an
interface change (the verdict shape stays the same).

Where this is useful on Solana today: agents that hold a Solana wallet but
pay x402 services settling on EVM rails (Solana Agent Kit v2 supports an
optional EVM wallet alongside the Solana one), and any flow where you want
"unknown format = no payment" enforced rather than assumed.

## Quickstart

```bash
# 1. Build the SDK once (this example depends on it via file:)
cd packages/sdk && npm install && npm run build

# 2. Install and run the demo (dry-run, no key needed)
cd ../../examples/solana-agent-kit-plugin
npm install
npx tsx index.ts

# 3. Go live
export VOUCH_API_KEY=your_key   # https://vet402.com/dashboard/keys
npx tsx index.ts
```

Without `VOUCH_API_KEY` the demo runs **dry-run** (offline): the trust
lookup answers 401 locally and the guard denies with
`payee_trust_unauthenticated` — a live demonstration of the fail-closed
default. The demo runs three cases (EVM payee within policy, EVM payee over
the per-tx cap, base58 payee) and proves the gate: the mock transfer tool
is **never invoked** without a clean ALLOW.

## Plugging into your Solana Agent Kit project

This example deliberately has **no `solana-agent-kit` dependency**: the
action and plugin objects are written against minimal structural mirrors of
the v2 `Action` / `Plugin` interfaces (verified against
`sendaifun/solana-agent-kit` branch `v2` →
`packages/core/src/types/action.ts`, `types/index.ts`, `agent/index.ts`),
so they are drop-in compatible. Copy `index.ts` into your project (e.g.
`src/plugins/vouch.ts`), change the mirror types to the real imports, and
register the plugin:

```typescript
import { SolanaAgentKit } from "solana-agent-kit";
import TokenPlugin from "@solana-agent-kit/plugin-token";
import VouchPlugin from "./plugins/vouch.js";

const agent = new SolanaAgentKit(wallet, process.env.RPC_URL!, {
  OTHER_API_KEYS: {
    VOUCH_API_KEY: process.env.VOUCH_API_KEY!,
  },
})
  .use(TokenPlugin)
  .use(VouchPlugin);

// The action is now in agent.actions for your LLM loop, and the methods
// are bound: await agent.methods.evaluateSpend(agent, payee, amountUsd)
```

Config keys the plugin reads from `config.OTHER_API_KEYS` (falling back to
`process.env`):

| Key | Default | Meaning |
|---|---|---|
| `VOUCH_API_KEY` | — (dry-run without it) | vet402 API key |
| `VOUCH_API_URL` | hosted API | Override for a local dev server |
| `VOUCH_MAX_PER_TX_USD` | `10` | Deny any single payment above this |
| `VOUCH_DAILY_BUDGET_USD` | `50` | Deny once today's allowed total would pass this |

## How the action behaves

- `schema` (zod) requires `payee` (wallet address string) and `amountUsd`
  (positive number); unreadable input refuses rather than guesses.
- The handler classifies the payee: EVM → full SpendGuard evaluation;
  base58 → explicit `payee_unscorable_address` deny; anything else →
  `invalid_payee_address` deny.
- The verdict comes back as a plain record — `allow` (boolean), `reasons`
  (machine-readable codes), `payeeScore` / `recommendation` when the trust
  lookup ran — so the downstream payment action can gate on `allow` and the
  LLM can explain `reasons`.
- A DENY verdict is `status: "success"` (the evaluation worked);
  `status: "error"` is reserved for "could not evaluate", which is also a
  do-not-pay.
- `methods.releaseSpend(agent, amountUsd)` returns an allowed-but-unspent
  reservation to today's budget when a transfer fails after an ALLOW.

Every deny reason code is documented in the
[SDK README](../../packages/sdk/README.md).

## Where to go deeper

- [`../elizaos-plugin`](../elizaos-plugin/) — the same guard as an ElizaOS
  action (same structural-mirror technique)
- [`../hackathon-starter`](../hackathon-starter/) — the same pattern without
  a framework, in one file
- [`../agentkit-spend-guard`](../agentkit-spend-guard/) — where the ALLOW
  decision hands off to Coinbase AgentKit execution
- [`../langchain-tool`](../langchain-tool/) — the same guard as a LangChain
  tool
