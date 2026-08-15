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

const URL_MAX_LENGTH = 200;

/**
 * Profile URLs that may be folded into a signed message. Same control-char
 * refusal as isCanonicalName, plus https-only and a hard length cap, so a
 * preview GET cannot 500 by throwing from the message builder.
 */
export function isSafeBoundUrl(url: string): boolean {
  if (!/^https:\/\//.test(url) || url.length > URL_MAX_LENGTH) return false;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return false;
  }
  return !url.includes("\u2028") && !url.includes("\u2029");
}

function assertSafeUrlLine(url: string, label: string): void {
  if (!isSafeBoundUrl(url)) {
    throw new Error(`${label}: non-canonical url would break the canonical message`);
  }
}

/**
 * The exact message a payee signs with its receiving wallet. A valid signature
 * over this text IS the proof of control (EIP-191 via viem). Four fixed lines,
 * or five when a profile URL is bound into the signature.
 */
export function payeeMessage(wallet: string, name: string, url?: string): string {
  if (!isCanonicalName(name)) {
    throw new Error("payeeMessage: non-canonical name would break the 4-line canonical message");
  }
  const lines = [
    "Vouch verified payee registration",
    `wallet: ${wallet.toLowerCase()}`,
    `name: ${name}`,
  ];
  if (url) {
    assertSafeUrlLine(url, "payeeMessage");
    lines.push(`url: ${url}`);
  }
  lines.push("This signature only proves control of the wallet above.");
  return lines.join("\n");
}

/**
 * The exact message a payee signs to route observatory delisting alerts for
 * endpoints paying `wallet` to the webhooks of api key `apiKeyId`. The
 * signature proves control of the receiving wallet (same EIP-191 gate as
 * payee registration); the api key comes from the authenticated request, so
 * the pair is bound by two independent proofs. Four fixed lines; wallet is
 * lowercased and apiKeyId is a server-issued uuid, so no canonical-name
 * injection surface exists here.
 */
export function observatoryWatchMessage(wallet: string, apiKeyId: string): string {
  return [
    "vet402 observatory watch registration",
    `wallet: ${wallet.toLowerCase()}`,
    `apiKey: ${apiKeyId}`,
    "This signature authorizes delisting notifications for endpoints paying the wallet above.",
  ].join("\n");
}

export function agentPassportMessage(
  agentId: bigint,
  wallet: string,
  name: string,
  url?: string,
): string {
  if (!isCanonicalName(name)) {
    throw new Error("agentPassportMessage: non-canonical name would break the 5-line canonical message");
  }
  const lines = [
    "Vouch agent passport registration",
    `agentId: ${agentId.toString()}`,
    `wallet: ${wallet.toLowerCase()}`,
    `name: ${name}`,
  ];
  if (url) {
    assertSafeUrlLine(url, "agentPassportMessage");
    lines.push(`url: ${url}`);
  }
  lines.push("This signature only proves control of the wallet above.");
  return lines.join("\n");
}
