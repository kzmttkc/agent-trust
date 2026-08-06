"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

// 2026-08-06 growth: mount-once view tracker for server components (the LP,
// /docs/api and /payee/:address are all RSC pages, so they cannot call
// window.plausible themselves). Same pattern as Verilot's TrackView.tsx —
// fire exactly once per page load, never on re-render.
//
// Event naming note: no "vouch_" prefix. The whole portfolio shares one
// Plausible property (data-domain=sharoushi-agent.com) and separates products
// by the automatic event:hostname property — measured in Verilot (lp_view,
// scan_start: no prefix) and in growth_ledger.py which queries with
// `event:hostname==agent-trust-tawny.vercel.app`. Vouch's own pre-existing
// signup_started/completed/failed are also unprefixed; adding a prefix now
// would split this product into two naming schemes.
export default function TrackView({
  event,
  props,
  withUtmSource,
  withReferrerType,
}: {
  event: string;
  props?: Record<string, string | number | boolean>;
  /** Adds source=utm_source|"direct" (Verilot lp_view parity). */
  withUtmSource?: boolean;
  /**
   * Adds referrer="external"|"internal"|"direct". Coarse on purpose: we want
   * to see badge-embed inflow (external referrer) on /payee/:address without
   * recording the referring URL itself.
   */
  withReferrerType?: boolean;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const extra: Record<string, string | number | boolean> = { ...props };
    if (withUtmSource) {
      extra.source =
        new URLSearchParams(window.location.search).get("utm_source") ||
        "direct";
    }
    if (withReferrerType) {
      try {
        const ref = document.referrer;
        extra.referrer = !ref
          ? "direct"
          : new URL(ref).hostname === window.location.hostname
            ? "internal"
            : "external";
      } catch {
        extra.referrer = "direct";
      }
    }
    track(event, Object.keys(extra).length > 0 ? extra : undefined);
    // Intentionally mount-once: deps would refire on prop identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
