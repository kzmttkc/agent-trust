// Single source of truth for the support/contact address, referenced from
// the footer, /legal/notice, and /legal/privacy. Change it in one place only.
//
// NOTE (2026-07-20, mirrors the same flagged gap already documented in
// ~/soroi/lib/support.ts): vouch.dev is not yet registered/routed to a real
// inbox. Before this is relied on for real disclosure requests, register the
// domain (or point this at an inbox that already receives mail) and send a
// test message to confirm delivery. Until then, treat this as a placeholder
// contact channel, not a verified one.
export const SUPPORT_EMAIL = "support@vouch.dev";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
