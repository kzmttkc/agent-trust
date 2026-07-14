---
title: "x402 proves payment. It doesn’t prove trust — so we built Vouch"
published: false
description: "How we score ERC-8004 agents on Base before x402 gateways serve paid routes — ALLOW / WARN / BLOCK with settlement attestation."
tags: web3, ai, typescript, api, blockchain
cover_image: ../assets/vouch-banner.png
---

# x402 proves payment. It doesn’t prove trust — so we built Vouch

**Payment answers “who paid?”**  
**Trust answers “should I serve them?”**

If you run an x402 API, that gap is the whole product risk. ERC-8004 gives agents an identity and reputation surface on-chain — useful, but still Sybil-prone if you treat raw feedback as credit. We built **Vouch**: a trust layer that returns a **0–100 score** and an **`ALLOW` / `WARN` / `BLOCK`** recommendation for gateways that need a decision *before* they hand over paid content.

This post is a build-in-public snapshot of a **closed beta** on Base.

## The flow we care about

```
Client → x402 payment verification → Vouch trust check → your route
                              ↘ optional settlement attest
```

1. x402 middleware verifies payment and yields a **payer wallet**
2. Your gate calls Vouch `GET /v1/wallets/{payer}/score`
3. On `BLOCK`, return 403 before the expensive handler
4. After allow, optionally `POST /v1/payments/x402` so settlement history strengthens future scores

Sample middleware lives in the repo: `examples/x402-trust-gate`.

## What goes into a score (today)

| Signal | Role |
|--------|------|
| ERC-8004 identity | Registered agent + metadata URI presence |
| ERC-8004 reputation | Feedback volume / average, with Sybil dampening |
| Wallet heuristics | Age, activity, burner patterns, funder clusters |
| Manual WL/BL | Per-customer policy (after the chain score) |
| x402 settlements | Attested payment history (**10% weight** in closed β) |

Recommendations: roughly **≥70 ALLOW**, **40–69 WARN**, **&lt;40 BLOCK** (blacklist / high Sybil risk forces BLOCK). Scores are **informational** — not a guarantee or credit rating.

Owner-index lag is surfaced as `dataCoverage` so integrators can see freshness instead of assuming omniscience.

## API surface (integrator path)

```bash
# Score a payer wallet (primary x402 path)
curl -H "Authorization: Bearer $VOUCH_API_KEY" \
  https://agent-trust-tawny.vercel.app/api/v1/wallets/0xYOUR_PAYER/score

# Attest a verified payment (idempotent on txHash)
curl -X POST -H "Authorization: Bearer $VOUCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0xYOUR_PAYER","txHash":"0x...","resource":"/api/premium"}' \
  https://agent-trust-tawny.vercel.app/api/v1/payments/x402
```

Also available: agent-ID scoring, batch scores, MCP tools (`check_wallet_trust`, `attest_x402_payment`), and a thin TypeScript client in `packages/sdk`.

## Design choices we won’t apologize for

- **Fail closed** on wallet binding / critical RPC failure when verifying binders — better a 502/BLOCK than a silent ALLOW.
- **Whitelist is not a Sybil free pass** — high Sybil risk refuses to promote WARN→ALLOW.
- **Free anonymous public scoring stays frozen** — closed beta first; we want paying integrators, not scrape farms.
- **x402 settlement weight starts small (10%)** — data must accumulate before it deserves more.

## Closed beta

We’re inviting a small set of **x402 API providers** and agent-runtime builders.

- Product: [agent-trust-tawny.vercel.app](https://agent-trust-tawny.vercel.app)
- Code & docs: [github.com/kzmttkc/agent-trust](https://github.com/kzmttkc/agent-trust)
- Guides: `docs/x402-integration.md`, `docs/mcp-setup.md`, `docs/openapi.yaml`

Want in? **Reply here or DM** with what you’re building (no invite codes in public posts). We’ll send a key if it’s a fit.

---

*Built with Next.js, viem, Neon, and the ERC-8004 registries on Base. Tagline: trust layer for agent commerce.*
