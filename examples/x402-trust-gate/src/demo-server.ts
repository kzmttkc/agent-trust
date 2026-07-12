import express from "express";
import { createVouchTrustGate, demoWalletFromHeader } from "./middleware.js";

const app = express();
const port = Number(process.env.PORT ?? 4020);
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.VOUCH_API_KEY) {
  console.error("VOUCH_API_KEY is required");
  process.exit(1);
}

const trustGate = createVouchTrustGate({
  apiUrl: process.env.VOUCH_API_URL ?? "http://localhost:3000/api/v1",
  apiKey: process.env.VOUCH_API_KEY,
  rejectOn: ["BLOCK"],
  getWallet: (req) => {
    const payer = (req as express.Request & { payer?: string }).payer;
    if (payer) return payer;
    if (isProduction) return undefined;
    return demoWalletFromHeader(req);
  },
});

app.use("/api/premium", trustGate);

app.get("/api/premium/data", (req, res) => {
  const extended = req as express.Request & { vouchTrust?: { trustScore: number } };
  res.json({
    message: "Premium data unlocked",
    trustScore: extended.vouchTrust?.trustScore,
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.error(`x402 trust gate demo listening on http://localhost:${port}`);
  if (!isProduction) {
    console.error("Demo only: x-payer-wallet header simulates x402 payer after payment.");
  }
});
