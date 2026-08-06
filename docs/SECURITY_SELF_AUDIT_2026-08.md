# Vouch — Internal Security Self-Audit (2026-08)

**This is an INTERNAL self-audit, not an external penetration test.** It was
performed by the same engineering effort that hardened these paths, taking a
deliberate attacker's-eye second pass after the fixes landed. It is not a
substitute for a third-party pentest — see "Residuals for external pentest" at
the end. Do **not** represent Vouch as "externally audited" on the basis of
this document.

- Scope: the security layer and user-facing surfaces (key-less public API
  paths, dashboard auth, signup/login, webhooks, CSP, information exposure).
- Method: after implementing the fixes below, re-walk each attack surface as an
  attacker would, from the boundary inward.
- Commit context: the fixes referenced here were committed 2026-08-06 (see the
  `fix(vouch): harden key-less API paths …` commit and the follow-ups).

---

## Fixed in this pass

### 1. Rate-limit visibility on key-less paths (was: invisible / absent)
- **Before:** `GET /api/v1/payees/verify` had no rate limit; `POST` returned a
  bare `429` with no `RateLimit-*`/`Retry-After`; `/api/badge/:address` had no
  limit. A signature proves wallet control but wallets are free to mint, so the
  signature is not a cost barrier — public `/payee` profiles and badges could be
  mass-produced (namespace pollution, DB bloat).
- **Fix:** `consumeIpRateLimit` now returns `{limit, remaining, resetAt}` and a
  new `ipRateLimitHeaders()` emits standard `RateLimit-Limit/Remaining/Reset`
  (plus `Retry-After` on throttle) on **every** response of the key-less paths
  (`payees/verify` GET+POST, `badge`, `demo/score`, `accuracy`). `POST verify`
  additionally enforces a **per-wallet** write throttle, so one wallet cannot
  hot-loop its public profile even across many IPs.

### 2. Signed-message canonicalization (was: line-injection)
- **Before:** the payee registration message is documented as a fixed 4 lines,
  newline-joined. A `name` containing `\n`/`\r`/`\t` forged extra lines — e.g.
  `name = "Acme\nwallet: 0xEVIL"` produced a message with a second `wallet:`
  line that a line-oriented parser mis-attributes. `GET` and `POST` could also
  disagree if only one side sanitized.
- **Fix:** `isCanonicalName()` rejects control characters (U+0000–001F incl.
  newline/CR/tab, DEL, C1), enforces trim and a 64-char cap, and is applied at
  the zod schema layer for POST **and** the GET preview. `payeeMessage()` throws
  on a non-canonical name — defense in depth so no future caller can fold a
  malicious name into the signed bytes. Covered by `tests/payee-verify.test.ts`.

### 3. Payee `name` input validation
- Length cap (64), control-character rejection, and required trim — the same
  `isCanonicalName` gate. `name` is reflected on the public `/payee/:address`
  page (React auto-escapes, so no stored XSS today) and is the natural input for
  future display surfaces; bounding it at the write boundary is the durable fix.

### 4. `/api/health` version/detail suppression
- **Before:** the unauthenticated probe returned `version: "0.1.0"`, `chain`,
  `erc8004` — fingerprinting material, and a `0.1.0` visible to prospects.
- **Fix:** unauthenticated response is now `{status:"ok"}` only. Service
  metadata moved behind the existing admin-gated `?deep=1` path.

---

## Attack surfaces reviewed (no change required)

- **Authorization boundaries.** Dashboard mutations go through
  `authorizeDashboardRequest` (httpOnly session cookie + same-origin check +
  quota). API v1 routes authenticate by API key. Per-resource writes I sampled
  scope by `apiKeyId` (`deleteWebhook`, list/webhook `[id]` routes). No bypass
  found in the sampled routes. (Exhaustive per-`[id]` ownership fuzzing is left
  to the external pentest.)
- **Webhook SSRF.** `isSafeWebhookUrl` enforces https-only, rejects
  credentials-in-URL, IPv6 literals, and IPv4 private/reserved/CGNAT/link-local
  ranges and internal suffixes; delivery uses `redirect: "error"`, a hard
  timeout, and **re-validates the URL at delivery time**. Signature is
  Stripe-style HMAC-SHA256 over `${t}.${body}`, verified with `timingSafeEqual`
  and a replay tolerance. Solid against the string-level vectors. (DNS
  rebinding residual noted below.)
- **Signature verification.** Payee proof via viem `verifyMessage` (EIP-191/6492)
  over the now-canonical message; admin via `secureCompare`; webhook via
  constant-time HMAC. No timing or canonicalization gaps found post-fix.
- **CSP.** Per-request nonce + `strict-dynamic`, `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. The new Server
  Actions post same-origin, consistent with `form-action 'self'`.
- **Information exposure.** Error responses are fixed generic codes; server
  errors go through `logServerError`, not the response. `/api/health` minimized
  (above).

---

## Residuals for external penetration test (Takeshi手番)

An external, contracted pentest remains a paid engagement and is Takeshi's call.
The following are the highest-value items for it, honestly flagged:

1. **Webhook DNS rebinding (SSRF, string-guard limit).** `isSafeWebhookUrl`
   validates the URL **string**, not the **resolved IP**. A public hostname the
   attacker controls can resolve to a private/link-local address (e.g.
   `169.254.169.254`) at delivery time and pass every check. A robust fix
   requires resolving the hostname and pinning the connection to a
   validated public IP (custom fetch/agent), which the current serverless fetch
   runtime does not expose cleanly — hence flagged rather than patched here.
   High priority for the external test.
2. **Exhaustive per-resource authorization fuzzing** across every `/api/v1/**/[id]`
   route (watchlist, webhooks, events/outcome) for horizontal privilege
   escalation between API keys / owners.
3. **Rate-limit correctness under multi-instance serverless.** The in-memory
   fallback is per-instance; production fails closed without a DB, but the
   DB-backed limiter's behavior under high concurrency (the atomic upsert path)
   deserves load-level verification.
4. **`style-src 'unsafe-inline'`** remains (Tailwind/inline styles). Low risk,
   but a CSP-focused reviewer should confirm no inline-style injection sink.
5. **Session/cookie lifecycle**: fixation, rotation on privilege change, and
   logout completeness across the `dashboard_sessions` table.

---

_Last updated 2026-08-06. Internal self-audit only._
