# Quickstart

Get Vouch running locally in under 5 minutes.

## 1. Install

```bash
git clone <repo> agent-trust
cd agent-trust
cp .env.example .env.local
npm install
```

## 2. Configure `.env.local`

```bash
DEV_API_KEY=dev_local_key_change_me
BASE_RPC_URL=https://mainnet.base.org
# Optional for full features:
# DATABASE_URL=postgresql://...
```

## 3. Run

```bash
npm run dev
```

## 4. Test the API

```bash
export DEV_API_KEY=dev_local_key_change_me

# Health
curl http://localhost:3000/api/health

# Score an agent
curl -H "Authorization: Bearer $DEV_API_KEY" \
  http://localhost:3000/api/v1/agents/1/score

# Score by wallet (x402 path)
curl -H "Authorization: Bearer $DEV_API_KEY" \
  http://localhost:3000/api/v1/wallets/0x1234567890123456789012345678901234567890/score
```

## 5. Production setup (database)

```bash
# Set DATABASE_URL in .env.local, then push schema (includes cache_epochs, owner_usage, ip_rate_limits)
npm run db:push
npm run api-key:create -- --plan free --name "my app"
```

Use the printed `vouch_live_...` key instead of `DEV_API_KEY`.

Behind a reverse proxy in production, set `TRUST_PROXY_HEADERS=true`.

## 6. Dashboard

Open http://localhost:3000/dashboard and sign in with your database API key.

## 7. MCP (Cursor)

```bash
cd packages/mcp-server && npm install && npm run build
```

Add to Cursor MCP config — see [mcp-setup.md](./mcp-setup.md).

## 8. x402 integration

See [x402-integration.md](./x402-integration.md) and `examples/x402-trust-gate/`.

## Score interpretation

| Score | Recommendation | Meaning |
|---|---|---|
| ≥ 70 | `ALLOW` | Proceed with API access |
| 40–69 | `WARN` | Extra scrutiny recommended |
| < 40 | `BLOCK` | Reject or require manual review |

Customer whitelist can override WARN → ALLOW. Blacklist always → BLOCK.

## Links

- [OpenAPI spec](./openapi.yaml)
- [Requirements v0.1](./requirements-v0.1.md)
- [Brand / naming](./brand.md)
