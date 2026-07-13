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
| `API_KEY_PEPPER` | Yes | min 32 chars |
| `DASHBOARD_SESSION_SECRET` | Yes | min 32 chars |
| `ADMIN_SECRET` | Yes | global blacklist admin |
| `CRON_SECRET` | Yes | Vercel cron auth (min 32 chars) |
| `BASE_RPC_URL` | Yes | Base mainnet RPC |
| `TRUST_PROXY_HEADERS` | Yes | `true` on Vercel |
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
# Verify env locally before first deploy
APP_ENV=production DATABASE_URL=... API_KEY_PEPPER=... \
  DASHBOARD_SESSION_SECRET=... ADMIN_SECRET=... CRON_SECRET=... \
  npx tsx scripts/check-production-env.ts

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

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set in project env.

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
