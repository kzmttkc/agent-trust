# @vouch/sdk

Thin TypeScript client for the Vouch Trust API.

```bash
cd packages/sdk && npm install && npm run build
```

```typescript
import { createVouchClient } from "@vouch/sdk";

// apiUrl below is the current production deployment. A custom domain
// (e.g. api.vouch.dev) is not registered yet — swap this in once it is.
const vouch = createVouchClient({
  apiUrl: "https://agent-trust-tawny.vercel.app/api/v1",
  apiKey: process.env.VOUCH_API_KEY!,
});

const score = await vouch.getWalletScore("0x...");
await vouch.attestX402Payment({
  wallet: "0x...",
  txHash: "0x...",
  resource: "/api/premium/data",
});
```

Methods: `getAgentScore`, `getWalletScore`, `batchScore`, `attestX402Payment`.

See [OpenAPI](../../docs/openapi.yaml) and [x402 integration](../../docs/x402-integration.md).
