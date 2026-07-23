"use client";

// Thin client-side wrapper around the Plausible pageview script already loaded
// in app/layout.tsx (data-domain=sharoushi-agent.com, shared multi-site
// property; this site's own hostname is captured automatically per-event and
// read back via event:hostname=agent-trust-tawny.vercel.app).
//
// 2026-07-23 CTO: this app previously had zero custom funnel events beyond the
// automatic pageview (confirmed via grep across src/ — signup/page.tsx had no
// tracking at all), unlike every other product in the portfolio which tracks
// at minimum signup_started/signup_completed. This closes that gap with the
// smallest possible footprint. No PII in event names or props (email/name are
// never passed here).
//
// Fire-and-forget: analytics must never throw or block the signup flow, and
// window.plausible may not exist yet if this fires before the afterInteractive
// <Script> finishes loading (no manual queue stub here, matching layout.tsx's
// existing strict-dynamic CSP rationale) — the optional call just no-ops then.
type PlausibleFn = (
  event: string,
  options?: { props?: Record<string, string | number | boolean> }
) => void;

export function track(
  event: string,
  props?: Record<string, string | number | boolean>
) {
  try {
    const w = window as unknown as { plausible?: PlausibleFn };
    w.plausible?.(event, props ? { props } : undefined);
  } catch {
    /* analytics must never break the page */
  }
}
