import { type GateDecision, type VouchGateConfig, type X402PaymentAttestation } from "./core.js";
export type NextGateOptions = VouchGateConfig & {
    /** HTTP status used when the gate blocks. Default 403. */
    blockStatus?: number;
};
export type NextGate = {
    /**
     * Evaluate an address. Returns the decision plus a ready-to-return blocking
     * Response (or null when the request may proceed). Lets a handler do:
     *
     *   const { decision, response } = await gate.check(payer);
     *   if (response) return response;   // 403, fail-closed
     */
    check(address: string): Promise<{
        decision: GateDecision;
        response: Response | null;
    }>;
    attest(attestation: X402PaymentAttestation): Promise<boolean>;
};
export declare function createNextGate(options: NextGateOptions): NextGate;
export type WithVouchGateOptions<Req extends Request> = NextGateOptions & {
    /** Extract the counterparty address from the (payment-verified) request. */
    getAddress: (req: Req) => string | undefined | Promise<string | undefined>;
    /** Optional: attest the settlement after an allowed/warned request. */
    getAttestation?: (req: Req, decision: GateDecision) => X402PaymentAttestation | undefined;
};
/**
 * Wrap an App Router handler so anything that is not ALLOW short-circuits
 * with 403 before your handler runs (fail-closed default; opt out via
 * `policy`). The decision is passed as the second argument.
 *
 *   export const POST = withVouchGate(
 *     { apiUrl: process.env.VOUCH_API_URL!, apiKey: process.env.VOUCH_API_KEY!,
 *       getAddress: (req) => new URL(req.url).searchParams.get("payer") ?? undefined },
 *     async (req, trust) => Response.json({ ok: true, trust }),
 *   );
 */
export declare function withVouchGate<Req extends Request>(options: WithVouchGateOptions<Req>, handler: (req: Req, decision: GateDecision) => Response | Promise<Response>): (req: Req) => Promise<Response>;
