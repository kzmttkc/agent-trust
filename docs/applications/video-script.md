# Demo Video Script — vet402 (2–3 minutes)

> One straight line, no detours: **catalog → live L0 verification in /playground → observatory settlement receipt with tx hash → badge.**
> Voiceover lines are written to be read aloud; captions can reuse them verbatim.
>
> **Pre-recording checklist (do all of these on recording day):**
> 1. `curl -sL -o /dev/null -w "%{http_code}" https://vet402.com/playground` returns 200 (the playground page ships with Phase 0.3 — it is 404 in production until that deploy).
> 2. Re-pull live figures: `curl -sL https://vet402.com/api/v1/observatory/state` — replace every number below with the same-day value and update the footer date.
> 3. Pick the featured endpoint just-in-time from the live catalog: one with a settled L1 purchase whose observatory page shows the tx hash (the catalog churns daily; never hard-code the example in advance).
> 4. The tx hash shown on screen must be opened in a public Base explorer during the video. Reviewers weight "really works" above everything.

| # | Time | Screen | Voiceover / caption |
|---|---|---|---|
| 1 | 0:00–0:15 | Title card: "vet402 — We buy. We settle. We publish the measurements." Then the vet402.com hero. | "AI agents pay APIs over x402 — and they pay *before* they know whether the seller delivers. Payment proof is not fulfillment proof. vet402 is the independent layer that closes that gap: we actually buy, and we publish the evidence." |
| 2 | 0:15–0:45 | `/observatory` — the catalog view. Slowly scroll. Hover the headline counters. | "This is the public x402 discovery catalog, measured daily. Seventeen thousand seven hundred twenty-two endpoints tracked. Fifteen thousand and twenty-one active. Two thousand seven hundred and one already delisted — the catalog churns, and we record every delist and relist. Facts with denominators, not vendor claims." *(Replace all figures with recording-day values.)* |
| 3 | 0:45–1:15 | `/playground` — trigger a live L0 verification against a catalog endpoint. Show the request firing and the pass/fail/unverified result with its evidence appearing in real time. | "Level zero: liveness. Watch a verification run live — no purchase, just the x402 handshake, machine-checked. Nine hundred and twenty endpoints currently hold a published pass. Most of the catalog — sixteen thousand eight hundred and two endpoints — is *unverified*: that means not machine-checkable, and we say so instead of guessing." *(Replace figures.)* |
| 4 | 1:15–2:00 | Observatory page of the featured endpoint: the L1 section showing a real purchase — settled status, latency, and the settlement **tx hash**. Click the hash → Base explorer opens → the on-chain transaction is visible. | "Level one: settle-through. We paid this endpoint real USDC on Base mainnet and it delivered. Here is the receipt — the settlement transaction hash, on-chain, checkable by anyone without trusting us. We've made eight hundred and forty-five real purchase attempts; three hundred and forty-one settled. And the five hundred and four that did *not* settle are published on the same pages, with the same weight. Verification that hides failures is just advertising." *(Replace figures.)* |
| 5 | 2:00–2:25 | The endpoint's badge: load `/api/badge/endpoint/{id}` and show the badge embedded in a sample seller page (README or HTML snippet). | "Honest sellers get to prove it. This badge is generated from the same evidence — sellers embed it anywhere, and it links back to the receipts. Verification is unsolicited and free: sellers cannot pay us for a better result, because the operators we measure are not our customers." |
| 6 | 2:25–2:50 | Split view: `/api/v1/observatory/state` raw JSON next to `/observatory/methodology`. Then closing card with URL. | "Everything you just saw is public: the aggregate state is machine-readable JSON, the methodology is published, and our own corrections go on a public accuracy ledger. vet402 — the independent verification layer for the agent-payment economy. We buy. We settle. We publish the measurements." |

## Language rules for the narration

- Never say "nothing is an estimate" or similar absolutes — the trust score *is* an estimate and is labeled as such. Say "measured", "published with evidence", "checkable on-chain".
- Never let an L0 result be described as settlement, or a score as a fact. Levels never move up.
- Every number spoken must match the same-day API pull; update the footer date below when re-recorded.

---

*Figures retrieved from /api/v1/observatory/state on 2026-08-20. Replace with same-day values before recording.*
