# Economic Capture — Design

> **Status: design only. Nothing in this document is implemented, priced,
> or announced.** It exists so that when monetization decisions are made,
> they are made against a written neutrality constraint instead of
> improvised. Each candidate below carries the condition under which it
> does *not* break neutrality; a candidate that cannot satisfy its
> condition is dropped, not softened.

## 0. The one rule

vet402's position depends on a single structural fact: **measured
operators are not customers, and verification results are not for sale.**
(See `docs/ARCHITECTURE.md` §7 and the neutrality statement in
`docs/applications/impact-one-pager.md`.)

Therefore every revenue candidate must pass this test:

> *If a paying customer and a non-paying reader ask "did endpoint X
> deliver?", they must receive the same answer, from the same record, at
> the same time.*

What may be sold: **convenience** (latency, volume, integration, format)
and **depth** (frequency, breadth, analysis) *over* the public record.
What may never be sold: the verdict itself, earlier access to a verdict,
suppression or embargo of a failure, or a better result for anyone.

The asset being monetized in every case is the same one described in
`docs/open-core.md`: the accumulated purchase ledger and lifecycle
history (as of 2026-08-20: 845 real purchase attempts, 341 settled,
2,887 delist / 186 relist / 3 settle-drop events over a 17,722-endpoint
catalog — figures from `/api/v1/observatory/state`, retrieved
2026-08-20). The code is MIT; the record is the product.

## 1. Premium data API

**What.** Keyed, paid access to the record at row level and in bulk:

- Historical export — full L0 probe history, L1 attempt-level ledger
  (excluding secrets), lifecycle event stream, as dated datasets.
- Change feed — webhook/stream of delist, relist, settle-drop, and
  verdict-transition events as they are published.
- Derived signals — e.g. settle-rate trajectories, time-since-last-
  successful-purchase, catalog-churn features, packaged for
  agent-framework and index builders.

**Who buys.** Agent frameworks doing pre-payment routing at scale,
analytics/index products over the x402 economy, researchers who need
more than the public aggregates.

**Neutrality condition.** The free public surfaces
(`/api/v1/observatory/state`, observatory pages, per-endpoint verdicts,
badges) remain complete as *answers*: every verdict, every failure,
every correction stays free and key-less, published at the same instant.
The paid tier sells row-level history, bulk formats, push delivery, and
computed features — never an answer the public surface lacks and never a
head start on one. A "premium" event may not exist: if it is published,
it is public.

**Prerequisites before build.** API-key billing plumbing; a written data
license (the record is proprietary — see `docs/open-core.md` §2);
rate/volume design that does not degrade the free surface.

## 2. Higher-assurance verification product

**What.** Paid verification runs that are *deeper* than the daily batch,
not *different* in kind:

- High-frequency L1 — hourly or on-demand settle-through runs against a
  chosen endpoint set, instead of the shared daily budget's coverage.
- Dedicated reports — signed, dated verification reports over a named
  endpoint set (e.g. for an agent operator's allow-list), assembled from
  the same L0/L1/L2 machinery and the same closed vocabulary.
- SLA on freshness — a guarantee about *when vet402 looks*, never about
  *what it finds*.

**Who buys.** Agent operators with an allow-list they must keep current;
platforms embedding x402 payments that want a verified vendor set.

**Neutrality condition.** Two hard rules:

1. **Any result produced by a paid run enters the same public record
   under the same publication gates** (e.g. the two-consecutive-fail rule
   of `docs/ARCHITECTURE.md` §2). A customer buys measurement frequency;
   the measurement's outcome belongs to the public. A paid run that finds
   a failure publishes that failure. Customers must accept this in
   writing before the first run.
2. **The buyer chooses which endpoints get measured more often — never
   the endpoints themselves.** A seller paying to have itself verified
   more frequently is indistinguishable from pay-for-badge and is
   refused. The customer of record must be a *buyer-side* party
   (operator, platform, researcher). Where the same entity is both (a
   platform that also sells endpoints), its own endpoints are excluded
   from its paid set, mirroring the operator self-exclusion rule already
   in the codebase.

**Prerequisites before build.** Per-customer budget isolation on the L1
runner (the atomic reservation design in `src/lib/observatory/` extends
to per-customer ledgers); contract template for rule 1.

## 3. Dispute bonding and slashing

**What.** A staking mechanism around published verdicts:

- A party disputing a published verdict posts a bond.
- The dispute is resolved by re-measurement (fresh L1 purchases,
  published as always) against pre-stated evidence rules.
- Bond is returned (dispute upheld — and the correction goes on
  <https://vet402.com/accuracy> like every other correction) or slashed
  (dispute rejected), with slashed funds directed to a
  publicly-accounted pool (e.g. funding further verification), not to
  operating revenue.

**Why it exists.** Free disputes invite denial-of-service by measured
sellers; priced disputes make challenges costly to spam but cheap
relative to the value of a genuine correction. It also generates the
adversarial pressure that makes the accuracy ledger meaningful.

**Neutrality condition.** Slashing income must not create an incentive
to be wrong (more wrong verdicts → more disputes → more slash revenue).
Hence: slashed funds never book as revenue — they go to a segregated,
publicly-reported pool; and dispute resolution is mechanical
(re-measurement under published rules), never discretionary. If a
resolution cannot be reduced to re-measurement, the dispute type is not
offered.

**Prerequisites before build.** A dispute-evidence rulebook (what counts,
what re-measurement protocol, what timeout); custody design for bonds
(this is where the fail-closed money-handling discipline of the L1
budget applies with higher stakes); legal review of holding third-party
funds. This is the furthest-out candidate and depends on §1/§2 existing
first — there must be economic weight on verdicts before anyone pays to
dispute one.

## 4. Fulfillment guarantee (underwriting)

Designed separately and earlier: see
**`docs/guarantee-underwriting-design.md`** (single source of truth —
not duplicated here). Summary of its relationship to this document:

- It monetizes the *accuracy record*, not the verdict: a paid guarantee
  that vet402's ALLOW was right, priced deterministically off the public
  accuracy ledger with fail-closed underwriting rules.
- It is fully gated: `GUARANTEE_UNDERWRITING_ENABLED` is off by default
  everywhere, and go-live requires an explicit business + legal decision
  (see the flag's contract in `src/lib/config/env.ts`).
- Its neutrality condition is already structural: the underwriting
  function prices only off the same `AccuracyReport` the public sees, so
  a softer private number cannot exist.

## 5. Sequencing and gates

No candidate in this document may be implemented until it has:

1. A written pass of the §0 test, reviewed against
   `docs/ARCHITECTURE.md` §7 and `docs/open-core.md` §4.
2. Demand evidence — at least one named prospective buyer per candidate,
   not a hypothetical persona.
3. Owner approval for anything that touches pricing, contracts, or
   custody of funds (per the standing approval rules of this
   organization; same pipeline as AQ-016 for guarantees).

Likely order, given dependencies: **§1 (data API) → §2 (assurance
product) → §4 (guarantee, on its own gate) → §3 (bonding)**. §1 requires
only billing plumbing over an existing record; §3 requires everything
else to matter first.

What stays free forever, regardless of sequencing: every verdict, every
failure, every correction, the aggregate state JSON, the methodology,
and the badges. That list is the product's credibility; renting any part
of it out would spend the only asset that cannot be re-earned quickly.
