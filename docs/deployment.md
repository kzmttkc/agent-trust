# Deployment Guide — Closed & Public Beta

Deploy Vouch to **Vercel** with **Neon PostgreSQL**.

## 1. Prerequisites

- GitHub repository connected to Vercel
- [Neon](https://neon.tech) project (PostgreSQL)
- Base RPC URL (Alchemy / QuickNode recommended for production)
- Optional: Blockscout API key for wallet metrics

## 2. Database setup

```bash
# Local, against Neon connection string
export DATABASE_URL="postgresql://..."
npm run db:push
```

Creates all tables including `cache_epochs`, `owner_usage`, `ip_rate_limits`, `accounts`, `funder_wallets`.

## 3. Generate secrets

```bash
openssl rand -hex 32   # API_KEY_PEPPER
openssl rand -hex 32   # DASHBOARD_SESSION_SECRET
openssl rand -hex 32   # ADMIN_SECRET
openssl rand -hex 32   # CRON_SECRET
```

## 4. Vercel environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `APP_ENV` | Yes | `production` |
| `DATABASE_URL` | Yes | Neon pooled connection string |
| `API_KEY_PEPPER` | Yes | min 32 chars; also seals webhook signing secrets at rest unless `WEBHOOK_SECRET_KEK` is set |
| `WEBHOOK_SECRET_KEK` | No | dedicated webhook-secret encryption key; prefer this over sharing the pepper |
| `WEBHOOK_SECRET_KEK_PREVIOUS` | No | previous webhook KEK during rotation; deliveries reopen then reseal onto `WEBHOOK_SECRET_KEK` |
| `DASHBOARD_SESSION_SECRET` | Yes | min 32 chars |
| `ADMIN_SECRET` | Yes | global blacklist admin |
| `CRON_SECRET` | Yes | Vercel cron auth (min 32 chars) |
| `BASE_RPC_URL` | Yes | Base mainnet RPC |
| `PROXY_HEADER_SOURCE` | Yes | `vercel` on Vercel. `generic` only behind a proxy that rewrites XFF. `none` otherwise |
| `TRUST_PROXY_HEADERS` | Deprecated | superseded by `PROXY_HEADER_SOURCE`; still inferred from, warns |
| `TRUST_GENERIC_FORWARDED_FOR` | Deprecated | superseded by `PROXY_HEADER_SOURCE=generic` |
| `BLOCKSCOUT_API_URL` | Recommended | `https://base.blockscout.com/api` |
| `BLOCKSCOUT_API_KEY` | Optional | higher rate limits |
| `BETA_INVITE_CODE` | Closed β | omit for public β |
| `STRIPE_SECRET_KEY` | Public β | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Public β | webhook signing secret |
| `STRIPE_PRICE_PRO` | Public β | Stripe Price ID |
| `STRIPE_PRICE_SCALE` | Public β | Stripe Price ID |
| `NEXT_PUBLIC_APP_URL` | Public β | `https://your-domain.com` |

**Never set in production:** `DEV_API_KEY`, `SKIP_CHAIN_READS`.

## 5. Deploy

```bash
# Verify env locally before first deploy (all production required vars)
APP_ENV=production \
  DATABASE_URL=... API_KEY_PEPPER=... \
  DASHBOARD_SESSION_SECRET=... ADMIN_SECRET=... CRON_SECRET=... \
  BASE_RPC_URL=https://... PROXY_HEADER_SOURCE=vercel \
  npm run check:env

# Push to main — Vercel auto-deploys
git push origin main
```

## 6. Post-deploy checklist

```bash
# Health
curl https://your-domain.com/api/health

# Deep health (admin)
curl -H "Authorization: Bearer $ADMIN_SECRET" \
  "https://your-domain.com/api/health?deep=1"

# Create first API key (CLI against Neon)
npm run api-key:create -- --plan free --name "ops"

# Or use /signup (public β) / invite-gated signup (closed β)
```

## 7. Cron jobs

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/index-funders` | daily 04:00 UTC | Populate `funder_wallets` |
| `/api/cron/index-owners` | daily 05:00 UTC | Index `owner_agents` for sybil `multi_agent_owner` |
| `/api/cron/purge-logs` | daily 03:00 UTC | Delete expired `trust_events` (90d free / 1y pro+), sessions, rate-limit buckets |
| `/api/cron/monitor-health` | daily 06:00 UTC | Deep health probe; **503 only** on env/DB/RPC failure (indexer lag is informational). For sub-daily checks use an external uptime monitor (Hobby forbids hourly crons). |

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set in project env.

## 7.1 Monitoring & alerts

Production boot validates **all** required env vars (`BASE_RPC_URL`, `CRON_SECRET`, `PROXY_HEADER_SOURCE`, etc.) via `assertProductionConfig()` — same rules as `npm run check:env`.

`PROXY_HEADER_SOURCE` names WHICH forwarded-IP header may be believed, because "there is a proxy in front of me" and "that proxy is Vercel" are different claims (2026-08-22 audit: off Vercel, `x-vercel-forwarded-for` is client-settable, so trusting it made every per-IP rate limit bypassable). `vercel` off Vercel is a **boot error**; an unset/uninferable value degrades to `none` — one shared bucket, no per-IP limits — with a warning.

**Deep health** (always requires `ADMIN_SECRET`):

```bash
curl -H "Authorization: Bearer $ADMIN_SECRET" \
  "https://your-domain.com/api/health?deep=1"
```

Response includes `checks.env`, `checks.owner_indexer` (`ok` | `partial` | `lagging`), and `indexer.blocksBehind` / `liveTip`. HTTP **503** only when `criticalFailure` (env / database / rpc). Indexer catch-up alone returns **200** so uptime monitors are not trained to ignore alerts for weeks.

**Scheduled probe** (Vercel cron daily 06:00 UTC on Hobby, or external uptime every N minutes with `CRON_SECRET`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.com/api/cron/monitor-health
```

Wire an external uptime monitor to alert on **503**. Optionally alert separately on `checks.owner_indexer === "lagging"` without treating it as an outage.

**Free option (no paid uptime plan):** [UptimeRobot](https://uptimerobot.com) free tier, or cron from a home/laptop:

```bash
# Optional local / CI smoke (Hobby-safe)
./scripts/smoke-production.sh
CRON_SECRET=... ./scripts/smoke-production.sh
```

Indexer lag flag threshold: `HEALTH_INDEXER_LAG_BLOCKS` (default `500000`). Scores remain available during partial sync; API responses include `dataCoverage.ownerIndexer` (`synced` | `partial`, plus `staleRisk`) and `dataCoverage.settlement` (attested x402 payment volume).

Settlement write-back (Phase 1.5):

```bash
curl -X POST -H "Authorization: Bearer $VOUCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0x...","txHash":"0x..."}' \
  https://your-domain.com/api/v1/payments/x402
```

Schema patch (if upgrading an existing DB): `scripts/sql/2026-07-14-x402-payments.sql`

Schema patch (optional, funder indexer cooldown cache): `scripts/sql/2026-07-14-funder-index-skips.sql`. This table is an optional cache — `collectWalletsToIndex` / `recordFunderIndexSkip` / `clearFunderIndexSkip` all catch DB errors from it and degrade to the pre-cache behavior (no cooldown filtering, every candidate wallet rescanned each run) if the DDL hasn't been applied. The indexer stays fully functional without it; applying the patch only makes repeated failed-lookup wallets skip re-scanning for a while.

Partial ownership index: sybil `multi_agent_owner` uses ERC-721 `balanceOf` (not truncated log scans) cross-checked with the DB index.

Manual run:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.com/api/cron/index-funders

curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.com/api/cron/purge-logs
```

Local CLI:

```bash
npm run indexer:funders
npm run indexer:owners
npm run cron:purge-logs
```

## 8. Closed beta (invite-only)

Set `BETA_INVITE_CODE` in Vercel. Users must enter the code on `/signup`.

Distribute keys manually via:

```bash
npm run api-key:create -- --plan free --name "beta-user-1"
```

## 9. Public beta (Stripe)

1. Create Products/Prices in Stripe for Pro ($49) and Scale ($199)
2. Set `STRIPE_PRICE_PRO` and `STRIPE_PRICE_SCALE`
3. Add webhook endpoint: `https://your-domain.com/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Users sign up at `/signup`, upgrade from Dashboard → Billing

## 10. Admin operations

```bash
# Global blacklist
curl -X POST https://your-domain.com/api/admin/global-lists \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0x...","listType":"blacklist"}'
```
