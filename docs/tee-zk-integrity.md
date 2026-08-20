# Verification-Process Integrity — TEE and ZK Design

> **Status: design document, pre-prototype. Nothing described here is
> implemented.** Today, vet402's measurements are checkable but the
> measurement *process* is trusted: settlement tx hashes can be verified
> on-chain by anyone, but the claim "this response came from that
> endpoint, at that time, against that challenge" rests on the
> operator's honesty. This document designs the removal of that trust
> requirement.

## 1. Problem statement

**Can a reader believe vet402's measurements without trusting vet402's
operator?**

What is already independently checkable, with no trust in vet402:

- That a settlement happened — every settled L1 purchase publishes its
  Base tx hash (341 of them as of 2026-08-20, per
  `/api/v1/observatory/state`, retrieved that day).
- That the methodology is as stated — the code is MIT and public.
- That the aggregates match the published rows — anyone can recount.

What currently requires trusting the operator:

- That a published *non-settlement* was a genuine attempt against the
  real endpoint (a fabricated failure has no on-chain footprint).
- That the paid response used for the L2 conformance diff is the actual
  bytes the endpoint returned — not edited, not substituted.
- That probes and purchases ran the published code, at the published
  time, against the declared target.

This gap matters asymmetrically: the on-chain hash makes *false success*
expensive to fake, but *false failure* and *false conformance results*
are exactly where an untrusted verifier could quietly cheat — and
exactly what an adversarial seller will allege when disputing a
published fail. Process integrity is therefore a prerequisite for the
dispute-bonding design (`docs/economic-capture-design.md` §3): nobody
should bond against a verdict whose production process is unauditable.

Design goal, stated as an invariant to reach:

> Every published L0/L1/L2 result carries evidence that (a) identifies
> the exact code that produced it, (b) binds the request, response, and
> timestamp together, and (c) can be checked by a third party without
> vet402's cooperation.

## 2. Path A — TEE-attested execution (primary)

Run the measurement inside a hardware trusted-execution environment
(candidates: Phala Network, Automata, or a raw Intel TDX / AMD SEV-SNP
instance) and publish a remote attestation with each result: a
hardware-signed statement that *this enclave, running this exact code
measurement (hash), produced this output*.

### 2.1 What gets isolated

Not the whole service. The enclave boundary is drawn around the smallest
unit whose honesty is in question — the **purchase-and-diff core** of
`src/lib/observatory/l1-runner.ts`:

| Inside the enclave | Stays outside |
|---|---|
| Build the request from the catalog-declared method/URL/price | Catalog sync, candidate selection, scheduling |
| Sign the x402 payment (EIP-3009 USDC authorization) with an enclave-held purchase key | Budget accounting (`reserveSpend` stays in Postgres — the atomic-reservation design is unchanged) |
| Execute the HTTP exchange: 402 challenge → payment → paid response | The database, all public pages and APIs |
| Hash and timestamp the full request/response transcript | Scoring engine, SpendGuard, accuracy ledger |
| Run the L2 conformance diff (`checkL2`) over the in-enclave response bytes | Everything else in the repo |
| Emit: result + transcript hash + code-measurement + attestation quote | |

