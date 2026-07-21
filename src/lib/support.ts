// Single source of truth for the support/contact address, referenced from
// the footer, /legal/notice, and /legal/privacy. Change it in one place only.
//
// NOTE (2026-07-21, Takeshi decision): vouch.dev is not yet registered.
// Domain purchase is on hold until traction justifies the spend, so this
// points directly at the operator's personal inbox, kzmttkc314@gmail.com,
// which actually receives mail. Once the domain is registered and mail
// forwarding is confirmed with a real test send, swap this back to the
// support alias on the vouch.dev domain.
export const SUPPORT_EMAIL = "kzmttkc314@gmail.com";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
