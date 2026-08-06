---
title: "x402 proves payment. It doesn’t prove trust — so we built Vouch"
published: false
description: "How we score both sides of an x402 payment on Base — payer trust for API providers, payee trust for paying agents. ALLOW / WARN / BLOCK with settlement attestation."
tags: web3, ai, typescript, api, blockchain
---

# x402 proves payment. It doesn’t prove trust — so we built Vouch

**Payment answers “who paid?”**  
**Trust answers “should I serve them?”**

If you run an x402 API, that gap is the whole product risk. ERC-8004 gives agents an identity and reputation surface on-chain — useful, but still Sybil-prone if you treat raw feedback as credit. We built **Vouch**: a trust layer that returns a **0–100 score** and an **`ALLOW` / `WARN` / `BLOCK`** recommendation for gateways that need a decision *before* they hand over paid content.

And the risk runs both ways. The agent *sending* the payment has the mirror problem: is the wallet on the other side of this 402 a real service, or a burner that will take the USDC and vanish? So Vouch now scores **both sides**: payer trust for API providers, payee trust for paying agents.

This post is a build-in-public snapshot of Vouch on Base.

## The flows we care about

```
Seller side — should I serve this payer?
Client → x402 payment verification → Vouch payer check → your route
                              ↘ optional settlement attest

Buyer side — should my agent pay this wallet?
Your agent → Vouch payee check → x402 payment → their API
```

Seller side:

1. x402 middleware verifies payment and yields a **payer wallet**
2. Your gate calls Vouch `GET /v1/wallets/{payer}/score`
3. On `BLOCK`, return 403 before the expensive handler
4. After allow, optionally `POST /v1/payments/x402` so settlement history strengthens future scores

Buyer side:

1. Your agent hits a 402 and extracts the **payee wallet** from the payment requirements
2. It calls `GET /v1/payees/{payee}/score` before signing anything
3. On `BLOCK`, skip the payment; on `WARN`, apply your own policy (cap the amount, require a human, whatever fits)

Sample seller-side middleware lives in the repo: `examples/x402-trust-gate`.

## What goes into a payer score (today)

| Signal | Role |
|--------|------|
| ERC-8004 identity | Registered agent + metadata URI presence |
| ERC-8004 reputation | Feedback volume / average, with Sybil dampening |
| Wallet heuristics | Age, activity, burner patterns, funder clusters |
| Manual WL/BL | Per-customer policy (after the chain score) |
| x402 settlements | Attested payment history (**10% weight** — still accumulating data) |

Recommendations: roughly **≥70 ALLOW**, **40–69 WARN**, **&lt;40 BLOCK** (blacklist / high Sybil risk forces BLOCK). Scores are **informational** — not a guarantee or credit rating.

Owner-index lag is surfaced as `dataCoverage` so integrators can see freshness instead of assuming omniscience.

## New this week: the Payee Trust API

`GET /v1/payees/{address}/score` answers the buyer-side question with a different signal mix, because a payee's failure mode isn't Sybil feedback — it's taking money and disappearing:

| Signal | Role |
|--------|------|
| Receiving history | Attested x402 settlements where this wallet was the payee — count, active days, distinct payers |
| Wallet health | Same age / tx-count / burner heuristics as the payer score |
| Drain pattern | Exit-scam shape: received funds, then pulled out (near-)everything — checked over native ETH *and* Base USDC, with dust floors so gas residue doesn't false-positive |
| Outcome history | Prior confirmed-fraud / confirmed-legitimate labels naming this wallet |

Two design details worth calling out:

- **It never 404s.** A wallet nobody has attested yet still gets a `200` with `dataDepth: "thin"`, and the weights shift accordingly — a thin-data wallet is judged mostly on wallet health and drain shape, a `rich` one mostly on its receiving track record. You decide how much confidence a thin score deserves; we don't pretend to know more than we do.
- **The data loop is shared.** Every `POST /v1/payments/x402` attestation is now verified on-chain (fail-closed) and credits *both* sides: the payer's settlement history and the payee's receiving history. Sellers attesting payments are, as a side effect, building the dataset that protects buyers.

## API surface (integrator path)

```bash
# Score a payer wallet (seller side, primary x402 path)
curl -H "Authorization: Bearer $VOUCH_API_KEY" \
  https://agent-trust-tawny.vercel.app/api/v1/wallets/0xYOUR_PAYER/score

# Score a payee wallet (buyer side, before your agent pays)
curl -H "Authorization: Bearer $VOUCH_API_KEY" \
  https://agent-trust-tawny.vercel.app/api/v1/payees/0xTHEIR_WALLET/score

# Attest a verified payment (idempotent on txHash)
curl -X POST -H "Authorization: Bearer $VOUCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0xYOUR_PAYER","txHash":"0x...","resource":"/api/premium"}' \
  https://agent-trust-tawny.vercel.app/api/v1/payments/x402
```

Also available: agent-ID scoring, batch scores, outcome reporting (`POST /v1/events/{id}/outcome` — tell us what actually happened after a verdict), MCP tools (`check_wallet_trust`, `attest_x402_payment`), and a TypeScript client on npm: `npm install @vouchscore/sdk` (MCP server: `@vouchscore/mcp-server`). The SDK and MCP server don't cover the payee endpoint yet — next on the list, along with a spend-policy helper for agent runtimes.

## Design choices we won’t apologize for

- **Fail closed** on wallet binding / critical RPC failure when verifying binders — better a 502/BLOCK than a silent ALLOW.
- **Attestations are verified on-chain before they count** — a well-formed wallet + txHash isn't enough to fabricate settlement history; the tx must be real, successful, and attributable to the claimed wallet.
- **Whitelist is not a Sybil free pass** — high Sybil risk refuses to promote WARN→ALLOW.
- **Free anonymous public scoring stays frozen** — API key required for every score; we want real integrators, not scrape farms.
- **x402 settlement weight starts small (10%)** — data must accumulate before it deserves more.
- **Every score explains itself** — the response ships a `breakdown` of the four weighted components (identity / reputation / wallet / x402), each with its score, weight, and contribution, so a gateway can log *why* a verdict was what it was, not just the number.

## Try it

Built for **x402 API providers** (payer gating + settlement attestation) and **agent-runtime builders** (payee screening before your agents spend).

- Sign up: [agent-trust-tawny.vercel.app/signup](https://agent-trust-tawny.vercel.app/signup) — free account, no invite code
- SDK: `npm install @vouchscore/sdk`
- Code & docs: [github.com/kzmttkc/agent-trust](https://github.com/kzmttkc/agent-trust)
- Guides: `docs/x402-integration.md`, `docs/mcp-setup.md`, `docs/openapi.yaml`

Building something in this space? **Reply here or DM** — happy to compare notes.

---

*Built with Next.js, viem, Neon, and the ERC-8004 registries on Base. Tagline: trust layer for agent commerce.*
