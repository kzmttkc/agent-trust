// @vouchscore/middleware — drop-in x402 transaction gate.
//
// The framework-agnostic core is the default export surface. Per-framework
// adapters live at their own subpaths so importing one never drags in the
// others' (structural) types:
//   import { createExpressGate } from "@vouchscore/middleware/express";
//   import { withVouchGate }     from "@vouchscore/middleware/next";
//   import { createHonoGate }    from "@vouchscore/middleware/hono";
export { createTrustGate, VouchGateError, DEFAULT_MAX_SCORE_AGE_MS, } from "./core.js";
