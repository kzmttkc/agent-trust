import { type GateDecision, type VouchGateConfig, type X402PaymentAttestation } from "./core.js";
type ExpressResponse = {
    status(code: number): ExpressResponse;
    json(body: unknown): unknown;
};
type ExpressNext = (err?: unknown) => void;
export type ExpressGateOptions<Req extends object> = VouchGateConfig & {
    /** Extract the counterparty address from the (already payment-verified) request. */
    getAddress: (req: Req) => string | undefined;
    /** Property the decision is attached to on the request. Default "vouchTrust". */
    attachAs?: string;
    /** HTTP status used when the gate blocks. Default 403. */
    blockStatus?: number;
    /**
     * Called for a WARN verdict (request still proceeds). Only reachable when
     * `policy` opts out of the ALLOW-only default ("block-only" or "custom") —
     * the default blocks WARN before this ever fires.
     */
    onWarn?: (decision: GateDecision, req: Req) => void;
    /**
     * When set, a successful (allowed/warned) request attests the settlement
     * back to Vouch. Return undefined to skip an individual request.
     */
    getAttestation?: (req: Req) => X402PaymentAttestation | undefined;
};
/**
 * Express middleware: score the counterparty, block anything that is not
 * ALLOW (fail-closed default; opt out via `policy`), attach the decision,
 * otherwise call next(). Three lines to mount:
 *
 *   app.use("/api/paid", createExpressGate({
 *     apiUrl: process.env.VOUCH_API_URL!, apiKey: process.env.VOUCH_API_KEY!,
 *     getAddress: (req) => req.payer,
 *   }));
 */
export declare function createExpressGate<Req extends object = Record<string, unknown>>(options: ExpressGateOptions<Req>): (req: Req, res: ExpressResponse, next: ExpressNext) => Promise<void>;
export {};
