# Vouch (agent-trust)

**Trust layer for agent commerce** — ERC-8004 agent trust scores on Base.

Scores agents 0–100 with `ALLOW` / `WARN` / `BLOCK` recommendations. Built for x402 API providers who need to verify agents before accepting payment.

## Docs

- [Quickstart](./docs/quickstart.md)
- [Deployment guide](./docs/deployment.md)
- [Requirements v0.1](./docs/requirements-v0.1.md)
- [OpenAPI spec](./docs/openapi.yaml)
- [MCP setup](./docs/mcp-setup.md)
- [x402 integration](./docs/x402-integration.md)
- [x402 Foundation (optional)](./docs/ecosystem-x402-foundation.md)
- [Brand / naming](./docs/brand.md)
- [Marketing kit (Dev.to / Zenn)](./docs/marketing/README.md)

## Stack

- Next.js 16 (App Router) + TypeScript
- viem (Base mainnet)
- Drizzle ORM + PostgreSQL (Neon)
- ERC-8004 Identity & Reputation Registry

## Quick start

```bash
cp .env.example .env.local
# Set DATABASE_URL, secrets, DEV_API_KEY, BASE_RPC_URL

npm install
./scripts/dev-setup.sh   # local Postgres + db:push (Docker or Homebrew)
npm run dev
```

### Health check

```bash
curl http://localhost:3000/api/health
```

### Score an agent (dev)

```bash
curl -H "Authorization: Bearer $DEV_API_KEY" \
  http://localhost:3000/api/v1/agents/1/score
```

### Score by wallet (x402 integration path)

```bash
curl -H "Authorization: Bearer $DEV_API_KEY" \
  http://localhost:3000/api/v1/wallets/0x1234567890123456789012345678901234567890/score
```

### Attest settlement

```bash
curl -X POST -H "Authorization: Bearer $DEV_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0x...","txHash":"0x..."}' \
  http://localhost:3000/api/v1/payments/x402
```

## Database setup (M2)

```bash
# Set DATABASE_URL in .env.local, then push schema
npm run db:push

# Create a production API key
npm run api-key:create -- --plan free --name "my app"
```

**Production:** set `APP_ENV=production` explicitly (do not rely on `NODE_ENV` alone).

**Production required env vars:** `DATABASE_URL`, `API_KEY_PEPPER`, `DASHBOARD_SESSION_SECRET`, `ADMIN_SECRET` (min 32 chars, no placeholders).  
Set `TRUST_PROXY_HEADERS=true` only when deployed behind a reverse proxy that strips spoofed IP headers.  
**Never set in production:** `DEV_API_KEY`, `SKIP_CHAIN_READS`.

Deep health check: `GET /api/health?deep=1` with `Authorization: Bearer $ADMIN_SECRET` (development allows unauthenticated deep checks).

Dashboard uses **httpOnly session cookies only** (Bearer API keys are not accepted on dashboard routes).

Whitelist override: responses include `manualOverride: true` when **customer** WL/BL changed the outcome. Global operator blacklist is applied opaquely (`blockReason: operator_policy`, `signals.manual.list: none`). WL is **not applied** when sybil risk is `high`.

Customer WL/BL lists are shared across all API keys under the same owner account.

Score cache invalidation uses DB-backed epochs (`cache_epochs` table) so list changes propagate across serverless replicas.

After enabling `API_KEY_PEPPER`, recreate API keys (hashes change).

API keys are stored as SHA-256 hashes. Monthly quotas are enforced **per owner** (all API keys under the same account share one quota). Up to **10 active API keys** per owner.

| Plan | Monthly limit |
|---|---|
| free | 1,000 |
| pro | 50,000 |
| scale | 500,000 |

Responses include `X-RateLimit-Limit`, `X-RateLimit-Used`, and `X-RateLimit-Remaining` headers.

## Dashboard (M3)

```bash
npm run dev
# Open http://localhost:3000/dashboard
# Sign in with a database-backed API key (not DEV_API_KEY)
```