The enclave's output is a **signed receipt**: `{endpoint id, request
hash, response hash, outcome, L2 result, enclave code measurement,
timestamp, attestation}`. The ledger row in `x402_l1_purchases` stores
the receipt; the public pages link it. The SSRF guard
(`src/lib/net/safe-fetch.ts`) must be *inside* the enclave — an
attested measurement that could be pointed at an attacker-chosen
internal address would be attested SSRF.

Key handling: moving the purchase key into the enclave means the
operator provably *cannot* forge a purchase transcript with that key
outside the enclave. This is a stronger custody posture than today and
must go through the same money-safety review as any wallet change.

### 2.2 What TEE attestation does not cover — stated limits

These limits will be published alongside any attestation claim, in the
same "facts with denominators" register as everything else:

1. **The counterparty is still the counterparty.** Attestation proves
   what the enclave sent and received. It cannot prove the endpoint's
   response was the endpoint's "real" behavior — a seller can still
   serve different bytes to vet402's IPs than to everyone else.
   (Mitigation is operational — egress diversity — not cryptographic.)
2. **The RPC and the chain are external.** Settlement confirmation
   comes from a Base RPC the enclave talks to; the attestation covers
   the query and the answer, not the RPC's honesty. (Mitigation:
   settlement is the one claim that is *already* independently
   checkable on-chain, so this limit costs little.)
3. **Time is external.** Enclaves do not have trusted wall clocks;
   timestamps are bound to an external anchor (e.g. a recent Base block
   hash included in the transcript), which proves "not before", not an
   exact instant.
4. **TEE vendors are a trust root.** Hardware attestation replaces
   "trust the operator" with "trust the CPU vendor's attestation chain
   plus the absence of unpatched enclave exploits". This is a large
   reduction in trust, not an elimination, and will be described as
   such — never as "trustless".
5. **Candidate selection stays outside.** Attestation proves each run
   was honest; it does not prove vet402 didn't *choose* which endpoints
   to run. The existing mitigations (published methodology, full-catalog
   L0 coverage, published denominators) continue to carry that load.

## 3. Path B — selective ZK proofs (later)

Zero-knowledge proofs over the evidence, for claims where even the
transcript cannot be published:

- **TLS transcript proofs** (zkTLS / TLSNotary-style): prove "endpoint X
  served response with hash H over TLS at time T" without a TEE, or as
  a second, independent leg alongside one.
- **Redacted-evidence proofs**: prove "the paid response failed the
  declared schema at field F" while revealing only the failing field —
  relevant when a paid response contains material vet402 should not
  republish wholesale (paid content, PII).
- **Aggregate proofs**: prove "the published settle rate is correctly
  computed over N committed receipts" without a reader re-fetching every
  receipt.

Position: **cost-heavy, second stage.** Proving general HTTPS exchanges
in ZK is still expensive and toolchain-volatile; the TEE path delivers
most of the integrity gain for a fraction of the engineering. Path B
becomes worth it (a) as an independent check on the TEE trust root
(limit 4 above), and (b) for the redaction cases where publishing the
transcript is not an option. Design work on B should start only after A
has produced attested receipts in production.

## 4. Staged rollout and milestones

Each stage has an explicit exit criterion; no stage's language may be
used publicly before its criterion is measured.

| Stage | Work | Exit criterion (measurable) |
|---|---|---|
| **0. Transcript commitment** (no TEE — do first) | Hash-commit the full request/response transcript of every L1 attempt into the ledger row at write time; publish the hashes. | Every new ledger row carries a transcript hash; spot-check tooling in repo verifies a stored transcript against its published hash. |
| **1. Enclave prototype** | Port the purchase-and-diff core (§2.1) to one TEE platform; run against a testnet/staging endpoint set with a throwaway key. | An end-to-end run produces a receipt whose attestation a third-party tool verifies against the published code measurement. Platform choice memo written (Phala vs Automata vs raw TDX), including cost per run. |
| **2. Shadow production** | Run the enclave path alongside the existing runner on the same daily candidates (same budget — reservation logic shared, not duplicated). Compare outcomes. | ≥ 30 consecutive days where enclave and non-enclave outcomes agree, or every divergence is explained in writing. No budget-safety regressions (the reservation tests still pass unmodified). |
| **3. Attested by default** | Enclave path becomes the production L1 runner; purchase key exists only inside the enclave; receipts published on endpoint pages and via the API. | 100% of new L1 rows carry a verifiable receipt; an independent verifier script ships in this repo (MIT, like everything else); docs page explains the limits in §2.2 verbatim. |
| **4. ZK leg** (Path B) | Per §3, starting with redacted-evidence proofs for L2 mismatches. | First published mismatch carries a proof a third party has verified without seeing the full response. |

**Naming gate — when "TEE-attested receipt" may be claimed:** the badge
or phrase may appear on public surfaces only at **Stage 3**, and only on
rows that actually carry a verifiable receipt. Mixed-era data must say
so: rows from before Stage 3 remain labeled as operator-published, with
the cutover date stated. Claiming attestation during Stages 1–2 — while
the attested path is not yet the path that produces the published
numbers — would be exactly the kind of instrument-vs-result confusion
this product exists to prevent.

## 5. What this buys, in one sentence

Today a reader must trust that vet402 ran the code it publishes; after
Stage 3, the reader verifies it — and vet402's failure records become as
hard to fake as its settlement hashes already are.
