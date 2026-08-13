import { type GateDecision, type VouchGateConfig, type X402PaymentAttestation } from "./core.js";
type HonoContext = {
    json(body: unknown, status?: number): Response;
    set(key: string, value: unknown): void;
};
type HonoNext = () => Promise<void>;
export type HonoGateOptions<Ctx extends HonoContext> = VouchGateConfig & {
    /** Extract the counterparty address from the (payment-verified) context. */
    getAddress: (c: Ctx) => string | undefined;
    /** Context variable the decision is stashed under (c.get(...)). Default "vouchTrust". */
    setAs?: string;
    /** HTTP status used when the gate blocks. Default 403. */
    blockStatus?: number;
    /**
     * Called for a WARN verdict (request still proceeds). Only reachable when
     * `policy` opts out of the ALLOW-only default ("block-only" or "custom") —
     * the default blocks WARN before this ever fires.
     */
    onWarn?: (decision: GateDecision, c: Ctx) => void;
    /** Optional: attest the settlement after an allowed/warned request. */
    getAttestation?: (c: Ctx) => X402PaymentAttestation | undefined;
};
/**
 * Hono middleware. Returns a blocking Response on anything that is not ALLOW
 * (fail-closed default; opt out via `policy`) or calls next(). Three lines
 * to mount:
 *
 *   app.use("/api/paid/*", createHonoGate({
 *     apiUrl: process.env.VOUCH_API_URL!, apiKey: process.env.VOUCH_API_KEY!,
 *     getAddress: (c) => c.get("payer"),
 *   }));
 */
export declare function createHonoGate<Ctx extends HonoContext = HonoContext>(options: HonoGateOptions<Ctx>): (c: Ctx, next: HonoNext) => Promise<Response | void>;
export {};
