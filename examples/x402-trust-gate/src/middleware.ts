import type { NextFunction, Request, Response } from "express";
import {
  fetchWalletTrustScore,
  shouldReject,
  type TrustScoreResult,
  type VouchTrustGateConfig,
} from "./vouch-client.js";

export type VouchEnabledRequest = Request & {
  payerWallet?: string;
  vouchTrust?: TrustScoreResult;
};

export type TrustGateOptions = VouchTrustGateConfig & {
  /** Required in production: extract payer wallet from x402-verified request only. */
  getWallet: (req: Request) => string | undefined;
};

/**
 * Express middleware that checks Vouch trust before serving a paid x402 route.
 * Mount AFTER x402 payment verification so `req.payer` is populated.
 *
 * You MUST provide `getWallet` — there is no header fallback in production middleware.
 */
export function createVouchTrustGate(options: TrustGateOptions) {
  const rejectOn = options.rejectOn ?? ["BLOCK"];

  return async (req: VouchEnabledRequest, res: Response, next: NextFunction) => {
    const wallet = options.getWallet(req);
    if (!wallet) {
      return res.status(400).json({ error: "missing_payer_wallet" });
    }

    try {
      const trust = await fetchWalletTrustScore(wallet, options);
      req.payerWallet = wallet;
      req.vouchTrust = trust;

      if (shouldReject(trust.recommendation, rejectOn)) {
        return res.status(403).json({
          error: "trust_rejected",
          recommendation: trust.recommendation,
          trustScore: trust.trustScore,
          wallet,
          agentId: trust.agentId,
        });
      }

      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : "trust_check_failed";
      console.error("[vouch-trust-gate]", message);
      return res.status(502).json({ error: "trust_check_failed" });
    }
  };
}

/** Demo-only helper: reads x-payer-wallet header. Never use without prior payment verification. */
export function demoWalletFromHeader(req: Request): string | undefined {
  const header = req.headers["x-payer-wallet"];
  return typeof header === "string" && header.length > 0 ? header : undefined;
}
