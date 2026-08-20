# ElizaOS Plugin (vet402 SpendGuard)

Make "check trust before you pay" one action for an ElizaOS agent.

`vouchPlugin` ships a single action, **`VOUCH_SPEND_GUARD`**: when a message
asks the character to pay a wallet, the action evaluates the payment with
Vouch SpendGuard and speaks the verdict back into the chat:

- **Local policy** — per-transaction USD cap + in-memory daily budget
  (UTC day, resets on process restart), configurable via settings.
- **Vouch Payee Trust API** — settlement receiving history, wallet health,
  exit-scam-shaped outflow, outcome labels.
- **Fail-closed** — anything but a clean `ALLOW` verdict denies. A missing
  API key, an unreadable message, or an unexpected error all end in an
  explicit "do not pay", never in a silent pass-through.

The action only decides. It never touches keys, funds, or signing —
execution stays with whatever wallet plugin your character uses.

## Quickstart

```bash
# 1. Build the SDK once (this example depends on it via file:)
cd packages/sdk && npm install && npm run build

# 2. Install and run the demo (dry-run, no key needed)
cd ../../examples/elizaos-plugin
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

## Plugging into your ElizaOS project

This example deliberately has **no `@elizaos/core` dependency**: the action
and plugin objects are written against minimal structural mirrors of the
core `Action` / `Plugin` interfaces (verified against
`elizaOS/eliza` → `packages/core/src/types/components.ts` and `plugin.ts`),
so they are drop-in compatible. Two ways to use them:

**Copy the file** into your ElizaOS project (`src/plugins/vouch.ts`), change
the interface imports to the real ones, and register the plugin on your
agent:

```typescript
import type { Plugin } from "@elizaos/core";
import { vouchPlugin } from "./plugins/vouch.js";

export const character = {
  name: "MyAgent",
  plugins: [vouchPlugin as Plugin, /* ...your wallet plugin */],
  settings: {
    secrets: {
      VOUCH_API_KEY: process.env.VOUCH_API_KEY,
    },
  },
};
```

Settings the action reads via `runtime.getSetting()`:

| Setting | Default | Meaning |
|---|---|---|
| `VOUCH_API_KEY` | — (dry-run without it) | vet402 API key |
| `VOUCH_API_URL` | hosted API | Override for a local dev server |
| `VOUCH_MAX_PER_TX_USD` | `10` | Deny any single payment above this |
| `VOUCH_DAILY_BUDGET_USD` | `50` | Deny once today's allowed total would pass this |

## How the action behaves

- `validate()` fires when the message contains a `0x...` wallet address.
- `handler()` extracts the payee and USD amount from the action options
  (`options.payee`, `options.amountUsd`) or, failing that, from the message
  text; if it cannot find both, it refuses (fail-closed) rather than guess.
- The verdict is spoken via the callback and returned in
  `ActionResult.data.decision` (the full SDK `SpendDecision`, machine-readable
  deny reasons included) so downstream actions — e.g. the one that actually
  executes the transfer — can gate on `decision.allow`.
- A DENY verdict is `success: true` (the evaluation worked); `success: false`
  is reserved for "could not evaluate", which is also a do-not-pay.

Every deny reason code is documented in the
[SDK README](../../packages/sdk/README.md).

## Where to go deeper

- [`../hackathon-starter`](../hackathon-starter/) — the same pattern without
  a framework, in one file
- [`../agentkit-spend-guard`](../agentkit-spend-guard/) — where the ALLOW
  decision hands off to Coinbase AgentKit execution
- [`../langchain-tool`](../langchain-tool/) — the same guard as a LangChain
  tool
