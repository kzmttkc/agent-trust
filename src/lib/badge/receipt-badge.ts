// ============================================================
// vet402 — endpoint receipt badge (seller-outreach hook, 2026-08-18).
//
// The moat is the receipt time-series, and a seller vet402 has actually paid
// can embed proof of it. This badge states ONE fact: n of m paid attempts
// settled with an on-chain receipt. It is deliberately NOT the trust badge —
// there is no green/red judgment here, because the observatory's rule is facts
// only, no scores, no evaluative language (see /observatory). Every measured
// state uses the same navy ink; the number is the message. An unmeasured
// endpoint says "not yet measured", never a fabricated 0/0 or 0%.
//
// The honest, full sentence rides in aria-label / <title>; the visible right
// segment is too small for it.
// ============================================================

export type ReceiptBadgeInput = {
  attemptCount: number;
  settledCount: number;
};

export type ReceiptBadge = {
  /** Short visible label for the right segment. */
  label: string;
  /** Fill colour — one ink for every state (facts, not a verdict). */
  color: string;
  /** Full accessible description. */
  aria: string;
};

// One navy for every measured state (facts, not a signal). Matches the RFC
// world's ink (#233456) so an embed reads as a vet402 measurement, not a
// green-light. Grey for the not-yet-measured state.
const NAVY = "#233456";
const GREY = "#71717a";

export function endpointReceiptBadge(input: ReceiptBadgeInput): ReceiptBadge {
  const attempts = Math.max(0, Math.trunc(input.attemptCount));
  const settled = Math.max(0, Math.min(attempts, Math.trunc(input.settledCount)));

  if (attempts === 0) {
    return {
      label: "not yet measured",
      color: GREY,
      aria: "vet402: this endpoint has no recorded paid attempts yet. A fact about our coverage, not about the endpoint.",
    };
  }

  return {
    label: `${settled}/${attempts} settled`,
    color: NAVY,
    aria: `vet402: ${settled} of ${attempts} paid attempts settled with an on-chain receipt. A measurement of what happened when vet402 paid this endpoint, not a recommendation.`,
  };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render the embeddable SVG. Wider than the trust badge because the label is a
 * short phrase ("3/5 settled") rather than a single word. The left segment
 * carries the vet402 wordmark; the right carries the fact.
 */
export function renderReceiptBadgeSvg(badge: ReceiptBadge): string {
  const aria = xmlEscape(badge.aria);
  const label = xmlEscape(badge.label);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="188" height="24" role="img" aria-label="${aria}">
  <title>${aria}</title>
  <rect width="58" height="24" rx="4" fill="#18181b"/>
  <rect x="58" width="130" height="24" rx="4" fill="${badge.color}"/>
  <rect x="58" width="6" height="24" fill="${badge.color}"/>
  <text x="29" y="16" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11" fill="#ffffff">vet402</text>
  <text x="123" y="16" text-anchor="middle" font-family="Verdana,sans-serif" font-size="10" fill="#ffffff">${label}</text>
</svg>`;
}
