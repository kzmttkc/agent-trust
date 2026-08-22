# ETHOnline 2026 — maximize win probability

> Locked 2026-08-22. This file **overrides** [`ROADMAP.md`](./ROADMAP.md) where they differ.
> Roadmap is the calendar. This file is the bet.

## The bet

Do not optimize for Finalist (top ~20%, live 7 minutes, high variance).
Optimize for **three Partner Prizes**. Partners judge async, do not see Finalist ranks, and pay most of the pool.

`payOrRefuse` stays the only verb. We do not swap it. We make the **demo certain** and the **three prize checklists** true.

Expected value, in order:

1. Drive disqualification probability to ~0.
2. Guarantee both demo paths (refuse **and** a public Base tx).
3. Pick 3 prizes the new path actually calls, then talk to those three sponsors before they review.
4. Make the video auto-accept and open on the new verb, not the old product.

---

## 1. Kill every controllable DQ

These lose more often than a weaker idea.

| Risk | Rule |
|---|---|
| Continuity not on file | Apply by **2026-08-24**. If the form has no field, email `hello@ethglobal.com` the same day. Do not start the window without a written acknowledgement. |
| One giant commit | Day 0 is red tests. Every later day is small `ethonline:` commits. |
| Undisclosed old work | Tag `pre-ethonline-2026` on 09-03. README Continuity section is past tense of **what exists**. |
| L1 contamination | Demo rows never enter `x402_l1_purchases`. |
| AI-only submission | Human: apply, keys, first live ALLOW, voiceover, sponsor Discord, submit click. Agents write code. Disclose without softening. |
| Video auto-reject | Dry-run upload 09-12. Final 09-14. Human voice, ≥720p, 2:00–3:50, no AI voice, no phone, no speed-up, no music-over-text. |
| Fake or catalog-only ALLOW | See §2. We do not claim a payment we cannot open on a public explorer. |

Do **not** use `docs/applications/video-script.md`. That is the old product film. Using it makes Continuity look like a reskin.

---

## 2. Make ALLOW certain — own seller first

Catalog ALLOW is a hope. An endpoint can flip score, change price, or stop speaking `exact`.

**In-window, first payment target is a disclosed seller we control.**

- New in this window: `examples/ethonline-2026-agent/seller` — one `exact` resource, Base USDC, ≤ $1, payTo = a wallet that **scores ALLOW** (our own verified payee, or a fixture that is ALLOW on 09-04).
- Video and README say: “ALLOW path hits our disclosed demo seller so the primitive is checkable. BLOCK path hits a live catalog payee.”
- Catalog ALLOW is optional extra, never the only path.

Roadmap Day 4–5 order is hereby:

1. Ship seller + `payOrRefuse` against it → public tx.
2. Then BLOCK against a live catalog payee.
3. Catalog ALLOW only if time remains.

The 09-14 “refuse-only” fallback in the roadmap is last resort. Plan A is a real tx by **09-10**.

BLOCK fixture: pick a live BLOCK/WARN payee and re-check 09-04 / 09-10 / 09-14. If it flips, swap. Do not fake a score.

---

## 3. Prize stack (this is the money)

Max 3 partners. One partner with many tracks still counts as 1.

### Lock moment

- **09-04 kickoff:** screenshot the prize page. Write 3 names in `docs/ethonline-2026/PRIZES.md` (create that day).
- Re-open 09-10 and 09-14. Swap only if the demo does not actually use a pick.

### Heuristic (fill after the list exists)

| Slot | Who | Qualification we must show |
|---|---|---|
| P1 | Base / Coinbase CDP / x402 facilitator | ALLOW settle went through their rail. Tx on Base. |
| P2 | Agent / MCP / wallet the demo calls | `pay_if_trusted` or the signer stack. Screenshot of the tool call. |
| P3 | Continuity-only bounty that the **new** verb uses | Their Continuity form text, not Classic. |

Never: ENS (Tokyo), Sui, Uniswap-without-a-swap, a logo we did not import.

### 4-hour adapter budget (09-11 only)

If P1–P3 need a thin import (CDP facilitator client, AgentKit signer, official `@x402/*`), do it on **09-11 afternoon** after both demo commands work. Not before. Not a fourth verb.

### Sponsor Discord (human, daily after 09-08)

For each of the 3: one message with repo, 45-second clip or terminal GIF, “here is how we used X in `payOrRefuse`”, one question. Mentors who have seen the demo before async review score it.

If the prize list is empty on 09-04, build as if P1 is Base + official x402 `exact`. Fill P2/P3 when names appear.

---

## 4. What the judge must see in 60 seconds

Not the observatory. Not 17k endpoints.

1. `git log pre-ethonline-2026..ethonline-2026` (10s).
2. `run.ts block` → **no signature** (25s).
3. `run.ts allow` → **Base explorer tx** (25s).

Existing product is one sentence: “We already buy and publish. This weekend we closed the hole where an agent could ignore the score and sign anyway.”

---

## 5. Human / agent (eligibility)

ETHOnline may drop Partner/Finalist if the team contribution is not meaningful.

| Must be the human | May be the agent |
|---|---|
| Continuity apply and email | Implementation, tests, docs |
| Wallet, USDC, first ALLOW click | Fixture research |
| Voiceover | Shot list, captions |
| Three sponsor threads | Prize-comment drafts |
| Submit | Commit hygiene, CHANGED_FILES |

The disclosure (`docs/applications/ai-usage-disclosure.md`) stays blunt.

---

## 6. Calendar overrides

| When | Override |
|---|---|
| 08-24 | Continuity apply or nothing else matters |
| 09-04 | Prize screenshot → `PRIZES.md` |
| 09-08–10 | Own seller + first public tx (not catalog) |
| 09-11 PM | At most one prize adapter |
| 09-12 | Video dry-run (reject-checklist) |
| 09-14 | Final video; speak same-day `/observatory/state` numbers only if used at all |
| 09-15 **morning** | Merge `--no-ff`, submit Finalist **and** Partner Prizes |
| 09-16 | Upload fixes only |

During the window: no Origins, no ENS, no registry write, no product roadmap extras. Tokyo apply is already a 15-minute pre-window task.

---

## 7. Honest ceiling

We cannot make a prize certain. We can make the usual ways of losing almost impossible, and put all remaining variance on “did three sponsors like a working pay-or-refuse demo.”

That is the maximum-EV plan for this repo, this week, this event.
