// ============================================================
// vet402 — endpoint receipt badge (seller-outreach hook, 2026-08-18).
//
// A seller whose endpoint vet402 has actually paid can embed a badge showing
// the settle-through record: "n/m settled". Unlike the trust badge, this is a
// FACT, not a judgment — so it carries NO evaluative colour (no green=good,
// red=bad). It states what happened when vet402 paid, in the observatory's
// facts-only register. These tests pin that the label is the honest ratio and
// that an unmeasured endpoint says so rather than inventing a 0 or 100.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { endpointReceiptBadge, renderReceiptBadgeSvg } from "@/lib/badge/receipt-badge";

test("a measured endpoint shows the settled/attempts ratio", () => {
  const b = endpointReceiptBadge({ attemptCount: 5, settledCount: 3 });
  assert.equal(b.label, "3/5 settled");
  assert.match(b.aria, /3 of 5/);
  // Facts, not a verdict — the aria must not claim safety/trust.
  assert.doesNotMatch(b.aria.toLowerCase(), /trust|safe|verified|endors/);
});

test("an endpoint with no paid attempts says 'not yet measured', never 0/0", () => {
  const b = endpointReceiptBadge({ attemptCount: 0, settledCount: 0 });
  assert.equal(b.label, "not yet measured");
  assert.doesNotMatch(b.label, /0\/0|0%/);
});

test("all-settled and none-settled are both stated plainly (no colour-coding of good/bad)", () => {
  assert.equal(endpointReceiptBadge({ attemptCount: 3, settledCount: 3 }).label, "3/3 settled");
  assert.equal(endpointReceiptBadge({ attemptCount: 4, settledCount: 0 }).label, "0/4 settled");
  // Same ink for every measured state — the number carries the meaning, not a
  // green/red signal a human would read as vet402's opinion.
  const good = endpointReceiptBadge({ attemptCount: 3, settledCount: 3 });
  const bad = endpointReceiptBadge({ attemptCount: 4, settledCount: 0 });
  assert.equal(good.color, bad.color);
});

test("the SVG is well-formed, escapes its text, and carries the aria label", () => {
  const b = endpointReceiptBadge({ attemptCount: 2, settledCount: 1 });
  const svg = renderReceiptBadgeSvg(b);
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /role="img"/);
  assert.ok(svg.includes(b.label));
  // No unescaped angle brackets injected via label (defense: label is ours,
  // but the renderer must escape regardless).
  const evil = renderReceiptBadgeSvg({ ...b, label: 'x"><script>' });
  assert.ok(!evil.includes("<script>"));
});
