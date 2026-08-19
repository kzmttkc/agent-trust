// ============================================================
// vet402 Observatory — operator (self) identity.
//
// vet402 will itself be listed in the public x402 catalog once the self-listing
// endpoint ships (WO(c)). Two things must then hold, and both trace back to one
// question — "is this payTo our own?":
//   1. the L1 buyer must never purchase from our own payTo (an on-chain
//      self-transfer dressed up as a "settle-through verified" receipt would
//      make the neutrality that is the whole moat a lie) — enforced in
//      l1-runner via this denylist;
//   2. the public read surfaces must MARK our own endpoint as the operator's
//      and exclude it from the aggregate rates, so vet402 is never counted as a
//      neutral third party in its own measurements — enforced in reader.ts.
//
// Kept in this dependency-light module (no signing / fetch / drizzle imports)
// so the public read path can ask "is this ours?" without pulling the whole L1
// purchasing stack into a page render.
//
// Set VET402_OPERATOR_PAYTO to a comma-separated address list; empty (today's
// default) is a safe no-op everywhere. Addresses are lowercased so the check is
// case-insensitive.
// ============================================================

export function operatorPayToDenylist(): string[] {
  return (process.env.VET402_OPERATOR_PAYTO ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.length > 0);
}

/** True iff `payTo` is an operator-controlled (vet402's own) receiving address. */
export function isOperatorPayTo(payTo: string | null | undefined): boolean {
  if (!payTo) return false;
  return operatorPayToDenylist().includes(payTo.toLowerCase());
}
