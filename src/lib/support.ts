// Single source of truth for the support/contact address, referenced from
// the footer, /legal/notice, /legal/privacy, /legal/terms, and /corrections.
// Change it in one place only.
//
// NOTE (2026-08-14): switched from the operator's personal inbox
// to support@vet402.com after the owner confirmed
// real delivery to that address with a test send. This address is legally
// load-bearing — it is the receiving route for GDPR data-subject requests
// and score-correction challenges (ToS §8) — so if mail routing for the
// domain ever changes, re-verify delivery with a real test send BEFORE
// touching this constant. (History: 2026-07-21 Takeshi decision kept the
// personal Gmail here while the domain purchase was on hold.)
export const SUPPORT_EMAIL = "support@vet402.com";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
