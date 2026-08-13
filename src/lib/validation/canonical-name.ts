// Canonical payee/agent name validation.
//
// 2026-08-14: extracted from src/app/api/v1/payees/verify/route.ts. A Next.js
// App Router route file may only export route handlers (GET/POST/...) plus a
// small set of segment config exports; a named helper export (isCanonicalName)
// made /api/v1/agents/verify import from another route, violating the Next 16
// route-type contract (the webpack build type check stops on it). Moving the
// pure validator to lib is one source of truth and satisfies the contract
// without changing behavior.
//
// Public, display-facing bound on the payee name. 64 chars fits every real
// business/agent name while capping the reflected string on /payee/:address
// and badge/OG surfaces.
export const NAME_MAX_LENGTH = 64;

// 2026-08-06 security (message canonicalization). The signed message is a
// fixed 4 newline-joined lines. A name containing a newline/CR/tab would forge
// extra lines into the canonical text; rejecting any non-canonical name makes
// the 4-line invariant structural. We also reject C0 (0x00-0x1f) and C1/DEL
// (0x7f-0x9f) control characters that never belong in a display name. Checked
// by code point (not a control-char regex literal) so the source stays clean.
export function isCanonicalName(name: string): boolean {
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return false;
  // Reject leading/trailing whitespace so stored/displayed/signed forms match.
  if (name !== name.trim()) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return false;
  }
  return true;
}
