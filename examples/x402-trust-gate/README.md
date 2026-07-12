# x402 Trust Gate (sample)

Express middleware that calls **Vouch** before serving paid x402 API routes.

## Flow

```
Client → x402 payment (@x402/express) → Vouch trust gate → your route handler
```

1. x402 middleware verifies payment and sets `req.payer`
2. Vouch trust gate fetches `GET /v1/wallets/{payer}/score`
3. `BLOCK` → HTTP 403 before your handler runs
4. `ALLOW` / `WARN` → request continues

## Quick demo (no x402 deps)

```bash
cd examples/x402-trust-gate
npm install

# Terminal 1: Vouch API
cd ../.. && npm run dev

# Terminal 2: demo server
export VOUCH_API_KEY=your_key
npm run demo

# Test with a wallet
curl -H "x-payer-wallet: 0x1234567890123456789012345678901234567890" \
  http://localhost:4020/api/premium/data
```

## Production integration with @x402/express

```typescript
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { createVouchTrustGate } from "./middleware";

const app = express();

// 1. x402 payment verification (sets req.payer after valid payment)
app.use(paymentMiddleware(routes, resourceServer));

// 2. Vouch trust gate — mount on paid routes only
const trustGate = createVouchTrustGate({
  apiUrl: process.env.VOUCH_API_URL!,
  apiKey: process.env.VOUCH_API_KEY!,
  rejectOn: ["BLOCK"], // optionally include "WARN"
});

app.use("/api/premium", trustGate);

app.get("/api/premium/data", (req, res) => {
  res.json({ data: "secret", payer: req.payer, trust: req.vouchTrust });
});
```

## Configuration

| Env | Description |
|---|---|
| `VOUCH_API_URL` | Vouch API base (default `http://localhost:3000/api/v1`) |
| `VOUCH_API_KEY` | Your Vouch API key |
| `rejectOn` | Recommendations to block (`["BLOCK"]` default) |

## WARN handling

x402 providers often want to allow WARN with rate limits:

```typescript
createVouchTrustGate({
  apiUrl: process.env.VOUCH_API_URL!,
  apiKey: process.env.VOUCH_API_KEY!,
  rejectOn: ["BLOCK"],
});

// In route handler for WARN agents:
if (req.vouchTrust?.recommendation === "WARN") {
  // apply stricter rate limit or require human approval
}
```

See [x402 integration guide](../../docs/x402-integration.md) for the full playbook.