Dashboard features:
- **Overview** — monthly usage and plan quota
- **Lookup** — agent / wallet score search (counts against API quota)
- **WL/BL** — customer whitelist/blacklist + CSV import (max 500 rows)
- **Logs** — recent query history
- **API Keys** — create keys (inherits current plan only) and revoke

Sign-in uses httpOnly session cookies (API key is not stored in the browser).

**Signup:** `/signup` creates a free account + API key (invite code required when `BETA_INVITE_CODE` is set).

**Billing:** Dashboard → Billing (Stripe Checkout for Pro/Scale).

## Funder indexer (F-03)

Background job populates `funder_wallets` for sybil cluster detection (read-only from scoring path):

```bash
npm run indexer:funders
# or Vercel cron: GET /api/cron/index-funders (daily 04:00 UTC)
```

## Owner agent indexer (sybil F-03)

Indexes ERC-8004 `Registered` / `Transfer` events into `owner_agents` for `multi_agent_owner` sybil checks:

```bash
npm run indexer:owners
# or Vercel cron: GET /api/cron/index-owners (daily 05:00 UTC)
```

**Partial sync is supported** — scores ship while the indexer catches up. Responses include `dataCoverage.ownerIndexer` (`synced` only at tip; otherwise `partial` + `staleRisk`). Sybil `multi_agent_owner` uses ERC-721 `balanceOf` (authoritative) cross-checked with `max(index, balanceOf)`. Full catch-up can take weeks; do not gate product launch on it.

Monitor critical outages: `GET /api/cron/monitor-health` (503 = env/DB/RPC only). Indexer lag is reported in the payload without forcing 503.

## Log retention

`trust_events` are purged by plan: **90 days** (free) / **1 year** (pro, scale). Expired dashboard sessions and stale IP rate-limit buckets are also cleaned.

```bash
npm run cron:purge-logs
# or Vercel cron: GET /api/cron/purge-logs (daily 03:00 UTC)
```

## MCP Server (M4 / M7)

```bash
cd packages/mcp-server
npm install && npm run build
```

Tools: `check_agent_trust`, `check_wallet_trust`, `explain_trust_score`, `attest_x402_payment`

See [MCP setup](./docs/mcp-setup.md) for Cursor / Claude Desktop configuration.

## TypeScript SDK (M7)

```bash
cd packages/sdk && npm install && npm run build
```

```typescript
import { createVouchClient } from "@vouchscore/sdk";
```

## x402 sample middleware (M4)

```bash
cd examples/x402-trust-gate
npm install
export VOUCH_API_KEY=your_key
npm run demo
```

Express middleware that blocks `BLOCK` recommendations before serving paid routes. See [x402 integration guide](./docs/x402-integration.md).

## Project structure

```
src/
  app/api/v1/          # REST API routes
  app/docs/api/        # Hosted API reference page
  lib/
    chain/             # viem client, ERC-8004 reads, wallet metrics, agent resolver
    scoring/           # Score engine, sybil detection
    db/                # Drizzle schema
    api/               # Auth, rate limits (M2)
docs/
  quickstart.md
  mcp-setup.md
  x402-integration.md
  ecosystem-x402-foundation.md
  requirements-v0.1.md
  openapi.yaml
  brand.md
packages/
  mcp-server/          # MCP tools for Cursor / Claude
  sdk/                 # Thin TypeScript API client
examples/
  x402-trust-gate/     # Express middleware sample
```

## Milestones

| Phase | Status | Scope |
|---|---|---|
| M0 | ✅ Done | Base RPC, ERC-8004 reads, API skeleton |
| M1 | ✅ Done | Score engine v1, sybil standard, cache |
| M2 | ✅ Done | API keys, rate limits, DB persistence |
| M3 | ✅ Done | Dashboard, WL/BL |
| M4 | ✅ Done | MCP server, x402 sample, docs |
| M5 | ✅ Done | Closed β deploy, funder indexer, signup + Stripe, log retention |
| M6 | ✅ Done | x402 payment attestations + 10% score weight |
| M7 | ✅ Done | Parallel channels: SDK, MCP attest, settlements UI, API docs |

## License

Proprietary (private during development).
