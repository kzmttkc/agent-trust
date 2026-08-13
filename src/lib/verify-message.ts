// Canonical self-verification messages for payee + agent-passport registration.
//
// 2026-08-14 (軽-1B): these two builders used to be NON-HANDLER exports from
// route files (payees/verify/route.ts, agents/verify/route.ts). A Next.js App
// Router route module may only export route handlers plus a small set of segment
// config — a named helper export makes another route (agents/[agentId]/passport)
// import FROM a route, the exact same route-type contract violation that already
// forced isCanonicalName out to @/lib/validation/canonical-name. Both builders
// now live here, one source of truth, imported by the routes and the passport
// route alike.
//
// SECURITY (unchanged): each signed message is a FIXED set of newline-joined
// lines. A `name` containing a newline/CR/tab could forge an extra
// "wallet:"/"agentId:" line, so isCanonicalName is enforced at the schema layer
// by every caller AND here as a defense-in-depth backstop — the throw guarantees
// a non-canonical name can never be folded into a canonical message even via a
// future caller.
import { isCanonicalName } from "@/lib/validation/canonical-name";

/**
 * The exact message a payee signs with its receiving wallet. A valid signature
 * over this text IS the proof of control (EIP-191 via viem). Four fixed lines.
 */
export function payeeMessage(wallet: string, name: string): string {
  if (!isCanonicalName(name)) {
    throw new Error("payeeMessage: non-canonical name would break the 4-line canonical message");
  }
  return [
    "Vouch verified payee registration",
    `wallet: ${wallet.toLowerCase()}`,
    `name: ${name}`,
    "This signature only proves control of the wallet above.",
  ].join("\n");
}

/**
 * The exact message an agent signs with the wallet getAgentWallet(agentId)
 * returns on-chain. The signature proves control of that wallet; the on-chain
 * lookup proves the wallet IS the agent's. Five fixed lines.
 */
export function agentPassportMessage(agentId: bigint, wallet: string, name: string): string {
  if (!isCanonicalName(name)) {
    throw new Error("agentPassportMessage: non-canonical name would break the 5-line canonical message");
  }
  return [
    "Vouch agent passport registration",
    `agentId: ${agentId.toString()}`,
    `wallet: ${wallet.toLowerCase()}`,
    `name: ${name}`,
    "This signature only proves control of the wallet above.",
  ].join("\n");
}
