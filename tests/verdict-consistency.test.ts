// ============================================================
// Vouch — one agent, one answer, whatever surface you ask.
//
// Measured 2026-08-12T10:30:22Z, all four fetched together, agentId 1:
//   /agent/1                        → 83 ALLOW
//   /api/v1/agents/1/passport       → 48 BLOCK
//   /api/demo/score                 → 48 BLOCK
//   /leaderboard                    → 66 WARN (dated 2026-07-13)
//
// Four answers, one agent, one instant — and /agent/1 links the reader to the
// passport that contradicted it. For a product whose whole claim is being a
// trust layer, disagreeing with itself is the worst possible failure.
//
// None of it was a scoring bug. The verdict flapped because some upstream read
// was failing (see tests/blockscout-resilience.test.ts), and each surface then
// pinned whichever flap it caught, for a different length of time:
//   - the engine refuses to cache a degraded verdict at all
//   - /api/demo/score pinned one for 5 minutes and told the CDN 15
//   - /agent/[id] held its own ISR generation for 300s
//   - /leaderboard never looked at recency at all
//
// These pin the two rules that stop it recurring: ONE definition of "degraded",
// and no surface may outlive the engine's own confidence in a verdict.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasUnavailableInput, assessSybilRisk } from "@/lib/scoring/verdict";

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("degraded is one shared definition, not a re-implementation per caller", () => {
  assert.equal(hasUnavailableInput(["wallet_metrics_unavailable"]), true);
  assert.equal(hasUnavailableInput(["reputation_summary_unavailable"]), true);
  assert.equal(hasUnavailableInput([]), false);
  assert.equal(hasUnavailableInput(["funding_cluster"]), false);

  // A flag class invented tomorrow is covered without anyone remembering to
  // add it — the property that made the fail-open in assessSybilRisk possible.
  assert.equal(hasUnavailableInput(["something_brand_new_unavailable"]), true);
});

test("FAIL-CLOSED: the degraded chain still ends in high risk", () => {
  // Guard on the refactor itself. hasUnavailableInput now backs assessSybilRisk;
  // if that wiring were ever loosened, "we could not check" would stop being
  // high risk and start being an ALLOW-able verdict.
  assert.equal(assessSybilRisk(["wallet_metrics_unavailable"]), "high");
  assert.equal(assessSybilRisk(["anything_at_all_unavailable"]), "high");
});

test("the engine does not cache a verdict it could not fully compute", () => {
  const engine = read("lib/scoring/engine.ts");
  assert.match(
    engine,
    /if \(!hasUnavailableInput\(sybilFlags\)\) \{\s*memoryCache\.set/,
    "a degraded verdict must stay out of the score cache",
  );
});

test("/api/demo/score must not outlive the engine's confidence in a verdict", () => {
  const demo = read("app/api/demo/score/route.ts");

  assert.match(
    demo,
    /hasUnavailableInput\(result\.signals\.sybil\.flags\)/,
    "the demo route must ask the SAME question the engine asks, not its own",
  );
  assert.match(
    demo,
    /if \(!degraded\) \{\s*cached = \{/,
    "a degraded verdict must not be pinned in the module cache",
  );
  // The 15-minute freeze came from handing the CDN s-maxage=300 + swr=600 on a
  // verdict the engine would not keep for a second.
  assert.match(
    demo,
    /degraded\s*\?\s*"public, s-maxage=30"/,
    "a degraded verdict must get a short CDN life, and no stale-while-revalidate",
  );
});

test("/agent/[id] does not hold its own generation of a verdict it links out to", () => {
  const page = read("app/agent/[agentId]/page.tsx");
  const passport = read("app/api/v1/agents/[agentId]/passport/route.ts");

  assert.match(
    passport,
    /export const dynamic = "force-dynamic"/,
    "precondition: the passport is computed per request",
  );
  assert.match(
    page,
    /export const dynamic = "force-dynamic"/,
    "so the page that links to it must be too — otherwise the two age apart",
  );
  assert.doesNotMatch(
    page,
    /export const revalidate\s*=/,
    "an ISR window here is exactly what made the page say ALLOW while the passport said BLOCK",
  );
});

test("the leaderboard only shows verdicts recent enough to still be true", () => {
  const lb = read("lib/db/leaderboard.ts");

  assert.match(
    lb,
    /created_at > now\(\) - \(\$\{LEADERBOARD_WINDOW_DAYS\}/,
    "the latest row per subject must also be a RECENT row — without a bound, " +
      "a subject nobody looked up since July stays on the board forever",
  );

  const page = read("app/leaderboard/page.tsx");
  assert.match(
    page,
    /No verdicts are in the current window yet/,
    "precondition: the page already promises a window, which is why the query owes one",
  );
});
