# vet402 — product glossary

Public copy is English. Two products share one site. Do not mix their units.

## Worlds

| Surface | What it is | Account |
|---|---|---|
| Observatory | Catalog measurements L0–L2 (pass / fail / unverified). Public. | None |
| Payee lookup (`/payee`) | Buyer-side 0–100 ALLOW / WARN / BLOCK for a receiving wallet. Public. | None |
| Score API | The same 0–100 engine, sold by lookup quota. | Key from `/signup`; paid upgrade on dashboard Billing |

A score is never reported as an L0–L2 result. Observatory cells are never 0–100 scores.

## Verbs

| Verb | Means | Does not mean |
|---|---|---|
| **Verify** | Public payee lookup (`/payee`), or a signed wallet-control claim (`POST /api/v1/payees/verify`). | Observatory L0–L2. Scoring an agent on the leaderboard. |
| **Score** | The 0–100 ALLOW / WARN / BLOCK API (payee, wallet, or agent). | A catalog measurement. |
| **Observatory** | Daily catalog facts: L0 liveness, L1 settle-through (endpoint pages), L2 conformance. | A ranking or a score. |
| **Lookup** | Dashboard form that runs the same payee score as `/payee` (wallet) or the payer engine (agent ID). | Observatory search. |
| **Get an API key** | Signup for programmatic score lookups. | Access to the observatory or `/payee`. |
| **Sign in** | Open the dashboard with an existing key. The service sends no email. |

## Plans

Free $0 / 1,000 lookups · Pro $49 / 50,000 · Scale $199 / 500,000. Upgrade is dashboard Billing after a key exists. Stripe when `STRIPE_SECRET_KEY` is set.

## Lost key

Shown once at signup. Spare keys while a dashboard session is open. Otherwise `support@vet402.com` from the signup address. Do not add magic-link recovery without revising Privacy first (the service sends no email).

## Design worlds

See `DESIGN.md`. Public pages are IETF RFC paper. The dashboard is a zinc operator app. Do not mix them.
